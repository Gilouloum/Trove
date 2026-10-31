// ── SEMANTIC (CONTENT) SEARCH ──────────────────────────────────────────────────
// Owns the worker that runs the CLIP model (worker/semantic-worker.js) and the background
// job that embeds every photo/video's thumbnail once so text queries can match by visual
// content, not just filename/metadata. See renderer.js's fileMatchesToken() for the
// metadata search this sits alongside (semantic results are additive - see
// runSemanticSearch()/computeVisibleFiles() in renderer.js).
//
// On-disk state (main.js's EMBED_DIR, one small file per fileId) is the only "have I
// indexed this file" record - there's no separate queue to persist, so a restart just
// re-diffs appData.files against window.api.getIndexedIds() and picks up where it left off.

let semanticWorker = null;
let semanticWorkerReady = false;
let semanticReqSeq = 0;
const semanticPendingText = new Map(); // reqId -> {resolve, reject}

let semanticIndexedIds = new Set(); // fileIds already embedded (persisted, per main.js)
let semanticQueue = [];             // fileIds still to embed this session
let semanticQueueSet = new Set();   // de-dupe guard for semanticQueue
let semanticLoopRunning = false;

let semanticResults = { query: '', ids: [] }; // {id,score}[] ranked, most-similar first
let semanticResultGen = 0; // bumped whenever semanticResults changes, for visCache's key (renderer.js)
let semanticOnlyIds = new Set(); // ids in the current visible set matched by content, not metadata - read by renderer.js's card builders for the badge

async function initSemanticIndex() {
  if (semanticWorker) return;
  semanticWorker = new Worker('worker/semantic-worker.js', { type: 'module' });
  semanticWorker.onmessage = onSemanticWorkerMessage;
  semanticWorker.onerror = (e) => console.error('[semantic-worker]', e.message || e);
  semanticWorker.postMessage({ type: 'init' });

  semanticIndexedIds = new Set(await window.api.getIndexedIds().catch(() => []));
  queueForIndexing(appData.files);
}

// So the UI can tell "no results" apart from "results, but the library isn't fully learned
// yet" - see the search-mode empty/low-result state in renderer.js.
function getSemanticProgress() {
  const total = appData.files.filter(f => isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo).length;
  return { indexed: semanticIndexedIds.size, total, complete: semanticQueue.length === 0 && semanticIndexedIds.size >= total };
}

function onSemanticWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'ready') {
    semanticWorkerReady = true;
    console.log(`[semantic] model ready - ${semanticQueue.length} file(s) queued to index`);
    semanticRunIndexingLoop();
  } else if (msg.type === 'embed-text-result') {
    const pending = semanticPendingText.get(msg.reqId);
    if (pending) { semanticPendingText.delete(msg.reqId); pending.resolve(msg.vector); }
  } else if (msg.type === 'embed-image-result') {
    onImageEmbedded(msg.id, msg.vector);
  } else if (msg.type === 'error') {
    if (msg.reqId != null && semanticPendingText.has(msg.reqId)) {
      semanticPendingText.get(msg.reqId).reject(new Error(msg.message));
      semanticPendingText.delete(msg.reqId);
    } else if (msg.context === 'embed-image') {
      // Drop this one and keep going - one bad/corrupt thumbnail shouldn't stall indexing.
      semanticRunIndexingLoop();
    }
    console.warn('[semantic-worker]', msg.context, msg.message);
  }
}

const semanticPendingImage = new Map(); // fileId -> {resolve}, only for embedFileNow() callers

async function onImageEmbedded(fileId, vector) {
  await window.api.saveEmbedding(fileId, vector).catch(() => {});
  semanticIndexedIds.add(fileId);
  if (semanticIndexedIds.size % 250 === 0) console.log(`[semantic] indexed ${semanticIndexedIds.size} file(s) so far`);
  const pending = semanticPendingImage.get(fileId);
  if (pending) { semanticPendingImage.delete(fileId); pending.resolve(); }
  semanticRunIndexingLoop();
}

