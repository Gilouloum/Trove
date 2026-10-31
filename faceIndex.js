// ── FACE RECOGNITION (People) ────────────────────────────────────────────────
// Opt-in, on-device. worker/face-worker.js finds the faces in each photo and describes each
// one as 128 numbers; photos of the same person describe close together. This file scans the
// library in the background, groups similar faces, and puts those groups in front of the user
// to name. Nothing is ever filed into a person automatically: a group only becomes "Marie"
// when someone says so, and from then on Marie's confirmed faces are what new groups are
// compared against for an "Is this Marie?" suggestion. A wrong guess costs a click; a wrong
// automatic tag would quietly put strangers in someone's folder.
//
// Face data lives in main.js's FACES_DIR, apart from the library JSON: it only exists while
// appData.settings.faceRecognition is on, and switching that off deletes all of it. Person
// folders and the photos filed into them are the user's own tags and stay either way.
//
// Loaded after renderer.js and leans on its globals (appData, getPreviewImage, getThumb,
// toast, esc, getOrCreatePersonFolder, assignFilesToFolderAdditive, appFocused...).

// Two faces closer than this are grouped as the same person. face-api's own guidance is 0.6;
// tighter keeps two siblings from merging, at the cost of one person sometimes splitting into
// two groups - which the user fixes by giving both the same name.
const FACE_GROUP_DIST = 0.5;
const FACE_SUGGEST_DIST = 0.5;  // this close to someone's references gets an "Is this ...?" (see faceDistToPerson);
                               // at 0.55, animals, statues and other people crept into the questions
const FACE_ANALYSE_MAX = 1280;  // long side of the picture the detector sees
const FACE_CROP_PX = 112;

let faceStore = null; // { v, scanned: {fileId: 1}, faces: [{ id, f: fileId, b: [x,y,w,h] 0..1, d: base64 Float32Array(128), l: 68 landmarks, p: personId | 'x' | null }] }
let faceSaveTimer = null;
let faceReqSeq = 0;
const facePending = new Map();
let faceQueue = [], faceQueueSet = new Set(), faceLoopRunning = false;
const faceJustFound = []; // faces found by the running scan, not yet shown on the loading wall
const faceDescCache = new Map(); // face id -> Float32Array
let faceReviewCount = 0;         // groups waiting for a name, for the sidebar row
let faceReviewCountTimer = null;
let faceModeShowSingles = false;
let faceModeLimit = 40;
let faceModePerson = null;       // the person whose faces the review screen is showing for a check, or null

function faceRecognitionEnabled() { return !!appData.settings?.faceRecognition; }

async function initFaceIndex() {
  if (!faceRecognitionEnabled()) return;
  if (!faceStore) {
    faceStore = (await window.api.facesLoad().catch(() => null)) || { v: 1, scanned: {}, faces: [] };
    faceStore.scanned = faceStore.scanned || {};
    faceStore.faces = faceStore.faces || [];
    facePruneStore();
  }
  queueFacesFor(appData.files);
  faceRefreshReviewCount();
  faceSchedulePictures();
  if (!faceQueue.length) faceScheduleRecognize(); // nothing left to scan, so the run-end hook won't fire this session
}

// Faces of photos that have since left the library, and names pointing at a person folder that
// was deleted, are dropped rather than carried forever.
function facePruneStore() {
  const live = new Set(appData.files.map(f => f.id));
  const people = new Set(appData.folders.map(f => f.id));
  const gone = faceStore.faces.filter(fc => !live.has(fc.f));
  if (gone.length) {
    faceStore.faces = faceStore.faces.filter(fc => live.has(fc.f));
    window.api.faceCropsDelete(gone.map(fc => fc.id)).catch(() => {});
  }
  for (const id of Object.keys(faceStore.scanned)) if (!live.has(id)) delete faceStore.scanned[id];
  for (const fc of faceStore.faces) if (fc.p && fc.p !== 'x' && !people.has(fc.p)) fc.p = null;
  if (gone.length) faceScheduleSave();
}

// Throttled, not debounced: during a scan a new face arrives every fraction of a second, and a
// debounce kept pushing the save back until the scan ended - close Trove mid-scan and all of
// it was lost. This saves within 1.5s of the first change, however busy the scan is.
function faceScheduleSave() {
  if (faceSaveTimer) return;
  faceSaveTimer = setTimeout(() => {
    faceSaveTimer = null;
    if (faceStore && faceRecognitionEnabled()) window.api.facesSave(JSON.stringify(faceStore)).catch(() => {});
  }, 1500);
}

function queueFacesFor(files) {
  if (!faceRecognitionEnabled() || !faceStore) return;
  for (const f of files) {
    if (!isImg(f.ext) || f._missing || f.isLivePhotoVideo || (f.ext || '').toLowerCase() === '.insp') continue;
    if (faceStore.scanned[f.id] || faceQueueSet.has(f.id)) continue;
    faceQueue.push(f.id);
    faceQueueSet.add(f.id);
  }
  faceRunLoop();
}

// One detector worker. Measured on a real library: a second one, with its own copy of the models,
// ran no faster - both share the one GPU - and doubled the memory. Kept as a pool so that
// stays a one-number change if that ever differs.
const FACE_WORKERS = 1;
let faceWorkerPool = [];
let faceWorkerTurn = 0;
function faceCall(msg, transfer) {
  if (!faceWorkerPool.length) {
    faceWorkerPool = Array.from({ length: FACE_WORKERS }, () => {
      const w = new Worker('worker/face-worker.js', { type: 'module' });
      w.onmessage = ({ data }) => {
        const job = facePending.get(data.id);
        if (!job) return;
        facePending.delete(data.id);
        if (data.type === 'error') job.reject(new Error(data.message));
        else job.resolve(data);
      };
      w.onerror = e => {
        console.error('[face-worker]', e.message || e);
        for (const job of facePending.values()) job.reject(new Error(e.message || 'worker failed'));
        facePending.clear();
        faceStopWorkers();
      };
      return w;
    });
  }
  const worker = faceWorkerPool[faceWorkerTurn++ % faceWorkerPool.length];
  const id = ++faceReqSeq;
  return new Promise((resolve, reject) => {
    facePending.set(id, { resolve, reject });
    worker.postMessage(Object.assign({ id }, msg), transfer || []);
  });
}
function faceStopWorkers() {
  faceWorkerPool.forEach(w => w.terminate());
  faceWorkerPool = [];
}

// "Scan all photos again": every photo goes back through the detector, for anyone who wants to
// be sure nothing was missed. It only ever adds faces (see faceScanFile), so names and
// corrections survive it. Runs in the background like the first scan; the Find new people
// screen shows its loading wall and progress meanwhile.
function faceRescanAll() {
  if (!faceRecognitionEnabled() || !faceStore) return;
  const photos = appData.files.filter(f => isImg(f.ext) && !f._missing && !f.isLivePhotoVideo && (f.ext || '').toLowerCase() !== '.insp');
  for (const f of photos) {
    if (faceQueueSet.has(f.id)) continue;
    faceQueue.push(f.id);
    faceQueueSet.add(f.id);
  }
  toast(`Scanning ${photos.length.toLocaleString()} photos for faces again, in the background`, 4000);
  faceRunLoop();
  openFacesMode();
}

