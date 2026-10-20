# Diamond Insights — Player Development Lab

A Trackman-based pitching and hitting development system, modelled on the way
Driveline-style labs work: measure every rep, design pitches on purpose, track
command against intent, and watch development curves move session over session.
It replaces the R Shiny dashboard with a faster, offline-capable web app that
lives on the same site (`diamondinsightsnetwork.com/lab/`).

```
lab/
  index.html            the app (open in Chrome / Edge)
  css/lab.css           theme (brand navy dark + light)
  js/app.js             shell, routing, shared filters
  js/trackman.js        CSV parsing + column mapping (Trackman, Blast, generic sensors)
  js/metrics.js         all analytics (pure functions)
  js/config.js          tunable thresholds, DI Stuff weights, camera kit
  js/charts.js          Plotly chart builders
  js/views/*.js         Dashboard, Players, Pitching Lab, Hitting Lab, Video Room, Import, Ops
  vendor/               Plotly 2.35.2 (bundled so the lab works with no internet at the field)
  sample/               10 weeks of demo data (regenerate: python3 tools/make_sample_data.py)
tools/
  video_ingest.py       SD-card offload, proxies, per-pitch clip cutting, multi-angle composites
  make_sample_data.py   demo data generator
```

## Quick start

1. Open `https://diamondinsightsnetwork.com/lab/` (or locally: `python3 -m http.server` in the repo root, then `http://localhost:8000/lab/`).
2. **Import Data** → drag in Trackman CSV exports. Players and sessions are created automatically.
   No data yet? Press **Load demo data**.
3. Use **Pitching Lab**, **Hitting Lab**, **Video Room**, and the **Dashboard**.
4. **Ops & Cameras → Export backup** after each session and drop the JSON in the staff Drive/Dropbox.
   Other staff use **Restore / merge backup** to pull it into their browser.

Data is stored in the browser (IndexedDB) on the machine you use — nothing is uploaded anywhere.
That keeps player data private and lets the lab run at the field without Wi-Fi.

## What it does

### Pitching Lab
| Tab | What you get |
|---|---|
| **Arsenal & Pitch Design** | Per-pitch velo/max, spin, clock tilt, spin efficiency (Trackman 3D spin when exported, otherwise a movement-based physics estimate), IVB/HB, VAA, extension, release height, Δvelo from the fastball, **DI Stuff**, zone/whiff/CSW. Movement plot with pitch averages, release-point plot, spin-axis clock. **Pitch-design targets** per pitch (velo/IVB/HB/spin + grip cue) drawn on the movement plot with the remaining gap. Shape consistency (SDs) and separation from the primary fastball. |
| **Command** | Avg miss distance from the intended target, hit-spot ≤6″/≤12″, zone %, edge %, 2-D dispersion, release consistency — by pitch type. Location + density plots. **Target tagging pad** for bullpens (click where the catcher set up; the next pitch auto-selects). |
| **Development Curves** | Any metric per pitch type over time — one point per session, 3-session rolling average, linear trend reported as change per 30 days, goal lines. FB max/avg velocity curves. |
| **Session Report** | Today vs the previous 400 pitches, in-session velo by pitch # (fatigue/intent), movement + locations, coach notes, print to PDF. |

**DI Stuff** is a transparent z-score model (100 = reference average, 10 = 1 SD) grading each pitch type on the traits public research ties to whiffs and weak contact — fastballs on velo, ride, run, height-adjusted VAA and extension; breaking balls on velo, separation from the fastball and spin; changeups/splitters on velo gap and drop vs the fastball. It is not a trained run-value model. Re-baseline the reference means/SDs in `js/config.js` for your level.

