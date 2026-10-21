// Mechanics Room: frame-by-frame slow-motion review with side-by-side
// comparison, angle/line drawing, and keyframe timing. Saved analyses build
// mechanics trends per player without any Trackman data.

import { h, card, table, toast, fmt, isNum, select, todayISO, confirmDialog } from '../util.js';
import { state, db } from '../store.js';
import { pageHeader, currentRoute, playerName } from '../app.js';
import { devCurve, mean } from '../metrics.js';
import { urls as clipUrls } from './video.js';
import * as C from '../charts.js';

// Keyframes in delivery / swing order. Intervals are reported between
// consecutive marks plus the few spans coaches ask for most.
const PHASES = {
  pitching: ['First move', 'Peak leg lift', 'Hand break', 'Foot strike', 'Max external rotation', 'Release', 'Finish'],
  hitting: ['Load start', 'Stride / heel plant', 'Launch', 'Contact', 'Finish'],
};
const KEY_SPANS = {
  pitching: [['Peak leg lift', 'Foot strike'], ['Foot strike', 'Release'], ['Max external rotation', 'Release'], ['First move', 'Release']],
  hitting: [['Load start', 'Contact'], ['Stride / heel plant', 'Contact'], ['Launch', 'Contact']],
};
const MEASURES = {
  pitching: ['Trunk tilt at release', 'Front knee angle at foot strike', 'Front knee angle at release', 'Arm slot at release', 'Shoulder tilt at foot strike', 'Hip-shoulder separation at foot strike', 'Stride direction', 'Elbow angle at foot strike'],
  hitting: ['Spine angle at contact', 'Front knee angle at contact', 'Bat angle at contact', 'Shoulder tilt at contact', 'Back elbow angle at launch', 'Head movement (line)'],
};

const panes = [newPane('A'), newPane('B')];
let kind = 'pitching';
let tool = 'none';
let rate = 0.25;
let linked = true;
let analysis = { playerId: '', date: todayISO(), notes: '', measures: [] };
let trendPlayer = '';
let trendMetric = '';
let keysBound = false;

function newPane(id) {
  return { id, url: null, name: '', video: null, canvas: null, marks: {}, shapes: [], pending: [], fps: 30, slow: 1, sessionId: null };
}

const spanName = ([a, b]) => `${a} → ${b}`;
const realMs = (pane, dt) => (dt * 1000) / (pane.slow || 1);

export default function mechanics(root, { rerender }) {
  root.appendChild(pageHeader('Mechanics Room', 'Slow-motion review, side-by-side comparison, angles and keyframe timing.'));
  bindKeys();

  root.appendChild(h('div', { class: 'filters' },
    h('label', { class: 'field' }, h('span', null, 'Movement'), select([['pitching', 'Pitching delivery'], ['hitting', 'Swing']], kind, (v) => { kind = v; rerender(); }, { id: 'mech-kind' })),
    h('label', { class: 'field' }, h('span', null, 'Playback speed'), select([['0.1', '0.1×'], ['0.25', '¼×'], ['0.5', '½×'], ['1', '1×']], String(rate), (v) => { rate = parseFloat(v); panes.forEach((p) => p.video && (p.video.playbackRate = rate)); }, { id: 'mech-rate' })),
    h('label', { class: 'field' }, h('span', null, 'Draw'), h('div', { class: 'chips' }, [['none', 'Off'], ['line', 'Line'], ['angle', 'Angle']].map(([v, l]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(tool === v), onclick: () => { tool = v; panes.forEach((p) => { p.pending = []; }); rerender(); } }, l)))),
    h('label', { class: 'field small' }, h('span', null, 'Controls'), h('span', null, h('input', { type: 'checkbox', id: 'mech-linked', checked: linked, onchange: (e) => { linked = e.target.checked; } }), ' Link both videos')),
    h('span', { class: 'muted small' }, 'Keys: Space play/pause · ← → one frame')));

  const both = (fn) => panes.forEach((p) => p.video && fn(p));
  const cuePhase = h('select', { id: 'mech-cue', 'aria-label': 'Cue both videos to keyframe' }, PHASES[kind].map((ph) => h('option', { value: ph }, ph)));
  root.appendChild(h('div', { class: 'transport' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => both((p) => { p.video.playbackRate = rate; p.video.play().catch(() => {}); }) }, '▶ Play both'),
    h('button', { class: 'btn', type: 'button', onclick: () => both((p) => p.video.pause()) }, '❚❚ Pause'),
    h('button', { class: 'btn', type: 'button', onclick: () => both((p) => step(p, -1)) }, '◀ Frame'),
    h('button', { class: 'btn', type: 'button', onclick: () => both((p) => step(p, 1)) }, 'Frame ▶'),
    h('span', { class: 'muted small' }, 'Cue both to'), cuePhase,
    h('button', { class: 'btn', type: 'button', onclick: () => {
      let n = 0;
      both((p) => { const t = p.marks[cuePhase.value]; if (isNum(t)) { p.video.pause(); p.video.currentTime = t; n++; } });
      if (!n) toast('Mark that keyframe on at least one video first', 'error');
    } }, 'Cue')));

  root.appendChild(h('div', { class: 'grid g2 mech-grid' }, panes.map((p) => paneView(p, rerender))));

  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    timingCard(rerender), measuresCard(rerender)));
  root.appendChild(saveCard(rerender));
  root.appendChild(trendsCard(rerender));
  // Canvases move with their videos on re-render; repaint the overlays.
  setTimeout(() => panes.forEach((p) => { draw(p); updateClock(p); }), 0);
}

