// Pure analytics: no DOM. Pitch design, command, batted ball, swing and
// timing metrics, plus development-curve helpers. Units follow Trackman:
// mph, rpm, inches for break, feet for location/release.

import { STUFF_MODEL, ZONE, HIT } from './config.js';
import { isSwing, pitchClass, PITCH_ORDER } from './trackman.js';
import { isNum, groupBy, daysBetween } from './util.js';

// ---------- basic stats ----------
const vals = (arr, f) => arr.map(typeof f === 'function' ? f : (x) => x[f]).filter(isNum);
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
export const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
export const max = (a) => (a.length ? Math.max(...a) : NaN);
export const avgOf = (arr, f) => mean(vals(arr, f));
export const maxOf = (arr, f) => max(vals(arr, f));
export const sdOf = (arr, f) => sd(vals(arr, f));
const rate = (arr, pred, denomPred = () => true) => {
  const d = arr.filter(denomPred);
  return d.length ? d.filter(pred).length / d.length : NaN;
};

// Circular mean for spin axis / tilt (degrees, 0-360).
export function circMean(degs) {
  if (!degs.length) return NaN;
  let sx = 0, sy = 0;
  for (const d of degs) { sx += Math.cos((d * Math.PI) / 180); sy += Math.sin((d * Math.PI) / 180); }
  const m = (Math.atan2(sy, sx) * 180) / Math.PI;
  return (m + 360) % 360;
}

// Trackman spin axis (180 = pure backspin, 12:00) -> clock face "h:mm".
export function axisToClock(axis) {
  if (!isNum(axis)) return '—';
  let minutes = Math.round(((axis + 180) % 360) * 2); // 360 deg = 720 min
  minutes = ((minutes % 720) + 720) % 720;
  let hr = Math.floor(minutes / 60);
  const mn = minutes % 60;
  if (hr === 0) hr = 12;
  return `${hr}:${String(mn).padStart(2, '0')}`;
}

// ---------- zone ----------
export const inZone = (p) => isNum(p.plateX) && isNum(p.plateZ) &&
  Math.abs(p.plateX) <= ZONE.halfWidth && p.plateZ >= ZONE.bottom && p.plateZ <= ZONE.top;

export function onEdge(p) {
  if (!isNum(p.plateX) || !isNum(p.plateZ)) return false;
  const e = ZONE.edgeIn / 12;
  const inner = Math.abs(p.plateX) <= ZONE.halfWidth - e && p.plateZ >= ZONE.bottom + e && p.plateZ <= ZONE.top - e;
  const outer = Math.abs(p.plateX) <= ZONE.halfWidth + e && p.plateZ >= ZONE.bottom - e && p.plateZ <= ZONE.top + e;
  return outer && !inner;
}

// ---------- pitch physics ----------
// Spin efficiency estimate when Trackman's 3D spin columns are absent.
// Infers transverse spin from total movement using the Sawicki lift model
// (C_L = 1.5S for S<0.1, else 0.09 + 0.6S) and sea-level air density.
export function spinEfficiency(p) {
  if (isNum(p.spinEff3d)) return p.spinEff3d;
  if (!isNum(p.spin) || !isNum(p.velo) || !isNum(p.ivb) || !isNum(p.hb) || p.spin < 300) return NaN;
  const r = 0.0366, K = (0.5 * 1.225 * Math.PI * r * r) / 0.145;
  const vRel = p.velo * 0.44704;
  const vPlate = isNum(p.zoneSpeed) ? p.zoneSpeed * 0.44704 : vRel * 0.91;
  const v = (vRel + vPlate) / 2;
  const dist = (60.5 - (isNum(p.ext) ? p.ext : 6)) * 0.3048;
  const t = isNum(p.zoneTime) && p.zoneTime > 0.2 ? p.zoneTime : dist / v;
  const move = Math.hypot(p.ivb, p.hb) * 0.0254;
  const a = (2 * move) / (t * t);
  const cl = a / (K * v * v);
  const S = cl < 0.15 ? cl / 1.5 : (cl - 0.09) / 0.6;
  const wT = (S * v) / r; // rad/s
  const rpm = (wT * 60) / (2 * Math.PI);
  return Math.max(0, Math.min(1, rpm / p.spin));
}

// VAA normalised to a 2.5 ft plate height so high and low pitches compare.
export const vaaAdj = (p) => (isNum(p.vaa) && isNum(p.plateZ) ? p.vaa - 0.9 * (p.plateZ - 2.5) : NaN);

