// Tunable model constants. Everything the lab grades against lives here so
// the staff can re-baseline to their own level (HS / college / pro).

// "DI Stuff" — a transparent, z-score pitch-quality model in the spirit of
// public Stuff+ work (Driveline, Eno Sarris/Max Bay). It is NOT a trained
// run-value model: each pitch type is graded on the physical traits that
// public research ties to whiffs/weak contact, against the reference
// distribution below. 100 = reference average, 10 points = 1 SD.
//
// Feature keys (computed per pitch in metrics.js):
//   velo      release speed (mph)
//   ivb       induced vertical break (in)
//   absHb     |horizontal break| (in)
//   vaaAdj    VAA adjusted to a 2.5 ft plate height (deg, flatter = higher)
//   ext       extension (ft)
//   spin      spin rate (rpm)
//   veloDiff  primary fastball velo - pitch velo (mph)
//   sep       movement distance from primary fastball (in)
//   hSep      |HB - fastball HB| (in)
//   ivbDiff   fastball IVB - pitch IVB (in)
export const STUFF_MODEL = {
  FF: { velo: [89, 3, 0.45], ivb: [16, 3, 0.25], absHb: [8, 3, 0.05], vaaAdj: [-5.0, 0.6, 0.15], ext: [6.0, 0.4, 0.10] },
  SI: { velo: [88, 3, 0.45], ivb: [9, 3, -0.20], absHb: [14, 3, 0.25], ext: [6.0, 0.4, 0.10] },
  CT: { velo: [84, 3, 0.40], sep: [12, 4, 0.40], spin: [2300, 250, 0.20] },
  SL: { velo: [81, 3, 0.30], sep: [20, 5, 0.45], spin: [2400, 300, 0.25] },
  SW: { velo: [79, 3, 0.25], hSep: [24, 5, 0.50], spin: [2500, 300, 0.25] },
  CB: { velo: [76, 3, 0.30], ivb: [-8, 4, -0.40], spin: [2400, 300, 0.30] },
  CH: { veloDiff: [8, 2, 0.35], ivbDiff: [8, 3, 0.40], absHb: [13, 3, 0.25] },
  SP: { veloDiff: [8, 2, 0.35], ivbDiff: [12, 4, 0.45], spin: [1400, 300, -0.20] },
};

// Strike zone (ft). Half plate (8.5") + ball radius (~1.45") = 0.83 ft.
export const ZONE = { halfWidth: 0.83, bottom: 1.5, top: 3.5, edgeIn: 2 };

// Hitting thresholds.
export const HIT = {
  hardHit: 95,           // mph
  sweetSpot: [8, 32],    // launch angle deg
  squaredUp: 0.8,        // EV / max-possible EV
};

// Workload / alert thresholds on the dashboard.
export const ALERTS = {
  veloDropMph: 2.0,      // session FB velo vs player's trailing 30-day average
  pitches7d: 250,        // pitches thrown in the last 7 days
  backToBackDays: 2,     // consecutive throwing days that triggers a flag
};

// Default camera layout for the club's kit. Edit in Ops > Cameras.
export const DEFAULT_CAMERAS = [
  { id: 'cam-a', name: 'Mevo Start A', model: 'Mevo Start', res: '1080p', angle: 'Open side (chest view)', role: 'both' },
  { id: 'cam-b', name: 'Mevo Start B', model: 'Mevo Start', res: '1080p', angle: 'Behind (pitcher back / CF view)', role: 'both' },
  { id: 'cam-c', name: 'Mevo Start C', model: 'Mevo Start', res: '1080p', angle: 'Front (catcher / face-on)', role: 'both' },
  { id: 'cam-d', name: 'Mevo Core 4K', model: 'Mevo Core', res: '4K', angle: 'High wide (full delivery + ball flight)', role: 'both' },
  { id: 'cam-e', name: 'Camcorder 1', model: 'Camcorder', res: '1080p+', angle: 'Closed side (glove side / back of hitter)', role: 'both' },
  { id: 'cam-f', name: 'Camcorder 2', model: 'Camcorder', res: '1080p+', angle: 'Hand / release close-up (high fps)', role: 'pitching' },
];