// ---------------- video panes ----------------
function loadInto(pane, url, name, sessionId, rerender) {
  if (pane.url && pane.url !== url && pane.ownUrl) URL.revokeObjectURL(pane.url);
  Object.assign(pane, { url, name, sessionId: sessionId || null, marks: {}, shapes: [], pending: [] });
  pane.video = h('video', { playsinline: true, muted: true, preload: 'auto' });
  pane.video.muted = true;
  pane.video.src = url;
  pane.video.addEventListener('loadedmetadata', () => { pane.video.playbackRate = rate; draw(pane); });
  pane.video.addEventListener('timeupdate', () => updateClock(pane));
  pane.video.addEventListener('seeked', () => updateClock(pane));
  pane.canvas = h('canvas', { class: 'mech-overlay' });
  pane.canvas.addEventListener('pointerdown', (e) => onCanvas(pane, e, rerender));
  new ResizeObserver(() => draw(pane)).observe(pane.video);
  rerender();
}

function step(pane, dir) {
  if (!pane.video) return;
  pane.video.pause();
  pane.video.currentTime = Math.max(0, Math.min((pane.video.duration || 0) - 0.001, pane.video.currentTime + dir / (pane.fps || 30)));
}

function updateClock(pane) {
  const el = document.getElementById(`mech-clock-${pane.id}`);
  if (!el || !pane.video) return;
  const t = pane.video.currentTime;
  const frame = Math.round(t * (pane.fps || 30));
  el.textContent = `${t.toFixed(3)} s · frame ${frame}` + (pane.slow > 1 ? ` · real ${(realMs(pane, t) / 1000).toFixed(3)} s` : '');
}

