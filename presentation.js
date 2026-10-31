// ── PHOTOBOOK PRESENTATION ───────────────────────────────────────────────────
// Shows a trip's photobook (photobook.js) as a book with page turns, or as a clean full-screen
// slideshow for a TV, and exports it as a PDF, one offline web page, or a folder with both plus
// the videos. Nothing is printed or uploaded anywhere: exports are files on this computer.
//
// Pages are 4:3 and laid out automatically: the trip's kept photos in date order, one to three
// per page depending on orientation, never mixing two days on a page. Shuffle draws a new
// layout; Arrange swaps photos and moves pages. The layout and captions are saved on the trip
// folder (folder.book), so they survive a restart and photos kept later slot in by date.
//
// presRuntime() below is the one viewer for both the app and the exported web page (where it is
// embedded as source text), so it must stay self-contained: no globals from the rest of Trove.

let pres = null; // the open presentation, or null

const PRES_LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', zh: 'zh-CN' };
function presLongDate(ts) {
  return ts ? new Date(ts).toLocaleDateString(PRES_LOCALES[currentLang] || 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}
function presPlaceOf(f) { return f?.city || f?.region || f?.country || ''; }
function presEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── LAYOUT ───────────────────────────────────────────────────────────────────
function presRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
function presDayKey(ts) { const d = new Date(ts || 0); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

// items: [{ f, orient: 'L' | 'P' }] in date order. Videos get a page of their own; landscapes
// lean towards a page to themselves, portraits towards sharing one.
function presLayout(items, seed) {
  const rnd = presRandom(seed);
  const pages = [];
  for (let i = 0; i < items.length;) {
    const a = items[i];
    const sameDay = x => x && !isVid(x.f.ext) && presDayKey(x.f.fileDate) === presDayKey(a.f.fileDate);
    let n = 1;
    if (!isVid(a.f.ext)) {
      const opts = [[1, a.orient === 'L' ? 0.35 : 0.12]];
      if (sameDay(items[i + 1])) opts.push([2, 0.45]);
      if (sameDay(items[i + 1]) && sameDay(items[i + 2]) && items.slice(i, i + 3).filter(x => x.orient === 'P').length >= 2) opts.push([3, 0.4]);
      let r = rnd() * opts.reduce((s, o) => s + o[1], 0);
      for (const [k, w] of opts) { if ((r -= w) <= 0) { n = k; break; } }
    }
    pages.push({ id: 'p' + Math.floor(rnd() * 1e9).toString(36) + i, ids: items.slice(i, i + n).map(x => x.f.id) });
    i += n;
  }
  return pages;
}

function presCellLayout(files, orient) {
  if (files.length === 1) return 'n1';
  if (files.length === 2) return files.every(f => orient(f) === 'L') ? 'n2r' : 'n2c';
  return files.filter(f => orient(f) === 'P').length === 3 ? 'n3c' : 'n3m';
}

// Orientation as the photo is actually seen (its thumbnail already has EXIF and Trove rotation applied).
const presOrientCache = new Map();
async function presOrientation(f) {
  if (presOrientCache.has(f.id)) return presOrientCache.get(f.id);
  const url = await getThumb(f).catch(() => null);
  const o = await new Promise(resolve => {
    if (!url) { resolve(f.height > f.width ? 'P' : 'L'); return; }
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight > img.naturalWidth ? 'P' : 'L');
    img.onerror = () => resolve('L');
    img.src = url;
  });
  presOrientCache.set(f.id, o);
  return o;
}

// The saved layout, minus photos no longer kept, plus pages for newly kept ones at their date.
function presReconcilePages(trip, items) {
  const book = trip.book || {};
  const byId = new Map(items.map(x => [x.f.id, x]));
  const time = id => byId.get(id)?.f.fileDate || 0;
  const pages = (book.pages || []).map(p => ({ ...p, ids: p.ids.filter(id => byId.has(id)) })).filter(p => p.ids.length);
  const placed = new Set(pages.flatMap(p => p.ids));
  const fresh = items.filter(x => !placed.has(x.f.id));
  for (const np of presLayout(fresh, book.seed || 1)) {
    const at = pages.findIndex(p => time(p.ids[0]) > time(np.ids[0]));
    pages.splice(at < 0 ? pages.length : at, 0, np);
  }
  trip.book = { ...book, pages };
  return pages;
}

// ── PAGES ────────────────────────────────────────────────────────────────────
async function presBuild(trip) {
  const all = photobookTripMedia(trip.id);
  const kept = all.filter(isInPhotobook);
  const items = await Promise.all(kept.map(async f => ({ f, orient: await presOrientation(f) })));
  const orient = f => presOrientCache.get(f.id) || 'L';
  const byId = new Map(kept.map(f => [f.id, f]));
  const photoPages = presReconcilePages(trip, items);
  const book = trip.book;
  const range = kept.length ? [kept[0].fileDate, kept[kept.length - 1].fileDate] : [];
  const coverFile = byId.get(trip.coverFileId) || kept.find(f => f.bestOf && isImg(f.ext)) || kept.find(f => isImg(f.ext)) || kept[0];
  const days = new Set(all.filter(f => f.fileDate).map(f => presDayKey(f.fileDate))).size;
  const places = new Set(all.map(f => f.city || f.region).filter(Boolean)).size;
  const pages = [{ type: 'cover', title: book.title || trip.name, subtitle: book.subtitle || presDateRange(range[0], range[1]), coverId: coverFile?.id }];
  const map = presMapSvg(all);
  if (map) pages.push({ type: 'map', svg: map });
  pages.push({ type: 'stats', days, places, taken: all.length, kept: kept.length });
  for (const p of photoPages) {
    const files = p.ids.map(id => byId.get(id));
    pages.push({ type: 'photos', pageId: p.id, ids: p.ids, layout: presCellLayout(files, orient), caption: p.caption ?? presDefaultCaption(files[0]) });
  }
  pages.push({ type: 'end' });
  return { pages, byId };
}

function presDateRange(a, b) {
  if (!a) return '';
  const da = presLongDate(a), db = presLongDate(b);
  return da === db ? da : `${da} - ${db}`;
}
function presDefaultCaption(f) {
  const place = presPlaceOf(f);
  return [presLongDate(f?.fileDate), place].filter(Boolean).join(' · ');
}

// The trip's route from GPS, drawn as a sketch: the path in time order and its places. No map
// tiles, so it works offline, in the PDF, and leaks no location to a map server. A trip that
// stayed in one spot gets no map: blown up, its GPS jitter would read as a route.
function presMapSvg(media) {
  const pts = media.filter(f => f.gps && isFinite(f.gps.lat) && isFinite(f.gps.lng) && f.fileDate).sort((a, b) => a.fileDate - b.fileDate);
  if (!pts.length) return null;
  const placeCount = new Set(pts.map(presPlaceOf).filter(Boolean)).size;
  const lats = pts.map(f => f.gps.lat), lngs = pts.map(f => f.gps.lng);
  const spanKm = haversineKm({ lat: Math.min(...lats), lng: Math.min(...lngs) }, { lat: Math.max(...lats), lng: Math.max(...lngs) });
  if (placeCount < 2 && spanKm < 5) return null;
  const k = Math.cos((pts.reduce((s, f) => s + f.gps.lat, 0) / pts.length) * Math.PI / 180);
  const xy = f => [f.gps.lng * k, -f.gps.lat];
  let [x0, y0] = xy(pts[0]), x1 = x0, y1 = y0;
  pts.forEach(f => { const [x, y] = xy(f); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
  const minSpan = 0.02;
  if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
  if (y1 - y0 < minSpan) { const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; }
  const W = 800, H = 520, M = 70;
  const s = Math.min((W - 2 * M) / (x1 - x0), (H - 2 * M) / (y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
  const P = f => { const [x, y] = xy(f); return [ox + (x - x0) * s, oy + (y - y0) * s]; };
  let path = '', last = null;
  for (const f of pts) {
    const [x, y] = P(f);
    if (last && Math.hypot(x - last[0], y - last[1]) < 2) continue;
    path += (path ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    last = [x, y];
  }
  const places = new Map();
  pts.forEach(f => { const name = presPlaceOf(f); if (!name) return; const p = places.get(name); if (p) p.n++; else places.set(name, { name, f, n: 1 }); });
  const labelled = new Set([...places.values()].sort((a, b) => b.n - a.n).slice(0, 8).map(p => p.name));
  const dots = [...places.values()].map(p => {
    const [x, y] = P(p.f);
    const label = labelled.has(p.name) ? `<text x="${(x + 10).toFixed(1)}" y="${(y + 5).toFixed(1)}">${presEsc(p.name)}</text>` : '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>${label}`;
  }).join('');
  const ends = [pts[0], pts[pts.length - 1]].map(f => { const [x, y] = P(f); return `<circle class="pp-end-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`; }).join('');
  return `<svg class="pp-map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <path d="${path}" class="pp-route"/>${ends}${dots}</svg>`;
}

// One page as HTML. ctx.src(file) gives an image URL; ctx.video(file) the markup for a video
// cell (it differs between the app, the web page and the PDF); ctx.editable marks text the
// user can click to change.
function presPageHtml(page, ctx, byId) {
  const ed = (field, extra) => ctx.editable ? ` data-edit="${field}"${extra || ''} title="${presEsc(t('prEditHint'))}"` : '';
  if (page.type === 'cover') {
    const f = byId.get(page.coverId);
    const src = f && ctx.src(f);
    return `<div class="pp pp-cover">${src ? `<img class="pp-cover-img" src="${src}" data-full-id="${f.id}" alt="">` : ''}
      <div class="pp-cover-text"><div class="pp-cover-title"${ed('title')}>${presEsc(page.title)}</div><div class="pp-cover-sub"${ed('subtitle')}>${presEsc(page.subtitle)}</div></div></div>`;
  }
  if (page.type === 'map') return `<div class="pp pp-map"><div class="pp-map-title">${presEsc(t('prMapTitle'))}</div>${page.svg}</div>`;
  if (page.type === 'stats') {
    const tile = (n, label) => `<div class="pp-stat"><div class="pp-stat-n">${n}</div><div class="pp-stat-l">${presEsc(label)}</div></div>`;
    return `<div class="pp pp-stats"><div class="pp-stats-title">${presEsc(t('prStatsTitle'))}</div><div class="pp-stats-grid">
      ${tile(page.days, t('prStatDays', { n: page.days }))}${tile(page.places, t('prStatPlaces', { n: page.places }))}
      ${tile(page.taken, t('prStatTaken', { n: page.taken }))}${tile(page.kept, t('prStatKept', { n: page.kept }))}</div></div>`;
  }
  if (page.type === 'end') return `<div class="pp pp-end"><div class="pp-end-heart">❤</div><div class="pp-end-text">${presEsc(t('prTheEnd'))}</div></div>`;
  const cells = page.ids.map(id => {
    const f = byId.get(id);
    if (!f) return '';
    const inner = isVid(f.ext) ? ctx.video(f) : `<img src="${ctx.src(f) || ''}" data-full-id="${f.id}" alt="">`;
    return `<figure class="pp-cell" data-id="${f.id}">${inner}</figure>`;
  }).join('');
  return `<div class="pp pp-photos pp-${page.layout}" data-page-id="${page.pageId}"><div class="pp-cells">${cells}</div>
    <div class="pp-cap"${ed('caption', ` data-page-id="${page.pageId}"`)}>${presEsc(page.caption)}</div></div>`;
}

// ── THE VIEWER ───────────────────────────────────────────────────────────────
// Self-contained (see the top of this file). getPages() returns the page elements; the viewer
// shows clones of them, two to a spread (cover alone on the right, like a real book) with a
// page turn between spreads, or one at a time as a slideshow that moves on by itself.
function presRuntime(root, getPages, opts) {
  opts = opts || {};
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const st = { look: opts.look || 'book', i: 0, busy: false, timer: null, playing: false };
  const stage = document.createElement('div');
  root.appendChild(stage);
  const spreads = () => {
    const p = getPages(), s = [[null, p[0]]];
    for (let k = 1; k < p.length; k += 2) s.push([p[k], p[k + 1] || null]);
    return s;
  };
  const count = () => st.look === 'book' ? spreads().length : getPages().length;
  const box = p => {
    const w = document.createElement('div');
    w.className = 'pres-page';
    if (p) w.appendChild(p.cloneNode(true));
    else { const b = document.createElement('div'); b.className = 'pp pp-blank'; w.appendChild(b); }
    return w;
  };
  function draw() {
    clearTimeout(st.timer);
    st.i = Math.max(0, Math.min(st.i, count() - 1));
    stage.className = 'pres-stage pres-' + st.look;
    stage.innerHTML = '';
    if (st.look === 'book') {
      const sp = document.createElement('div');
      sp.className = 'pres-spread';
      spreads()[st.i].forEach(p => sp.appendChild(box(p)));
      stage.appendChild(sp);
    } else {
      const s = document.createElement('div');
      s.className = 'pres-slide';
      s.appendChild(box(getPages()[st.i]));
      stage.appendChild(s);
      if (st.playing) {
        const v = s.querySelector('video');
        if (v) { v.play().catch(() => {}); v.onended = () => next(); }
        else st.timer = setTimeout(next, opts.slideMs || 6000);
      }
    }
    if (opts.onDraw) opts.onDraw(stage, st, count());
  }
  function flip(dir) {
    const s = spreads(), to = st.i + dir;
    if (to < 0 || to >= s.length || st.busy) return;
    if (reduce) { st.i = to; draw(); return; }
    st.busy = true;
    const [l0, r0] = s[st.i], [l1, r1] = s[to];
    const sp = document.createElement('div');
    sp.className = 'pres-spread';
    sp.append(box(dir > 0 ? l0 : l1), box(dir > 0 ? r1 : r0));
    const leaf = document.createElement('div');
    leaf.className = 'pres-leaf ' + (dir > 0 ? 'pres-leaf-r' : 'pres-leaf-l');
    const front = box(dir > 0 ? r0 : l0), back = box(dir > 0 ? l1 : r1);
    front.classList.add('pres-face'); back.classList.add('pres-face', 'pres-face-back');
    leaf.append(front, back);
    sp.appendChild(leaf);
    stage.innerHTML = '';
    stage.appendChild(sp);
    requestAnimationFrame(() => requestAnimationFrame(() => { leaf.style.transform = `rotateY(${dir > 0 ? -180 : 180}deg)`; }));
    setTimeout(() => { st.busy = false; st.i = to; draw(); }, 760);
  }
  function next() {
    if (st.look === 'book') { flip(1); return; }
    if (st.i < count() - 1) { st.i++; draw(); } else { st.playing = false; draw(); }
  }
  function prev() { if (st.look === 'book') flip(-1); else if (st.i > 0) { st.i--; draw(); } }
  function setLook(look) {
    const page = st.look === 'book' ? Math.max(0, st.i * 2 - 1) : st.i;
    st.look = look;
    st.i = look === 'book' ? Math.ceil(page / 2) : page;
    st.playing = look === 'slides';
    draw();
  }
  function key(e) {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); return true; }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); return true; }
    if (e.key === 'Home') { st.i = 0; draw(); return true; }
    if (e.key === 'End') { st.i = count() - 1; draw(); return true; }
    return false;
  }
  stage.addEventListener('click', e => {
    if (e.target.closest('video, [contenteditable="true"], button, a')) return;
    if (st.look === 'slides') { next(); return; }
    const r = stage.getBoundingClientRect();
    if (e.clientX > r.left + r.width / 2) next(); else prev();
  });
  draw();
  return { draw, next, prev, setLook, key, st, count, play(on) { st.playing = on; draw(); } };
}

// ── IN THE APP ───────────────────────────────────────────────────────────────
async function openPresentation(tripId) {
  const trip = appData.folders.find(f => f.id === tripId);
  if (!trip) return;
  if (!photobookTripMedia(tripId).some(isInPhotobook)) { toast(t('prEmpty')); return; }
  const el = document.getElementById('presMode');
  el.classList.add('open');
  document.getElementById('presRoot').innerHTML = `<div class="pb-wait">${t('prPreparing')}</div>`;
  pres = { tripId, trip, look: 'book', arrange: false, swapSel: null, full: new Map(), thumbs: new Map(), pageEls: [], data: null, rt: null };
  await presRefresh();
  presQueueFullImages();
}

function closePresentation() {
  if (!pres) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  clearTimeout(pres.rt?.st.timer);
  pres = null;
  document.getElementById('presMode').classList.remove('open', 'pres-idle');
  document.getElementById('presRoot').innerHTML = '';
  persistQuiet();
}

// Rebuilds the page elements (after a shuffle, swap, caption...) and redraws in place.
async function presRefresh() {
  const session = pres;
  const data = await presBuild(session.trip);
  if (pres !== session) return;
  await Promise.all([...data.byId.values()].map(async f => { if (!session.thumbs.has(f.id)) session.thumbs.set(f.id, await getThumb(f).catch(() => null)); }));
  if (pres !== session) return;
  session.data = data;
  const ctx = {
    editable: true,
    src: f => session.full.get(f.id) || session.thumbs.get(f.id) || '',
    video: f => `<video src="${pathToFileUrl(f.path)}" ${session.thumbs.get(f.id) ? `poster="${session.thumbs.get(f.id)}"` : ''} controls playsinline preload="metadata"></video>`,
  };
  const holder = document.createElement('div');
  holder.innerHTML = data.pages.map(p => presPageHtml(p, ctx, data.byId)).join('');
  session.pageEls = [...holder.children];
  presRenderTop();
  if (session.arrange) { presRenderArrange(); return; }
  if (!session.rt) {
    const root = document.getElementById('presRoot');
    root.innerHTML = '';
    session.rt = presRuntime(root, () => session.pageEls, { look: session.look, onDraw: presOnDraw });
  } else session.rt.draw();
}

function presOnDraw(stage, st, total) {
  if (!pres) return;
  document.getElementById('presCount').textContent = `${st.i + 1} / ${total}`;
  const editable = st.look === 'book';
  stage.querySelectorAll('[data-edit]').forEach(el => {
    if (!editable) return;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.blur(); } });
    el.addEventListener('blur', () => presSaveText(el), { once: true });
  });
  // The visible pages get their sharp images first.
  stage.querySelectorAll('img[data-full-id]').forEach(img => presLoadFull(img.dataset.fullId));
}