// Primary fastball shape for a pitcher within a set of pitches.
export function primaryFastball(pitches) {
  const fb = groupBy(pitches.filter((p) => p.pitchType === 'FF' || p.pitchType === 'SI'), (p) => p.pitchType);
  let best = null;
  for (const [type, ps] of fb) if (!best || ps.length > best.ps.length) best = { type, ps };
  if (!best) return null;
  return { type: best.type, velo: avgOf(best.ps, 'velo'), ivb: avgOf(best.ps, 'ivb'), hb: avgOf(best.ps, 'hb') };
}

function stuffFeatures(p, fb) {
  const f = { velo: p.velo, ivb: p.ivb, absHb: isNum(p.hb) ? Math.abs(p.hb) : NaN, vaaAdj: vaaAdj(p), ext: p.ext, spin: p.spin };
  if (fb) {
    f.veloDiff = fb.velo - p.velo;
    f.sep = Math.hypot(p.ivb - fb.ivb, p.hb - fb.hb);
    f.hSep = Math.abs(p.hb - fb.hb);
    f.ivbDiff = fb.ivb - p.ivb;
  }
  return f;
}

export function stuffScore(p, fb) {
  const model = STUFF_MODEL[p.pitchType];
  if (!model) return NaN;
  const f = stuffFeatures(p, fb);
  let z = 0, w = 0;
  for (const [k, [mu, sigma, weight]] of Object.entries(model)) {
    if (!isNum(f[k])) continue;
    let x = f[k];
    if (k === 'veloDiff') x = Math.min(x, 12); // beyond ~12 mph the CH stops gaining
    z += weight * ((x - mu) / sigma);
    w += Math.abs(weight);
  }
  if (w < 0.5) return NaN; // not enough of the model's inputs present
  return Math.max(40, Math.min(160, 100 + (10 * z) / w));
}

// Stamp per-pitch derived values (spin efficiency, DI Stuff) once after load.
// Stuff needs the pitcher's fastball from the same day as context, so it is
// computed per pitcher-date rather than inside each filtered view.
export function derive(pitches) {
  const groups = groupBy(pitches.filter((p) => p.kind === 'pitch' && p.pitcherKey), (p) => p.pitcherKey + '|' + p.date);
  for (const ps of groups.values()) {
    const fb = primaryFastball(ps);
    for (const p of ps) {
      p.spinEff = spinEfficiency(p);
      p.stuff = stuffScore(p, fb && p.pitchType !== fb.type ? fb : null);
    }
  }
  return pitches;
}

// ---------- command ----------
export function missInches(p, target) {
  if (!target || !isNum(p.plateX) || !isNum(p.plateZ)) return NaN;
  return Math.hypot(p.plateX - target.x, p.plateZ - target.z) * 12;
}

// 2D location dispersion (inches): root of summed variances. Lower = tighter.
export function dispersion(ps) {
  const sx = sdOf(ps, 'plateX'), sz = sdOf(ps, 'plateZ');
  return isNum(sx) && isNum(sz) ? Math.sqrt(sx * sx + sz * sz) * 12 : NaN;
}

export function commandSummary(ps, targets) {
  const withT = ps.filter((p) => targets.has(p.uid) && isNum(p.plateX));
  const misses = withT.map((p) => missInches(p, targets.get(p.uid)));
  return {
    n: ps.length,
    zonePct: rate(ps, inZone, (p) => isNum(p.plateX)),
    edgePct: rate(ps, onEdge, (p) => isNum(p.plateX)),
    dispersion: dispersion(ps),
    relHsd: sdOf(ps, 'relH') * 12,
    relSsd: sdOf(ps, 'relS') * 12,
    targeted: withT.length,
    avgMiss: mean(misses),
    medMiss: quantile(misses, 0.5),
    hitSpot6: misses.length ? misses.filter((m) => m <= 6).length / misses.length : NaN,
    hitSpot12: misses.length ? misses.filter((m) => m <= 12).length / misses.length : NaN,
  };
}