function paneView(pane, rerender) {
  const fileInput = h('input', { type: 'file', accept: 'video/*', class: 'hidden', id: `mech-file-${pane.id}`, onchange: (e) => {
    const f = e.target.files[0];
    if (!f) return;
    pane.ownUrl = true;
    loadInto(pane, URL.createObjectURL(f), f.name, null, rerender);
  } });
  const connected = state.videos.filter((v) => clipUrls.has(v.id));
  const fromRoom = connected.length ? select([['', 'From Video Room…'], ...connected.map((v) => [v.id, `${state.sessions.find((s) => s.id === v.sessionId)?.date || ''} · ${v.fileName}`])], '', (id) => {
    const v = connected.find((x) => x.id === id);
    if (v) { pane.ownUrl = false; loadInto(pane, clipUrls.get(v.id), v.fileName, v.sessionId, rerender); }
  }, { id: `mech-room-${pane.id}`, 'aria-label': 'Load a clip attached in the Video Room' }) : null;

  const header = h('div', { class: 'btn-row', style: { marginBottom: '8px' } },
    h('b', null, pane.id === 'A' ? 'A · Primary' : 'B · Compare'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => fileInput.click() }, 'Open video'),
    fromRoom, fileInput,
    pane.name ? h('span', { class: 'muted small mono' }, pane.name) : null);

  if (!pane.video) {
    return card(null, header, h('div', { class: 'dropzone mech-empty' },
      h('p', null, pane.id === 'A' ? 'Open the rep you want to break down.' : 'Open a second rep to compare: last month, the player\'s best rep, or a model delivery.'),
      h('p', { class: 'small muted' }, 'Any phone, camcorder or Mevo clip works. High-frame-rate slow-mo gives the cleanest keyframes.')));
  }
  pane.canvas.style.pointerEvents = tool === 'none' ? 'none' : 'auto';
  const scrub = h('input', { type: 'range', min: '0', max: String(pane.video.duration || 1), step: '0.001', value: String(pane.video.currentTime), class: 'mech-scrub', 'aria-label': `Scrub video ${pane.id}`,
    oninput: (e) => { pane.video.pause(); pane.video.currentTime = parseFloat(e.target.value); } });
  pane.video.ontimeupdate = () => { scrub.value = String(pane.video.currentTime); };
  pane.video.onloadedmetadata = () => { scrub.max = String(pane.video.duration); pane.video.playbackRate = rate; draw(pane); };

  const marks = PHASES[kind];
  return card(null, header,
    h('div', { class: 'mech-stage' }, pane.video, pane.canvas),
    scrub,
    h('div', { class: 'btn-row small' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (pane.video.paused ? pane.video.play().catch(() => {}) : pane.video.pause()) }, '▶ / ❚❚'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => step(pane, -1) }, '◀'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => step(pane, 1) }, '▶'),
      h('span', { id: `mech-clock-${pane.id}`, class: 'mono' }, ''),
      h('label', null, 'File fps ', select([['30', '30'], ['60', '60'], ['120', '120'], ['240', '240']], String(pane.fps), (v) => { pane.fps = +v; updateClock(pane); }, { id: `mech-fps-${pane.id}` })),
      h('label', { title: 'For slow-motion files that play back slower than real time (e.g. 240 fps recorded, 30 fps file = 8×)' }, 'Slow-mo ',
        select([['1', 'Real time'], ['2', '2×'], ['4', '4×'], ['8', '8×']], String(pane.slow), (v) => { pane.slow = +v; rerender(); }, { id: `mech-slow-${pane.id}` })),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => saveFrame(pane) }, 'Save frame')),
    h('div', { class: 'chips', style: { marginTop: '8px' } }, marks.map((ph) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(isNum(pane.marks[ph])),
      title: isNum(pane.marks[ph]) ? `Marked at ${pane.marks[ph].toFixed(3)} s. Click to re-mark at the current frame.` : 'Mark this keyframe at the current frame',
      onclick: () => { pane.marks[ph] = pane.video.currentTime; rerender(); },
    }, isNum(pane.marks[ph]) ? `✓ ${ph}` : `Mark ${ph}`))),
    pane.shapes.length ? h('div', { class: 'small', style: { marginTop: '8px' } }, pane.shapes.map((s, i) => h('div', { class: 'btn-row' },
      h('span', null, `${s.type === 'angle' ? 'Angle' : 'Line'} ${i + 1}: `, h('b', null, `${s.value.toFixed(1)}°`), s.type === 'line' ? ' from horizontal' : ''),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { pane.shapes.splice(i, 1); rerender(); } }, 'Remove')))) : null,
    tool !== 'none' ? h('p', { class: 'small muted' }, tool === 'angle' ? 'Tap three points: end, vertex, end.' : 'Tap two points.') : null);
}