// Two photos in flight at once: while the worker analyses one, the next is already being
// fetched and decoded, which is most of the time per photo. It keeps going when Trove isn't the
// window in front - a scan of a whole library takes minutes, and nobody should have to watch it -
// with the OS's background throttling lifted for exactly as long as it runs (set-background-work
// in main.js). While Trove is in front, each photo still waits for an idle moment so the app
// stays smooth to use at the same time.
const FACE_PARALLEL = 2;
let faceWorkersRunning = 0;
let faceScanStats = null; // { started, doneAtStart, facesAtStart, times: [{t, done}] } for the progress bar and time left
function faceRunLoop() {
  if (!faceRecognitionEnabled() || !faceQueue.length) return;
  if (faceWorkersRunning === 0) {
    window.api.setBackgroundWork?.(true).catch(() => {});
    faceScanStats = { started: Date.now(), total: faceQueue.length, facesAtStart: faceStore?.faces.length || 0, times: [] };
  }
  while (faceWorkersRunning < FACE_PARALLEL && faceWorkersRunning < faceQueue.length) {
    faceWorkersRunning++;
    faceLoopRunning = true;
    faceWorker1().finally(() => {
      faceWorkersRunning--;
      faceLoopRunning = faceWorkersRunning > 0;
      if (!faceWorkersRunning) faceScanFinished();
    });
  }
}
async function faceWorker1() {
  while (faceQueue.length && faceRecognitionEnabled()) {
    const focused = typeof appFocused === 'undefined' || appFocused;
    if (focused && window.requestIdleCallback) await new Promise(r => requestIdleCallback(r, { timeout: 400 }));
    const id = faceQueue.shift();
    faceQueueSet.delete(id);
    const file = appData.files.find(f => f.id === id);
    try {
      if (file && !file._missing) await faceScanFile(file);
    } catch (err) {
      console.warn('[faces] scan failed', err);
    }
    if (faceScanStats) {
      faceScanStats.times.push({ t: Date.now(), left: faceQueue.length });
      if (faceScanStats.times.length > 5) faceScanStats.times.length = 5; // only the start is needed (see faceScanEta)
    }
    faceUpdateProgressUi();
    if (typeof gsFacesChanged === 'function') gsFacesChanged(); // Guided Sort's People step may be waiting on this photo
  }
}
function faceScanFinished() {
  window.api.setBackgroundWork?.(false).catch(() => {});
  faceScanStats = null;
  faceUpdateProgressUi();
  faceScheduleRecognize(); // learn from the People folders, recognise, then pick people's pictures
}
// Time left, from the average speed since the scan started (after its first few photos, while the
// models warm up). A rolling window jumped around enough that two readings a second apart
// disagreed by minutes; the average is steady and every place that shows it agrees.
function faceScanEta() {
  const st = faceScanStats;
  if (!st || st.times.length < 5) return null;
  const warm = st.times[4];
  const done = warm.left - faceQueue.length;
  const secs = (Date.now() - warm.t) / 1000;
  const rate = secs > 3 ? done / secs : 0;
  return rate > 0 ? Math.round(faceQueue.length / rate) : null;
}
function faceFmtEta(sec) {
  if (sec == null) return 'working out how long…';
  if (sec < 60) return 'less than a minute left';
  const m = Math.round(sec / 60);
  return `about ${m} minute${m === 1 ? '' : 's'} left`;
}

function faceLoadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function faceScanFile(file) {
  // Asked at the size the detector uses, not the viewer's 1800px - less to encode, move and decode.
  let url = null;
  const b64 = await window.api.getPreviewImage(file.path, FACE_ANALYSE_MAX).catch(() => null);
  if (b64) url = file.rotation ? await rotateDataUrl('data:image/jpeg;base64,' + b64, file.rotation) : 'data:image/jpeg;base64,' + b64;
  if (!url) url = await getThumb(file).catch(() => null);
  const img = url ? await faceLoadImage(url) : null;
  if (!img) { faceStore.scanned[file.id] = 1; faceScheduleSave(); return; }
  const k = Math.min(1, FACE_ANALYSE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const res = await faceCall({ type: 'detect', width: canvas.width, height: canvas.height, pixels }, [pixels.buffer]);
  if (!faceRecognitionEnabled() || !faceStore) return; // switched off while this photo was in flight
  // On a rescan the photo already has faces - named, corrected, ignored. A face found again in
  // the same spot is that same face and is left exactly as it is; only faces the first scan
  // missed are added, under ids that can't collide with the existing ones.
  const already = faceStore.faces.filter(f => f.f === file.id);
  const overlap = (a, b) => {
    const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
    const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    return (x * y) / (a[2] * a[3] + b[2] * b[3] - x * y || 1);
  };
  const idStem = already.length ? `fc_${file.id}_r${Date.now().toString(36)}_` : `fc_${file.id}_`;
  let n = 0;
  for (const face of res.faces || []) {
    if (already.some(f => overlap(f.b, face.box) > 0.4)) continue;
    const id = `${idStem}${n++}`.replace(/[^\w-]/g, '');
    const desc = face.desc instanceof Float32Array ? face.desc : new Float32Array(face.desc);
    const crop = faceCrop(canvas, face.box);
    faceStore.faces.push({ id, f: file.id, b: face.box.map(v => Math.round(v * 10000) / 10000), d: faceEncodeDesc(desc), l: faceLandmarksInCrop(face, crop), p: null });
    faceDescCache.set(id, desc);
    window.api.faceCropSave(id, crop.base64).catch(() => {});
    faceJustFound.push({ id, b64: crop.base64 });
    if (faceJustFound.length > 50) faceJustFound.shift();
  }
  faceStore.scanned[file.id] = 1;
  faceScheduleSave();
}

// A square around the face with some room to spare (hair, chin), for the review screen and as
// a person's picture.
function faceCrop(canvas, box) {
  const [bx, by, bw, bh] = [box[0] * canvas.width, box[1] * canvas.height, box[2] * canvas.width, box[3] * canvas.height];
  const side = Math.max(bw, bh) * 1.6;
  const cx = bx + bw / 2, cy = by + bh / 2;
  const out = document.createElement('canvas');
  out.width = out.height = FACE_CROP_PX;
  const octx = out.getContext('2d');
  octx.fillStyle = '#222';
  octx.fillRect(0, 0, FACE_CROP_PX, FACE_CROP_PX);
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, cx - side / 2, cy - side / 2, side, side, 0, 0, FACE_CROP_PX, FACE_CROP_PX);
  const url = out.toDataURL('image/jpeg', 0.85);
  return { base64: url.slice(url.indexOf(',') + 1), bx, by, bw, bh, left: cx - side / 2, top: cy - side / 2, side };
}
// The worker gives landmarks in thousandths of the face box; faceQuality reads them against the
// saved crop, so they're stored in the crop's own pixels.
function faceLandmarksInCrop(face, crop) {
  if (!face.lm) return null;
  const k = FACE_CROP_PX / crop.side;
  return face.lm.map((v, i) => i % 2 === 0
    ? Math.round((crop.bx + v / 1000 * crop.bw - crop.left) * k * 10) / 10
    : Math.round((crop.by + v / 1000 * crop.bh - crop.top) * k * 10) / 10);
}

function faceEncodeDesc(desc) {
  const bytes = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function faceDesc(face) {
  let d = faceDescCache.get(face.id);
  if (!d) {
    const s = atob(face.d);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    d = new Float32Array(bytes.buffer);
    faceDescCache.set(face.id, d);
  }
  return d;
}
function faceDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const t = a[i] - b[i]; s += t * t; }
  return Math.sqrt(s);
}

// ── Recognition ──────────────────────────────────────────────────────────────
// Who is who comes from the People folders the user already made. Each photo filed under a
// person says "they're in here somewhere"; the face that keeps turning up across their photos
// is them, even in group shots (faceLearnFromFolders). Those faces - plus any the user names on
// the review screen - are the person's references, and every other face in the library is
// measured against them (faceRecognize): a close, unambiguous match is recognised and its
// photo filed under that person automatically; a near miss becomes an "Is this ...?" question;
// anyone nobody matches is grouped for the user to name. Only the last two ever need asking.
//
// face.p is who a face is; face.a says how Trove knows: undefined = the user said so,
// 'learned' = worked out from their folder, 'auto' = recognised. face.added marks a photo that
// recognition itself filed, so taking the face back out also takes the photo back out.
// face.no lists people the user said this face is NOT, never suggested for it again.
const FACE_AUTO_DIST = 0.42;   // this close to someone's references, and clearly closer than to anyone else: recognised.
                               // Tuned on a real library: at 0.45 a bearded friend was filed as the owner; anything
                               // looser than this is asked instead (FACE_SUGGEST_DIST).
const FACE_AUTO_MARGIN = 0.08; // how much closer than the runner-up it has to be
const FACE_LEARN_DIST = 0.55;  // inside a person's own tagged photos, where they're known to appear
let faceRecognizeTimer = null;

