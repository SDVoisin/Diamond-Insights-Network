// Tap pads for logging by hand: a strike zone (catcher's view) and a spray
// field. Both report positions in Trackman units so logged reps flow through
// the same analytics as imported ones.

import { h } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(viewBox) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    svg.appendChild(el);
    return el;
  };
  return { svg, add };
}

// marks: [{ x, z, kind: 'target' | 'pitch', color }]; onPick(x, z) in feet.
export function zonePad(marks, onPick, label = 'Strike zone pad, catcher view') {
  const W = 3, H = 3.6, x0 = -1.5, z0 = 0.6; // ft window
  const { svg, add } = svgEl(`0 0 ${W * 100} ${H * 100}`);
  const toSvg = (x, z) => [(x - x0) * 100, (H - (z - z0)) * 100];
  const [zx1, zy1] = toSvg(-0.83, 3.5), [zx2, zy2] = toSvg(0.83, 1.5);
  add('rect', { x: zx1, y: zy1, width: zx2 - zx1, height: zy2 - zy1, fill: 'none', stroke: 'var(--text-secondary)', 'stroke-width': 3 });
  for (let i = 1; i < 3; i++) {
    add('line', { x1: zx1 + ((zx2 - zx1) * i) / 3, x2: zx1 + ((zx2 - zx1) * i) / 3, y1: zy1, y2: zy2, stroke: 'var(--grid)', 'stroke-width': 1.5 });
    add('line', { x1: zx1, x2: zx2, y1: zy1 + ((zy2 - zy1) * i) / 3, y2: zy1 + ((zy2 - zy1) * i) / 3, stroke: 'var(--grid)', 'stroke-width': 1.5 });
  }
  const [px1, py] = toSvg(-0.708, 0.7), [px2] = toSvg(0.708, 0.7);
  add('path', { d: `M ${px1} ${py} L ${px2} ${py} L ${px2} ${py + 10} L ${(px1 + px2) / 2} ${py + 22} L ${px1} ${py + 10} Z`, fill: 'var(--surface-3)', stroke: 'var(--axis)' });
  for (const m of marks) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
    const [cx, cy] = toSvg(m.x, m.z);
    if (m.kind === 'target') add('circle', { cx, cy, r: 15, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-dasharray': '6 4' });
    else add('circle', { cx, cy, r: 10, fill: m.color || 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2 });
  }
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const x = x0 + ((e.clientX - r.left) / r.width) * W;
    const z = z0 + H - ((e.clientY - r.top) / r.height) * H;
    onPick(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
  });
  return h('div', { class: 'pad', role: 'img', 'aria-label': label }, svg);
}

// Spray pad: tap where the ball landed. Direction follows Trackman
// (negative = left field), distance in feet from home plate.
export function sprayPad(point, onPick) {
  const S = 420; // ft shown
  const { svg, add } = svgEl('-300 -20 600 330');
  const toSvg = (dir, dist) => {
    const k = 300 / S;
    return [dist * Math.sin((dir * Math.PI) / 180) * k, 300 - dist * Math.cos((dir * Math.PI) / 180) * k];
  };
  const arc = (r) => {
    const [ax, ay] = toSvg(-45, r), [bx, by] = toSvg(45, r);
    const rr = (r * 300) / S;
    return `M ${ax} ${ay} A ${rr} ${rr} 0 0 1 ${bx} ${by}`;
  };
  const fair = ['0,300'];
  for (let a = -45; a <= 45; a += 5) fair.push(toSvg(a, 330).join(','));
  add('polygon', { points: fair.join(' '), fill: 'var(--surface-3)', stroke: 'none' });
  const [ix1, iy1] = toSvg(-45, 90), [ix2, iy2] = toSvg(45, 90), [ix3, iy3] = toSvg(0, 127);
  add('path', { d: `M 0 300 L ${ix1} ${iy1} L ${ix3} ${iy3} L ${ix2} ${iy2} Z`, fill: 'var(--surface-2)', stroke: 'var(--axis)' });
  add('line', { x1: 0, y1: 300, x2: toSvg(-45, 330)[0], y2: toSvg(-45, 330)[1], stroke: 'var(--axis)', 'stroke-width': 2 });
  add('line', { x1: 0, y1: 300, x2: toSvg(45, 330)[0], y2: toSvg(45, 330)[1], stroke: 'var(--axis)', 'stroke-width': 2 });
  for (const r of [150, 250, 330]) {
    add('path', { d: arc(r), fill: 'none', stroke: 'var(--grid)', 'stroke-width': 1.5 });
    const [tx, ty] = toSvg(0, r);
    add('text', { x: tx + 4, y: ty - 4, fill: 'var(--text-muted)', 'font-size': 13 }, `${r} ft`);
  }
  if (point && Number.isFinite(point.dir) && Number.isFinite(point.dist)) {
    const [cx, cy] = toSvg(point.dir, point.dist);
    add('line', { x1: 0, y1: 300, x2: cx, y2: cy, stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '6 4' });
    add('circle', { cx, cy, r: 9, fill: 'var(--accent)', stroke: 'var(--surface-1)', 'stroke-width': 2 });
  }
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = -300 + ((e.clientX - r.left) / r.width) * 600;
    const sy = -20 + ((e.clientY - r.top) / r.height) * 330;
    const dx = sx, dy = 300 - sy;
    const dir = (Math.atan2(dx, dy) * 180) / Math.PI;
    const dist = (Math.hypot(dx, dy) * S) / 300;
    onPick(Math.round(dir), Math.round(dist));
  });
  return h('div', { class: 'pad pad-wide', role: 'img', 'aria-label': 'Spray field pad' }, svg);
}