function presSaveText(el) {
  if (!pres) return;
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  const book = pres.trip.book || (pres.trip.book = {});
  const field = el.dataset.edit;
  if (field === 'caption') {
    const p = book.pages?.find(x => x.id === el.dataset.pageId);
    if (p) { if (text) p.caption = text; else delete p.caption; }
  } else if (field === 'title' || field === 'subtitle') {
    if (text) book[field] = text; else delete book[field];
  }
  persistQuiet();
  presRefresh();
}

async function presLoadFull(id) {
  if (!pres || pres.full.has(id)) return;
  const session = pres;
  session.full.set(id, null); // in flight
  const f = session.data?.byId.get(id);
  const url = f ? await photobookImageUrl(f) : null;
  if (pres !== session || !url) return;
  session.full.set(id, url);
  const sel = `img[data-full-id="${CSS.escape(id)}"]`;
  session.pageEls.forEach(p => p.querySelectorAll(sel).forEach(img => { img.src = url; }));
  document.querySelectorAll(`#presRoot ${sel}`).forEach(img => { img.src = url; });
}

// Everything else upgrades quietly one at a time, so turning pages never waits on it.
async function presQueueFullImages() {
  const session = pres;
  for (const f of [...(session?.data?.byId.values() || [])]) {
    if (pres !== session) return;
    if (isImg(f.ext) && !session.full.has(f.id)) await presLoadFull(f.id);
  }
}

