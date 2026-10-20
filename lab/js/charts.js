// Plotly wrappers. Every chart reads colours from CSS tokens so light/dark
// themes stay in sync, and pitch types keep one fixed colour + marker symbol
// everywhere (colour follows the pitch, never its rank in a chart).

import { PITCH_TYPES } from './trackman.js';
import { ZONE } from './config.js';
import { isNum } from './util.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const PITCH_SLOT = { FF: 8, SI: 2, CT: 5, SL: 4, SW: 3, CB: 1, CH: 6, SP: 7 };
const PITCH_SYMBOL = {
  FF: 'circle', SI: 'diamond', CT: 'triangle-up', SL: 'square', SW: 'triangle-right',
  CB: 'triangle-down', CH: 'cross', SP: 'x', KN: 'star', OT: 'circle-open',
};

export const pitchColor = (t) => (PITCH_SLOT[t] ? css(`--series-${PITCH_SLOT[t]}`) : css('--text-muted'));
export const pitchSymbol = (t) => PITCH_SYMBOL[t] || 'circle';
export const seriesColor = (i) => css(`--series-${(i % 8) + 1}`);

function baseLayout(extra = {}) {
  const ink2 = css('--text-secondary'), grid = css('--grid'), axis = css('--axis');
  const ax = { gridcolor: grid, zerolinecolor: axis, linecolor: axis, tickfont: { color: ink2, size: 11 }, title: { font: { color: ink2, size: 12 } }, automargin: true };
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: css('--font'), color: css('--text-primary'), size: 12 },
    margin: { l: 48, r: 16, t: 28, b: 44 },
    hoverlabel: { bgcolor: css('--surface-2'), bordercolor: css('--border-strong'), font: { color: css('--text-primary') } },
    legend: { orientation: 'h', x: 0, y: 1.02, xanchor: 'left', yanchor: 'bottom', font: { color: ink2 } },
    ...extra,
    xaxis: { ...ax, ...(extra.xaxis || {}) },
    yaxis: { ...ax, ...(extra.yaxis || {}) },
  };
}

const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'] };

export function plot(el, traces, layout = {}, opts = {}) {
  if (!window.Plotly) { el.textContent = 'Charts library failed to load.'; return; }
  window.Plotly.react(el, traces, baseLayout(layout), { ...CONFIG, ...opts });
  if (opts.onClick) {
    el.removeAllListeners?.('plotly_click');
    el.on('plotly_click', (ev) => { const pt = ev.points?.[0]; if (pt) opts.onClick(pt.customdata, pt); });
  }
}

export function chartBox(cls = '') {
  const d = document.createElement('div');
  d.className = 'chart ' + cls;
  return d;
}

// One trace per pitch type, in canonical order.
function byType(pitches, xf, yf, hover, extra = {}) {
  const types = [...new Set(pitches.map((p) => p.pitchType || 'OT'))];
  return types.map((t) => {
    const ps = pitches.filter((p) => (p.pitchType || 'OT') === t && isNum(xf(p)) && isNum(yf(p)));
    return {
      // SVG keeps centroid labels/targets drawn above the points; WebGL only for big sets.
      type: pitches.length > 2500 ? 'scattergl' : 'scatter', mode: 'markers', name: PITCH_TYPES[t] || t,
      x: ps.map(xf), y: ps.map(yf), customdata: ps.map((p) => p.uid),
      text: ps.map(hover),
      hovertemplate: '%{text}<extra></extra>',
      marker: { color: pitchColor(t), symbol: pitchSymbol(t), size: 8, opacity: 0.75, line: { width: 1, color: css('--surface-1') } },
      ...extra,
    };
  }).filter((tr) => tr.x.length);
}

const pitchHover = (p) => `<b>${PITCH_TYPES[p.pitchType] || 'Pitch'}</b> · ${p.date} #${p.pitchNo ?? ''}<br>` +
  `${fmtN(p.velo)} mph · ${fmtN(p.spin, 0)} rpm<br>IVB ${fmtN(p.ivb)} · HB ${fmtN(p.hb)}` +
  (isNum(p.stuff) ? `<br>DI Stuff ${fmtN(p.stuff, 0)}` : '');