// A person's references: the faces the user named as them, and the ones learned from their folder.
// Recognised faces don't count - one wrong match would otherwise pull in more like it.
function faceReferences() {
  const refs = new Map();
  for (const face of faceStore.faces) {
    if (!face.p || face.p === 'x' || face.a === 'auto') continue;
    if (!refs.has(face.p)) refs.set(face.p, []);
    refs.get(face.p).push(faceDesc(face));
  }
  return refs;
}
// Distance from a face to a person: the average of its 3 closest references, which holds up
// better than one average face when someone's photos span glasses, beards and twenty years.
function faceDistToPerson(d, refs) {
  const ds = refs.map(r => faceDist(d, r)).sort((a, b) => a - b).slice(0, 3);
  return ds.reduce((s, v) => s + v, 0) / ds.length;
}
function faceRanked(d, allRefs, exclude) {
  const out = [];
  for (const [pid, refs] of allRefs) if (!exclude?.includes(pid)) out.push({ pid, dist: faceDistToPerson(d, refs) });
  return out.sort((a, b) => a.dist - b.dist);
}

// Works out which face is which person from the photos already filed under them. Every group
// of similar faces is scored against every person by how many of their photos it appears in,
// and matched best-first, one group per person and one person per group - so a parent who is
// in most of the family's folders is only ever themselves, not everyone they're pictured with.
function faceLearnFromFolders() {
  const refs = faceReferences();
  const groups = faceGroups();
  // Only photos with a face in them say anything about who someone is - a folder full of
  // landscapes and drone shots would otherwise make its owner's face look rare in it.
  const withFaces = new Set(faceStore.faces.map(f => f.f));
  const total = withFaces.size || 1;
  const pairs = [];
  for (const person of facePeopleFolders()) {
    if ((refs.get(person.id) || []).length >= 3) continue; // already known well enough
    const theirs = new Set(appData.files.filter(f => f.folders?.includes(person.id) && withFaces.has(f.id)).map(f => f.id));
    if (theirs.size < 2) continue;
    for (const g of groups) {
      const hits = g.fileIds.filter(id => theirs.has(id)).length;
      if (hits < 2) continue;
      // Evidence = how many more of their photos this face is in than it would be by chance.
      // Someone who's in most photos everywhere (the photographer, a parent) is expected in
      // any folder, so they're no evidence for a small folder - and a lot for their own.
      const expected = theirs.size * g.fileIds.length / total;
      pairs.push({ person, g, theirs, hits, cover: hits / theirs.size, evidence: hits - expected });
    }
  }
  pairs.sort((a, b) => b.evidence - a.evidence);
  const donePeople = new Set(), doneGroups = new Set();
  let learned = 0;
  for (const p of pairs) {
    if (p.cover < 0.3 || p.evidence < 1.5 || donePeople.has(p.person.id) || doneGroups.has(p.g)) continue;
    donePeople.add(p.person.id);
    doneGroups.add(p.g);
    for (const face of p.g.faces) {
      if (!p.theirs.has(face.f) || face.no?.includes(p.person.id)) continue;
      face.p = p.person.id; face.a = 'learned'; learned++;
    }
  }
  // Now that each person has a face to go on, the rest of their own tagged photos: in each,
  // the face closest to them is them, if it's close enough.
  const refs2 = faceReferences();
  for (const person of facePeopleFolders()) {
    const pr = refs2.get(person.id);
    if (!pr) continue;
    const theirs = new Set(appData.files.filter(f => f.folders?.includes(person.id)).map(f => f.id));
    const byPhoto = new Map();
    for (const face of faceStore.faces) {
      if (face.p || !theirs.has(face.f) || face.no?.includes(person.id)) continue;
      const dist = faceDistToPerson(faceDesc(face), pr);
      if (dist < FACE_LEARN_DIST && (!byPhoto.has(face.f) || dist < byPhoto.get(face.f).dist)) byPhoto.set(face.f, { face, dist });
    }
    const already = new Set(faceStore.faces.filter(f => f.p === person.id).map(f => f.f));
    for (const { face } of byPhoto.values()) {
      if (already.has(face.f)) continue; // they're already found in that photo
      face.p = person.id; face.a = 'learned'; learned++;
    }
  }
  return learned;
}

// A photo already filed under people knows who's in it - so when Trove has found all of them
// but one, and one face in it is still unknown, that face is them. No question needed: that's
// exactly the photo of five where four are recognised. With more unknown faces than missing
// people (strangers in the background), the missing person is the unknown face clearly closest
// to their known faces. Either way the face has to be plausibly them and not clearly somebody
// else. Each match makes the next photo easier, so it goes round until nothing changes.
function faceLearnByElimination() {
  const peopleIds = new Set(facePeopleFolders().map(p => p.id));
  const files = new Map(appData.files.map(f => [f.id, f]));
  const byPhoto = new Map();
  for (const f of faceStore.faces) {
    if (f.p === 'x') continue;
    if (!byPhoto.has(f.f)) byPhoto.set(f.f, []);
    byPhoto.get(f.f).push(f);
  }
  const refs = faceReferences();
  let learned = 0;
  for (let round = 0, changed = true; changed && round < 6; round++) {
    changed = false;
    for (const [fid, faces] of byPhoto) {
      const tagged = (files.get(fid)?.folders || []).filter(id => peopleIds.has(id));
      if (!tagged.length) continue;
      const found = new Set(faces.filter(f => f.p).map(f => f.p));
      const missing = tagged.filter(id => !found.has(id));
      const unknown = faces.filter(f => !f.p);
      if (missing.length !== 1 || !unknown.length) continue;
      const pid = missing[0], theirs = refs.get(pid);
      const candidates = unknown.filter(f => !f.no?.includes(pid)).map(f => {
        const d = faceDesc(f);
        return { f, d, dist: theirs ? faceDistToPerson(d, theirs) : null };
      });
      let pick = null;
      if (candidates.length === 1 && unknown.length === 1) pick = candidates[0];
      else if (theirs && candidates.length) {
        candidates.sort((a, b) => a.dist - b.dist);
        if (candidates[0].dist < FACE_SUGGEST_DIST && (!candidates[1] || candidates[1].dist - candidates[0].dist > FACE_AUTO_MARGIN)) pick = candidates[0];
      }
      if (!pick) continue;
      if (theirs && pick.dist > 0.62) continue; // nothing like them - more likely they're just not facing the camera here
      const other = faceRanked(pick.d, refs, [pid])[0];
      if (other && other.dist < FACE_AUTO_DIST) continue; // it's clearly someone else Trove knows
      pick.f.p = pid; pick.f.a = 'learned';
      if (!refs.has(pid)) refs.set(pid, []);
      refs.get(pid).push(pick.d);
      learned++; changed = true;
    }
  }
  return learned;
}

// Every face nobody has claimed, measured against everyone's references. Returns how many
// photos were filed under someone they weren't filed under before.
function faceRecognizeUnknown() {
  // Filing on its own needs someone known from at least 3 faces; from fewer, Trove only asks.
  const refs = new Map([...faceReferences()].filter(([, r]) => r.length >= 3));
  if (!refs.size) return 0;
  const claims = new Map(); // photo+person -> best face, so one photo never gets the same person twice
  for (const face of faceStore.faces) {
    if (face.p) continue;
    const [best, second] = faceRanked(faceDesc(face), refs, face.no);
    if (!best || best.dist >= FACE_AUTO_DIST || (second && second.dist - best.dist < FACE_AUTO_MARGIN)) continue;
    const key = face.f + '|' + best.pid;
    const taken = faceStore.faces.some(f => f.f === face.f && f.p === best.pid);
    if (taken) continue;
    if (!claims.has(key) || best.dist < claims.get(key).dist) claims.set(key, { face, pid: best.pid, dist: best.dist });
  }
  const filed = new Set();
  for (const { face, pid } of claims.values()) {
    face.p = pid; face.a = 'auto';
    const file = appData.files.find(f => f.id === face.f);
    if (file && !file.folders?.includes(pid)) {
      (file.folders = file.folders || []).push(pid);
      face.added = true;
      filed.add(file.id);
    }
  }
  return filed.size;
}