// ---------- arsenal ----------
export function arsenal(pitches, targets = new Map()) {
  const fb = primaryFastball(pitches);
  const total = pitches.length;
  const groups = groupBy(pitches.filter((p) => p.pitchType), (p) => p.pitchType);
  const rows = [];
  for (const type of PITCH_ORDER) {
    const ps = groups.get(type);
    if (!ps) continue;
    const swings = ps.filter((p) => isSwing(p.call));
    const out = ps.filter((p) => p.batterKey && p.call && isNum(p.plateX) && !inZone(p));
    const cmd = commandSummary(ps, targets);
    rows.push({
      type, n: ps.length, usage: ps.length / total,
      velo: avgOf(ps, 'velo'), veloMax: maxOf(ps, 'velo'),
      spin: avgOf(ps, 'spin'), axis: circMean(vals(ps, 'axis')),
      ivb: avgOf(ps, 'ivb'), hb: avgOf(ps, 'hb'),
      ivbSd: sdOf(ps, 'ivb'), hbSd: sdOf(ps, 'hb'),
      vaa: avgOf(ps, 'vaa'), haa: avgOf(ps, 'haa'),
      relH: avgOf(ps, 'relH'), relS: avgOf(ps, 'relS'), ext: avgOf(ps, 'ext'),
      spinEff: avgOf(ps, 'spinEff'),
      stuff: avgOf(ps, 'stuff'),
      zonePct: cmd.zonePct, edgePct: cmd.edgePct, dispersion: cmd.dispersion, avgMiss: cmd.avgMiss,
      whiffPct: swings.length ? swings.filter((p) => p.call === 'Whiff').length / swings.length : NaN,
      chasePct: out.length ? out.filter((p) => isSwing(p.call)).length / out.length : NaN,
      cswPct: rate(ps, (p) => p.call === 'Whiff' || p.call === 'CalledStrike', (p) => !!p.call),
      evAgainst: avgOf(ps.filter((p) => p.call === 'InPlay'), 'ev'),
      veloDiff: fb && type !== fb.type ? fb.velo - avgOf(ps, 'velo') : NaN,
    });
  }
  return { rows, fb };
}

// Pitch design: how far each pitch is from the primary fastball and from a
// target shape the coach sets (e.g. "sweeper at 16 HB / 0 IVB").
export function shapeGap(row, target) {
  if (!target) return null;
  const dIvb = isNum(target.ivb) ? target.ivb - row.ivb : NaN;
  const dHb = isNum(target.hb) ? target.hb - row.hb : NaN;
  const dVelo = isNum(target.velo) ? target.velo - row.velo : NaN;
  const dSpin = isNum(target.spin) ? target.spin - row.spin : NaN;
  return { dIvb, dHb, dVelo, dSpin, dist: Math.hypot(isNum(dIvb) ? dIvb : 0, isNum(dHb) ? dHb : 0) };
}

// Within-session velocity fade: slope of FB velo vs pitch order (mph / 25 pitches).
export function veloFade(ps) {
  const fb = ps.filter((p) => pitchClass(p.pitchType) === 'FB' && isNum(p.velo));
  if (fb.length < 8) return NaN;
  const pts = fb.map((p, i) => [i, p.velo]);
  return linreg(pts).slope * 25;
}

// ---------- hitting ----------
export function isBarrel(ev, la) {
  // Approximation of the Statcast barrel window: 98 mph @ 26-30 deg, widening
  // by roughly 1 deg low / 1.1 deg high per extra mph, capped at 8-50 deg.
  if (!isNum(ev) || !isNum(la) || ev < 98) return false;
  const lo = Math.max(8, 26 - (ev - 98));
  const hi = Math.min(50, 30 + (ev - 98) * 1.1);
  return la >= lo && la <= hi;
}

// Squared-up: share of the max EV available from bat speed + pitch speed
// (Statcast: 1.23 * bat speed + 0.23 * pitch speed).
export function squaredUp(p) {
  if (!isNum(p.ev) || !isNum(p.batSpeed) || !isNum(p.velo)) return NaN;
  return p.ev / (1.23 * p.batSpeed + 0.23 * p.velo);
}

export function battedBallType(la) {
  if (!isNum(la)) return null;
  if (la < 10) return 'GB';
  if (la < 25) return 'LD';
  if (la < 50) return 'FB';
  return 'PU';
}

// Spray from the hitter's perspective: positive = pull.
export const pullAngle = (p) => (isNum(p.dir) ? (p.bats === 'L' ? p.dir : -p.dir) : NaN);
// Pitch location from the hitter's perspective: positive = inside (ft).
export const insideness = (p) => (isNum(p.plateX) ? (p.bats === 'L' ? p.plateX : -p.plateX) : NaN);

// Timing classification for a ball in play.
// 1) Trackman contact depth (ContactPositionX, ft in front of the plate) when present.
// 2) Otherwise spray angle relative to what pitch location predicts
//    (inside pitches are expected to be pulled): residual > +15 deg early, < -15 late.
export function timing(p) {
  if (isNum(p.contactX)) {
    const ideal = 1.0 + 0.8 * (isNum(insideness(p)) ? insideness(p) : 0);
    const d = p.contactX - ideal;
    return { label: d > 0.75 ? 'Early' : d < -0.75 ? 'Late' : 'On time', residual: d, basis: 'depth' };
  }
  const pa = pullAngle(p);
  if (!isNum(pa)) return null;
  const expected = 5 + 15 * (isNum(insideness(p)) ? insideness(p) : 0);
  const r = pa - expected;
  return { label: r > 15 ? 'Early' : r < -15 ? 'Late' : 'On time', residual: r, basis: 'spray' };
}

