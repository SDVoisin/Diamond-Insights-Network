// Hitting Lab: power & batted ball quality, swing path / bat tracking,
// timing, approach, and power development curves.

import { h, card, table, stat, empty, fmt, pct, isNum, groupBy } from '../util.js';
import { state } from '../store.js';
import { filters, filterBar, filtered, pageHeader, playerName } from '../app.js';
import { hittingSummary, devCurve, HIT_METRICS, timing, pullAngle, squaredUp, isBarrel, avgOf } from '../metrics.js';
import { PITCH_TYPES, PITCH_ORDER, isSwing, pitchClass } from '../trackman.js';
import { HIT } from '../config.js';
import * as C from '../charts.js';
import { sessionNotes } from './pitching.js';

let tab = 'power';

export default function hitting(root, { rerender }) {
  root.appendChild(pageHeader('Hitting Lab', 'Bat speed, swing path, timing and power development from Trackman + swing sensors.'));
  if (!state.pitches.some((p) => p.batterKey)) {
    root.appendChild(empty('No hitting data yet. Log BP, cage or live ABs in the Session Logger, or import Trackman / Blast files.', h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, h('a', { class: 'btn btn-primary', href: '#/log' }, 'Start logging'), h('a', { class: 'btn', href: '#/import' }, 'Import data'))));
    return;
  }
  root.appendChild(filterBar('H', rerender));
  const ps = filtered({ role: 'H', playerKey: filters.hitter });
  const tabs = [['power', 'Power & Batted Ball'], ['swing', 'Swing Path & Bat Speed'], ['timing', 'Timing'], ['approach', 'Approach'], ['dev', 'Development Curves'], ['session', 'Session Report']];
  root.appendChild(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) =>
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; rerender(); } }, label))));
  if (!ps.length) { root.appendChild(empty('No swings match these filters.')); return; }
  const body = h('div');
  root.appendChild(body);
  ({ power: powerTab, swing: swingTab, timing: timingTab, approach: approachTab, dev: devTab, session: sessionTab })[tab](body, ps, rerender);
}

const bipOf = (ps) => ps.filter((p) => isNum(p.ev));

function powerTab(root, ps) {
  const s = hittingSummary(ps);
  const bip = bipOf(ps);
  root.appendChild(h('div', { class: 'stats' },
    stat('Max EV', fmt(s.evMax, 1, ' mph'), `${s.bip} balls in play`),
    stat('EV90', fmt(s.ev90, 1, ' mph'), '90th percentile — best power gauge'),
    stat('Avg EV', fmt(s.evAvg, 1, ' mph')),
    stat('Hard-hit %', pct(s.hardHit), `≥ ${HIT.hardHit} mph`),
    stat('Sweet-spot %', pct(s.sweetSpot), `${HIT.sweetSpot[0]}–${HIT.sweetSpot[1]}° LA`),
    stat('Barrel %', pct(s.barrel, 1)),
    stat('Max distance', fmt(s.distMax, 0, ' ft')),
  ));
  const evla = C.chartBox('tall'), spray = C.chartBox('tall');
  root.appendChild(h('div', { class: 'grid g2' }, card('Exit velocity × launch angle', evla), card('Spray chart', spray)));
  C.evLaPlot(evla, bip);
  C.sprayChart(spray, bip);

  const evZone = C.chartBox('tall'), laZone = C.chartBox('tall');
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Avg EV by pitch location', evZone, h('p', { class: 'card-note' }, 'Catcher view. Cells need ≥3 balls in play.')),
    card('Avg launch angle by pitch location', laZone, h('p', { class: 'card-note' }, 'Reveals swing-path fit: LA should rise on low pitches if the bat is working up through the zone.'))));
  C.zoneGrid(evZone, bip, (c) => avgOf(c, 'ev'), { d: 0 });
  C.zoneGrid(laZone, bip, (c) => avgOf(c, 'la'), { d: 0, suffix: '°' });

  const types = groupBy(bip, (p) => p.pitchType || 'OT');
  const rows = PITCH_ORDER.filter((t) => types.has(t)).map((t) => ({ type: t, ...hittingSummary(types.get(t)) }));
  const bbt = C.chartBox('short');
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Batted-ball quality by pitch type', table([
      { key: 'type', label: 'Pitch', fmt: (t) => PITCH_TYPES[t] || t },
      { key: 'bip', label: 'BIP', num: true },
      { key: 'evAvg', label: 'Avg EV', num: true, fmt: (v) => fmt(v) },
      { key: 'ev90', label: 'EV90', num: true, fmt: (v) => fmt(v) },
      { key: 'laAvg', label: 'Avg LA', num: true, fmt: (v) => fmt(v) },
      { key: 'hardHit', label: 'Hard%', num: true, fmt: (v) => pct(v) },
      { key: 'sweetSpot', label: 'SwSp%', num: true, fmt: (v) => pct(v) },
    ], rows)),
    card('Batted-ball profile', bbt)));
  C.bars(bbt, ['GB', 'LD', 'FB', 'PU'], [{ name: 'Share of BIP', values: [s.gb, s.ld, s.fbPct, s.pu] }], { scale: 100, suffix: '%', labels: true, ytitle: '% of balls in play' });
}

