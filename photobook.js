// ── TRIP PHOTOBOOK ───────────────────────────────────────────────────────────
// Each trip's photobook is the photos the user chose to keep from it. Picking happens in duels:
// near-identical shots of the same moment (similarShots.js, run in main.js where the CLIP
// embeddings live) meet two at a time, the winner meets the next one, and a lone shot gets a
// quick keep or skip. Nothing is ever hidden or deleted: a photo left out of the photobook is
// only shown lower and dimmed in the trip (see computeVisibleFiles in renderer.js).
//
// State lives on the files themselves, so it survives restarts and follows a photo into any view:
//   file.kept  true = in the photobook, false = left out, missing = not looked at yet
//   file.bestOf  "Liked". Liking puts a photo in its photobook (sets kept), but a photobook photo
//              is not liked. An older liked photo with no kept yet counts as in the book.
// Per-trip settings (goal, layout, captions) live on the trip folder as folder.book.
//
// Loaded before renderer.js, whose render code calls in here, and leans on the globals of
// renderer.js, semanticIndex.js and faceIndex.js (appData, t, esc, getThumb, getPreviewImage,
// embedBatchNow, semanticIndexedIds, faceStore, faceQuality...) only once they're called.

function isInPhotobook(f) { return f.kept === true || (!!f.bestOf && f.kept !== false); }
function isPhotobookDecided(f) { return f.kept === true || f.kept === false || !!f.bestOf; }
// Every Like/Unlike goes through here. Liking puts the photo in its photobook; unliking leaves
// it there, including an older liked photo that was only in the book because it was liked.
function setLiked(f, liked) {
  if (liked || (f.bestOf && f.kept == null)) f.kept = true;
  f.bestOf = !!liked;
}

// The trip's photos and videos as the photobook sees them: what the trip view shows, minus the
// files that never get a card of their own (Live Photo motion halves, originals of an edit).
function photobookTripMedia(tripId) {
  const ids = new Set([tripId, ...getAllDesc(tripId)]);
  const versionOriginals = new Set(appData.files.map(f => f.versionParentId).filter(Boolean));
  return appData.files
    .filter(f => isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo && !versionOriginals.has(f.id) && f.folders?.some(id => ids.has(id)))
    .sort((a, b) => (a.fileDate || a.addedAt || 0) - (b.fileDate || b.addedAt || 0));
}

// About one photo in ten, so a 400-photo trip asks for ~40: enough to tell the story, few
// enough that choosing means something. Small trips still get a handful. Editable per trip.
function photobookGoal(trip, mediaCount) {
  const g = trip?.book?.goal;
  return g > 0 ? g : Math.min(mediaCount, Math.max(8, Math.round(mediaCount / 10)));
}

function photobookTripOf(f) {
  for (const id of f.folders || []) { const trip = tripLikeAncestorOf(id); if (trip) return trip; }
  return null;
}

function photobookTripOfView() {
  if (!currentFolder || getSearchQuery()) return null;
  if (['all', 'timeline', 'to-sort', 'best-of', 'edited'].includes(currentFolder) || currentFolder.includes(':')) return null;
  return tripLikeAncestorOf(currentFolder);
}

// A book outline that fills from the bottom as photos are kept. Over the goal it stays full.
function photobookBookIcon(count, goal, big) {
  const fill = goal > 0 ? Math.min(1, count / goal) : 0;
  return `<span class="pb-book${big ? ' pb-book-big' : ''}${count >= goal && goal > 0 ? ' pb-book-full' : ''}" style="--fill:${fill.toFixed(3)}" aria-hidden="true"><span class="pb-book-fill"></span></span>`;
}