export function hittingSummary(ps) {
  const bip = ps.filter((p) => isNum(p.ev));
  const evs = vals(bip, 'ev');
  const las = vals(bip, 'la');
  const swingsLive = ps.filter((p) => isSwing(p.call) && (p.sessionType === 'live' || p.sessionType === 'game'));
  // Swing decisions only mean something against live pitching.
  const live = ps.filter((p) => p.call && (p.sessionType === 'live' || p.sessionType === 'game'));
  const zone = live.filter(inZone), chaseD = live.filter((p) => isNum(p.plateX) && !inZone(p));
  const sq = vals(ps, squaredUp);
  const tim = bip.map(timing).filter(Boolean);
  return {
    swings: ps.filter((p) => isNum(p.batSpeed) || isSwing(p.call) || isNum(p.ev)).length,
    bip: bip.length,
    evAvg: mean(evs), evMax: max(evs), ev90: quantile(evs, 0.9), evMed: quantile(evs, 0.5),
    laAvg: mean(las), laSd: sd(las),
    hardHit: evs.length ? evs.filter((e) => e >= HIT.hardHit).length / evs.length : NaN,
    sweetSpot: las.length ? las.filter((a) => a >= HIT.sweetSpot[0] && a <= HIT.sweetSpot[1]).length / las.length : NaN,
    barrel: bip.length ? bip.filter((p) => isBarrel(p.ev, p.la)).length / bip.length : NaN,
    distMax: maxOf(bip, 'dist'),
    pull: rate(bip, (p) => pullAngle(p) > 15, (p) => isNum(p.dir)),
    oppo: rate(bip, (p) => pullAngle(p) < -15, (p) => isNum(p.dir)),
    gb: rate(bip, (p) => battedBallType(p.la) === 'GB', (p) => isNum(p.la)),
    ld: rate(bip, (p) => battedBallType(p.la) === 'LD', (p) => isNum(p.la)),
    fbPct: rate(bip, (p) => battedBallType(p.la) === 'FB', (p) => isNum(p.la)),
    pu: rate(bip, (p) => battedBallType(p.la) === 'PU', (p) => isNum(p.la)),
    batSpeed: avgOf(ps, 'batSpeed'), batSpeedMax: maxOf(ps, 'batSpeed'), batSpeed90: quantile(vals(ps, 'batSpeed'), 0.9),
    attackAngle: avgOf(ps, 'attackAngle'), attackAngleSd: sdOf(ps, 'attackAngle'),
    vba: avgOf(ps, 'vba'), ttc: avgOf(ps, 'ttc'), handSpeed: avgOf(ps, 'handSpeed'),
    rotAcc: avgOf(ps, 'rotAcc'), onPlane: avgOf(ps, 'onPlane'), power: avgOf(ps, 'power'),
    squaredUp: sq.length ? sq.filter((x) => x >= HIT.squaredUp).length / sq.length : NaN,
    zSwing: zone.length ? zone.filter((p) => isSwing(p.call)).length / zone.length : NaN,
    chase: chaseD.length ? chaseD.filter((p) => isSwing(p.call)).length / chaseD.length : NaN,
    whiff: swingsLive.length ? swingsLive.filter((p) => p.call === 'Whiff').length / swingsLive.length : NaN,
    contactDepth: avgOf(bip, 'contactX'),
    early: tim.length ? tim.filter((t) => t.label === 'Early').length / tim.length : NaN,
    late: tim.length ? tim.filter((t) => t.label === 'Late').length / tim.length : NaN,
    onTime: tim.length ? tim.filter((t) => t.label === 'On time').length / tim.length : NaN,
  };
}

// ---------- development curves ----------
export function linreg(pts) {
  const n = pts.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  const slope = sxx ? sxy / sxx : NaN;
  return { slope, intercept: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : NaN };
}

