#!/usr/bin/env python3
"""Generate realistic demo Trackman + Blast CSVs for the Player Dev Lab.

The demo shows development over ~10 weeks: a RHP adding velocity, a LHP
adding a sweeper mid-block, a sinkerballer tightening command, and hitters
gaining bat speed / exit velocity. Output: lab/sample/*.csv + index.json.

    python3 tools/make_sample_data.py
"""
import csv
import datetime as dt
import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "lab" / "sample"
random.seed(7)

TM_COLS = [
    "PitchNo", "Date", "Time", "PAofInning", "PitchofPA", "Pitcher", "PitcherId", "PitcherThrows",
    "PitcherTeam", "Batter", "BatterId", "BatterSide", "BatterTeam", "Inning", "Outs", "Balls",
    "Strikes", "TaggedPitchType", "AutoPitchType", "PitchCall", "KorBB", "TaggedHitType", "PlayResult",
    "Notes", "RelSpeed", "VertRelAngle", "HorzRelAngle", "SpinRate", "SpinAxis", "Tilt", "RelHeight",
    "RelSide", "Extension", "VertBreak", "InducedVertBreak", "HorzBreak", "PlateLocHeight",
    "PlateLocSide", "ZoneSpeed", "VertApprAngle", "HorzApprAngle", "ZoneTime", "ExitSpeed", "Angle",
    "Direction", "HitSpinRate", "Distance", "HangTime", "ContactPositionX", "ContactPositionY",
    "ContactPositionZ", "BatSpeed", "VerticalAttackAngle", "Level", "Stadium", "PitchUID",
]

TEAM = "GLC"
ZONES = {1: (-0.47, 3.17), 2: (0, 3.17), 3: (0.47, 3.17), 4: (-0.47, 2.5), 5: (0, 2.5),
         6: (0.47, 2.5), 7: (-0.47, 1.83), 8: (0, 1.83), 9: (0.47, 1.83)}

# Pitch shape: velo, spin, ivb, hb (RHP sign: arm side +), axis
PITCHERS = [
    {"name": "Tremblay, Luc", "id": 1001, "throws": "Right", "relH": 5.9, "relS": -1.9, "ext": 6.3,
     "cmd": 9.0, "cmd_gain": 2.0,
     "arsenal": {"Fastball": [87.0, 2250, 16.5, 9.0, 205, 0.55], "Slider": [79.5, 2400, 2.0, -5.0, 60, 0.25],
                 "ChangeUp": [79.0, 1700, 8.5, 13.0, 230, 0.20]},
     "velo_gain": 3.0},
    {"name": "MacDonald, Owen", "id": 1002, "throws": "Left", "relH": 6.1, "relS": 2.0, "ext": 6.0,
     "cmd": 10.0, "cmd_gain": 1.5,
     "arsenal": {"Fastball": [85.0, 2350, 18.0, -7.0, 150, 0.6], "Curveball": [73.0, 2550, -14.0, 8.0, 330, 0.25],
                 "ChangeUp": [77.0, 1800, 9.0, -12.0, 125, 0.15]},
     "velo_gain": 1.0, "new_pitch": ("Sweeper", [77.0, 2600, 0.5, 15.0, 270, 0.2], 35)},
    {"name": "Gagnon, Ethan", "id": 1003, "throws": "Right", "relH": 5.4, "relS": -2.4, "ext": 6.6,
     "cmd": 12.0, "cmd_gain": 4.5,
     "arsenal": {"Sinker": [89.0, 2150, 8.0, 15.5, 235, 0.55], "Sweeper": [79.0, 2550, 1.0, -14.0, 85, 0.3],
                 "Splitter": [82.0, 1300, 3.0, 11.0, 220, 0.15]},
     "velo_gain": 0.8},
]

HITTERS = [
    {"name": "Bouchard, Noah", "id": 2001, "side": "Right", "bat": 66.0, "gain": 4.0, "aa": 7.0, "skill": 0.55},
    {"name": "Wilson, Liam", "id": 2002, "side": "Left", "bat": 69.0, "gain": 2.5, "aa": 11.0, "skill": 0.62},
    {"name": "Singh, Arjun", "id": 2003, "side": "Right", "bat": 63.0, "gain": 5.0, "aa": 3.0, "skill": 0.48},
]