// Banner on top of a trip (and its legs): what the photobook is, how full it is, and the way in.
function appendTripBookBanner(area) {
  const trip = photobookTripOfView();
  if (!trip) return;
  const media = photobookTripMedia(trip.id);
  if (media.length < 2) return;
  const kept = media.filter(isInPhotobook).length;
  const toLook = media.filter(f => !isPhotobookDecided(f)).length;
  const goal = photobookGoal(trip, media.length);
  const banner = document.createElement('div');
  banner.className = 'pb-banner';
  if (!kept) {
    banner.innerHTML = `${photobookBookIcon(0, goal)}
      <div class="pb-banner-text"><strong>${t('pbBannerStartTitle')}</strong><span>${t('pbBannerStartBody', { goal, n: media.length })}</span></div>
      <button class="pb-btn pb-btn-primary" onclick="openPhotobook('${trip.id}')">${t('pbStartPicking')}</button>`;
  } else {
    banner.innerHTML = `${photobookBookIcon(kept, goal)}
      <div class="pb-banner-text"><strong>${t('pbBannerCount', { kept, goal })}</strong><span>${toLook ? t('pbBannerToLook', { n: toLook }) : t('pbBannerAllSeen')}</span></div>
      ${toLook ? `<button class="pb-btn pb-btn-primary" onclick="openPhotobook('${trip.id}')">${t('pbKeepPicking')}</button>` : `<button class="pb-btn" onclick="openPhotobook('${trip.id}', 'groups')">${t('pbSeeGroups')}</button>`}
      <button class="pb-btn${toLook ? '' : ' pb-btn-primary'}" onclick="openPresentation('${trip.id}')">${t('pbPresent')}</button>`;
  }
  area.appendChild(banner);
}

// The "Not in your photobook" line between the kept photos and the rest of a trip, added while
// cards are appended in pages (see appendGridCards/appendListRows), like the Sort by Type headers.
function maybeAppendBookDivider(file, container) {
  if (!photobookView || container.dataset.bookDivider || isInPhotobook(file)) return;
  container.dataset.bookDivider = '1';
  const div = document.createElement('div');
  div.className = 'book-divider';
  div.innerHTML = `<span>${t('pbNotInBook')}</span><span class="book-divider-count">${photobookView.outCount}</span>`;
  container.appendChild(div);
}

// Context menu and selection bar: put photos in or take them out of their trip's photobook by hand.
function setPhotobookMembership(ids, inBook) {
  ids.forEach(id => { const f = appData.files.find(x => x.id === id); if (f) f.kept = !!inBook; });
  saveData();
  toast(inBook ? t('pbAddedN', { n: ids.length }) : t('pbRemovedN', { n: ids.length }));
}

// ── DUELS ────────────────────────────────────────────────────────────────────
let pb = null;              // the open photobook session, or null
let pbEmbedRun = 0;         // bumped to orphan a background embedding pass when a session closes

const PB_STRICTNESS = { tighter: 0.03, normal: 0, looser: -0.03 };
function pbStrictnessKey() { return appData.settings?.similarShots in PB_STRICTNESS ? appData.settings.similarShots : 'normal'; }

async function openPhotobook(tripId, tab) {
  const trip = appData.folders.find(f => f.id === tripId);
  if (!trip) return;
  const media = photobookTripMedia(tripId);
  if (!media.length) { toast(t('pbNoMedia')); return; }
  pb = {
    tripId, tab: tab === 'groups' ? 'groups' : 'pick',
    media, byId: new Map(media.map(f => [f.id, f])),
    tasks: [], champion: null, laterKeys: new Set(), focusKey: null, undo: [],
    embed: { done: 0, total: 0, finished: false },
    duelToken: 0, celebrated: media.some(isPhotobookDecided) && !media.some(f => !isPhotobookDecided(f)),
  };
  // Opens on the first duel still to decide, not on whatever single shot happens to come first;
  // the rest follows in date order from there (see pbRegroup and pbCurrentTask).
  pb.startT = null;
  document.getElementById('bookMode').classList.add('open');
  pbRenderTop();
  pbBody(`<div class="pb-wait">${t('pbFinding')}</div>`);
  pbStartEmbedding();
  await pbRegroup();
  pbRender();
}

function closePhotobook() {
  if (!pb) return;
  pb = null;
  pbEmbedRun++;
  document.getElementById('bookMode').classList.remove('open');
  saveData(); // redraws the trip underneath with the new order
}

// Photos that aren't embedded yet (a trip added a minute ago) are analyzed right away, oldest
// first, so duels can start on the early part of the trip while the rest catches up.
function pbStartEmbedding() {
  const run = ++pbEmbedRun;
  const todo = pb.media.filter(f => isImg(f.ext) && !semanticIndexedIds.has(f.id));
  pb.embed = { done: 0, total: todo.length, finished: !todo.length };
  if (!todo.length) return;
  let lastRegroup = 0;
  embedBatchNow(todo, done => {
    if (run !== pbEmbedRun || !pb) return;
    pb.embed.done = done;
    if (pb.tab !== 'pick' || pbCurrentTask() !== null) { pbRenderTop(); return; }
    // Waiting on the next stretch of the trip: regroup every few photos, count up in between.
    if (done - lastRegroup >= 8) { lastRegroup = done; pbRegroup().then(() => pb && pbRender()); }
    else pbRender();
  }).then(() => {
    if (run !== pbEmbedRun || !pb) return;
    pb.embed.finished = true;
    pbRegroup().then(() => pb && pbRender());
  });
}

