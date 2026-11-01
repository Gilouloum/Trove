// ── BIN ──────────────────────────────────────────────────────────────────────
// Trove's own "Recently deleted", like the Photos app's: files sent here (swiped away in Flick
// through, or Move to Bin from the menu) leave every view at once, wait 30 days, and only then go
// to the computer's Recycle Bin / Trash. Until then nothing happens to the file itself - it isn't
// moved or copied. Trove keeps its entry in appData.bin instead of appData.files, so every other
// feature (grid, search, counts, globe, duplicates...) stops seeing it without having to know the
// Bin exists, and restoring just puts the entry back.
//
// With "Allow deleting files from disk" off in Settings, the Bin never touches a file: expired
// entries simply leave Trove and the file stays where it is.
//
// Loaded before renderer.js; reads its globals (appData, saveData, toast, t...) only when called.

const BIN_DAYS = 30;
const BIN_DAY_MS = 24 * 3600 * 1000;

function binEntries() {
  if (!Array.isArray(appData.bin)) appData.bin = [];
  return appData.bin;
}
function binDaysLeft(f) { return Math.max(0, Math.ceil(BIN_DAYS - (Date.now() - (f.binnedAt || 0)) / BIN_DAY_MS)); }

// A Live Photo's motion half travels with its still, both ways, or the .mov would surface alone.
function binWithCompanions(ids, pool) {
  const set = new Set(ids);
  for (const f of pool) {
    if (set.has(f.id) && f.livePhotoVideoId) set.add(f.livePhotoVideoId);
    if (f.livePhotoStillId && set.has(f.livePhotoStillId)) set.add(f.id);
  }
  return set;
}

// Returns the ids actually moved (companions included), which is what restoreFromBin undoes.
function moveToBin(ids) {
  const set = binWithCompanions(ids, appData.files);
  const now = Date.now();
  const moved = [];
  appData.files = appData.files.filter(f => {
    if (!set.has(f.id)) return true;
    f.binnedAt = now;
    binEntries().push(f);
    moved.push(f.id);
    selectedIds.delete(f.id);
    return false;
  });
  return moved;
}

function restoreFromBin(ids) {
  const set = binWithCompanions(ids, binEntries());
  const back = binEntries().filter(f => set.has(f.id));
  appData.bin = binEntries().filter(f => !set.has(f.id));
  back.forEach(f => { delete f.binnedAt; appData.files.push(f); selectedIds.delete(f.id); });
  if (back.length) queueForIndexing(back);
  return back.length;
}

// Right-click / selection bar: the gentle way to get rid of something, with 30 days to change your mind.
async function ctxMoveToBin() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  binAndReward(ids);
  await saveData();
  toast(t('binMovedN', { n: ids.length }), 4000);
}

// XP (rewards.js) for clearing things out: each file pays once, however often it comes and goes.
function binAndReward(ids) {
  const moved = moveToBin(ids);
  countUse('binned', moved.length);
  const receipt = rewardsBegin();
  ids.forEach(id => { if (rewardsClaim(receipt, 'binned', id)) rewardsAdd(receipt, 'bin'); });
  rewardsCommit(receipt, { sound: 'tick' });
  return { moved, receipt };
}

// ── THE BIN VIEW ─────────────────────────────────────────────────────────────
function renderBinView(area, files) {
  area.innerHTML = '<div id="lasso"></div>';
  const banner = document.createElement('div');
  banner.className = 'bin-banner';
  const canDelete = canDeleteFiles();
  banner.innerHTML = `<div class="bin-banner-text"><strong>${t('binTitle')}</strong><span>${canDelete ? t('binExplain', { days: BIN_DAYS }) : t('binExplainNoDelete', { days: BIN_DAYS })}</span></div>
    ${files.length ? `<button class="dump-banner-btn" onclick="binRestoreSelected()">↺ ${t('binRestoreSelected')}</button>
    <button class="dump-banner-btn" onclick="binDeleteSelected()">${t('binDeleteSelected')}</button>
    <button class="dump-banner-btn bin-empty-btn" onclick="binEmpty()">${t('binEmpty')}</button>` : ''}`;
  area.appendChild(banner);
  if (!files.length) {
    area.insertAdjacentHTML('beforeend', `<div class="empty-state"><div class="empty-icon">🗑</div><div class="empty-title">${t('binEmptyState')}</div><div class="empty-sub">${t('binEmptyStateSub')}</div></div>`);
    return;
  }
  if (currentView === 'list') renderList(files, area); else renderGrid(files, area);
}

function binSelectedIds() {
  const inBin = new Set(binEntries().map(f => f.id));
  const ids = [...selectedIds].filter(id => inBin.has(id));
  if (!ids.length) toast(t('binSelectFirst'));
  return ids;
}

