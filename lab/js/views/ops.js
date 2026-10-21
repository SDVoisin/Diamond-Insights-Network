// Operations: camera kit + placement, capture-day checklist, file naming,
// data backup/restore, and the model thresholds in use.

import { h, card, table, toast, download, select, todayISO, confirmDialog } from '../util.js';
import { state, saveSetting, exportAll, importAll, wipeAll } from '../store.js';
import { pageHeader, refresh } from '../app.js';
import { DEFAULT_CAMERAS, ALERTS, HIT, ZONE, STUFF_MODEL } from '../config.js';
import { cameras } from './video.js';

export default function ops(root, { rerender }) {
  root.appendChild(pageHeader('Ops & Cameras', 'Capture setup, naming, backups and model settings for the whole organisation.'));

  // ---- camera kit ----
  const cams = cameras().map((c) => ({ ...c }));
  const save = async () => { await saveSetting('cameras', cams); toast('Camera kit saved', 'ok'); rerender(); };
  root.appendChild(card('Camera kit',
    h('p', { class: 'muted small' }, 'Camera ids are used to match clip file names on import (name your SD-card folders cam-a … cam-f) and in the ingest tool.'),
    table([
      { key: 'id', label: 'Id', fmt: (v) => h('span', { class: 'mono' }, v) },
      { key: 'name', label: 'Name', fmt: (v, c) => h('input', { type: 'text', value: v, onchange: (e) => { c.name = e.target.value; } }) },
      { key: 'model', label: 'Model', fmt: (v, c) => h('input', { type: 'text', value: v, style: { width: '120px' }, onchange: (e) => { c.model = e.target.value; } }) },
      { key: 'res', label: 'Res', fmt: (v, c) => h('input', { type: 'text', value: v, style: { width: '70px' }, onchange: (e) => { c.res = e.target.value; } }) },
      { key: 'angle', label: 'Angle', fmt: (v, c) => h('input', { type: 'text', value: v, style: { width: '260px' }, onchange: (e) => { c.angle = e.target.value; } }) },
      { key: 'role', label: 'Use', fmt: (v, c) => select([['both', 'Both'], ['pitching', 'Pitching'], ['hitting', 'Hitting']], v, (nv) => { c.role = nv; }) },
    ], cams),
    h('div', { class: 'btn-row', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save kit'),
      h('button', { class: 'btn', type: 'button', onclick: () => { cams.push({ id: `cam-${String.fromCharCode(97 + cams.length)}`, name: 'New camera', model: '', res: '', angle: '', role: 'both' }); saveSetting('cameras', cams).then(rerender); } }, '+ Add camera'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => saveSetting('cameras', DEFAULT_CAMERAS).then(rerender) }, 'Reset to default'))));

  // ---- placement ----
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Pitching capture layout',
      h('ul', { class: 'small' },
        h('li', null, h('b', null, 'Mevo Start A — open side: '), 'perpendicular to the rubber on the pitcher\'s chest side (3B side for RHP, 1B for LHP), ~25–35 ft away, lens at belt height. Primary mechanics angle: leg lift, hip-shoulder separation, arm path.'),
        h('li', null, h('b', null, 'Mevo Start B — behind: '), 'straight behind the mound on the CF line, slightly elevated. Shows direction to the plate, release point and the pitch\'s path — best angle for pitch-design and command review.'),
        h('li', null, h('b', null, 'Mevo Start C — front: '), 'behind/beside the catcher (behind netting), offset to the pitcher\'s arm side. Face-on view for glove side, trunk tilt and posture at release.'),
        h('li', null, h('b', null, 'Mevo Core 4K — high wide: '), 'elevated behind home or 1B/3B side capturing the entire delivery and ball flight. 4K lets you crop in after the fact.'),
        h('li', null, h('b', null, 'Camcorder 1 — closed side: '), 'glove side, mirror of camera A. Use for front-side blocking and stride direction.'),
        h('li', null, h('b', null, 'Camcorder 2 — release close-up: '), 'tight on the hand at release using the highest frame rate available (120 fps+ if supported) — grip/seam orientation for pitch design.')),
      h('p', { class: 'card-note' }, 'Keep Trackman unobstructed: no cameras or tripods in the radar\'s line between the mound and plate.')),
    card('Hitting capture layout',
      h('ul', { class: 'small' },
        h('li', null, h('b', null, 'Mevo Start A — open side: '), 'facing the hitter\'s chest, perpendicular to the plate, belt height. Swing path, posture, bat angle through contact.'),
        h('li', null, h('b', null, 'Mevo Start B — behind (pitcher view): '), 'behind the L-screen/machine on the pitcher\'s line. Shows the bat entering the zone and attack angle relative to the pitch plane.'),
        h('li', null, h('b', null, 'Mevo Start C — rear: '), 'behind the hitter (catcher view) for load, stride direction and barrel turn.'),
        h('li', null, h('b', null, 'Mevo Core 4K — high wide: '), 'whole swing + ball flight off the bat; pairs with the spray chart.'),
        h('li', null, h('b', null, 'Camcorder 1 — back side / high fps: '), 'tight on the contact point for timing (contact depth) and barrel accuracy.')),
      h('p', { class: 'card-note' }, 'Hitters on Blast: start the sensor session at the same time as Trackman so swings line up by timestamp.'))));

  // ---- capture-day checklist ----
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Capture-day checklist',
      h('ol', { class: 'small' },
        h('li', null, 'Sync every camera\'s clock to the Trackman laptop (set date/time on each device before the session; same time zone).'),
        h('li', null, 'Format SD cards, confirm free space; Mevo Starts at 1080p, Mevo Core at 4K, camcorders at max frame rate.'),
        h('li', null, 'Start all cameras, then do a ', h('b', null, 'sync clap/throw'), ': one pitch everyone can see. Note its Trackman PitchNo.'),
        h('li', null, 'In Trackman, tag pitch types live and type target zones in Notes (', h('span', { class: 'mono' }, 'T1–T9'), ' grid, ', h('span', { class: 'mono' }, 'T11–T14'), ' chase corners).'),
        h('li', null, 'Record continuous clips per player block rather than one per pitch — fewer files, one sync per camera.'),
        h('li', null, 'After the session: export the Trackman CSV, run the ingest tool on each SD card, import CSV here, attach clips, sync once per camera.'),
        h('li', null, 'Write coach notes on the session report while it\'s fresh.'))),
    card('File & folder naming',
      h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } },
`Video_Archive/
  2026-10-20_bullpen/
    trackman/2026-10-20_bullpen.csv
    cam-a/  (Mevo Start A — original files)
    cam-b/  cam-c/  cam-d/ (Mevo Core 4K)
    cam-e/  cam-f/ (camcorders)
    proxies/       (1080p H.264 for browser playback)
    clips/         (per-pitch cuts: date_player_pitch#_type_cam.mp4)
    manifest.json  (written by tools/video_ingest.py)`),
      h('p', { class: 'card-note' }, '4K HEVC from the Mevo Core may not play in every browser — the ingest tool can make H.264 proxies.'))));

  // ---- data management ----
  const restoreInput = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: async (e) => {
    try {
      await importAll(JSON.parse(await e.target.files[0].text()));
      await refresh();
      toast('Backup restored / merged', 'ok');
    } catch (err) { toast('Restore failed: ' + err.message, 'error'); }
  } });
  root.appendChild(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
    card('Data & backups',
      h('p', { class: 'small' }, `This browser holds ${state.pitches.length} rows, ${state.sessions.length} sessions, ${state.players.length} players, ${state.videos.length} clip links, ${state.goals.length} goals. Data lives only on this machine — export a backup after each session and share it with staff (Drive/Dropbox) so others can merge it.`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => download(`di-lab-backup-${todayISO()}.json`, JSON.stringify(await exportAll())) }, 'Export backup (JSON)'),
        h('button', { class: 'btn', type: 'button', onclick: () => restoreInput.click() }, 'Restore / merge backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => download(`di-lab-pitches-${todayISO()}.csv`, toCSV(state.pitches), 'text/csv') }, 'Export all rows (CSV for R / Python)'),
        h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: async () => { if (await confirmDialog('Erase ALL lab data in this browser? Export a backup first.', 'Erase everything')) { await wipeAll(); await refresh(); } } }, 'Erase all data'),
        restoreInput)),
    card('Model settings in use',
      table([{ key: 'k', label: 'Setting' }, { key: 'v', label: 'Value' }], [
        { k: 'Strike zone', v: `±${ZONE.halfWidth} ft · ${ZONE.bottom}–${ZONE.top} ft · edge ${ZONE.edgeIn}″` },
        { k: 'Hard-hit', v: `≥ ${HIT.hardHit} mph` },
        { k: 'Sweet spot', v: `${HIT.sweetSpot[0]}–${HIT.sweetSpot[1]}°` },
        { k: 'Squared-up', v: `≥ ${HIT.squaredUp * 100}% of max EV` },
        { k: 'Velo-drop flag', v: `−${ALERTS.veloDropMph} mph vs 30-day` },
        { k: '7-day pitch flag', v: `${ALERTS.pitches7d}` },
        { k: 'DI Stuff pitch models', v: Object.keys(STUFF_MODEL).join(', ') },
      ], { compact: true }),
      h('p', { class: 'card-note' }, 'Edit lab/js/config.js to re-baseline for your level (e.g. HS vs college velocity references).'))));
}

function toCSV(rows) {
  const skip = new Set(['handle']);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => !skip.has(c));
  const esc = (v) => (v === undefined || v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