// Embeds one file right now rather than waiting for its turn in the throttled background
// queue - pulled out of that queue first so it isn't double-processed later.
function embedFileNow(file) {
  if (semanticIndexedIds.has(file.id)) return Promise.resolve();
  if (semanticQueueSet.has(file.id)) {
    semanticQueueSet.delete(file.id);
    semanticQueue = semanticQueue.filter(id => id !== file.id);
  }
  return getThumb(file).catch(() => null).then(dataUrl => {
    if (!dataUrl) return;
    return new Promise(resolve => {
      semanticPendingImage.set(file.id, { resolve });
      semanticWorker.postMessage({ type: 'embed-image', id: file.id, dataUrl });
      // A stuck file (bad thumbnail, worker hiccup) shouldn't hang a UI moment waiting on it.
      setTimeout(() => {
        if (semanticPendingImage.has(file.id)) { semanticPendingImage.delete(file.id); resolve(); }
      }, 15000);
    });
  });
}

// Priority-embeds a whole batch right now, bounded concurrency, for a UI moment actively
// waiting on it (Guided Sort's "content" step needs a batch fully embedded before it can ask
// for suggestions) rather than the background loop's own idle-callback pacing. Resolves once
// every eligible file has an embedding (or timed out) - callers should show a loading state.
async function embedBatchNow(files, onProgress) {
  await initSemanticIndex();
  while (!semanticWorkerReady) await new Promise(r => setTimeout(r, 100));
  const todo = files.filter(f => isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo);
  const CONCURRENCY = 4;
  let next = 0, done = 0;
  async function worker() {
    while (next < todo.length) {
      await embedFileNow(todo[next++]);
      done++;
      if (onProgress) onProgress(done, todo.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
}

// Called from the 4 places a new file enters appData.files (addFiles/dumpFiles/drag-drop -
// see renderer.js) plus once at startup for the whole existing library.
function queueForIndexing(files) {
  if (typeof queueFacesFor === 'function') queueFacesFor(files); // People's face scan rides along, when it's switched on
  let added = false;
  for (const f of files) {
    if (!isMedia(f.ext) || f._missing || f.isLivePhotoVideo) continue;
    if (semanticIndexedIds.has(f.id) || semanticQueueSet.has(f.id)) continue;
    semanticQueue.push(f.id);
    semanticQueueSet.add(f.id);
    added = true;
  }
  if (added) semanticRunIndexingLoop();
}

function semanticNextIdleDeadline(cb) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 2000 });
  else setTimeout(() => cb({ timeRemaining: () => 25, didTimeout: true }), 200);
}

// Processes the queue a few files at a time, preferring idle moments over fighting the
// user's own interaction (typing a search pauses it entirely - see the searchTimer check).
// Also paused entirely while the app doesn't have OS focus (appFocused, set in renderer.js) -
// this is the biggest CPU cost in the app (a multi-threaded WASM model running batches), and a
// video/photo editor running alongside deserves that headroom more than an idle indexing pass
// does. onAppFocusChange() (renderer.js) resumes it the moment focus comes back.
function semanticRunIndexingLoop() {
  if (semanticLoopRunning || !semanticWorkerReady) return;
  if (!semanticQueue.length) return;
  if (typeof appFocused !== 'undefined' && !appFocused) return;
  semanticLoopRunning = true;
  semanticNextIdleDeadline(async () => {
    semanticLoopRunning = false;
    if (typeof appFocused !== 'undefined' && !appFocused) return; // lost focus while waiting for an idle slot
    if (typeof searchTimer !== 'undefined' && searchTimer) {
      semanticNextIdleDeadline(semanticRunIndexingLoop); // user's actively typing - try again shortly
      return;
    }
    const batch = semanticQueue.splice(0, 4);
    batch.forEach(id => semanticQueueSet.delete(id));
    await Promise.all(batch.map(async (id) => {
      const file = appData.files.find(f => f.id === id);
      if (!file || file._missing) return;
      const dataUrl = await getThumb(file).catch(() => null);
      if (!dataUrl) return;
      semanticWorker.postMessage({ type: 'embed-image', id, dataUrl });
    }));
    // onImageEmbedded() re-triggers the loop per completed file; also nudge it here in
    // case every file in this batch failed to thumbnail (nothing else would resume it).
    if (semanticQueue.length) semanticRunIndexingLoop();
  });
}