// Tasks are the trip's groups of similar shots plus everything else as groups of one, in
// capture order. While embedding is still running, only the stretch before the first photo not
// analyzed yet is grouped (minus the grouping's own time window, so a group isn't cut in half).
async function pbRegroup() {
  const session = pb;
  const photos = session.media.filter(f => isImg(f.ext) && f.fileDate);
  let frontier = Infinity;
  if (!session.embed.finished) {
    const pending = photos.find(f => !semanticIndexedIds.has(f.id));
    if (pending) frontier = pending.fileDate - 10 * 60 * 1000;
  }
  const ready = photos.filter(f => f.fileDate < frontier);
  const groups = ready.length
    ? await window.api.groupSimilarShots(ready.map(f => ({ id: f.id, t: f.fileDate })), PB_STRICTNESS[pbStrictnessKey()]).catch(() => ready.map(f => [f.id]))
    : [];
  if (pb !== session) return;
  const grouped = new Set(groups.flat());
  const others = session.media.filter(f => !grouped.has(f.id) && (session.embed.finished || !f.fileDate || f.fileDate < frontier));
  const timeOf = id => session.byId.get(id)?.fileDate || session.byId.get(id)?.addedAt || 0;
  session.tasks = [...groups, ...others.map(f => [f.id])]
    .map(ids => ({ key: ids[0], ids, t: timeOf(ids[0]) }))
    .sort((a, b) => a.t - b.t);
  if (session.startT === null) {
    const firstDuel = session.tasks.find(task => task.ids.length > 1 && task.ids.some(id => !isPhotobookDecided(session.byId.get(id))));
    if (firstDuel) session.startT = firstDuel.t;
    else if (session.embed.finished) session.startT = 0;
  }
}

// What the current task asks of the user: { task, a, b } for a duel, { task, a } for a single.
function pbCurrentTask() {
  if (pb.startT === null) return null; // still waiting for the first duel to be found (see pbRegroup)
  const order = pb.tasks.slice().sort((x, y) => {
    if (pb.focusKey) { if (x.key === pb.focusKey) return -1; if (y.key === pb.focusKey) return 1; }
    const s = pb.startT || 0;
    return ((x.t >= s ? 0 : 1) - (y.t >= s ? 0 : 1)) || (x.t - y.t);
  });
  for (const task of order) {
    if (pb.laterKeys.has(task.key)) continue;
    const files = task.ids.map(id => pb.byId.get(id)).filter(Boolean);
    const open = files.filter(f => !isPhotobookDecided(f));
    if (!open.length) continue;
    const kept = files.filter(isInPhotobook);
    const champ = (pb.champion && kept.find(f => f.id === pb.champion)) || kept[0] || null;
    if (champ) return { task, a: champ, b: open[0] };
    if (open.length >= 2) return { task, a: open[0], b: open[1] };
    return { task, a: open[0] };
  }
  if (pb.focusKey) { pb.focusKey = null; return pbCurrentTask(); }
  return null;
}

function pbSnapshot(files) {
  pb.undo.push({ files: files.map(f => ({ f, kept: f.kept })), champion: pb.champion, laterKeys: new Set(pb.laterKeys) });
  if (pb.undo.length > 200) pb.undo.shift();
}
function pbSetKept(f, kept) { if (kept === undefined) delete f.kept; else f.kept = kept; }

function pbUndo() {
  const last = pb?.undo.pop();
  if (!last) return;
  last.files.forEach(({ f, kept }) => pbSetKept(f, kept));
  pb.champion = last.champion;
  pb.laterKeys = last.laterKeys;
  persistQuiet();
  pbRender();
}

