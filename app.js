/* Transform Fitness kit store. Preact + htm, hash-routed, bag/orders kept in this browser. */
(() => {
'use strict';
const { html, render, useState, useEffect, useMemo, useRef, createContext, useContext } = window.htmPreact;

// ---------------------------------------------------------------- catalogue
const DATA = window.TF_CATALOG;
// Design variants live under /options/<name>/ and share this file; they set
// TF_ASSET_BASE so the catalogue's relative image paths resolve from the root,
// and TF_SITE to override hero copy, media and a few optional sections.
const ASSET = window.TF_ASSET_BASE ? String(window.TF_ASSET_BASE).replace(/[/]+$/, '') + '/' : '';
const SITE = window.TF_SITE || {};
if (ASSET) DATA.products.forEach(p => p.variants.forEach(v => v.images.forEach(im => { if (!/^([a-z]+:)?[/]/i.test(im.src)) im.src = ASSET + im.src; })));
const PRODUCTS = DATA.products;
const CATS = DATA.categories;
const GYM = DATA.gym;
const BY_SLUG = Object.fromEntries(PRODUCTS.map(p => [p.slug, p]));
const CAT_BY = Object.fromEntries(CATS.map(c => [c.slug, c]));
const VARIANT = {};
PRODUCTS.forEach(p => p.variants.forEach((v, i) => { VARIANT[v.id] = { p, v, i }; }));
const COLOURWAYS = PRODUCTS.reduce((n, p) => n + p.variants.length, 0);

const FREE_DELIVERY_OVER = 60;
const DELIVERY_FEE = 4.95;
// Payments run through the Transform Hub API (Stripe Checkout). If it can't be
// reached the store still works and falls back to a request-only checkout.
const API_BASE = (() => { try { return (localStorage.getItem('tf.api') || 'https://app.tcmfuel.com').replace(/[/]+$/, ''); } catch (e) { return 'https://app.tcmfuel.com'; } })();
const PAY = { checked: false, stripe: false, fee: DELIVERY_FEE, freeOver: FREE_DELIVERY_OVER };
const timeoutSignal = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
// Coming back from Stripe: ?paid=<session> confirms, ?cancelled=<ref> returns to the bag.
const PAID_RETURN = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const session = q.get('paid') || ''; const cancelled = q.get('cancelled') || '';
    if (session || cancelled) history.replaceState(null, '', location.pathname + location.hash);
    return { session, cancelled };
  } catch (e) { return { session: '', cancelled: '' }; }
})();
const FEATURED = ['back-mark-tee', 'classic-hoodie', 'performance-vest', 'core-sports-bra', 'team-tee', 'heavyweight-crew', 'training-shorts', 'training-holdall'];
const CAT_COVER = { tees: 'back-mark-tee', vests: 'performance-vest', bras: 'core-sports-bra', hoodies: 'classic-hoodie', sweats: 'heavyweight-crew', shorts: 'training-shorts', outerwear: 'padded-gilet', headwear: 'air-mesh-cap', bags: 'training-holdall' };
const TAGS = {
  'back-mark-tee': ['Back print'], 'team-tee': ['Back print'], 'tech-zip-hoodie': ['Back print'],
  'heavyweight-crew': ['Embroidered'], 'training-shorts': ['Recycled'], 'padded-gilet': ['Recycled'],
  'training-holdall': ['Recycled'], 'classic-hoodie': ['To 6XL'], 'cotton-tank': ['To 5XL'],
  'morf-neck-tube': ['Unbranded'], 'molle-backpack-35': ['Unbranded'], 'molle-backpack-25': ['Unbranded'],
};
const LOGO_NAME = { green: 'Green', silver: 'Silver', black: 'Black', none: 'Unbranded' };
const COLOUR_GROUPS = ['Black', 'Green', 'Camo'];
const COLOUR_DOT = { Black: '#151615', Green: '#57603a', Camo: 'conic-gradient(#3b3f2a 0 25%,#1f2218 0 50%,#5d5d3f 0 75%,#2b2e20 0)' };
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL', 'One size'];
const normSize = s => (s === '2XL' ? 'XXL' : s);
const colourGroup = v => (v.family === 'Lime' ? 'Green' : v.family);

const gbp = n => '£' + (Math.round(n * 100) / 100).toFixed(2);
const minPrice = p => Math.min(...p.variants.map(v => v.price));
const maxPrice = p => Math.max(...p.variants.map(v => v.price));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const optionKind = p => (new Set(p.variants.map(v => v.colour)).size > 1 ? 'Colourway' : 'Print');

// ---------------------------------------------------------------- storage + store
const LS = {
  get(k, d) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const CLOSED = { bag: false, search: false, menu: false, quick: null, guide: null, filters: false };
function createStore(init) {
  let s = init; const subs = new Set();
  return {
    get: () => s,
    set(fn) { s = typeof fn === 'function' ? fn(s) : fn; subs.forEach(f => f(s)); },
    sub(f) { subs.add(f); return () => subs.delete(f); },
  };
}
const validLine = l => l && VARIANT[l.vid] && typeof l.size === 'string' && l.qty > 0;
const store = createStore({
  bag: LS.get('tf.bag', []).filter(validLine),
  saved: LS.get('tf.saved', []).filter(s => BY_SLUG[s]),
  orders: LS.get('tf.orders', []),
  recent: LS.get('tf.recent', []).filter(s => BY_SLUG[s]),
  fit: LS.get('tf.fit', {}),
  pay: { checked: false, stripe: false },
  ui: { ...CLOSED, query: '' },
  toasts: [],
  bumps: 0,
});
let prev = store.get();
store.sub(s => {
  for (const k of ['bag', 'saved', 'orders', 'recent', 'fit']) if (s[k] !== prev[k]) LS.set('tf.' + k, s[k]);
  prev = s;
});

let toastSeq = 0;
const A = {
  ui(patch) { store.set(s => ({ ...s, ui: { ...s.ui, ...patch } })); },
  closeAll() { store.set(s => ({ ...s, ui: { ...s.ui, ...CLOSED } })); },
  add(vid, size, qty = 1) {
    if (!VARIANT[vid]) return;
    store.set(s => {
      const key = vid + '|' + size; const bag = s.bag.slice();
      const i = bag.findIndex(l => l.key === key);
      if (i >= 0) bag[i] = { ...bag[i], qty: Math.min(10, bag[i].qty + qty) };
      else bag.push({ key, vid, size, qty });
      return { ...s, bag, bumps: s.bumps + 1 };
    });
    A.toast({ kind: 'added', vid, size, qty });
  },
  addMany(items) {
    store.set(s => {
      const bag = s.bag.slice();
      for (const { vid, size } of items) {
        const key = vid + '|' + size; const i = bag.findIndex(l => l.key === key);
        if (i >= 0) bag[i] = { ...bag[i], qty: Math.min(10, bag[i].qty + 1) }; else bag.push({ key, vid, size, qty: 1 });
      }
      return { ...s, bag, bumps: s.bumps + 1 };
    });
    A.toast({ kind: 'added', vid: items[0].vid, size: items[0].size, title: `Race kit added (${plural(items.length, 'item')})` });
  },
  setQty(key, qty) { store.set(s => ({ ...s, bag: s.bag.map(l => (l.key === key ? { ...l, qty: Math.max(1, Math.min(10, qty)) } : l)) })); },
  remove(key) {
    const bag0 = store.get().bag; const idx = bag0.findIndex(l => l.key === key); const line = bag0[idx];
    if (!line) return;
    store.set(s => ({ ...s, bag: s.bag.filter(l => l.key !== key) }));
    A.toast({
      kind: 'removed', vid: line.vid, size: line.size,
      undo: () => store.set(s => { const bag = s.bag.slice(); bag.splice(Math.min(idx, bag.length), 0, line); return { ...s, bag }; }),
    });
  },
  toggleSave(slug) {
    const on = !store.get().saved.includes(slug);
    store.set(s => ({ ...s, saved: on ? [slug, ...s.saved] : s.saved.filter(x => x !== slug) }));
    A.toast({ kind: 'plain', title: on ? `${BY_SLUG[slug].name} saved` : `${BY_SLUG[slug].name} removed from saved`, action: on ? { label: 'View', to: 'saved' } : null });
  },
  viewed(slug) { store.set(s => (s.recent[0] === slug ? s : { ...s, recent: [slug, ...s.recent.filter(x => x !== slug)].slice(0, 8) })); },
  setFit(patch) { store.set(s => ({ ...s, fit: { ...s.fit, ...patch } })); },
  toast(t) {
    const id = ++toastSeq;
    store.set(s => ({ ...s, toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => A.dismiss(id), t.undo ? 6500 : 4200);
  },
  dismiss(id) { store.set(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) })); },
  placeOrder(order, keepBag = false) { store.set(s => ({ ...s, orders: [order, ...s.orders.filter(o => o.ref !== order.ref)].slice(0, 25), bag: keepBag ? s.bag : [] })); },
  // Live status came back from the API: keep the local copy in step and empty
  // the bag the first time an order turns out to be paid.
  orderSettled(ref, status) {
    store.set(s => {
      const prev = s.orders.find(o => o.ref === ref);
      const wasPending = !prev || prev.status === 'pending';
      const paidNow = !['pending', 'cancelled', 'request'].includes(status);
      return { ...s, orders: prev ? s.orders.map(o => (o.ref === ref ? { ...o, status } : o)) : s.orders, bag: wasPending && paidNow ? [] : s.bag };
    });
  },
  setPay(p) { Object.assign(PAY, p); store.set(s => ({ ...s, pay: { ...s.pay, ...p } })); },
};

// Ask the API whether card payments are on. Resolves either way; the store
// degrades to a request-only checkout when it can't get an answer.
const payReady = (async () => {
  try {
    const r = await fetch(API_BASE + '/api/shop/config', { signal: timeoutSignal(7000) });
    if (!r.ok) throw new Error('config ' + r.status);
    const c = await r.json();
    A.setPay({ checked: true, stripe: !!(c.stripe && c.catalogueOk), fee: (c.deliveryPence ?? 495) / 100, freeOver: (c.freeDeliveryOverPence ?? 6000) / 100 });
  } catch (e) { A.setPay({ checked: true, stripe: false }); }
})();

const Ctx = createContext(store.get());
const useS = () => useContext(Ctx);

// ---------------------------------------------------------------- routing (hash tokens only)
function parseHash(raw) {
  const h = String(raw || '').replace(/^#/, '');
  if (!h || h === 'home') return { name: 'home' };
  if (h === 'kit') return { name: 'home', anchor: 'kit' };
  if (h === 'shop') return { name: 'shop' };
  if (h.startsWith('shop-') && CAT_BY[h.slice(5)]) return { name: 'shop', cat: h.slice(5) };
  if (h.startsWith('print-') && LOGO_NAME[h.slice(6)]) return { name: 'shop', print: h.slice(6) };
  if (h.startsWith('p-')) {
    const [slug, v] = h.slice(2).split('.');
    if (BY_SLUG[slug]) return { name: 'product', slug, vi: v && /^v\d+$/.test(v) ? +v.slice(1) : 0 };
  }
  if (h === 'checkout') return { name: 'checkout' };
  if (h.startsWith('order-')) return { name: 'order', ref: h.slice(6) };
  if (h === 'orders' || h === 'saved' || h === 'help') return { name: h };
  if (h.startsWith('help-')) return { name: 'help', anchor: h.slice(5) };
  return { name: 'notfound' };
}
const routeKey = r => [r.name, r.cat, r.print, r.slug, r.ref, r.anchor].join('|');
let current = parseHash(location.hash);
const routeSubs = new Set();
function setRoute(r) { current = r; routeSubs.forEach(f => f(r)); }
function nav(to) {
  A.closeAll();
  try { if (location.hash !== '#' + to) history.pushState(null, '', '#' + to); }
  catch (e) { try { location.hash = to; } catch (e2) { /* in-memory routing only */ } }
  setRoute(parseHash(to));
}
function replaceHash(to) { try { history.replaceState(null, '', '#' + to); } catch (e) { /* ignore */ } }
window.addEventListener('popstate', () => setRoute(parseHash(location.hash)));
window.addEventListener('hashchange', () => { const r = parseHash(location.hash); if (routeKey(r) !== routeKey(current)) setRoute(r); });
function useRoute() {
  const [r, setR] = useState(current);
  useEffect(() => { routeSubs.add(setR); return () => routeSubs.delete(setR); }, []);
  return r;
}
function Link({ to, children, ...rest }) {
  const onClick = e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); nav(to);
  };
  return html`<a href=${'#' + to} onClick=${onClick} ...${rest}>${children}</a>`;
}

// ---------------------------------------------------------------- icons
const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bag: '<path d="M5 8h14l-1.1 12H6.1L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  heart: '<path d="M12 19.5s-7-4.3-7-9.7A3.9 3.9 0 0 1 12 7.3a3.9 3.9 0 0 1 7 2.5c0 5.4-7 9.7-7 9.7Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  ruler: '<path d="M3.5 16 16 3.5 20.5 8 8 20.5z"/><path d="m7.5 12 2 2M10.5 9l2 2M13.5 6l2 2"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5h16"/><path d="M9.5 20v-5h5v5"/>',
  truck: '<path d="M3 6.5h11v9.5H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.8v4.6l3 2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
  pin: '<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
  box: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="m4 7.5 8 3.5 8-3.5M12 11v9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};
const Icon = (name, cls = '') => html`<svg class=${'ico ' + cls} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] }}></svg>`;