function embedTextQuery(text) {
  return new Promise((resolve, reject) => {
    if (!semanticWorker) { reject(new Error('semantic search not ready')); return; }
    const reqId = ++semanticReqSeq;
    semanticPendingText.set(reqId, { resolve, reject });
    semanticWorker.postMessage({ type: 'embed-text', reqId, text });
  });
}

// If the query names an existing folder (any level - "wildlife", a trip name, a camera...),
// gather what's already filed there (including subfolders) as a reference set for the
// "find more files that look like these" expansion below - e.g. searching "wildlife" surfaces
// not just files actually filed in Wildlife, but other unfiled photos that visually resemble
// what's already in there (see main.js's search-similar-to-files/CENTROID_MIN_SCORE).
function getMatchingFolderMemberIds(q) {
  const matched = appData.folders.filter(f => f.name.toLowerCase().includes(q));
  if (!matched.length) return [];
  const folderIds = new Set();
  matched.forEach(f => { folderIds.add(f.id); getAllDesc(f.id).forEach(id => folderIds.add(id)); });
  return appData.files.filter(f => f.folders?.some(id => folderIds.has(id))).map(f => f.id);
}

// Debounced from onSearchInput() (renderer.js) alongside the existing metadata-search
// render - resolves later and triggers a second render that splices results in
// (see computeVisibleFiles()'s semanticResults read).
let semanticSearchToken = 0;
async function runSemanticSearch(query) {
  const q = query.trim();
  if (!q) { semanticResults = { query: '', ids: [] }; semanticResultGen++; return; }
  const token = ++semanticSearchToken;
  try {
    // CLIP is trained on real image captions, not bare keywords - "a photo of X" is the
    // standard zero-shot prompt template and measurably improves match quality over
    // embedding the raw word (especially for a proper noun like a car model name).
    const vector = await embedTextQuery(`a photo of ${q}`);
    if (token !== semanticSearchToken) return; // superseded by a newer keystroke
    const ranked = await window.api.searchSemantic(vector, 40);
    if (token !== semanticSearchToken) return;
    const ids = ranked.map(r => r.id);

    // A centroid from just 1-2 files is too noisy to mean "this category" rather than
    // "these specific photos" - skip the expansion until there's a real cluster to learn from.
    const folderMemberIds = getMatchingFolderMemberIds(q);
    if (folderMemberIds.length >= 3) {
      const expanded = await window.api.searchSimilarToFiles(folderMemberIds, 40).catch(() => []);
      if (token !== semanticSearchToken) return;
      const seen = new Set(ids);
      for (const r of expanded) if (!seen.has(r.id)) { ids.push(r.id); seen.add(r.id); }
    }

    semanticResults = { query: q, ids };
    semanticResultGen++;
    renderFiles();
  } catch (e) {
    // Model still loading, or the query failed to embed - metadata search results (already
    // shown) stand on their own; nothing to degrade to since there was never a semantic layer.
  }
}

// ── AUTO-GROUPING (Guided Sort "content" step) ──────────────────────────────────
// Suggests filing To-Sort files into existing content-category folders, or grouping
// leftovers into new ones - see main.js's suggest-groups handler for the actual matching/
// clustering (which stays in main.js so it can use its own mirrored appData + embeddingIndex
// directly). This file's job is just: make sure the batch is embedded, call it, and turn a
// new cluster's raw centroid into a human-readable suggested name.

