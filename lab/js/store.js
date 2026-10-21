// IndexedDB persistence. Everything lives in the browser of the machine
// running the lab; Export/Import JSON moves data between machines and staff.

const DB_NAME = 'di-player-dev-lab';
const DB_VERSION = 2;

export const STORES = {
  players: 'id',
  sessions: 'id',
  pitches: 'uid',     // Trackman pitches + swing-sensor rows
  targets: 'uid',     // intended command target per pitch
  videos: 'id',       // clip registry (camera, sync offset, file handle)
  goals: 'id',        // development goals
  notes: 'id',        // coach notes per player/session
  mechanics: 'id',    // video mechanics analyses: keyframes, angles, notes
  settings: 'key',
};

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const os = db.createObjectStore(name, { keyPath });
          if (name === 'pitches') {
            os.createIndex('sessionId', 'sessionId');
          }
          if (name === 'videos') os.createIndex('sessionId', 'sessionId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export const db = {
  all: (store) => tx(store, 'readonly', (os) => reqP(os.getAll())),
  get: (store, key) => tx(store, 'readonly', (os) => reqP(os.get(key))),
  put: (store, value) => tx(store, 'readwrite', (os) => { os.put(value); }),
  putMany: (store, values) => tx(store, 'readwrite', (os) => { for (const v of values) os.put(v); }),
  del: (store, key) => tx(store, 'readwrite', (os) => { os.delete(key); }),
  delMany: (store, keys) => tx(store, 'readwrite', (os) => { for (const k of keys) os.delete(k); }),
  clear: (store) => tx(store, 'readwrite', (os) => { os.clear(); }),
};

// In-memory cache of the whole dataset. A club's season of Trackman data is
// tens of thousands of rows, which is comfortably in memory, and every view
// filters the same arrays.
export const state = {
  players: [], sessions: [], pitches: [], targets: new Map(), videos: [], goals: [], notes: [], mechanics: [],
  settings: {},
  loaded: false,
};

export async function loadAll() {
  const [players, sessions, pitches, targets, videos, goals, notes, settings, mechanics] = await Promise.all(
    ['players', 'sessions', 'pitches', 'targets', 'videos', 'goals', 'notes', 'settings', 'mechanics'].map((s) => db.all(s)));
  Object.assign(state, { players, sessions, pitches, videos, goals, notes, mechanics });
  state.targets = new Map(targets.map((t) => [t.uid, t]));
  state.settings = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  state.sessions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  state.loaded = true;
  return state;
}

export async function saveSetting(key, value) {
  state.settings[key] = value;
  await db.put('settings', { key, value });
}

export async function exportAll() {
  const out = { format: 'di-player-dev-lab', version: 1, exportedAt: new Date().toISOString() };
  for (const s of Object.keys(STORES)) {
    let rows = await db.all(s);
    // File handles can't be serialised; the receiving machine re-links clips.
    if (s === 'videos') rows = rows.map(({ handle, ...rest }) => rest);
    out[s] = rows;
  }
  return out;
}

export async function importAll(data) {
  if (!data || data.format !== 'di-player-dev-lab') throw new Error('Not a Player Dev Lab export file');
  for (const s of Object.keys(STORES)) {
    if (Array.isArray(data[s]) && data[s].length) await db.putMany(s, data[s]);
  }
  await loadAll();
}

export async function deleteSession(id) {
  const uids = state.pitches.filter((p) => p.sessionId === id).map((p) => p.uid);
  await db.delMany('pitches', uids);
  await db.delMany('targets', uids.filter((u) => state.targets.has(u)));
  await db.delMany('videos', state.videos.filter((v) => v.sessionId === id).map((v) => v.id));
  await db.del('sessions', id);
  await loadAll();
}

export async function wipeAll() {
  for (const s of Object.keys(STORES)) await db.clear(s);
  await loadAll();
}