// The winner stays (or gets) in the book and meets the next shot; the loser is left out, unless
// it's a Liked photo, which always keeps its place.
function pbPick(side) {
  const cur = pbCurrentTask();
  if (!cur?.b) return;
  const winner = side === 'a' ? cur.a : cur.b, loser = side === 'a' ? cur.b : cur.a;
  pbSnapshot([winner, loser]);
  winner.kept = true;
  if (!loser.bestOf) loser.kept = false;
  pb.champion = winner.id;
  pbAfterAction();
}
function pbKeepBoth() {
  const cur = pbCurrentTask();
  if (!cur?.b) return;
  pbSnapshot([cur.a, cur.b]);
  cur.a.kept = true; cur.b.kept = true;
  pb.champion = cur.a.id;
  pbAfterAction();
}
function pbSingle(keep) {
  const cur = pbCurrentTask();
  if (!cur || cur.b) return;
  pbSnapshot([cur.a]);
  cur.a.kept = !!keep;
  pbAfterAction();
}
function pbLater() {
  const cur = pbCurrentTask();
  if (!cur) return;
  pbSnapshot([]);
  pb.laterKeys.add(cur.task.key);
  pbAfterAction();
}
function pbAfterAction() {
  persistQuiet();
  pbRender();
}

function pbStats() {
  const kept = pb.media.filter(isInPhotobook).length;
  const trip = appData.folders.find(f => f.id === pb.tripId);
  return { kept, goal: photobookGoal(trip, pb.media.length), toLook: pb.media.filter(f => !isPhotobookDecided(f)).length, trip };
}

function pbRenderTop() {
  if (!pb) return;
  const { kept, goal, trip } = pbStats();
  const embedding = !pb.embed.finished && pb.embed.total
    ? `<span class="pb-embed">${t('pbAnalyzing', { done: pb.embed.done, total: pb.embed.total })}</span>` : '';
  document.getElementById('bookModeTop').innerHTML = `
    <span class="sort-title">📖 ${esc(trip?.name || '')}</span>
    <button class="pb-goal" onclick="pbEditGoal()" title="${esc(t('pbGoalEditTitle'))}">${photobookBookIcon(kept, goal)}<span>${t('pbGoalCount', { kept, goal })}</span></button>
    ${embedding}
    <span style="flex:1"></span>
    <div class="pb-tabs">
      <button class="pb-tab${pb.tab === 'pick' ? ' active' : ''}" onclick="pbSetTab('pick')">${t('pbTabPick')}</button>
      <button class="pb-tab${pb.tab === 'groups' ? ' active' : ''}" onclick="pbSetTab('groups')">${t('pbTabGroups')}</button>
    </div>
    <button class="globe-close" onclick="pbUndo()" ${pb.undo.length ? '' : 'disabled'} title="${esc(t('pbUndoTitle'))}">↶ ${t('pbUndo')}</button>
    <button class="globe-close" onclick="openPresentation('${pb.tripId}')">${t('pbPresent')}</button>
    <button class="globe-close" onclick="closePhotobook()">✕ ${t('pbClose')}</button>`;
}

function pbSetTab(tab) { pb.tab = tab; pbRender(); }