// [displayName, CLIP query phrase] - common photo/activity/scene terms, matched against a
// new cluster's centroid the same way a search query is matched against photos. Not
// exhaustive - a cluster that doesn't clear the confidence floor below just gets a plain
// "New Group N" placeholder instead of a wrong-sounding guess (always user-editable either way).
const CLUSTER_NAME_VOCAB = [
  ['Hiking', 'hiking'], ['Mountain Biking', 'mountain biking'], ['Road Biking', 'road cycling'],
  ['Skiing', 'skiing'], ['Snowboarding', 'snowboarding'], ['Surfing', 'surfing'],
  ['Wing Foiling', 'wing foiling'], ['Kitesurfing', 'kitesurfing'], ['Paddleboarding', 'stand-up paddleboarding'],
  ['Kayaking', 'kayaking'], ['Sailing', 'sailing a boat'], ['Paragliding', 'paragliding'],
  ['Skydiving', 'skydiving'], ['Rock Climbing', 'rock climbing'], ['Via Ferrata', 'via ferrata climbing'],
  ['Zip Lining', 'zip lining through trees'], ['Cliff Jumping', 'jumping off a cliff into water'],
  ['Swimming', 'swimming'], ['Scuba Diving', 'scuba diving underwater'], ['Snorkeling', 'snorkeling'],
  ['Fishing', 'fishing'], ['Motorcycling', 'riding a motorcycle'], ['Off-Roading', 'off-road driving'],
  ['Camping', 'camping'], ['Running', 'running outdoors'],
  ['Wildlife', 'wildlife in nature'], ['Birds', 'birds'], ['Dogs', 'a dog'], ['Cats', 'cats'],
  ['Beach', 'a beach'], ['Ocean', 'the ocean'], ['Lake', 'a lake'], ['Waterfall', 'a waterfall'],
  ['Forest', 'a forest'], ['Mountains', 'mountains'], ['Snowy Landscape', 'a snowy landscape'],
  ['Sunset', 'a sunset'], ['City', 'a city street'], ['Architecture', 'architecture'],
  ['Cars', 'a car'], ['Motorcycles', 'a motorcycle'], ['Boats', 'a boat'], ['Drone Aerials', 'a drone aerial view'],
  ['Food', 'food on a plate'], ['Party', 'a party'], ['Concert', 'a concert'], ['Fireworks', 'fireworks'],
  ['Wedding', 'a wedding'], ['Group Photos', 'a group of people'], ['Portraits', 'a portrait of a person'],
  ['Kids Playing', 'children playing'], ['Garden', 'a garden with flowers'],
];
let clusterNameVocabEmbeddings = null; // [{displayName, vector}], embedded once and cached

async function ensureClusterNameVocab() {
  if (clusterNameVocabEmbeddings) return clusterNameVocabEmbeddings;
  clusterNameVocabEmbeddings = await Promise.all(
    CLUSTER_NAME_VOCAB.map(async ([displayName, phrase]) => ({
      displayName, vector: await embedTextQuery(`a photo of ${phrase}`),
    }))
  );
  return clusterNameVocabEmbeddings;
}

function cosineLocal(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

// Same floor as SEMANTIC_MIN_SCORE in main.js (0.25) - this is the identical kind of
// comparison (text-vs-image), just run client-side since only the worker has a text encoder.
const CLUSTER_NAME_MIN_SCORE = 0.25;

async function suggestNameForCluster(centroidArray) {
  const vocab = await ensureClusterNameVocab();
  const centroid = Float32Array.from(centroidArray);
  let best = null, bestScore = -1;
  for (const v of vocab) {
    const score = cosineLocal(centroid, v.vector);
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return (best && bestScore >= CLUSTER_NAME_MIN_SCORE) ? best.displayName : null;
}

// Full pipeline for the Guided Sort "content" step: embed the batch (priority, not the
// background pace), ask main.js for suggestions, then name the new-cluster suggestions.
// onProgress(done,total) is called while embedding, before any suggestions are available.
async function suggestGroupsForBatch(files, onProgress) {
  await embedBatchNow(files, onProgress);
  const ids = files.filter(f => isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo).map(f => f.id);
  const result = await window.api.suggestGroups(ids);
  for (const cluster of result.newClusters) {
    cluster.suggestedName = await suggestNameForCluster(cluster.centroid).catch(() => null);
  }
  return result;
}
