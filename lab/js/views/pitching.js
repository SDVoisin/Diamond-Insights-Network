// Pitching Lab: arsenal & pitch design, command development, development
// curves, and a per-session report for the pitcher.

import { h, card, table, stat, empty, fmt, pct, isNum, toast, groupBy } from '../util.js';
import { state, db, saveSetting } from '../store.js';
import { filters, filterBar, filtered, pageHeader, playerName, navigate } from '../app.js';
import { arsenal, axisToClock, commandSummary, devCurve, PITCH_METRICS, missInches, shapeGap, veloFade, inZone } from '../metrics.js';
import { PITCH_TYPES, PITCH_ORDER, ZONE_TARGETS, fmtClock, pitchClass } from '../trackman.js';
import * as C from '../charts.js';

let tab = 'arsenal';

const typeCell = (t) => h('span', { class: 'type-dot' }, h('i', { style: { background: C.pitchColor(t) } }), PITCH_TYPES[t] || t);

export default function pitching(root, { rerender }) {
  root.appendChild(pageHeader('Pitching Lab', 'Pitch design, command development and velocity tracking from Trackman.'));
  if (!state.pitches.some((p) => p.pitcherKey)) {
    root.appendChild(empty('No pitching data yet. Import Trackman CSVs to get started.', h('a', { class: 'btn btn-primary', href: '#/import' }, 'Import data')));
    return;
  }
  root.appendChild(filterBar('P', rerender));
  const ps = filtered({ role: 'P', playerKey: filters.pitcher, kinds: ['pitch'] });
  const player = state.players.find((p) => p.id === filters.pitcher);

  const tabs = [['arsenal', 'Arsenal & Pitch Design'], ['command', 'Command'], ['dev', 'Development Curves'], ['session', 'Session Report']];
  root.appendChild(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) =>
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; rerender(); } }, label))));

  if (!ps.length) { root.appendChild(empty('No pitches match these filters.')); return; }
  const body = h('div');
  root.appendChild(body);
  ({ arsenal: arsenalTab, command: commandTab, dev: devTab, session: sessionTab })[tab](body, ps, player, rerender);
}