**Logging command targets live:** type `T1`–`T9` (3×3 zone, catcher's view, top-left = 1) or `T11`–`T14` (chase corners) in Trackman's *Notes* column for each pitch. They import automatically. Files with `TargetX`/`TargetZ` columns (feet) also work.

### Hitting Lab
| Tab | What you get |
|---|---|
| **Power & Batted Ball** | Max EV, **EV90**, avg EV, hard-hit %, sweet-spot %, barrel %, max distance. EV×LA plot with barrel window, spray chart, EV and LA heat maps by pitch location, GB/LD/FB/PU profile, quality by pitch type. |
| **Swing Path & Bat Speed** | Bat speed (avg/max/90th), attack angle, vertical bat angle, time to contact, rotational acceleration, on-plane efficiency, **squared-up %** (EV ÷ (1.23·bat speed + 0.23·pitch speed)). Attack angle and launch angle vs pitch height (path fit), bat speed → EV. Blast/sensor session table. |
| **Timing** | Early / on-time / late on every ball in play — from Trackman contact depth (`ContactPositionX`) when exported, otherwise spray angle relative to what pitch location predicts. By pitch type, by velocity band, contact depth vs velo, time-to-contact distribution. |
| **Approach** | Live ABs and games only: swing % and whiff % by location, z-swing, chase, whiff by pitch type. |
| **Development Curves** | Power development curves: EV90, max EV, bat speed, hard-hit %, attack angle, rotational acceleration, on-time % and more — with trend per 30 days and goals. |
| **Session Report** | Session vs prior work, EV×LA, spray, EV by swing #, coach notes. |

### Dashboard
Roster activity, **fatigue/workload flags** (fastball down ≥2 mph vs the trailing 30 days, high 7-day pitch counts, consecutive throwing days), pitcher workload table, biggest movers (last 30 days vs prior 30), pitching & hitting leaderboards, goal progress and recent sessions. Thresholds in `js/config.js`.

### Players
Roster with bios, positions, grad year, programs; per-player development goals (baseline captured automatically), coach-notes timeline and tagged video reps. Pitching machines/coaches are auto-flagged as non-players.

### Video Room
Attach every angle from a session (3 × Mevo Start, Mevo Core 4K, 2 camcorders), sync each camera once, then click any pitch or swing and every angle cues to that rep. Frame-step, ¼×/½× playback, tags (best rep, teaching clip, mechanical flaw, recruiting reel…) and notes per rep. **Export cut list** feeds the ingest tool to cut one clip per rep per angle.

Chrome/Edge remember the file locations between visits (press **Reconnect files**); in other browsers re-select the files and they re-match by name.

## Supported files

| Source | Notes |
|---|---|
| Trackman Baseball CSV (v3 game/practice exports) | All standard columns: `RelSpeed`, `SpinRate`, `SpinAxis`, `InducedVertBreak`, `HorzBreak`, `RelHeight/Side`, `Extension`, `VertApprAngle`, `PlateLoc*`, `PitchCall`, `ExitSpeed`, `Angle`, `Direction`, `Distance`, `ContactPosition*`, 3D spin (`SpinAxis3d*`), bat tracking (`BatSpeed`, `VerticalAttackAngle`) when present. |
| Blast Motion export | Metadata lines above the header are skipped. Choose the hitter in *Hitter for sensor files* before importing. |
| Any CSV with similar headers | Column matching is case/space-insensitive; aliases live in `ALIASES` in `js/trackman.js`. |

Session type is auto-detected (bullpen = no hitters, live = hitters without innings, game = innings, cage = sensor-only); override it before importing or per session afterwards.

## Camera operations

Placement guides for pitching and hitting, a capture-day checklist and the folder convention are on the **Ops & Cameras** page. In short:

* Sync every camera's clock to the Trackman laptop before the session.
* Record continuous clips per player block; do one visible "sync pitch".
* After the session:

```bash
# offload each SD card (keeps timestamps, writes manifest.json, optional checksum)
python3 tools/video_ingest.py offload /Volumes/MEVO_A    Video_Archive/2026-10-20_bullpen --camera cam-a --verify
python3 tools/video_ingest.py offload /Volumes/MEVO_B    Video_Archive/2026-10-20_bullpen --camera cam-b
python3 tools/video_ingest.py offload /Volumes/MEVO_C    Video_Archive/2026-10-20_bullpen --camera cam-c
python3 tools/video_ingest.py offload /Volumes/MEVO_CORE Video_Archive/2026-10-20_bullpen --camera cam-d
python3 tools/video_ingest.py offload /Volumes/CAMCORDER1 Video_Archive/2026-10-20_bullpen --camera cam-e --clock-offset -3.5

# browser-friendly H.264 proxies for 4K / HEVC files
python3 tools/video_ingest.py proxy Video_Archive/2026-10-20_bullpen

# check timing
python3 tools/video_ingest.py info Video_Archive/2026-10-20_bullpen
```

Then in the Video Room: **Import ingest manifest** → **Attach clips** → pick a pitch, scrub one angle to ball release, **Sync to this pitch** (once per camera). To produce shareable per-pitch clips:

```bash
# from the lab's "Export cut list" (after syncing in the Video Room)
python3 tools/video_ingest.py cut Video_Archive/2026-10-20_bullpen --cutlist 2026-10-20_cutlist.csv --stack

# or straight from Trackman with known per-camera offsets (seconds)
python3 tools/video_ingest.py autocut Video_Archive/2026-10-20_bullpen \
    --trackman Video_Archive/2026-10-20_bullpen/trackman/2026-10-20_bullpen.csv \
    --offset cam-a=0.42 --offset cam-d=-1.10 --stack --player Tremblay
```

`--stack` builds a side-by-side (2 angles) or 2×2 grid (3–4 angles) composite per rep — good for texting a player their reps. `--reencode` gives frame-accurate cuts; the default stream copy is instant but snaps to keyframes.

Clip timing comes from each file's `creation_time` (converted to local time) or, if missing, file modified time minus duration. If a camera's clock is off, pass `--clock-offset` (seconds to add) or just use **Sync to this pitch** in the lab.

## Moving off the Shiny app

* **Export all rows (CSV for R / Python)** on the Ops page gives one tidy table of every pitch/swing with the lab's normalised columns plus `stuff` and `spinEff`, so existing R scripts keep working.
* The backup JSON is a plain document with `players`, `sessions`, `pitches`, `targets`, `videos`, `goals` and `notes` arrays.

## Roadmap ideas

* Shared cloud database (e.g. Supabase/Postgres) so staff see each other's sessions live instead of merging backups.
* Train DI Stuff on the organisation's own outcomes once enough live/game pitches are logged.
* Pose-estimation keyframes (foot strike, max external rotation, release) from the open-side video.
* Player-facing read-only report links.
