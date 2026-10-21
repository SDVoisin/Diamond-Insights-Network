// Session Logger: an iPad-first screen for logging reps live when Trackman
// CSVs aren't available. Staff read velo/spin/break off the Trackman app or a
// Pocket Radar, tap target + location (and spray for hitters), and each rep is
// stamped with the wall-clock time so it lines up with the session's video.

import { h, card, table, toast, fmt, isNum, select, todayISO, displayName, playerIdFromName, hashId, confirmDialog } from '../util.js';
import { state, db, saveSetting } from '../store.js';
import { pageHeader, navigate } from '../app.js';
import { derive, missInches, inZone } from '../metrics.js';
import { PITCH_TYPES, fmtClock, isSwing } from '../trackman.js';
import { zonePad, sprayPad } from '../pads.js';
import { pitchColor } from '../charts.js';

const LOG_TYPES = ['FF', 'SI', 'CT', 'SL', 'SW', 'CB', 'CH', 'SP'];
const CALLS = [['Ball', 'Ball'], ['CalledStrike', 'Called K'], ['Whiff', 'Whiff'], ['Foul', 'Foul'], ['InPlay', 'In play']];
const SESSION_TYPES = [['bullpen', 'Bullpen'], ['live', 'Live ABs'], ['bp', 'Batting practice'], ['cage', 'Cage / tee / front toss'], ['game', 'Game']];
const PITCH_FIELDS = [['velo', 'Velo', 'mph'], ['spin', 'Spin', 'rpm'], ['ivb', 'IVB', 'in'], ['hb', 'HB', 'in'], ['ext', 'Ext', 'ft']];
const HIT_FIELDS = [['ev', 'Exit velo', 'mph'], ['la', 'Launch angle', '°'], ['batSpeed', 'Bat speed', 'mph'], ['dist', 'Distance', 'ft']];

// The rep being built. Reset after every save except the sticky choices.
const rep = { pitcher: '', hitter: '', type: 'FF', target: null, loc: null, call: '', timingTag: '', spray: null, fields: {}, keepTarget: false };
let padMode = 'target';

const secOfDay = (d) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
const SEC = (s) => state.sessions.find((x) => x.id === s);

export default function logger(root, { rerender }) {
  root.appendChild(pageHeader('Session Logger', 'Log every rep live from the iPad. No Trackman export needed.'));
  const active = SEC(state.settings.loggerSession);
  if (!active) { root.appendChild(startForm(rerender)); recentLogged(root); return; }
  logScreen(root, active, rerender);
}

function startForm(rerender) {
  const f = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const date = d.get('date') || todayISO();
    const type = d.get('type');
    const s = {
      id: 's-' + hashId(`logger|${date}|${type}|${Date.now()}`), date, type, source: 'logger',
      label: d.get('label') || null, level: d.get('level') || null, pitchers: [], batters: [], count: 0,
      importedAt: new Date().toISOString(),
    };
    await db.put('sessions', s);
    state.sessions.unshift(s);
    await saveSetting('loggerSession', s.id);
    rerender();
  } },
  h('label', { class: 'field' }, h('span', null, 'Session type'), h('select', { name: 'type', id: 'log-type' }, SESSION_TYPES.map(([v, l]) => h('option', { value: v }, l)))),
  h('label', { class: 'field' }, h('span', null, 'Date'), h('input', { type: 'date', name: 'date', id: 'log-date', value: todayISO() })),
  h('label', { class: 'field' }, h('span', null, 'Label (optional)'), h('input', { type: 'text', name: 'label', id: 'log-label', placeholder: 'e.g. Pitch design day, 17U bullpens' })),
  h('label', { class: 'field' }, h('span', null, 'Group / level'), h('input', { type: 'text', name: 'level', id: 'log-level', placeholder: 'e.g. 17U, College' })),
  h('div', { class: 'btn-row full' }, h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Start session')));
  return h('div', { class: 'grid g2' },
    card('Start a session', f, h('p', { class: 'card-note' }, 'Start the cameras first. Each rep is timestamped when you press Save, so clips line up in the Video Room without Trackman files.')),
    card('How staff use it',
      h('ol', { class: 'small' },
        h('li', null, 'Pick the pitcher (and hitter for live ABs / BP).'),
        h('li', null, 'Tap the pitch type, then tap the catcher\'s target and where the pitch crossed.'),
        h('li', null, 'Type velo from the Pocket Radar or the Trackman iPad screen. Spin, IVB and HB are optional.'),
        h('li', null, 'For hitters: result, exit velo / launch angle if you have them, tap the spray spot and call the timing.'),
        h('li', null, 'Press Save rep. Everything feeds the Pitching Lab, Hitting Lab, dashboard and Video Room.'))));
}