// ---------------- Arsenal & pitch design ----------------
function arsenalTab(root, ps, player, rerender) {
  const { rows, fb } = arsenal(ps, state.targets);
  const top = rows.reduce((a, b) => (b.n > (a?.n || 0) ? b : a), null);
  root.appendChild(h('div', { class: 'stats' },
    stat('Pitches', String(ps.length), `${new Set(ps.map((p) => p.date)).size} sessions`),
    stat('Fastball velo', fmt(fb?.velo, 1, ' mph'), `max ${fmt(Math.max(...ps.filter((p) => pitchClass(p.pitchType) === 'FB').map((p) => p.velo).filter(isNum)), 1)}`),
    stat('Primary FB shape', fb ? `${fmt(fb.ivb, 1)}″ / ${fmt(fb.hb, 1)}″` : '—', 'IVB / HB'),
    stat('Arsenal DI Stuff', fmt(weighted(rows, 'stuff'), 0), 'usage-weighted, 100 = avg'),
    stat('Most used', top ? PITCH_TYPES[top.type] : '—', top ? pct(top.usage) : ''),
  ));

  root.appendChild(card('Arsenal', table([
    { key: 'type', label: 'Pitch', fmt: typeCell },
    { key: 'n', label: '#', num: true },
    { key: 'usage', label: 'Usage', num: true, fmt: (v) => pct(v) },
    { key: 'velo', label: 'Velo', num: true, fmt: (v) => fmt(v) },
    { key: 'veloMax', label: 'Max', num: true, fmt: (v) => fmt(v) },
    { key: 'spin', label: 'Spin', num: true, fmt: (v) => fmt(v, 0) },
    { key: 'axis', label: 'Tilt', num: true, fmt: (v) => axisToClock(v), title: 'Spin axis on a clock face (12:00 = pure backspin)' },
    { key: 'spinEff', label: 'Spin eff.', num: true, fmt: (v) => pct(v), title: 'Trackman 3D spin efficiency, or a movement-based estimate when unavailable' },
    { key: 'ivb', label: 'IVB', num: true, fmt: (v) => fmt(v) },
    { key: 'hb', label: 'HB', num: true, fmt: (v) => fmt(v) },
    { key: 'vaa', label: 'VAA', num: true, fmt: (v) => fmt(v, 2) },
    { key: 'ext', label: 'Ext', num: true, fmt: (v) => fmt(v, 2) },
    { key: 'relH', label: 'Rel H', num: true, fmt: (v) => fmt(v, 2) },
    { key: 'veloDiff', label: 'Δ Velo', num: true, fmt: (v) => fmt(v), title: 'Primary fastball velo minus this pitch' },
    { key: 'stuff', label: 'DI Stuff', num: true, fmt: (v) => fmt(v, 0) },
    { key: 'zonePct', label: 'Zone%', num: true, fmt: (v) => pct(v) },
    { key: 'whiffPct', label: 'Whiff%', num: true, fmt: (v) => pct(v) },
    { key: 'cswPct', label: 'CSW%', num: true, fmt: (v) => pct(v) },
  ], rows), h('p', { class: 'card-note' }, 'DI Stuff grades each pitch on velocity, shape, approach angle, extension and separation from the primary fastball (100 = reference average, 10 = 1 SD). Weights are in lab/js/config.js.')));

  // Pitch design targets saved per pitcher.
  const designKey = `design:${filters.pitcher}`;
  const designTargets = state.settings[designKey] || {};
  const targetList = Object.entries(designTargets).map(([type, t]) => ({ type, ...t }));

  const mv = C.chartBox('square');
  const rel = C.chartBox('square');
  const clock = C.chartBox('square');
  root.appendChild(h('div', { class: 'grid g3', style: { marginTop: '16px' } },
    card('Movement profile (pitcher view)', mv, h('p', { class: 'card-note' }, 'Big markers are pitch averages; open targets are pitch-design goals.')),
    card('Release point', rel),
    card('Spin axis & efficiency', clock, h('p', { class: 'card-note' }, 'Clock tilt; distance from centre = spin efficiency.'))));
  C.movementPlot(mv, ps, rows, targetList);
  C.releasePlot(rel, ps);
  C.spinClock(clock, rows);

  // Pitch design workbench
  const gapRows = rows.map((r) => ({ ...r, gap: shapeGap(r, designTargets[r.type]) }));
  const designForm = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const type = f.get('type');
    const t = {};
    for (const k of ['velo', 'spin', 'ivb', 'hb']) { const v = parseFloat(f.get(k)); if (isNum(v)) t[k] = v; }
    t.note = f.get('note') || '';
    const next = { ...designTargets, [type]: t };
    if (!Object.keys(t).some((k) => k !== 'note')) delete next[type];
    await saveSetting(designKey, next);
    toast('Pitch design target saved', 'ok');
    rerender();
  } },
  h('label', { class: 'field' }, h('span', null, 'Pitch'), h('select', { name: 'type' }, PITCH_ORDER.filter((t) => t !== 'OT').map((t) => h('option', { value: t }, PITCH_TYPES[t])))),
  h('label', { class: 'field' }, h('span', null, 'Target velo (mph)'), h('input', { type: 'number', step: '0.1', name: 'velo' })),
  h('label', { class: 'field' }, h('span', null, 'Target IVB (in)'), h('input', { type: 'number', step: '0.1', name: 'ivb' })),
  h('label', { class: 'field' }, h('span', null, 'Target HB (in)'), h('input', { type: 'number', step: '0.1', name: 'hb' })),
  h('label', { class: 'field' }, h('span', null, 'Target spin (rpm)'), h('input', { type: 'number', step: '10', name: 'spin' })),
  h('label', { class: 'field full' }, h('span', null, 'Design note / grip cue'), h('input', { type: 'text', name: 'note', placeholder: 'e.g. Sweeper: thumb under, stay on top, 2:30 tilt' })),
  h('div', { class: 'btn-row full' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save target'), h('span', { class: 'muted small' }, 'Leave all numbers blank to clear a target.')));

  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Pitch design: current vs target', gapRows.some((r) => r.gap) ? table([
      { key: 'type', label: 'Pitch', fmt: typeCell },
      { key: 'ivb', label: 'IVB now', num: true, fmt: (v) => fmt(v) },
      { key: 'gap', label: 'Δ IVB', num: true, fmt: (g) => fmt(g?.dIvb) },
      { key: 'hb', label: 'HB now', num: true, fmt: (v) => fmt(v) },
      { key: 'gap', label: 'Δ HB', num: true, fmt: (g) => fmt(g?.dHb) },
      { key: 'gap', label: 'Δ Velo', num: true, fmt: (g) => fmt(g?.dVelo) },
      { key: 'gap', label: 'Δ Spin', num: true, fmt: (g) => fmt(g?.dSpin, 0) },
      { key: 'gap', label: 'Shape miss', num: true, fmt: (g) => (g ? fmt(g.dist, 1, '″') : '—') },
      { key: 'type', label: 'Cue', fmt: (t) => designTargets[t]?.note || '' },
    ], gapRows.filter((r) => r.gap)) : h('p', { class: 'muted' }, 'Set a target shape for a pitch to track the gap session over session.'),
    h('p', { class: 'card-note' }, 'Δ = target − current. Shape miss is the distance on the movement plot.')),
    card('Set a pitch-design target', designForm)));

  // Pitch shape consistency + separation
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Shape consistency', table([
      { key: 'type', label: 'Pitch', fmt: typeCell },
      { key: 'ivbSd', label: 'IVB SD', num: true, fmt: (v) => fmt(v, 1, '″') },
      { key: 'hbSd', label: 'HB SD', num: true, fmt: (v) => fmt(v, 1, '″') },
      { key: 'n', label: 'Spin SD', num: true, fmt: (v, r) => fmt(sdFor(ps, r.type, 'spin'), 0) },
      { key: 'n', label: 'Velo SD', num: true, fmt: (v, r) => fmt(sdFor(ps, r.type, 'velo'), 1) },
    ], rows), h('p', { class: 'card-note' }, 'Tighter shape = more repeatable pitch. Track SD dropping as a grip/cue settles in.')),
    card('Separation from primary fastball', fb ? table([
      { key: 'type', label: 'Pitch', fmt: typeCell },
      { key: 'veloDiff', label: 'Δ Velo', num: true, fmt: (v) => fmt(v) },
      { key: 'ivb', label: 'Δ IVB', num: true, fmt: (v) => fmt(fb.ivb - v) },
      { key: 'hb', label: 'Δ HB', num: true, fmt: (v) => fmt(v - fb.hb) },
      { key: 'ivb', label: 'Total sep.', num: true, fmt: (v, r) => fmt(Math.hypot(fb.ivb - r.ivb, fb.hb - r.hb), 1, '″') },
    ], rows.filter((r) => r.type !== fb.type)) : h('p', { class: 'muted' }, 'No fastball in this selection.'))));
}

