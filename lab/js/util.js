// Small DOM + data helpers shared by every view. No framework: views build
// DOM with h() and all user/CSV-provided text goes in as text nodes.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'multiple') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function select(options, value, onchange, attrs = {}) {
  return h('select', { ...attrs, onchange: (e) => onchange(e.target.value) },
    options.map((o) => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: val, selected: String(val) === String(value) }, label);
    }));
}

export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Trackman writes names as "Last, First". Show "First Last" everywhere.
export function displayName(raw) {
  const s = String(raw || '').trim();
  if (!s.includes(',')) return s.replace(/\s+/g, ' ');
  const [last, first] = s.split(',').map((x) => x.trim());
  return `${first} ${last}`.trim();
}

export function playerIdFromName(raw) {
  return 'p-' + slug(displayName(raw));
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function fmt(v, digits = 1, suffix = '') {
  if (!isNum(v)) return '—';
  return v.toFixed(digits) + suffix;
}

export function pct(v, digits = 0) {
  return isNum(v) ? (v * 100).toFixed(digits) + '%' : '—';
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function todayISO() {
  const d = new Date();
  return localISO(d);
}

export function localISO(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function daysBetween(a, b) {
  return (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function toast(msg, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

export function hashId(str) {
  // FNV-1a, enough to give stable ids to sessions/pitches without a server.
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return (x >>> 0).toString(36);
}

export function card(title, ...body) {
  return h('section', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, ...body);
}

export function table(columns, rows, opts = {}) {
  // columns: [{ key, label, fmt?: (v,row)=>string|Node, num?: bool }]
  const thead = h('thead', null, h('tr', null, columns.map((c) =>
    h('th', { class: c.num ? 'num' : null, title: c.title || null }, c.label))));
  const tbody = h('tbody', null, rows.map((r) => h('tr', {
    class: opts.rowClass ? opts.rowClass(r) : null,
    onclick: opts.onRowClick ? () => opts.onRowClick(r) : null,
    tabindex: opts.onRowClick ? '0' : null,
    onkeydown: opts.onRowClick ? (e) => { if (e.key === 'Enter') opts.onRowClick(r); } : null,
  }, columns.map((c) => {
    const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key];
    return h('td', { class: c.num ? 'num' : null }, v === undefined || v === null || v === '' ? '—' : v);
  }))));
  return h('div', { class: 'table-wrap' }, h('table', { class: opts.compact ? 'compact' : null }, thead, tbody));
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

// In-page confirmation. Native confirm() is blocked in sandboxed frames and
// embedded viewers, so destructive actions ask through a <dialog> instead.
export function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-label': 'Confirm' },
      h('p', null, message),
      h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('cancel') }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dlg.close('ok') }, okLabel)));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

export function empty(msg, action) {
  return h('div', { class: 'empty' }, h('p', null, msg), action || null);
}
