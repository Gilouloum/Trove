// ── FLICK THROUGH ────────────────────────────────────────────────────────────
// Going through a trip (or any folder) one file at a time, full screen, without ever having to aim
// the mouse: scroll (or arrow keys / Space) moves on, a double-click (or L) likes, and a swipe to
// either side (drag the photo, swipe sideways on a trackpad, or Delete) sends it to the Bin
// (bin.js), where it waits 30 days. Ctrl+Z undoes the last like or swipe. Where you stopped is
// remembered per folder, so a big trip can take several sittings.
//
// Liked is the one list that matters: the files someone never wants to lose, silly ones
// included. In a folder they come first, above an "Everything else" line (computeVisibleFiles
// in renderer.js), and "Select liked" picks them all so they can be dragged into a photobook
// app or a folder in one go.
//
// Loaded before renderer.js, whose render code calls in here; reads the globals of renderer.js,
// bin.js and rewards.js only when called.

// Every Like/Unlike goes through here. XP (rewards.js) pays once per file, however often it flips.
function setLiked(f, liked) {
  f.bestOf = !!liked;
  const receipt = rewardsBegin();
  if (liked && rewardsClaim(receipt, 'liked', f.id)) rewardsAdd(receipt, 'like');
  rewardsCommit(receipt, { quiet: true });
  if (liked) setTimeout(() => rewardsCheckBadges(), 0); // after the whole batch is liked
  return receipt;
}

// The folder (or To Sort) the grid is showing, if it's one Flick through can run on.
function flickViewScope() {
  if (!currentFolder || getSearchQuery()) return null;
  if (currentFolder === 'to-sort') return currentFolder;
  if (['all', 'timeline', 'best-of', 'edited', 'bin'].includes(currentFolder) || currentFolder.includes(':')) return null;
  return appData.folders.some(f => f.id === currentFolder) ? currentFolder : null;
}

function flickScopeName(scopeId) {
  if (scopeId === 'to-sort') return 'To Sort';
  return appData.folders.find(f => f.id === scopeId)?.name || '';
}

// What Flick through goes through, oldest first: every photo and video in the folder and the
// folders inside it, minus what never gets a card of its own (Live Photo motion halves,
// originals hidden behind their edited version).
function flickScopeFiles(scopeId) {
  const versionOriginals = new Set(appData.files.map(f => f.versionParentId).filter(Boolean));
  let pool = appData.files.filter(f => isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo && !versionOriginals.has(f.id));
  if (scopeId === 'to-sort') pool = pool.filter(f => f.toSort);
  else {
    const ids = new Set([scopeId, ...getAllDesc(scopeId)]);
    pool = pool.filter(f => f.folders?.some(id => ids.has(id)));
  }
  return pool.sort((a, b) => (a.fileDate || a.addedAt || 0) - (b.fileDate || b.addedAt || 0));
}

// ── IN THE GRID ──────────────────────────────────────────────────────────────
function appendFlickBanner(area) {
  const scope = flickViewScope();
  if (!scope) return;
  const files = flickScopeFiles(scope);
  if (files.length < 2) return;
  const liked = files.filter(f => f.bestOf).length;
  const pos = files.findIndex(f => f.id === appData.flickPos?.[scope]);
  const banner = document.createElement('div');
  banner.className = 'fl-banner';
  banner.innerHTML = `<span class="fl-banner-heart">❤</span>
    <div class="fl-banner-text"><strong>${t('flBannerLiked', { liked, n: files.length, pct: Math.round(liked / files.length * 100) })}</strong>
      <span>${pos > 0 ? t('flBannerResume', { i: pos + 1, n: files.length }) : t('flBannerHow')}</span></div>
    ${liked ? `<button class="fl-btn" onclick="flickSelectLiked('${scope}')">${t('flSelectLiked')}</button>` : ''}
    <button class="fl-btn fl-btn-primary" onclick="openFlick('${scope}')">▶ ${pos > 0 ? t('flContinue') : t('flStart')}</button>`;
  area.appendChild(banner);
}

// The line between the liked files and the rest, added while cards are appended in pages (see
// appendGridCards/appendListRows), like the Sort by Type headers.
function maybeAppendLikedDivider(file, container) {
  if (!likedView || container.dataset.likedDivider || file.bestOf) return;
  container.dataset.likedDivider = '1';
  const div = document.createElement('div');
  div.className = 'liked-divider';
  div.innerHTML = `<span>${t('flEverythingElse')}</span><span class="liked-divider-count">${likedView.restCount}</span>`;
  container.appendChild(div);
}