const fmtN = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '—');

// Centroid labels: identity never rests on colour alone.
function centroidLabels(rows, xk, yk) {
  return {
    type: 'scatter', mode: 'markers+text', showlegend: false, hoverinfo: 'skip',
    x: rows.map((r) => r[xk]), y: rows.map((r) => r[yk]),
    text: rows.map((r) => r.type), textposition: 'top center',
    textfont: { color: css('--text-primary'), size: 12 },
    marker: { size: 14, color: rows.map((r) => pitchColor(r.type)), symbol: rows.map((r) => pitchSymbol(r.type)), line: { width: 2, color: css('--text-primary') } },
  };
}

export function movementPlot(el, pitches, arsenalRows, targets = []) {
  const traces = byType(pitches, (p) => p.hb, (p) => p.ivb, pitchHover);
  if (arsenalRows?.length) traces.push(centroidLabels(arsenalRows, 'hb', 'ivb'));
  for (const t of targets) {
    traces.push({
      type: 'scatter', mode: 'markers+text', name: `Target ${t.type}`, showlegend: false,
      x: [t.hb], y: [t.ivb], text: [`${t.type} target`], textposition: 'bottom center',
      textfont: { color: css('--text-secondary'), size: 11 },
      marker: { size: 18, symbol: 'circle-open-dot', color: pitchColor(t.type), line: { width: 2 } },
      hovertemplate: `${t.type} target<br>IVB %{y} · HB %{x}<extra></extra>`,
    });
  }
  plot(el, traces, {
    xaxis: { title: { text: 'Horizontal break (in)' }, range: [-25, 25], zeroline: true, dtick: 10 },
    yaxis: { title: { text: 'Induced vertical break (in)' }, range: [-25, 25], zeroline: true, dtick: 10, scaleanchor: 'x' },
  });
}

export function releasePlot(el, pitches) {
  plot(el, byType(pitches, (p) => p.relS, (p) => p.relH, (p) => `${PITCH_TYPES[p.pitchType] || ''}<br>Side ${fmtN(p.relS, 2)} ft · Height ${fmtN(p.relH, 2)} ft · Ext ${fmtN(p.ext, 2)} ft`), {
    xaxis: { title: { text: 'Release side (ft)' }, range: [-4, 4] },
    yaxis: { title: { text: 'Release height (ft)' }, range: [3, 7.5] },
  });
}

function zoneShapes() {
  const c = css('--text-secondary');
  const w = ZONE.halfWidth, b = ZONE.bottom, t = ZONE.top;
  const shapes = [{ type: 'rect', x0: -w, x1: w, y0: b, y1: t, line: { color: c, width: 2 } }];
  for (let i = 1; i < 3; i++) {
    shapes.push({ type: 'line', x0: -w + (2 * w * i) / 3, x1: -w + (2 * w * i) / 3, y0: b, y1: t, line: { color: css('--grid'), width: 1 } });
    shapes.push({ type: 'line', x0: -w, x1: w, y0: b + ((t - b) * i) / 3, y1: b + ((t - b) * i) / 3, line: { color: css('--grid'), width: 1 } });
  }
  // home plate, catcher's view
  shapes.push({ type: 'path', path: `M ${-0.708} 0.25 L 0.708 0.25 L 0.708 0.1 L 0 -0.05 L -0.708 0.1 Z`, line: { color: css('--axis') }, fillcolor: css('--surface-2') });
  return shapes;
}

export const zoneLayout = (extra = {}) => ({
  shapes: zoneShapes(),
  xaxis: { title: { text: 'Plate side (ft, catcher view)' }, range: [-2.2, 2.2], zeroline: false, dtick: 0.5 },
  yaxis: { title: { text: 'Plate height (ft)' }, range: [-0.2, 5], zeroline: false, scaleanchor: 'x', dtick: 0.5 },
  margin: { l: 44, r: 8, t: 20, b: 44 },
  ...extra,
});