// Learn, then recognise - after a scan, after the user names someone, after a correction.
// Debounced, since naming several groups in a row shouldn't re-run it for each.
function faceScheduleRecognize() {
  clearTimeout(faceRecognizeTimer);
  faceRecognizeTimer = setTimeout(faceRecognizeNow, 600);
}
async function faceRecognizeNow() {
  if (!faceRecognitionEnabled() || !faceStore) return;
  let learned = faceLearnFromFolders() + faceLearnByElimination();
  const filed = faceRecognizeUnknown();
  if (filed) learned += faceLearnByElimination(); // newly filed photos can settle more of them
  if (learned || filed) faceScheduleSave();
  if (filed) {
    await saveData();
    toast(`Recognised people in ${filed} photo${filed === 1 ? '' : 's'} and filed them under their names`, 4000);
  }
  faceSchedulePictures();
  faceRefreshReviewCount();
  if (document.getElementById('facesMode')?.classList.contains('open')) renderFacesMode();
  if (typeof gsFacesChanged === 'function') gsFacesChanged(); // what's already filed, and who's known, may have changed
}

// "That's not them": the face goes back to unknown, that person is never suggested for it
// again, and a photo recognition filed because of it comes back out of their folder (unless
// they're recognised in it some other way).
async function faceUnassign(faceId) {
  const face = faceStore?.faces.find(f => f.id === faceId);
  if (!face || !face.p || face.p === 'x') return;
  const pid = face.p;
  face.no = [...new Set([...(face.no || []), pid])];
  if (face.added && !faceStore.faces.some(f => f !== face && f.f === face.f && f.p === pid)) {
    const file = appData.files.find(f => f.id === face.f);
    if (file?.folders) file.folders = file.folders.filter(id => id !== pid);
  }
  face.p = null; delete face.a; delete face.added;
  faceScheduleSave();
  await saveData();
  renderFacesMode();
}

// Greedy grouping: each unclaimed face joins the nearest group whose average face is within
// FACE_GROUP_DIST, or starts its own. Then every group is compared with each known person for
// an "Is this ...?" suggestion.
function faceGroups() {
  if (!faceStore) return [];
  const groups = [];
  for (const face of faceStore.faces) {
    if (face.p) continue;
    const d = faceDesc(face);
    let best = null, bestDist = FACE_GROUP_DIST;
    for (const g of groups) {
      const dist = faceDist(d, g.centroid);
      if (dist < bestDist) { best = g; bestDist = dist; }
    }
    if (best) {
      best.faces.push(face);
      for (let i = 0; i < d.length; i++) { best.sum[i] += d[i]; best.centroid[i] = best.sum[i] / best.faces.length; }
    } else {
      groups.push({ faces: [face], sum: Float32Array.from(d), centroid: Float32Array.from(d) });
    }
  }
  const refs = faceReferences();
  for (const g of groups) {
    // People any face in the group was already said not to be are never suggested for it.
    const no = [...new Set(g.faces.flatMap(f => f.no || []))];
    const best = faceRanked(g.centroid, refs, no)[0];
    g.suggest = best && best.dist < FACE_SUGGEST_DIST ? best.pid : null;
    g.fileIds = [...new Set(g.faces.map(f => f.f))];
  }
  groups.sort((a, b) => (b.suggest ? 1 : 0) - (a.suggest ? 1 : 0) || b.fileIds.length - a.fileIds.length);
  return groups;
}
function facePeopleFolders() {
  const root = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  return root ? appData.folders.filter(f => f.parentId === root.id) : [];
}