// Collapse rows to one value per date using metricFn(rowsForDate), then fit a
// trend. Slope is reported per 30 days so it reads as "mph per month".
export function devCurve(rows, metricFn, minN = 1) {
  const byDate = groupBy(rows, (p) => p.date);
  const pts = [...byDate.entries()]
    .filter(([, ps]) => ps.length >= minN)
    .map(([date, ps]) => ({ date, value: metricFn(ps), n: ps.length }))
    .filter((d) => isNum(d.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return { pts, slope30: NaN, first: NaN, last: NaN, best: NaN };
  const d0 = pts[0].date;
  const fit = linreg(pts.map((d) => [daysBetween(d0, d.date), d.value]));
  // 3-session rolling mean smooths day-to-day noise for display.
  pts.forEach((d, i) => {
    const w = pts.slice(Math.max(0, i - 2), i + 1).map((x) => x.value);
    d.rolling = mean(w);
    d.fit = fit.intercept + fit.slope * daysBetween(d0, d.date);
  });
  return {
    pts, slope30: fit.slope * 30, r2: fit.r2,
    first: pts[0].value, last: pts[pts.length - 1].value,
    best: Math.max(...pts.map((d) => d.value)),
  };
}

// Metric catalogue used by goals, trend pickers and leaderboards.
// dir: +1 higher is better, -1 lower is better.
export const PITCH_METRICS = {
  velo: { label: 'Velo (avg)', unit: 'mph', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'velo') },
  veloMax: { label: 'Velo (max)', unit: 'mph', d: 1, dir: 1, fn: (ps) => maxOf(ps, 'velo') },
  spin: { label: 'Spin rate', unit: 'rpm', d: 0, dir: 1, fn: (ps) => avgOf(ps, 'spin') },
  ivb: { label: 'Induced vert. break', unit: 'in', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'ivb') },
  hb: { label: 'Horizontal break', unit: 'in', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'hb') },
  spinEff: { label: 'Spin efficiency', unit: '%', d: 0, dir: 1, scale: 100, fn: (ps) => avgOf(ps, 'spinEff') },
  vaa: { label: 'Vert. approach angle', unit: '°', d: 2, dir: 1, fn: (ps) => avgOf(ps, 'vaa') },
  ext: { label: 'Extension', unit: 'ft', d: 2, dir: 1, fn: (ps) => avgOf(ps, 'ext') },
  stuff: { label: 'DI Stuff', unit: '', d: 0, dir: 1, fn: (ps) => avgOf(ps, 'stuff') },
  zonePct: { label: 'Zone %', unit: '%', d: 0, dir: 1, scale: 100, fn: (ps) => rate(ps, inZone, (p) => isNum(p.plateX)) },
  dispersion: { label: 'Location dispersion', unit: 'in', d: 1, dir: -1, fn: dispersion },
  relHsd: { label: 'Release height SD', unit: 'in', d: 1, dir: -1, fn: (ps) => sdOf(ps, 'relH') * 12 },
};

export const HIT_METRICS = {
  evMax: { label: 'Max EV', unit: 'mph', d: 1, dir: 1, fn: (ps) => maxOf(ps, 'ev') },
  ev90: { label: 'EV90', unit: 'mph', d: 1, dir: 1, fn: (ps) => quantile(vals(ps, 'ev'), 0.9) },
  evAvg: { label: 'Avg EV', unit: 'mph', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'ev') },
  hardHit: { label: 'Hard-hit %', unit: '%', d: 0, dir: 1, scale: 100, fn: (ps) => { const e = vals(ps, 'ev'); return e.length ? e.filter((x) => x >= HIT.hardHit).length / e.length : NaN; } },
  sweetSpot: { label: 'Sweet-spot %', unit: '%', d: 0, dir: 1, scale: 100, fn: (ps) => { const a = vals(ps, 'la'); return a.length ? a.filter((x) => x >= HIT.sweetSpot[0] && x <= HIT.sweetSpot[1]).length / a.length : NaN; } },
  laAvg: { label: 'Avg launch angle', unit: '°', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'la') },
  distMax: { label: 'Max distance', unit: 'ft', d: 0, dir: 1, fn: (ps) => maxOf(ps, 'dist') },
  batSpeed: { label: 'Bat speed (avg)', unit: 'mph', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'batSpeed') },
  batSpeedMax: { label: 'Bat speed (max)', unit: 'mph', d: 1, dir: 1, fn: (ps) => maxOf(ps, 'batSpeed') },
  attackAngle: { label: 'Attack angle', unit: '°', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'attackAngle') },
  rotAcc: { label: 'Rotational accel.', unit: 'g', d: 1, dir: 1, fn: (ps) => avgOf(ps, 'rotAcc') },
  ttc: { label: 'Time to contact', unit: 's', d: 3, dir: -1, fn: (ps) => avgOf(ps, 'ttc') },
  onTime: { label: 'On-time %', unit: '%', d: 0, dir: 1, scale: 100, fn: (ps) => { const t = ps.filter((p) => isNum(p.ev)).map(timing).filter(Boolean); return t.length ? t.filter((x) => x.label === 'On time').length / t.length : NaN; } },
};