const weighted = (rows, k) => {
  const v = rows.filter((r) => isNum(r[k]));
  const n = v.reduce((s, r) => s + r.n, 0);
  return n ? v.reduce((s, r) => s + r[k] * r.n, 0) / n : NaN;
};
function sdFor(ps, type, k) {
  const v = ps.filter((p) => p.pitchType === type && isNum(p[k])).map((p) => p[k]);
  if (v.length < 2) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

// ---------------- Command ----------------
let cmdSelected = null;

function commandTab(root, ps, player, rerender) {
  const cmd = commandSummary(ps, state.targets);
  root.appendChild(h('div', { class: 'stats' },
    stat('Avg miss', fmt(cmd.avgMiss, 1, '″'), `${cmd.targeted} of ${cmd.n} pitches targeted`),
    stat('Hit spot ≤ 6″', pct(cmd.hitSpot6), '≤ 12″: ' + pct(cmd.hitSpot12)),
    stat('Zone %', pct(cmd.zonePct)),
    stat('Edge %', pct(cmd.edgePct), 'within 2″ of the zone border'),
    stat('Dispersion', fmt(cmd.dispersion, 1, '″'), '2-D location SD'),
    stat('Release SD', `${fmt(cmd.relHsd, 1)}″ / ${fmt(cmd.relSsd, 1)}″`, 'height / side'),
  ));

  const loc = C.chartBox('tall');
  const dens = C.chartBox('tall');
  root.appendChild(h('div', { class: 'grid g2' },
    card('Locations vs targets', loc, h('p', { class: 'card-note' }, ps.length <= 200 ? 'Lines join each pitch to its intended target. Click a pitch to select it for tagging.' : 'Pick a single session to see miss vectors from each target. Click a pitch to select it for tagging.')),
    card('Location density', dens)));
  // Miss vectors only read when the plot isn't a season of pitches.
  C.locationPlot(loc, ps, state.targets, { showMiss: ps.length <= 200, onClick: (uid) => { cmdSelected = uid; rerender(); } });
  C.locationDensity(dens, ps);

  // Per-type command table
  const byType = groupBy(ps.filter((p) => p.pitchType), (p) => p.pitchType);
  const typeRows = PITCH_ORDER.filter((t) => byType.has(t)).map((t) => ({ type: t, ...commandSummary(byType.get(t), state.targets) }));
  root.appendChild(card('Command by pitch type', table([
    { key: 'type', label: 'Pitch', fmt: typeCell },
    { key: 'n', label: '#', num: true },
    { key: 'avgMiss', label: 'Avg miss', num: true, fmt: (v) => fmt(v, 1, '″') },
    { key: 'hitSpot6', label: '≤6″', num: true, fmt: (v) => pct(v) },
    { key: 'hitSpot12', label: '≤12″', num: true, fmt: (v) => pct(v) },
    { key: 'zonePct', label: 'Zone%', num: true, fmt: (v) => pct(v) },
    { key: 'edgePct', label: 'Edge%', num: true, fmt: (v) => pct(v) },
    { key: 'dispersion', label: 'Dispersion', num: true, fmt: (v) => fmt(v, 1, '″') },
    { key: 'relHsd', label: 'Rel H SD', num: true, fmt: (v) => fmt(v, 1, '″') },
  ], typeRows)));

  // Target tagging workflow for bullpens
  const sessionPs = filters.sessionId ? ps : ps.filter((p) => p.date === ps[ps.length - 1].date);
  const seq = [...sessionPs].sort((a, b) => (a.tod ?? 0) - (b.tod ?? 0) || (a.pitchNo ?? 0) - (b.pitchNo ?? 0));
  if (!cmdSelected || !seq.some((p) => p.uid === cmdSelected)) cmdSelected = seq.find((p) => !state.targets.has(p.uid))?.uid || seq[0]?.uid;
  const sel = seq.find((p) => p.uid === cmdSelected);

  const setTarget = async (x, z, zone) => {
    if (!sel) return;
    const t = { uid: sel.uid, x, z, zone: zone || null, src: 'coach' };
    await db.put('targets', t);
    state.targets.set(sel.uid, t);
    const i = seq.indexOf(sel);
    cmdSelected = seq.slice(i + 1).find((p) => !state.targets.has(p.uid))?.uid || seq[i + 1]?.uid || sel.uid;
    rerender();
  };
  const clearTarget = async () => {
    if (!sel) return;
    await db.del('targets', sel.uid);
    state.targets.delete(sel.uid);
    rerender();
  };

  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card(`Tag intended targets — ${seq[0]?.date || ''}`,
      h('p', { class: 'muted small' }, 'Pick a pitch, then click where the catcher set up (or a zone button). The next untagged pitch is selected automatically. Tip: log targets live by typing "T1"–"T9" / "T11"–"T14" in Trackman Notes and they import automatically.'),
      sel ? h('p', null, h('b', null, `#${sel.pitchNo ?? ''} ${PITCH_TYPES[sel.pitchType] || ''}`), ` · ${fmt(sel.velo)} mph · ${fmtClock(sel.tod)}`,
        state.targets.has(sel.uid) ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, `miss ${fmt(missInches(sel, state.targets.get(sel.uid)), 1)}″`) : null) : null,
      h('div', { class: 'grid g2' },
        targetPad(sel, setTarget),
        h('div', null,
          h('div', { class: 'chips', style: { marginBottom: '8px' } }, Object.keys(ZONE_TARGETS).map((z) =>
            h('button', { class: 'chip', type: 'button', onclick: () => setTarget(ZONE_TARGETS[z][0], ZONE_TARGETS[z][1], +z) }, `Zone ${z}`))),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: clearTarget }, 'Clear target')))),
    card('Session pitch log', h('div', { class: 'pitch-list' }, table([
      { key: 'pitchNo', label: '#', num: true },
      { key: 'pitchType', label: 'Pitch', fmt: typeCell },
      { key: 'velo', label: 'Velo', num: true, fmt: (v) => fmt(v) },
      { key: 'uid', label: 'Target', fmt: (u) => { const t = state.targets.get(u); return t ? (t.zone ? `Zone ${t.zone}` : `${fmt(t.x, 2)}, ${fmt(t.z, 2)}`) : '—'; } },
      { key: 'uid', label: 'Miss', num: true, fmt: (u, p) => fmt(missInches(p, state.targets.get(u)), 1, '″') },
      { key: 'plateX', label: 'In zone', fmt: (v, p) => (inZone(p) ? '✓' : '') },
    ], seq, { compact: true, onRowClick: (p) => { cmdSelected = p.uid; rerender(); }, rowClass: (p) => (p.uid === cmdSelected ? 'selected' : null) })))));
}