// ── What's worth asking ──────────────────────────────────────────────────────
// Only faces that belong to nobody in People. Everything already explained - recognised,
// learned from a folder, worked out by elimination - never shows up here. What's left:
//   - someone already in People but not recognised in these photos ("Is this Dad?"),
//   - someone who keeps turning up but isn't in People at all (in 2+ photos), and
//   - the one extra person in a group photo with people Trove knows, even if it's the only
//     photo they're in - unless they're small in the background, which is a passer-by.
function faceReviewGroups() {
  if (!faceStore) return [];
  const byPhoto = new Map();
  for (const f of faceStore.faces) { if (!byPhoto.has(f.f)) byPhoto.set(f.f, []); byPhoto.get(f.f).push(f); }
  const faceSize = f => Math.sqrt((f.b?.[2] || 0) * (f.b?.[3] || 0));
  const partOfTheGroup = f => {
    const others = byPhoto.get(f.f) || [];
    if (!others.some(o => o !== f && o.p && o.p !== 'x')) return false;
    return faceSize(f) >= 0.6 * Math.max(...others.map(faceSize));
  };
  const people = new Map(facePeopleFolders().map(p => [p.id, p]));
  return faceGroups().filter(g => g.suggest || g.fileIds.length >= 2 || partOfTheGroup(g.faces[0])).map(g => {
    // Who they're pictured with, as a hint for who they might be.
    const withIds = new Set();
    for (const fid of g.fileIds) for (const o of byPhoto.get(fid) || []) if (o.p && people.has(o.p)) withIds.add(o.p);
    g.with = [...withIds].map(id => people.get(id));
    return g;
  });
}
// The review list as it's shown: one card per person already in People (however many small
// groups of their face there are - "Me" in 27 separate cards was noise), then one per new person.
function faceReviewItems() {
  const groups = faceReviewGroups();
  const refs = faceReferences();
  const byPerson = new Map();
  for (const g of groups) {
    if (!g.suggest) continue;
    let c = byPerson.get(g.suggest);
    if (!c) { c = { suggest: g.suggest, faces: [], fileIds: [], with: [], combined: true }; byPerson.set(g.suggest, c); }
    // A group is suggested by its average face, which an odd face can ride along with - so each
    // face has to be close to the person on its own (this is what kept a bear and a tower out of
    // "Are these Me?").
    const theirs = refs.get(g.suggest) || [];
    for (const f of g.faces) {
      if (f.no?.includes(g.suggest) || !theirs.length || faceDistToPerson(faceDesc(f), theirs) >= FACE_SUGGEST_DIST) continue;
      c.faces.push(f);
      c.fileIds.push(f.f);
    }
  }
  for (const [pid, c] of byPerson) {
    c.fileIds = [...new Set(c.fileIds)];
    if (!c.faces.length) byPerson.delete(pid);
  }
  return {
    knownButNotHere: [...byPerson.values()].sort((a, b) => b.fileIds.length - a.fileIds.length),
    newPeople: groups.filter(g => !g.suggest),
  };
}
// ── Guided Sort's People step ────────────────────────────────────────────────
// Photos waiting to be sorted are the ones nobody has filed under anyone yet, which is where
// recognition saves the most clicks. For each person already in People: the photos in the batch
// their face turns up in that aren't in their folder yet - one face per photo, the closest.
// Faces recognition was sure of are already filed (faceRecognizeUnknown); these are the ones
// close enough to ask about.
function faceBatchSuggestions(files) {
  if (!faceRecognitionEnabled() || !faceStore) return [];
  const inBatch = new Map(files.map(f => [f.id, f]));
  const refs = faceReferences();
  const people = new Map(facePeopleFolders().map(p => [p.id, p]));
  const best = new Map(); // person|photo -> { face, pid, dist }
  for (const face of faceStore.faces) {
    const file = inBatch.get(face.f);
    if (!file || face.p) continue; // named, recognised, or set aside as nobody
    const [top, next] = faceRanked(faceDesc(face), refs, face.no);
    if (!top || top.dist >= FACE_SUGGEST_DIST || !people.has(top.pid)) continue;
    if (next && next.dist - top.dist < 0.03) continue; // as much one person as another - not worth a guess
    if (file.folders?.includes(top.pid)) continue;
    const key = top.pid + '|' + face.f;
    if (!best.has(key) || top.dist < best.get(key).dist) best.set(key, { face, pid: top.pid, dist: top.dist });
  }
  const byPerson = new Map();
  for (const s of best.values()) {
    if (!byPerson.has(s.pid)) byPerson.set(s.pid, []);
    byPerson.get(s.pid).push(s);
  }
  return [...byPerson].map(([pid, list]) => ({ person: people.get(pid), faces: list.sort((a, b) => a.dist - b.dist).map(s => s.face) }))
    .sort((a, b) => b.faces.length - a.faces.length);
}
// "Yes, that's them": the faces are named (so they teach recognition like any face named in the
// People screen) and their photos go into the person's folder.
async function faceBatchConfirm(personId, faceIds) {
  if (!faceStore) return 0;
  const ids = new Set(faceIds);
  const photos = new Set();
  for (const face of faceStore.faces) {
    if (!ids.has(face.id)) continue;
    face.p = personId; delete face.a; delete face.added;
    photos.add(face.f);
  }
  for (const id of photos) {
    const file = appData.files.find(f => f.id === id);
    if (file && !file.folders?.includes(personId)) (file.folders = file.folders || []).push(personId);
  }
  faceScheduleSave();
  await saveData();
  faceScheduleRecognize(); // more to go on for everyone who looks like them
  return photos.size;
}
// "Not them": never suggested as that person again.
function faceBatchReject(personId, faceIds) {
  if (!faceStore) return;
  const ids = new Set(faceIds);
  for (const face of faceStore.faces) if (ids.has(face.id)) face.no = [...new Set([...(face.no || []), personId])];
  faceScheduleSave();
}
// A face much smaller than the biggest one in its photo is someone in the background - a
// passer-by, not someone to tag. Asking about them would never end.
function faceIsBackground(face, photoFaces) {
  const size = f => Math.sqrt((f.b?.[2] || 0) * (f.b?.[3] || 0));
  return photoFaces.length > 1 && size(face) < 0.5 * Math.max(...photoFaces.map(size));
}
function faceByPhoto(fileIds) {
  const byPhoto = new Map();
  if (!faceStore) return byPhoto;
  for (const f of faceStore.faces) {
    if (!fileIds.has(f.f)) continue;
    if (!byPhoto.has(f.f)) byPhoto.set(f.f, []);
    byPhoto.get(f.f).push(f);
  }
  return byPhoto;
}
// Faces nobody has accounted for yet: not named, not recognised, not set aside, not background.
function faceUnresolved(photoFaces) {
  return photoFaces.filter(f => !f.p && !faceIsBackground(f, photoFaces));
}
// Where a photo stands for the People step: 'unscanned', 'open' (someone in it still to
// account for), 'done' (everyone in it is accounted for) or 'nobody' (no face found - which
// can still be someone from behind, so it stays for tagging by hand).
function faceBatchPhotoState(file, byPhoto) {
  if (!faceRecognitionEnabled() || !faceStore || !isImg(file.ext)) return 'unscanned';
  if (!faceStore.scanned[file.id]) return 'unscanned';
  const faces = byPhoto.get(file.id) || [];
  if (!faces.length) return 'nobody';
  return faceUnresolved(faces).length ? 'open' : 'done';
}
// A photo that's already filed under someone, with a face in it that looks like them and isn't
// claimed yet: that face is them. Settles photos that were tagged by hand before recognition
// had a look, so they aren't asked about again.
function faceBatchSettle(files) {
  if (!faceRecognitionEnabled() || !faceStore) return 0;
  const refs = faceReferences();
  const byPhoto = faceByPhoto(new Set(files.map(f => f.id)));
  let settled = 0;
  for (const file of files) {
    const faces = byPhoto.get(file.id);
    if (!faces) continue;
    for (const pid of file.folders || []) {
      const theirs = refs.get(pid);
      if (!theirs || faces.some(f => f.p === pid)) continue;
      let pick = null;
      for (const f of faces) {
        if (f.p || f.no?.includes(pid)) continue;
        const dist = faceDistToPerson(faceDesc(f), theirs);
        if (dist < FACE_SUGGEST_DIST && (!pick || dist < pick.dist)) pick = { f, dist };
      }
      if (pick) { pick.f.p = pid; pick.f.a = 'learned'; settled++; }
    }
    // Tagged by hand with someone Trove has no face for yet (or doesn't find here), and exactly
    // one face left unexplained: that's them - the same reasoning as faceLearnByElimination.
    const peopleIds = new Set(facePeopleFolders().map(p => p.id));
    const missing = (file.folders || []).filter(id => peopleIds.has(id) && !faces.some(f => f.p === id));
    const open = faceUnresolved(faces);
    if (missing.length === 1 && open.length === 1 && !open[0].no?.includes(missing[0])) {
      const theirs = refs.get(missing[0]);
      if (!theirs || faceDistToPerson(faceDesc(open[0]), theirs) < 0.62) { open[0].p = missing[0]; open[0].a = 'learned'; settled++; }
    }
  }
  if (settled) faceScheduleSave();
  return settled;
}
// The faces in the batch nobody could put a name to, grouped by likeness, biggest group first:
// what the People step asks "Who is this?" about once the known people are dealt with.
function faceBatchUnknownGroups(files) {
  if (!faceRecognitionEnabled() || !faceStore) return [];
  const byPhoto = faceByPhoto(new Set(files.map(f => f.id)));
  const groups = [];
  for (const faces of byPhoto.values()) {
    for (const face of faceUnresolved(faces)) {
      const d = faceDesc(face);
      let best = null, bestDist = FACE_GROUP_DIST;
      for (const g of groups) { const dist = faceDist(d, g.centroid); if (dist < bestDist) { best = g; bestDist = dist; } }
      if (best) {
        best.faces.push(face);
        for (let i = 0; i < d.length; i++) { best.sum[i] += d[i]; best.centroid[i] = best.sum[i] / best.faces.length; }
      } else groups.push({ faces: [face], sum: Float32Array.from(d), centroid: Float32Array.from(d) });
    }
  }
  groups.forEach(g => { g.fileIds = [...new Set(g.faces.map(f => f.f))]; });
  return groups.sort((a, b) => b.fileIds.length - a.fileIds.length);
}
// "Don't tag": set aside for good, here and in the People screen.
function faceBatchIgnore(faceIds) {
  if (!faceStore) return;
  const ids = new Set(faceIds);
  for (const face of faceStore.faces) if (ids.has(face.id)) face.p = 'x';
  faceScheduleSave();
}
// The batch on screen goes to the front of the scan queue: the rest of the library can wait,
// the person sorting these can't. Returns how many of them weren't scanned yet.
function faceScanFirst(files) {
  if (!faceRecognitionEnabled() || !faceStore) return 0;
  const want = files.filter(f => isImg(f.ext) && !f._missing && !f.isLivePhotoVideo && (f.ext || '').toLowerCase() !== '.insp' && !faceStore.scanned[f.id]).map(f => f.id);
  if (!want.length) return 0;
  const first = new Set(want);
  faceQueue = want.concat(faceQueue.filter(id => !first.has(id)));
  want.forEach(id => faceQueueSet.add(id));
  faceRunLoop();
  return want.length;
}

function faceRefreshReviewCount() {
  clearTimeout(faceReviewCountTimer);
  faceReviewCountTimer = setTimeout(() => {
    const items = faceRecognitionEnabled() ? faceReviewItems() : null;
    faceReviewCount = items ? items.knownButNotHere.length + items.newPeople.length : 0;
    if (typeof updateSortButton === 'function') updateSortButton();
  }, 400);
}
function faceUpdateProgressUi() {
  const el = document.getElementById('facesProgress');
  if (!el || !faceStore) return;
  const total = appData.files.filter(f => isImg(f.ext) && !f._missing && !f.isLivePhotoVideo).length;
  // What's left in the queue says how far along it is - during a rescan every photo was scanned before.
  const done = total - faceQueue.length;
  el.textContent = faceQueue.length ? `Looking for faces… ${Math.min(done, total).toLocaleString()} of ${total.toLocaleString()} photos · ${faceFmtEta(faceScanEta())}` : `${faceStore.faces.length.toLocaleString()} faces in ${total.toLocaleString()} photos`;
}

