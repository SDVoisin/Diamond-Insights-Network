// Shell: navigation, routing, shared filters, data loading.

import { h, clear, select, todayISO, addDays, toast } from './util.js';
import { state, loadAll } from './store.js';
import { derive } from './metrics.js';
import { purge, pitchColor } from './charts.js';
import { PITCH_TYPES } from './trackman.js';

import dashboard from './views/dashboard.js';
import players from './views/players.js';
import pitching from './views/pitching.js';
import hitting from './views/hitting.js';
import video from './views/video.js';
import importer from './views/importer.js';
import ops from './views/ops.js';
import logger from './views/logger.js';
import mechanics from './views/mechanics.js';

const ROUTES = [
  { path: 'dashboard', label: 'Dashboard', ico: '◧', view: dashboard, section: 'Overview' },
  { path: 'players', label: 'Players', ico: '☰', view: players },
  { path: 'pitching', label: 'Pitching Lab', ico: '◎', view: pitching, section: 'Development' },
  { path: 'hitting', label: 'Hitting Lab', ico: '⟋', view: hitting },
  { path: 'video', label: 'Video Room', ico: '▶', view: video },
  { path: 'mechanics', label: 'Mechanics Room', ico: '◐', view: mechanics },
  { path: 'log', label: 'Session Logger', ico: '✎', view: logger, section: 'Operations' },
  { path: 'import', label: 'Import Data', ico: '⇪', view: importer },
  { path: 'ops', label: 'Ops & Cameras', ico: '⚙', view: ops },
];

// ---------- shared filters ----------
const saved = (() => { try { return JSON.parse(localStorage.getItem('di-lab-filters') || '{}'); } catch { return {}; } })();
export const filters = {
  pitcher: saved.pitcher || '',
  hitter: saved.hitter || '',
  range: saved.range || 'all',
  from: saved.from || '',
  to: saved.to || '',
  sessionType: saved.sessionType || '',
  sessionId: '',
  types: new Set(),
};
function persistFilters() {
  try {
    localStorage.setItem('di-lab-filters', JSON.stringify({
      pitcher: filters.pitcher, hitter: filters.hitter, range: filters.range, from: filters.from, to: filters.to, sessionType: filters.sessionType,
    }));
  } catch { /* storage blocked: filters just don't persist */ }
}

export function dateBounds() {
  if (filters.range === 'custom') return [filters.from || '0000', filters.to || '9999'];
  if (filters.range === 'all') return ['0000', '9999'];
  // Relative ranges anchor on the latest data date, so an off-season
  // review of old sessions still shows "last 30 days of work".
  const latest = state.pitches.reduce((m, p) => (p.date > m ? p.date : m), '') || todayISO();
  const days = { '7': 7, '30': 30, '90': 90 }[filters.range] || 3650;
  return [addDays(latest, -days + 1), latest];
}

export function filtered({ role, playerKey, kinds } = {}) {
  const [from, to] = dateBounds();
  return state.pitches.filter((p) => {
    if (p.date < from || p.date > to) return false;
    if (filters.sessionType && p.sessionType !== filters.sessionType) return false;
    if (filters.sessionId && p.sessionId !== filters.sessionId) return false;
    if (kinds && !kinds.includes(p.kind)) return false;
    if (role === 'P' && playerKey && p.pitcherKey !== playerKey) return false;
    if (role === 'H' && playerKey && p.batterKey !== playerKey) return false;
    if (role === 'P' && filters.types.size && !filters.types.has(p.pitchType)) return false;
    return true;
  });
}

export const playerName = (id) => state.players.find((p) => p.id === id)?.name || id;