// Locations with optional target markers + miss vectors.
export function locationPlot(el, pitches, targetMap, opts = {}) {
  const traces = byType(pitches, (p) => p.plateX, (p) => p.plateZ, (p) => {
    const t = targetMap?.get(p.uid);
    const miss = t ? Math.hypot(p.plateX - t.x, p.plateZ - t.z) * 12 : NaN;
    return pitchHover(p) + (isNum(miss) ? `<br>Miss ${miss.toFixed(1)} in` : '') + (p.call ? `<br>${p.call}` : '');
  });
  if (targetMap && opts.showMiss) {
    const xs = [], ys = [];
    for (const p of pitches) {
      const t = targetMap.get(p.uid);
      if (t && isNum(p.plateX)) { xs.push(t.x, p.plateX, null); ys.push(t.z, p.plateZ, null); }
    }
    if (xs.length) traces.unshift({ type: 'scatter', mode: 'lines', name: 'Miss vector', x: xs, y: ys, hoverinfo: 'skip', line: { color: css('--text-muted'), width: 1 } });
    const tg = [...new Map(pitches.map((p) => targetMap.get(p.uid)).filter(Boolean).map((t) => [`${t.x},${t.z}`, t])).values()];
    if (tg.length) traces.push({ type: 'scatter', mode: 'markers', name: 'Target', x: tg.map((t) => t.x), y: tg.map((t) => t.z), hovertemplate: 'Target<extra></extra>', marker: { symbol: 'circle-open-dot', size: 16, color: css('--accent'), line: { width: 2 } } });
  }
  plot(el, traces, zoneLayout(), { onClick: opts.onClick });
}

// Density heat map of locations (one pitch type or all).
export function locationDensity(el, pitches) {
  const ps = pitches.filter((p) => isNum(p.plateX) && isNum(p.plateZ));
  plot(el, [{
    type: 'histogram2dcontour', x: ps.map((p) => p.plateX), y: ps.map((p) => p.plateZ),
    colorscale: seqScale(), showscale: false, ncontours: 12, contours: { coloring: 'heatmap', showlines: false },
    hoverinfo: 'skip',
  }], zoneLayout());
}

// Narrow ramp for heat maps carrying text labels: stays in the range where
// the theme's primary ink keeps contrast on every cell.
const heatScale = () => [[0, css('--heat-lo')], [1, css('--heat-hi')]];

export function seqScale() {
  return [[0, 'rgba(0,0,0,0)'], [0.15, css('--seq-150')], [0.4, css('--seq-300')], [0.7, css('--seq-450')], [1, css('--seq-650')]];
}

// Spin axis as a clock face (polar): 12:00 = pure backspin.
export function spinClock(el, arsenalRows) {
  const rows = arsenalRows.filter((r) => isNum(r.axis));
  plot(el, rows.map((r) => ({
    type: 'scatterpolar', mode: 'markers+text', name: PITCH_TYPES[r.type],
    r: [isNum(r.spinEff) ? r.spinEff * 100 : 100], theta: [((r.axis + 180) % 360)],
    text: [r.type], textposition: 'top center', textfont: { color: css('--text-primary') },
    marker: { size: 14, color: pitchColor(r.type), symbol: pitchSymbol(r.type), line: { width: 2, color: css('--surface-1') } },
    hovertemplate: `${PITCH_TYPES[r.type]}<br>Axis ${r.axis.toFixed(0)}°<br>Spin eff. %{r:.0f}%<extra></extra>`,
  })), {
    polar: {
      bgcolor: 'rgba(0,0,0,0)',
      angularaxis: { direction: 'clockwise', rotation: 90, tickmode: 'array', tickvals: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], ticktext: ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'], gridcolor: css('--grid'), linecolor: css('--axis'), tickfont: { color: css('--text-secondary') } },
      radialaxis: { range: [0, 100], ticksuffix: '%', gridcolor: css('--grid'), tickfont: { color: css('--text-muted'), size: 9 }, angle: 90 },
    },
    showlegend: false,
    margin: { l: 30, r: 30, t: 30, b: 30 },
  });
}