function recentLogged(root) {
  const mine = state.sessions.filter((s) => s.source === 'logger').slice(0, 8);
  if (!mine.length) return;
  root.appendChild(card('Recent logged sessions', table([
    { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'label', label: 'Label' },
    { key: 'id', label: 'Reps', num: true, fmt: (id) => String(state.pitches.filter((p) => p.sessionId === id).length) },
    { key: 'id', label: '', fmt: (id) => h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => { e.stopPropagation(); await saveSetting('loggerSession', id); navigate('log'); } }, 'Resume') },
  ], mine)));
}

function rosterOptions(role) {
  return state.players.filter((p) => !p.archived && !p.nonPlayer && (p.roles || []).includes(role)).sort((a, b) => a.name.localeCompare(b.name));
}

async function ensurePlayer(name, role, hand) {
  const id = playerIdFromName(name);
  let p = state.players.find((x) => x.id === id);
  if (!p) {
    p = { id, name: displayName(name), roles: [role], createdAt: new Date().toISOString() };
    if (hand) p[role === 'P' ? 'throws' : 'bats'] = hand;
    state.players.push(p);
    await db.put('players', p);
  } else if (!(p.roles || []).includes(role)) {
    p.roles = [...(p.roles || []), role];
    await db.put('players', p);
  }
  return p;
}

function playerPicker(role, value, onChange, rerender) {
  const list = rosterOptions(role);
  const input = h('input', { type: 'text', id: `log-new-${role}`, placeholder: 'New player: Last, First', style: { minWidth: '0', flex: '1' } });
  const hand = select([['R', role === 'P' ? 'RHP' : 'RHH'], ['L', role === 'P' ? 'LHP' : 'LHH']], 'R', () => {}, { 'aria-label': 'Handedness', id: `log-hand-${role}` });
  return h('div', { class: 'field' },
    h('span', null, role === 'P' ? 'Pitcher' : 'Hitter'),
    h('div', { class: 'chips' },
      role === 'P' ? null : h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!value), onclick: () => onChange('') }, 'None'),
      list.map((p) => h('button', { class: 'chip chip-lg', type: 'button', 'aria-pressed': String(value === p.id), onclick: () => onChange(p.id) }, p.name))),
    h('div', { class: 'btn-row', style: { marginTop: '6px' } }, input, hand,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
        if (!input.value.trim()) return;
        const p = await ensurePlayer(input.value.trim(), role, hand.value);
        onChange(p.id);
        rerender();
      } }, 'Add')));
}