START = dt.date(2026, 8, 3)
DAYS = 70


def g(mu, sigma):
    return random.gauss(mu, sigma)


def clock(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{s:05.2f}"


def pitch_row(p, ptype, shape, progress, rownum, t, date, target=None, batter=None):
    velo, spin, ivb, hb, axis, _ = shape
    is_fb = ptype in ("Fastball", "Sinker")
    velo += p["velo_gain"] * progress * (1.0 if is_fb else 0.6)
    spin += 60 * progress if is_fb else 0
    ivb += 1.2 * progress if ptype == "Fastball" else 0
    rv = g(velo, 0.8); rs = g(spin, 45); ri = g(ivb, 1.3); rh = g(hb, 1.4)
    cmd = (p["cmd"] - p["cmd_gain"] * progress) / 12.0
    if target is None:
        target = ZONES[random.choice(list(ZONES))]
    px = g(target[0], cmd); pz = g(target[1], cmd)
    vaa = -4.2 - 0.12 * (95 - rv) * 0.5 + 0.9 * (pz - 2.5) + (ri - 16) * 0.06 - (p["relH"] - 5.8) * 0.5
    zone_t = (60.5 - p["ext"]) / (rv * 1.467 * 0.95)
    row = {
        "PitchNo": rownum, "Date": date.isoformat(), "Time": clock(t),
        "Pitcher": p["name"], "PitcherId": p["id"], "PitcherThrows": p["throws"], "PitcherTeam": TEAM,
        "TaggedPitchType": ptype, "AutoPitchType": ptype,
        "RelSpeed": round(rv, 2), "SpinRate": round(rs, 0), "SpinAxis": round(g(axis, 6) % 360, 1),
        "RelHeight": round(g(p["relH"], 0.08 - 0.03 * progress), 3), "RelSide": round(g(p["relS"], 0.08 - 0.03 * progress), 3),
        "Extension": round(g(p["ext"], 0.12), 3), "InducedVertBreak": round(ri, 2), "HorzBreak": round(rh, 2),
        "VertBreak": round(ri - 22 + (95 - rv) * 0.9, 2),
        "PlateLocHeight": round(pz, 3), "PlateLocSide": round(px, 3), "ZoneSpeed": round(rv * 0.915, 2),
        "VertApprAngle": round(vaa, 2), "HorzApprAngle": round(g(-0.8 * math.copysign(1, p["relS"]) * -1, 0.9), 2),
        "ZoneTime": round(zone_t, 3), "Level": "Amateur", "Stadium": "GLC Training Centre",
        "PitchUID": f"demo-{date.isoformat()}-{p['id']}-{rownum}",
        "VertRelAngle": round(g(-1.5, 0.7), 2), "HorzRelAngle": round(g(1.5, 0.7), 2),
    }
    row["Tilt"] = ""
    if batter:
        row.update({"Batter": batter["name"], "BatterId": batter["id"], "BatterSide": batter["side"], "BatterTeam": TEAM})
    return row


def pick_type(arsenal):
    r = random.random(); acc = 0
    for name, shape in arsenal.items():
        acc += shape[5]
        if r <= acc:
            return name, shape
    return list(arsenal.items())[-1]


def batted_ball(h, progress, pitch_velo, px, pz, offspeed):
    bat = g(h["bat"] + h["gain"] * progress, 2.2)
    quality = max(0.45, min(0.99, g(0.74 + h["skill"] * 0.12 + 0.06 * progress, 0.09)))
    max_ev = 1.23 * bat + 0.23 * pitch_velo
    ev = max_ev * quality * random.uniform(0.9, 1.0)
    la = g(h["aa"] + 6 + (2.5 - pz) * -6, 17)
    inside = -px if h["side"] == "Right" else px
    late = g(-0.25 if offspeed else 0.25, 0.7) - 0.25 * progress * (1 if offspeed else 0)
    timing_shift = -late * 18
    pull = 5 + 15 * inside + timing_shift + g(0, 10)
    direction = -pull if h["side"] == "Right" else pull
    dist = max(10, ev * 2.9 * math.sin(math.radians(max(1, min(la, 60)) * 1.5)) + (ev - 60) * 2) if la > 0 else g(60, 20)
    contact_x = 1.0 + 0.8 * inside - late
    aa = g(h["aa"] + 1.5 * progress, 3.5)
    return {"ExitSpeed": round(ev, 2), "Angle": round(la, 2), "Direction": round(direction, 2),
            "Distance": round(dist, 1), "HangTime": round(max(0.3, la / 12), 2) if la > 0 else "",
            "HitSpinRate": round(g(2400, 600)), "ContactPositionX": round(contact_x, 3),
            "ContactPositionY": round(g(0, 0.3), 3), "ContactPositionZ": round(pz + g(0, 0.1), 3),
            "BatSpeed": round(bat, 2), "VerticalAttackAngle": round(aa, 2)}


def write(path, rows, cols):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = []
    for day in range(DAYS):
        date = START + dt.timedelta(days=day)
        progress = day / DAYS
        wd = date.weekday()
        rows = []
        t = 15 * 3600 + 5 * 60 + random.uniform(0, 60)
        n = 1
        if wd in (0, 3):  # bullpens Mon/Thu with command targets in Notes
            for p in PITCHERS:
                arsenal = dict(p["arsenal"])
                if p.get("new_pitch") and day >= p["new_pitch"][2]:
                    arsenal[p["new_pitch"][0]] = p["new_pitch"][1]
                    tot = sum(s[5] for s in arsenal.values())
                    arsenal = {k: v[:5] + [v[5] / tot] for k, v in arsenal.items()}
                for _ in range(random.randint(28, 38)):
                    ptype, shape = pick_type(arsenal)
                    zone = random.choice([1, 3, 4, 6, 7, 9, 8, 2])
                    row = pitch_row(p, ptype, shape, progress, n, t, date, target=ZONES[zone])
                    row["Notes"] = f"T{zone}"
                    rows.append(row); n += 1; t += random.uniform(18, 30)
                t += 300
            name = f"{date.isoformat()}_bullpen.csv"
            write(OUT / name, rows, TM_COLS)
            files.append({"file": name, "type": "bullpen"})
        elif wd == 2 and (day // 7) % 2 == 0:  # live ABs every other Wednesday
            for p in PITCHERS:
                for h in HITTERS:
                    for _ab in range(2):
                        balls = strikes = 0
                        pitch_of_pa = 1
                        while True:
                            ptype, shape = pick_type(p["arsenal"])
                            row = pitch_row(p, ptype, shape, progress, n, t, date, batter=h)
                            row.update({"Balls": balls, "Strikes": strikes, "PitchofPA": pitch_of_pa})
                            px, pz = row["PlateLocSide"], row["PlateLocHeight"]
                            inzone = abs(px) <= 0.83 and 1.5 <= pz <= 3.5
                            swing_p = 0.68 if inzone else 0.28 - 0.08 * progress * (h["skill"])
                            offspeed = ptype not in ("Fastball", "Sinker")
                            if random.random() < swing_p:
                                contact = random.random() < (0.85 if inzone else 0.55) - (0.12 if offspeed else 0)
                                if not contact:
                                    row["PitchCall"] = "StrikeSwinging"; strikes += 1
                                elif random.random() < 0.45:
                                    row["PitchCall"] = "FoulBall"; strikes = min(2, strikes + 1)
                                else:
                                    row["PitchCall"] = "InPlay"
                                    row.update(batted_ball(h, progress, row["RelSpeed"], px, pz, offspeed))
                                    row["BatSpeed"] = ""  # live Trackman without bat tracking
                                    row["VerticalAttackAngle"] = ""
                                    row["PlayResult"] = "Single" if row["ExitSpeed"] > 88 and 5 < row["Angle"] < 25 else "Out"
                            else:
                                if inzone:
                                    row["PitchCall"] = "StrikeCalled"; strikes += 1
                                else:
                                    row["PitchCall"] = "BallCalled"; balls += 1
                            rows.append(row); n += 1; t += random.uniform(15, 25); pitch_of_pa += 1
                            if row["PitchCall"] == "InPlay" or strikes >= 3 or balls >= 4:
                                if strikes >= 3: row["KorBB"] = "Strikeout"
                                if balls >= 4: row["KorBB"] = "Walk"
                                break
                        t += 40
            name = f"{date.isoformat()}_live_abs.csv"
            write(OUT / name, rows, TM_COLS)
            files.append({"file": name, "type": "live"})
        elif wd in (1, 4):  # Trackman BP vs machine with bat tracking Tue/Fri
            machine = {"name": "Machine, Pitching", "id": 9999, "throws": "Right", "relH": 5.5, "relS": -1.0,
                       "ext": 5.5, "cmd": 8.0, "cmd_gain": 0, "velo_gain": 0}
            for h in HITTERS:
                for _ in range(random.randint(22, 30)):
                    fb = random.random() < 0.7
                    shape = [82.0, 2100, 14.0, 6.0, 200, 1] if fb else [72.0, 2200, -4.0, -4.0, 50, 1]
                    row = pitch_row(machine, "Fastball" if fb else "Curveball", shape, 0, n, t, date, target=(g(0, 0.3), g(2.5, 0.3)))
                    row.update({"Batter": h["name"], "BatterId": h["id"], "BatterSide": h["side"], "BatterTeam": TEAM})
                    if random.random() < 0.9:
                        row["PitchCall"] = "InPlay"
                        row.update(batted_ball(h, progress, row["RelSpeed"], row["PlateLocSide"], row["PlateLocHeight"], not fb))
                    else:
                        row["PitchCall"] = "StrikeSwinging"
                        row["BatSpeed"] = round(g(h["bat"] + h["gain"] * progress, 2.5), 2)
                    rows.append(row); n += 1; t += random.uniform(9, 14)
                t += 240
            name = f"{date.isoformat()}_bp.csv"
            write(OUT / name, rows, TM_COLS)
            files.append({"file": name, "type": "bp"})

    # A Blast Motion export for one hitter (tee/front-toss work), weekly.
    blast_cols = ["Date", "Equipment", "Handedness", "Swing Details", "Plane Score", "Connection Score",
                  "Rotation Score", "Bat Speed (mph)", "Rotational Acceleration (g)", "On Plane Efficiency (%)",
                  "Attack Angle (deg)", "Early Connection (deg)", "Connection at Impact (deg)",
                  "Vertical Bat Angle (deg)", "Power (kW)", "Time to Contact (sec)", "Peak Hand Speed (mph)"]
    h = HITTERS[2]
    rows = []
    for wk in range(10):
        date = START + dt.timedelta(days=wk * 7 + 5)
        prog = wk / 10
        for i in range(25):
            ts = dt.datetime.combine(date, dt.time(10, 0)) + dt.timedelta(seconds=i * 40)
            bat = g(h["bat"] + h["gain"] * prog + 1.0, 2.0)
            rows.append({"Date": ts.strftime("%Y-%m-%d %H:%M:%S"), "Equipment": "Baseball", "Handedness": "Right",
                         "Swing Details": "Tee", "Bat Speed (mph)": round(bat, 1),
                         "Rotational Acceleration (g)": round(g(13 + 4 * prog, 2), 1),
                         "On Plane Efficiency (%)": round(min(99, g(62 + 12 * prog, 8))),
                         "Attack Angle (deg)": round(g(4 + 4 * prog, 3)), "Early Connection (deg)": round(g(95, 8)),
                         "Connection at Impact (deg)": round(g(90, 6)), "Vertical Bat Angle (deg)": round(g(-28, 4)),
                         "Power (kW)": round(g(2.4 + 0.6 * prog, 0.3), 2), "Time to Contact (sec)": round(g(0.165 - 0.012 * prog, 0.01), 3),
                         "Peak Hand Speed (mph)": round(g(19 + 1.5 * prog, 1.2), 1)})
    name = "blast_singh_arjun.csv"
    with open(OUT / name, "w", newline="") as f:
        f.write("Player: Arjun Singh\nExported from Blast Connect\n\n")
        w = csv.DictWriter(f, fieldnames=blast_cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in blast_cols})
    files.append({"file": name, "type": "cage", "batter": "Singh, Arjun"})

    (OUT / "index.json").write_text(json.dumps({"files": files}, indent=1))
    print(f"wrote {len(files)} files to {OUT}")


if __name__ == "__main__":
    main()