function presRenderTop() {
  const p = pres;
  document.getElementById('presTop').innerHTML = `
    <span class="sort-title">📖 ${presEsc(p.trip.name)}</span>
    <div class="pb-tabs">
      <button class="pb-tab${!p.arrange && p.look === 'book' ? ' active' : ''}" onclick="presSetLook('book')">${t('prLookBook')}</button>
      <button class="pb-tab${!p.arrange && p.look === 'slides' ? ' active' : ''}" onclick="presSetLook('slides')">${t('prLookSlides')}</button>
      <button class="pb-tab${p.arrange ? ' active' : ''}" onclick="presToggleArrange()">${t('prArrange')}</button>
    </div>
    <button class="globe-close" onclick="presShuffle()" title="${presEsc(t('prShuffleTitle'))}">🔀 ${t('prShuffle')}</button>
    <span style="flex:1"></span>
    <button class="globe-close" onclick="presPrev()">‹</button><span class="pres-count" id="presCount"></span><button class="globe-close" onclick="presNext()">›</button>
    <button class="globe-close" onclick="presFullscreen()" title="${presEsc(t('prFullscreen'))}">⛶</button>
    <div class="pres-export-wrap">
      <button class="globe-close" onclick="presToggleExportMenu(event)">⬇ ${t('prExport')}</button>
      <div class="pres-export-menu" id="presExportMenu">
        <button onclick="presExport('pdf')"><strong>${t('prExportPdf')}</strong><span>${t('prExportPdfSub')}</span></button>
        <button onclick="presExport('html')"><strong>${t('prExportHtml')}</strong><span>${t('prExportHtmlSub')}</span></button>
        <button onclick="presExport('complete')"><strong>${t('prExportComplete')}</strong><span>${t('prExportCompleteSub')}</span></button>
        <div class="pres-export-note">${t('prExportVideoNote')}</div>
      </div>
    </div>
    <button class="globe-close" onclick="closePresentation()">✕ ${t('pbClose')}</button>`;
}

