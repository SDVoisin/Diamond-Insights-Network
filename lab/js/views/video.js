// Video Room: attach multi-angle clips (Mevo Starts, Mevo Core, camcorders)
// to a Trackman session, sync each camera once, then click any pitch/swing to
// play every angle cued to that rep.

import { h, card, table, empty, fmt, toast, download, select, isNum } from '../util.js';
import { state, db, saveSetting } from '../store.js';
import { pageHeader, playerName, navigate } from '../app.js';
import { DEFAULT_CAMERAS } from '../config.js';
import { PITCH_TYPES, fmtClock } from '../trackman.js';

const urls = new Map();       // videoId -> object URL (this browser session only)
let selectedUid = null;
let preRoll = 2.5;
let rate = 1;
let personFilter = '';

export const cameras = () => state.settings.cameras || DEFAULT_CAMERAS;

export default function video(root, { params, rerender }) {
  root.appendChild(pageHeader('Video Room', 'Multi-angle video synced to every Trackman pitch and swing.'));
  const sessions = state.sessions;
  if (!sessions.length) { root.appendChild(empty('Import a Trackman session first, then attach the video from that day.', h('a', { class: 'btn btn-primary', href: '#/import' }, 'Import data'))); return; }

  const sid = params[0] && sessions.some((s) => s.id === params[0]) ? params[0] : (state.settings.lastVideoSession && sessions.some((s) => s.id === state.settings.lastVideoSession) ? state.settings.lastVideoSession : sessions[0].id);
  if (state.settings.lastVideoSession !== sid) saveSetting('lastVideoSession', sid);
  const session = sessions.find((s) => s.id === sid);
  const clips = state.videos.filter((v) => v.sessionId === sid);
  const reps = state.pitches.filter((p) => p.sessionId === sid && isNum(p.tod)).sort((a, b) => a.tod - b.tod);
  const people = [...new Set(reps.flatMap((p) => [p.pitcherKey, p.batterKey]).filter(Boolean))];
  const shown = personFilter && people.includes(personFilter) ? reps.filter((p) => p.pitcherKey === personFilter || p.batterKey === personFilter) : reps;
  if (!shown.some((p) => p.uid === selectedUid)) selectedUid = shown[0]?.uid || null;
  const rep = reps.find((p) => p.uid === selectedUid);

  root.appendChild(h('div', { class: 'filters' },
    h('label', { class: 'field' }, h('span', null, 'Session'),
      select(sessions.map((s) => [s.id, `${s.date} · ${s.label || s.type} · ${s.count} rows · ${state.videos.filter((v) => v.sessionId === s.id).length} clips`]), sid, (v) => navigate(`video/${v}`))),
    h('label', { class: 'field' }, h('span', null, 'Player'),
      select([['', 'Everyone'], ...people.map((id) => [id, playerName(id)])], personFilter, (v) => { personFilter = v; rerender(); })),
    h('label', { class: 'field' }, h('span', null, 'Pre-roll (s)'), h('input', { type: 'number', step: '0.5', min: '0', value: preRoll, style: { width: '80px' }, onchange: (e) => { preRoll = parseFloat(e.target.value) || 0; cueAll(); } })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => attachClips(sid, rerender) }, '+ Attach clips'),
      clips.length ? h('button', { class: 'btn', type: 'button', onclick: () => relink(clips, rerender) }, 'Reconnect files') : null,
      clips.length ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => exportCutList(session, clips, reps) }, 'Export cut list') : null)));

  if (!clips.length) {
    root.appendChild(card('No clips attached to this session',
      h('p', null, 'Offload each camera\'s SD card into the session folder, then attach the files here. Clip start times come from the file timestamp (or the ingest tool manifest) and are fine-tuned once per camera with “Sync to this pitch”.'),
      h('ol', { class: 'small' },
        h('li', null, 'Run ', h('span', { class: 'mono' }, 'python3 tools/video_ingest.py offload'), ' for each card (keeps original timestamps, writes manifest.json).'),
        h('li', null, 'Attach the clips (and optionally the manifest) here.'),
        h('li', null, 'Pick a pitch, scrub each angle to ball release, press “Sync to this pitch”. Every other pitch in the session lines up automatically.')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => attachClips(sid, rerender) }, '+ Attach clips'),
        h('button', { class: 'btn', type: 'button', onclick: () => importManifest(sid, rerender) }, 'Import ingest manifest'))));
  }

  const grid = h('div', { class: 'video-grid' });
  const tiles = [];
  for (const clip of clips) {
    const cam = cameras().find((c) => c.id === clip.cameraId);
    const v = h('video', { preload: 'metadata', muted: true, playsinline: true, controls: true });
    v.muted = true;
    const url = urls.get(clip.id);
    if (url) v.src = url;
    const camSel = select(cameras().map((c) => [c.id, c.name]), clip.cameraId, async (val) => { clip.cameraId = val; await db.put('videos', clip); rerender(); }, { 'aria-label': 'Camera' });
    const covers = rep && clipTime(clip, rep) >= 0 && clipTime(clip, rep) <= (clip.duration || Infinity);
    tiles.push({ clip, v });
    grid.appendChild(h('div', null,
      h('div', { class: 'video-tile' }, v, h('div', { class: 'cap' }, `${cam?.name || 'Camera'} · ${cam?.angle || ''}`),
        !url ? h('div', { class: 'cap', style: { top: 'auto', bottom: '6px' } }, 'File not connected — press Reconnect files') : null),
      h('div', { class: 'btn-row small', style: { marginTop: '6px' } },
        camSel,
        h('span', { class: 'muted' }, `${clip.fileName} · starts ${fmtClock(clip.startTod)} · offset ${fmt(clip.offset || 0, 2)} s`),
        rep && !covers ? h('span', { class: 'badge' }, 'rep outside clip') : null,
        h('button', { class: 'btn btn-sm', type: 'button', disabled: !rep || !url, onclick: () => syncHere(clip, v, rep, clips, rerender) }, 'Sync to this pitch'),
        h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: async () => { await db.del('videos', clip.id); state.videos = state.videos.filter((x) => x.id !== clip.id); rerender(); } }, 'Remove'))));
  }

  function cueAll() {
    if (!rep) return;
    for (const { clip, v } of tiles) {
      if (!v.src) continue;
      const at = clipTime(clip, rep);
      const t = Math.max(0, at - preRoll);
      const go = () => {
        v.playbackRate = rate;
        // Rep isn't in this clip (different block / camera stopped): park at 0
        // rather than at the last frame so nobody mistakes it for the rep.
        if (at < 0 || (isNum(v.duration) && at > v.duration)) { v.pause(); v.currentTime = 0; v.dataset.outside = '1'; return; }
        delete v.dataset.outside;
        v.currentTime = t;
      };
      if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
    }
  }
  const all = (fn) => tiles.forEach(({ v }) => v.src && fn(v));
  const transport = h('div', { class: 'transport' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { cueAll(); setTimeout(() => all((v) => v.play().catch(() => {})), 150); } }, '▶ Play rep'),
    h('button', { class: 'btn', type: 'button', onclick: () => all((v) => v.pause()) }, '❚❚ Pause'),
    h('button', { class: 'btn', type: 'button', onclick: () => all((v) => { v.pause(); v.currentTime = Math.max(0, v.currentTime - 1 / 30); }) }, '◀ Frame'),
    h('button', { class: 'btn', type: 'button', onclick: () => all((v) => { v.pause(); v.currentTime += 1 / 30; }) }, 'Frame ▶'),
    h('button', { class: 'btn', type: 'button', onclick: cueAll }, '⟲ Re-cue'),
    h('label', { class: 'field' }, h('span', null, 'Speed'), select([['0.25', '¼×'], ['0.5', '½×'], ['1', '1×']], String(rate), (val) => { rate = parseFloat(val); all((v) => { v.playbackRate = rate; }); })),
    rep ? h('span', { class: 'muted' }, `${PITCH_TYPES[rep.pitchType] || (rep.kind === 'swing' ? 'Swing' : 'Pitch')} · ${rep.pitcherName || ''}${rep.batterName ? ' vs ' + rep.batterName : ''} · ${fmtClock(rep.tod)}`) : null);

  const repCols = [
    { key: 'tod', label: 'Time', fmt: (v) => fmtClock(v).slice(0, 8) },
    { key: 'pitcherName', label: 'Pitcher' },
    { key: 'batterName', label: 'Hitter' },
    { key: 'pitchType', label: 'Pitch', fmt: (t) => PITCH_TYPES[t] || '' },
    { key: 'velo', label: 'Velo', num: true, fmt: (v) => fmt(v) },
    { key: 'ivb', label: 'IVB', num: true, fmt: (v) => fmt(v) },
    { key: 'hb', label: 'HB', num: true, fmt: (v) => fmt(v) },
    { key: 'ev', label: 'EV', num: true, fmt: (v) => fmt(v) },
    { key: 'batSpeed', label: 'Bat', num: true, fmt: (v) => fmt(v) },
    { key: 'uid', label: 'Tags', fmt: (u) => (repTags(u).tags || []).join(', ') },
  ].filter((c) => c.key === 'tod' || c.key === 'uid' || shown.some((p) => p[c.key] !== undefined && p[c.key] !== null && p[c.key] !== ''));
  const repTable = table(repCols, shown, { compact: true, onRowClick: (p) => { selectedUid = p.uid; rerender(); }, rowClass: (p) => (p.uid === selectedUid ? 'selected' : null) });

  root.appendChild(h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' } },
    h('div', null, clips.length ? card('Angles', transport, grid) : null, rep ? tagPanel(rep, rerender) : null),
    card(`Reps (${shown.length})`, h('div', { class: 'pitch-list' }, repTable))));
  setTimeout(cueAll, 0);
}