// Selects the liked files of a folder in the grid, ready to drag into a photobook app or a folder.
function flickSelectLiked(scope) {
  if (currentFolder !== scope) selectFolder(scope);
  const liked = getVisibleFiles().filter(f => f.bestOf);
  clearSelection();
  liked.forEach(f => {
    selectedIds.add(f.id);
    burstCoverMap.get(f.id)?.memberIds.forEach(m => { if (appData.files.find(x => x.id === m)?.bestOf) selectedIds.add(m); });
  });
  updateSelectionUI();
  toast(t('flSelectedLiked', { n: selectedIds.size }), 5000);
}

// ── THE MODE ─────────────────────────────────────────────────────────────────
let fl = null; // the open session, or null

function openFlick(scopeId) {
  const files = flickScopeFiles(scopeId);
  if (!files.length) { toast(t('flNothing')); return; }
  const saved = files.findIndex(f => f.id === appData.flickPos?.[scopeId]);
  fl = { scopeId, files, i: Math.max(0, saved), undo: [], binned: 0, wheel: { accY: 0, accX: 0, last: 0, step: 0 }, drag: null, token: 0, done: false };
  document.getElementById('flickMode').classList.add('open');
  document.getElementById('flickTitle').textContent = flickScopeName(scopeId);
  document.getElementById('flickHint').textContent = t('flHint');
  if (saved > 0) toast(t('flResumed', { i: saved + 1, n: files.length }), 3500);
  flickShow(0);
}

function closeFlick() {
  if (!fl) return;
  fl = null;
  document.getElementById('flickMode').classList.remove('open');
  document.getElementById('flickStage').innerHTML = '';
  saveData();
  if (typeof onFlickClosed === 'function') onFlickClosed();
}

function flickLikedCount() { return fl.files.filter(f => f.bestOf).length; }

function flickRenderTop() {
  const n = fl.files.length;
  document.getElementById('flickProgress').innerHTML = `${Math.min(fl.i + 1, n)} / ${n} · <span class="fl-liked-count">❤ ${flickLikedCount()}</span>${fl.binned ? ` · 🗑 ${fl.binned}` : ''}`;
  document.getElementById('flickUndoBtn').disabled = !fl.undo.length;
  document.getElementById('flickBar').style.width = (n ? Math.min(1, (fl.i + 1) / n) * 100 : 0) + '%';
}

// dir: 1 coming from below (moving on), -1 from above (going back), 0 no movement.
function flickShow(dir) {
  const stage = document.getElementById('flickStage');
  if (fl.i >= fl.files.length) { flickRenderDone(); return; }
  fl.done = false;
  const file = fl.files[fl.i];
  const token = ++fl.token;
  appData.flickPos = { ...(appData.flickPos || {}), [fl.scopeId]: file.id };
  const place = file.city || file.region || file.country || '';
  stage.innerHTML = `<div class="fl-card${dir > 0 ? ' fl-enter-up' : dir < 0 ? ' fl-enter-down' : ''}" id="flickCard">
      <div class="fl-media-wrap"><div class="fl-media" id="flickMedia"></div>
      <div class="fl-heart-badge${file.bestOf ? ' on' : ''}" id="flickHeartBadge" onclick="flickToggleLike()" title="${esc(t('flLikeTitle'))}">❤</div></div>
      <div class="fl-bin-label" id="flickBinLabel">🗑 ${esc(t('flToBin'))}</div>
    </div>
    <div class="fl-meta">${esc(fmtDate(file.fileDate || file.addedAt))}${place ? ' · ' + esc(place) : ''} · ${esc(file.name)}</div>`;
  flickLoadMedia(file, token);
  flickRenderTop();
  flickPrefetch();
  // A first look at a file is worth a point (quietly: no pop for every scroll).
  const receipt = rewardsBegin();
  if (rewardsClaim(receipt, 'seen', file.id)) rewardsAdd(receipt, 'seen');
  rewardsCommit(receipt, { quiet: true });
}

async function flickLoadMedia(file, token) {
  const box = document.getElementById('flickMedia');
  if (!box) return;
  if (isVid(file.ext)) {
    const poster = await getThumb(file).catch(() => null);
    if (!fl || fl.token !== token) return;
    box.innerHTML = `<video src="${pathToFileUrl(file.path)}" ${poster ? `poster="${poster}"` : ''} autoplay controls playsinline></video>`;
    return;
  }
  const thumb = await getThumb(file).catch(() => null);
  if (!fl || fl.token !== token) return;
  if (thumb) box.innerHTML = `<img src="${thumb}" alt="" draggable="false">`;
  const url = await flickImageUrl(file);
  if (!fl || fl.token !== token || !url || url === thumb) return;
  box.innerHTML = `<img src="${url}" alt="" draggable="false">`;
}