function presSetLook(look) {
  // Full screen needs the click itself, so it's asked for before anything awaits.
  if (look === 'slides') presFullscreen(true);
  pres.look = look;
  if (pres.arrange) { pres.arrange = false; pres.rt = null; presRefresh().then(() => pres?.rt?.setLook(look)); return; }
  pres.rt.setLook(look);
  presRenderTop();
  document.getElementById('presCount').textContent = `${pres.rt.st.i + 1} / ${pres.rt.count()}`;
}
function presNext() { if (pres?.rt && !pres.arrange) pres.rt.next(); }
function presPrev() { if (pres?.rt && !pres.arrange) pres.rt.prev(); }
function presFullscreen(onlyEnter) {
  const el = document.getElementById('presMode');
  if (document.fullscreenElement) { if (!onlyEnter) document.exitFullscreen().catch(() => {}); }
  else el.requestFullscreen?.().catch(() => {});
}

function presShuffle() {
  const trip = pres.trip, book = trip.book || {};
  const captions = new Map((book.pages || []).filter(p => p.caption).map(p => [p.ids[0], p.caption]));
  trip.book = { ...book, seed: Math.floor(Math.random() * 1e9) + 1, pages: [] };
  presRefresh().then(() => {
    if (!pres) return;
    // A caption follows the photo it was written under to whichever page that photo lands on.
    pres.trip.book.pages.forEach(p => { const id = p.ids.find(x => captions.has(x)); if (id) { p.caption = captions.get(id); captions.delete(id); } });
    persistQuiet();
    presRefresh();
  });
}