function pbEditGoal() {
  const { goal, trip } = pbStats();
  const el = document.querySelector('#bookModeTop .pb-goal span');
  if (!el || !trip) return;
  el.innerHTML = `<input type="number" min="1" max="${pb.media.length}" value="${goal}" class="pb-goal-input">`;
  const input = el.querySelector('input');
  input.focus(); input.select();
  const done = save => {
    const v = parseInt(input.value, 10);
    if (save && v > 0) { trip.book = { ...(trip.book || {}), goal: v }; persistQuiet(); }
    pbRenderTop();
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  input.addEventListener('blur', () => done(true), { once: true });
  input.addEventListener('click', e => e.stopPropagation());
}

function pbBody(html) { document.getElementById('bookModeBody').innerHTML = html; }

function pbRender() {
  if (!pb) return;
  pbRenderTop();
  if (pb.tab === 'groups') { pbRenderGroups(); return; }
  const cur = pbCurrentTask();
  if (!cur) {
    if (!pb.embed.finished) { pbBody(`<div class="pb-wait">${t('pbWaiting', { done: pb.embed.done, total: pb.embed.total })}</div>`); return; }
    pbRenderDone();
    return;
  }
  const token = ++pb.duelToken;
  const files = cur.task.ids.map(id => pb.byId.get(id)).filter(Boolean);
  const progress = cur.task.ids.length > 1
    ? t('pbGroupProgress', { n: new Set([...files.filter(isPhotobookDecided).map(f => f.id), cur.a.id, cur.b?.id].filter(Boolean)).size, total: files.length })
    : t('pbSingleShot');
  if (cur.b) {
    pbBody(`
      <div class="pb-hint">${t('pbDuelHint')}<span class="pb-progress">${progress}</span></div>
      <div class="pb-duel">
        ${pbCardHtml(cur.a, 'a')}
        <div class="pb-vs">${t('pbVs')}</div>
        ${pbCardHtml(cur.b, 'b')}
      </div>
      <div class="pb-actions">
        <button class="pb-btn" onclick="pbPick('a')">← ${t('pbLeftBetter')}</button>
        <button class="pb-btn" onclick="pbKeepBoth()" title="${esc(t('pbKeepBothTitle'))}">↓ ${t('pbKeepBoth')}</button>
        <button class="pb-btn" onclick="pbPick('b')">${t('pbRightBetter')} →</button>
      </div>
      <div class="pb-actions pb-actions-quiet"><button class="pb-link" onclick="pbLater()">${t('pbLater')}</button></div>`);
    pbLoadMedia(cur.a, 'a', token);
    pbLoadMedia(cur.b, 'b', token);
    pbTrovesPick(cur.a, cur.b, token);
  } else {
    pbBody(`
      <div class="pb-hint">${t('pbSingleHint')}<span class="pb-progress">${progress}</span></div>
      <div class="pb-duel pb-single">${pbCardHtml(cur.a, 'a')}</div>
      <div class="pb-actions">
        <button class="pb-btn" onclick="pbSingle(false)">← ${t('pbSkip')}</button>
        <button class="pb-btn pb-btn-primary" onclick="pbSingle(true)">${t('pbKeep')} →</button>
      </div>`);
    pbLoadMedia(cur.a, 'a', token);
  }
  pbPrefetchNext(cur);
}

function pbCardHtml(file, side) {
  const click = pb && pbCurrentTask()?.b ? `pbPick('${side}')` : 'pbSingle(true)';
  return `<div class="pb-card" data-side="${side}" onclick="${click}">
    <div class="pb-media" id="pbMedia-${side}"></div>
    <div class="pb-card-meta">${esc(fmtDate(file.fileDate || file.addedAt))} · ${esc(fmtTime(file.fileDate || file.addedAt))}${file.bestOf ? ' · <span class="pb-liked">❤</span>' : ''}</div>
  </div>`;
}

// The sharp version where one exists (the same one the photo viewer shows), else the thumbnail.
async function photobookImageUrl(file) {
  if (isImg(file.ext)) {
    let url = await getPreviewImage(file).catch(() => null);
    if (!url && !file.edits && TroveMedia.BROWSER_IMAGE.has((file.ext || '').toLowerCase())) url = pathToFileUrl(file.path);
    if (url) return url;
  }
  return getThumb(file).catch(() => null);
}

async function pbLoadMedia(file, side, token) {
  const box = document.getElementById(`pbMedia-${side}`);
  if (!box) return;
  if (isVid(file.ext)) {
    const poster = await getThumb(file).catch(() => null);
    if (!pb || pb.duelToken !== token) return;
    box.innerHTML = `<video src="${pathToFileUrl(file.path)}" ${poster ? `poster="${poster}"` : ''} muted autoplay loop playsinline controls onclick="event.stopPropagation()"></video>`;
    return;
  }
  const thumb = await getThumb(file).catch(() => null);
  if (!pb || pb.duelToken !== token) return;
  if (thumb) box.innerHTML = `<img src="${thumb}" alt="">`;
  const url = await photobookImageUrl(file);
  if (!pb || pb.duelToken !== token || !url || url === thumb) return;
  box.innerHTML = `<img src="${url}" alt="">`;
}

function pbPrefetchNext(cur) {
  const next = pb.tasks.find(task => task.t > cur.task.t && task.ids.some(id => !isPhotobookDecided(pb.byId.get(id) || {})));
  const ids = [...(cur.b ? cur.task.ids.filter(id => id !== cur.a.id && id !== cur.b.id).slice(0, 1) : []), ...(next ? next.ids.slice(0, 2) : [])];
  ids.forEach(id => { const f = pb.byId.get(id); if (f && isImg(f.ext)) photobookImageUrl(f); });
}

// ── TROVE'S PICK ─────────────────────────────────────────────────────────────
// A modest hint, never a decision: the shot that looks clearly sharper, or where faces look
// better (eyes open, facing the camera - faceIndex.js's faceQuality, when People is switched
// on). No badge at all when the two are too close to call, which is most of the time.
const pbSharpCache = new Map();
async function pbSharpness(file) {
  if (pbSharpCache.has(file.id)) return pbSharpCache.get(file.id);
  const url = await photobookImageUrl(file);
  const value = url ? await new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(3, Math.round(img.naturalWidth * k)), h = Math.max(3, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const g = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        // Variance of the Laplacian: blur and camera shake flatten edges, which lowers it.
        let sum = 0, sq = 0, n = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
          sum += v; sq += v * v; n++;
        }
        resolve(n ? sq / n - (sum / n) ** 2 : null);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }) : null;
  pbSharpCache.set(file.id, value);
  return value;
}