// Seconds into the clip where the rep happens.
export const clipTime = (clip, rep) => rep.tod - clip.startTod + (clip.offset || 0);

async function syncHere(clip, v, rep, clips, rerender) {
  // Trackman's pitch time is release, so the coach pauses on the release
  // frame and that frame becomes clipTime(rep) for this camera.
  const offset = v.currentTime - (rep.tod - clip.startTod);
  const same = clips.filter((c) => c.cameraId === clip.cameraId);
  for (const c of same) c.offset = offset;
  await db.putMany('videos', same);
  toast(`Synced ${same.length} clip(s) for this camera (offset ${offset.toFixed(2)} s)`, 'ok');
  rerender();
}

const TAGS = ['Best rep', 'Teaching clip', 'Mechanical flaw', 'Command miss', 'Timing issue', 'Barrel', 'Recruiting reel'];
const repTags = (uid) => state.notes.find((n) => n.id === `rep|${uid}`) || {};

function tagPanel(rep, rerender) {
  const cur = repTags(rep.uid);
  const tags = new Set(cur.tags || []);
  const ta = h('input', { type: 'text', placeholder: 'Clip note (cue, what to watch for)…', value: cur.text || '', style: { width: '100%' } });
  const save = async () => {
    const n = { id: `rep|${rep.uid}`, uid: rep.uid, sessionId: rep.sessionId, playerId: rep.pitcherKey || rep.batterKey, tags: [...tags], text: ta.value, updatedAt: new Date().toISOString() };
    await db.put('notes', n);
    const i = state.notes.findIndex((x) => x.id === n.id);
    if (i >= 0) state.notes[i] = n; else state.notes.push(n);
    rerender();
  };
  return card('Tag this rep',
    h('div', { class: 'chips', style: { marginBottom: '8px' } }, TAGS.map((t) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(tags.has(t)),
      onclick: () => { if (tags.has(t)) tags.delete(t); else tags.add(t); save(); },
    }, t))),
    h('div', { class: 'btn-row' }, ta, h('button', { class: 'btn btn-sm', type: 'button', onclick: save }, 'Save note')));
}