// ---------------- drawing ----------------
function onCanvas(pane, e, rerender) {
  if (tool === 'none') return;
  const r = pane.canvas.getBoundingClientRect();
  pane.pending.push({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  const need = tool === 'angle' ? 3 : 2;
  if (pane.pending.length >= need) {
    const pts = pane.pending.splice(0, need);
    pane.shapes.push({ type: tool, pts, value: measure(pane, tool, pts), t: pane.video.currentTime });
    rerender();
  } else draw(pane);
}

function measure(pane, type, pts) {
  const W = pane.canvas.clientWidth, H = pane.canvas.clientHeight;
  const P = pts.map((p) => [p.x * W, p.y * H]);
  if (type === 'line') {
    const a = (Math.atan2(-(P[1][1] - P[0][1]), P[1][0] - P[0][0]) * 180) / Math.PI;
    return Math.abs(a > 90 ? 180 - a : a < -90 ? 180 + a : a);
  }
  const v1 = [P[0][0] - P[1][0], P[0][1] - P[1][1]], v2 = [P[2][0] - P[1][0], P[2][1] - P[1][1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function draw(pane) {
  const cv = pane.canvas, v = pane.video;
  if (!cv || !v) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(v.clientWidth * dpr);
  cv.height = Math.round(v.clientHeight * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.clientWidth, v.clientHeight);
  drawShapes(ctx, pane, v.clientWidth, v.clientHeight);
}

function drawShapes(ctx, pane, W, H) {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#ff3b5c';
  const line = css.getPropertyValue('--series-4').trim() || '#c98500';
  ctx.lineWidth = Math.max(2, W / 320);
  ctx.font = `600 ${Math.max(12, W / 40)}px system-ui, sans-serif`;
  const dot = (x, y, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Math.max(3, W / 160), 0, Math.PI * 2); ctx.fill(); };
  const label = (text, x, y) => {
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x + 6, y - 18, w, 22);
    ctx.fillStyle = '#fff'; ctx.fillText(text, x + 11, y - 2);
  };
  for (const s of pane.shapes) {
    const P = s.pts.map((p) => [p.x * W, p.y * H]);
    ctx.strokeStyle = s.type === 'angle' ? accent : line;
    ctx.beginPath(); ctx.moveTo(...P[0]); P.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.stroke();
    P.forEach((p) => dot(...p, ctx.strokeStyle));
    const at = s.type === 'angle' ? P[1] : P[1];
    label(`${s.value.toFixed(1)}°`, at[0], at[1]);
  }
  for (const p of pane.pending) dot(p.x * W, p.y * H, accent);
}

function saveFrame(pane) {
  const v = pane.video;
  if (!v || !v.videoWidth) return;
  const cv = document.createElement('canvas');
  cv.width = v.videoWidth; cv.height = v.videoHeight;
  const ctx = cv.getContext('2d');
  ctx.drawImage(v, 0, 0);
  drawShapes(ctx, pane, cv.width, cv.height);
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = h('a', { href: URL.createObjectURL(blob), download: `${(pane.name || 'frame').replace(/\.[^.]+$/, '')}_${v.currentTime.toFixed(3)}s.png` });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
}

function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (currentRoute().path !== 'mechanics') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const targets = linked ? panes.filter((p) => p.video) : panes.filter((p) => p.video).slice(0, 1);
    if (!targets.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); targets.forEach((p) => step(p, e.key === 'ArrowRight' ? 1 : -1)); }
    if (e.key === ' ') {
      e.preventDefault();
      const playing = targets.some((p) => !p.video.paused);
      targets.forEach((p) => { if (playing) p.video.pause(); else { p.video.playbackRate = rate; p.video.play().catch(() => {}); } });
    }
  });
}

// ---------------- timing + measures ----------------
function spans(pane) {
  const order = PHASES[kind].filter((ph) => isNum(pane.marks[ph]));
  const out = [];
  for (let i = 1; i < order.length; i++) out.push({ name: `${order[i - 1]} → ${order[i]}`, ms: realMs(pane, pane.marks[order[i]] - pane.marks[order[i - 1]]) });
  for (const sp of KEY_SPANS[kind]) {
    const [a, b] = sp;
    if (isNum(pane.marks[a]) && isNum(pane.marks[b]) && !out.some((o) => o.name === spanName(sp))) out.push({ name: spanName(sp), ms: realMs(pane, pane.marks[b] - pane.marks[a]) });
  }
  return out;
}