// Generic development curve: points per session, rolling mean, trend, goal.
export function trendPlot(el, series, opts = {}) {
  const traces = [];
  series.forEach((s, i) => {
    const color = s.color || seriesColor(i);
    traces.push({
      type: 'scatter', mode: 'markers', name: s.name, x: s.pts.map((d) => d.date), y: s.pts.map((d) => d.value * (opts.scale || 1)),
      marker: { color, size: 8, line: { width: 1, color: css('--surface-1') } },
      customdata: s.pts.map((d) => d.n),
      hovertemplate: `${s.name}: <b>%{y:.${opts.d ?? 1}f}</b> ${opts.unit || ''}<br>%{x} · n=%{customdata}<extra></extra>`,
    });
    traces.push({ type: 'scatter', mode: 'lines', name: `${s.name} (3-session avg)`, showlegend: false, x: s.pts.map((d) => d.date), y: s.pts.map((d) => d.rolling * (opts.scale || 1)), line: { color, width: 2 }, hoverinfo: 'skip' });
    if (s.pts.length >= 3) traces.push({ type: 'scatter', mode: 'lines', name: `${s.name} trend`, showlegend: false, x: s.pts.map((d) => d.date), y: s.pts.map((d) => d.fit * (opts.scale || 1)), line: { color, width: 1, dash: 'dot' }, hoverinfo: 'skip' });
  });
  const shapes = [], annotations = [];
  for (const g of opts.goals || []) {
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: g.value, y1: g.value, line: { color: css('--accent'), width: 1.5, dash: 'dash' } });
    annotations.push({ xref: 'paper', x: 1, y: g.value, xanchor: 'right', yanchor: 'bottom', text: g.label, showarrow: false, font: { color: css('--text-secondary'), size: 11 } });
  }
  plot(el, traces, {
    shapes, annotations,
    xaxis: { type: 'date', title: { text: '' } },
    yaxis: { title: { text: opts.ytitle || '' } },
    hovermode: 'x unified',
    showlegend: series.length > 1,
  });
}

// Within-session sequence (velo fade, etc.).
export function sequencePlot(el, pitches, key, ytitle) {
  const types = [...new Set(pitches.map((p) => p.pitchType || 'OT'))];
  plot(el, types.map((t) => {
    const ps = pitches.map((p, i) => ({ p, i: i + 1 })).filter(({ p }) => (p.pitchType || 'OT') === t && isNum(p[key]));
    return {
      type: 'scatter', mode: 'lines+markers', name: PITCH_TYPES[t] || t,
      x: ps.map((d) => d.i), y: ps.map((d) => d.p[key]),
      line: { color: pitchColor(t), width: 2 }, marker: { color: pitchColor(t), symbol: pitchSymbol(t), size: 8 },
      hovertemplate: `${PITCH_TYPES[t] || t} · pitch %{x}<br><b>%{y:.1f}</b><extra></extra>`,
    };
  }), { xaxis: { title: { text: 'Pitch # in session' } }, yaxis: { title: { text: ytitle } } });
}