// ── ARRANGE ──────────────────────────────────────────────────────────────────
function presToggleArrange() {
  pres.arrange = !pres.arrange;
  pres.swapSel = null;
  if (!pres.arrange) { pres.rt = null; presRefresh(); return; }
  presRenderTop();
  presRenderArrange();
}

function presRenderArrange() {
  const root = document.getElementById('presRoot');
  const pages = pres.trip.book.pages || [];
  const firstPhotoEl = pres.pageEls.findIndex(el => el.classList.contains('pp-photos'));
  root.innerHTML = `<div class="pres-arrange"><div class="pb-hint">${t('prArrangeHint')}</div><div class="pres-arrange-grid">${pages.map((p, k) => `
    <div class="pres-tile">
      <div class="pres-tile-page" data-tile="${k}"></div>
      <div class="pres-tile-bar">
        <button class="globe-close" onclick="presMovePage(${k},-1)" ${k ? '' : 'disabled'}>◀</button>
        <span>${t('prPageN', { n: firstPhotoEl + k + 1 })}</span>
        <button class="globe-close" onclick="presMovePage(${k},1)" ${k < pages.length - 1 ? '' : 'disabled'}>▶</button>
      </div>
    </div>`).join('')}</div></div>`;
  root.querySelectorAll('[data-tile]').forEach(el => {
    const src = pres.pageEls[firstPhotoEl + +el.dataset.tile];
    if (src) el.appendChild(src.cloneNode(true));
  });
  root.querySelectorAll('.pp-cell').forEach(cell => {
    cell.classList.toggle('pres-swap-sel', cell.dataset.id === pres.swapSel);
    cell.addEventListener('click', () => presSwapClick(cell.dataset.id));
  });
  document.getElementById('presCount').textContent = '';
}

