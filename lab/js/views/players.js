// Roster + player profile: bio, development goals, notes timeline, tagged reps.

import { h, card, table, stat, empty, fmt, pct, isNum, toast, todayISO, select, addDays, confirmDialog } from '../util.js';
import { state, db } from '../store.js';
import { pageHeader, navigate, filters, refresh } from '../app.js';
import { PITCH_METRICS, HIT_METRICS, hittingSummary, arsenal } from '../metrics.js';
import { PITCH_TYPES, PITCH_ORDER } from '../trackman.js';

let search = '';
let roleFilter = '';

export default function players(root, { params, rerender }) {
  if (params[0]) return profile(root, params[0], rerender);
  root.appendChild(pageHeader('Players', 'Roster, bios and development plans.'));
  if (!state.players.length) { root.appendChild(empty('Players are created automatically from imported Trackman / sensor files.', h('a', { class: 'btn btn-primary', href: '#/import' }, 'Import data'))); return; }

  const counts = new Map();
  const last = new Map();
  for (const p of state.pitches) for (const k of [p.pitcherKey, p.batterKey]) if (k) { counts.set(k, (counts.get(k) || 0) + 1); if (!last.has(k) || p.date > last.get(k)) last.set(k, p.date); }
  const list = state.players
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .filter((p) => !roleFilter || (roleFilter === 'archived' ? p.archived || p.nonPlayer : p.roles?.includes(roleFilter) && !p.archived && !p.nonPlayer))
    .sort((a, b) => a.name.localeCompare(b.name));

  root.appendChild(h('div', { class: 'filters' },
    h('label', { class: 'field' }, h('span', null, 'Search'), h('input', { type: 'search', value: search, placeholder: 'Name…', oninput: (e) => { search = e.target.value; clearTimeout(players.t); players.t = setTimeout(rerender, 250); } })),
    h('label', { class: 'field' }, h('span', null, 'Role'), select([['', 'Everyone'], ['P', 'Pitchers'], ['H', 'Hitters'], ['archived', 'Archived / non-players']], roleFilter, (v) => { roleFilter = v; rerender(); }))));

  root.appendChild(card(`Roster (${list.length})`, table([
    { key: 'name', label: 'Name' },
    { key: 'roles', label: 'Role', fmt: (r) => (r || []).map((x) => (x === 'P' ? 'Pitcher' : 'Hitter')).join(' / ') },
    { key: 'throws', label: 'T', fmt: (v) => v || '' },
    { key: 'bats', label: 'B', fmt: (v) => v || '' },
    { key: 'position', label: 'Pos', fmt: (v) => v || '' },
    { key: 'gradYear', label: 'Grad', fmt: (v) => v || '' },
    { key: 'team', label: 'Team / level', fmt: (v, p) => [v, p.level].filter(Boolean).join(' · ') },
    { key: 'id', label: 'Rows', num: true, fmt: (id) => String(counts.get(id) || 0) },
    { key: 'id', label: 'Last seen', fmt: (id) => last.get(id) || '' },
    { key: 'id', label: 'Goals', num: true, fmt: (id) => String(state.goals.filter((g) => g.playerId === id).length) },
  ], list, { onRowClick: (p) => navigate(`players/${encodeURIComponent(p.id)}`) })));
}