// ---------- hitting ----------
export function evLaPlot(el, bip) {
  const ps = bip.filter((p) => isNum(p.ev) && isNum(p.la));
  const barrel = { type: 'path', path: 'M 98 26 L 116 8 L 125 8 L 125 50 L 116 50 L 98 30 Z', fillcolor: css('--accent-soft'), line: { width: 0 }, layer: 'below' };
  plot(el, [{
    type: 'scattergl', mode: 'markers', name: 'Batted balls',
    x: ps.map((p) => p.ev), y: ps.map((p) => p.la), customdata: ps.map((p) => p.uid),
    text: ps.map((p) => `${p.date}<br><b>${fmtN(p.ev)} mph</b> @ ${fmtN(p.la)}°<br>${fmtN(p.dist, 0)} ft` + (isNum(p.batSpeed) ? `<br>Bat ${fmtN(p.batSpeed)} mph` : '')),
    hovertemplate: '%{text}<extra></extra>',
    marker: { size: 8, color: ps.map((p) => p.ev), colorscale: seqScale().slice(1).map(([v, c], i, a) => [i / (a.length - 1), c]), opacity: 0.85, line: { width: 1, color: css('--surface-1') } },
  }], {
    shapes: [barrel, { type: 'rect', x0: 40, x1: 125, y0: 8, y1: 32, fillcolor: css('--surface-2'), opacity: 0.5, line: { width: 0 }, layer: 'below' }],
    annotations: [{ x: 112, y: 46, text: 'Barrel', showarrow: false, font: { color: css('--text-secondary') } }, { x: 45, y: 30, xanchor: 'left', text: 'Sweet spot 8–32°', showarrow: false, font: { color: css('--text-muted'), size: 11 } }],
    xaxis: { title: { text: 'Exit velocity (mph)' }, range: [40, 120] },
    yaxis: { title: { text: 'Launch angle (°)' }, range: [-60, 80] },
    showlegend: false,
  });
}

