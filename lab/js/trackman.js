// Trackman / swing-sensor CSV ingestion: parse, map columns, normalise
// pitch types and calls, and build session + pitch records.

import { displayName, playerIdFromName, hashId, isNum, localISO } from './util.js';

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Canonical field -> accepted header spellings (compared case/space-insensitively).
// Covers Trackman Baseball v3 exports, Trackman portable/bullpen exports,
// Blast Motion and generic bat-sensor exports.
const ALIASES = {
  pitchNo: ['PitchNo', 'Pitch No', 'PitchNumber', 'No'],
  date: ['Date', 'GameDate', 'Session Date'],
  time: ['Time', 'PitchTime'],
  utc: ['UTCDateTime', 'LocalDateTime'],
  pitchUid: ['PitchUID', 'PitchGuid', 'PlayID'],
  pitcher: ['Pitcher', 'PitcherName', 'Pitcher Name'],
  pitcherId: ['PitcherId', 'PitcherID'],
  throws: ['PitcherThrows', 'Throws'],
  pitcherTeam: ['PitcherTeam'],
  batter: ['Batter', 'BatterName', 'Batter Name', 'Player', 'Player Name', 'Hitter'],
  batterId: ['BatterId', 'BatterID'],
  bats: ['BatterSide', 'Bats', 'Handedness'],
  batterTeam: ['BatterTeam'],
  inning: ['Inning'],
  outs: ['Outs'],
  balls: ['Balls'],
  strikes: ['Strikes'],
  paOfInning: ['PAofInning'],
  pitchOfPA: ['PitchofPA'],
  taggedType: ['TaggedPitchType', 'Pitch Type', 'PitchType'],
  autoType: ['AutoPitchType'],
  call: ['PitchCall', 'Pitch Call', 'Result'],
  korbb: ['KorBB'],
  playResult: ['PlayResult'],
  hitType: ['TaggedHitType', 'AutoHitType'],
  velo: ['RelSpeed', 'Release Speed', 'Velocity', 'Speed', 'Pitch Speed'],
  spin: ['SpinRate', 'Spin Rate', 'Total Spin'],
  axis: ['SpinAxis', 'Spin Axis'],
  tilt: ['Tilt'],
  relH: ['RelHeight', 'Release Height'],
  relS: ['RelSide', 'Release Side'],
  ext: ['Extension'],
  vra: ['VertRelAngle'],
  hra: ['HorzRelAngle'],
  vb: ['VertBreak'],
  ivb: ['InducedVertBreak', 'IVB', 'Induced Vertical Break', 'Induced Vert. Break'],
  hb: ['HorzBreak', 'HB', 'Horizontal Break', 'Horz. Break'],
  plateZ: ['PlateLocHeight', 'Strike Zone Height', 'PlateHeight'],
  plateX: ['PlateLocSide', 'Strike Zone Side', 'PlateSide'],
  zoneSpeed: ['ZoneSpeed'],
  vaa: ['VertApprAngle', 'VAA', 'Vertical Approach Angle'],
  haa: ['HorzApprAngle', 'HAA', 'Horizontal Approach Angle'],
  zoneTime: ['ZoneTime'],
  effVelo: ['EffectiveVelo'],
  spinEff3d: ['SpinAxis3dSpinEfficiency', 'Spin Efficiency', 'SpinEfficiency'],
  activeSpin: ['SpinAxis3dActiveSpinRate', 'Active Spin'],
  gyro: ['SpinAxis3dLongitudinalAngle', 'Gyro Degree'],
  ev: ['ExitSpeed', 'Exit Speed', 'Exit Velocity', 'EV'],
  la: ['Angle', 'Launch Angle', 'LaunchAngle'],
  dir: ['Direction', 'Launch Direction', 'Spray Angle'],
  dist: ['Distance', 'Carry'],
  hang: ['HangTime'],
  hitSpin: ['HitSpinRate'],
  contactX: ['ContactPositionX'],
  contactY: ['ContactPositionY'],
  contactZ: ['ContactPositionZ'],
  batSpeed: ['BatSpeed', 'Bat Speed (mph)', 'Bat Speed', 'Bat Speed mph'],
  attackAngle: ['AttackAngle', 'VerticalAttackAngle', 'Attack Angle (deg)', 'Attack Angle'],
  vba: ['VerticalBatAngle', 'Vertical Bat Angle (deg)', 'Vertical Bat Angle'],
  ttc: ['TimeToContact', 'Time to Contact (sec)', 'Time to Contact'],
  handSpeed: ['Peak Hand Speed (mph)', 'HandSpeed', 'Peak Hand Speed'],
  rotAcc: ['Rotational Acceleration (g)', 'RotationalAcceleration', 'Rotational Acceleration'],
  onPlane: ['On Plane Efficiency (%)', 'OnPlaneEfficiency', 'On Plane Efficiency'],
  earlyConn: ['Early Connection (deg)', 'EarlyConnection'],
  connImpact: ['Connection at Impact (deg)', 'ConnectionAtImpact'],
  power: ['Power (kW)', 'Power'],
  swingLength: ['SwingLength', 'Swing Length'],
  notes: ['Notes', 'Swing Details', 'Tag'],
  level: ['Level'],
  stadium: ['Stadium'],
  targetX: ['TargetX', 'TargetSide'],
  targetZ: ['TargetZ', 'TargetHeight'],
};

