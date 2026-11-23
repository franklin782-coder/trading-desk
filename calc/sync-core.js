/* Pure paper-account sync helpers. No Firebase. Used by sync.js and tests. */
export const START_BAL = 30000;
export const FIRST_SIGNIN_MSG =
  'This device has open positions that are not in the cloud.\n\nOK: keep this device and upload it.\nCancel: use the cloud account instead.';

export function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

export function emptyBook() {
  return { balance: START_BAL, positions: [], pending: [], history: [], seq: 1, resetAt: 0 };
}

export function normalizeBook(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    balance: isFinite(+b.balance) ? +b.balance : START_BAL,
    positions: Array.isArray(b.positions) ? b.positions.filter((x) => x && x.id) : [],
    pending: Array.isArray(b.pending) ? b.pending.filter((x) => x && x.id) : [],
    history: Array.isArray(b.history) ? b.history.filter((x) => x && x.id) : [],
    seq: Math.max(1, +b.seq || 1),
    resetAt: +b.resetAt || 0
  };
}

export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const drawings = (s.drawings && typeof s.drawings === 'object' && !Array.isArray(s.drawings))
    ? s.drawings
    : {};
  return {
    updatedAt: +s.updatedAt || 0,
    writeId: typeof s.writeId === 'string' ? s.writeId : '',
    book: normalizeBook(s.book),
    drawings
  };
}

export function isCloudEmpty(raw) {
  if (!raw || typeof raw !== 'object') return true;
  if (!raw.updatedAt && !raw.book) return true;
  if (!raw.updatedAt) {
    const b = normalizeBook(raw.book);
    return !b.positions.length && !b.pending.length && !b.history.length &&
      Math.abs(b.balance - START_BAL) < 0.005;
  }
  return false;
}

export function fingerprint(state) {
  const s = normalizeState(state);
  return JSON.stringify({ book: s.book, drawings: s.drawings });
}

function ids(list) {
  return new Set((list || []).map((x) => x.id));
}

export function localHasUnsyncedPositions(local, cloud) {
  const L = normalizeState(local);
  const C = normalizeState(cloud);
  const known = new Set([
    ...ids(C.book.positions),
    ...ids(C.book.pending),
    ...ids(C.book.history)
  ]);
  return L.book.positions.some((p) => !known.has(p.id));
}

export function decideFirstSignIn(local, cloud) {
  if (isCloudEmpty(cloud)) return { action: 'upload' };
  if (fingerprint(local) === fingerprint(cloud)) return { action: 'apply-cloud' };
  if (localHasUnsyncedPositions(local, cloud)) return { action: 'confirm' };
  return { action: 'apply-cloud' };
}

export function shouldApplyRemote(remote, lastAppliedAt, lastWriteId) {
  const r = normalizeState(remote);
  if (!r.updatedAt) return false;
  if (lastWriteId && r.writeId === lastWriteId) return false;
  return r.updatedAt > (lastAppliedAt || 0);
}

export function canCommitWrite(remote, baseUpdatedAt) {
  if (!remote || isCloudEmpty(remote)) return true;
  return (+remote.updatedAt || 0) === (baseUpdatedAt || 0);
}

function eventTime(item) {
  if (!item || typeof item !== 'object') return 0;
  return +item.t || +item.openedAt || +item.updatedAt || 0;
}

function byIdLatest(lists) {
  const map = new Map();
  lists.forEach((list) => {
    (list || []).forEach((item) => {
      if (!item || !item.id) return;
      const prev = map.get(item.id);
      if (!prev || eventTime(item) >= eventTime(prev)) map.set(item.id, item);
    });
  });
  return map;
}

function filterAfter(list, cut) {
  if (!cut) return list || [];
  return (list || []).filter((x) => eventTime(x) >= cut);
}

export function mergeStates(local, remote) {
  const L = normalizeState(local);
  const R = normalizeState(remote);
  const cut = Math.max(L.book.resetAt || 0, R.book.resetAt || 0);

  function clip(book) {
    if (!cut || (book.resetAt || 0) >= cut) return book;
    return {
      balance: book.balance,
      positions: filterAfter(book.positions, cut),
      pending: filterAfter(book.pending, cut),
      history: filterAfter(book.history, cut),
      seq: book.seq,
      resetAt: book.resetAt
    };
  }

  const lBook = clip(L.book);
  const rBook = clip(R.book);
  const historyMap = byIdLatest([rBook.history, lBook.history]);
  const closed = new Set(historyMap.keys());

  const posMap = new Map();
  rBook.positions.concat(lBook.positions).forEach((p) => {
    if (!p || !p.id || closed.has(p.id)) return;
    if (!posMap.has(p.id)) posMap.set(p.id, p);
  });

  const pendMap = new Map();
  rBook.pending.concat(lBook.pending).forEach((o) => {
    if (!o || !o.id || closed.has(o.id) || posMap.has(o.id)) return;
    pendMap.set(o.id, o);
  });

  const newer = (L.updatedAt || 0) >= (R.updatedAt || 0) ? { book: lBook } : { book: rBook };
  const newerPos = ids(newer.book.positions);
  const newerHist = ids(newer.book.history);
  let balance = newer.book.balance;

  posMap.forEach((p, id) => {
    if (!newerPos.has(id)) balance -= (+p.openFee || 0);
  });
  (newer.book.positions || []).forEach((p) => {
    if (closed.has(p.id) && !newerHist.has(p.id)) {
      const h = historyMap.get(p.id);
      if (h) balance += (+h.pnl || 0);
    }
  });

  const drawings = (L.updatedAt || 0) >= (R.updatedAt || 0) ? L.drawings : R.drawings;

  return {
    updatedAt: Math.max(L.updatedAt || 0, R.updatedAt || 0),
    writeId: '',
    book: {
      balance,
      positions: Array.from(posMap.values()),
      pending: Array.from(pendMap.values()),
      history: Array.from(historyMap.values()).sort((a, b) => eventTime(b) - eventTime(a)),
      seq: Math.max(lBook.seq, rBook.seq),
      resetAt: cut
    },
    drawings
  };
}

