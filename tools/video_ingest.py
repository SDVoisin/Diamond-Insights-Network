#!/usr/bin/env python3
"""Video ingest for the Diamond Insights Player Development Lab.

Turns SD cards from the Mevo Starts, Mevo Core and camcorders into an
organised session archive whose clips line up with Trackman pitches.

Requires Python 3.9+ and ffmpeg/ffprobe on PATH. No other dependencies.

Typical capture day
-------------------
  # 1. offload each card into the session folder (keeps original timestamps)
  python3 tools/video_ingest.py offload /Volumes/MEVO_A  Video_Archive/2026-10-20_bullpen --camera cam-a
  python3 tools/video_ingest.py offload /Volumes/MEVO_CORE Video_Archive/2026-10-20_bullpen --camera cam-d

  # 2. make browser-friendly H.264 proxies (4K HEVC from the Mevo Core etc.)
  python3 tools/video_ingest.py proxy Video_Archive/2026-10-20_bullpen

  # 3a. cut one clip per pitch per angle from the lab's "Export cut list"
  python3 tools/video_ingest.py cut Video_Archive/2026-10-20_bullpen --cutlist 2026-10-20_cutlist.csv --stack

  # 3b. ...or straight from the Trackman CSV with per-camera sync offsets
  python3 tools/video_ingest.py autocut Video_Archive/2026-10-20_bullpen \\
      --trackman trackman/2026-10-20_bullpen.csv --offset cam-a=0.42 --offset cam-d=-1.10

Then in the lab's Video Room: "Import ingest manifest" and attach the files
(originals or proxies).
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mts", ".m2ts", ".avi", ".mkv", ".webm"}
MANIFEST = "manifest.json"


# ---------------------------------------------------------------- helpers
def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def need(tool):
    if not shutil.which(tool):
        die(f"{tool} not found on PATH (install ffmpeg: https://ffmpeg.org/download.html)")


def ffprobe(path):
    need("ffprobe")
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return {}
    data = json.loads(out.stdout or "{}")
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    fmt = data.get("format", {})
    fps = None
    if v.get("avg_frame_rate") and v["avg_frame_rate"] != "0/0":
        n, d = v["avg_frame_rate"].split("/")
        fps = round(float(n) / float(d), 3) if float(d) else None
    created = (fmt.get("tags") or {}).get("creation_time") or (v.get("tags") or {}).get("creation_time")
    return {
        "duration": float(fmt["duration"]) if fmt.get("duration") else None,
        "codec": v.get("codec_name"),
        "width": v.get("width"),
        "height": v.get("height"),
        "fps": fps,
        "creation_time": created,
    }


def seconds_of_day(ts):
    return ts.hour * 3600 + ts.minute * 60 + ts.second + ts.microsecond / 1e6


def clip_start(path, info, clock_offset):
    """Local wall-clock start time of a clip, in seconds since midnight.

    Prefer the container's creation_time (stored in UTC by most cameras,
    converted to this machine's local time). Fall back to file mtime minus
    duration, since cameras write mtime when recording stops.
    """
    start = None
    source = None
    if info.get("creation_time"):
        try:
            ts = dt.datetime.fromisoformat(info["creation_time"].replace("Z", "+00:00"))
            if ts.tzinfo is not None:
                ts = ts.astimezone()  # to local time
            start, source = ts, "creation_time"
        except ValueError:
            pass
    if start is None:
        mtime = dt.datetime.fromtimestamp(path.stat().st_mtime)
        start = mtime - dt.timedelta(seconds=info.get("duration") or 0)
        source = "mtime-duration"
    start = start + dt.timedelta(seconds=clock_offset)
    return start, source


def load_manifest(session_dir):
    p = session_dir / MANIFEST
    if p.exists():
        return json.loads(p.read_text())
    return {"session": session_dir.name, "clips": []}


def save_manifest(session_dir, m):
    m["clips"].sort(key=lambda c: (c["camera_id"], c.get("start_tod") or 0))
    (session_dir / MANIFEST).write_text(json.dumps(m, indent=1))


def sha1(path, limit=None):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        read = 0
        while chunk := f.read(1 << 20):
            h.update(chunk)
            read += len(chunk)
            if limit and read >= limit:
                break
    return h.hexdigest()


def parse_tod(raw):
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*([ap]\.?m\.?)?", raw or "", re.I)
    if not m:
        return None
    hr = int(m.group(1))
    ap = (m.group(4) or "").lower()[:1]
    if ap == "p" and hr < 12:
        hr += 12
    if ap == "a" and hr == 12:
        hr = 0
    return hr * 3600 + int(m.group(2)) * 60 + float(m.group(3) or 0)


def safe(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "", s.replace(" ", ""))


# ---------------------------------------------------------------- commands
def cmd_offload(a):
    src, dst = Path(a.source), Path(a.session_dir)
    if not src.exists():
        die(f"{src} does not exist")
    cam_dir = dst / a.camera
    cam_dir.mkdir(parents=True, exist_ok=True)
    m = load_manifest(dst)
    files = sorted(p for p in src.rglob("*") if p.suffix.lower() in VIDEO_EXT and not p.name.startswith("."))
    if not files:
        die(f"no video files found under {src}")
    for f in files:
        target = cam_dir / f.name
        if target.exists() and target.stat().st_size == f.stat().st_size:
            print(f"  skip (already copied) {f.name}")
        else:
            print(f"  copy {f.name} ({f.stat().st_size / 1e9:.2f} GB)")
            shutil.copy2(f, target)  # copy2 keeps mtime, which clip timing relies on
            if a.verify and sha1(f) != sha1(target):
                die(f"checksum mismatch copying {f}")
            if a.move:
                f.unlink()
        info = ffprobe(target)
        start, source = clip_start(target, info, a.clock_offset)
        entry = {
            "file_name": target.name, "camera_id": a.camera, "path": str(target.relative_to(dst)),
            "start_iso": start.isoformat(timespec="milliseconds"), "start_tod": round(seconds_of_day(start), 3),
            "start_source": source, "clock_offset": a.clock_offset, **{k: info.get(k) for k in ("duration", "codec", "width", "height", "fps")},
        }
        m["clips"] = [c for c in m["clips"] if (c["camera_id"], c["file_name"]) != (a.camera, target.name)]
        m["clips"].append(entry)
    save_manifest(dst, m)
    print(f"done: {len(files)} file(s) -> {cam_dir}; manifest {dst / MANIFEST}")


def cmd_proxy(a):
    need("ffmpeg")
    d = Path(a.session_dir)
    m = load_manifest(d)
    out_dir = d / "proxies"
    out_dir.mkdir(exist_ok=True)
    for c in m["clips"]:
        src = d / c["path"]
        needs = a.all or c.get("codec") not in ("h264",) or (c.get("height") or 0) > a.height
        if not needs:
            continue
        out = out_dir / (Path(c["file_name"]).stem + "_proxy.mp4")
        if out.exists() and not a.force:
            print(f"  exists {out.name}")
        else:
            print(f"  proxy {c['file_name']} ({c.get('codec')} {c.get('height')}p) -> {out.name}")
            subprocess.run([
                "ffmpeg", "-v", "error", "-y", "-i", str(src),
                "-vf", f"scale=-2:'min({a.height},ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(a.crf),
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                # keep creation time so the lab can still place the clip in time
                "-map_metadata", "0", str(out),
            ], check=True)
        c["proxy"] = str(out.relative_to(d))
    save_manifest(d, m)
    print("done")


def _cut(src, start, dur, out, reencode):
    args = ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, start):.3f}", "-i", str(src), "-t", f"{dur:.3f}"]
    if reencode:
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac"]
    else:
        args += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    args += ["-movflags", "+faststart", str(out)]
    subprocess.run(args, check=True)


def _stack(paths, out):
    """Multi-angle composite: 2 angles side-by-side, 3-4 in a 2x2 grid."""
    n = len(paths)
    inputs = sum((["-i", str(p)] for p in paths), [])
    scaled = "".join(f"[{i}:v]scale=-2:540,setsar=1,pad=960:540:(ow-iw)/2:(oh-ih)/2[v{i}];" for i in range(n))
    if n == 2:
        layout = "[v0][v1]hstack=inputs=2[out]"
    else:
        if n == 3:
            scaled += "color=black:s=960x540[v3];"
        layout = "[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0:shortest=1[out]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", scaled + layout, "-map", "[out]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], check=True)


def _source_for(d, m, file_name, prefer_proxy):
    c = next((c for c in m["clips"] if c["file_name"] == file_name), None)
    if c and prefer_proxy and c.get("proxy") and (d / c["proxy"]).exists():
        return d / c["proxy"]
    if c:
        return d / c["path"]
    hits = list(d.rglob(file_name))
    return hits[0] if hits else None


def cmd_cut(a):
    need("ffmpeg")
    d = Path(a.session_dir)
    m = load_manifest(d)
    out_dir = d / "clips"
    out_dir.mkdir(exist_ok=True)
    by_rep = {}
    with open(a.cutlist, newline="") as f:
        for row in csv.DictReader(f):
            src = _source_for(d, m, row["file_name"], a.proxy)
            if not src:
                print(f"  missing source {row['file_name']}")
                continue
            out = out_dir / f"{safe(row['label'])}.mp4"
            print(f"  cut {out.name}")
            _cut(src, float(row["start_sec"]), float(row["duration_sec"]), out, a.reencode)
            by_rep.setdefault(row["uid"], []).append(out)
    if a.stack:
        for uid, outs in by_rep.items():
            if len(outs) >= 2:
                target = out_dir / f"{outs[0].stem.rsplit('_', 1)[0]}_multi.mp4"
                print(f"  stack {target.name} ({len(outs)} angles)")
                _stack(outs[:4], target)
    print(f"done -> {out_dir}")


def cmd_autocut(a):
    need("ffmpeg")
    d = Path(a.session_dir)
    m = load_manifest(d)
    if not m["clips"]:
        die("manifest has no clips; run offload first")
    offsets = {}
    for o in a.offset or []:
        cam, _, val = o.partition("=")
        offsets[cam] = float(val)
    rows = []
    with open(a.trackman, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            tod = parse_tod(r.get("Time", ""))
            if tod is None:
                continue
            who = r.get("Pitcher") or r.get("Batter") or ""
            if a.player and a.player.lower() not in who.lower() and a.player.lower() not in (r.get("Batter") or "").lower():
                continue
            rows.append((tod, r))
    out_dir = d / "clips"
    out_dir.mkdir(exist_ok=True)
    cut = 0
    for tod, r in rows:
        name = safe(((r.get("Pitcher") or r.get("Batter") or "").split(",")[0]))
        ptype = safe(r.get("TaggedPitchType") or r.get("AutoPitchType") or "")
        outs = []
        for c in m["clips"]:
            t = tod - c["start_tod"] + offsets.get(c["camera_id"], 0.0)
            if t < 0 or (c.get("duration") and t > c["duration"]):
                continue
            src = d / (c["proxy"] if a.proxy and c.get("proxy") else c["path"])
            out = out_dir / f"{m['session']}_{name}_P{r.get('PitchNo', '')}_{ptype}_{c['camera_id']}.mp4"
            _cut(src, t - a.pre, a.pre + a.post, out, a.reencode)
            outs.append(out)
            cut += 1
        if a.stack and len(outs) >= 2:
            _stack(outs[:4], out_dir / f"{m['session']}_{name}_P{r.get('PitchNo', '')}_{ptype}_multi.mp4")
    print(f"done: {cut} clip(s) from {len(rows)} Trackman row(s) -> {out_dir}")


def cmd_info(a):
    d = Path(a.session_dir)
    m = load_manifest(d)
    for c in m["clips"]:
        print(f"{c['camera_id']:6} {c['file_name']:32} start {c.get('start_iso', '?')} ({c.get('start_source')})  "
              f"{(c.get('duration') or 0):7.1f}s  {c.get('codec')} {c.get('width')}x{c.get('height')} @{c.get('fps')}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    o = sub.add_parser("offload", help="copy an SD card into the session folder and record clip timing")
    o.add_argument("source", help="SD card mount or folder")
    o.add_argument("session_dir", help="e.g. Video_Archive/2026-10-20_bullpen")
    o.add_argument("--camera", required=True, help="camera id from the lab's Ops page, e.g. cam-a")
    o.add_argument("--clock-offset", type=float, default=0.0, help="seconds to ADD to this camera's clock to match Trackman")
    o.add_argument("--verify", action="store_true", help="SHA-1 verify each copy")
    o.add_argument("--move", action="store_true", help="delete from the card after a successful copy")
    o.set_defaults(func=cmd_offload)

    x = sub.add_parser("proxy", help="H.264 proxies for 4K/HEVC clips so every browser can play them")
    x.add_argument("session_dir")
    x.add_argument("--height", type=int, default=1080)
    x.add_argument("--crf", type=int, default=22)
    x.add_argument("--all", action="store_true", help="proxy every clip, not just non-H.264 / >height")
    x.add_argument("--force", action="store_true")
    x.set_defaults(func=cmd_proxy)

    c = sub.add_parser("cut", help="cut per-rep clips from the lab's exported cut list")
    c.add_argument("session_dir")
    c.add_argument("--cutlist", required=True)
    c.add_argument("--reencode", action="store_true", help="frame-accurate cuts (slower); default is stream copy")
    c.add_argument("--proxy", action="store_true", help="cut from proxies when available")
    c.add_argument("--stack", action="store_true", help="also build a multi-angle composite per rep")
    c.set_defaults(func=cmd_cut)

    u = sub.add_parser("autocut", help="cut per-pitch clips straight from a Trackman CSV")
    u.add_argument("session_dir")
    u.add_argument("--trackman", required=True)
    u.add_argument("--offset", action="append", help="camera sync offset, e.g. cam-a=0.42 (repeatable)")
    u.add_argument("--player", help="only pitches/swings for this name (substring)")
    u.add_argument("--pre", type=float, default=2.5, help="seconds before release")
    u.add_argument("--post", type=float, default=3.0, help="seconds after release")
    u.add_argument("--reencode", action="store_true")
    u.add_argument("--proxy", action="store_true")
    u.add_argument("--stack", action="store_true")
    u.set_defaults(func=cmd_autocut)

    i = sub.add_parser("info", help="list clips in a session manifest")
    i.add_argument("session_dir")
    i.set_defaults(func=cmd_info)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