function pbFaceScore(file) {
  if (typeof faceStore === 'undefined' || !faceStore?.scanned?.[file.id] || typeof faceQuality !== 'function') return null;
  return faceStore.faces.filter(fc => fc.f === file.id).reduce((s, fc) => s + faceQuality(fc), 0);
}

async function pbTrovesPick(a, b, token) {
  if (!isImg(a.ext) || !isImg(b.ext)) return;
  let side = null, why = '';
  const fa = pbFaceScore(a), fb = pbFaceScore(b);
  if (fa != null && fb != null && Math.max(fa, fb) > 0 && Math.abs(fa - fb) >= 0.6) {
    side = fa > fb ? 'a' : 'b'; why = t('pbPickWhyFaces');
  } else {
    const [sa, sb] = await Promise.all([pbSharpness(a), pbSharpness(b)]);
    if (sa && sb && Math.max(sa, sb) / Math.min(sa, sb) >= 1.35) { side = sa > sb ? 'a' : 'b'; why = t('pbPickWhySharper'); }
  }
  if (!side || !pb || pb.duelToken !== token) return;
  const card = document.querySelector(`#bookModeBody .pb-card[data-side="${side}"]`);
  if (card) card.insertAdjacentHTML('beforeend', `<div class="pb-pick" title="${esc(why)}">✨ ${t('pbTrovesPick')}</div>`);
}

// ── DONE ─────────────────────────────────────────────────────────────────────
function pbRenderDone() {
  const { kept, goal } = pbStats();
  const skipped = pb.laterKeys.size;
  pbBody(`<div class="pb-done">
    ${photobookBookIcon(kept, goal, true)}
    <div class="pb-done-title">${t('pbDoneTitle')}</div>
    <div class="pb-done-sub">${t('pbDoneBody', { kept, n: pb.media.length })}${skipped ? ' ' + t('pbDoneLater', { n: skipped }) : ''}</div>
    <div class="pb-actions">
      ${skipped ? `<button class="pb-btn" onclick="pb.laterKeys.clear();pbRender()">${t('pbDoneBackToLater')}</button>` : ''}
      <button class="pb-btn" onclick="closePhotobook()">${t('pbBackToTrip')}</button>
      <button class="pb-btn pb-btn-primary" onclick="openPresentation('${pb.tripId}')">${t('pbPresent')}</button>
    </div>
  </div>`);
  if (!pb.celebrated) { pb.celebrated = true; photobookConfetti(document.getElementById('bookMode')); }
}