function presSwapClick(id) {
  if (!pres.swapSel) { pres.swapSel = id; presRenderArrange(); return; }
  if (pres.swapSel === id) { pres.swapSel = null; presRenderArrange(); return; }
  const pages = pres.trip.book.pages;
  const find = x => { for (const p of pages) { const i = p.ids.indexOf(x); if (i >= 0) return [p, i]; } return null; };
  const a = find(pres.swapSel), b = find(id);
  pres.swapSel = null;
  if (a && b) { [a[0].ids[a[1]], b[0].ids[b[1]]] = [b[0].ids[b[1]], a[0].ids[a[1]]]; persistQuiet(); }
  presRefresh();
}

function presMovePage(k, dir) {
  const pages = pres.trip.book.pages;
  const j = k + dir;
  if (j < 0 || j >= pages.length) return;
  [pages[k], pages[j]] = [pages[j], pages[k]];
  persistQuiet();
  presRefresh();
}

function presToggleExportMenu(e) {
  e.stopPropagation();
  document.getElementById('presExportMenu')?.classList.toggle('open');
}

function presHandleKey(e) {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    const menu = document.getElementById('presExportMenu');
    if (menu?.classList.contains('open')) menu.classList.remove('open');
    else if (pres.arrange) presToggleArrange();
    else if (!document.fullscreenElement) closePresentation();
    return;
  }
  if (!pres.arrange && pres.rt) pres.rt.key(e);
}

// In full screen the controls get out of the way until the mouse moves.
let presIdleTimer = null;
document.addEventListener('mousemove', () => {
  if (!pres) return;
  const el = document.getElementById('presMode');
  el.classList.remove('pres-idle');
  clearTimeout(presIdleTimer);
  presIdleTimer = setTimeout(() => { if (pres && document.fullscreenElement) el.classList.add('pres-idle'); }, 2500);
});
document.addEventListener('click', e => {
  if (!e.target.closest('.pres-export-wrap')) document.getElementById('presExportMenu')?.classList.remove('open');
});

// ── EXPORT ───────────────────────────────────────────────────────────────────
// Every photo goes into the page and the PDF as a JPEG at viewing size, so both stand alone.
async function presExportImage(f) {
  const url = await photobookImageUrl(f);
  if (!url || url.startsWith('data:')) return url;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { getThumb(f).then(resolve, () => resolve(null)); }
    };
    img.onerror = () => getThumb(f).then(resolve, () => resolve(null));
    img.src = url;
  });
}

async function presExport(kind) {
  document.getElementById('presExportMenu')?.classList.remove('open');
  if (!pres?.data) return;
  const session = pres;
  const built = await presExportDocs(kind);
  if (!built || pres !== session) return;
  toast(t('prExportSaving'));
  const res = await window.api.exportPhotobook(kind, built.title, built.docs, built.videos.map(f => ({ path: f.path }))).catch(e => ({ success: false, error: e.message }));
  if (res?.success) toast(res.skipped ? t('prExportDoneSkipped', { n: res.skipped }) : t('prExportDone'), 4000);
  else if (res?.error) toast('⚠️ ' + t('prExportFailed'), 5000);
}

