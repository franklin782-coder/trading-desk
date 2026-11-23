/* Firebase Google auth + Firestore sync for the paper account. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { createSyncSession } from './sync-core.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDfOJ8fA4cWd8SUbr6RlHD8V3xE9VPz880',
  authDomain: 'trading-desk-sync-6dfe7.firebaseapp.com',
  projectId: 'trading-desk-sync-6dfe7',
  storageBucket: 'trading-desk-sync-6dfe7.firebasestorage.app',
  messagingSenderId: '630729687723',
  appId: '1:630729687723:web:476d881eeef99acee4edee'
};

const api = {
  connect,
  notifyLocalChange,
  isSignedIn: () => !!currentUser,
  getUser: () => currentUser
};

let app = null;
let auth = null;
let db = null;
let adapter = null;
let session = null;
let currentUser = null;
let unsubAuth = null;
let started = false;
let initError = null;

function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function shouldUseRedirect() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  return iOS || standalone;
}

function statePath(uid) {
  return doc(db, 'users', uid, 'state', 'main');
}

function firestoreStore(uid) {
  const ref = statePath(uid);
  return {
    async get() {
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    },
    async runTransaction(fn) {
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? snap.data() : null;
        const next = await fn(current);
        if (!next) return null;
        tx.set(ref, next);
        return next;
      });
    },
    subscribe(cb) {
      return onSnapshot(ref, (snap) => {
        if (snap.exists()) cb(snap.data());
      }, (err) => {
        console.warn('sync snapshot', err);
      });
    }
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChips() {
  const nodes = document.querySelectorAll('[data-auth-chip]');
  nodes.forEach((el) => {
    const full = el.getAttribute('data-auth-size') === 'full';
    if (initError && !currentUser) {
      el.innerHTML = full
        ? '<p class="set-note">Cloud sync is unavailable right now. Paper trading still works on this device.</p>'
        : '';
      return;
    }
    if (!currentUser) {
      if (full) {
        el.innerHTML =
          '<p class="set-note">Sign in with Google to keep the $30,000 paper account, positions, and orders the same on your phone and PC.</p>' +
          '<button type="button" class="auth-signin">Sign in with Google</button>';
      } else {
        el.innerHTML = '<button type="button" class="auth-signin">Sign in</button>';
      }
      const btn = el.querySelector('.auth-signin');
      if (btn) btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); startSignIn(); });
      return;
    }
    const email = currentUser.email || 'Signed in';
    const photo = currentUser.photoURL || '';
    const av = photo
      ? '<img class="auth-av" alt="" src="' + escapeHtml(photo) + '">'
      : '<span class="auth-av auth-av-ph" aria-hidden="true">' + escapeHtml((email[0] || '?').toUpperCase()) + '</span>';
    if (full) {
      el.innerHTML =
        '<div class="auth-card">' + av +
        '<div class="auth-card-meta"><b>' + escapeHtml(email) + '</b><span>Phone and PC stay in sync</span></div>' +
        '<button type="button" class="auth-signout">Sign out</button></div>';
      const out = el.querySelector('.auth-signout');
      if (out) out.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); startSignOut(); });
    } else {
      el.innerHTML = '<button type="button" class="auth-user" title="' + escapeHtml(email) + ' (sign out)">' +
        av + '<span class="auth-mail">' + escapeHtml(email) + '</span></button>';
      const btn = el.querySelector('.auth-user');
      if (btn) btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); startSignOut(); });
    }
  });
}

async function startSignIn() {
  if (!auth) { toast('Sign-in could not start.'); return; }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    if (shouldUseRedirect()) {
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (e2) {
        console.warn('sync redirect', e2);
        toast('Google sign-in failed.');
        return;
      }
    }
    console.warn('sync sign-in', e);
    toast('Google sign-in failed.');
  }
}

async function startSignOut() {
  if (!confirm('Sign out? This device will keep its current paper account locally, but it will no longer sync.')) return;
  try {
    if (session) { session.stop(); session = null; }
    currentUser = null;
    renderChips();
    if (auth) await signOut(auth);
    toast('Signed out');
  } catch (e) {
    console.warn('sync sign-out', e);
  }
}

function bindSession(user) {
  if (session) { session.stop(); session = null; }
  if (!user || !adapter || !db) return;
  session = createSyncSession({
    store: firestoreStore(user.uid),
    getState: () => adapter.getState(),
    applyState: (state) => adapter.applyState(state),
    confirm: (msg) => (adapter.confirm || window.confirm)(msg),
    debounceMs: 400
  });
  session.start().then(() => {
    toast('Account synced');
  }).catch((e) => {
    console.warn('sync start', e);
    toast('Cloud sync failed. This device still works offline.');
  });
}

function connect(next) {
  adapter = next || adapter;
  if (currentUser && adapter && !session) bindSession(currentUser);
}

function notifyLocalChange() {
  if (session) session.notifyLocalChange();
}

async function initFirebase() {
  app = initializeApp(firebaseConfig);
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    db = getFirestore(app);
  }
  auth = getAuth(app);
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      /* onAuthStateChanged will pick this up */
    }
  } catch (e) {
    const code = (e && e.code) || '';
    if (code !== 'auth/popup-closed-by-user') {
      console.warn('sync redirect result', e);
      toast('Google sign-in failed.');
    }
  }
  unsubAuth = onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    renderChips();
    if (user) bindSession(user);
    else {
      if (session) { session.stop(); session = null; }
    }
  });
}

function boot() {
  if (started) return;
  started = true;
  renderChips();
  initFirebase().catch((e) => {
    initError = e;
    console.warn('sync init', e);
    renderChips();
  });
  window.addEventListener('pagehide', () => { if (session) session.flush().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session) session.flush().catch(() => {});
  });
}

window.TradingDeskSync = api;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
window.dispatchEvent(new Event('td-sync-ready'));
