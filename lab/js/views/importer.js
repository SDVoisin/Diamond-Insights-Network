// Import Trackman / bat-sensor CSVs, review sessions, delete or relabel them.

import { h, card, table, toast, select, confirmDialog } from '../util.js';
import { state, db, deleteSession } from '../store.js';
import { ingest, playersFrom } from '../trackman.js';
import { pageHeader, refresh, playerName, navigate } from '../app.js';

const TYPES = [['auto', 'Auto-detect'], ['bullpen', 'Bullpen'], ['live', 'Live ABs'], ['game', 'Game'], ['bp', 'Batting practice'], ['cage', 'Cage / sensor']];
const opts = { sessionType: 'auto', label: '', level: '', defaultBatter: '' };

export async function importFiles(files, o = opts, { reload = true } = {}) {
  let nP = 0, nS = 0;
  const errors = [];
  for (const f of files) {
    try {
      const text = await f.text();
      const r = ingest(text, { fileName: f.name, sessionType: o.sessionType, label: o.label || null, level: o.level || null, defaultBatter: o.defaultBatter || null });
      // Swing-sensor exports carry no player column; refuse rather than invent one.
      if (r.source === 'swing-sensor' && !r.pitches.some((p) => p.batterKey)) throw new Error('pick the hitter for sensor files');
      await db.putMany('pitches', r.pitches);
      await db.putMany('sessions', r.sessions);
      if (r.targets.length) await db.putMany('targets', r.targets.filter((t) => !state.targets.has(t.uid) || state.targets.get(t.uid).src !== 'coach'));
      const existing = new Map(state.players.map((p) => [p.id, p]));
      const merged = playersFrom(r.pitches).map((p) => {
        const e = existing.get(p.id);
        return e ? { ...p, ...e, roles: [...new Set([...(e.roles || []), ...p.roles])], throws: e.throws || p.throws, bats: e.bats || p.bats } : { ...p, createdAt: new Date().toISOString() };
      });
      await db.putMany('players', merged);
      // keep state.players current within a multi-file import
      for (const p of merged) { const i = state.players.findIndex((x) => x.id === p.id); if (i >= 0) state.players[i] = p; else state.players.push(p); }
      nP += r.pitches.length; nS += r.sessions.length;
    } catch (e) {
      errors.push(`${f.name}: ${e.message}`);
    }
  }
  if (reload) await refresh();
  return { nP, nS, errors };
}

export async function loadDemo() {
  const base = new URL('../../sample/', import.meta.url);
  const idx = await (await fetch(new URL('index.json', base))).json();
  let total = 0;
  for (const f of idx.files) {
    const text = await (await fetch(new URL(f.file, base))).text();
    const file = new File([text], f.file, { type: 'text/csv' });
    const r = await importFiles([file], { sessionType: f.type, label: null, level: 'Demo', defaultBatter: f.batter || '' }, { reload: false });
    total += r.nP;
  }
  await refresh();
  return total;
}

export default function importer(root, { rerender }) {
  root.appendChild(pageHeader('Import Data', 'Drop Trackman CSV exports (bullpens, live ABs, games, BP) or Blast/bat-sensor exports.'));

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, class: 'hidden' });
  const run = async (files) => {
    if (!files.length) return;
    toast(`Importing ${files.length} file(s)…`);
    const r = await importFiles([...files]);
    if (r.errors.length) r.errors.forEach((e) => toast(e, 'error'));
    if (r.nP) toast(`Imported ${r.nP} rows across ${r.nS} session(s)`, 'ok');
  };
  fileInput.onchange = () => run(fileInput.files);
  const drop = h('div', {
    class: 'dropzone',
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); run(e.dataTransfer.files); },
  },
  h('p', null, h('b', null, 'Drag CSV files here'), ' or ', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => fileInput.click() }, 'choose files')),
  h('p', { class: 'small muted' }, 'Re-importing the same file updates rows instead of duplicating them. Data stays on this computer until you export it.'),
  fileInput);

  const hitters = state.players.filter((p) => p.roles?.includes('H'));
  root.appendChild(h('div', { class: 'grid g2' },
    card('1 · Session details (applied to the next import)',
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, 'Session type'), select(TYPES, opts.sessionType, (v) => { opts.sessionType = v; })),
        h('label', { class: 'field' }, h('span', null, 'Label (optional)'), h('input', { type: 'text', value: opts.label, placeholder: 'e.g. Pitch design day', oninput: (e) => { opts.label = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, 'Level / group'), h('input', { type: 'text', value: opts.level, placeholder: 'e.g. 17U, Showcase, College', oninput: (e) => { opts.level = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, 'Hitter for sensor files'),
          h('input', { type: 'text', list: 'hitter-list', value: opts.defaultBatter, placeholder: 'Last, First', oninput: (e) => { opts.defaultBatter = e.target.value; } }),
          h('datalist', { id: 'hitter-list' }, hitters.map((p) => h('option', { value: p.name })))))),
    card('2 · Files', drop)));

  if (!state.sessions.length) {
    root.appendChild(card('No data yet',
      h('p', null, 'Want to look around first? Load ten weeks of demo bullpens, live ABs, BP and Blast sessions for three pitchers and three hitters.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Loading…'; try { const n = await loadDemo(); toast(`Demo data loaded: ${n} rows`, 'ok'); navigate('dashboard'); } catch (err) { toast('Demo load failed: ' + err.message, 'error'); e.target.disabled = false; } } }, 'Load demo data')));
    return;
  }

  root.appendChild(card(`Sessions (${state.sessions.length})`, table([
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type', fmt: (v, s) => select(TYPES.slice(1), v, async (nv) => { s.type = nv; await db.put('sessions', s); const ps = state.pitches.filter((p) => p.sessionId === s.id); ps.forEach((p) => { p.sessionType = nv; }); await db.putMany('pitches', ps.map(({ stuff, spinEff, ...p }) => p)); toast('Session type updated', 'ok'); }) },
    { key: 'label', label: 'Label', fmt: (v, s) => h('input', { type: 'text', value: v || '', style: { width: '140px' }, onchange: async (e) => { s.label = e.target.value; await db.put('sessions', s); } }) },
    { key: 'count', label: 'Rows', num: true },
    { key: 'pitchers', label: 'Pitchers', fmt: (v) => (v || []).map(playerName).join(', ') },
    { key: 'batters', label: 'Hitters', fmt: (v) => { const n = (v || []).map(playerName); return n.length > 3 ? `${n.slice(0, 3).join(', ')} +${n.length - 3}` : n.join(', '); } },
    { key: 'id', label: 'Video', num: true, fmt: (id) => String(state.videos.filter((x) => x.sessionId === id).length) },
    { key: 'fileName', label: 'File', fmt: (v) => h('span', { class: 'mono' }, v || '') },
    { key: 'id', label: '', fmt: (id) => h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete this session, its pitches, targets and clip links?')) { await deleteSession(id); await refresh(); } } }, 'Delete') },
  ], state.sessions)));
}