// ---------------------------------------------------------------- helpers
function bagLines(bag) {
  return bag.filter(validLine).map(l => { const { p, v } = VARIANT[l.vid]; return { ...l, p, v, price: v.price }; });
}
function totals(lines, method) {
  const sub = Math.round(lines.reduce((t, l) => t + l.price * l.qty, 0) * 100) / 100;
  const delivery = method === 'delivery' ? (sub >= PAY.freeOver ? 0 : PAY.fee) : 0;
  return { sub, delivery, total: Math.round((sub + delivery) * 100) / 100, count: lines.reduce((t, l) => t + l.qty, 0) };
}
function searchProducts(q) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w => (w.length > 3 ? w.replace(/(es|s)$/, '') : w));
  if (!words.length) return [];
  return PRODUCTS.map(p => {
    const hay = [p.name, CAT_BY[p.cat].label, p.brand, p.code, p.base, p.pitch, (TAGS[p.slug] || []).join(' '),
      ...p.variants.map(v => `${v.label} ${v.colour} ${LOGO_NAME[v.logo]}`)].join(' ').toLowerCase();
    let score = 0;
    for (const w of words) { if (!hay.includes(w)) return null; score += p.name.toLowerCase().includes(w) ? 3 : 1; }
    return { p, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).map(x => x.p);
}
function variantFor(p, q) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const hit = p.variants.findIndex(v => words.some(w => `${v.label} ${v.colour} ${LOGO_NAME[v.logo]}`.toLowerCase().includes(w)));
  return Math.max(0, hit);
}
function makeRef() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = '';
  const buf = new Uint32Array(6);
  try { crypto.getRandomValues(buf); } catch (e) { for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 1e9); }
  for (let i = 0; i < 6; i++) r += a[buf[i] % a.length];
  return 'TF-' + r;
}
function useOverlay(ref, onClose) {
  useEffect(() => {
    const prevFocus = document.activeElement;
    const el = ref.current;
    const focusables = () => [...el.querySelectorAll('button:not([disabled]),a[href],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    const first = el.querySelector('[data-autofocus]') || focusables()[0];
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); };
  }, []);
}

// size-chart maths: charts are inches; ranges look like "36/38"
const parseRange = s => { if (!s) return null; const m = s.split('/').map(Number); if (m.some(isNaN)) return null; return [m[0], m[m.length - 1]]; };
const isConvertible = label => !/ladies|uk size|size$/i.test(label);
function fmtMeasure(val, unit, label) {
  if (!val) return '–';
  if (!isConvertible(label) || unit === 'in') return val.replace('/', '–');
  const r = parseRange(val); if (!r) return val;
  const cm = x => Math.round(x * 2.54);
  return r[0] === r[1] ? String(cm(r[0])) : `${cm(r[0])}–${cm(r[1])}`;
}
function measureRow(chart) {
  if (!chart || chart.type === 'dims') return null;
  return chart.rows.find(r => /chest|waist/i.test(r[0]) && isConvertible(r[0])) || null;
}
function fitKey(chart, row) {
  if (!row) return null;
  if (chart.type === 'garment') return 'flatChest';
  return /waist/i.test(row[0]) ? 'waist' : 'chest';
}
function sizeIndexFor(row, x) {
  let best = -1, bestD = Infinity;
  row.slice(1).forEach((val, i) => {
    const r = parseRange(val); if (!r) return;
    const d = x < r[0] ? r[0] - x : x > r[1] ? x - r[1] : 0;
    if (d < bestD - 1e-9) { bestD = d; best = i; }
  });
  return best;
}
function suggestSize(p, fit) {
  const c = p.chart; const row = measureRow(c); const key = fitKey(c, row);
  if (!key || !fit || !fit[key]) return null;
  const i = sizeIndexFor(row, fit[key]);
  const sz = i >= 0 ? c.sizes[i] : null;
  return sz && p.sizes.includes(sz) ? sz : null;
}

// ---------------------------------------------------------------- shared pieces
function Tile({ v, view = 0, alt = '', hover = true, eager = !hover, cls = '', children }) {
  const main = v.images[view] || v.images[0];
  const second = hover && v.images.length > 1 ? v.images[view === 0 ? 1 : 0] : null;
  return html`<div class=${'tile ' + cls}>
    <img class=${second ? 'has-alt' : ''} src=${main.src} alt=${alt} width="600" height="600" loading=${eager ? 'eager' : 'lazy'} decoding="async" />
    ${second && html`<img class="alt" src=${second.src} alt="" width="600" height="600" loading="lazy" decoding="async" aria-hidden="true" />`}
    ${children}
  </div>`;
}
function Swatch({ v, on, onPick, size = 22 }) {
  const style = { '--g': v.hex || '#222', '--l': v.logoHex || 'transparent', width: size + 'px', height: size + 'px' };
  return html`<button type="button" class="sw-btn" title=${v.label} aria-label=${v.label} aria-pressed=${!!on}
    onClick=${onPick} onMouseEnter=${onPick} onFocus=${onPick}><span class=${'sw' + (on ? ' on' : '')} style=${style}></span></button>`;
}
function Mark({ color, width, cls = '', label }) {
  return html`<span class=${'mk ' + cls} style=${{ color, width }} role=${label ? 'img' : null} aria-label=${label || null} aria-hidden=${label ? null : 'true'}></span>`;
}
function SecHead({ eyebrow, title, id, children }) {
  return html`<div class="sec-hd"><div><p class="eyebrow">${eyebrow}</p><h2 class="h-lg" id=${id}>${title}</h2></div>${children}</div>`;
}
function Copy({ text, label }) {
  const [ok, setOk] = useState(false); const ref = useRef();
  const copy = () => {
    const done = () => { setOk(true); setTimeout(() => setOk(false), 1600); };
    const select = () => { try { const r = document.createRange(); r.selectNodeContents(ref.current); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* ignore */ } };
    try { navigator.clipboard.writeText(text).then(done, select); } catch (e) { select(); }
  };
  return html`<span class="copyable"><span ref=${ref}>${text}</span><button type="button" onClick=${copy} aria-label=${'Copy ' + (label || text)}>${ok ? 'Copied' : 'Copy'}</button></span>`;
}

// ---------------------------------------------------------------- product card
function ProductCard({ p, v: v0, eager = false }) {
  const s = useS();
  const startVi = Math.max(0, p.variants.indexOf(v0 || p.variants[0]));
  const [vi, setVi] = useState(startVi);
  useEffect(() => setVi(startVi), [startVi, p.slug]);
  const v = p.variants[vi] || p.variants[0];
  const on = s.saved.includes(p.slug);
  const to = 'p-' + p.slug + (vi ? '.v' + vi : '');
  const one = p.sizes.length === 1;
  const quickSizes = p.sizes.length <= 8 ? p.sizes : null;
  return html`<article class="card">
    <div class="card-media" style="position:relative">
      <${Link} to=${to} aria-label=${`${p.name}, ${v.label}, ${gbp(v.price)}`}>
        <${Tile} v=${v} alt=${`${p.name} in ${v.label}`} eager=${eager} />
      <//>
      <div class="card-tags">${(TAGS[p.slug] || []).map(t => html`<span class="tag">${t}</span>`)}</div>
      <button type="button" class=${'save-btn' + (on ? ' on' : '')} aria-pressed=${on} aria-label=${(on ? 'Remove ' : 'Save ') + p.name} onClick=${() => A.toggleSave(p.slug)}>${Icon('heart')}</button>
      <div class="quick" role="group" aria-label=${'Quick add ' + p.name}>
        ${one
          ? html`<button type="button" class="qs" style="padding:0 14px" onClick=${() => A.add(v.id, p.sizes[0])}>Add to bag</button>`
          : quickSizes
            ? quickSizes.map(sz => html`<button type="button" class="qs" aria-label=${`Add size ${sz} to bag`} onClick=${() => A.add(v.id, sz)}>${sz}</button>`)
            : html`<button type="button" class="qs" style="padding:0 14px" onClick=${() => A.ui({ quick: { slug: p.slug, vi } })}>Choose size</button>`}
      </div>
      <button type="button" class="quick-plus" aria-label=${'Quick add ' + p.name} onClick=${() => A.ui({ quick: { slug: p.slug, vi } })}>${Icon('plus')}</button>
    </div>
    <div class="card-info">
      <div class="card-row"><${Link} class="card-name" to=${to}>${p.name}<//><span class="card-price price">${gbp(v.price)}</span></div>
      <div class="card-sub">${v.label}${p.variants.length > 1 ? ` · ${plural(p.variants.length, 'option')}` : ''}</div>
      ${p.variants.length > 1 && html`<div class="swatches">${p.variants.map((x, i) => html`<${Swatch} v=${x} on=${i === vi} onPick=${() => setVi(i)} />`)}</div>`}
    </div>
  </article>`;
}

// ---------------------------------------------------------------- header, menus
function Header({ route }) {
  const s = useS();
  const count = s.bag.reduce((t, l) => t + l.qty, 0);
  const [mega, setMega] = useState(false);
  const closeT = useRef();
  useEffect(() => setMega(false), [routeKey(route)]);
  const open = () => { clearTimeout(closeT.current); setMega(true); };
  const close = () => { closeT.current = setTimeout(() => setMega(false), 140); };
  const is = n => route.name === n;
  return html`
    <div class="announce">Made to order for <b>The People's Gym</b> · Free collection in Plympton</div>
    <header class="hdr" onMouseLeave=${close}>
      <div class="wrap hdr-in">
        <button type="button" class="ibtn menu-btn" aria-label="Open menu" onClick=${() => A.ui({ menu: true })}>${Icon('menu')}</button>
        <${Link} class="brand" to="home" aria-label="Transform Fitness kit store, home">
          <span class="mk"></span><span class="wm"></span>
        <//>
        <nav class="nav" aria-label="Main">
          <button type="button" class=${is('shop') ? 'on' : ''} aria-expanded=${mega} aria-controls="mega" onMouseEnter=${open} onClick=${() => setMega(m => !m)}>Shop</button>
          <${Link} to="shop-tees" class=${route.cat === 'tees' ? 'on' : ''}>Tees<//>
          <${Link} to="shop-hoodies" class=${route.cat === 'hoodies' ? 'on' : ''}>Hoodies<//>
          <${Link} to="kit" class=${route.anchor === 'kit' ? 'on' : ''}>Race kit<//>
          <${Link} to="help" class=${is('help') ? 'on' : ''}>Help<//>
        </nav>
        <div class="hdr-tools">
          <button type="button" class="ibtn" aria-label="Search the store" onClick=${() => A.ui({ search: true })}>${Icon('search')}</button>
          <${Link} class="ibtn" to="saved" aria-label=${`Saved items (${s.saved.length})`}>${Icon('heart')}${s.saved.length > 0 && html`<span class="badge-count">${s.saved.length}</span>`}<//>
          <button type="button" class="ibtn" aria-label=${`Bag, ${plural(count, 'item')}`} onClick=${() => A.ui({ bag: true })}>
            ${Icon('bag')}${count > 0 && html`<span class=${'badge-count' + (s.bumps ? ' bump' : '')} key=${s.bumps}>${count}</span>`}
          </button>
        </div>
      </div>
      ${mega && html`<div class="mega" id="mega" onMouseEnter=${open}>
        <div class="wrap mega-in">
          <div><h4 class="label">Categories</h4><ul class="mega-list">
            ${CATS.slice(0, 5).map(c => html`<li><${Link} to=${'shop-' + c.slug}>${c.label}<span class="n">${PRODUCTS.filter(p => p.cat === c.slug).length}</span><//></li>`)}
          </ul></div>
          <div><h4 class="label" style="visibility:hidden">More</h4><ul class="mega-list">
            ${CATS.slice(5).map(c => html`<li><${Link} to=${'shop-' + c.slug}>${c.label}<span class="n">${PRODUCTS.filter(p => p.cat === c.slug).length}</span><//></li>`)}
            <li><${Link} to="shop"><b>All kit</b><span class="n">${PRODUCTS.length}</span><//></li>
          </ul></div>
          <div><h4 class="label">Start with</h4>
            <div class="mega-feat">${['back-mark-tee', 'classic-hoodie'].map(sl => { const p = BY_SLUG[sl]; return html`<${Link} class="mini" to=${'p-' + sl}><${Tile} v=${p.variants[0]} alt="" hover=${false} /><b>${p.name}</b><span class="muted">${gbp(minPrice(p))}</span><//>`; })}</div>
          </div>
        </div>
      </div>`}
    </header>`;
}