// Clickable strike-zone pad (catcher's view) in SVG.
function targetPad(sel, onPick) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 3, H = 3.6, x0 = -1.5, z0 = 0.6; // ft window
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W * 100} ${H * 100}`);
  const toSvg = (x, z) => [(x - x0) * 100, (H - (z - z0)) * 100];
  const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.appendChild(el); return el; };
  const [zx1, zy1] = toSvg(-0.83, 3.5), [zx2, zy2] = toSvg(0.83, 1.5);
  add('rect', { x: zx1, y: zy1, width: zx2 - zx1, height: zy2 - zy1, fill: 'none', stroke: 'var(--text-secondary)', 'stroke-width': 3 });
  for (let i = 1; i < 3; i++) {
    add('line', { x1: zx1 + ((zx2 - zx1) * i) / 3, x2: zx1 + ((zx2 - zx1) * i) / 3, y1: zy1, y2: zy2, stroke: 'var(--grid)', 'stroke-width': 1.5 });
    add('line', { x1: zx1, x2: zx2, y1: zy1 + ((zy2 - zy1) * i) / 3, y2: zy1 + ((zy2 - zy1) * i) / 3, stroke: 'var(--grid)', 'stroke-width': 1.5 });
  }
  if (sel) {
    const t = state.targets.get(sel.uid);
    if (t) { const [tx, ty] = toSvg(t.x, t.z); add('circle', { cx: tx, cy: ty, r: 14, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3 }); }
    if (isNum(sel.plateX)) { const [px, py] = toSvg(sel.plateX, sel.plateZ); add('circle', { cx: px, cy: py, r: 9, fill: C.pitchColor(sel.pitchType), stroke: 'var(--surface-1)', 'stroke-width': 2 }); }
  }
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const x = x0 + ((e.clientX - r.left) / r.width) * W;
    const z = z0 + H - ((e.clientY - r.top) / r.height) * H;
    onPick(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
  });
  return h('div', { class: 'pad', role: 'img', 'aria-label': 'Strike zone target pad, catcher view' }, svg);
}

// ---------------- Development curves ----------------
let devMetric = 'velo';

function devTab(root, ps, player, rerender) {
  const goals = state.goals.filter((g) => g.playerId === filters.pitcher && PITCH_METRICS[g.metric]);
  const m = PITCH_METRICS[devMetric];
  const types = PITCH_ORDER.filter((t) => ps.some((p) => p.pitchType === t));
  const series = types.map((t) => ({ name: PITCH_TYPES[t], type: t, color: C.pitchColor(t), ...devCurve(ps.filter((p) => p.pitchType === t), m.fn, 3) })).filter((s) => s.pts.length);

  root.appendChild(h('div', { class: 'filters' },
    h('label', { class: 'field' }, h('span', null, 'Metric'),
      h('select', { onchange: (e) => { devMetric = e.target.value; rerender(); } },
        Object.entries(PITCH_METRICS).map(([k, v]) => h('option', { value: k, selected: k === devMetric }, v.label)))),
    h('span', { class: 'muted small' }, 'One point per session (≥3 pitches). Solid line = 3-session average, dotted = trend.')));

  const tr = C.chartBox('tall');
  root.appendChild(card(`${m.label} by pitch type`, tr));
  C.trendPlot(tr, series, {
    unit: m.unit, d: m.d, scale: m.scale, ytitle: `${m.label}${m.unit ? ` (${m.unit})` : ''}`,
    goals: goals.filter((g) => g.metric === devMetric).map((g) => ({ value: g.target, label: `Goal ${g.pitchType ? g.pitchType + ' ' : ''}${g.target}${m.unit}` })),
  });

  root.appendChild(card('Trend summary', table([
    { key: 'type', label: 'Pitch', fmt: typeCell },
    { key: 'pts', label: 'Sessions', num: true, fmt: (v) => v.length },
    { key: 'first', label: 'First', num: true, fmt: (v) => fmt(v * (m.scale || 1), m.d) },
    { key: 'last', label: 'Latest', num: true, fmt: (v) => fmt(v * (m.scale || 1), m.d) },
    { key: 'best', label: 'Best', num: true, fmt: (v) => fmt(v * (m.scale || 1), m.d) },
    { key: 'slope30', label: 'Trend / 30 days', num: true, fmt: (v) => {
      if (!isNum(v)) return '—';
      const good = v * m.dir > 0;
      return h('span', { class: good ? 'up' : 'down' }, `${v > 0 ? '▲ +' : '▼ '}${(v * (m.scale || 1)).toFixed(m.d)} ${m.unit}`);
    } },
  ], series)));

  // Velocity development: FB max & avg per session, separately (no dual axis).
  const fbPs = ps.filter((p) => pitchClass(p.pitchType) === 'FB');
  if (fbPs.length) {
    const a = C.chartBox(), b = C.chartBox();
    root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } }, card('Fastball velocity — session max', a), card('Fastball velocity — session average', b)));
    C.trendPlot(a, [{ name: 'Max velo', color: C.seriesColor(0), ...devCurve(fbPs, PITCH_METRICS.veloMax.fn, 3) }], { unit: 'mph', ytitle: 'mph', goals: goals.filter((g) => g.metric === 'veloMax').map((g) => ({ value: g.target, label: `Goal ${g.target}` })) });
    C.trendPlot(b, [{ name: 'Avg velo', color: C.seriesColor(2), ...devCurve(fbPs, PITCH_METRICS.velo.fn, 3) }], { unit: 'mph', ytitle: 'mph' });
  }

  root.appendChild(h('p', { class: 'muted small' }, 'Add development goals on the ', h('a', { href: `#/players/${encodeURIComponent(filters.pitcher)}` }, `${playerName(filters.pitcher)} profile`), ' — they draw as dashed lines here.'));
}