const NUMERIC = new Set(['pitchNo', 'inning', 'outs', 'balls', 'strikes', 'paOfInning', 'pitchOfPA',
  'velo', 'spin', 'axis', 'relH', 'relS', 'ext', 'vra', 'hra', 'vb', 'ivb', 'hb', 'plateZ', 'plateX',
  'zoneSpeed', 'vaa', 'haa', 'zoneTime', 'effVelo', 'spinEff3d', 'activeSpin', 'gyro', 'ev', 'la', 'dir',
  'dist', 'hang', 'hitSpin', 'contactX', 'contactY', 'contactZ', 'batSpeed', 'attackAngle', 'vba', 'ttc',
  'handSpeed', 'rotAcc', 'onPlane', 'earlyConn', 'connImpact', 'power', 'swingLength', 'targetX', 'targetZ']);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export function mapHeaders(header) {
  const idx = new Map(header.map((hname, i) => [norm(hname), i]));
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      const i = idx.get(norm(n));
      if (i !== undefined) { map[field] = i; break; }
    }
  }
  return map;
}

// Blast and similar exports put a few metadata lines above the real header.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = mapHeaders(rows[i]);
    const hits = Object.keys(m).length;
    if (hits >= 3 && (m.velo !== undefined || m.batSpeed !== undefined || m.ev !== undefined || m.pitcher !== undefined)) return i;
  }
  return 0;
}

export const PITCH_TYPES = {
  FF: 'Four-Seam', SI: 'Sinker', CT: 'Cutter', SL: 'Slider', SW: 'Sweeper',
  CB: 'Curveball', CH: 'Changeup', SP: 'Splitter', KN: 'Knuckleball', OT: 'Other',
};
export const PITCH_ORDER = ['FF', 'SI', 'CT', 'SL', 'SW', 'CB', 'CH', 'SP', 'KN', 'OT'];

export function normPitchType(raw) {
  const s = norm(raw || '');
  if (!s || s === 'undefined' || s === 'other' || s === 'none') return null;
  if (/^(ff|fa|fourseam|fourseamfastball|fastball|4seam|4seamfastball)$/.test(s)) return 'FF';
  if (/^(si|ft|sinker|twoseam|twoseamfastball|2seam|2seamfastball)$/.test(s)) return 'SI';
  if (/^(fc|ct|cut|cutter)$/.test(s)) return 'CT';
  if (/^(st|sw|sweeper)$/.test(s)) return 'SW';
  if (/^(sl|slider|gyroslider)$/.test(s)) return 'SL';
  if (/^(cu|cb|kc|sv|curveball|curve|knucklecurve|slurve)$/.test(s)) return 'CB';
  if (/^(ch|changeup|change)$/.test(s)) return 'CH';
  if (/^(fs|sp|splitter|split|splitfinger|forkball)$/.test(s)) return 'SP';
  if (/^(kn|knuckleball)$/.test(s)) return 'KN';
  return 'OT';
}

export function pitchClass(type) {
  if (type === 'FF' || type === 'SI') return 'FB';
  if (type === 'CT' || type === 'SL' || type === 'SW' || type === 'CB') return 'BR';
  if (type === 'CH' || type === 'SP' || type === 'KN') return 'OS';
  return 'OT';
}