function timingCard() {
  const rows = [];
  const a = spans(panes[0]), b = spans(panes[1]);
  for (const s of a) rows.push({ name: s.name, a: s.ms, b: b.find((x) => x.name === s.name)?.ms });
  for (const s of b) if (!rows.some((r) => r.name === s.name)) rows.push({ name: s.name, a: NaN, b: s.ms });
  return card('Keyframe timing (real time)', rows.length ? table([
    { key: 'name', label: 'Span' },
    { key: 'a', label: 'A (ms)', num: true, fmt: (v) => fmt(v, 0) },
    { key: 'b', label: 'B (ms)', num: true, fmt: (v) => fmt(v, 0) },
    { key: 'a', label: 'A − B', num: true, fmt: (v, r) => (isNum(v) && isNum(r.b) ? `${v - r.b >= 0 ? '+' : ''}${(v - r.b).toFixed(0)}` : '—') },
  ], rows, { compact: true }) : h('p', { class: 'muted' }, 'Mark two or more keyframes to see the time between them. Set "Slow-mo" on each video so times are real time.'),
  h('p', { class: 'card-note' }, `Frame accuracy is ±${(1000 / (panes[0].fps || 30) / (panes[0].slow || 1)).toFixed(0)} ms at video A's settings. Higher frame rates tighten it.`));
}

function measuresCard(rerender) {
  const pane = panes[0];
  const nameSel = h('select', { id: 'mech-measure-name', 'aria-label': 'Measurement name' }, MEASURES[kind].map((m) => h('option', { value: m }, m)), h('option', { value: '__custom' }, 'Custom…'));
  const custom = h('input', { type: 'text', id: 'mech-measure-custom', placeholder: 'Custom name', style: { minWidth: '0' } });
  const shapeSel = h('select', { id: 'mech-measure-shape', 'aria-label': 'Drawing to save' }, pane.shapes.map((s, i) => h('option', { value: String(i) }, `${s.type === 'angle' ? 'Angle' : 'Line'} ${i + 1}: ${s.value.toFixed(1)}°`)));
  return card('Measurements (video A)',
    pane.shapes.length ? h('div', { class: 'btn-row' }, shapeSel, nameSel, custom,
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => {
        const s = pane.shapes[+shapeSel.value];
        const name = nameSel.value === '__custom' ? custom.value.trim() : nameSel.value;
        if (!s || !name) { toast('Pick a drawing and a name', 'error'); return; }
        analysis.measures = analysis.measures.filter((m) => m.name !== name);
        analysis.measures.push({ name, value: +s.value.toFixed(1), unit: '°', t: s.t });
        rerender();
      } }, 'Add')) : h('p', { class: 'muted small' }, 'Turn on Line or Angle drawing and tap on video A, then name the measurement here.'),
    analysis.measures.length ? table([
      { key: 'name', label: 'Measurement' },
      { key: 'value', label: 'Value', num: true, fmt: (v, m) => `${v}${m.unit}` },
      { key: 'name', label: '', fmt: (n) => h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { analysis.measures = analysis.measures.filter((m) => m.name !== n); rerender(); } }, 'Remove') },
    ], analysis.measures, { compact: true }) : null);
}

// ---------------- save + trends ----------------
function saveCard(rerender) {
  const pane = panes[0];
  const roster = state.players.filter((p) => !p.archived && !p.nonPlayer).sort((a, b) => a.name.localeCompare(b.name));
  if (!analysis.playerId && roster.length) analysis.playerId = roster[0].id;
  const notes = h('textarea', { id: 'mech-notes', rows: 3, placeholder: 'What you saw, the cue you gave, what to check next time…', oninput: (e) => { analysis.notes = e.target.value; } });
  notes.value = analysis.notes;
  return card('Save analysis of video A',
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, 'Player'), roster.length ? select(roster.map((p) => [p.id, p.name]), analysis.playerId, (v) => { analysis.playerId = v; }, { id: 'mech-player' }) : h('span', { class: 'muted' }, 'Add players in the Session Logger or Players page first.')),
      h('label', { class: 'field' }, h('span', null, 'Date of the video'), h('input', { type: 'date', id: 'mech-date', value: analysis.date, onchange: (e) => { analysis.date = e.target.value; } })),
      h('label', { class: 'field full' }, h('span', null, 'Notes'), notes)),
    h('div', { class: 'btn-row', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn-primary', type: 'button', disabled: !pane.video || !roster.length, onclick: async () => {
        const sp = spans(pane);
        if (!sp.length && !analysis.measures.length && !analysis.notes) { toast('Mark keyframes, add a measurement or write a note first', 'error'); return; }
        const rec = {
          id: 'm-' + Date.now(), playerId: analysis.playerId, kind, date: analysis.date, clipName: pane.name, sessionId: pane.sessionId,
          fps: pane.fps, slow: pane.slow, marks: { ...pane.marks }, spans: Object.fromEntries(sp.map((s) => [s.name, +s.ms.toFixed(1)])),
          measures: analysis.measures, notes: analysis.notes, createdAt: new Date().toISOString(),
        };
        await db.put('mechanics', rec);
        state.mechanics.push(rec);
        trendPlayer = rec.playerId;
        analysis = { playerId: analysis.playerId, date: analysis.date, notes: '', measures: [] };
        toast(`Saved to ${playerName(rec.playerId)}'s mechanics history`, 'ok');
        rerender();
      } }, 'Save analysis'),
      h('span', { class: 'muted small' }, 'Saves keyframe times, measurements and notes so they trend over time.')));
}

