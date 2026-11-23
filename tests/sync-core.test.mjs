import assert from 'node:assert/strict';
import {
  START_BAL,
  isCloudEmpty,
  decideFirstSignIn,
  shouldApplyRemote,
  canCommitWrite,
  mergeStates,
  fingerprint,
  localHasUnsyncedPositions,
  createMemoryStore,
  createSyncSession,
  normalizeState
} from '../calc/sync-core.js';

function book(over) {
  return Object.assign({
    balance: START_BAL,
    positions: [],
    pending: [],
    history: [],
    seq: 1,
    resetAt: 0
  }, over);
}

function pos(id, extra) {
  return Object.assign({
    id, coin: 'BTC', side: 'long', entry: 100, qty: 1, margin: 1000,
    lev: 10, openFee: 5, t: 1000, openedAt: 1000
  }, extra);
}

function hist(id, extra) {
  return Object.assign({
    id, coin: 'BTC', side: 'long', entry: 100, exit: 110, pnl: 10, reason: 'tp', t: 2000
  }, extra);
}

/* —— empty / first sign-in —— */
assert.equal(isCloudEmpty(null), true);
assert.equal(isCloudEmpty({}), true);
assert.equal(isCloudEmpty({ book: book() }), true);
assert.equal(isCloudEmpty({ updatedAt: 5, book: book() }), false);

const localOpen = { book: book({ positions: [pos('p1')], balance: 29995 }), drawings: {} };
const cloudEmpty = null;
assert.equal(decideFirstSignIn(localOpen, cloudEmpty).action, 'upload');

const cloudSame = { updatedAt: 9, book: localOpen.book, drawings: {} };
assert.equal(decideFirstSignIn(localOpen, cloudSame).action, 'apply-cloud');

const cloudOther = {
  updatedAt: 9,
  book: book({ positions: [pos('cloud-only')], balance: 29990 }),
  drawings: {}
};
assert.equal(localHasUnsyncedPositions(localOpen, cloudOther), true);
assert.equal(decideFirstSignIn(localOpen, cloudOther).action, 'confirm');

const localFresh = { book: book(), drawings: {} };
assert.equal(decideFirstSignIn(localFresh, cloudOther).action, 'apply-cloud');

/* —— LWW apply / CAS —— */
assert.equal(shouldApplyRemote({ updatedAt: 10, writeId: 'a' }, 5, 'b'), true);
assert.equal(shouldApplyRemote({ updatedAt: 10, writeId: 'a' }, 10, 'b'), false);
assert.equal(shouldApplyRemote({ updatedAt: 10, writeId: 'a' }, 5, 'a'), false);
assert.equal(canCommitWrite({ updatedAt: 10 }, 10), true);
assert.equal(canCommitWrite({ updatedAt: 11 }, 10), false);
assert.equal(canCommitWrite(null, 0), true);

/* —— merge: closed wins, new local order kept, no double history —— */
const remoteClosed = {
  updatedAt: 20,
  book: book({
    balance: 30005,
    positions: [],
    history: [hist('p1', { pnl: 10 })],
    seq: 2
  })
};
const localStaleOpen = {
  updatedAt: 10,
  book: book({
    balance: 29995,
    positions: [pos('p1')],
    pending: [{ id: 'l2', coin: 'ETH', side: 'long', entry: 50, qty: 2, margin: 200, t: 1500 }],
    seq: 3
  })
};
const merged = mergeStates(localStaleOpen, remoteClosed);
assert.equal(merged.book.positions.length, 0, 'closed position must disappear');
assert.equal(merged.book.history.length, 1);
assert.equal(merged.book.history[0].id, 'p1');
assert.equal(merged.book.pending.length, 1);
assert.equal(merged.book.pending[0].id, 'l2');
assert.equal(merged.book.balance, 30005, 'start from newer (close) balance; pending has no fee');

/* two devices open different positions */
const aOpen = {
  updatedAt: 11,
  book: book({ balance: 29995, positions: [pos('a1', { openFee: 5 })], seq: 2 })
};
const bOpen = {
  updatedAt: 10,
  book: book({ balance: 29990, positions: [pos('b1', { openFee: 10, coin: 'ETH' })], seq: 2 })
};
const both = mergeStates(bOpen, aOpen);
const bothIds = both.book.positions.map((p) => p.id).sort();
assert.deepEqual(bothIds, ['a1', 'b1']);
assert.equal(both.book.balance, 29985, '29995 newer minus b1 fee 10');