// ── Review screen ────────────────────────────────────────────────────────────
async function openFacesMode() {
  document.getElementById('facesMode').classList.add('open');
  faceModeLimit = 40;
  faceModeShowSingles = false;
  faceModePerson = null;
  if (!faceRecognitionEnabled()) { renderFacesMode(); return; }
  const run = ++faceLoadRun;
  faceLoadingActive = true;
  await initFaceIndex();
  // The search itself - learn from the People folders, recognise, work out group photos - runs
  // while every face Trove already knows fills the screen, so the wait shows what it's doing.
  let done = false;
  clearTimeout(faceRecognizeTimer);
  faceRecognizeNow().catch(() => {}).finally(() => { done = true; });
  await faceLoadingAnimation(() => run !== faceLoadRun || !document.getElementById('facesMode').classList.contains('open'), () => done && !faceQueue.length);
  if (run !== faceLoadRun) return;
  faceLoadingActive = false;
  renderFacesMode();
}

// ── The loading screen ───────────────────────────────────────────────────────
// Every face Trove has recognised, one bubble at a time in random order and random places,
// until the screen is full - about two seconds. If the search is still going then (a scan of
// new photos, say), the full screen keeps quietly swapping faces until it's done.
let faceLoadRun = 0;
let faceLoadingActive = false; // renderFacesMode holds off while the animation owns the screen
const FACE_LOAD_BUBBLE = 60, FACE_LOAD_GAP = 8, FACE_LOAD_FILL_MS = 1800;
const faceSleep = ms => new Promise(r => setTimeout(r, ms));
function faceShuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
async function faceLoadingAnimation(cancelled, finished) {
  const body = document.getElementById('facesBody');
  const progress = document.getElementById('facesProgress');
  if (progress) progress.textContent = 'Looking for everyone…';
  const known = faceStore ? faceStore.faces.filter(f => f.p && f.p !== 'x') : [];
  if (!known.length) {
    body.innerHTML = `<div class="empty-state"><div class="dup-spinner"></div><div class="empty-title">Looking for the people in your photos…</div></div>`;
    while (!finished() && !cancelled()) await faceSleep(200);
    return;
  }
  const rect = body.getBoundingClientRect();
  const cell = FACE_LOAD_BUBBLE + FACE_LOAD_GAP;
  const cols = Math.max(1, Math.floor((rect.width - 40) / cell));
  const rows = Math.max(1, Math.floor((rect.height - 70) / cell));
  const slots = Math.min(cols * rows, 480);
  // Every recognised face gets shown; with more slots than faces, they come round again.
  let pool = faceShuffle(known);
  const faces = Array.from({ length: slots }, (_, i) => pool[i % pool.length]);
  const crops = await window.api.faceCropsGet([...new Set(faces.map(f => f.id))]).catch(() => ({}));
  if (cancelled()) return;
  const url = f => crops[f.id] ? `url("data:image/jpeg;base64,${crops[f.id]}")` : '';
  faceJustFound.length = 0; // only faces found from here on get the "just found" pop
  body.innerHTML = `<div class="face-load-caption">Finding everyone in your photos…</div>
    <div class="face-load-progress" style="display:none"><div class="face-load-bar"><span></span></div><div class="face-load-stats"></div></div>
    <div class="face-load" style="grid-template-columns:repeat(${cols}, ${FACE_LOAD_BUBBLE}px)">${'<span class="face-load-slot"></span>'.repeat(slots)}</div>`;
  const els = [...body.querySelectorAll('.face-load-slot')];
  const order = faceShuffle(els.map((_, i) => i));
  const ticks = 60, perTick = Math.max(1, Math.ceil(slots / ticks));
  for (let t = 0; t < order.length; t += perTick) {
    if (cancelled()) return;
    for (const i of order.slice(t, t + perTick)) {
      els[i].style.backgroundImage = url(faces[i]);
      els[i].classList.add('in');
    }
    await faceSleep(FACE_LOAD_FILL_MS / ticks);
  }
  // Full. Still searching (a scan of new photos, a rescan)? Then the wall shows it moving: a
  // bar and the time left, and every face the scan finds pops onto the wall as it's found, ringed
  // so it stands out. Between finds, the wall keeps gently turning over.
  const caption = body.querySelector('.face-load-caption');
  const prog = body.querySelector('.face-load-progress');
  const fill = body.querySelector('.face-load-bar span');
  const stats = body.querySelector('.face-load-stats');
  while (!finished()) {
    if (cancelled()) return;
    if (faceQueue.length && faceScanStats) {
      const total = faceScanStats.total, done = Math.max(0, total - faceQueue.length);
      const found = Math.max(0, (faceStore?.faces.length || 0) - faceScanStats.facesAtStart);
      prog.style.display = '';
      fill.style.width = `${Math.min(100, (done / Math.max(1, total)) * 100).toFixed(1)}%`;
      stats.textContent = `${done.toLocaleString()} of ${total.toLocaleString()} photos · ${found ? `${found.toLocaleString()} new face${found === 1 ? '' : 's'} found · ` : ''}${faceFmtEta(faceScanEta())}`;
      caption.textContent = 'Looking through your photos for faces. It keeps going if you switch to something else.';
    }
    const el = els[Math.floor(Math.random() * els.length)];
    const fresh = faceJustFound.shift();
    if (fresh) {
      el.classList.remove('in', 'new');
      await faceSleep(120);
      el.style.backgroundImage = `url("data:image/jpeg;base64,${fresh.b64}")`;
      el.classList.add('in', 'new');
      setTimeout(() => el.classList.remove('new'), 2200);
      await faceSleep(220);
      continue;
    }
    const f = known[Math.floor(Math.random() * known.length)];
    if (!crops[f.id]) { const more = await window.api.faceCropsGet([f.id]).catch(() => ({})); Object.assign(crops, more); }
    el.classList.remove('in');
    await faceSleep(180);
    el.style.backgroundImage = url(f);
    el.classList.add('in');
    await faceSleep(faceQueue.length ? 260 : 0);
  }
  await faceSleep(300); // let the last bubble land before the results replace the wall
}
function closeFacesMode() {
  document.getElementById('facesMode').classList.remove('open');
  faceLoadRun++; // stops a loading wall mid-way
  faceLoadingActive = false;
  faceRefreshReviewCount();
}

async function renderFacesMode() {
  const body = document.getElementById('facesBody');
  if (!body || faceLoadingActive) return; // the loading wall owns the screen until it's done
  if (!faceRecognitionEnabled()) {
    document.getElementById('facesProgress').textContent = '';
    body.innerHTML = `<div class="faces-optin">
      <div class="faces-optin-icon">${peIcon('faceScan')}</div>
      <h2>Find the people in your photos</h2>
      <p>Trove learns who is who from the People folders you already have, then finds those people in the rest of your photos and files them under their names. It only asks about faces it doesn't recognise.</p>
      <ul>
        <li>It runs entirely on this computer. No photo or face ever leaves it.</li>
        <li>It only files a photo when it's sure. Close calls are asked, never guessed.</li>
        <li>Anything it got wrong is one click to undo, and it remembers the correction.</li>
        <li>Switch it off any time in Settings, and every bit of face data is deleted.</li>
      </ul>
      <button class="btn-save" onclick="setFaceRecognition(true)">Turn on face recognition</button>
    </div>`;
    return;
  }
  faceUpdateProgressUi();
  if (faceModePerson === '*') {
    body.innerHTML = `<button class="btn-cancel" onclick="faceModePerson=null;renderFacesMode()">Back</button><div style="height:14px"></div>` + faceKnownHtml();
    return;
  }
  if (faceModePerson) { await renderFacePersonCheck(body, faceModePerson); return; }
  const { knownButNotHere, newPeople } = faceReviewItems();
  const groups = [...knownButNotHere, ...newPeople];
  const shown = groups.slice(0, faceModeLimit);
  const people = facePeopleFolders();
  const scanning = faceQueue.length > 0;
  const checkLink = `<div class="faces-more"><button class="btn-cancel" onclick="faceModePerson='*';renderFacesMode()">Check who Trove recognised</button>`
    + (scanning ? '' : `<button class="btn-cancel" onclick="faceRescanAll()" title="Look through every photo again for faces the first scan missed. Names and corrections are kept.">Scan all photos again</button>`) + `</div>`;
  if (!groups.length) {
    body.innerHTML = `<div class="faces-empty">${scanning
      ? 'Still looking through your photos. Anyone who isn\'t in People yet will appear here.'
      : faceStore.faces.length ? 'Everyone in your photos is already in People. New photos are checked as you add them.' : 'No faces found in your photos yet.'}</div>` + checkLink;
    return;
  }
  const idx = g => shown.indexOf(g);
  const section = (title, intro, list) => list.length ? `<div class="faces-section-title">${title}</div><p class="faces-intro">${intro}</p>
    <div class="faces-grid">${list.filter(g => idx(g) >= 0).map(g => faceGroupCardHtml(g, idx(g))).join('')}</div>` : '';
  body.innerHTML = `<datalist id="facesPeopleList">${people.map(p => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>`
    + section('Already in People, missing from these photos', 'Trove thinks these are people you already have, in photos that aren\'t in their folder yet.', knownButNotHere)
    + section('Not in People yet', 'People in your photos who aren\'t in People. Add them and every photo they\'re in is filed under their name, and Trove will recognise them from now on.', newPeople)
    + (groups.length > faceModeLimit ? `<div class="faces-more"><button class="btn-cancel" onclick="faceModeLimit += 40; renderFacesMode()">Show more</button></div>` : '')
    + checkLink;
  window.facesShownGroups = shown;
  // Crops load after the layout, straight into their slots.
  const ids = shown.flatMap(g => g.faces.slice(0, g.combined ? 60 : 8).map(f => f.id));
  const crops = await window.api.faceCropsGet(ids).catch(() => ({}));
  for (const [id, b64] of Object.entries(crops)) {
    const el = body.querySelector(`[data-face="${id}"]`);
    if (el) el.style.backgroundImage = `url("data:image/jpeg;base64,${b64}")`;
  }
}