function MobileMenu() {
  const ref = useRef(); const s = useS();
  useOverlay(ref, () => A.ui({ menu: false }));
  return html`<div class="scrim" onClick=${() => A.ui({ menu: false })}></div>
  <aside class="drawer left" ref=${ref} role="dialog" aria-modal="true" aria-label="Menu">
    <div class="drawer-hd"><span class="brand"><span class="mk"></span><span class="wm"></span></span><button type="button" class="ibtn" aria-label="Close menu" onClick=${() => A.ui({ menu: false })}>${Icon('close')}</button></div>
    <div class="drawer-bd">
      <ul class="mega-list" style="margin-top:8px">
        <li><${Link} to="shop"><b>All kit</b><span class="n">${PRODUCTS.length}</span><//></li>
        ${CATS.map(c => html`<li><${Link} to=${'shop-' + c.slug}>${c.label}<span class="n">${PRODUCTS.filter(p => p.cat === c.slug).length}</span><//></li>`)}
      </ul>
      <ul class="mega-list" style="margin-top:28px">
        <li><${Link} to="kit">Build a race kit<//></li>
        <li><${Link} to="help">Help and sizing<//></li>
        <li><${Link} to="saved">Saved<span class="n">${s.saved.length}</span><//></li>
        <li><${Link} to="orders">Your orders<span class="n">${s.orders.length}</span><//></li>
      </ul>
      <div style="margin-top:28px;display:grid;gap:6px" class="small muted"><b style="color:var(--ink)">${GYM.name}</b><span>${GYM.address}</span><span>${GYM.phone}</span></div>
    </div>
  </aside>`;
}

// ---------------------------------------------------------------- home
function Hero() {
  return html`<section class="hero" aria-labelledby="hero-h">
    <div class="hero-media">${SITE.heroVideo
      ? html`<video src=${ASSET + SITE.heroVideo} poster=${ASSET + (SITE.heroImage || 'brand/hero.webp')} autoplay muted loop playsinline aria-label=${SITE.heroAlt || 'Training at Transform Fitness'}></video>`
      : html`<img src=${ASSET + (SITE.heroImage || 'brand/hero.webp')} alt=${SITE.heroAlt || 'Two members seen from behind in black Transform Fitness kit, the green triangle mark printed across their backs'} width="1534" height="600" fetchpriority="high" />`}</div>
    <div class="wrap hero-in">
      <div class="hero-copy">
        <p class="eyebrow">${SITE.heroEyebrow || `Official kit · ${GYM.name}`}</p>
        <h1 class="h-xl hero-h" id="hero-h">${SITE.heroTitle ? html`${SITE.heroTitle[0]} <em>${SITE.heroTitle[1]}</em>` : html`Wear the <em>mindset.</em>`}</h1>
        <p class="lede">${SITE.heroLede || 'Tees, hoodies, vests and bags carrying the Transform Fitness mark. Every piece is printed or embroidered to order, then collected free from the front desk in Plympton.'}</p>
        <div class="hero-cta">
          <${Link} class="btn btn-turf" to="shop">Shop the kit ${Icon('arrowR')}<//>
          <${Link} class="btn btn-line" to="kit">Build a race kit<//>
        </div>
        <div class="hero-facts"><span>${PRODUCTS.length} styles · ${COLOURWAYS} options</span><span>Sizes XXS to 6XL</span><span>Made to order</span></div>
      </div>
    </div>
  </section>`;
}
function Ticker() {
  const items = ["The People's Gym", 'Plympton, Plymouth', 'HYROX training club', 'Printed to order', 'Embroidered to order', 'Collect from the front desk'];
  const row = [...items, ...items];
  return html`<div class="ticker" aria-hidden="true"><div class="ticker-track">${row.map(t => html`<span>${t}</span>`)}</div></div>`;
}
function CategoryRail() {
  const ref = useRef();
  const scroll = d => ref.current && ref.current.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return html`<section class="sec wrap" aria-labelledby="cats-h">
    <${SecHead} eyebrow="Shop by category" title="Kit for every session" id="cats-h">
      <div class="rail-btns">
        <button type="button" class="btn btn-line btn-sm" aria-label="Scroll categories left" onClick=${() => scroll(-1)}>${Icon('arrowL', 'ico-sm')}</button>
        <button type="button" class="btn btn-line btn-sm" aria-label="Scroll categories right" onClick=${() => scroll(1)}>${Icon('arrowR', 'ico-sm')}</button>
      </div>
    <//>
    <div class="rail" ref=${ref}>
      ${CATS.map(c => {
        const p = BY_SLUG[CAT_COVER[c.slug]]; const n = PRODUCTS.filter(x => x.cat === c.slug).length;
        return html`<${Link} class="cat-tile" to=${'shop-' + c.slug}><${Tile} v=${p.variants[0]} alt="" hover=${false} /><div class="nm"><b>${c.label}</b><span>${plural(n, 'style')}</span></div><//>`;
      })}
    </div>
  </section>`;
}
function Featured() {
  return html`<section class="sec-tight wrap" aria-labelledby="feat-h" style="padding-top:0">
    <${SecHead} eyebrow="The core kit" title="Start with these" id="feat-h"><${Link} class="link" to="shop">Shop all ${PRODUCTS.length} styles ${Icon('arrowR', 'ico-sm')}<//><//>
    <div class="grid">${FEATURED.map((sl, i) => html`<${ProductCard} key=${sl} p=${BY_SLUG[sl]} eager=${i < 4} />`)}</div>
  </section>`;
}
function PrintTiles() {
  const tones = [
    { k: 'green', cls: 'dark', hex: '#35d24f' },
    { k: 'silver', cls: 'dark', hex: '#c9cdc8' },
    { k: 'black', cls: 'olive', hex: '#0c0d0c' },
  ];
  return html`<section class="sec wrap" aria-labelledby="print-h">
    <${SecHead} eyebrow="One mark, three colours" title="Pick your print" id="print-h">
      <p class="lede" style="max-width:40ch">The triangle mark comes in green, silver or black. Choose the colour first and see every piece that carries it.</p>
    <//>
    <div class="prints">
      ${tones.map(t => {
        const n = PRODUCTS.filter(p => p.variants.some(v => v.logo === t.k)).length;
        return html`<${Link} class=${'print-tile ' + t.cls} to=${'print-' + t.k} aria-label=${`${LOGO_NAME[t.k]} print, ${plural(n, 'style')}`}>
          <${Mark} color=${t.hex} />
          <div class="cap"><b>${LOGO_NAME[t.k]}</b><span>${plural(n, 'style')} ${'→'}</span></div>
        <//>`;
      })}
    </div>
  </section>`;
}

const KIT = [
  { key: 'top', label: 'Top', options: ['performance-vest', 'core-sports-bra', 'cotton-tank', 'cool-long-sleeve'] },
  { key: 'shorts', label: 'Shorts', options: ['training-shorts'] },
  { key: 'head', label: 'Head', options: ['air-mesh-cap', 'morf-neck-tube', null] },
];
function RaceKit() {
  const [sel, setSel] = useState(() => Object.fromEntries(KIT.map(k => [k.key, { slug: k.options[0], vi: 0, size: null }])));
  const [tried, setTried] = useState(false);
  const set = (key, patch) => setSel(s => ({ ...s, [key]: { ...s[key], ...patch } }));
  const items = KIT.map(k => ({ k, st: sel[k.key], p: sel[k.key].slug ? BY_SLUG[sel[k.key].slug] : null })).filter(x => x.p);
  const sizeOf = x => (x.p.sizes.length === 1 ? x.p.sizes[0] : x.st.size);
  const total = items.reduce((t, x) => t + x.p.variants[x.st.vi].price, 0);
  const missing = items.filter(x => !sizeOf(x));
  const add = () => {
    if (missing.length) { setTried(true); return; }
    A.addMany(items.map(x => ({ vid: x.p.variants[x.st.vi].id, size: sizeOf(x) })));
    setTried(false);
  };
  return html`<section class="band rubber sec" id="kit" aria-labelledby="kit-h">
    <div class="wrap kit">
      <div class="kit-intro">
        <p class="eyebrow">Race-day kit</p>
        <h2 class="h-lg" id="kit-h">Built for 8 × 1 km and 8 stations</h2>
        <p class="lede">Transform Fitness is Plymouth's official HYROX training club. Put a race kit together in one go: a top, shorts and something for your head.</p>
        <div class="kit-total">
          ${items.map(x => html`<div class="row small"><span>${x.p.name} · ${x.p.variants[x.st.vi].label}${sizeOf(x) ? ` · ${sizeOf(x)}` : ''}</span><span class="price">${gbp(x.p.variants[x.st.vi].price)}</span></div>`)}
          <div class="row" style="border-top:1px solid var(--band-line);padding-top:12px"><span class="label">Kit total</span><span class="big price">${gbp(total)}</span></div>
          <p class="kit-note" aria-live="polite">${tried && missing.length ? `Choose a size for: ${missing.map(x => x.k.label.toLowerCase()).join(', ')}.` : `${plural(items.length, 'piece')}, each made to order.`}</p>
          <button type="button" class="btn btn-turf btn-block" onClick=${add}>${Icon('bag')} Add race kit to bag</button>
        </div>
      </div>
      <div class="kit-slots">
        ${KIT.map(k => {
          const st = sel[k.key]; const p = st.slug ? BY_SLUG[st.slug] : null; const v = p && p.variants[st.vi];
          const needSize = tried && p && p.sizes.length > 1 && !st.size;
          return html`<div class="slot">
            ${p ? html`<${Tile} v=${v} alt=${`${p.name} in ${v.label}`} hover=${false} />`
                : html`<div class="tile" style="display:grid;place-items:center"><span class="small" style="color:var(--ink-3)">No headwear</span></div>`}
            <div class="slot-bd">
              <p class="eyebrow">${k.label}</p>
              ${k.options.length > 1 && html`<div class="slot-tabs" role="group" aria-label=${'Choose ' + k.label.toLowerCase()}>
                ${k.options.map(o => html`<button type="button" class=${'chip' + (st.slug === o ? ' on' : '')} aria-pressed=${st.slug === o} onClick=${() => set(k.key, { slug: o, vi: 0, size: null })}>${o ? BY_SLUG[o].name : 'None'}</button>`)}
              </div>`}
              ${p && html`<div style="display:grid;gap:10px">
                <div class="card-row"><b>${p.name}</b><span class="price">${gbp(v.price)}</span></div>
                ${p.variants.length > 1 && html`<div><div class="small" style="color:var(--band-ink-2);margin-bottom:6px">${v.label}</div><div class="swatches" style="margin:0">
                  ${p.variants.map((x, i) => html`<${Swatch} v=${x} on=${i === st.vi} onPick=${() => set(k.key, { vi: i })} />`)}</div></div>`}
                ${p.sizes.length > 1
                  ? html`<div class="slot-tabs" role="group" aria-label=${'Size for ' + p.name}>${p.sizes.map(sz => html`<button type="button" class=${'chip' + (st.size === sz ? ' on' : '')} aria-pressed=${st.size === sz} onClick=${() => set(k.key, { size: sz })}>${sz}</button>`)}</div>`
                  : html`<span class="small" style="color:var(--band-ink-2)">One size</span>`}
                ${needSize && html`<span class="small" style="color:#FF9C8C">Choose a size</span>`}
              </div>`}
            </div>
          </div>`;
        })}
      </div>
    </div>
  </section>`;
}
function Steps() {
  return html`<section class="sec wrap" aria-labelledby="how-h">
    <${SecHead} eyebrow="How it works" title="Made for you, not for a shelf" id="how-h" />
    <div class="steps">
      <div class="step"><span class="n">01</span><h3 class="h-sm">Order online</h3><p class="muted">Pick a colourway and size. Collection from the gym is free, or choose UK delivery.</p></div>
      <div class="step"><span class="n">02</span><h3 class="h-sm">We print or embroider it</h3><p class="muted">Each piece is decorated to order for you. Production takes 10 to 15 days.</p></div>
      <div class="step"><span class="n">03</span><h3 class="h-sm">Collect at the front desk</h3><p class="muted">Pick it up at ${GYM.address.split(',').slice(0, 2).join(',')}, or have it posted to you.</p></div>
    </div>
  </section>`;
}
function About() {
  return html`<section class="band sec" aria-labelledby="about-h">
    <div class="wrap about">
      <div style="display:grid;gap:20px">
        <p class="eyebrow">${GYM.tagline}</p>
        <h2 class="h-lg" id="about-h">The mark from the gym wall</h2>
        <p class="lede">Transform Fitness is an independent gym in Plympton, Plymouth. The kit carries the same triangle you train under, and every order supports the gym.</p>
        <div class="facts">
          <div><b>PL7</b><span>Plympton, Plymouth</span></div>
          <div><b>HYROX</b><span>Official training club</span></div>
          <div><b>10–15</b><span>Days to print or embroider</span></div>
        </div>
      </div>
      <div class="about-fig"><${Mark} label="Transform Fitness triangle mark" /></div>
    </div>
  </section>`;
}
function RecentRow({ exclude, title = 'Recently viewed' }) {
  const s = useS();
  const list = s.recent.filter(sl => sl !== exclude).slice(0, 4);
  if (!list.length) return null;
  return html`<section class="sec-tight wrap"><${SecHead} eyebrow="Pick up where you left off" title=${title} />
    <div class="grid">${list.map(sl => html`<${ProductCard} key=${sl} p=${BY_SLUG[sl]} />`)}</div></section>`;
}
// Real photos from the gym (only when a variant page supplies them).
function Gallery() {
  const g = SITE.gallery;
  if (!g || !g.photos || !g.photos.length) return null;
  return html`<section class="sec wrap gallery" aria-labelledby="gal-h">
    <${SecHead} eyebrow=${g.eyebrow || 'From the floor'} title=${g.title || 'The People\u2019s Gym'} id="gal-h">${g.lede && html`<p class="lede" style="max-width:44ch">${g.lede}</p>`}<//>
    <div class="gallery-grid">${g.photos.map((ph, i) => html`<figure class=${'gal-item' + (ph.span ? ' span-' + ph.span : '')} key=${i}>
      <img src=${ASSET + ph.src} alt=${ph.alt || ''} loading="lazy" decoding="async" />
      ${ph.caption && html`<figcaption>${ph.caption}</figcaption>`}
    </figure>`)}</div>
  </section>`;
}
function Home() {
  return html`<${Hero} />${!SITE.noTicker && html`<${Ticker} />`}<${CategoryRail} /><${Featured} />${SITE.galleryFirst && html`<${Gallery} />`}<${RaceKit} /><${PrintTiles} />${!SITE.galleryFirst && html`<${Gallery} />`}<${About} /><${Steps} /><${RecentRow} />`;
}

// ---------------------------------------------------------------- footer
function Footer() {
  const s = useS();
  return html`<footer class="band rubber foot">
    <div class="wrap">
      <div class="foot-cols">
        <div style="display:grid;gap:16px;align-content:start">
          <span class="brand"><span class="mk" style="width:44px;color:var(--turf)"></span><span class="wm" style="width:190px;color:var(--band-ink)"></span></span>
          <p style="color:var(--band-ink-2);max-width:34ch">Official kit of ${GYM.name}, ${GYM.tagline}. Printed and embroidered to order.</p>
          ${!s.pay.stripe && html`<span class="preview-flag">${s.pay.checked ? 'Card payments offline' : 'Checking payments'}</span>`}
        </div>
        <div><h4>Shop</h4><ul>${CATS.map(c => html`<li><${Link} to=${'shop-' + c.slug}>${c.label}<//></li>`)}</ul></div>
        <div><h4>Help</h4><ul>
          <li><${Link} to="help-made">How made to order works<//></li>
          <li><${Link} to="help-sizing">Size guides<//></li>
          <li><${Link} to="help-collect">Collection and delivery<//></li>
          <li><${Link} to="orders">Your orders<//></li>
          <li><${Link} to="saved">Saved<//></li>
          <li><a href=${GYM.legacyStore} target="_blank" rel="noopener">Current store ${Icon('ext', 'ico-sm')}</a></li>
        </ul></div>
        <div><h4>Visit</h4>
          <address class="addr">
            <span>9B Meadow Close<br />Plympton, Plymouth<br />PL7 5EX</span>
            <${Copy} text=${GYM.phone} label="phone number" />
            <${Copy} text=${GYM.email} label="email address" />
            <span style="color:var(--band-ink-2)">${GYM.instagram}</span>
          </address>
        </div>
      </div>
      <div class="giant" aria-hidden="true">Transform</div>
    </div>
    <div class="wrap foot-base"><span>© 2026 ${GYM.name}</span><span>Products, prices and garment specs from the current Transform Fitness store</span></div>
  </footer>`;
}

// ---------------------------------------------------------------- shop
function baseList(f) {
  let list = PRODUCTS.filter(p => !f.cat || p.cat === f.cat);
  if (f.q) { const hits = new Set(searchProducts(f.q)); list = list.filter(p => hits.has(p)); }
  return list;
}
function matchVariant(v, f) {
  if (f.print.length && !f.print.includes(v.logo)) return false;
  if (f.colour.length && !f.colour.includes(colourGroup(v))) return false;
  if (f.max != null && v.price > f.max) return false;
  return true;
}
function applyFilters(f) {
  let list = baseList(f);
  if (f.size.length) list = list.filter(p => p.sizes.map(normSize).some(sz => f.size.includes(sz)));
  const out = list.map(p => ({ p, v: p.variants.find(v => matchVariant(v, f)) })).filter(x => x.v);
  const feat = sl => { const i = FEATURED.indexOf(sl); return i < 0 ? 100 + PRODUCTS.findIndex(p => p.slug === sl) : i; };
  const by = {
    featured: (a, b) => feat(a.p.slug) - feat(b.p.slug),
    low: (a, b) => a.v.price - b.v.price,
    high: (a, b) => b.v.price - a.v.price,
    name: (a, b) => a.p.name.localeCompare(b.p.name),
  }[f.sort];
  return out.sort(by);
}
function Filters({ f, setF }) {
  const base = baseList(f);
  const toggle = (k, val) => setF(x => ({ ...x, [k]: x[k].includes(val) ? x[k].filter(y => y !== val) : [...x[k], val] }));
  const prints = ['green', 'silver', 'black', 'none'].map(k => ({ k, n: base.filter(p => p.variants.some(v => v.logo === k)).length })).filter(x => x.n);
  const colours = COLOUR_GROUPS.map(k => ({ k, n: base.filter(p => p.variants.some(v => colourGroup(v) === k)).length })).filter(x => x.n);
  const sizes = SIZE_ORDER.filter(sz => base.some(p => p.sizes.map(normSize).includes(sz)));
  const maxVal = f.max == null ? 50 : f.max;
  const Opt = ({ k, label, dot, n, group }) => html`<label class="fopt">
    <input type="checkbox" checked=${f[group].includes(k)} onChange=${() => toggle(group, k)} />
    <span class="box">${Icon('check')}</span>
    ${dot && html`<span class="dot" style=${{ background: dot }}></span>`}
    <span>${label}</span><span class="ct">${n}</span>
  </label>`;
  return html`<div class="sheet-filters">
    <div class="fgroup"><h4 class="label">Print colour</h4><div class="fopts">
      ${prints.map(x => html`<${Opt} group="print" k=${x.k} n=${x.n} label=${LOGO_NAME[x.k]} dot=${x.k === 'none' ? 'transparent' : { green: '#35d24f', silver: '#c9cdc8', black: '#0c0d0c' }[x.k]} />`)}
    </div></div>
    <div class="fgroup"><h4 class="label">Garment colour</h4><div class="fopts">
      ${colours.map(x => html`<${Opt} group="colour" k=${x.k} n=${x.n} label=${x.k} dot=${COLOUR_DOT[x.k]} />`)}
    </div></div>
    ${sizes.length > 1 && html`<div class="fgroup"><h4 class="label">Size</h4><div class="size-grid">
      ${sizes.map(sz => html`<label style=${sz === 'One size' ? 'grid-column:span 2' : ''}><input type="checkbox" checked=${f.size.includes(sz)} onChange=${() => toggle('size', sz)} /><span>${sz}</span></label>`)}
    </div></div>`}
    <div class="fgroup"><h4 class="label">Price <span class="mono small muted" style="text-transform:none;letter-spacing:0;font-weight:400">${f.max == null ? 'Any' : 'Up to ' + gbp(f.max)}</span></h4>
      <input class="range" type="range" min="5" max="50" step="1" value=${maxVal} aria-label="Maximum price"
        onInput=${e => { const n = +e.target.value; setF(x => ({ ...x, max: n >= 50 ? null : n })); }} />
      <div class="card-row mono small muted"><span>£5</span><span>£50</span></div>
    </div>
  </div>`;
}
function Shop({ route }) {
  const s = useS();
  const [f, setF] = useState(() => ({ cat: route.cat || null, print: route.print ? [route.print] : [], colour: [], size: [], max: null, sort: 'featured', q: s.ui.query || '' }));
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setF(x => ({ ...x, cat: route.cat || null, print: route.print ? [route.print] : route.cat ? x.print : [] })); }, [route.cat, route.print]);
  useEffect(() => { if (s.ui.query) { setF(x => ({ ...x, q: s.ui.query })); A.ui({ query: '' }); } }, [s.ui.query]);
  const results = useMemo(() => applyFilters(f), [f]);
  const cat = f.cat && CAT_BY[f.cat];
  const title = cat ? cat.label : f.print.length === 1 && !f.cat ? `${LOGO_NAME[f.print[0]]} print` : f.q ? `“${f.q}”` : 'All kit';
  const blurb = cat ? cat.blurb : f.q ? `Search results across the store.` : `Every style in the store, each made to order.`;
  const activePills = [
    ...f.print.map(k => ({ label: `${LOGO_NAME[k]} print`, clear: () => setF(x => ({ ...x, print: x.print.filter(y => y !== k) })) })),
    ...f.colour.map(k => ({ label: k, clear: () => setF(x => ({ ...x, colour: x.colour.filter(y => y !== k) })) })),
    ...f.size.map(k => ({ label: `Size ${k}`, clear: () => setF(x => ({ ...x, size: x.size.filter(y => y !== k) })) })),
    ...(f.max != null ? [{ label: `Up to ${gbp(f.max)}`, clear: () => setF(x => ({ ...x, max: null })) }] : []),
    ...(f.q ? [{ label: `Search: ${f.q}`, clear: () => setF(x => ({ ...x, q: '' })) }] : []),
  ];
  const clearAll = () => setF(x => ({ ...x, print: [], colour: [], size: [], max: null, q: '' }));
  const sheetRef = useRef();
  return html`<div class="wrap">
    <div class="plp-hd">
      <nav class="crumbs" aria-label="Breadcrumb"><${Link} to="home">Home<//><span>/</span><${Link} to="shop">Shop<//>${cat && html`<span>/</span><span>${cat.label}</span>`}</nav>
      <div class="row">
        <div style="display:grid;gap:10px"><h1 class="h-lg">${title}</h1><p class="muted">${blurb}</p></div>
      </div>
      <div class="cat-chips" role="group" aria-label="Categories">
        <${Link} class=${'chip' + (!f.cat ? ' on' : '')} to="shop">All<//>
        ${CATS.map(c => html`<${Link} class=${'chip' + (f.cat === c.slug ? ' on' : '')} to=${'shop-' + c.slug}>${c.label}<//>`)}
      </div>
    </div>
    <div class="plp">
      <aside class="filters" aria-label="Filters"><${Filters} f=${f} setF=${setF} /></aside>
      <div>
        <div class="toolbar">
          <div class="active-f">
            <span class="mono small muted" aria-live="polite">${plural(results.length, 'style')}</span>
            ${activePills.map(x => html`<span class="pill">${x.label}<button type="button" aria-label=${'Remove ' + x.label} onClick=${x.clear}>${Icon('close')}</button></span>`)}
            ${activePills.length > 1 && html`<button type="button" class="rm" onClick=${clearAll}>Clear all</button>`}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label class="search-inline">${Icon('search')}<span class="sr">Search within results</span>
              <input id="plp-q" type="search" placeholder="Search kit" value=${f.q} onInput=${e => { const q = e.target.value; setF(x => ({ ...x, q })); }} /></label>
            <label><span class="sr">Sort by</span><select id="plp-sort" class="select" value=${f.sort} onChange=${e => { const sort = e.target.value; setF(x => ({ ...x, sort })); }}>
              <option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="name">Name A–Z</option>
            </select></label>
            <button type="button" class="btn btn-line btn-sm filter-btn" onClick=${() => setSheet(true)}>${Icon('filter', 'ico-sm')} Filter${activePills.length ? ` (${activePills.length})` : ''}</button>
          </div>
        </div>
        ${results.length
          ? html`<div class="grid g3">${results.map((x, i) => html`<${ProductCard} key=${x.p.slug} p=${x.p} v=${x.v} eager=${i < 6} />`)}</div>`
          : html`<div class="empty"><h2 class="h-md">Nothing matches those filters</h2><p class="muted">Try removing a filter or searching for something broader, like “tee” or “black”.</p><button type="button" class="btn btn-ink" onClick=${clearAll}>Clear filters</button></div>`}
      </div>
    </div>
    ${sheet && html`<${FilterSheet} f=${f} setF=${setF} count=${results.length} onClose=${() => setSheet(false)} />`}
  </div>`;
}
function FilterSheet({ f, setF, count, onClose }) {
  const ref = useRef();
  useOverlay(ref, onClose);
  return html`<div class="scrim" onClick=${onClose}></div>
  <div class="modal" ref=${ref} role="dialog" aria-modal="true" aria-label="Filters">
    <div class="drawer-hd"><h2 class="h-sm">Filter</h2><button type="button" class="ibtn" aria-label="Close filters" onClick=${onClose}>${Icon('close')}</button></div>
    <div class="drawer-bd" style="padding-top:18px"><${Filters} f=${f} setF=${setF} /></div>
    <div class="drawer-ft"><button type="button" class="btn btn-ink btn-block" onClick=${onClose}>Show ${plural(count, 'style')}</button></div>
  </div>`;
}

// ---------------------------------------------------------------- product page
function SizeTable({ p, unit, hit }) {
  const c = p.chart; if (!c) return null;
  if (c.type === 'dims') return html`<dl class="spec">${c.rows.map(r => html`<dt>${r[0]}</dt><dd>${r[1]}</dd>`)}</dl>`;
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th scope="col" style="text-align:left">Size</th>${c.sizes.map((sz, i) => html`<th scope="col" class=${hit === i ? 'hit' : ''}>${sz}</th>`)}</tr></thead>
    <tbody>${c.rows.map(r => html`<tr><th scope="row">${r[0]}${isConvertible(r[0]) ? html` <span class="mono small">(${unit})</span>` : ''}</th>${r.slice(1).map((val, i) => html`<td class=${hit === i ? 'hit' : ''}>${fmtMeasure(val, unit, r[0])}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}
function FitFinder({ p, unit }) {
  const s = useS();
  const c = p.chart; const row = measureRow(c); const key = fitKey(c, row);
  const stored = s.fit[key];
  const toUnit = x => (unit === 'cm' ? Math.round(x * 2.54) : Math.round(x * 10) / 10);
  const [val, setVal] = useState(stored ? String(toUnit(stored)) : '');
  useEffect(() => { setVal(stored ? String(toUnit(stored)) : ''); }, [unit]);
  if (!row) return null;
  const n = parseFloat(val);
  const inches = isNaN(n) ? null : unit === 'cm' ? n / 2.54 : n;
  const valid = inches && inches > 10 && inches < 80;
  const idx = valid ? sizeIndexFor(row, inches) : -1;
  const what = key === 'flatChest' ? 'Flat chest, armpit to armpit' : key === 'waist' ? 'Your waist' : 'Your chest';
  const how = key === 'flatChest'
    ? 'Lay a hoodie that fits you well on a flat surface and measure straight across, armpit to armpit. This chart gives garment measurements, not body sizes.'
    : key === 'waist' ? 'Measure around your natural waist, keeping the tape level and snug.' : 'Measure around the fullest part of your chest, under your arms, keeping the tape level.';
  return html`<div class="finder">
    <p class="label">Fit finder</p>
    <p class="small muted">${how}</p>
    <div class="finder-row">
      <label class="sr" for="fit-in">${what} in ${unit}</label>
      <input id="fit-in" inputmode="decimal" placeholder=${unit === 'cm' ? 'e.g. 102' : 'e.g. 40'} value=${val}
        onInput=${e => { setVal(e.target.value); const m = parseFloat(e.target.value); const i = isNaN(m) ? null : unit === 'cm' ? m / 2.54 : m; if (i && i > 10 && i < 80) A.setFit({ [key]: Math.round(i * 10) / 10 }); }} />
      <span class="mono small muted">${unit}</span>
      <span class="res" aria-live="polite">${idx >= 0 ? html`We suggest <b>${c.sizes[idx]}</b>` : val ? 'Enter a measurement between 25 and 75 in' : ''}</span>
    </div>
    <p class="small muted">We keep this measurement in your browser so product pages can point out your size.</p>
  </div>`;
}
function SizeGuide({ slug }) {
  const p = BY_SLUG[slug]; const ref = useRef(); const s = useS();
  const [unit, setUnit] = useState(() => LS.get('tf.unit', 'in'));
  useOverlay(ref, () => A.ui({ guide: null }));
  const pick = u => { setUnit(u); LS.set('tf.unit', u); };
  const row = measureRow(p.chart); const key = fitKey(p.chart, row);
  const hit = row && key && s.fit[key] ? sizeIndexFor(row, s.fit[key]) : -1;
  return html`<div class="scrim" onClick=${() => A.ui({ guide: null })}></div>
  <div class="modal" ref=${ref} role="dialog" aria-modal="true" aria-labelledby="sg-h">
    <div class="drawer-hd"><div><p class="eyebrow">Size guide</p><h2 class="h-md" id="sg-h">${p.name}</h2></div><button type="button" class="ibtn" aria-label="Close size guide" onClick=${() => A.ui({ guide: null })}>${Icon('close')}</button></div>
    <div class="drawer-bd sg" style="padding-top:20px">
      ${p.chart && p.chart.type !== 'dims' && html`<div class="card-row" style="align-items:center"><span class="small muted">${p.chart.type === 'fit' ? 'Body measurements the garment is cut to fit.' : 'Garment measurements, laid flat.'}</span>
        <div class="seg" role="group" aria-label="Units"><button type="button" class=${unit === 'in' ? 'on' : ''} aria-pressed=${unit === 'in'} onClick=${() => pick('in')}>Inches</button><button type="button" class=${unit === 'cm' ? 'on' : ''} aria-pressed=${unit === 'cm'} onClick=${() => pick('cm')}>cm</button></div></div>`}
      <${SizeTable} p=${p} unit=${unit} hit=${hit} />
      ${p.chart && p.chart.type !== 'dims' && html`<${FitFinder} p=${p} unit=${unit} />`}
      <p class="small muted">Measurements from the garment maker: ${p.base}, ${p.brand} ${p.code}.</p>
    </div>
  </div>`;
}
function ProductPage({ route }) {
  const p = BY_SLUG[route.slug];
  const s = useS();
  const initVi = p.variants[route.vi] ? route.vi : 0;
  const [vi, setVi] = useState(initVi);
  const [view, setView] = useState(0);
  const [size, setSize] = useState(p.sizes.length === 1 ? p.sizes[0] : null);
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState(false);
  const [added, setAdded] = useState(false);
  const [shake, setShake] = useState(0);
  const sizesRef = useRef(); const trackRef = useRef();
  useEffect(() => {
    A.viewed(p.slug); setVi(initVi); setView(0); setSize(p.sizes.length === 1 ? p.sizes[0] : null); setQty(1); setErr(false);
  }, [p.slug]);
  const v = p.variants[vi] || p.variants[0];
  const pickVariant = i => { setVi(i); setView(0); if (trackRef.current) trackRef.current.scrollTo({ left: 0 }); replaceHash('p-' + p.slug + (i ? '.v' + i : '')); };
  const suggested = suggestSize(p, s.fit);
  const saved = s.saved.includes(p.slug);
  const kind = optionKind(p);
  const add = () => {
    if (!size) {
      setErr(true); setShake(n => n + 1);
      if (sizesRef.current) sizesRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    A.add(v.id, size, qty); setAdded(true); setTimeout(() => setAdded(false), 1800);
  };
  const onTrack = e => { const el = e.currentTarget; setView(Math.round(el.scrollLeft / el.clientWidth)); };
  const others = FEATURED.concat(PRODUCTS.map(x => x.slug)).filter((sl, i, a) => a.indexOf(sl) === i && BY_SLUG[sl].cat !== p.cat).slice(0, 4);
  const hasGuide = p.chart && p.chart.type !== 'dims';
  return html`<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb" style="padding-top:22px"><${Link} to="home">Home<//><span>/</span><${Link} to=${'shop-' + p.cat}>${CAT_BY[p.cat].label}<//><span>/</span><span>${p.name}</span></nav>
    <div class="pdp">
      <div>
        <div class="gallery">
          <div class="thumbs" role="group" aria-label="Views">
            ${v.images.map((im, i) => html`<button type="button" class=${i === view ? 'on' : ''} aria-label=${im.view + ' view'} aria-pressed=${i === view} onClick=${() => setView(i)}>
              <div class="tile"><img src=${im.src} alt="" width="600" height="600" /></div></button>`)}
          </div>
          <${Tile} v=${v} view=${view} hover=${false} eager=${true} cls="main-img" alt=${`${p.name} in ${v.label}, ${v.images[view].view.toLowerCase()} view`}>
            <span class="view-lbl">${v.images[view].view}</span>
          <//>
        </div>
        <div class="carousel">
          <div class="car-track" ref=${trackRef} onScroll=${onTrack}>
            ${v.images.map((im, i) => html`<div class="tile"><img src=${im.src} alt=${`${p.name} in ${v.label}, ${im.view.toLowerCase()} view`} width="600" height="600" loading=${i ? 'lazy' : 'eager'} /></div>`)}
          </div>
          ${v.images.length > 1 && html`<div class="car-dots" aria-hidden="true">${v.images.map((_, i) => html`<span class=${i === view ? 'on' : ''}></span>`)}</div>`}
        </div>
      </div>

      <div class="buy">
        <div class="buy-hd">
          <div class="buy-meta"><span>${CAT_BY[p.cat].label}</span><span>·</span><span>${p.brand} ${p.code}</span></div>
          <h1 class="buy-title">${p.name}</h1>
          <div class="card-row" style="justify-content:flex-start;gap:14px;align-items:center"><span class="buy-price price">${gbp(v.price)}</span>${(TAGS[p.slug] || []).map(t => html`<span class="tag" style="border:1px solid var(--line-2)">${t}</span>`)}</div>
          <p class="muted" style="max-width:52ch">${p.pitch}</p>
        </div>

        ${p.variants.length > 1 && html`<div>
          <div class="opt-hd"><span class="label">${kind}<span class="val">${v.label}</span></span></div>
          <div class="variants" role="radiogroup" aria-label=${kind}>
            ${p.variants.map((x, i) => html`<button type="button" role="radio" aria-checked=${i === vi} class=${'vbtn' + (i === vi ? ' on' : '')} onClick=${() => pickVariant(i)}>
              <div class="tile"><img src=${x.images[0].src} alt="" width="600" height="600" /></div><span class="vl">${x.label}</span></button>`)}
          </div>
        </div>`}

        <div ref=${sizesRef} key=${shake} class=${err && !size ? 'shake' : ''}>
          <div class="opt-hd"><span class="label">Size${size ? html`<span class="val">${size}</span>` : ''}</span>
            ${hasGuide && html`<button type="button" class="link" onClick=${() => A.ui({ guide: p.slug })}>${Icon('ruler', 'ico-sm')} Size guide</button>`}</div>
          <div class="sizes" role="radiogroup" aria-label="Size">
            ${p.sizes.map(sz => html`<button type="button" role="radio" aria-checked=${size === sz} class=${'sbtn' + (size === sz ? ' on' : '') + (p.sizes.length === 1 ? ' one' : '')} onClick=${() => { setSize(sz); setErr(false); }}>
              ${sz}${suggested === sz && html`<span class="fit">Your fit</span>`}</button>`)}
          </div>
          ${err && !size ? html`<p class="size-err" role="alert" style="margin-top:10px">Choose a size to add this to your bag.</p>`
            : hasGuide && html`<p class="small muted" style="margin-top:10px">${suggested ? html`Your saved measurement points to <b style="color:var(--ink)">${suggested}</b>.` : html`Not sure? The <button type="button" class="rm" onClick=${() => A.ui({ guide: p.slug })}>fit finder</button> suggests a size from one measurement.`}</p>`}
        </div>

        <div class="buy-row">
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" aria-label="Decrease quantity" disabled=${qty <= 1} onClick=${() => setQty(q => Math.max(1, q - 1))}>${Icon('minus', 'ico-sm')}</button>
            <output aria-live="polite">${qty}</output>
            <button type="button" aria-label="Increase quantity" disabled=${qty >= 10} onClick=${() => setQty(q => Math.min(10, q + 1))}>${Icon('plus', 'ico-sm')}</button>
          </div>
          <button type="button" class="btn btn-turf" onClick=${add}>${added ? html`${Icon('check')} Added` : html`Add to bag<span class="btn-price"> · ${gbp(v.price * qty)}</span>`}</button>
          <button type="button" class=${'btn btn-line save' + (saved ? ' on' : '')} aria-pressed=${saved} aria-label=${saved ? 'Remove from saved' : 'Save for later'} onClick=${() => A.toggleSave(p.slug)}>${Icon('heart')}</button>
        </div>

        <div class="assure">
          <div>${Icon('clock')}<span><b>Made to order.</b> Printed or embroidered for you, usually ready in 2 to 3 weeks.</span></div>
          <div>${Icon('store')}<span><b>Free collection</b> from the front desk at 9B Meadow Close, Plympton.</span></div>
          <div>${Icon('truck')}<span><b>UK delivery ${gbp(DELIVERY_FEE)}</b>, free on orders over ${gbp(FREE_DELIVERY_OVER)}.</span></div>
          ${s.pay.stripe && html`<div>${Icon('lock')}<span><b>Pay by card, Apple Pay or Google Pay.</b> Secure checkout by Stripe.</span></div>`}
        </div>

        <div class="acc">
          <details open><summary>Details ${Icon('plus', 'ico-sm')}</summary><div class="acc-bd">
            <ul class="bullets">${p.features.map(t => html`<li>${t}</li>`)}</ul>
            <dl class="spec" style="margin-top:8px"><dt>Garment</dt><dd>${p.base}</dd><dt>Maker</dt><dd>${p.brand}</dd><dt>Code</dt><dd class="mono">${p.code}</dd><dt>Colour</dt><dd>${v.colour}</dd></dl>
          </div></details>
          <details><summary>Print ${Icon('plus', 'ico-sm')}</summary><div class="acc-bd">
            <ul class="bullets">${p.prints.map(t => html`<li>${t}</li>`)}</ul>
            <p>Mark colour on this option: <b style="color:var(--ink)">${LOGO_NAME[v.logo]}</b>.</p>
          </div></details>
          ${p.chart && html`<details><summary>${p.chart.type === 'dims' ? 'Dimensions' : 'Size chart'} ${Icon('plus', 'ico-sm')}</summary><div class="acc-bd">
            <${SizeTable} p=${p} unit="in" hit=${-1} />
            ${hasGuide && html`<button type="button" class="link" style="justify-self:start" onClick=${() => A.ui({ guide: p.slug })}>Open fit finder</button>`}
          </div></details>`}
          <details><summary>Collection and delivery ${Icon('plus', 'ico-sm')}</summary><div class="acc-bd">
            <p>Everything is made to order, so allow 10 to 15 days for printing or embroidery before it's ready.</p>
            <p>Collect free from the front desk at ${GYM.address}, or choose UK delivery at checkout.</p>
          </div></details>
        </div>
      </div>
    </div>
    <section class="sec-tight" style="padding-top:0"><${SecHead} eyebrow="Complete the kit" title="Goes with this" />
      <div class="grid">${others.map(sl => html`<${ProductCard} key=${sl} p=${BY_SLUG[sl]} />`)}</div>
    </section>
    <${RecentRow} exclude=${p.slug} />
    <div class="sticky-buy">
      <div style="display:grid;gap:2px"><b class="price">${gbp(v.price * qty)}</b><span class="small muted">${size ? `Size ${size}` : 'Choose a size'}</span></div>
      <button type="button" class="btn btn-turf" onClick=${add}>${added ? 'Added' : 'Add to bag'}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- quick add
function QuickAdd({ slug, vi: vi0 }) {
  const p = BY_SLUG[slug]; const ref = useRef();
  const [vi, setVi] = useState(vi0 || 0);
  const [size, setSize] = useState(p.sizes.length === 1 ? p.sizes[0] : null);
  const [err, setErr] = useState(false);
  const close = () => A.ui({ quick: null });
  useOverlay(ref, close);
  const v = p.variants[vi];
  const add = () => { if (!size) { setErr(true); return; } A.add(v.id, size); close(); };
  return html`<div class="scrim" onClick=${close}></div>
  <div class="modal" ref=${ref} role="dialog" aria-modal="true" aria-labelledby="qa-h" style="width:min(560px,calc(100% - 32px))">
    <div class="drawer-hd"><h2 class="h-sm" id="qa-h">${p.name}</h2><button type="button" class="ibtn" aria-label="Close" onClick=${close}>${Icon('close')}</button></div>
    <div class="drawer-bd" style="padding-top:18px;display:grid;gap:18px">
      <div style="display:grid;grid-template-columns:120px 1fr;gap:16px;align-items:center">
        <${Tile} v=${v} alt=${`${p.name} in ${v.label}`} hover=${false} cls="" />
        <div style="display:grid;gap:6px"><b class="price" style="font-size:20px">${gbp(v.price)}</b><span class="muted small">${v.label}</span>
          ${p.variants.length > 1 && html`<div class="swatches">${p.variants.map((x, i) => html`<${Swatch} v=${x} on=${i === vi} onPick=${() => setVi(i)} />`)}</div>`}</div>
      </div>
      <div>
        <div class="opt-hd"><span class="label">Size${size ? html`<span class="val">${size}</span>` : ''}</span>${p.chart && p.chart.type !== 'dims' && html`<button type="button" class="link" onClick=${() => A.ui({ quick: null, guide: p.slug })}>Size guide</button>`}</div>
        <div class="sizes">${p.sizes.map(sz => html`<button type="button" class=${'sbtn' + (size === sz ? ' on' : '') + (p.sizes.length === 1 ? ' one' : '')} aria-pressed=${size === sz} onClick=${() => { setSize(sz); setErr(false); }}>${sz}</button>`)}</div>
        ${err && html`<p class="size-err" role="alert" style="margin-top:10px">Choose a size first.</p>`}
      </div>
    </div>
    <div class="drawer-ft" style="grid-template-columns:1fr auto">
      <button type="button" class="btn btn-turf" onClick=${add}>Add to bag</button>
      <${Link} class="btn btn-line" to=${'p-' + p.slug + (vi ? '.v' + vi : '')}>Details<//>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- bag
function BagLine({ l, compact }) {
  return html`<div class="line">
    <${Link} to=${'p-' + l.p.slug + (VARIANT[l.vid].i ? '.v' + VARIANT[l.vid].i : '')}><${Tile} v=${l.v} alt=${`${l.p.name} in ${l.v.label}`} hover=${false} /><//>
    <div class="line-bd">
      <div class="line-top"><${Link} class="line-name" to=${'p-' + l.p.slug}>${l.p.name}<//><span class="price" style="font-weight:600">${gbp(l.price * l.qty)}</span></div>
      <span class="line-sub">${l.v.label} · ${l.size === 'One size' ? 'One size' : 'Size ' + l.size}</span>
      ${!compact && html`<div class="line-ctl">
        <div class="qty" role="group" aria-label=${'Quantity of ' + l.p.name}>
          <button type="button" aria-label="Decrease quantity" disabled=${l.qty <= 1} onClick=${() => A.setQty(l.key, l.qty - 1)}>${Icon('minus', 'ico-sm')}</button>
          <output>${l.qty}</output>
          <button type="button" aria-label="Increase quantity" disabled=${l.qty >= 10} onClick=${() => A.setQty(l.key, l.qty + 1)}>${Icon('plus', 'ico-sm')}</button>
        </div>
        <button type="button" class="rm" onClick=${() => A.remove(l.key)}>Remove</button>
      </div>`}
    </div>
  </div>`;
}
function BagDrawer() {
  const s = useS(); const ref = useRef();
  const close = () => A.ui({ bag: false });
  useOverlay(ref, close);
  const lines = bagLines(s.bag); const t = totals(lines, 'delivery');
  const left = Math.max(0, FREE_DELIVERY_OVER - t.sub);
  return html`<div class="scrim" onClick=${close}></div>
  <aside class="drawer" ref=${ref} role="dialog" aria-modal="true" aria-labelledby="bag-h">
    <div class="drawer-hd"><h2 class="h-sm" id="bag-h">Your bag <span class="mono small muted" style="font-weight:400">${t.count ? `(${t.count})` : ''}</span></h2><button type="button" class="ibtn" aria-label="Close bag" onClick=${close}>${Icon('close')}</button></div>
    <div class="drawer-bd">
      ${lines.length ? lines.map(l => html`<${BagLine} key=${l.key} l=${l} />`) : html`<div class="bag-empty">
        <p class="h-md">Your bag is empty</p><p class="muted">Start with the pieces members reach for first.</p>
        <div class="mini-grid">${FEATURED.slice(0, 3).map(sl => { const p = BY_SLUG[sl]; return html`<${Link} class="mini" to=${'p-' + sl}><${Tile} v=${p.variants[0]} alt="" hover=${false} /><b>${p.name}</b><span class="muted">${gbp(minPrice(p))}</span><//>`; })}</div>
        <${Link} class="btn btn-ink" to="shop">Shop the kit<//>
      </div>`}
    </div>
    ${lines.length > 0 && html`<div class="drawer-ft">
      <div class="prog">
        <span>${left > 0 ? html`Spend <b style="color:var(--ink)">${gbp(left)}</b> more for free UK delivery. Collection from the gym is always free.` : 'Your order qualifies for free UK delivery.'}</span>
        <div class="prog-bar" role="progressbar" aria-label="Progress to free delivery" aria-valuemin="0" aria-valuemax=${FREE_DELIVERY_OVER} aria-valuenow=${Math.min(FREE_DELIVERY_OVER, t.sub)}><i style=${{ width: Math.min(100, (t.sub / FREE_DELIVERY_OVER) * 100) + '%' }}></i></div>
      </div>
      <div class="tot"><span>Subtotal</span><b class="price">${gbp(t.sub)}</b></div>
      <${Link} class="btn btn-turf btn-block" to="checkout">Checkout ${Icon('arrowR')}<//>
      <button type="button" class="rm" style="justify-self:center" onClick=${close}>Keep shopping</button>
    </div>`}
  </aside>`;
}

// ---------------------------------------------------------------- search
function SearchPane() {
  const ref = useRef(); const inputRef = useRef();
  const [q, setQ] = useState(''); const [hi, setHi] = useState(0);
  const close = () => A.ui({ search: false });
  useOverlay(ref, close);
  const res = useMemo(() => searchProducts(q), [q]);
  const shown = res.slice(0, 7);
  useEffect(() => setHi(0), [q]);
  const seeAll = () => { A.ui({ query: q.trim() }); nav('shop'); };
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(shown.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) { const vi = variantFor(shown[hi], q); nav('p-' + shown[hi].slug + (vi ? '.v' + vi : '')); } else if (q.trim()) seeAll(); }
  };
  const tries = ['Hoodie', 'Olive', 'Silver', 'Embroidered', 'Shorts', 'Backpack'];
  return html`<div class="scrim" onClick=${close}></div>
  <div class="search-pane" ref=${ref} role="dialog" aria-modal="true" aria-label="Search">
    <div class="wrap">
      <div class="search-bar">
        ${Icon('search')}
        <label class="sr" for="q-in">Search the store</label>
        <input id="q-in" ref=${inputRef} data-autofocus type="search" autocomplete="off" placeholder="Search tees, hoodies, colours…" value=${q}
          onInput=${e => setQ(e.target.value)} onKeyDown=${onKey} aria-controls="q-res" aria-activedescendant=${shown[hi] ? 'sr-' + shown[hi].slug : null} />
        <span class="kbd" aria-hidden="true">Esc</span>
        <button type="button" class="ibtn" aria-label="Close search" onClick=${close}>${Icon('close')}</button>
      </div>
    </div>
    <div class="search-res"><div class="wrap" id="q-res">
      ${!q.trim() ? html`<div style="display:grid;gap:14px"><p class="label muted">Try</p><div class="sugg">${tries.map(t => html`<button type="button" class="chip" onClick=${() => { setQ(t); inputRef.current && inputRef.current.focus(); }}>${t}</button>`)}</div>
          <p class="label muted" style="margin-top:12px">Categories</p><div class="sugg">${CATS.map(c => html`<${Link} class="chip" to=${'shop-' + c.slug}>${c.label}<//>`)}</div></div>`
        : shown.length ? html`<div role="listbox" aria-label="Results">${shown.map((p, i) => { const vi = variantFor(p, q); return html`<${Link} id=${'sr-' + p.slug} role="option" aria-selected=${i === hi} class=${'sres' + (i === hi ? ' on' : '')} to=${'p-' + p.slug + (vi ? '.v' + vi : '')} onMouseEnter=${() => setHi(i)}>
            <${Tile} v=${p.variants[vi]} alt="" hover=${false} /><div><b>${p.name}</b><span>${CAT_BY[p.cat].label} · ${plural(p.variants.length, 'option')}</span></div><span class="price">${gbp(p.variants[vi].price)}</span><//>`; })}
            ${res.length > 0 && html`<button type="button" class="link" style="margin-top:14px" onClick=${seeAll}>See all ${plural(res.length, 'result')} ${Icon('arrowR', 'ico-sm')}</button>`}</div>`
        : html`<p class="muted">No kit matches “${q}”. Try a category like hoodies, or a colour like olive.</p>`}
    </div></div>
  </div>`;
}

// ---------------------------------------------------------------- checkout
const EMPTY_FORM = { first: '', last: '', email: '', phone: '', method: 'collect', line1: '', line2: '', town: '', postcode: '', notes: '', remember: false };
function validate(f, stripe) {
  const e = {};
  if (!f.first.trim()) e.first = 'Enter your first name';
  if (!f.last.trim()) e.last = 'Enter your last name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Enter an email address like name@example.com';
  if (f.phone.trim() && !/^(\+44\s?|0)[\d\s]{9,12}$/.test(f.phone.trim())) e.phone = 'Enter a UK phone number, like 07700 900123';
  if (f.method === 'delivery' && !stripe) {
    if (!f.line1.trim()) e.line1 = 'Enter the first line of your address';
    if (!f.town.trim()) e.town = 'Enter your town or city';
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(f.postcode.trim())) e.postcode = 'Enter a UK postcode, like PL7 5EX';
  }
  return e;
}
function Field({ id, label, hint, f, set, errs, type = 'text', auto, full, inputMode }) {
  const err = errs[id];
  return html`<div class=${'field' + (err ? ' err' : '') + (full ? ' full' : '')}>
    <label for=${'co-' + id}>${label}${hint && html` <span>${hint}</span>`}</label>
    <input id=${'co-' + id} type=${type} autocomplete=${auto} inputmode=${inputMode} value=${f[id]} aria-invalid=${!!err} aria-describedby=${err ? 'co-' + id + '-e' : null}
      onInput=${e => set(id, e.target.value)} />
    ${err && html`<span class="msg" id=${'co-' + id + '-e'}>${err}</span>`}
  </div>`;
}
function Checkout() {
  const s = useS();
  const lines = bagLines(s.bag);
  const stripe = s.pay.stripe;
  const [f, setF] = useState(() => ({ ...EMPTY_FORM, ...LS.get('tf.contact', {}) }));
  const [errs, setErrs] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState('');
  const set = (k, val) => setF(x => ({ ...x, [k]: val }));
  useEffect(() => { if (submitted) setErrs(validate(f, stripe)); }, [f, submitted, stripe]);
  const t = totals(lines, f.method);
  if (!lines.length) {
    return html`<div class="wrap"><div class="page-hd"><p class="eyebrow">Checkout</p><h1 class="h-lg">Your bag is empty</h1><p class="muted">Add something to your bag to check out.</p><div><${Link} class="btn btn-ink" to="shop">Shop the kit<//></div></div></div>`;
  }
  const customer = () => ({ first: f.first.trim(), last: f.last.trim(), email: f.email.trim(), phone: f.phone.trim() });
  const orderLines = () => lines.map(l => ({ vid: l.vid, slug: l.p.slug, size: l.size, qty: l.qty, price: l.price, name: l.p.name, label: l.v.label, url: l.v.url }));
  // Stripe path: the API prices the bag from the catalogue, creates the order
  // and hands back a Stripe Checkout URL. The bag is kept until the payment
  // is confirmed, so cancelling on Stripe loses nothing.
  const startPayment = async () => {
    setPaying(true); setPayErr('');
    try {
      await payReady;
      if (!PAY.stripe) throw new Error('Card payments are unavailable right now. Please try again in a few minutes.');
      const r = await fetch(API_BASE + '/api/shop/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: timeoutSignal(15000),
        body: JSON.stringify({ lines: lines.map(l => ({ vid: l.vid, size: l.size, qty: l.qty })), method: f.method, customer: customer(), notes: f.notes.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) throw new Error(data.error || 'Could not start the payment. Please try again.');
      A.placeOrder({ ref: data.ref, sessionId: data.sessionId, status: 'pending', at: new Date().toISOString(), method: f.method, ...customer(), address: null, notes: f.notes.trim(), lines: orderLines(), sub: t.sub, delivery: t.delivery, total: t.total }, true);
      location.assign(data.url);
    } catch (e) {
      setPayErr(e && e.message ? e.message : 'Could not start the payment.');
      setPaying(false);
    }
  };
  const submit = e => {
    e.preventDefault();
    const e2 = validate(f, stripe); setErrs(e2); setSubmitted(true);
    const first = Object.keys(e2)[0];
    if (first) { const el = document.getElementById('co-' + first); if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    if (f.remember) LS.set('tf.contact', { ...f, notes: '' }); else LS.del('tf.contact');
    if (stripe) { startPayment(); return; }
    // Fallback: no card payments available, so record a request and point at the current store.
    const order = {
      ref: makeRef(), legacy: true, status: 'request', at: new Date().toISOString(), method: f.method, ...customer(),
      address: f.method === 'delivery' ? { line1: f.line1.trim(), line2: f.line2.trim(), city: f.town.trim(), postcode: f.postcode.trim().toUpperCase() } : null,
      notes: f.notes.trim(), lines: orderLines(), sub: t.sub, delivery: t.delivery, total: t.total,
    };
    A.placeOrder(order);
    nav('order-' + order.ref);
  };
  const radio = (val, title, sub, price) => html`<label class=${'rcard' + (f.method === val ? ' on' : '')}>
    <input type="radio" name="method" value=${val} checked=${f.method === val} onChange=${() => set('method', val)} />
    <span class="rd"></span><span><b>${title}</b><span>${sub}</span></span><span class="p">${price}</span>
  </label>`;
  const remember = html`<label class="fopt" style="margin:0"><input type="checkbox" checked=${f.remember} onChange=${e => set('remember', e.target.checked)} /><span class="box">${Icon('check')}</span><span>Remember my details on this device</span></label>`;
  return html`<div class="wrap">
    <div class="page-hd" style="padding-bottom:18px"><nav class="crumbs" aria-label="Breadcrumb"><${Link} to="home">Home<//><span>/</span><button type="button" onClick=${() => A.ui({ bag: true })}>Bag</button><span>/</span><span>Checkout</span></nav><h1 class="h-lg">Checkout</h1></div>
    <div class="co">
      <form onSubmit=${submit} novalidate>
        <section class="co-sec" aria-labelledby="c1"><h2 class="h-sm" id="c1"><span class="n">1</span>Your details</h2>
          <div class="fields">
            <${Field} id="first" label="First name" auto="given-name" f=${f} set=${set} errs=${errs} />
            <${Field} id="last" label="Last name" auto="family-name" f=${f} set=${set} errs=${errs} />
            <${Field} id="email" label="Email" hint="for your receipt" type="email" auto="email" inputMode="email" full f=${f} set=${set} errs=${errs} />
            <${Field} id="phone" label="Phone" hint="optional" type="tel" auto="tel" inputMode="tel" full f=${f} set=${set} errs=${errs} />
          </div>
        </section>
        <section class="co-sec" aria-labelledby="c2"><h2 class="h-sm" id="c2"><span class="n">2</span>Collection or delivery</h2>
          <div class="radios" role="radiogroup" aria-labelledby="c2">
            ${radio('collect', 'Collect from the gym', `Front desk, ${GYM.address}`, 'Free')}
            ${radio('delivery', 'UK delivery', `Posted once it's made. Free over ${gbp(PAY.freeOver)}.`, t.sub >= PAY.freeOver ? 'Free' : gbp(PAY.fee))}
          </div>
          ${f.method === 'delivery' && (stripe
            ? html`<p class="small muted">${Icon('truck', 'ico-sm')} You'll enter your delivery address on the secure payment page.</p>`
            : html`<div class="fields">
              <${Field} id="line1" label="Address line 1" auto="address-line1" full f=${f} set=${set} errs=${errs} />
              <${Field} id="line2" label="Address line 2" hint="optional" auto="address-line2" full f=${f} set=${set} errs=${errs} />
              <${Field} id="town" label="Town or city" auto="address-level2" f=${f} set=${set} errs=${errs} />
              <${Field} id="postcode" label="Postcode" auto="postal-code" f=${f} set=${set} errs=${errs} />
            </div>`)}
          <div class="field"><label for="co-notes">Order notes <span>optional</span></label><textarea id="co-notes" value=${f.notes} onInput=${e => set('notes', e.target.value)} placeholder="Anything the front desk should know"></textarea></div>
        </section>
        <section class="co-sec" aria-labelledby="c3"><h2 class="h-sm" id="c3"><span class="n">3</span>Payment</h2>
          ${stripe ? html`
            <div class="note">${Icon('lock')}<span><b>Secure card payment.</b> You'll enter your card on Stripe's payment page. Apple Pay and Google Pay work there too, and there's a box for a promo code.</span></div>
            ${remember}
            <button type="submit" class="btn btn-turf btn-block" disabled=${paying}>${paying ? 'Opening secure payment…' : `Pay ${gbp(t.total)} by card`} ${!paying && Icon('arrowR')}</button>
            ${payErr && html`<p class="size-err" role="alert">${payErr}</p>`}
            <p class="small muted" style="text-align:center">Payments are processed by Stripe. We never see your card details.</p>`
          : html`
            <div class="note">${Icon('info')}<span><b>${s.pay.checked ? "Card payments aren't available right now." : 'Checking card payments…'}</b> You can still send your order as a request: the next screen links each item to the current store so you can pay there today.</span></div>
            ${remember}
            <button type="submit" class="btn btn-turf btn-block">Send order request · ${gbp(t.total)}</button>`}
          ${submitted && Object.keys(errs).length > 0 && html`<p class="size-err" role="alert">Check the ${plural(Object.keys(errs).length, 'field')} marked above.</p>`}
        </section>
      </form>
      <aside class="summary" aria-labelledby="sum-h">
        <div class="card-row"><h2 class="h-sm" id="sum-h">Order summary</h2><button type="button" class="rm" onClick=${() => A.ui({ bag: true })}>Edit bag</button></div>
        <div>${lines.map(l => html`<div class="line" key=${l.key}>
          <div class="tile"><img src=${l.v.images[0].src} alt="" width="600" height="600" style="inset:6%;width:88%;height:88%" /><span class="qbadge">${l.qty}</span></div>
          <div class="line-bd"><span class="line-name">${l.p.name}</span><span class="line-sub">${l.v.label} · ${l.size}</span></div>
          <span class="price" style="font-weight:600">${gbp(l.price * l.qty)}</span></div>`)}</div>
        <div class="sum-rows">
          <div class="tot"><span>Subtotal</span><span class="price">${gbp(t.sub)}</span></div>
          <div class="tot"><span>${f.method === 'collect' ? 'Collection' : 'Delivery'}</span><span class="price">${t.delivery ? gbp(t.delivery) : 'Free'}</span></div>
          <div class="tot grand"><span class="label">Total</span><b class="price">${gbp(t.total)}</b></div>
        </div>
        <p class="small muted">${Icon('clock', 'ico-sm')} Made to order: allow 10 to 15 days for printing or embroidery.</p>
      </aside>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- order pages
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; } };
const ORDER_STATUS_LABEL = { pending: 'Unpaid', request: 'Request', paid: 'Paid', making: 'Being made', ready: 'Ready', collected: 'Collected', dispatched: 'Dispatched', cancelled: 'Cancelled', refunded: 'Refunded' };
// Merge the API's view of an order over the copy kept in this browser.
function mergeLive(local, live) {
  if (!live) return local;
  return {
    ...(local || {}), ref: live.ref, status: live.status, method: live.method,
    first: live.customer.first, last: live.customer.last, email: live.customer.email, phone: live.customer.phone,
    address: live.address, notes: live.notes,
    lines: live.items.map(i => ({ vid: i.vid, name: i.name, label: i.label, size: i.size, qty: i.qty, price: i.unitPence / 100 })),
    sub: live.subtotalPence / 100, delivery: live.deliveryPence / 100, discount: live.discountPence / 100, total: live.totalPence / 100,
    promoCode: live.promoCode, at: live.createdAt, paidAt: live.paidAt, readyAt: live.readyAt, completedAt: live.completedAt,
  };
}
function OrderPage({ route }) {
  const s = useS();
  const local = s.orders.find(x => x.ref === route.ref) || null;
  const sessionId = (local && local.sessionId) || PAID_RETURN.session || '';
  const [live, setLive] = useState(null);
  const [lookup, setLookup] = useState(sessionId ? 'loading' : 'none');
  useEffect(() => {
    if (!sessionId) return;
    let stop = false; let tries = 0;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/shop/orders/${encodeURIComponent(route.ref)}?session=${encodeURIComponent(sessionId)}`, { signal: timeoutSignal(9000) });
        if (!r.ok) throw new Error('lookup ' + r.status);
        const o = await r.json();
        if (stop) return;
        setLive(o); setLookup('ok');
        A.orderSettled(route.ref, o.status);
        // Straight back from Stripe the webhook may still be in flight: keep asking for a bit.
        if (o.status === 'pending' && PAID_RETURN.session && tries++ < 6) setTimeout(tick, 2500);
      } catch (e) { if (!stop) setLookup(prev => (prev === 'ok' ? 'ok' : 'error')); }
    };
    tick();
    return () => { stop = true; };
  }, [route.ref, sessionId]);
  if (!local && !live) {
    if (lookup === 'loading') return html`<div class="wrap"><div class="page-hd"><p class="eyebrow">Order ${route.ref}</p><h1 class="h-lg">Confirming your payment…</h1></div></div>`;
    return html`<div class="wrap"><div class="page-hd"><p class="eyebrow">Order ${route.ref}</p><h1 class="h-lg">We can't find that order</h1><p class="muted">Orders are kept in the browser they were placed from. Try the device you used, or look in your orders.</p><div><${Link} class="btn btn-ink" to="orders">Your orders<//></div></div></div>`;
  }
  const o = mergeLive(local, live);
  const status = o.status || (o.legacy ? 'request' : 'pending');
  const collect = o.method === 'collect';
  const confirming = status === 'pending' && lookup === 'loading';
  const stage = { pending: 0, cancelled: 0, refunded: 0, request: 1, paid: 1, making: 2, ready: 3, collected: 4, dispatched: 4 }[status] ?? 1;
  const headline = confirming ? 'Confirming your payment…'
    : status === 'pending' ? 'Payment not completed'
    : status === 'cancelled' ? 'This order was cancelled'
    : status === 'refunded' ? 'This order was refunded'
    : status === 'making' ? 'Your kit is being made'
    : status === 'ready' ? (collect ? 'Ready to collect' : 'Ready to post')
    : status === 'collected' ? 'Collected. Enjoy it.'
    : status === 'dispatched' ? 'On its way'
    : `Thanks, ${o.first}.`;
  const lede = confirming ? 'One moment while we check with Stripe.'
    : status === 'pending' ? "We haven't received a payment for this order. Your bag is still here if you'd like to try again."
    : status === 'cancelled' ? 'Nothing was charged. Your bag is still here if you want to start again.'
    : status === 'refunded' ? 'The refund goes back to the card you paid with; banks take a few days to show it.'
    : status === 'request' ? `${collect ? 'Your kit would be at the front desk in Plympton once made.' : `Your kit would be posted to ${o.address ? o.address.postcode : 'you'} once made.`} This was a request, so nothing has been charged.`
    : status === 'ready' ? (collect ? `Your kit is waiting at the front desk, ${GYM.address}.` : 'Your kit is packed and will be posted shortly.')
    : status === 'dispatched' ? `Posted to ${o.address ? o.address.postcode : 'you'}.`
    : status === 'collected' ? 'Thanks for supporting the gym.'
    : `${collect ? "Your kit will be at the front desk in Plympton once it's made." : `Your kit will be posted to ${o.address ? o.address.postcode : 'you'} once it's made.`} A receipt is on its way to ${o.email}.`;
  const step = (n, label, sub) => html`<div class=${stage > n ? 'done' : stage === n ? 'now' : ''}><b>${label}</b><span>${sub}</span></div>`;
  return html`<div>
    <section class="band rubber"><div class="wrap conf-hd">
      <p class="eyebrow">${status === 'request' ? 'Order request' : 'Order'} · ${fmtDate(o.at)}${o.paidAt ? ` · paid ${fmtDate(o.paidAt)}` : ''}</p>
      <h1 class="h-xl">${headline}</h1>
      <p class="ref">${o.ref}</p>
      <p class="lede">${lede}</p>
      ${stage > 0 ? html`<div class="timeline">
        ${step(1, status === 'request' ? 'Request sent' : 'Order paid', o.paidAt ? fmtDate(o.paidAt) : fmtDate(o.at))}
        ${step(2, 'Printed or embroidered', stage === 2 ? 'In progress' : '10 to 15 days')}
        ${step(3, collect ? 'Ready to collect' : 'Posted to you', stage >= 3 ? (stage === 4 ? (collect ? 'Collected' : 'Dispatched') : (collect ? 'Waiting at the front desk' : 'Being packed')) : (collect ? 'Front desk, 9B Meadow Close' : 'UK delivery'))}
      </div>` : html`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        ${status === 'pending' && html`<${Link} class="btn btn-turf" to="checkout">Try the payment again<//>`}
        <${Link} class="btn btn-line" to="shop">Back to the shop<//></div>`}
    </div></section>
    <div class="wrap conf-grid">
      <section class="summary" style="position:static" aria-labelledby="ow-h">
        <div class="card-row"><h2 class="h-sm" id="ow-h">What you ordered</h2><span class="tag" style="border:1px solid var(--line-2)">${ORDER_STATUS_LABEL[status] || status}</span></div>
        <div>${o.lines.map(l => { const hit = VARIANT[l.vid]; return html`<div class="line">
          <div class="tile">${hit && html`<img src=${hit.v.images[0].src} alt="" width="600" height="600" style="inset:6%;width:88%;height:88%" />`}<span class="qbadge">${l.qty}</span></div>
          <div class="line-bd"><span class="line-name">${l.name}</span><span class="line-sub">${l.label} · ${l.size}</span></div>
          <span class="price" style="font-weight:600">${gbp(l.price * l.qty)}</span></div>`; })}</div>
        <div class="sum-rows">
          <div class="tot"><span>Subtotal</span><span class="price">${gbp(o.sub)}</span></div>
          ${o.discount > 0 && html`<div class="tot"><span>Discount${o.promoCode ? ` (${o.promoCode})` : ''}</span><span class="price">−${gbp(o.discount)}</span></div>`}
          <div class="tot"><span>${collect ? 'Collection' : 'Delivery'}</span><span class="price">${o.delivery ? gbp(o.delivery) : 'Free'}</span></div>
          <div class="tot grand"><span class="label">Total</span><b class="price">${gbp(o.total)}</b></div>
        </div>
        <dl class="spec"><dt>Name</dt><dd>${o.first} ${o.last}</dd><dt>Email</dt><dd>${o.email}</dd>${o.phone && html`<dt>Phone</dt><dd>${o.phone}</dd>`}
          ${o.address && html`<dt>Deliver to</dt><dd>${[o.address.name, o.address.line1, o.address.line2, o.address.city, o.address.postcode].filter(Boolean).join(', ')}</dd>`}
          ${o.notes && html`<dt>Notes</dt><dd>${o.notes}</dd>`}</dl>
        ${lookup === 'error' && local && html`<p class="small muted">Showing the copy saved on this device; we couldn't reach the order service just now.</p>`}
      </section>
      ${o.legacy ? html`<section style="display:grid;gap:16px" aria-labelledby="lg-h">
        <p class="eyebrow">Order it today</p>
        <h2 class="h-md" id="lg-h">Get this kit from the current store</h2>
        <p class="muted">Card payments aren't available here right now. Each link opens the same item on the current Transform Fitness store, where you can pick the size and pay.</p>
        <div class="legacy">${o.lines.map(l => html`<a href=${l.url} target="_blank" rel="noopener"><span><b>${l.name}</b> · ${l.label} · ${l.size}${l.qty > 1 ? ` × ${l.qty}` : ''}</span>${Icon('ext', 'ico-sm')}</a>`)}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"><${Link} class="btn btn-ink" to="shop">Keep shopping<//><${Link} class="btn btn-line" to="orders">Your orders<//></div>
      </section>` : html`<section style="display:grid;gap:16px" aria-labelledby="nx-h">
        <p class="eyebrow">What happens next</p>
        <h2 class="h-md" id="nx-h">${collect ? 'Collecting your kit' : 'Delivery'}</h2>
        <p class="muted">${collect
          ? `Every piece is printed or embroidered to order, which takes 10 to 15 days. We'll email ${o.email} when it's ready, and it'll be waiting at the front desk at ${GYM.address}. Bring your order number.`
          : `Every piece is printed or embroidered to order, which takes 10 to 15 days. We'll email ${o.email} when it's posted.`}</p>
        <p class="muted">Questions? Call ${GYM.phone} or email ${GYM.email} and quote <b style="color:var(--ink)">${o.ref}</b>.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"><${Link} class="btn btn-ink" to="shop">Keep shopping<//><${Link} class="btn btn-line" to="orders">Your orders<//></div>
      </section>`}
    </div>
  </div>`;
}
function Orders() {
  const s = useS();
  return html`<div class="wrap">
    <div class="page-hd"><p class="eyebrow">Kept on this device</p><h1 class="h-lg">Your orders</h1></div>
    ${s.orders.length ? html`<div class="orders">${s.orders.map(o => html`<${Link} class="order-row" to=${'order-' + o.ref}>
      <div><div class="card-row" style="justify-content:flex-start;gap:14px;flex-wrap:wrap"><b class="mono">${o.ref}</b><span class="tag" style="border:1px solid var(--line-2)">${ORDER_STATUS_LABEL[o.status || (o.legacy ? 'request' : 'pending')] || o.status}</span><span class="muted small">${fmtDate(o.at)} · ${plural(o.lines.reduce((t, l) => t + l.qty, 0), 'item')} · ${o.method === 'collect' ? 'Collect' : 'Delivery'}</span></div>
        <div class="thumbs-row">${o.lines.slice(0, 6).map(l => VARIANT[l.vid] && html`<${Tile} v=${VARIANT[l.vid].v} alt="" hover=${false} />`)}</div></div>
      <b class="price">${gbp(o.total)}</b><//>`)}</div>`
      : html`<div class="empty"><p class="muted">No orders on this device yet.</p><${Link} class="btn btn-ink" to="shop">Shop the kit<//></div>`}
  </div>`;
}
function Saved() {
  const s = useS();
  return html`<div class="wrap">
    <div class="page-hd"><p class="eyebrow">Kept on this device</p><h1 class="h-lg">Saved</h1></div>
    ${s.saved.length ? html`<div class="grid" style="padding-bottom:clamp(56px,8vw,112px)">${s.saved.map(sl => html`<${ProductCard} key=${sl} p=${BY_SLUG[sl]} />`)}</div>`
      : html`<div class="empty" style="padding-bottom:clamp(56px,8vw,112px)"><p class="muted">Tap the heart on any product to keep it here.</p><${Link} class="btn btn-ink" to="shop">Shop the kit<//></div>`}
  </div>`;
}
function Help({ route }) {
  const s = useS();
  useEffect(() => { if (route.anchor) { const el = document.getElementById('h-' + route.anchor); if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); } }, [route.anchor]);
  const go = id => { const el = document.getElementById('h-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const guides = PRODUCTS.filter(p => p.chart && p.chart.type !== 'dims');
  return html`<div class="wrap">
    <div class="page-hd"><p class="eyebrow">Help</p><h1 class="h-lg">Ordering, sizing and collection</h1></div>
    <div class="help">
      <nav aria-label="Help topics">
        ${[['made', 'Made to order'], ['collect', 'Collection and delivery'], ['sizing', 'Size guides'], ['contact', 'Contact'], ['payments', 'Payments']].map(([id, l]) => html`<a href=${'#help-' + id} onClick=${e => { e.preventDefault(); replaceHash('help-' + id); go(id); }}>${l}</a>`)}
      </nav>
      <div>
        <section id="h-made"><h2 class="h-md">Made to order</h2>
          <p>Nothing sits on a shelf. When you order, your piece is printed or embroidered for you. Production takes 10 to 15 days, so allow around two to three weeks from order to collection.</p>
          <p>Because each item is decorated to order, check your size with the guides below before you buy.</p></section>
        <section id="h-collect"><h2 class="h-md">Collection and delivery</h2>
          <p><b style="color:var(--ink)">Collect from the gym, free.</b> Your order waits at the front desk at ${GYM.address}.</p>
          <p><b style="color:var(--ink)">UK delivery, ${gbp(DELIVERY_FEE)}.</b> Free on orders over ${gbp(FREE_DELIVERY_OVER)}. Posted once your kit is made.</p></section>
        <section id="h-sizing"><h2 class="h-md">Size guides</h2>
          <p>Every chart comes from the garment maker. Most show the body measurement each size is cut to fit; the Classic Hoodie shows the garment itself, measured flat. Each guide has a fit finder that suggests a size from one measurement.</p>
          <div class="guides">${guides.map(p => html`<button type="button" onClick=${() => A.ui({ guide: p.slug })}><span>${p.name}</span>${Icon('ruler', 'ico-sm')}</button>`)}</div></section>
        <section id="h-contact"><h2 class="h-md">Contact</h2>
          <p>A problem with an order, or a question about sizing? Speak to the front desk, or get in touch:</p>
          <div style="display:grid;gap:10px" class="contact-list">
            <span>${GYM.address}</span>
            <span class="copyable-light"><${Copy} text=${GYM.phone} label="phone number" /></span>
            <span class="copyable-light"><${Copy} text=${GYM.email} label="email address" /></span>
          </div></section>
        <section id="h-payments"><h2 class="h-md">Payments</h2>
          ${s.pay.stripe
            ? html`<p>Card payments are processed by Stripe on a secure payment page. Apple Pay and Google Pay work there too, and there's a box for a promo code before you pay. We never see or store your card details.</p>
              <p>Refunds go back to the card you paid with. Ask at the front desk or email us with your order reference.</p>`
            : html`<p>Card payments aren't available at the moment. You can still send an order request; the confirmation page links each item to the current store so you can pay there.</p>
              <p><a class="link" href=${GYM.legacyStore} target="_blank" rel="noopener">Open the current store ${Icon('ext', 'ico-sm')}</a></p>`}</section>
      </div>
    </div>
  </div>`;
}
function NotFound() {
  return html`<div class="wrap"><div class="page-hd" style="padding-bottom:clamp(56px,8vw,112px)"><p class="eyebrow">Not found</p><h1 class="h-lg">That page isn't here</h1><p class="muted">It may have moved. The shop has everything in one place.</p><div><${Link} class="btn btn-ink" to="shop">Go to the shop<//></div></div></div>`;
}

// ---------------------------------------------------------------- toasts
function Toasts() {
  const s = useS();
  return html`<div class="toasts" aria-live="polite">${s.toasts.map(t => {
    const hit = t.vid && VARIANT[t.vid];
    if (t.kind === 'plain' || !hit) return html`<div class="toast plain" key=${t.id}><div><b>${t.title}</b></div>${t.action && html`<button type="button" onClick=${() => { A.dismiss(t.id); nav(t.action.to); }}>${t.action.label}</button>`}</div>`;
    const title = t.title || (t.kind === 'added' ? 'Added to bag' : 'Removed from bag');
    return html`<div class="toast" key=${t.id}>
      <${Tile} v=${hit.v} alt="" hover=${false} />
      <div><b>${title}</b><span>${hit.p.name} · ${hit.v.label} · ${t.size}</span></div>
      ${t.kind === 'added' ? html`<button type="button" onClick=${() => { A.dismiss(t.id); A.ui({ bag: true }); }}>View bag</button>`
        : html`<button type="button" onClick=${() => { A.dismiss(t.id); t.undo(); }}>Undo</button>`}
    </div>`;
  })}</div>`;
}

// ---------------------------------------------------------------- app
function App() {
  const [s, setS] = useState(store.get());
  useEffect(() => store.sub(setS), []);
  const route = useRoute();
  const rk = routeKey(route);
  useEffect(() => { if (PAID_RETURN.cancelled) A.toast({ kind: 'plain', title: 'Payment cancelled. Your bag is still here.' }); }, []);
  useEffect(() => {
    if (route.anchor && route.name === 'home') {
      requestAnimationFrame(() => { const el = document.getElementById(route.anchor); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    } else if (!(route.name === 'help' && route.anchor)) window.scrollTo(0, 0);
  }, [rk]);
  const ui = s.ui;
  const anyOpen = ui.bag || ui.search || ui.menu || ui.quick || ui.guide;
  useEffect(() => { document.documentElement.style.overflow = anyOpen ? 'hidden' : ''; }, [!!anyOpen]);
  useEffect(() => {
    const onKey = e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); A.ui({ search: true }); }
      if (e.key === 'Escape') A.closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const titles = { home: 'Transform Fitness Kit', shop: 'Shop · Transform Fitness Kit', checkout: 'Checkout · Transform Fitness Kit', orders: 'Your orders · Transform Fitness Kit', saved: 'Saved · Transform Fitness Kit', help: 'Help · Transform Fitness Kit' };
    document.title = route.name === 'product' ? `${BY_SLUG[route.slug].name} · Transform Fitness Kit` : titles[route.name] || 'Transform Fitness Kit';
  }, [rk]);

  let view;
  switch (route.name) {
    case 'home': view = html`<${Home} />`; break;
    case 'shop': view = html`<${Shop} route=${route} />`; break;
    case 'product': view = html`<${ProductPage} key=${route.slug} route=${route} />`; break;
    case 'checkout': view = html`<${Checkout} />`; break;
    case 'order': view = html`<${OrderPage} route=${route} />`; break;
    case 'orders': view = html`<${Orders} />`; break;
    case 'saved': view = html`<${Saved} />`; break;
    case 'help': view = html`<${Help} route=${route} />`; break;
    default: view = html`<${NotFound} />`;
  }
  return html`<${Ctx.Provider} value=${s}>
    <button type="button" class="sr skip" onClick=${() => { const m = document.getElementById('main'); if (m) m.focus(); }}>Skip to content</button>
    <${Header} route=${route} />
    <main id="main" tabindex="-1" class=${route.name === 'product' ? 'pdp-page' : ''} style="outline:none">${view}</main>
    <${Footer} />
    ${ui.menu && html`<${MobileMenu} />`}
    ${ui.bag && html`<${BagDrawer} />`}
    ${ui.search && html`<${SearchPane} />`}
    ${ui.quick && html`<${QuickAdd} slug=${ui.quick.slug} vi=${ui.quick.vi} />`}
    ${ui.guide && html`<${SizeGuide} slug=${ui.guide} />`}
    <${Toasts} />
  <//>`;
}

render(html`<${App} />`, document.getElementById('app'));
})();