/* reset discards older activity */
const afterReset = {
  updatedAt: 50,
  book: book({ balance: START_BAL, resetAt: 40, seq: 1 })
};
const oldPos = {
  updatedAt: 30,
  book: book({ balance: 10000, positions: [pos('old', { openedAt: 20, t: 20 })], history: [hist('h', { t: 25 })], seq: 9 })
};
const resetMerged = mergeStates(afterReset, oldPos);
assert.equal(resetMerged.book.positions.length, 0);
assert.equal(resetMerged.book.history.length, 0);
assert.equal(resetMerged.book.balance, START_BAL);
assert.equal(resetMerged.book.resetAt, 40);

/* —— two sessions on one memory store —— */
function device(store, seed, clock) {
  let state = normalizeState({ book: seed, drawings: {}, updatedAt: 0, writeId: '' });
  const sess = createSyncSession({
    store,
    debounceMs: 0,
    now: () => clock.t,
    newId: () => 'w' + clock.t,
    getState: () => ({ book: state.book, drawings: state.drawings }),
    applyState: (s) => { state = normalizeState(s); }
  });
  return {
    sess,
    get: () => state,
    setBook(book) {
      state.book = book;
      sess.notifyLocalChange();
    }
  };
}

const store = createMemoryStore();
const clock = { t: 100 };
const A = device(store, book({ positions: [pos('p1')], balance: 29995, seq: 2 }), clock);
await A.sess.start();
assert.ok((await store.get()).updatedAt, 'first device uploads');
assert.equal((await store.get()).book.positions[0].id, 'p1');

clock.t = 200;
const B = device(store, book(), clock);
await B.sess.start();
assert.equal(B.get().book.positions[0].id, 'p1', 'second device prefers cloud');
assert.equal(B.get().book.balance, 29995);

/* B closes the position; A must drop it */
clock.t = 300;
B.setBook(book({
  balance: 30005,
  positions: [],
  history: [hist('p1', { pnl: 10, t: 300 })],
  seq: 2
}));
await B.sess.flush();
assert.equal(A.get().book.positions.length, 0, 'close replicates to the other device');
assert.equal(A.get().book.history[0].id, 'p1');
assert.equal(A.get().book.balance, 30005);

/* Stale race: A misses B's close, then writes the old open book plus a new limit. */
const storeStale = createMemoryStore();
clock.t = 400;
const A2 = device(storeStale, book({ positions: [pos('p1')], balance: 29995, seq: 2 }), clock);
await A2.sess.start();
clock.t = 410;
const B2 = device(storeStale, book(), clock);
await B2.sess.start();
assert.equal(B2.get().book.positions[0].id, 'p1');
storeStale.pause();
clock.t = 420;
B2.setBook(book({
  balance: 30005,
  positions: [],
  history: [hist('p1', { pnl: 10, t: 420 })],
  seq: 2
}));
await B2.sess.flush();
clock.t = 430;
A2.setBook(book({
  balance: 29995,
  positions: [pos('p1')],
  pending: [{ id: 'lim1', coin: 'SOL', side: 'long', entry: 20, qty: 1, margin: 50, t: 430 }],
  history: [],
  seq: 4
}));
await A2.sess.flush();
storeStale.resume();
const afterConflict = await storeStale.get();
assert.equal(afterConflict.book.positions.some((p) => p.id === 'p1'), false, 'stale reopen is rejected');
assert.equal(afterConflict.book.pending.some((p) => p.id === 'lim1'), true, 'new local order is kept');
assert.equal(B2.get().book.pending.some((p) => p.id === 'lim1'), true);
assert.equal(A2.get().book.positions.length, 0, 'A applies the merged close');

/* first-sign-in confirm keeps local when user says OK */
const store2 = createMemoryStore();
clock.t = 500;
const seedCloud = device(store2, book({ positions: [pos('cloud1')], balance: 29900, seq: 2 }), clock);
await seedCloud.sess.start();
clock.t = 600;
let stateC = normalizeState({
  book: book({ positions: [pos('phone1')], balance: 29800, seq: 3 }),
  drawings: {}
});
const phone = createSyncSession({
  store: store2,
  debounceMs: 0,
  now: () => clock.t,
  newId: () => 'p' + clock.t,
  confirm: () => true,
  getState: () => ({ book: stateC.book, drawings: stateC.drawings }),
  applyState: (s) => { stateC = normalizeState(s); }
});
await phone.start();
assert.equal((await store2.get()).book.positions[0].id, 'phone1', 'confirm OK uploads local');

/* echo of our own write is ignored */
assert.equal(shouldApplyRemote({ updatedAt: 600, writeId: 'p600' }, 600, 'p600'), false);

/* fingerprints ignore write metadata */
assert.equal(
  fingerprint({ updatedAt: 1, writeId: 'x', book: book(), drawings: {} }),
  fingerprint({ updatedAt: 9, writeId: 'y', book: book(), drawings: {} })
);

console.log('sync-core tests ok');