// The documents an export writes, for the open presentation. Video links are placeholders that
// main.js's export-photobook fills in once it knows where the videos end up.
async function presExportDocs(kind) {
  const session = pres;
  const { pages, byId } = session.data;
  const ids = new Set(pages.flatMap(p => p.type === 'photos' ? p.ids : p.type === 'cover' && p.coverId ? [p.coverId] : []));
  const images = new Map(), posters = new Map();
  let done = 0;
  for (const id of ids) {
    const f = byId.get(id);
    if (!f) continue;
    if (isVid(f.ext)) posters.set(id, await getThumb(f).catch(() => null));
    else images.set(id, await presExportImage(f));
    if (++done % 5 === 0) toast(t('prExportPreparing', { done, total: ids.size }), 1500);
    if (pres !== session) return null;
  }
  const videos = [...ids].map(id => byId.get(id)).filter(f => f && isVid(f.ext));
  const token = f => `__TROVE_VIDEO_${videos.indexOf(f)}__`;
  const poster = f => posters.get(f.id) ? ` poster="${posters.get(f.id)}"` : '';
  const title = session.data.pages[0].title || session.trip.name;
  const build = mode => {
    const ctx = {
      editable: false,
      src: f => images.get(f.id) || posters.get(f.id) || '',
      video: f => mode === 'print'
        ? `<a class="pp-video-link" href="${token(f)}">${posters.get(f.id) ? `<img src="${posters.get(f.id)}" alt="">` : ''}<span class="pp-play">▶ ${presEsc(f.name)}</span></a>`
        : mode === 'webComplete'
          ? `<video src="${token(f)}"${poster(f)} controls playsinline preload="metadata"></video>`
          : `${posters.get(f.id) ? `<img src="${posters.get(f.id)}" alt="">` : ''}<span class="pp-play">${presEsc(t('prVideoInComplete'))}</span>`,
    };
    return presDocument(mode, title, pages.map(p => presPageHtml(p, ctx, byId)));
  };
  const docs = kind === 'pdf' ? { print: build('print') }
    : kind === 'html' ? { web: build('web') }
    : { webComplete: build('webComplete'), print: build('print') };
  return { title, docs, videos };
}

// pagesHtml: one HTML string per page.
function presDocument(mode, title, pagesHtml) {
  const head = `<!doctype html><html lang="${presEsc(currentLang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${presEsc(title)}</title>`;
  if (mode === 'print') {
    // No drop shadows on paper: a CSS filter makes Chromium store each photo as raw pixels,
    // which turned a 13-photo PDF into 26 MB.
    return `${head}<style>${PRES_PAGE_CSS}
      @page{size:280mm 210mm;margin:0}html,body{margin:0;background:#fff}
      .sheet{width:280mm;height:210mm;overflow:hidden;break-after:page}.sheet:last-child{break-after:auto}
      .sheet .pp{width:280mm;height:210mm;aspect-ratio:auto}
      .pp-cell>img,.pp-cell>a>img{filter:none}</style></head>
      <body>${pagesHtml.map(p => `<section class="sheet">${p}</section>`).join('')}</body></html>`;
  }
  return `${head}<style>${PRES_PAGE_CSS}${PRES_VIEW_CSS}
    html,body{margin:0;height:100%;background:#24211d;color:#eee;font-family:system-ui,sans-serif}
    .bar{position:fixed;top:0;left:0;right:0;display:flex;gap:8px;align-items:center;padding:10px 14px;z-index:5;background:rgba(0,0,0,.35)}
    .bar button{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer}
    .bar button.on{background:rgba(255,255,255,.3)}.bar .sp{flex:1}
    #root{position:fixed;inset:52px 0 0 0}</style></head>
    <body><div class="bar"><strong>${presEsc(title)}</strong><span class="sp"></span>
      <button data-look="book" class="on">${presEsc(t('prLookBook'))}</button><button data-look="slides">${presEsc(t('prLookSlides'))}</button>
      <button id="prev">‹</button><span id="count"></span><button id="next">›</button><button id="fs">⛶</button></div>
    <div id="root"></div><div id="pages" hidden>${pagesHtml.join('\n')}</div>
    <script>${presRuntime.toString()}
    (function () {
      var pages = Array.prototype.slice.call(document.getElementById('pages').children);
      var count = document.getElementById('count');
      var rt = presRuntime(document.getElementById('root'), function () { return pages; }, {
        onDraw: function (stage, st, total) { count.textContent = (st.i + 1) + ' / ' + total; }
      });
      document.querySelectorAll('[data-look]').forEach(function (b) {
        b.onclick = function () {
          document.querySelectorAll('[data-look]').forEach(function (x) { x.classList.toggle('on', x === b); });
          rt.setLook(b.dataset.look);
        };
      });
      document.getElementById('prev').onclick = function () { rt.prev(); };
      document.getElementById('next').onclick = function () { rt.next(); };
      document.getElementById('fs').onclick = function () { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); };
      document.addEventListener('keydown', function (e) { rt.key(e); });
    })();
    </script></body></html>`;
}