// Same burst as the first-run wizard's (frShowDoneConfetti), in whichever overlay is showing.
function photobookConfetti(host) {
  if (!host || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'fr-confetti pb-confetti';
  for (let i = 0; i < 70; i++) {
    const piece = document.createElement('div');
    piece.className = 'fr-confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    el.appendChild(piece);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── GROUPS OVERVIEW ──────────────────────────────────────────────────────────
// Every group of similar shots Trove found in the trip, so the grouping itself can be judged
// (and loosened or tightened) right here, and any group picked again.
function pbRenderGroups() {
  const multi = pb.tasks.filter(task => task.ids.length > 1);
  const singles = pb.tasks.length - multi.length;
  const key = pbStrictnessKey();
  const opt = (k, label) => `<button class="pb-tab${key === k ? ' active' : ''}" onclick="pbSetStrictness('${k}')">${label}</button>`;
  const rows = multi.map(task => {
    const files = task.ids.map(id => pb.byId.get(id)).filter(Boolean);
    const span = files.length > 1 ? (files[files.length - 1].fileDate - files[0].fileDate) : 0;
    const open = files.some(f => !isPhotobookDecided(f));
    return `<div class="pb-group">
      <div class="pb-group-head">
        <span>${t('pbGroupMeta', { n: files.length, span: span < 60000 ? t('pbSeconds', { n: Math.max(1, Math.round(span / 1000)) }) : t('pbMinutes', { n: Math.round(span / 60000) }) })} · ${esc(fmtDate(files[0].fileDate))} ${esc(fmtTime(files[0].fileDate))}</span>
        <button class="pb-link" onclick="pbPickGroup('${task.key}')">${open ? t('pbPickThisGroup') : t('pbPickAgain')}</button>
      </div>
      <div class="pb-group-strip">${files.map(f => `<div class="pb-thumb${isPhotobookDecided(f) && !isInPhotobook(f) ? ' out' : ''}" data-thumb-id="${f.id}" title="${esc(f.name)}">${isInPhotobook(f) ? '<span class="pb-thumb-in">📖</span>' : ''}</div>`).join('')}</div>
    </div>`;
  }).join('');
  pbBody(`<div class="pb-groups">
    <div class="pb-groups-head">
      <div><strong>${t('pbGroupsTitle', { n: multi.length })}</strong><div class="pb-done-sub">${t('pbGroupsSub', { inGroups: multi.reduce((n, task) => n + task.ids.length, 0), singles })}</div></div>
      <div class="pb-tabs" title="${esc(t('pbStrictnessTitle'))}">${opt('looser', t('pbLooser'))}${opt('normal', t('pbNormal'))}${opt('tighter', t('pbTighter'))}</div>
    </div>
    ${!pb.embed.finished ? `<div class="pb-wait" style="padding:8px 0">${t('pbAnalyzing', { done: pb.embed.done, total: pb.embed.total })}</div>` : ''}
    ${rows || `<div class="pb-wait">${t('pbNoGroups')}</div>`}
  </div>`);
  document.querySelectorAll('#bookModeBody .pb-thumb').forEach(el => {
    const f = pb.byId.get(el.dataset.thumbId);
    if (f) getThumb(f).then(url => { if (url && el.isConnected) el.style.backgroundImage = `url("${url}")`; });
  });
}

async function pbSetStrictness(key) {
  if (!appData.settings) appData.settings = {};
  appData.settings.similarShots = key;
  persistQuiet();
  await pbRegroup();
  pbRender();
}

// Jumps to one group; one already decided is opened again from scratch (Liked photos stay in).
function pbPickGroup(key) {
  const task = pb.tasks.find(x => x.key === key);
  if (!task) return;
  const files = task.ids.map(id => pb.byId.get(id)).filter(Boolean);
  if (!files.some(f => !isPhotobookDecided(f))) {
    pbSnapshot(files);
    files.forEach(f => { if (!f.bestOf) delete f.kept; });
    persistQuiet();
  }
  pb.laterKeys.delete(key);
  pb.focusKey = key;
  pb.champion = null;
  pb.tab = 'pick';
  pbRender();
}

function pbHandleKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') { e.preventDefault(); if (typing) document.activeElement.blur(); else closePhotobook(); return; }
  if (typing || e.altKey) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); pbUndo(); return; }
  if (e.ctrlKey || e.metaKey || pb.tab !== 'pick') return;
  const cur = pbCurrentTask();
  if (!cur) return;
  if (e.key === 'Backspace') { e.preventDefault(); pbUndo(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); cur.b ? pbPick('a') : pbSingle(false); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); cur.b ? pbPick('b') : pbSingle(true); }
  else if (e.key === 'ArrowDown' && cur.b) { e.preventDefault(); pbKeepBoth(); }
}

// ── FIRST MINUTE ─────────────────────────────────────────────────────────────
// The first-run wizard's last step offers this straight away: the trip just added with the most
// photos (the likeliest to hold a few near-identical shots) goes into its first duel.
function photobookBestTrip(tripIds) {
  return tripIds
    .map(id => ({ id, n: photobookTripMedia(id).length }))
    .filter(x => x.n >= 2)
    .sort((a, b) => b.n - a.n)[0]?.id || null;
}