function faceGroupCardHtml(g, i) {
  const person = g.suggest ? appData.folders.find(f => f.id === g.suggest) : null;
  // A person's combined card shows every face, since "Yes" files them all - each one has to be
  // checkable (and removable with its ✕) before that.
  const maxCrops = g.combined ? 60 : 8;
  const crops = g.faces.slice(0, maxCrops).map(f =>
    `<span class="face-crop" data-face="${f.id}"><button class="face-crop-x" title="${person ? `Not ${esc(person.name)}` : 'Not the same person - leave this face out'}" onclick="faceExclude('${f.id}', '${g.suggest || ''}')">${peIcon('close')}</button></span>`).join('');
  const more = g.faces.length > maxCrops ? `<span class="face-crop-more">+${g.faces.length - maxCrops}</span>` : '';
  const withText = g.with?.length ? ` · with ${g.with.slice(0, 3).map(p => esc(p.name)).join(', ')}${g.with.length > 3 ? '…' : ''}` : '';
  const count = `In ${g.fileIds.length} photo${g.fileIds.length === 1 ? '' : 's'}${withText}`;
  const ask = person
    ? `<div class="face-ask">${g.combined ? 'Are these' : 'Is this'} ${folderIconHtml(person, 18)} <b>${esc(person.name)}</b>?${g.combined ? ' Remove any that are not, with their ✕, first.' : ''}</div>
       <div class="face-actions">
         <button class="btn-save" onclick="faceNameGroup(${i}, '${person.id}')">${g.combined ? `Yes, add ${g.fileIds.length} photo${g.fileIds.length === 1 ? '' : 's'}` : 'Yes'}</button>
         <button class="btn-cancel" onclick="faceRejectSuggestion(${i})">No, someone else</button>
       </div>`
    : `<div class="face-actions">
         <input class="text-input" id="faceName-${i}" list="facesPeopleList" placeholder="Their name" onkeydown="if(event.key==='Enter')faceNameGroupFromInput(${i})"/>
         <button class="btn-save" onclick="faceNameGroupFromInput(${i})">Add to People</button>
       </div>`;
  return `<div class="face-card${g.combined ? ' face-card-wide' : ''}">
    <div class="face-crops">${crops}${more}</div>
    <div class="face-meta"><span>${count}</span>${g.combined ? '' : `<button class="face-ignore" onclick="faceIgnoreGroup(${i})" title="Not someone to add - stop suggesting this face">Not needed</button>`}</div>
    ${ask}
  </div>`;
}

async function faceNameGroupFromInput(i) {
  const name = document.getElementById('faceName-' + i)?.value.trim();
  if (!name) return;
  const existing = facePeopleFolders().find(p => p.name.toLowerCase() === name.toLowerCase());
  const person = existing || getOrCreatePersonFolder(name);
  await faceNameGroup(i, person.id);
}
async function faceNameGroup(i, personId) {
  const g = window.facesShownGroups?.[i];
  const person = appData.folders.find(f => f.id === personId);
  if (!g || !person) return;
  g.faces.forEach(f => { f.p = personId; delete f.a; delete f.added; });
  faceScheduleSave();
  await assignFilesToFolderAdditive(g.fileIds, personId); // saves and toasts
  renderFacesMode();
  faceScheduleRecognize(); // more to go on for everyone who looks like them
}
// "No, someone else": those faces are held apart from that person's comparison by naming
// them in the box instead - the card flips to the name input.
function faceRejectSuggestion(i) {
  const g = window.facesShownGroups?.[i];
  if (!g) return;
  // Remembered per face, so this person is never offered for these faces again.
  g.faces.forEach(f => { f.no = [...new Set([...(f.no || []), g.suggest])]; });
  faceScheduleSave();
  if (g.combined) { renderFacesMode(); faceRefreshReviewCount(); return; } // those faces may be someone new - they regroup
  g.suggest = null;
  const cards = document.querySelectorAll('#facesBody .face-card');
  if (cards[i]) cards[i].outerHTML = faceGroupCardHtml(g, i);
  window.api.faceCropsGet(g.faces.slice(0, 8).map(f => f.id)).then(crops => {
    for (const [id, b64] of Object.entries(crops)) {
      const el = document.querySelector(`#facesBody [data-face="${id}"]`);
      if (el) el.style.backgroundImage = `url("data:image/jpeg;base64,${b64}")`;
    }
  }).catch(() => {});
}
function faceIgnoreGroup(i) {
  const g = window.facesShownGroups?.[i];
  if (!g) return;
  g.faces.forEach(f => { f.p = 'x'; });
  faceScheduleSave();
  renderFacesMode();
  faceRefreshReviewCount();
}
// ✕ on one face: on a "Is this Dad?" card it means "not Dad" (the face stays, free to be someone
// else); on a new person's card it means "not someone to add".
function faceExclude(faceId, notPersonId) {
  const face = faceStore?.faces.find(f => f.id === faceId);
  if (!face) return;
  if (notPersonId) face.no = [...new Set([...(face.no || []), notPersonId])];
  else face.p = 'x';
  faceScheduleSave();
  renderFacesMode();
}

// ── People's pictures ────────────────────────────────────────────────────────
// Everyone in People is shown by a real photo of their face, cropped from a photo Trove knows
// they're in. Which one, in order: a face from one of their Best Of photos, then from a pinned
// photo, then simply their best face - smiling, facing the camera, eyes open, and big enough in
// the frame to be sharp. A picture the user set themselves ("Use image as icon") always wins.
// The crops are already on disk; they're loaded once into facePictureCache and handed out
// synchronously to the sidebar and everything else that draws a person (personPictureUrl).
const facePictureCache = new Map(); // personId -> { faceId, url }
let facePictureTimer = null;