function trendsCard(rerender) {
  const recs = state.mechanics.filter((m) => m.kind === kind);
  const players = [...new Set(recs.map((m) => m.playerId))];
  if (!players.length) return card('Mechanics trends', h('p', { class: 'muted' }, 'Saved analyses appear here as trends per player: stride timing, foot strike to release, trunk tilt, knee angles and anything else you measure.'));
  if (!players.includes(trendPlayer)) trendPlayer = players[0];
  const mine = recs.filter((m) => m.playerId === trendPlayer).sort((a, b) => a.date.localeCompare(b.date));
  const metricNames = [...new Set(mine.flatMap((m) => [...Object.keys(m.spans || {}).map((k) => `span:${k}`), ...(m.measures || []).map((x) => `measure:${x.name}`)]))];
  if (!metricNames.includes(trendMetric)) trendMetric = metricNames[0] || '';
  const valueOf = (m, key) => {
    const [t, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    return t === 'span' ? m.spans?.[name] : m.measures?.find((x) => x.name === name)?.value;
  };
  const chart = C.chartBox();
  const el = card('Mechanics trends',
    h('div', { class: 'btn-row', style: { marginBottom: '8px' } },
      select(players.map((id) => [id, playerName(id)]), trendPlayer, (v) => { trendPlayer = v; rerender(); }, { id: 'mech-trend-player', 'aria-label': 'Player' }),
      metricNames.length ? select(metricNames.map((k) => [k, k.replace(/^span:/, '').replace(/^measure:/, '') + (k.startsWith('span:') ? ' (ms)' : ' (°)')]), trendMetric, (v) => { trendMetric = v; rerender(); }, { id: 'mech-trend-metric', 'aria-label': 'Metric' }) : null),
    metricNames.length ? chart : null,
    table([
      { key: 'date', label: 'Date' },
      { key: 'clipName', label: 'Clip', fmt: (v) => h('span', { class: 'mono' }, v || '') },
      ...KEY_SPANS[kind].map((sp) => ({ key: 'spans', label: spanName(sp), num: true, fmt: (v) => fmt(v?.[spanName(sp)], 0) })),
      { key: 'measures', label: 'Measurements', fmt: (v) => (v || []).map((x) => `${x.name} ${x.value}°`).join(' · ') },
      { key: 'notes', label: 'Notes' },
      { key: 'id', label: '', fmt: (id) => h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Delete this saved analysis?'))) return;
        await db.del('mechanics', id); state.mechanics = state.mechanics.filter((m) => m.id !== id); rerender();
      } }, 'Delete') },
    ], [...mine].reverse(), { compact: true }));
  if (metricNames.length) {
    setTimeout(() => {
      const rows = mine.map((m) => ({ date: m.date, v: valueOf(m, trendMetric) })).filter((r) => isNum(r.v));
      const curve = devCurve(rows, (rs) => mean(rs.map((r) => r.v)));
      const isSpan = trendMetric.startsWith('span:');
      C.trendPlot(chart, [{ name: trendMetric.slice(trendMetric.indexOf(':') + 1), ...curve }], { unit: isSpan ? 'ms' : '°', d: isSpan ? 0 : 1, ytitle: isSpan ? 'Milliseconds' : 'Degrees' });
    }, 0);
  }
  return el;
}

