// Organisation dashboard: activity, workload & fatigue flags, biggest
// movers, leaderboards and goal progress.

import { h, card, table, stat, empty, fmt, isNum, addDays, groupBy, toast } from '../util.js';
import { state } from '../store.js';
import { pageHeader, playerName, navigate, filters } from '../app.js';
import { avgOf, maxOf, quantile, PITCH_METRICS, HIT_METRICS } from '../metrics.js';
import { pitchClass } from '../trackman.js';
import { ALERTS } from '../config.js';
import { loadDemo } from './importer.js';

export default function dashboard(root, { rerender }) {
  root.appendChild(pageHeader('Dashboard', 'Organisation-wide view of player development, workload and progress.'));
  if (!state.pitches.length) {
    root.appendChild(empty('Welcome to the Player Development Lab. Log a session live from the iPad, open a video in the Mechanics Room, import Trackman or Blast files, or load the demo dataset to explore.',
      h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
        h('a', { class: 'btn btn-primary', href: '#/log' }, 'Start logging a session'),
        h('a', { class: 'btn', href: '#/mechanics' }, 'Review video'),
        h('a', { class: 'btn', href: '#/import' }, 'Import data'),
        h('button', { class: 'btn', type: 'button', onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Loading…'; try { const n = await loadDemo(); toast(`Demo data loaded: ${n} rows`, 'ok'); } catch (err) { toast('Demo load failed: ' + err.message, 'error'); } } }, 'Load demo data'))));
    return;
  }

  const latest = state.pitches.reduce((m, p) => (p.date > m ? p.date : m), '');
  const d7 = addDays(latest, -6), d30 = addDays(latest, -29), d60 = addDays(latest, -59);
  const recent = state.pitches.filter((p) => p.date >= d30);
  const skip = new Set(state.players.filter((p) => p.nonPlayer || p.archived).map((p) => p.id));
  const pitches = state.pitches.filter((p) => p.kind === 'pitch' && p.pitcherKey && !skip.has(p.pitcherKey));
  const activePlayers = new Set(recent.flatMap((p) => [p.pitcherKey, p.batterKey]).filter(Boolean));

  root.appendChild(h('div', { class: 'stats' },
    stat('Players on roster', String(state.players.filter((p) => !p.archived).length), `${activePlayers.size} active last 30 days`),
    stat('Sessions (30 d)', String(state.sessions.filter((s) => s.date >= d30).length), `${state.sessions.length} all-time`),
    stat('Pitches tracked (30 d)', String(recent.filter((p) => p.kind === 'pitch' && !skip.has(p.pitcherKey)).length)),
    stat('Swings / BIP (30 d)', String(recent.filter((p) => isNum(p.ev) || isNum(p.batSpeed)).length)),
    stat('Clips linked', String(state.videos.length)),
    stat('Latest data', latest),
  ));

  // ---- workload + alerts ----
  const alerts = [];
  const byPitcher = groupBy(pitches, (p) => p.pitcherKey);
  const workload = [];
  for (const [id, ps] of byPitcher) {
    const last7 = ps.filter((p) => p.date >= d7);
    const days = [...new Set(ps.map((p) => p.date))].sort();
    const lastDay = days[days.length - 1];
    const fbLast = ps.filter((p) => p.date === lastDay && pitchClass(p.pitchType) === 'FB');
    const fbBase = ps.filter((p) => p.date < lastDay && p.date >= addDays(lastDay, -30) && pitchClass(p.pitchType) === 'FB');
    const vLast = avgOf(fbLast, 'velo'), vBase = avgOf(fbBase, 'velo');
    let streak = 1;
    for (let i = days.length - 1; i > 0 && days[i - 1] === addDays(days[i], -1); i--) streak++;
    const row = { id, name: playerName(id), last7: last7.length, days7: new Set(last7.map((p) => p.date)).size, lastDay, vLast, vDelta: vLast - vBase, streak };
    workload.push(row);
    if (isNum(row.vDelta) && row.vDelta <= -ALERTS.veloDropMph) alerts.push({ kind: 'critical', title: `${row.name}: fastball down ${Math.abs(row.vDelta).toFixed(1)} mph`, body: `${lastDay} averaged ${fmt(vLast)} mph vs ${fmt(vBase)} over the prior 30 days. Check soreness / readiness before the next high-intent day.` });
    if (row.last7 >= ALERTS.pitches7d && row.lastDay >= d7) alerts.push({ kind: 'warning', title: `${row.name}: ${row.last7} pitches in 7 days`, body: 'High tracked volume — confirm the throwing program accounts for it.' });
    if (row.streak >= ALERTS.backToBackDays && row.lastDay === latest) alerts.push({ kind: 'warning', title: `${row.name}: ${row.streak} straight throwing days`, body: 'Consecutive tracked days on the mound.' });
    if (isNum(row.vDelta) && row.vDelta >= 1.5) alerts.push({ kind: 'good', title: `${row.name}: fastball up ${row.vDelta.toFixed(1)} mph`, body: `${lastDay} averaged ${fmt(vLast)} mph — new velo band.` });
  }

  const goalRows = state.goals.map((g) => {
    const m = PITCH_METRICS[g.metric] || HIT_METRICS[g.metric];
    if (!m) return null;
    const role = PITCH_METRICS[g.metric] ? 'pitcherKey' : 'batterKey';
    const ps = state.pitches.filter((p) => p[role] === g.playerId && (!g.pitchType || p.pitchType === g.pitchType) && p.date >= d30);
    const cur = m.fn(ps) * (m.scale || 1);
    const base = isNum(g.baseline) ? g.baseline : NaN;
    const progress = isNum(cur) && isNum(base) && g.target !== base ? Math.max(0, Math.min(1, (cur - base) / (g.target - base))) : NaN;
    return { ...g, m, cur, progress, name: playerName(g.playerId) };
  }).filter(Boolean);

  root.appendChild(h('div', { class: 'grid g2' },
    card('Alerts & flags', alerts.length ? alerts.map((a) => h('div', { class: `alert ${a.kind}` },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, a.kind === 'good' ? '▲' : a.kind === 'critical' ? '!' : '•'),
      h('div', null, h('b', null, a.title), h('span', { class: 'small muted' }, a.body)))) : h('p', { class: 'muted' }, 'No flags. Thresholds live in config.js (ALERTS).')),
    card('Pitcher workload', table([
      { key: 'name', label: 'Pitcher' },
      { key: 'last7', label: 'Pitches 7 d', num: true },
      { key: 'days7', label: 'Days 7 d', num: true },
      { key: 'lastDay', label: 'Last outing' },
      { key: 'vLast', label: 'Last FB velo', num: true, fmt: (v) => fmt(v) },
      { key: 'vDelta', label: 'vs 30 d', num: true, fmt: (v) => (isNum(v) ? h('span', { class: v >= 0 ? 'up' : 'down' }, `${v >= 0 ? '+' : ''}${v.toFixed(1)}`) : '—') },
    ], workload.sort((a, b) => b.last7 - a.last7), { onRowClick: (r) => { filters.pitcher = r.id; navigate('pitching'); } }))));

  // ---- biggest movers: last 30 d vs the 30 d before ----
  const movers = [];
  const window = (ps, a, b) => ps.filter((p) => p.date >= a && p.date <= b);
  for (const [id, ps] of byPitcher) {
    const fb = ps.filter((p) => pitchClass(p.pitchType) === 'FB');
    const a = maxOf(window(fb, d30, latest), 'velo'), b = maxOf(window(fb, d60, addDays(d30, -1)), 'velo');
    if (isNum(a) && isNum(b)) movers.push({ id, name: playerName(id), metric: 'FB max velo', now: a, before: b, delta: a - b, unit: 'mph', role: 'P' });
  }
  const byHitter = groupBy(state.pitches.filter((p) => p.batterKey && !skip.has(p.batterKey)), (p) => p.batterKey);
  for (const [id, ps] of byHitter) {
    const ev = (x) => quantile(x.map((p) => p.ev).filter(isNum), 0.9);
    const a = ev(window(ps, d30, latest)), b = ev(window(ps, d60, addDays(d30, -1)));
    if (isNum(a) && isNum(b)) movers.push({ id, name: playerName(id), metric: 'EV90', now: a, before: b, delta: a - b, unit: 'mph', role: 'H' });
    const bs = avgOf(window(ps, d30, latest), 'batSpeed'), bs0 = avgOf(window(ps, d60, addDays(d30, -1)), 'batSpeed');
    if (isNum(bs) && isNum(bs0)) movers.push({ id, name: playerName(id), metric: 'Bat speed', now: bs, before: bs0, delta: bs - bs0, unit: 'mph', role: 'H' });
  }

  const leaders = [];
  for (const [id, ps] of byPitcher) leaders.push({ id, name: playerName(id), role: 'P', v1: maxOf(ps.filter((p) => pitchClass(p.pitchType) === 'FB' && p.date >= d30), 'velo'), v2: avgOf(ps.filter((p) => p.date >= d30), 'stuff') });
  const hitLeaders = [...byHitter].map(([id, ps]) => {
    const r = ps.filter((p) => p.date >= d30);
    return { id, name: playerName(id), ev90: quantile(r.map((p) => p.ev).filter(isNum), 0.9), evMax: maxOf(r, 'ev'), bat: avgOf(r, 'batSpeed') };
  });

  root.appendChild(h('div', { class: 'grid g3', style: { marginTop: '16px' } },
    card('Biggest movers (last 30 d vs prior 30 d)', movers.length ? table([
      { key: 'name', label: 'Player' }, { key: 'metric', label: 'Metric' },
      { key: 'now', label: 'Now', num: true, fmt: (v) => fmt(v) },
      { key: 'delta', label: 'Δ', num: true, fmt: (v) => h('span', { class: v >= 0 ? 'up' : 'down' }, `${v >= 0 ? '+' : ''}${v.toFixed(1)}`) },
    ], movers.sort((a, b) => b.delta - a.delta).slice(0, 10), { onRowClick: (r) => { if (r.role === 'P') { filters.pitcher = r.id; navigate('pitching'); } else { filters.hitter = r.id; navigate('hitting'); } } }) : h('p', { class: 'muted' }, 'Needs two 30-day windows of data.')),
    card('Pitching leaders (30 d)', table([
      { key: 'name', label: 'Pitcher' },
      { key: 'v1', label: 'FB max', num: true, fmt: (v) => fmt(v) },
      { key: 'v2', label: 'DI Stuff', num: true, fmt: (v) => fmt(v, 0) },
    ], leaders.filter((l) => isNum(l.v1)).sort((a, b) => b.v1 - a.v1), { onRowClick: (r) => { filters.pitcher = r.id; navigate('pitching'); } })),
    card('Hitting leaders (30 d)', table([
      { key: 'name', label: 'Hitter' },
      { key: 'ev90', label: 'EV90', num: true, fmt: (v) => fmt(v) },
      { key: 'evMax', label: 'Max EV', num: true, fmt: (v) => fmt(v) },
      { key: 'bat', label: 'Bat spd', num: true, fmt: (v) => fmt(v) },
    ], hitLeaders.filter((l) => isNum(l.ev90) || isNum(l.bat)).sort((a, b) => (b.ev90 || 0) - (a.ev90 || 0)), { onRowClick: (r) => { filters.hitter = r.id; navigate('hitting'); } }))));

  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Development goals', goalRows.length ? table([
      { key: 'name', label: 'Player' },
      { key: 'm', label: 'Goal', fmt: (m, g) => `${m.label}${g.pitchType ? ' · ' + g.pitchType : ''} → ${g.target}${m.unit}` },
      { key: 'cur', label: 'Now (30 d)', num: true, fmt: (v, g) => fmt(v, g.m.d) },
      { key: 'progress', label: 'Progress', fmt: (v) => (isNum(v) ? h('div', { style: { minWidth: '100px' } }, h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(v * 100), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: `${v * 100}%` } })), h('span', { class: 'small muted' }, `${Math.round(v * 100)}%`)) : '—') },
      { key: 'due', label: 'Due' },
    ], goalRows, { onRowClick: (g) => navigate(`players/${encodeURIComponent(g.playerId)}`) }) : h('p', { class: 'muted' }, 'No goals yet. Open a player profile to set velocity, shape, EV or bat-speed targets.')),
    card('Recent sessions', table([
      { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'label', label: 'Label' }, { key: 'count', label: 'Rows', num: true },
      { key: 'id', label: 'Video', fmt: (id) => (state.videos.some((v) => v.sessionId === id) ? '▶' : '') },
    ], state.sessions.slice(0, 10), { onRowClick: (s) => navigate(`video/${s.id}`) }))));
}