export function playersWithRole(role) {
  const keyField = role === 'P' ? 'pitcherKey' : 'batterKey';
  const counts = new Map();
  for (const p of state.pitches) if (p[keyField]) counts.set(p[keyField], (counts.get(p[keyField]) || 0) + 1);
  return state.players
    .filter((pl) => counts.has(pl.id) && !pl.archived && !pl.nonPlayer && (role === 'P' ? pl.roles?.includes('P') : pl.roles?.includes('H')))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const SESSION_TYPES = [['', 'All session types'], ['bullpen', 'Bullpen'], ['live', 'Live ABs'], ['game', 'Game'], ['bp', 'Batting practice'], ['cage', 'Cage / sensor']];

// Filter bar used by both labs. role: 'P' | 'H'.
export function filterBar(role, rerender) {
  const list = playersWithRole(role);
  const key = role === 'P' ? 'pitcher' : 'hitter';
  if (!list.some((p) => p.id === filters[key])) filters[key] = list[0]?.id || '';
  const keyField = role === 'P' ? 'pitcherKey' : 'batterKey';
  const sessions = state.sessions.filter((s) => state.pitches.some((p) => p.sessionId === s.id && p[keyField] === filters[key]));
  if (filters.sessionId && !sessions.some((s) => s.id === filters.sessionId)) filters.sessionId = '';
  const change = (k) => (v) => { filters[k] = v; persistFilters(); rerender(); };

  const bar = h('div', { class: 'filters', role: 'search' },
    h('label', { class: 'field' }, h('span', null, role === 'P' ? 'Pitcher' : 'Hitter'),
      select(list.map((p) => [p.id, p.name]), filters[key], change(key))),
    h('label', { class: 'field' }, h('span', null, 'Date range'),
      select([['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['custom', 'Custom…']], filters.range, change('range'))),
    filters.range === 'custom' ? [
      h('label', { class: 'field' }, h('span', null, 'From'), h('input', { type: 'date', value: filters.from, onchange: (e) => change('from')(e.target.value) })),
      h('label', { class: 'field' }, h('span', null, 'To'), h('input', { type: 'date', value: filters.to, onchange: (e) => change('to')(e.target.value) })),
    ] : null,
    h('label', { class: 'field' }, h('span', null, 'Session type'), select(SESSION_TYPES, filters.sessionType, change('sessionType'))),
    h('label', { class: 'field' }, h('span', null, 'Session'),
      select([['', 'All sessions'], ...sessions.map((s) => [s.id, `${s.date} · ${s.label || s.type}`])], filters.sessionId, change('sessionId'))),
  );
  if (role === 'P') {
    const types = [...new Set(state.pitches.filter((p) => p.pitcherKey === filters.pitcher && p.pitchType).map((p) => p.pitchType))];
    if (types.length > 1) {
      bar.appendChild(h('div', { class: 'field' }, h('span', null, 'Pitch types'),
        h('div', { class: 'chips' }, types.map((t) => h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(filters.types.size === 0 || filters.types.has(t)),
          onclick: () => {
            if (filters.types.size === 0) types.forEach((x) => x !== t && filters.types.add(x));
            else if (filters.types.has(t)) filters.types.delete(t); else filters.types.add(t);
            if (filters.types.size === types.length) filters.types.clear();
            rerender();
          },
        }, h('i', { class: 'dot', style: { background: pitchColor(t) } }), PITCH_TYPES[t] || t)))));
    }
  }
  return bar;
}

// ---------- shell + router ----------
let main, navEl;

export function navigate(path) {
  location.hash = '#/' + path;
}

export function currentRoute() {
  const [path, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { path: path || 'dashboard', params: rest.map(decodeURIComponent) };
}

export async function refresh() {
  await loadAll();
  derive(state.pitches);
  render();
}

export function render() {
  const { path, params } = currentRoute();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.path === route.path));
  purge(main);
  clear(main);
  document.querySelector('.sidebar')?.classList.remove('open');
  try {
    route.view(main, { params, rerender: render });
  } catch (err) {
    console.error(err);
    main.appendChild(h('div', { class: 'alert critical' }, h('div', null, h('b', null, 'This page hit an error'), String(err.message || err))));
  }
}

export function pageHeader(title, sub, actions) {
  return h('div', { class: 'topbar' },
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost menu-toggle', type: 'button', 'aria-label': 'Menu', onclick: () => document.querySelector('.sidebar').classList.toggle('open') }, '☰'),
      h('div', null, h('h1', { class: 'page-title' }, title), sub ? h('div', { class: 'page-sub' }, sub) : null)),
    actions || null);
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('di-lab-theme', t); } catch { /* ignore */ }
}

async function boot() {
  let theme = 'dark';
  try { theme = localStorage.getItem('di-lab-theme') || 'dark'; } catch { /* ignore */ }
  setTheme(theme);

  const root = document.getElementById('app');
  navEl = h('ul', { class: 'nav' });
  for (const r of ROUTES) {
    if (r.section) navEl.appendChild(h('li', { class: 'nav-section' }, r.section));
    navEl.appendChild(h('li', null, h('a', { href: '#/' + r.path, 'data-path': r.path }, h('span', { class: 'ico', 'aria-hidden': 'true' }, r.ico), r.label)));
  }
  main = h('main', { class: 'main', id: 'main' });
  root.appendChild(h('div', { class: 'app' },
    h('nav', { class: 'sidebar', 'aria-label': 'Lab navigation' },
      h('div', { class: 'brand' },
        h('div', { class: 'brand-mark' }, 'DIAMOND ', h('span', null, 'INSIGHTS')),
        h('div', { class: 'brand-sub' }, 'Player Development Lab')),
      navEl,
      h('div', { class: 'sidebar-foot' },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); render(); } }, 'Toggle light / dark'),
        h('a', { href: '../DiamondInsights.html' }, '← Diamond Insights home'))),
    main));

  window.addEventListener('hashchange', render);
  try {
    await refresh();
  } catch (err) {
    console.error(err);
    toast('Could not open local database: ' + err.message, 'error');
    render();
  }
}

boot();