// ── STYLES ───────────────────────────────────────────────────────────────────
// Shared by the app, the web page and the PDF, so all three look the same. Sizes are in
// container units (cqw) of the page, so a page reads the same at any size - except the page's
// own padding: cqw on .pp itself would measure whatever container is around the page, so that
// one is in % (of the page width, since .pp always fills its parent).
const PRES_PAGE_CSS = `
.pp{position:relative;aspect-ratio:4/3;width:100%;background:#fbf8f3;color:#2b2723;overflow:hidden;container-type:inline-size;font-family:Georgia,'Times New Roman',serif;box-sizing:border-box}
.pp *{box-sizing:border-box}
.pp-blank{background:#f4efe6}
.pp-photos{display:flex;flex-direction:column;padding:5% 5% 1%}
.pp-cells{flex:1;display:grid;gap:2.2cqw;min-height:0}
.pp-n1 .pp-cells{grid-template:1fr/1fr}
.pp-n2r .pp-cells{grid-template:1fr 1fr/1fr}
.pp-n2c .pp-cells{grid-template:1fr/1fr 1fr}
.pp-n3c .pp-cells{grid-template:1fr/1fr 1fr 1fr}
.pp-n3m .pp-cells{grid-template:1fr 1fr/1.5fr 1fr}
.pp-n3m .pp-cell:first-child{grid-row:1/3}
.pp-cell{margin:0;min-width:0;min-height:0;position:relative;display:flex;align-items:center;justify-content:center}
.pp-cell>img,.pp-cell>a>img{width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 .25cqw .6cqw rgba(0,0,0,.28))}
.pp-cell>video{max-width:100%;max-height:100%;display:block;box-shadow:0 .25cqw .6cqw rgba(0,0,0,.28)}
.pp-cell>a{display:block;width:100%;height:100%;position:relative;color:inherit;text-decoration:none}
.pp-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.6);color:#fff;font:600 1.6cqw system-ui,sans-serif;padding:.8cqw 1.6cqw;border-radius:5cqw;white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis}
.pp-cap{height:7cqw;display:flex;align-items:center;justify-content:center;font-size:1.9cqw;font-style:italic;color:#6b6259;text-align:center;outline:none;border-radius:.6cqw}
.pp-cap[contenteditable="true"]:hover,.pp-cover [contenteditable="true"]:hover{background:rgba(0,0,0,.06);cursor:text}
.pp-cover{background:#2b2723}
.pp-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pp-cover::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,.65))}
.pp-cover-text{position:absolute;left:6cqw;right:6cqw;bottom:6cqw;z-index:1;color:#fff}
.pp-cover-title{font-size:7cqw;line-height:1.05;outline:none;text-shadow:0 .2cqw 1cqw rgba(0,0,0,.4)}
.pp-cover-sub{font-size:2.2cqw;margin-top:1.4cqw;opacity:.9;outline:none;font-style:italic}
.pp-map{display:flex;flex-direction:column;padding:4%}
.pp-map-title,.pp-stats-title{font-size:3.4cqw;text-align:center;margin-bottom:1cqw}
.pp-map-svg{flex:1;min-height:0;width:100%}
.pp-route{fill:none;stroke:#b4552f;stroke-width:3;stroke-linejoin:round;stroke-linecap:round;opacity:.75}
.pp-map-svg circle{fill:#2b2723;stroke:#fbf8f3;stroke-width:3}.pp-map-svg .pp-end-dot{fill:#b4552f;stroke-width:2}
.pp-map-svg text{font:600 17px Georgia,serif;fill:#2b2723;paint-order:stroke;stroke:#fbf8f3;stroke-width:5px}
.pp-stats{display:flex;flex-direction:column;justify-content:center;padding:6%}
.pp-stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:4cqw 6cqw;margin-top:3cqw}
.pp-stat{text-align:center}.pp-stat-n{font-size:9cqw;line-height:1;color:#b4552f}.pp-stat-l{font-size:2.1cqw;margin-top:1cqw;color:#6b6259}
.pp-end{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2cqw}
.pp-end-heart{font-size:6cqw;color:#c94a5a}.pp-end-text{font-size:3cqw;font-style:italic;color:#6b6259}
`;
const PRES_VIEW_CSS = `
.pres-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;container-type:size;user-select:none}
.pres-spread{position:relative;display:flex;width:min(94cqw,calc(88cqh * 8 / 3));perspective:2600px;box-shadow:0 1.2cqw 4cqw rgba(0,0,0,.45)}
.pres-spread::after{content:'';position:absolute;top:0;bottom:0;left:calc(50% - 2.5%);width:5%;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.12) 50%,rgba(0,0,0,0));z-index:3}
.pres-page{flex:1;min-width:0}
.pres-leaf{position:absolute;top:0;width:50%;height:100%;transform-style:preserve-3d;transition:transform .75s cubic-bezier(.45,.05,.3,1);z-index:4}
.pres-leaf-r{left:50%;transform-origin:left center}
.pres-leaf-l{left:0;transform-origin:right center}
.pres-face{position:absolute;inset:0;backface-visibility:hidden}
.pres-face-back{transform:rotateY(180deg)}
.pres-slides{background:#000}
.pres-slide{width:min(100cqw,calc(100cqh * 4 / 3));animation:pres-fade .6s ease}
@keyframes pres-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.pres-slide{animation:none}}
`;

document.head.insertAdjacentHTML('beforeend', `<style id="presStyles">${PRES_PAGE_CSS}${PRES_VIEW_CSS}</style>`);