function logScreen(root, session, rerender) {
  const reps = state.pitches.filter((p) => p.sessionId === session.id).sort((a, b) => (b.tod ?? 0) - (a.tod ?? 0));
  // BP and cage work log the hitter only; bullpens, live ABs and games log the pitch.
  const pitchingMode = ['bullpen', 'live', 'game'].includes(session.type);
  const hittingMode = session.type !== 'bullpen';
  const needsCall = session.type === 'live' || session.type === 'game';
  if (!pitchingMode) rep.pitcher = '';

  root.appendChild(h('div', { class: 'filters' },
    h('div', null, h('b', null, `${session.date} · ${SESSION_TYPES.find(([v]) => v === session.type)?.[1] || session.type}`), session.label ? ` · ${session.label}` : '',
      h('div', { class: 'small muted' }, `${reps.length} reps logged`)),
    h('div', { class: 'btn-row', style: { marginLeft: 'auto' } },
      h('button', { class: 'btn', type: 'button', onclick: () => navigate(`video/${session.id}`) }, '▶ Session video'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await saveSetting('loggerSession', null); toast('Session closed. It stays in the labs and Video Room.', 'ok'); rerender(); } }, 'End session'))));

  // ---------- who ----------
  const who = card('Players',
    pitchingMode ? playerPicker('P', rep.pitcher, (v) => { rep.pitcher = v; rerender(); }, rerender) : null,
    hittingMode ? playerPicker('H', rep.hitter, (v) => { rep.hitter = v; rerender(); }, rerender) : null);

  // ---------- pitch ----------
  const fieldInput = (k, label, unit) => h('label', { class: 'field' }, h('span', null, `${label} (${unit})`),
    h('input', { type: 'number', inputmode: 'decimal', step: 'any', id: `log-f-${k}`, value: rep.fields[k] ?? '', class: 'num-input', oninput: (e) => { rep.fields[k] = e.target.value; } }));

  const marks = [];
  if (rep.target) marks.push({ ...rep.target, kind: 'target' });
  if (rep.loc) marks.push({ ...rep.loc, kind: 'pitch', color: pitchColor(rep.type) });
  const pitchCard = pitchingMode ? card('Pitch',
    h('div', { class: 'chips' }, LOG_TYPES.map((t) => h('button', {
      class: 'chip chip-lg', type: 'button', 'aria-pressed': String(rep.type === t), onclick: () => { rep.type = t; rerender(); },
    }, h('i', { class: 'dot', style: { background: pitchColor(t) } }), PITCH_TYPES[t]))),
    h('div', { class: 'log-pad-row' },
      h('div', null,
        h('div', { class: 'btn-row', style: { marginBottom: '6px' } },
          h('button', { class: 'chip', type: 'button', 'aria-pressed': String(padMode === 'target'), onclick: () => { padMode = 'target'; rerender(); } }, '◎ Tap target'),
          h('button', { class: 'chip', type: 'button', 'aria-pressed': String(padMode === 'loc'), onclick: () => { padMode = 'loc'; rerender(); } }, '● Tap location'),
          h('label', { class: 'small' }, h('input', { type: 'checkbox', id: 'log-keep-target', checked: rep.keepTarget, onchange: (e) => { rep.keepTarget = e.target.checked; } }), ' Keep target')),
        zonePad(marks, (x, z) => {
          if (padMode === 'target') { rep.target = { x, z }; padMode = 'loc'; } else rep.loc = { x, z };
          rerender();
        }),
        rep.target && rep.loc ? h('div', { class: 'small', style: { marginTop: '4px' } }, `Miss ${fmt(missInches({ plateX: rep.loc.x, plateZ: rep.loc.z }, rep.target), 1)}″`) : null),
      h('div', { class: 'log-fields' }, PITCH_FIELDS.map(([k, l, u]) => fieldInput(k, l, u)),
        needsCall ? h('div', { class: 'field' }, h('span', null, 'Result'), h('div', { class: 'chips' }, CALLS.map(([v, l]) =>
          h('button', { class: 'chip chip-lg', type: 'button', 'aria-pressed': String(rep.call === v), onclick: () => { rep.call = rep.call === v ? '' : v; rerender(); } }, l)))) : null))) : null;

  // ---------- hit ----------
  const showHit = hittingMode && (rep.hitter || !pitchingMode) && (!needsCall || rep.call === 'InPlay');
  const hitCard = showHit ? card('Batted ball / swing',
    h('div', { class: 'log-pad-row' },
      h('div', null, h('div', { class: 'small muted', style: { marginBottom: '6px' } }, 'Tap where the ball landed'), sprayPad(rep.spray, (dir, dist) => { rep.spray = { dir, dist }; rerender(); }),
        rep.spray ? h('div', { class: 'small' }, `${rep.spray.dir > 0 ? 'Right side' : 'Left side'} ${Math.abs(rep.spray.dir)}° · ~${rep.spray.dist} ft`) : null),
      h('div', { class: 'log-fields' }, HIT_FIELDS.map(([k, l, u]) => fieldInput(k, l, u)),
        h('div', { class: 'field' }, h('span', null, 'Timing (coach call)'), h('div', { class: 'chips' }, ['Early', 'On time', 'Late'].map((t) =>
          h('button', { class: 'chip chip-lg', type: 'button', 'aria-pressed': String(rep.timingTag === t), onclick: () => { rep.timingTag = rep.timingTag === t ? '' : t; rerender(); } }, t))))))) : null;

  // ---------- save ----------
  const save = async () => {
    if (pitchingMode && !rep.pitcher) { toast('Pick the pitcher first', 'error'); return; }
    if (!pitchingMode && !rep.hitter) { toast('Pick the hitter first', 'error'); return; }
    const hasData = rep.loc || rep.call || rep.spray || rep.timingTag || Object.values(rep.fields).some((v) => v !== '' && v !== undefined);
    if (!hasData) { toast('Nothing to save yet: tap a location, enter a number or pick a result', 'error'); return; }
    const now = new Date();
    const tod = secOfDay(now);
    const num = (k) => { const v = parseFloat(rep.fields[k]); return Number.isFinite(v) ? v : undefined; };
    const pitcher = state.players.find((p) => p.id === rep.pitcher);
    const hitter = state.players.find((p) => p.id === rep.hitter);
    const p = {
      uid: `${session.id}-L${now.getTime()}`, sessionId: session.id, sessionType: session.type, date: session.date,
      time: fmtClock(tod), tod, pitchNo: reps.length + 1, source: 'logger', kind: pitchingMode ? 'pitch' : 'swing',
    };
    if (pitchingMode) {
      Object.assign(p, { pitcherKey: pitcher.id, pitcherName: pitcher.name, throws: pitcher.throws, pitchType: rep.type });
      for (const k of ['velo', 'spin', 'ivb', 'hb', 'ext']) if (num(k) !== undefined) p[k] = num(k);
      if (rep.loc) { p.plateX = rep.loc.x; p.plateZ = rep.loc.z; }
      if (needsCall && rep.call) p.call = rep.call;
    }
    if (hitter) Object.assign(p, { batterKey: hitter.id, batterName: hitter.name, bats: hitter.bats });
    if (showHit) {
      for (const k of ['ev', 'la', 'batSpeed', 'dist']) if (num(k) !== undefined) p[k] = num(k);
      if (rep.spray) { p.dir = rep.spray.dir; if (p.dist === undefined) p.dist = rep.spray.dist; }
      if (rep.timingTag) p.timingTag = rep.timingTag;
      if (!p.call && (session.type === 'bp' || session.type === 'cage') && (isNum(p.ev) || rep.spray)) p.call = 'InPlay';
    }
    await db.put('pitches', p);
    state.pitches.push(p);
    if (rep.target && pitchingMode) {
      const t = { uid: p.uid, x: rep.target.x, z: rep.target.z, src: 'logger' };
      await db.put('targets', t);
      state.targets.set(p.uid, t);
    }
    if (p.pitcherKey && !session.pitchers.includes(p.pitcherKey)) session.pitchers.push(p.pitcherKey);
    if (p.batterKey && !session.batters.includes(p.batterKey)) session.batters.push(p.batterKey);
    session.count = reps.length + 1;
    await db.put('sessions', session);
    derive(state.pitches.filter((x) => x.pitcherKey && x.pitcherKey === p.pitcherKey && x.date === p.date));
    // reset per-rep inputs, keep who/type (and target if asked)
    rep.loc = null; rep.call = ''; rep.timingTag = ''; rep.spray = null; rep.fields = {};
    if (!rep.keepTarget) rep.target = null;
    padMode = rep.target ? 'loc' : 'target';
    toast(`Rep ${p.pitchNo} saved · ${fmtClock(tod).slice(0, 8)}`, 'ok');
    rerender();
  };

  root.appendChild(h('div', { class: 'grid', style: { gap: '12px' } }, who, pitchCard, hitCard,
    h('div', { class: 'save-bar' },
      h('button', { class: 'btn btn-primary btn-xl', type: 'button', onclick: save }, 'Save rep'),
      h('button', { class: 'btn btn-lg', type: 'button', onclick: () => { rep.loc = null; rep.target = null; rep.call = ''; rep.timingTag = ''; rep.spray = null; rep.fields = {}; padMode = 'target'; rerender(); } }, 'Clear'))));

  // ---------- log ----------
  root.appendChild(card(`This session (${reps.length})`, reps.length ? table([
    { key: 'pitchNo', label: '#', num: true },
    { key: 'time', label: 'Time', fmt: (v) => (v || '').slice(0, 8) },
    { key: 'pitcherName', label: 'Pitcher' },
    { key: 'pitchType', label: 'Pitch', fmt: (t) => PITCH_TYPES[t] || '' },
    { key: 'velo', label: 'Velo', num: true, fmt: (v) => fmt(v) },
    { key: 'uid', label: 'Miss', num: true, fmt: (u, p) => fmt(missInches(p, state.targets.get(u)), 1) },
    { key: 'plateX', label: 'Zone', fmt: (v, p) => (isNum(v) ? (inZone(p) ? 'In' : 'Out') : '') },
    { key: 'call', label: 'Result', fmt: (v) => (v ? (isSwing(v) ? `${v} (swing)` : v) : '') },
    { key: 'batterName', label: 'Hitter' },
    { key: 'ev', label: 'EV', num: true, fmt: (v) => fmt(v) },
    { key: 'timingTag', label: 'Timing' },
    { key: 'uid', label: '', fmt: (u) => h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Delete this rep?'))) return;
      await db.del('pitches', u); await db.del('targets', u);
      state.pitches = state.pitches.filter((x) => x.uid !== u); state.targets.delete(u);
      session.count = Math.max(0, (session.count || 1) - 1); await db.put('sessions', session);
      rerender();
    } }, 'Delete') },
  ].filter((c) => c.key === 'uid' || c.key === 'pitchNo' || c.key === 'time' || reps.some((p) => p[c.key] !== undefined && p[c.key] !== '')), reps, { compact: true }) : h('p', { class: 'muted' }, 'No reps yet. The first saved rep shows up here.')));
}