export function sprayChart(el, bip) {
  const ps = bip.filter((p) => isNum(p.dir) && isNum(p.dist));
  const fx = (p) => p.dist * Math.sin((p.dir * Math.PI) / 180);
  const fy = (p) => p.dist * Math.cos((p.dir * Math.PI) / 180);
  const line = css('--axis');
  const arc = []; for (let a = -45; a <= 45; a += 3) arc.push([380 * Math.sin((a * Math.PI) / 180), 380 * Math.cos((a * Math.PI) / 180)]);
  const inf = [[0, 0], [90 * Math.sin(Math.PI / 4), 90 * Math.cos(Math.PI / 4)], [0, 127.3], [-90 * Math.sin(Math.PI / 4), 90 * Math.cos(Math.PI / 4)], [0, 0]];
  plot(el, [
    { type: 'scatter', mode: 'lines', x: [-269, 0, 269], y: [269, 0, 269], line: { color: line, width: 1 }, hoverinfo: 'skip', showlegend: false },
    { type: 'scatter', mode: 'lines', x: arc.map((a) => a[0]), y: arc.map((a) => a[1]), line: { color: line, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false },
    { type: 'scatter', mode: 'lines', x: inf.map((a) => a[0]), y: inf.map((a) => a[1]), line: { color: line, width: 1 }, hoverinfo: 'skip', showlegend: false },
    {
      type: 'scattergl', mode: 'markers', name: 'Batted balls', x: ps.map(fx), y: ps.map(fy), customdata: ps.map((p) => p.uid),
      text: ps.map((p) => `${fmtN(p.ev)} mph · ${fmtN(p.la)}° · ${fmtN(p.dist, 0)} ft`), hovertemplate: '%{text}<extra></extra>',
      marker: { size: 8, color: ps.map((p) => p.ev), colorscale: seqScale().slice(1).map(([v, c], i, a) => [i / (a.length - 1), c]), cmin: 60, cmax: 105, line: { width: 1, color: css('--surface-1') } },
    },
  ], {
    xaxis: { range: [-300, 300], visible: false }, yaxis: { range: [-20, 420], visible: false, scaleanchor: 'x' },
    showlegend: false, margin: { l: 8, r: 8, t: 8, b: 8 },
  });
}

// 5x5 grid heat map of a metric by pitch location (catcher view).
export function zoneGrid(el, pitches, valueFn, opts = {}) {
  const xs = [-1.33, -0.83, -0.28, 0.28, 0.83, 1.33];
  const zs = [0.9, 1.5, 2.17, 2.83, 3.5, 4.1];
  const z = [], text = [];
  for (let j = 4; j >= 0; j--) {
    const row = [], trow = [];
    for (let i = 0; i < 5; i++) {
      const cell = pitches.filter((p) => isNum(p.plateX) && isNum(p.plateZ) && p.plateX >= xs[i] && p.plateX < xs[i + 1] && p.plateZ >= zs[j] && p.plateZ < zs[j + 1]);
      const v = cell.length >= (opts.minN || 3) ? valueFn(cell) : NaN;
      row.push(isNum(v) ? v : null);
      trow.push(isNum(v) ? `${(v * (opts.scale || 1)).toFixed(opts.d ?? 0)}${opts.suffix || ''}<br>n=${cell.length}` : `n=${cell.length}`);
    }
    z.push(row); text.push(trow);
  }
  const cx = xs.slice(0, 5).map((x, i) => (x + xs[i + 1]) / 2);
  const cz = zs.slice(0, 5).map((x, i) => (x + zs[i + 1]) / 2).reverse();
  plot(el, [{
    type: 'heatmap', x: cx, y: cz, z, text, texttemplate: '%{text}', textfont: { color: css('--text-primary'), size: 11 },
    hovertemplate: '%{text}<extra></extra>', colorscale: heatScale(),
    showscale: false, xgap: 2, ygap: 2, zmin: opts.zmin, zmax: opts.zmax,
  }], zoneLayout({ yaxis: { range: [0.6, 4.4], scaleanchor: 'x', title: { text: 'Plate height (ft)' }, dtick: 0.5 }, xaxis: { range: [-1.6, 1.6], title: { text: 'Plate side (ft, catcher view)' }, dtick: 0.5 } }));
}

export function scatter(el, pts, opts) {
  // pts: [{x, y, text, group}]
  const groups = [...new Set(pts.map((p) => p.group || ''))];
  plot(el, groups.map((g, i) => {
    const ps = pts.filter((p) => (p.group || '') === g);
    return {
      type: 'scattergl', mode: 'markers', name: g || opts.name || 'Swings', x: ps.map((p) => p.x), y: ps.map((p) => p.y), text: ps.map((p) => p.text || ''),
      hovertemplate: '%{text}<extra></extra>', customdata: ps.map((p) => p.uid),
      marker: { size: 8, color: opts.colorFor ? opts.colorFor(g) : seriesColor(i), symbol: opts.symbolFor ? opts.symbolFor(g) : 'circle', opacity: 0.8, line: { width: 1, color: css('--surface-1') } },
    };
  }), {
    xaxis: { title: { text: opts.xtitle }, range: opts.xrange }, yaxis: { title: { text: opts.ytitle }, range: opts.yrange },
    showlegend: groups.length > 1, shapes: opts.shapes || [],
  }, { onClick: opts.onClick });
}

export function bars(el, cats, series, opts = {}) {
  // series: [{name, values, color}] -> grouped or stacked bars
  plot(el, series.map((s, i) => ({
    type: 'bar', name: s.name, x: cats, y: s.values.map((v) => (isNum(v) ? v * (opts.scale || 1) : null)),
    marker: { color: s.color || seriesColor(i), line: { width: 0 } },
    texttemplate: opts.labels ? `%{y:.${opts.d ?? 0}f}${opts.suffix || ''}` : undefined, textposition: 'inside',
    insidetextfont: { color: '#fff' },
    hovertemplate: `${s.name}: <b>%{y:.${opts.d ?? 0}f}${opts.suffix || ''}</b><extra>%{x}</extra>`,
  })), {
    barmode: opts.stack ? 'stack' : 'group', bargap: 0.35, bargroupgap: 0.08,
    yaxis: { title: { text: opts.ytitle || '' }, range: opts.yrange }, xaxis: { type: 'category' },
    showlegend: series.length > 1,
  });
}

export function histogram(el, values, opts = {}) {
  plot(el, [{ type: 'histogram', x: values, marker: { color: css('--series-1'), line: { width: 1, color: css('--surface-1') } }, xbins: opts.bins, hovertemplate: '%{x}: %{y}<extra></extra>' }], {
    xaxis: { title: { text: opts.xtitle } }, yaxis: { title: { text: 'Count' } }, bargap: 0.05, showlegend: false,
    shapes: opts.shapes || [],
  });
}

export function purge(root) {
  if (!window.Plotly) return;
  root.querySelectorAll('.js-plotly-plot').forEach((el) => window.Plotly.purge(el));
}