// ---------------- Session report ----------------
function sessionTab(root, ps, player, rerender) {
  const dates = [...new Set(ps.map((p) => p.date))].sort();
  const sid = filters.sessionId || ps.filter((p) => p.date === dates[dates.length - 1])[0].sessionId;
  const sp = ps.filter((p) => p.sessionId === sid).sort((a, b) => (a.tod ?? 0) - (b.tod ?? 0) || (a.pitchNo ?? 0) - (b.pitchNo ?? 0));
  const session = state.sessions.find((s) => s.id === sid);
  const prior = state.pitches
    .filter((p) => p.pitcherKey === filters.pitcher && p.date < session.date && p.kind === 'pitch')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.tod ?? 0) - (b.tod ?? 0));
  const { rows } = arsenal(sp, state.targets);
  const prevRows = arsenal(prior.slice(-400), state.targets).rows;
  const prevBy = new Map(prevRows.map((r) => [r.type, r]));
  const cmd = commandSummary(sp, state.targets);
  const fade = veloFade(sp);

  root.appendChild(h('div', { class: 'btn-row', style: { marginBottom: '12px' } },
    h('b', null, `${playerName(filters.pitcher)} · ${session.date} · ${session.label || session.type}`),
    h('span', { class: 'badge' }, `${sp.length} pitches`),
    state.videos.some((v) => v.sessionId === sid) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => navigate(`video/${sid}`) }, '▶ Open session video') : null,
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => window.print() }, 'Print / PDF')));

  root.appendChild(h('div', { class: 'stats' },
    stat('FB velo', fmt(rows.find((r) => pitchClass(r.type) === 'FB')?.velo, 1, ' mph'), `max ${fmt(rows.find((r) => pitchClass(r.type) === 'FB')?.veloMax, 1)}`),
    stat('Velo fade', fmt(fade, 1, ' mph'), 'FB change per 25 pitches'),
    stat('Avg miss', fmt(cmd.avgMiss, 1, '″'), `${cmd.targeted} targeted`),
    stat('Zone %', pct(cmd.zonePct)),
    stat('Strike %', pct(sp.filter((p) => p.call && p.call !== 'Ball' && p.call !== 'HBP').length / (sp.filter((p) => p.call).length || NaN)))));

  root.appendChild(card('Today vs previous work (last 400 pitches before this session)', table([
    { key: 'type', label: 'Pitch', fmt: typeCell },
    { key: 'n', label: '#', num: true },
    ...['velo', 'spin', 'ivb', 'hb', 'stuff'].map((k) => ({
      key: k, label: { velo: 'Velo', spin: 'Spin', ivb: 'IVB', hb: 'HB', stuff: 'DI Stuff' }[k], num: true,
      fmt: (v, r) => {
        const prev = prevBy.get(r.type)?.[k];
        const d = isNum(prev) && isNum(v) ? v - prev : NaN;
        const digits = k === 'spin' || k === 'stuff' ? 0 : 1;
        return h('span', null, fmt(v, digits), isNum(d) ? h('span', { class: 'muted small' }, ` (${d >= 0 ? '+' : ''}${d.toFixed(digits)})`) : null);
      },
    })),
    { key: 'avgMiss', label: 'Avg miss', num: true, fmt: (v) => fmt(v, 1, '″') },
  ], rows)));

  const seq = C.chartBox(), loc = C.chartBox('tall'), mv = C.chartBox('tall');
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Velocity by pitch # (fatigue / intent)', seq),
    card('Movement', mv)));
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Locations', loc),
    sessionNotes(sid, filters.pitcher, rerender)));
  C.sequencePlot(seq, sp, 'velo', 'mph');
  C.movementPlot(mv, sp, rows);
  C.locationPlot(loc, sp, state.targets, { showMiss: true });
}

export function sessionNotes(sessionId, playerId, rerender) {
  const id = `${sessionId}|${playerId}`;
  const existing = state.notes.find((n) => n.id === id);
  const ta = h('textarea', { placeholder: 'Coach notes: cues, feel, mechanical focus, plan for next session…', rows: 6 });
  ta.value = existing?.text || '';
  return card('Coach notes',
    ta,
    h('div', { class: 'btn-row', style: { marginTop: '8px' } },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
        const n = { id, sessionId, playerId, text: ta.value, updatedAt: new Date().toISOString() };
        await db.put('notes', n);
        const i = state.notes.findIndex((x) => x.id === id);
        if (i >= 0) state.notes[i] = n; else state.notes.push(n);
        toast('Notes saved', 'ok');
      } }, 'Save notes'),
      existing ? h('span', { class: 'muted small' }, `Last saved ${new Date(existing.updatedAt).toLocaleString()}`) : null));
}