async function binRestoreSelected() {
  const ids = binSelectedIds();
  if (!ids.length) return;
  const n = restoreFromBin(ids);
  await saveData();
  toast(t('binRestoredN', { n }));
}
function binDeleteSelected() { const ids = binSelectedIds(); if (ids.length) binDeleteNow(ids); }
function binEmpty() { if (binEntries().length) binDeleteNow(binEntries().map(f => f.id)); }

// "Delete now" goes through the same confirmation as every other delete in Trove (Recycle Bin
// by default, permanent if ticked). With deleting switched off it only takes them out of Trove.
function binDeleteNow(ids) {
  const set = new Set(ids);
  const files = binDropReimported(binEntries().filter(f => set.has(f.id)));
  if (!files.length) { saveData(); return; }
  if (!canDeleteFiles()) {
    if (!confirm(t('binForgetConfirm', { n: files.length }))) return;
    binForget(files.map(f => f.id));
    saveData();
    return;
  }
  const bytes = files.reduce((s, f) => s + (f.size || 0), 0);
  openDeleteConfirm({
    title: t('binDeleteTitle'),
    sub: t('binDeleteSub'),
    bodyHtml: t('binDeleteBody', { n: files.length, size: fmtSize(bytes) }),
    buttonLabel: t('binDeleteButton', { n: files.length }),
    onConfirm: async () => {
      const permanent = document.getElementById('deleteConfirmPermanent').checked;
      const btn = document.getElementById('deleteConfirmBtn');
      btn.disabled = true;
      // A file Trove can't see right now (an unplugged drive) would read as "already gone", so
      // only files that are actually there are deleted; the rest wait in the Bin.
      const present = await window.api.checkFilesExist(files.map(f => f.path)).catch(() => files.map(() => false));
      const reachable = files.filter((f, i) => present[i]);
      const res = reachable.length ? await window.api.deleteFiles(reachable.map(f => f.path), permanent).catch(() => null) : { deleted: [], failed: [], bytes: 0 };
      btn.disabled = false;
      cancelDeleteConfirm();
      if (!res) { toast('⚠️ ' + t('binDeleteFailed')); return; }
      const gone = new Set(res.deleted);
      const ids = reachable.filter(f => gone.has(f.path)).map(f => f.id);
      binForget(ids);
      recordSpaceFreed(res.bytes);
      await saveData();
      toast(t('binDeletedN', { n: ids.length, size: fmtSize(res.bytes) }), 5000);
      toastDeleteFailures(res);
      if (reachable.length < files.length) toast(t('binUnreachable', { n: files.length - reachable.length }), 6000);
    },
  });
}

// Bin entries whose file has been added to the library again since (the same folder imported
// once more): the file is in use, so it must never be deleted from here. They're let go instead.
function binDropReimported(entries) {
  const inLibrary = new Set(appData.files.map(f => f.path));
  const back = entries.filter(f => inLibrary.has(f.path));
  if (back.length) binForget(back.map(f => f.id));
  return entries.filter(f => !inLibrary.has(f.path));
}

function binForget(ids) {
  const set = new Set(ids);
  appData.bin = binEntries().filter(f => !set.has(f.id));
  ids.forEach(id => selectedIds.delete(id));
  if (ids.length) window.api.deleteEmbeddings(ids).catch(() => {});
}

// ── AFTER 30 DAYS ────────────────────────────────────────────────────────────
// Checked shortly after start-up and every few hours. Files on a drive that isn't plugged in are
// left for next time; after 30 more days of not finding them, Trove lets the entry go.
async function binPurgeExpired() {
  const now = Date.now();
  const due = binEntries().filter(f => now - (f.binnedAt || now) >= BIN_DAYS * BIN_DAY_MS);
  if (!due.length) return;
  const expired = binDropReimported(due);
  if (!expired.length) { persistQuiet(); renderAfterChange(); return; }
  if (!canDeleteFiles()) {
    binForget(expired.map(f => f.id));
    persistQuiet();
    renderAfterChange();
    return;
  }
  const present = await window.api.checkFilesExist(expired.map(f => f.path)).catch(() => null);
  if (!present) return;
  const reachable = expired.filter((f, i) => present[i]);
  const lost = expired.filter((f, i) => !present[i] && now - f.binnedAt >= 2 * BIN_DAYS * BIN_DAY_MS);
  const res = reachable.length ? await window.api.deleteFiles(reachable.map(f => f.path), false).catch(() => null) : null;
  const gone = new Set(res?.deleted || []);
  const ids = [...reachable.filter(f => gone.has(f.path)), ...lost].map(f => f.id);
  if (!ids.length) return;
  binForget(ids);
  if (res) recordSpaceFreed(res.bytes);
  persistQuiet();
  renderAfterChange();
  if (gone.size) toast(t('binPurgedN', { n: gone.size, days: BIN_DAYS }), 6000);
}
function binStartPurgeTimer() {
  setTimeout(binPurgeExpired, 20 * 1000);
  setInterval(binPurgeExpired, 6 * 3600 * 1000);
}