// The sharp version where one exists (what the photo viewer shows), else the thumbnail.
async function flickImageUrl(file) {
  if (isImg(file.ext)) {
    let url = await getPreviewImage(file).catch(() => null);
    if (!url && !file.edits && TroveMedia.BROWSER_IMAGE.has((file.ext || '').toLowerCase())) url = pathToFileUrl(file.path);
    if (url) return url;
  }
  return getThumb(file).catch(() => null);
}
function flickPrefetch() {
  fl.files.slice(fl.i + 1, fl.i + 3).forEach(f => { if (isImg(f.ext)) flickImageUrl(f); });
}

function flickNext() {
  if (!fl || fl.i >= fl.files.length) return;
  fl.i++;
  flickShow(1);
}
function flickPrev() {
  if (!fl || fl.i <= 0) return;
  fl.i = Math.min(fl.i, fl.files.length) - 1;
  flickShow(-1);
}
function flickGo(i) {
  if (!fl) return;
  fl.i = Math.max(0, Math.min(i, fl.files.length - 1));
  flickShow(0);
}

function flickToggleLike() {
  const file = fl?.files[fl.i];
  if (!file) return;
  const prev = !!file.bestOf;
  const receipt = setLiked(file, !prev);
  fl.undo.push({ type: 'like', file, prev, receipt });
  document.getElementById('flickHeartBadge')?.classList.toggle('on', !prev);
  if (!prev) {
    sfxPlay('pop');
    if (receipt.xp) rewardsFloat(`+${receipt.xp} XP`);
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const pop = document.createElement('div');
      pop.className = 'fl-heart-pop';
      pop.textContent = '❤';
      document.getElementById('flickCard')?.appendChild(pop);
      setTimeout(() => pop.remove(), 900);
    }
  }
  persistQuiet();
  flickRenderTop();
}