const CALLS = {
  ballcalled: 'Ball', ball: 'Ball', ballintentional: 'Ball', balliniondirt: 'Ball', ballindirt: 'Ball',
  strikecalled: 'CalledStrike', calledstrike: 'CalledStrike',
  strikeswinging: 'Whiff', swingingstrike: 'Whiff', whiff: 'Whiff',
  foulball: 'Foul', foul: 'Foul', foulballnotfieldable: 'Foul', foulballfieldable: 'Foul', foultip: 'Foul',
  inplay: 'InPlay', hitbypitch: 'HBP',
};

export function normCall(raw) {
  const s = norm(raw);
  if (!s || s === 'undefined') return null;
  return CALLS[s] || raw;
}

export const isSwing = (c) => c === 'Whiff' || c === 'Foul' || c === 'InPlay';

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : localISO(d);
}

// Seconds since local midnight, keeping Trackman's hundredths for video sync.
export function parseTime(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let hr = +m[1];
  const ap = m[4] && m[4][0].toLowerCase();
  if (ap === 'p' && hr < 12) hr += 12;
  if (ap === 'a' && hr === 12) hr = 0;
  return hr * 3600 + +m[2] * 60 + (m[3] ? parseFloat(m[3]) : 0);
}

export function fmtClock(sec) {
  if (!isNum(sec)) return '—';
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}`;
}

// Command targets entered by a coach in Trackman's Notes column, e.g. "T5",
// "tgt 13". Zones are the 3x3 grid (1-9, catcher's view, top-left = 1) plus
// the four chase quadrants 11-14.
export const ZONE_TARGETS = {
  1: [-0.47, 3.17], 2: [0, 3.17], 3: [0.47, 3.17],
  4: [-0.47, 2.5], 5: [0, 2.5], 6: [0.47, 2.5],
  7: [-0.47, 1.83], 8: [0, 1.83], 9: [0.47, 1.83],
  11: [-1.0, 3.8], 12: [1.0, 3.8], 13: [-1.0, 1.2], 14: [1.0, 1.2],
};

export function targetFromNote(note) {
  const m = String(note || '').match(/\b(?:t|tgt|target)\s*[:#-]?\s*(1[1-4]|[1-9])\b/i);
  if (!m) return null;
  const [x, z] = ZONE_TARGETS[+m[1]];
  return { x, z, zone: +m[1] };
}

export function inferSource(map) {
  if (map.pitcher !== undefined || map.velo !== undefined) return 'trackman';
  if (map.batSpeed !== undefined) return 'swing-sensor';
  return 'unknown';
}

// Build normalised session + pitch records from one CSV file.
// opts: { fileName, sessionType, defaultBatter, defaultDate, level }
export function ingest(text, opts = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('File has no data rows');
  const hi = findHeaderRow(rows);
  const map = mapHeaders(rows[hi]);
  const source = inferSource(map);
  if (source === 'unknown') throw new Error('Could not recognise Trackman or bat-sensor columns in this file');

  const get = (r, f) => (map[f] === undefined ? undefined : r[map[f]]);
  const pitches = [];
  const sessionsByDate = new Map();

  rows.slice(hi + 1).forEach((r, rowIdx) => {
    if (r.length < 3) return;
    const p = {};
    for (const f of Object.keys(map)) {
      const raw = get(r, f);
      if (NUMERIC.has(f)) {
        const v = raw === undefined || raw === '' ? NaN : parseFloat(raw);
        if (Number.isFinite(v)) p[f] = v;
      } else if (raw !== undefined && raw !== '') p[f] = raw.trim();
    }
    // Blast-style rows carry date+time in one field.
    p.date = parseDate(p.date) || parseDate(p.utc) || opts.defaultDate || null;
    p.tod = parseTime(p.time) ?? parseTime(p.date && get(r, 'date'));
    if (!p.date) return;
    if (p.ivb === undefined && p.vb !== undefined && source !== 'trackman') p.ivb = p.vb;
    if (p.onPlane !== undefined && p.onPlane > 1.5) p.onPlane /= 100;
    if (p.spinEff3d !== undefined && p.spinEff3d > 1.5) p.spinEff3d /= 100;

    p.pitchType = normPitchType(p.taggedType) || normPitchType(p.autoType);
    p.call = normCall(p.call);
    if (p.pitcher) {
      p.pitcherName = displayName(p.pitcher);
      p.pitcherKey = playerIdFromName(p.pitcher);
    }
    const batterRaw = p.batter || opts.defaultBatter;
    if (batterRaw) {
      p.batterName = displayName(batterRaw);
      p.batterKey = playerIdFromName(batterRaw);
    }
    if (p.throws) p.throws = p.throws[0].toUpperCase();
    if (p.bats) p.bats = p.bats[0].toUpperCase();
    p.kind = source === 'trackman' ? 'pitch' : 'swing';

    const sKey = p.date;
    if (!sessionsByDate.has(sKey)) {
      sessionsByDate.set(sKey, {
        id: 's-' + hashId((opts.fileName || 'upload') + '|' + sKey + '|' + (opts.sessionType || '')),
        date: p.date,
      });
    }
    p.sessionId = sessionsByDate.get(sKey).id;
    p.uid = p.pitchUid || `${p.sessionId}-${p.pitchNo ?? rowIdx}-${p.time || rowIdx}-${p.pitcherKey || p.batterKey || ''}`;
    p.rowIdx = rowIdx;
    delete p.pitcher; delete p.batter; delete p.utc;
    pitches.push(p);
  });

  if (!pitches.length) throw new Error('No rows with a usable date were found');

  const sessions = [...sessionsByDate.values()].map((s) => {
    const ps = pitches.filter((p) => p.sessionId === s.id);
    const hasBatters = ps.some((p) => p.batterKey && p.call && p.call !== 'Ball' && p.kind === 'pitch');
    let type = opts.sessionType;
    if (!type || type === 'auto') {
      if (source === 'swing-sensor') type = 'cage';
      else if (!hasBatters) type = 'bullpen';
      else type = ps.some((p) => p.inning) ? 'game' : 'live';
    }
    return {
      ...s,
      type,
      source,
      fileName: opts.fileName || null,
      level: opts.level || ps.find((p) => p.level)?.level || null,
      venue: ps.find((p) => p.stadium)?.stadium || null,
      label: opts.label || null,
      pitchers: [...new Set(ps.map((p) => p.pitcherKey).filter(Boolean))],
      batters: [...new Set(ps.map((p) => p.batterKey).filter(Boolean))],
      count: ps.length,
      importedAt: new Date().toISOString(),
    };
  });

  const typeById = new Map(sessions.map((s) => [s.id, s.type]));
  for (const p of pitches) p.sessionType = typeById.get(p.sessionId);

  const targets = [];
  for (const p of pitches) {
    if (isNum(p.targetX) && isNum(p.targetZ)) targets.push({ uid: p.uid, x: p.targetX, z: p.targetZ, src: 'csv' });
    else {
      const t = targetFromNote(p.notes);
      if (t) targets.push({ uid: p.uid, x: t.x, z: t.z, zone: t.zone, src: 'note' });
    }
  }

  return { source, map, sessions, pitches, targets };
}

// Player records implied by the pitches; merged into the roster without
// overwriting anything a coach has edited.
export function playersFrom(pitches) {
  const out = new Map();
  for (const p of pitches) {
    if (p.pitcherKey) {
      const x = out.get(p.pitcherKey) || { id: p.pitcherKey, name: p.pitcherName, roles: new Set() };
      x.roles.add('P');
      if (p.throws) x.throws = p.throws;
      if (p.pitcherTeam) x.team = p.pitcherTeam;
      out.set(p.pitcherKey, x);
    }
    if (p.batterKey) {
      const x = out.get(p.batterKey) || { id: p.batterKey, name: p.batterName, roles: new Set() };
      x.roles.add('H');
      if (p.bats) x.bats = p.bats;
      if (p.batterTeam) x.team = x.team || p.batterTeam;
      out.set(p.batterKey, x);
    }
  }
  // Pitching machines / coaches throwing BP shouldn't show up as players.
  const NON_PLAYER = /machine|iron mike|hack attack|juggs|junior hack|coach|bp thrower/i;
  return [...out.values()].map((x) => ({ ...x, roles: [...x.roles], ...(NON_PLAYER.test(x.name) ? { nonPlayer: true } : {}) }));
}