function profile(root, id, rerender) {
  const p = state.players.find((x) => x.id === id);
  if (!p) { root.appendChild(empty('Player not found.')); return; }
  const asP = state.pitches.filter((x) => x.pitcherKey === id && x.kind === 'pitch');
  const asH = state.pitches.filter((x) => x.batterKey === id);
  root.appendChild(pageHeader(p.name, [p.roles?.map((r) => (r === 'P' ? 'Pitcher' : 'Hitter')).join(' / '), p.throws && `Throws ${p.throws}`, p.bats && `Bats ${p.bats}`, p.gradYear && `Class of ${p.gradYear}`].filter(Boolean).join(' · '),
    h('div', { class: 'btn-row' },
      asP.length ? h('button', { class: 'btn', type: 'button', onclick: () => { filters.pitcher = id; navigate('pitching'); } }, 'Pitching Lab') : null,
      asH.length ? h('button', { class: 'btn', type: 'button', onclick: () => { filters.hitter = id; navigate('hitting'); } }, 'Hitting Lab') : null,
      h('a', { class: 'btn btn-ghost', href: '#/players' }, '← Roster'))));

  const stats = [];
  if (asP.length) {
    const { rows, fb } = arsenal(asP.filter((x) => x.date >= recentStart(asP)), state.targets);
    stats.push(stat('FB velo (30 d)', fmt(fb?.velo, 1, ' mph'), `max ${fmt(Math.max(...rows.filter((r) => r.type === fb?.type).map((r) => r.veloMax)), 1)}`));
    stats.push(stat('Arsenal', rows.map((r) => r.type).join(' · ') || '—', `${asP.length} pitches tracked`));
  }
  if (asH.length) {
    const s = hittingSummary(asH.filter((x) => x.date >= recentStart(asH)));
    stats.push(stat('EV90 (30 d)', fmt(s.ev90, 1, ' mph'), `max ${fmt(s.evMax, 1)}`));
    stats.push(stat('Bat speed (30 d)', fmt(s.batSpeed, 1, ' mph'), `hard-hit ${pct(s.hardHit)}`));
  }
  if (stats.length) root.appendChild(h('div', { class: 'stats' }, stats));

  // Bio form
  const bio = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    for (const k of ['name', 'throws', 'bats', 'position', 'gradYear', 'team', 'level', 'height', 'weight', 'email', 'program']) p[k] = (f.get(k) || '').toString().trim() || undefined;
    p.archived = f.get('archived') === 'on';
    p.nonPlayer = f.get('nonPlayer') === 'on';
    const roles = [];
    if (f.get('roleP') === 'on') roles.push('P');
    if (f.get('roleH') === 'on') roles.push('H');
    p.roles = roles;
    await db.put('players', p);
    toast('Player saved', 'ok');
    rerender();
  } },
  field('Name', 'name', p.name), field('Position', 'position', p.position, 'e.g. RHP, SS/RHP'),
  h('label', { class: 'field' }, h('span', null, 'Throws'), select([['', '—'], ['R', 'Right'], ['L', 'Left']], p.throws || '', () => {}, { name: 'throws' })),
  h('label', { class: 'field' }, h('span', null, 'Bats'), select([['', '—'], ['R', 'Right'], ['L', 'Left'], ['S', 'Switch']], p.bats || '', () => {}, { name: 'bats' })),
  field('Grad year', 'gradYear', p.gradYear), field('Team', 'team', p.team), field('Level / group', 'level', p.level), field('Program', 'program', p.program, 'e.g. Velo block, Pitch design, Bat speed'),
  field('Height', 'height', p.height), field('Weight', 'weight', p.weight), field('Contact', 'email', p.email, 'Email / phone', 'full'),
  h('div', { class: 'btn-row full' },
    h('label', null, h('input', { type: 'checkbox', name: 'roleP', checked: p.roles?.includes('P') }), ' Pitcher'),
    h('label', null, h('input', { type: 'checkbox', name: 'roleH', checked: p.roles?.includes('H') }), ' Hitter'),
    h('label', null, h('input', { type: 'checkbox', name: 'archived', checked: p.archived }), ' Archived'),
    h('label', null, h('input', { type: 'checkbox', name: 'nonPlayer', checked: p.nonPlayer }), ' Not a player (machine / coach)')),
  h('div', { class: 'btn-row full' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile')));

  // Goals
  const goals = state.goals.filter((g) => g.playerId === id);
  const metricOpts = [
    ...(asP.length || p.roles?.includes('P') ? Object.entries(PITCH_METRICS).map(([k, m]) => [k, `Pitching · ${m.label}`]) : []),
    ...(asH.length || p.roles?.includes('H') ? Object.entries(HIT_METRICS).map(([k, m]) => [k, `Hitting · ${m.label}`]) : []),
  ];
  const goalForm = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const metric = f.get('metric');
    const m = PITCH_METRICS[metric] || HIT_METRICS[metric];
    const pitchType = f.get('pitchType') || null;
    const target = parseFloat(f.get('target'));
    if (!isNum(target)) { toast('Enter a numeric target', 'error'); return; }
    const role = PITCH_METRICS[metric] ? 'pitcherKey' : 'batterKey';
    const base = m.fn(state.pitches.filter((x) => x[role] === id && (!pitchType || x.pitchType === pitchType) && x.date >= recentStart(state.pitches.filter((y) => y[role] === id)))) * (m.scale || 1);
    const g = { id: 'g-' + Date.now(), playerId: id, metric, pitchType, target, baseline: isNum(base) ? +base.toFixed(2) : null, due: f.get('due') || null, note: f.get('note') || '', createdAt: todayISO() };
    await db.put('goals', g);
    state.goals.push(g);
    toast('Goal added', 'ok');
    rerender();
  } },
  h('label', { class: 'field' }, h('span', null, 'Metric'), h('select', { name: 'metric' }, metricOpts.map(([v, l]) => h('option', { value: v }, l)))),
  h('label', { class: 'field' }, h('span', null, 'Pitch type (pitching)'), h('select', { name: 'pitchType' }, h('option', { value: '' }, 'Any / all'), PITCH_ORDER.filter((t) => t !== 'OT').map((t) => h('option', { value: t }, PITCH_TYPES[t])))),
  h('label', { class: 'field' }, h('span', null, 'Target value'), h('input', { type: 'number', step: 'any', name: 'target', required: true })),
  h('label', { class: 'field' }, h('span', null, 'Due date'), h('input', { type: 'date', name: 'due' })),
  h('label', { class: 'field full' }, h('span', null, 'Plan / notes'), h('input', { type: 'text', name: 'note', placeholder: 'e.g. 6-week velo block: weighted balls 3x/week, pulldowns Fri' })),
  h('div', { class: 'btn-row full' }, h('button', { class: 'btn btn-primary', type: 'submit', disabled: !metricOpts.length }, 'Add goal')));

  root.appendChild(h('div', { class: 'grid g2' },
    card('Profile', bio),
    card('Development goals',
      goals.length ? table([
        { key: 'metric', label: 'Metric', fmt: (k, g) => `${(PITCH_METRICS[k] || HIT_METRICS[k])?.label || k}${g.pitchType ? ' · ' + g.pitchType : ''}` },
        { key: 'baseline', label: 'Baseline', num: true, fmt: (v) => (isNum(v) ? String(v) : '—') },
        { key: 'target', label: 'Target', num: true },
        { key: 'due', label: 'Due' },
        { key: 'note', label: 'Plan' },
        { key: 'id', label: '', fmt: (gid) => h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: async () => { await db.del('goals', gid); state.goals = state.goals.filter((g) => g.id !== gid); rerender(); } }, 'Remove') },
      ], goals) : h('p', { class: 'muted' }, 'No goals yet. Goals draw on the development curves and roll up to the dashboard.'),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' } }),
      goalForm)));

  // Notes timeline + tagged reps
  const notes = state.notes.filter((n) => n.playerId === id && n.text && !n.id.startsWith('rep|')).sort((a, b) => b.id.localeCompare(a.id));
  const reps = state.notes.filter((n) => n.playerId === id && n.id.startsWith('rep|'));
  const sess = new Map(state.sessions.map((s) => [s.id, s]));
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Coach notes timeline', notes.length ? notes.map((n) => h('div', { class: 'alert good' },
      h('div', null, h('b', null, `${sess.get(n.sessionId)?.date || ''} · ${sess.get(n.sessionId)?.label || sess.get(n.sessionId)?.type || ''}`), h('span', { class: 'small' }, n.text)))) : h('p', { class: 'muted' }, 'Notes saved on a session report show up here.')),
    card('Tagged video reps', reps.length ? table([
      { key: 'sessionId', label: 'Date', fmt: (s) => sess.get(s)?.date || '' },
      { key: 'tags', label: 'Tags', fmt: (t) => (t || []).join(', ') },
      { key: 'text', label: 'Note' },
    ], reps, { onRowClick: (n) => navigate(`video/${n.sessionId}`) }) : h('p', { class: 'muted' }, 'Tag reps in the Video Room to build teaching and recruiting reels.'))));

  root.appendChild(h('div', { class: 'btn-row', style: { marginTop: '16px' } },
    h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Remove ${p.name} from the roster? Their Trackman rows stay; re-importing recreates the player.`, 'Remove'))) return;
      await db.del('players', id);
      await refresh();
      navigate('players');
    } }, 'Remove player')));
}

function field(label, name, value, placeholder, cls) {
  return h('label', { class: 'field' + (cls ? ' ' + cls : '') }, h('span', null, label), h('input', { type: 'text', name, value: value || '', placeholder: placeholder || '' }));
}

function recentStart(ps) {
  const latest = ps.reduce((m, p) => (p.date > m ? p.date : m), '');
  return latest ? addDays(latest, -29) : '0000';
}