function swingTab(root, ps) {
  const s = hittingSummary(ps);
  const hasBat = ps.some((p) => isNum(p.batSpeed));
  root.appendChild(h('div', { class: 'stats' },
    stat('Bat speed', fmt(s.batSpeed, 1, ' mph'), `max ${fmt(s.batSpeedMax, 1)} · 90th ${fmt(s.batSpeed90, 1)}`),
    stat('Attack angle', fmt(s.attackAngle, 1, '°'), `SD ${fmt(s.attackAngleSd, 1)}°`),
    stat('Squared-up %', pct(s.squaredUp), 'EV ≥ 80% of max possible'),
    stat('Vertical bat angle', fmt(s.vba, 1, '°')),
    stat('Time to contact', fmt(s.ttc, 3, ' s')),
    stat('Rotational accel.', fmt(s.rotAcc, 1, ' g')),
    stat('On-plane eff.', pct(s.onPlane)),
  ));
  if (!hasBat) root.appendChild(h('div', { class: 'alert' }, h('div', null, h('b', null, 'No bat-tracking columns found'), 'Import Blast/sensor CSVs or Trackman files with BatSpeed/AttackAngle to unlock this tab. Launch-angle-based swing path views below still work.')));

  const aa = C.chartBox(), bs = C.chartBox(), la = C.chartBox(), sq = C.chartBox();
  root.appendChild(h('div', { class: 'grid g2' },
    card('Attack angle vs pitch height', aa, h('p', { class: 'card-note' }, 'A good path matches the pitch plane: lower pitches → steeper attack angle is normal; a flat line means one path for every height.')),
    card('Launch angle vs pitch height', la)));
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Bat speed distribution', bs),
    card('Bat speed → exit velocity', sq, h('p', { class: 'card-note' }, 'Dashed line = max possible EV at 80 mph pitch (1.23·bat + 0.23·pitch). Points near it are squared up.'))));

  const withH = ps.filter((p) => isNum(p.plateZ));
  C.scatter(aa, withH.filter((p) => isNum(p.attackAngle)).map((p) => ({ x: p.plateZ, y: p.attackAngle, uid: p.uid, text: `AA ${fmt(p.attackAngle)}° @ ${fmt(p.plateZ, 2)} ft` })), { xtitle: 'Pitch height (ft)', ytitle: 'Attack angle (°)' });
  C.scatter(la, withH.filter((p) => isNum(p.la)).map((p) => ({ x: p.plateZ, y: p.la, uid: p.uid, group: pitchClass(p.pitchType) === 'FB' ? 'Fastballs' : 'Spin / offspeed', text: `LA ${fmt(p.la)}° · EV ${fmt(p.ev)}` })), { xtitle: 'Pitch height (ft)', ytitle: 'Launch angle (°)' });
  C.histogram(bs, ps.map((p) => p.batSpeed).filter(isNum), { xtitle: 'Bat speed (mph)', bins: { size: 1 } });
  const pts = ps.filter((p) => isNum(p.batSpeed) && isNum(p.ev));
  C.scatter(sq, pts.map((p) => ({ x: p.batSpeed, y: p.ev, uid: p.uid, group: squaredUp(p) >= HIT.squaredUp ? 'Squared up' : 'Not squared up', text: `Bat ${fmt(p.batSpeed)} → EV ${fmt(p.ev)} (${pct(squaredUp(p))})` })), {
    xtitle: 'Bat speed (mph)', ytitle: 'Exit velocity (mph)',
    shapes: [{ type: 'line', x0: 50, x1: 85, y0: 1.23 * 50 + 0.23 * 80, y1: 1.23 * 85 + 0.23 * 80, line: { dash: 'dash', width: 1.5, color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted') } }],
  });

  // Blast-style quality metrics table when present
  const sensor = ps.filter((p) => p.kind === 'swing');
  if (sensor.length) {
    const bySess = groupBy(sensor, (p) => p.date);
    root.appendChild(card('Sensor sessions', table([
      { key: 'date', label: 'Date' }, { key: 'n', label: 'Swings', num: true },
      { key: 'bat', label: 'Bat speed', num: true, fmt: (v) => fmt(v) }, { key: 'aa', label: 'Attack angle', num: true, fmt: (v) => fmt(v) },
      { key: 'vba', label: 'VBA', num: true, fmt: (v) => fmt(v) }, { key: 'rot', label: 'Rot. accel', num: true, fmt: (v) => fmt(v) },
      { key: 'op', label: 'On-plane', num: true, fmt: (v) => pct(v) }, { key: 'ttc', label: 'TTC', num: true, fmt: (v) => fmt(v, 3) },
      { key: 'pw', label: 'Power kW', num: true, fmt: (v) => fmt(v, 2) },
    ], [...bySess.entries()].sort().reverse().map(([date, x]) => ({
      date, n: x.length, bat: avgOf(x, 'batSpeed'), aa: avgOf(x, 'attackAngle'), vba: avgOf(x, 'vba'), rot: avgOf(x, 'rotAcc'), op: avgOf(x, 'onPlane'), ttc: avgOf(x, 'ttc'), pw: avgOf(x, 'power'),
    })))));
  }
}

function timingTab(root, ps) {
  const bip = bipOf(ps);
  const tim = ps.filter((p) => isNum(p.ev) || p.timingTag).map((p) => ({ p, t: timing(p) })).filter((x) => x.t);
  const s = hittingSummary(ps);
  const BASIS = { depth: 'Trackman contact depth', coach: 'coach calls', spray: 'spray angle vs pitch location' };
  const basis = [...new Set(tim.map((x) => x.t.basis))].map((k) => BASIS[k]).join(' + ') || '—';
  root.appendChild(h('div', { class: 'stats' },
    stat('On time', pct(s.onTime), `basis: ${basis}`),
    stat('Early', pct(s.early)),
    stat('Late', pct(s.late)),
    stat('Avg contact depth', fmt(s.contactDepth, 2, ' ft'), 'in front of plate'),
    stat('Pull % / Oppo %', `${pct(s.pull)} / ${pct(s.oppo)}`),
  ));

  // Timing by pitch type and velocity band
  const byType = groupBy(tim, (x) => x.p.pitchType || 'OT');
  const types = PITCH_ORDER.filter((t) => byType.has(t));
  const share = (arr, lab) => arr.filter((x) => x.t.label === lab).length / arr.length;
  const bt = C.chartBox();
  const dv = C.chartBox();
  root.appendChild(h('div', { class: 'grid g2' },
    card('Timing by pitch type', bt, h('p', { class: 'card-note' }, 'Early on offspeed + late on fastballs = sitting in the middle; train with velo/shape mixes.')),
    card('Contact depth vs pitch velocity', dv, h('p', { class: 'card-note' }, 'Positive = contact out in front of the plate. A downward slope means the hitter gets deeper (later) as velo rises.'))));
  C.bars(bt, types.map((t) => PITCH_TYPES[t] || t), [
    { name: 'Early', values: types.map((t) => share(byType.get(t), 'Early')), color: C.seriesColor(1) },
    { name: 'On time', values: types.map((t) => share(byType.get(t), 'On time')), color: C.seriesColor(2) },
    { name: 'Late', values: types.map((t) => share(byType.get(t), 'Late')), color: C.seriesColor(0) },
  ], { stack: true, scale: 100, suffix: '%', labels: true, ytitle: '% of balls in play' });
  const depthPts = bip.filter((p) => isNum(p.velo) && (isNum(p.contactX) || isNum(p.dir)));
  C.scatter(dv, depthPts.map((p) => ({
    x: p.velo, y: isNum(p.contactX) ? p.contactX : pullAngle(p), uid: p.uid,
    group: PITCH_TYPES[p.pitchType] || 'Other',
    text: `${PITCH_TYPES[p.pitchType] || ''} ${fmt(p.velo)} mph<br>${isNum(p.contactX) ? `depth ${fmt(p.contactX, 2)} ft` : `pull ${fmt(pullAngle(p))}°`}<br>EV ${fmt(p.ev)}`,
  })), {
    xtitle: 'Pitch velocity (mph)', ytitle: depthPts.some((p) => isNum(p.contactX)) ? 'Contact depth (ft)' : 'Pull angle (°)',
    colorFor: (g) => C.pitchColor(Object.keys(PITCH_TYPES).find((k) => PITCH_TYPES[k] === g)),
    symbolFor: (g) => C.pitchSymbol(Object.keys(PITCH_TYPES).find((k) => PITCH_TYPES[k] === g)),
  });

  // Velo band table
  const bands = [[0, 75, '< 75'], [75, 80, '75–80'], [80, 85, '80–85'], [85, 90, '85–90'], [90, 200, '90+']];
  root.appendChild(card('Timing & quality by pitch velocity', table([
    { key: 'band', label: 'Velo band' }, { key: 'n', label: 'BIP', num: true },
    { key: 'onTime', label: 'On time', num: true, fmt: (v) => pct(v) }, { key: 'early', label: 'Early', num: true, fmt: (v) => pct(v) }, { key: 'late', label: 'Late', num: true, fmt: (v) => pct(v) },
    { key: 'ev', label: 'Avg EV', num: true, fmt: (v) => fmt(v) }, { key: 'pull', label: 'Avg pull°', num: true, fmt: (v) => fmt(v) },
    { key: 'whiff', label: 'Whiff% (live)', num: true, fmt: (v) => pct(v) },
  ], bands.map(([lo, hi, band]) => {
    const t = tim.filter((x) => x.p.velo >= lo && x.p.velo < hi);
    const sw = ps.filter((p) => isSwing(p.call) && p.velo >= lo && p.velo < hi && (p.sessionType === 'live' || p.sessionType === 'game'));
    return {
      band, n: t.length,
      onTime: t.length ? share(t, 'On time') : NaN, early: t.length ? share(t, 'Early') : NaN, late: t.length ? share(t, 'Late') : NaN,
      ev: avgOf(t.map((x) => x.p), 'ev'), pull: avgOf(t.map((x) => x.p), pullAngle),
      whiff: sw.length ? sw.filter((p) => p.call === 'Whiff').length / sw.length : NaN,
    };
  }).filter((r) => r.n || isNum(r.whiff)))));

  if (ps.some((p) => isNum(p.ttc))) {
    const tt = C.chartBox('short');
    root.appendChild(card('Time to contact (sensor)', tt));
    C.histogram(tt, ps.map((p) => p.ttc).filter(isNum), { xtitle: 'Time to contact (s)', bins: { size: 0.005 } });
  }
}

function approachTab(root, ps) {
  const live = ps.filter((p) => p.call && (p.sessionType === 'live' || p.sessionType === 'game'));
  if (!live.length) { root.appendChild(empty('Approach needs live AB or game pitches (Trackman PitchCall). BP and cage work are excluded.')); return; }
  const s = hittingSummary(ps);
  root.appendChild(h('div', { class: 'stats' },
    stat('Pitches seen', String(live.length)),
    stat('Z-swing %', pct(s.zSwing)),
    stat('Chase %', pct(s.chase)),
    stat('Whiff %', pct(s.whiff)),
    stat('Swing %', pct(live.filter((p) => isSwing(p.call)).length / live.length))));
  const sw = C.chartBox('tall'), wh = C.chartBox('tall');
  root.appendChild(h('div', { class: 'grid g2' }, card('Swing rate by location', sw), card('Whiff rate by location (swings)', wh)));
  C.zoneGrid(sw, live, (c) => c.filter((p) => isSwing(p.call)).length / c.length, { scale: 100, suffix: '%', zmin: 0, zmax: 1 });
  C.zoneGrid(wh, live.filter((p) => isSwing(p.call)), (c) => c.filter((p) => p.call === 'Whiff').length / c.length, { scale: 100, suffix: '%', zmin: 0, zmax: 1, minN: 2 });
  const byType = groupBy(live, (p) => p.pitchType || 'OT');
  root.appendChild(card('Swing decisions by pitch type', table([
    { key: 'type', label: 'Pitch', fmt: (t) => PITCH_TYPES[t] || t }, { key: 'n', label: 'Seen', num: true },
    { key: 'zSwing', label: 'Z-swing', num: true, fmt: (v) => pct(v) }, { key: 'chase', label: 'Chase', num: true, fmt: (v) => pct(v) },
    { key: 'whiff', label: 'Whiff', num: true, fmt: (v) => pct(v) }, { key: 'evAvg', label: 'Avg EV', num: true, fmt: (v) => fmt(v) },
  ], PITCH_ORDER.filter((t) => byType.has(t)).map((t) => ({ type: t, n: byType.get(t).length, ...hittingSummary(byType.get(t)) })))));
}

let devMetrics = ['ev90', 'batSpeed'];

function devTab(root, ps, rerender) {
  const goals = state.goals.filter((g) => g.playerId === filters.hitter && HIT_METRICS[g.metric]);
  root.appendChild(h('div', { class: 'filters' },
    [0, 1].map((i) => h('label', { class: 'field' }, h('span', null, i === 0 ? 'Chart 1' : 'Chart 2'),
      h('select', { onchange: (e) => { devMetrics[i] = e.target.value; rerender(); } },
        Object.entries(HIT_METRICS).map(([k, v]) => h('option', { value: k, selected: k === devMetrics[i] }, v.label))))),
    h('span', { class: 'muted small' }, 'One point per session day. Solid = 3-session average, dotted = trend.')));

  const grid = h('div', { class: 'grid g2' });
  root.appendChild(grid);
  const summary = [];
  devMetrics.forEach((k) => {
    const m = HIT_METRICS[k];
    const el = C.chartBox('tall');
    grid.appendChild(card(m.label, el));
    const curve = devCurve(ps, m.fn, 3);
    C.trendPlot(el, [{ name: m.label, ...curve }], { unit: m.unit, d: m.d, scale: m.scale, ytitle: `${m.label}${m.unit ? ` (${m.unit})` : ''}`, goals: goals.filter((g) => g.metric === k).map((g) => ({ value: g.target, label: `Goal ${g.target}${m.unit}` })) });
  });

  // Power development curve summary across every metric
  for (const [k, m] of Object.entries(HIT_METRICS)) {
    const c = devCurve(ps, m.fn, 3);
    if (c.pts.length) summary.push({ k, label: m.label, m, ...c });
  }
  root.appendChild(card('Development summary', table([
    { key: 'label', label: 'Metric' },
    { key: 'pts', label: 'Sessions', num: true, fmt: (v) => v.length },
    { key: 'first', label: 'First', num: true, fmt: (v, r) => fmt(v * (r.m.scale || 1), r.m.d) },
    { key: 'last', label: 'Latest', num: true, fmt: (v, r) => fmt(v * (r.m.scale || 1), r.m.d) },
    { key: 'best', label: 'Best', num: true, fmt: (v, r) => fmt(v * (r.m.scale || 1), r.m.d) },
    { key: 'slope30', label: 'Trend / 30 days', num: true, fmt: (v, r) => (isNum(v) ? h('span', { class: v * r.m.dir > 0 ? 'up' : 'down' }, `${v > 0 ? '▲ +' : '▼ '}${(v * (r.m.scale || 1)).toFixed(r.m.d)} ${r.m.unit}`) : '—') },
  ], summary)));
  root.appendChild(h('p', { class: 'muted small' }, 'Set goals on the ', h('a', { href: `#/players/${encodeURIComponent(filters.hitter)}` }, `${playerName(filters.hitter)} profile`), '.'));
}

function sessionTab(root, ps, rerender) {
  const dates = [...new Set(ps.map((p) => p.date))].sort();
  const sid = filters.sessionId || ps.find((p) => p.date === dates[dates.length - 1]).sessionId;
  const sp = ps.filter((p) => p.sessionId === sid);
  const session = state.sessions.find((s) => s.id === sid);
  const s = hittingSummary(sp);
  const prev = hittingSummary(state.pitches.filter((p) => p.batterKey === filters.hitter && p.date < session.date));
  const delta = (a, b, d = 1) => (isNum(a) && isNum(b) ? ` (${a - b >= 0 ? '+' : ''}${(a - b).toFixed(d)} vs prior)` : '');
  root.appendChild(h('div', { class: 'btn-row', style: { marginBottom: '12px' } },
    h('b', null, `${playerName(filters.hitter)} · ${session.date} · ${session.label || session.type}`),
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => window.print() }, 'Print / PDF')));
  root.appendChild(h('div', { class: 'stats' },
    stat('Max EV', fmt(s.evMax, 1), delta(s.evMax, prev.evMax)),
    stat('EV90', fmt(s.ev90, 1), delta(s.ev90, prev.ev90)),
    stat('Hard-hit %', pct(s.hardHit), isNum(prev.hardHit) ? `prior ${pct(prev.hardHit)}` : ''),
    stat('Bat speed', fmt(s.batSpeed, 1), delta(s.batSpeed, prev.batSpeed)),
    stat('Squared-up %', pct(s.squaredUp)),
    stat('On time', pct(s.onTime))));
  const evla = C.chartBox('tall'), spray = C.chartBox('tall');
  root.appendChild(h('div', { class: 'grid g2' }, card('EV × LA', evla), card('Spray', spray)));
  C.evLaPlot(evla, bipOf(sp));
  C.sprayChart(spray, bipOf(sp));
  const seq = C.chartBox();
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } }, card('Exit velocity by swing #', seq), sessionNotes(sid, filters.hitter, rerender)));
  const ordered = [...sp].sort((a, b) => (a.tod ?? 0) - (b.tod ?? 0));
  C.scatter(seq, ordered.map((p, i) => ({ x: i + 1, y: p.ev, uid: p.uid, group: isBarrel(p.ev, p.la) ? 'Barrel' : 'Batted ball', text: `#${i + 1} ${fmt(p.ev)} mph @ ${fmt(p.la)}°` })).filter((d) => isNum(d.y)), { xtitle: 'Swing #', ytitle: 'Exit velocity (mph)' });
}