function pickFiles() {
  if (window.showOpenFilePicker) {
    return window.showOpenFilePicker({ multiple: true, types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.mts', '.avi'] } }] })
      .then(async (handles) => Promise.all(handles.map(async (hd) => ({ file: await hd.getFile(), handle: hd }))))
      // Embedded/sandboxed pages refuse the picker (SecurityError): fall back to a file input.
      .catch((e) => (e.name === 'AbortError' ? [] : pickWithInput()));
  }
  return pickWithInput();
}

function pickWithInput() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'video/*', multiple: true });
    inp.onchange = () => resolve([...inp.files].map((file) => ({ file, handle: null })));
    inp.click();
  });
}

function durationOf(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => resolve(NaN);
    v.src = url;
  });
}

const secOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; };

function guessCamera(name, i) {
  const n = name.toLowerCase();
  const cams = cameras();
  const hit = cams.find((c) => n.includes(c.id.toLowerCase()) || n.includes(c.name.toLowerCase().replace(/\s+/g, '')) || n.includes(c.name.toLowerCase()));
  return (hit || cams[i % cams.length]).id;
}

async function attachClips(sessionId, rerender) {
  let picked;
  try { picked = await pickFiles(); } catch (e) { toast('Could not open files: ' + e.message, 'error'); return; }
  if (!picked.length) return;
  const manifest = state.settings[`manifest:${sessionId}`] || {};
  const recs = [];
  for (const [i, { file, handle }] of picked.entries()) {
    const id = `v-${sessionId}-${file.name}-${file.size}`;
    const url = URL.createObjectURL(file);
    urls.set(id, url);
    const duration = await durationOf(url);
    const m = manifest[file.name];
    // Cameras write the file's modified time when recording stops, so start =
    // mtime - duration unless the ingest manifest has the real creation time.
    const startTod = m && isNum(m.startTod) ? m.startTod : secOfDay(file.lastModified) - (isNum(duration) ? duration : 0);
    const existing = state.videos.find((v) => v.id === id);
    recs.push({
      id, sessionId, fileName: file.name, size: file.size, lastModified: file.lastModified,
      duration, startTod, offset: existing?.offset || 0,
      cameraId: existing?.cameraId || m?.cameraId || guessCamera(file.name, i),
      handle: handle || undefined, addedAt: new Date().toISOString(),
    });
  }
  try { await db.putMany('videos', recs); } catch {
    // Some browsers refuse to store file handles; keep the clip without it.
    await db.putMany('videos', recs.map(({ handle, ...r }) => r));
  }
  for (const r of recs) {
    const i = state.videos.findIndex((v) => v.id === r.id);
    if (i >= 0) state.videos[i] = r; else state.videos.push(r);
  }
  toast(`Attached ${recs.length} clip(s)`, 'ok');
  rerender();
}