// dir: -1 left, 1 right. The card flies off that side, then the next file slides in.
function flickBin(dir) {
  const file = fl?.files[fl.i];
  if (!file || fl.flying) return;
  fl.flying = true;
  const card = document.getElementById('flickCard');
  const finish = () => {
    if (!fl) return;
    fl.flying = false;
    const index = fl.i;
    const { moved, receipt } = binAndReward([file.id]);
    fl.files.splice(index, 1);
    fl.binned++;
    fl.undo.push({ type: 'bin', file, index, moved, receipt });
    if (receipt.xp) rewardsFloat(`+${receipt.xp} XP`);
    persistQuiet();
    flickShow(1);
  };
  if (!card || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  card.style.transition = 'transform .28s ease-in, opacity .28s ease-in';
  card.style.transform = `translateX(${(dir || 1) * 120}vw) rotate(${(dir || 1) * 18}deg)`;
  card.style.opacity = '0';
  setTimeout(finish, 260);
}

function flickUndo() {
  const last = fl?.undo.pop();
  if (!last) return;
  if (last.type === 'like') {
    last.file.bestOf = last.prev;
    rewardsRevoke(last.receipt);
    fl.i = Math.max(0, fl.files.indexOf(last.file));
  } else {
    restoreFromBin(last.moved);
    rewardsRevoke(last.receipt);
    fl.files.splice(last.index, 0, last.file);
    fl.binned = Math.max(0, fl.binned - 1);
    fl.i = last.index;
  }
  persistQuiet();
  flickShow(0);
}

// ── THE END ──────────────────────────────────────────────────────────────────
function flickRenderDone() {
  const n = fl.files.length + fl.binned;
  const liked = flickLikedCount();
  const scope = fl.scopeId;
  fl.done = true;
  if (appData.flickPos) delete appData.flickPos[scope];
  document.getElementById('flickStage').innerHTML = `<div class="fl-done">
    <div class="fl-done-heart">❤</div>
    <div class="fl-done-title">${t('flDoneTitle', { n })}</div>
    <div class="fl-done-sub">${t('flDoneBody', { liked, pct: n ? Math.round(liked / n * 100) : 0 })}${fl.binned ? ' ' + t('flDoneBinned', { n: fl.binned, days: BIN_DAYS }) : ''}</div>
    <div class="fl-done-actions">
      <button class="fl-btn" onclick="flickGo(0)">${t('flStartOver')}</button>
      ${fl.binned ? `<button class="fl-btn" onclick="closeFlick();selectFolder('bin')">🗑 ${t('flOpenBin')}</button>` : ''}
      ${liked ? `<button class="fl-btn fl-btn-primary" onclick="closeFlick();flickSelectLiked('${scope}')">${t('flSelectLiked')}</button>` : `<button class="fl-btn fl-btn-primary" onclick="closeFlick()">${t('flBack')}</button>`}
    </div></div>`;
  flickRenderTop();
  // Going all the way through a folder once pays, with the finale (rewards.js).
  const receipt = rewardsBegin();
  if (rewardsClaim(receipt, 'trips', scope)) {
    rewardsAdd(receipt, 'tripDone');
    rewardsCommit(receipt, { finale: { host: document.getElementById('flickMode'), tripName: flickScopeName(scope) } });
  } else celebrationConfetti(document.getElementById('flickMode'));
}

// A one-shot confetti burst, in whichever overlay is showing.
function celebrationConfetti(host) {
  if (!host || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'fr-confetti fl-confetti';
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

// ── INPUT ────────────────────────────────────────────────────────────────────
// One wheel notch or trackpad flick = one file. Trackpads keep sending events while the scroll
// coasts, so after a step the rest of that gesture is ignored until it goes quiet (or half a
// second passes, for someone spinning the wheel on purpose).
function flickOnWheel(e) {
  if (!fl || e.ctrlKey) return;
  e.preventDefault();
  const w = fl.wheel, now = performance.now();
  const quiet = now - w.last > 160;
  w.last = now;
  if (quiet) { w.accX = 0; w.accY = 0; }
  else if (now - w.step < 500) return;
  w.accX += e.deltaX; w.accY += e.deltaY;
  if (Math.abs(w.accX) >= 130 && Math.abs(w.accX) > Math.abs(w.accY)) {
    w.step = now; w.accX = w.accY = 0;
    if (!fl.done) flickBin(Math.sign(e.deltaX));
  } else if (Math.abs(w.accY) >= 40) {
    w.step = now;
    const down = w.accY > 0;
    w.accX = w.accY = 0;
    if (down) flickNext(); else flickPrev();
  }
}

// Dragging the photo sideways: past about a quarter of the screen it goes to the Bin, short of
// that it springs back. A press in a video's control bar is left to the controls.
function flickOnPointerDown(e) {
  if (!fl || fl.done || e.button !== 0) return;
  const media = e.target.closest('.fl-media');
  if (!media) return;
  const vid = e.target.closest('video');
  if (vid && e.clientY > vid.getBoundingClientRect().bottom - 56) return;
  fl.drag = { x: e.clientX, dx: 0, moved: false };
}
function flickOnPointerMove(e) {
  const d = fl?.drag;
  if (!d) return;
  d.dx = e.clientX - d.x;
  if (!d.moved && Math.abs(d.dx) < 8) return;
  d.moved = true;
  const card = document.getElementById('flickCard');
  if (card) { card.style.transition = 'none'; card.style.transform = `translateX(${d.dx}px) rotate(${d.dx / 28}deg)`; }
  const label = document.getElementById('flickBinLabel');
  if (label) label.style.opacity = Math.min(1, Math.abs(d.dx) / 160);
}
function flickOnPointerUp() {
  const d = fl?.drag;
  if (!d) return;
  fl.drag = null;
  if (!d.moved) return;
  if (Math.abs(d.dx) > Math.max(120, window.innerWidth * 0.22)) { flickBin(Math.sign(d.dx)); return; }
  const card = document.getElementById('flickCard');
  if (card) { card.style.transition = 'transform .2s ease-out'; card.style.transform = ''; }
  const label = document.getElementById('flickBinLabel');
  if (label) label.style.opacity = '';
}

function flickHandleKey(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); closeFlick(); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); flickUndo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (['ArrowDown', 'ArrowRight', 'PageDown', ' ', 'j'].includes(k)) { e.preventDefault(); flickNext(); }
  else if (['ArrowUp', 'ArrowLeft', 'PageUp', 'k'].includes(k)) { e.preventDefault(); flickPrev(); }
  else if (k === 'Home') { e.preventDefault(); flickGo(0); }
  else if (k === 'End') { e.preventDefault(); flickGo(fl.files.length - 1); }
  else if (fl.done) return;
  else if (k.toLowerCase() === 'l') { e.preventDefault(); flickToggleLike(); }
  else if (k === 'Delete' || k.toLowerCase() === 'x') { e.preventDefault(); flickBin(1); }
  else if (k === 'Backspace' || k.toLowerCase() === 'u') { e.preventDefault(); flickUndo(); }
}

function flickWireInput() {
  const el = document.getElementById('flickMode');
  el.addEventListener('wheel', flickOnWheel, { passive: false });
  el.addEventListener('pointerdown', flickOnPointerDown);
  el.addEventListener('dblclick', e => { if (fl && !fl.done && e.target.closest('.fl-media') && !e.target.closest('video')) flickToggleLike(); });
  document.addEventListener('pointermove', flickOnPointerMove);
  document.addEventListener('pointerup', flickOnPointerUp);
}

// ── FIRST MINUTE ─────────────────────────────────────────────────────────────
// The first-run wizard's last step offers this straight away, on the biggest trip just added.
function flickBestTrip(tripIds) {
  return tripIds
    .map(id => ({ id, n: flickScopeFiles(id).length }))
    .filter(x => x.n >= 2)
    .sort((a, b) => b.n - a.n)[0]?.id || null;
}