export function newWriteId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function createMemoryStore() {
  let doc = null;
  const listeners = new Set();
  let paused = false;
  let missed = false;
  function emit() {
    if (paused) { missed = true; return; }
    listeners.forEach((cb) => { try { cb(clone(doc)); } catch (e) { /* */ } });
  }
  return {
    pause() { paused = true; },
    resume() {
      paused = false;
      if (missed && doc) emit();
      missed = false;
    },
    async get() { return doc ? clone(doc) : null; },
    async runTransaction(fn) {
      const current = doc ? clone(doc) : null;
      const next = await fn(current);
      if (!next) return null;
      doc = clone(next);
      emit();
      return clone(doc);
    },
    subscribe(fn) {
      listeners.add(fn);
      if (doc && !paused) {
        try { fn(clone(doc)); } catch (e) { /* */ }
      }
      return () => listeners.delete(fn);
    }
  };
}

export function createSyncSession(opts) {
  const getState = opts.getState;
  const applyState = opts.applyState;
  const confirm = opts.confirm || (() => false);
  const now = opts.now || (() => Date.now());
  const debounceMs = opts.debounceMs == null ? 400 : opts.debounceMs;
  const makeId = opts.newId || newWriteId;
  const store = opts.store;
  const onStatus = opts.onStatus || (() => {});

  let lastAppliedAt = 0;
  let lastWriteId = '';
  let dirty = false;
  let timer = 0;
  let unsub = null;
  let applying = false;
  let started = false;
  let flushing = false;
  let flushAgain = false;
  let firstDone = false;

  function currentPayload() {
    const s = getState() || {};
    return { book: normalizeBook(s.book), drawings: normalizeState(s).drawings };
  }

  function applyFromCloud(remote, writeId, updatedAt) {
    applying = true;
    try {
      applyState(normalizeState(remote));
    } finally {
      applying = false;
    }
    lastWriteId = writeId || normalizeState(remote).writeId;
    lastAppliedAt = updatedAt || normalizeState(remote).updatedAt;
  }

  async function writePayload(payload, opts) {
    const force = !!(opts && opts.force);
    const writeId = makeId();
    const updatedAt = now();
    const next = {
      book: payload.book,
      drawings: payload.drawings,
      updatedAt,
      writeId
    };
    const written = await store.runTransaction(async (current) => {
      if (force || isCloudEmpty(current) || canCommitWrite(current, lastAppliedAt)) return next;
      const merged = mergeStates({ ...currentPayload(), updatedAt: lastAppliedAt, writeId: lastWriteId }, current);
      merged.updatedAt = updatedAt;
      merged.writeId = writeId;
      return merged;
    });
    if (!written) return null;
    lastWriteId = written.writeId;
    lastAppliedAt = written.updatedAt;
    if (fingerprint(written) !== fingerprint(currentPayload())) {
      applyFromCloud(written, written.writeId, written.updatedAt);
    }
    return written;
  }

  async function firstSignIn() {
    const cloud = await store.get();
    const local = { ...currentPayload(), updatedAt: 0, writeId: '' };
    const decision = decideFirstSignIn(local, cloud);
    let action = decision.action;
    if (action === 'confirm') {
      const keepLocal = await Promise.resolve(confirm(FIRST_SIGNIN_MSG));
      action = keepLocal ? 'upload' : 'apply-cloud';
    }
    if (action === 'upload') {
      await writePayload(currentPayload(), { force: true });
      onStatus('synced');
    } else {
      applyFromCloud(cloud, cloud && cloud.writeId, cloud && cloud.updatedAt);
      onStatus('synced');
    }
    firstDone = true;
  }

  function onRemote(remote) {
    if (!firstDone || applying) return;
    if (!shouldApplyRemote(remote, lastAppliedAt, lastWriteId)) return;
    applyFromCloud(remote, remote.writeId, remote.updatedAt);
    if (dirty) scheduleFlush();
    onStatus('synced');
  }

  async function flush() {
    if (!started) return;
    if (flushing) { flushAgain = true; return; }
    flushing = true;
    try {
      dirty = false;
      await writePayload(currentPayload());
      onStatus('synced');
    } catch (e) {
      dirty = true;
      onStatus('error');
      throw e;
    } finally {
      flushing = false;
      if (flushAgain) {
        flushAgain = false;
        scheduleFlush();
      }
    }
  }

  function scheduleFlush() {
    if (!started) return;
    dirty = true;
    onStatus('pending');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; flush().catch(() => {}); }, debounceMs);
  }

  async function start() {
    if (started) return;
    started = true;
    await firstSignIn();
    if (store.subscribe) unsub = store.subscribe(onRemote);
  }

  function stop() {
    started = false;
    firstDone = false;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (unsub) { unsub(); unsub = null; }
    lastAppliedAt = 0;
    lastWriteId = '';
    dirty = false;
  }

  function notifyLocalChange() {
    if (applying || !started) return;
    scheduleFlush();
  }

  return {
    start,
    stop,
    notifyLocalChange,
    flush,
    getMeta: () => ({ lastAppliedAt, lastWriteId, dirty, started, firstDone })
  };
}