async function relink(clips, rerender) {
  let n = 0;
  const missing = [];
  for (const c of clips) {
    if (urls.has(c.id)) continue;
    if (c.handle?.getFile) {
      try {
        let perm = await c.handle.queryPermission?.({ mode: 'read' });
        if (perm !== 'granted') perm = await c.handle.requestPermission?.({ mode: 'read' });
        if (perm === 'granted') { urls.set(c.id, URL.createObjectURL(await c.handle.getFile())); n++; continue; }
      } catch { /* fall through to manual pick */ }
    }
    missing.push(c);
  }
  if (missing.length) {
    toast(`Select the ${missing.length} missing file(s) — matched by file name`);
    const picked = await new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: 'video/*', multiple: true });
      inp.onchange = () => resolve([...inp.files]);
      inp.click();
    });
    for (const f of picked) {
      const c = missing.find((m) => m.fileName === f.name);
      if (c) { urls.set(c.id, URL.createObjectURL(f)); n++; }
    }
  }
  toast(`Connected ${n} clip(s)`, 'ok');
  rerender();
}

async function importManifest(sessionId, rerender) {
  const inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      const map = {};
      for (const c of data.clips || []) {
        const entry = { startTod: c.start_tod, cameraId: c.camera_id };
        map[c.file_name] = entry;
        if (c.proxy) map[c.proxy.split('/').pop()] = entry; // proxies keep the original's timing
      }
      await saveSetting(`manifest:${sessionId}`, map);
      toast(`Manifest loaded: ${Object.keys(map).length} clips. Now attach the files.`, 'ok');
      rerender();
    } catch (e) { toast('Bad manifest: ' + e.message, 'error'); }
  };
  inp.click();
}

// CSV the ingest tool can use to cut one short clip per rep per angle.
function exportCutList(session, clips, reps) {
  const lines = ['uid,date,player,pitch_type,camera_id,file_name,start_sec,duration_sec,label'];
  for (const r of reps) {
    for (const c of clips) {
      const t = clipTime(c, r);
      if (t < 0 || (isNum(c.duration) && t > c.duration)) continue;
      const who = (r.pitcherName || r.batterName || '').replace(/[^A-Za-z0-9]+/g, '');
      const label = `${session.date}_${who}_${r.pitchNo ?? ''}_${r.pitchType || (r.kind === 'swing' ? 'SW' : '')}_${c.cameraId}`;
      lines.push([r.uid, session.date, `"${(r.pitcherName || r.batterName || '').replace(/"/g, '')}"`, r.pitchType || '', c.cameraId, `"${c.fileName}"`, Math.max(0, t - preRoll).toFixed(2), (preRoll + 3).toFixed(2), label].join(','));
    }
  }
  download(`${session.date}_cutlist.csv`, lines.join('\n'), 'text/csv');
}