// How good a face is as someone's picture, read from its 68 landmarks (in crop pixels).
function faceQuality(face) {
  const l = face.l;
  if (!Array.isArray(l) || l.length !== 136) return 0;
  const P = i => ({ x: l[i * 2], y: l[i * 2 + 1] });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const jaw = dist(P(0), P(16)) || 1;
  const faceH = (P(8).y - (P(19).y + P(24).y) / 2) || 1;
  // Smile: mouth corners lifted above the middle of the lips, and the mouth widened.
  const lipMid = (P(51).y + P(57).y) / 2, corners = (P(48).y + P(54).y) / 2;
  const smile = Math.max(0, Math.min(1, (lipMid - corners) / faceH * 12 + (dist(P(48), P(54)) / jaw - 0.36) * 4));
  // Facing the camera: the tip of the nose halfway between the sides of the jaw.
  const frontal = Math.max(0, 1 - Math.abs(P(30).x - (P(0).x + P(16).x) / 2) / jaw * 5);
  // Eyes open: the gap between the eyelids against the eye's width, both eyes.
  const openness = (a, b, c, d, e, f) => (dist(P(b), P(f)) + dist(P(c), P(e))) / (2 * dist(P(a), P(d)) || 1);
  const eyes = Math.min(1, (openness(36, 37, 38, 39, 40, 41) + openness(42, 43, 44, 45, 46, 47)) / 2 / 0.25);
  // Size in the photo: a bigger face made a sharper crop.
  const size = Math.min(1, Math.sqrt((face.b?.[2] || 0) * (face.b?.[3] || 0)) / 0.2);
  return smile * 1.2 + frontal * 0.8 + eyes * 0.6 + size * 0.6;
}
function facePictureFor(personId, files) {
  const tier = f => { const x = files.get(f.f); return x?.bestOf ? 0 : x?.pinned ? 1 : 2; };
  let best = null, bestKey = null;
  for (const face of faceStore.faces) {
    if (face.p !== personId) continue;
    const key = [tier(face), -faceQuality(face)];
    if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = face; bestKey = key; }
  }
  return best;
}
async function faceRefreshPictures() {
  if (!faceStore || !faceRecognitionEnabled()) {
    if (facePictureCache.size) { facePictureCache.clear(); renderSidebarSections(); }
    return;
  }
  const files = new Map(appData.files.map(f => [f.id, f]));
  const picks = new Map();
  for (const person of facePeopleFolders()) {
    const face = facePictureFor(person.id, files);
    if (face) picks.set(person.id, face.id);
  }
  const loaded = new Set([...facePictureCache.values()].map(c => c.faceId));
  const needed = [...picks.values()].filter(id => !loaded.has(id));
  const crops = needed.length ? await window.api.faceCropsGet(needed).catch(() => ({})) : {};
  let changed = false;
  for (const [pid, faceId] of picks) {
    if (facePictureCache.get(pid)?.faceId === faceId || !crops[faceId]) continue;
    facePictureCache.set(pid, { faceId, url: 'data:image/jpeg;base64,' + crops[faceId] });
    changed = true;
  }
  for (const pid of [...facePictureCache.keys()]) if (!picks.has(pid)) { facePictureCache.delete(pid); changed = true; }
  if (changed) renderSidebarSections();
}
// Cheap to call often: saveData calls it, since starring or pinning a photo can change who
// looks best where.
function faceSchedulePictures() {
  clearTimeout(facePictureTimer);
  facePictureTimer = setTimeout(faceRefreshPictures, 300);
}
function personPictureUrl(folder) {
  if (!folder) return null;
  if (folder.iconImage) return folder.iconImage;
  return facePictureCache.get(folder.id)?.url || null;
}
// For the folder bubbles on a photo's preview: each person's face as it is in *this* photo.
async function facePhotoHeadshots(fileId) {
  if (!faceStore || !faceRecognitionEnabled()) return new Map();
  const faces = faceStore.faces.filter(f => f.f === fileId && f.p && f.p !== 'x');
  if (!faces.length) return new Map();
  const crops = await window.api.faceCropsGet(faces.map(f => f.id)).catch(() => ({}));
  return new Map(faces.filter(f => crops[f.id]).map(f => [f.p, 'data:image/jpeg;base64,' + crops[f.id]]));
}

// ── Recognised people, and checking them ─────────────────────────────────────
function faceKnownHtml() {
  const stats = new Map();
  for (const f of faceStore.faces) {
    if (!f.p || f.p === 'x') continue;
    const s = stats.get(f.p) || { photos: new Set(), added: 0 };
    s.photos.add(f.f);
    if (f.added) s.added++;
    stats.set(f.p, s);
  }
  const people = facePeopleFolders();
  const rows = people.filter(p => stats.has(p.id)).map(p => {
    const s = stats.get(p.id);
    return `<div class="face-known">${folderIconHtml(p, 32)}
      <div class="face-known-text"><b>${esc(p.name)}</b><span>In ${s.photos.size} photo${s.photos.size === 1 ? '' : 's'}${s.added ? ` · ${s.added} filed automatically` : ''}</span></div>
      <button class="btn-cancel" onclick="faceModePerson='${p.id}';renderFacesMode()">Check</button>
    </div>`;
  });
  const waiting = people.filter(p => !stats.has(p.id)).map(p => esc(p.name));
  if (!rows.length && !waiting.length) return '';
  return `<div class="faces-section-title">Recognised</div>
    ${rows.length ? `<div class="face-known-grid">${rows.join('')}</div>` : ''}
    ${waiting.length ? `<p class="faces-note">Not recognised yet: ${waiting.join(', ')}. Trove learns someone from the photos in their People folder, so a few more photos of them there, or naming them below, is all it takes.</p>` : ''}`;
}
async function renderFacePersonCheck(body, personId) {
  const person = appData.folders.find(f => f.id === personId);
  if (!person) { faceModePerson = null; renderFacesMode(); return; }
  // Trove's own conclusions first - those are the ones worth a look.
  const rank = f => (f.a === 'auto' ? 0 : f.a === 'learned' ? 1 : 2);
  const faces = faceStore.faces.filter(f => f.p === personId).sort((a, b) => rank(a) - rank(b)).slice(0, 400);
  const how = f => f.a === 'auto' ? 'Recognised' : f.a === 'learned' ? 'Learned from their folder' : 'You named this one';
  body.innerHTML = `<button class="btn-cancel" onclick="faceModePerson='*';renderFacesMode()">Back</button>
    <div class="faces-check-title">${folderIconHtml(person, 36)} <b>${esc(person.name)}</b></div>
    <p class="faces-intro">Every face Trove thinks is ${esc(person.name)}. Remove any that aren't: a photo Trove filed because of it comes back out of ${esc(person.name)}'s folder, and that face won't be put down as them again.</p>
    <div class="face-crops face-check-grid">${faces.map(f => `<span class="face-crop face-crop-lg${f.a === 'auto' ? ' auto' : ''}" data-face="${f.id}" title="${how(f)}"><button class="face-crop-x" title="Not ${esc(person.name)}" onclick="faceUnassign('${f.id}')">${peIcon('close')}</button></span>`).join('')}</div>`;
  const crops = await window.api.faceCropsGet(faces.map(f => f.id)).catch(() => ({}));
  for (const [id, b64] of Object.entries(crops)) {
    const el = body.querySelector(`[data-face="${id}"]`);
    if (el) el.style.backgroundImage = `url("data:image/jpeg;base64,${b64}")`;
  }
}

// ── Switching it on and off ──────────────────────────────────────────────────
async function setFaceRecognition(on) {
  if (on === faceRecognitionEnabled()) return;
  if (!on) {
    if (!confirm('Turn off face recognition? Every face Trove has found and grouped is deleted. People folders and the photos in them stay as they are.')) {
      const box = document.getElementById('setFaceRecognition');
      if (box) box.checked = true;
      return;
    }
    appData.settings.faceRecognition = false;
    faceQueue = []; faceQueueSet.clear();
    clearTimeout(faceSaveTimer);
    faceSaveTimer = null;
    faceStore = null;
    faceDescCache.clear();
    faceReviewCount = 0;
    facePictureCache.clear(); // their pictures were crops of face data that no longer exists
    faceStopWorkers();
    await window.api.facesClear().catch(() => {});
    await saveData();
    toast('Face recognition is off, and its face data has been deleted');
    if (document.getElementById('facesMode')?.classList.contains('open')) renderFacesMode();
    return;
  }
  appData.settings.faceRecognition = true;
  await saveData();
  await initFaceIndex();
  toast('Face recognition is on. Trove is looking through your photos in the background', 4000);
  if (document.getElementById('facesMode')?.classList.contains('open')) renderFacesMode();
}
