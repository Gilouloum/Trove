const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, nativeTheme, Menu, clipboard, powerSaveBlocker, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const TroveMedia = require('./media-types');
const { readHeifLayout } = require('./heif-layout');

// Installed builds keep the library in the OS per-user profile (%APPDATA%/Trove),
// stable across app uninstalls/upgrades. It used to live in a "data" folder next to the exe
// itself (portable-USB use: plug the drive into another PC and the library comes with it),
// but for an NSIS-installed app that folder is inside the install directory the uninstaller
// wipes wholesale on every uninstall/upgrade - see LEGACY_PORTABLE_DIR migration below.
// Dev mode (unpackaged, `npm start`) keeps using a "data" folder next to the source.
const APP_ROOT = app.isPackaged ? path.dirname(process.execPath) : __dirname;
// TROVE_DATA_DIR (set by `npm run dev:sandbox`) runs against a throwaway library in its own
// folder: userData moves there too, so Chromium's storage is separate from an installed Trove's
// and nothing is migrated in from it (LEGACY_USERDATA_DIR below ends up equal to DATA_DIR).
const SANDBOX_DIR = process.env.TROVE_DATA_DIR ? path.resolve(process.env.TROVE_DATA_DIR) : null;
if (SANDBOX_DIR) app.setPath('userData', SANDBOX_DIR);
const DATA_DIR   = (app.isPackaged || SANDBOX_DIR) ? app.getPath('userData') : path.join(APP_ROOT, 'data');
const DATA_PATH  = path.join(DATA_DIR, 'filelinker-data.json');
const THUMB_DIR  = path.join(DATA_DIR, 'thumbs');
const EMBED_DIR  = path.join(DATA_DIR, 'embeddings'); // one small .bin (raw Float32Array) per fileId - see save-embedding below
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LEGACY_USERDATA_DIR = app.getPath('userData');
// Pre-NSIS packaged builds stored the library next to the exe (see above) - only relevant
// for someone upgrading from one of those into this version.
const LEGACY_PORTABLE_DIR = app.isPackaged ? path.join(APP_ROOT, 'data') : null;

// The "Help improve Trove" ping is opt-in (off until the user says yes, see
// showTelemetryNotice() in renderer.js), and still follows the CNIL's audience measurement
// limits on top of that: the install id is replaced at least every 13 months, and every event
// carries an expireAt 25 months out, which the Firestore TTL policy on telemetry_events uses to
// delete it (see telemetry-config.example.js).
const INSTALL_ID_MAX_AGE_MS = 395 * 24 * 60 * 60 * 1000;
const TELEMETRY_RETENTION_MS = 760 * 24 * 60 * 60 * 1000;

const DEFAULT_DATA = () => ({
  // No starter folders - Trips/People/Categories/Cameras roots are created lazily on first use
  // (see getOrCreateVacationsRoot() etc. in renderer.js) and there's no generic catch-all
  // "Folders" section anymore for a couple of arbitrary starter folders to land in.
  folders: [],
  files: [],
  geocodeCache: {},
  routeCache: {},        // matched-road geometry per leg, keyed by its point signature - see matchLegToRoad() in renderer.js
  learnedCrossings: [],  // ferry/train corrections you've made once, auto-applied to matching legs from then on
  legGpxTracks: {},      // imported GPX tracks per hike leg, keyed by leg id - see importGpxForLeg() in renderer.js
  dupIgnoredKeys: [],       // Duplicate Detection groups dismissed as "Not duplicates" - see dupIgnoreGroup() in renderer.js
  editedDismissedKeys: [],  // edit pairs dismissed as "Not a match" - see dupIgnoreGroup() in renderer.js
  hiddenSidebarSections: [], // built-in sections (Trips/People/...) hidden via right-click - see hideSidebarSection() in renderer.js
  stats: {
    bytesDeleted: 0  // running total of real disk space freed via the 'delete-files' IPC handler below - see the sidebar's "space freed" footer in renderer.js
  },
  // Random per-install id, never tied to a person - the only thing that ties telemetry pings
  // together (see the 'send-telemetry' handler below). Backfilled onto pre-existing data files
  // in loadData() too, so upgraders get one without losing anything. Replaced with a fresh one
  // every INSTALL_ID_MAX_AGE_MS (13 months), the CNIL's limit for consent-free audience measurement.
  installId: crypto.randomUUID(),
  installIdCreatedAt: Date.now(),
  settings: {
    allowDeleteFiles: true,
    telemetryEnabled: false, // opt-in - see showTelemetryNotice() in renderer.js
    // Ctrl+scroll-to-resize, Spotify-style - gridCardMin is the library grid's card minimum
    // width (px), sidebarWidth is the sidebar's width (px). See setupDisplayZoom() in renderer.js.
    gridCardMin: 155,
    sidebarWidth: 234,
    mapboxToken: '',
    useMapboxRouting: true,
    // Real elevation data costs real GPU/network (extra terrain tiles + a much
    // heavier mesh than the flat default globe), so this starts off - the globe
    // topbar's "3D Terrain" button is the deliberate opt-in, not a default cost
    // everyone pays. See buildGlobe()/setTerrainEnabled() in globe.js.
    use3dTerrain: false,
    // Mapbox itself has no spending cap (confirmed against their docs) - this is this
    // app's own conservative self-imposed ceiling, checked before every call, so a bug
    // or an unnoticed big trip can't run the account anywhere near real billing. Miles
    // under the real 100k/month free tier; raise it in Settings if you ever need to.
    mapboxMonthlyCap: 8000,
    mapboxCallsThisMonth: 0,
    mapboxCallsMonthKey: '',
    // '' means "follow the OS locale" - see resolveLanguage()/detectDefaultLanguage() in
    // renderer.js. Set once the user picks a language in the first-run wizard or Settings.
    language: ''
  }
});

function listBackupFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const full = path.join(BACKUP_DIR, f);
        const stat = fs.statSync(full);
        return { file: f, full, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch(e) { return []; }
}

function loadData() {
  let data = null;
  if (fs.existsSync(DATA_PATH)) {
    try { data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
    catch(e) {
      // The live file exists but won't parse (corrupted/truncated write). Never silently
      // fall back to an empty library here - that would erase real data on the next save.
      // Recover from the newest backup snapshot instead.
      const backups = listBackupFiles();
      for (const b of backups) {
        try { data = JSON.parse(fs.readFileSync(b.full, 'utf8')); break; } catch(e2) {}
      }
    }
  }
  if (!data) data = DEFAULT_DATA();
  if (!data.installId) data.installId = crypto.randomUUID(); // backfill for data files that predate telemetry
  if (!data.installIdCreatedAt) data.installIdCreatedAt = Date.now(); // backfill for data files that predate rotation
  if (Date.now() - data.installIdCreatedAt > INSTALL_ID_MAX_AGE_MS) {
    data.installId = crypto.randomUUID();
    data.installIdCreatedAt = Date.now();
  }
  return data;
}

let lastSnapshotMs = 0;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // don't snapshot more often than every 15 min
const MAX_BACKUPS = 60;
// A count cap alone doesn't bound disk usage as the library itself grows (each snapshot is
// a full copy of appData) - a large library's 60 backups could be hundreds of MB. This is a
// second, independent cap: whichever limit is hit first wins, always keeping the newest.
const MAX_BACKUP_BYTES = 500 * 1024 * 1024; // 500MB total across all backups

function pruneBackups() {
  const backups = listBackupFiles(); // newest first
  const overCount = backups.slice(MAX_BACKUPS);
  const overCountSet = new Set(overCount.map(b => b.full));
  let runningBytes = 0;
  const overSize = [];
  for (const b of backups) {
    if (overCountSet.has(b.full)) continue; // already being removed above
    runningBytes += b.size;
    if (runningBytes > MAX_BACKUP_BYTES) overSize.push(b);
  }
  for (const b of [...overCount, ...overSize]) { try { fs.unlinkSync(b.full); } catch(e) {} }
}

// Timestamped snapshot into backups/, throttled so routine edits don't spam the disk.
// force=true bypasses the throttle (used once at startup so every session leaves a marker).
// Async and fire-and-forget (never awaited by callers) - it's a background safety net,
// not something any user action should ever wait on.
async function maybeSnapshot(data, force = false) {
  const now = Date.now();
  if (!force && now - lastSnapshotMs < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotMs = now; // claim the slot before the first await so overlapping callers can't both pass the throttle check
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    await fs.promises.writeFile(path.join(BACKUP_DIR, `filelinker-data-${stamp}.json`), JSON.stringify(data, null, 2));
    pruneBackups();
  } catch(e) {}
}

// Atomic write (temp file + rename) so a crash or power loss mid-write can never leave
// filelinker-data.json half-written/corrupted - the rename is a single filesystem op.
// Async: every renderer edit (star, pin, tag, location...) round-trips through this via
// the 'save-data' IPC handler below, and JSON.stringify-ing + writing the whole library
// synchronously would freeze the ENTIRE app (all windows, all IPC) for the duration of
// every single edit on a large library. fs.promises keeps the write off the event loop
// so the app stays responsive while it's in flight.
async function saveData(data) {
  try {
    const tmp = DATA_PATH + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmp, DATA_PATH);
    maybeSnapshot(data); // not awaited - see comment above
  } catch(e) {}
}

// ── EXIF PARSER (images) ─────────────────────────────────────────────────────
function parseExif(filePath) {
  const result = { gps: null, make: null, model: null, dateTime: null };
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 512 * 1024);
    let buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, readSize, 0);
      // TIFF, and the RAW formats built on it (DNG, NEF, ARW, CR2, ORF, RW2, PEF, SRW...), are
      // one big TIFF. Its first IFD is usually near the start, but some writers put it after
      // the image data - 35MB in, on a phone DNG. parseTiff works in file offsets, so the file
      // is laid out at full length with just the start and the IFD's neighbourhood read in:
      // the rest stays zero, never read from disk.
      if (isTiffHeader(buf, 0)) {
        const le = buf[0] === 0x49;
        const ifd0 = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
        if (ifd0 >= readSize && ifd0 < stat.size) {
          const full = Buffer.alloc(Math.min(stat.size, ifd0 + 512 * 1024));
          buf.copy(full, 0);
          fs.readSync(fd, full, ifd0, full.length - ifd0, ifd0);
          buf = full;
        }
      }
    } finally { fs.closeSync(fd); }
    if (isTiffHeader(buf, 0)) { parseTiff(buf, 0, result); return result; }
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2;
      while (i < buf.length - 10) {
        if (buf[i] !== 0xFF) { i++; continue; }
        if (buf[i+1] === 0xE1) {
          const hdr = buf.slice(i+4, i+10).toString('latin1');
          if (hdr.startsWith('Exif\0\0')) { parseTiff(buf, i+10, result); return result; }
        }
        if (buf[i+1] === 0xDA) break;
        const len = (i+2 < buf.length) ? buf.readUInt16BE(i+2) : 0;
        i += 2 + len;
      }
      return result;
    }
    // Everything else with Exif in it: Fujifilm RAF (an embedded JPEG's APP1), Canon CR3 (a
    // bare TIFF inside its CMT1 box), and whatever else tags its Exif the standard way.
    const exifAt = buf.indexOf('Exif\0\0', 0, 'latin1');
    if (exifAt >= 0 && isTiffHeader(buf, exifAt + 6)) { parseTiff(buf, exifAt + 6, result); return result; }
    const cmt1 = buf.indexOf('CMT1', 0, 'latin1');
    if (cmt1 >= 0 && isTiffHeader(buf, cmt1 + 4)) parseTiff(buf, cmt1 + 4, result);
  } catch(e) {}
  return result;
}
function isTiffHeader(buf, at) {
  if (at + 8 > buf.length) return false;
  const a = buf[at], b = buf[at + 1];
  return (a === 0x49 && b === 0x49) || (a === 0x4D && b === 0x4D);
}

function parseTiff(buf, base, result) {
  try {
    if (base + 8 > buf.length) return;
    const le = buf[base] === 0x49 && buf[base+1] === 0x49;
    const r16 = o => base+o+2 <= buf.length ? (le ? buf.readUInt16LE(base+o) : buf.readUInt16BE(base+o)) : 0;
    const r32 = o => base+o+4 <= buf.length ? (le ? buf.readUInt32LE(base+o) : buf.readUInt32BE(base+o)) : 0;
    const rRat = o => { const n=r32(o), d=r32(o+4); return d ? n/d : 0; };
    const rStr = (off, len) => { try { return buf.slice(base+off, base+off+len).toString('latin1').replace(/\0/g,'').trim(); } catch(e){ return ''; }};
    const ifd0Off = r32(4);
    if (!ifd0Off) return;
    const ifd0Count = r16(ifd0Off);
    let gpsOff = null;
    for (let t = 0; t < ifd0Count && t < 100; t++) {
      const e = ifd0Off + 2 + t * 12;
      const tag = r16(e), type = r16(e+2), count = r32(e+4), valOff = e + 8;
      // ASCII values of 4 bytes or less live inline in the entry (e.g. Make "DJI"), not behind an offset.
      if (tag === 0x010F) result.make = count <= 4 ? rStr(valOff, count) : rStr(r32(valOff), Math.min(count, 64));
      else if (tag === 0x0110) result.model = count <= 4 ? rStr(valOff, count) : rStr(r32(valOff), Math.min(count, 64));
      else if (tag === 0x0132) { const off = r32(valOff); result.dateTime = rStr(off, 20); }
      // ImageWidth/ImageLength (used by getTiffSize below for standalone .tiff files - a JPEG's
      // embedded EXIF-TIFF almost never carries these, hence getJpegSize reading the JPEG's own
      // SOF marker instead) - SHORT or LONG, and either way small enough to be stored inline
      // rather than behind an offset, unlike the string tags above.
      else if (tag === 0x0100) result.width = type === 3 ? r16(valOff) : r32(valOff);
      else if (tag === 0x0101) result.height = type === 3 ? r16(valOff) : r32(valOff);
      else if (tag === 0x8769) {
        const exifOff = r32(valOff), exifCount = r16(exifOff);
        for (let et = 0; et < exifCount && et < 200; et++) {
          const ee = exifOff + 2 + et * 12, etag = r16(ee);
          if (etag === 0xA434) result.lensModel = rStr(r32(ee+8), 64);
          if (etag === 0x9003 && !result.dateTime) result.dateTime = rStr(r32(ee+8), 20);
        }
      } else if (tag === 0x8825) { gpsOff = r32(valOff); }
    }
    if (gpsOff) {
      const gpsCount = r16(gpsOff);
      let lat = null, lon = null, latRef = 'N', lonRef = 'E';
      for (let t = 0; t < gpsCount && t < 30; t++) {
        const e = gpsOff + 2 + t * 12, tag = r16(e), valOff = e + 8;
        // GPSLatitudeRef/GPSLongitudeRef are ASCII, count<=4, so the char is
        // stored inline in the value field itself (buf[base+valOff]) - NOT at
        // an offset pointed to by it. Using r32(valOff) here previously read
        // the inline bytes as a bogus pointer and dereferenced garbage memory,
        // which almost never equalled 'S'/'W', silently dropping the sign.
        if (tag === 1) latRef = String.fromCharCode(buf[base + valOff] || 78);
        else if (tag === 3) lonRef = String.fromCharCode(buf[base + valOff] || 69);
        else if (tag === 2) { const off=r32(valOff); lat = rRat(off)+rRat(off+8)/60+rRat(off+16)/3600; }
        else if (tag === 4) { const off=r32(valOff); lon = rRat(off)+rRat(off+8)/60+rRat(off+16)/3600; }
      }
      if (lat !== null && lon !== null && (lat !== 0 || lon !== 0))
        result.gps = { lat: latRef==='S'?-lat:lat, lng: lonRef==='W'?-lon:lon };
    }
  } catch(e) {}
}

// ── HEIC/HEIF METADATA (ISO-BMFF item boxes → locates the Exif item, then reuses
// parseTiff above). HEIC is the default iPhone photo format and stores Exif as a
// named item inside the 'meta' box (via 'iinf'/'iloc'), not as a JPEG APP1 marker,
// so parseExif above always silently returns no GPS for these files ──────────
function iterBoxes(buf, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    let hdrSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      const hi = buf.readUInt32BE(pos + 8), lo = buf.readUInt32BE(pos + 12);
      size = hi * 0x100000000 + lo;
      hdrSize = 16;
    }
    if (size < hdrSize || pos + size > end) break;
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    boxes.push({ type, bodyStart: pos + hdrSize, end: pos + size });
    if (size === 0) break;
    pos += size;
  }
  return boxes;
}

function findHeicExifItem(buf) {
  const meta = iterBoxes(buf, 0, buf.length).find(b => b.type === 'meta');
  if (!meta) return null;
  const metaChildren = iterBoxes(buf, meta.bodyStart + 4, meta.end); // +4 skips meta's own FullBox version/flags

  const iinf = metaChildren.find(b => b.type === 'iinf');
  if (!iinf) return null;
  const iinfVersion = buf[iinf.bodyStart];
  const entryStart = iinf.bodyStart + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifItemId = null;
  for (const b of iterBoxes(buf, entryStart, iinf.end)) {
    if (b.type !== 'infe') continue;
    const iv = buf[b.bodyStart];
    if (iv < 2) continue; // pre-2012 infe layout, not used by any real-world HEIC encoder
    let q = b.bodyStart + 4;
    const itemId = iv === 2 ? buf.readUInt16BE(q) : buf.readUInt32BE(q);
    q += (iv === 2 ? 2 : 4) + 2; // item_ID, then item_protection_index
    if (buf.slice(q, q + 4).toString('ascii') === 'Exif') { exifItemId = itemId; break; }
  }
  if (exifItemId === null) return null;

  const iloc = metaChildren.find(b => b.type === 'iloc');
  if (!iloc) return null;
  let p = iloc.bodyStart;
  const ilocVersion = buf[p];
  p += 4;
  const offsetSize = buf[p] >> 4, lengthSize = buf[p] & 0xF;
  const baseOffsetSize = buf[p + 1] >> 4, indexSize = buf[p + 1] & 0xF;
  p += 2;
  const itemCount = ilocVersion < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p);
  p += ilocVersion < 2 ? 2 : 4;
  const readN = n => {
    if (n === 0) return 0;
    if (n === 4) { const v = buf.readUInt32BE(p); p += 4; return v; }
    const hi = buf.readUInt32BE(p), lo = buf.readUInt32BE(p + 4); p += 8; return hi * 0x100000000 + lo;
  };

  for (let i = 0; i < itemCount; i++) {
    const itemId = ilocVersion < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p);
    p += ilocVersion < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (ilocVersion === 1 || ilocVersion === 2) { constructionMethod = buf.readUInt16BE(p) & 0xF; p += 2; }
    p += 2; // data_reference_index
    const baseOffset = readN(baseOffsetSize);
    const extentCount = buf.readUInt16BE(p); p += 2;
    let firstExtent = null;
    for (let e = 0; e < extentCount; e++) {
      if ((ilocVersion === 1 || ilocVersion === 2) && indexSize > 0) readN(indexSize);
      const extOffset = readN(offsetSize), extLength = readN(lengthSize);
      if (!firstExtent) firstExtent = { offset: extOffset, length: extLength };
    }
    if (itemId === exifItemId) {
      if (constructionMethod !== 0 || !firstExtent) return null; // idat/item-offset items: not worth the extra complexity
      return { offset: baseOffset + firstExtent.offset, length: firstExtent.length };
    }
  }
  return null;
}

function parseHeicExif(filePath) {
  const result = { gps: null, make: null, model: null, dateTime: null };
  try {
    const stat = fs.statSync(filePath);
    const headSize = Math.min(stat.size, 2 * 1024 * 1024);
    const head = Buffer.alloc(headSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, head, 0, headSize, 0);
    fs.closeSync(fd);

    const item = findHeicExifItem(head);
    if (!item || !item.length || item.length > 1024 * 1024) return result;

    const fd2 = fs.openSync(filePath, 'r');
    const exifBuf = Buffer.alloc(item.length);
    fs.readSync(fd2, exifBuf, 0, item.length, item.offset);
    fs.closeSync(fd2);

    // Exif item payload: 4-byte big-endian offset to the TIFF header, then the TIFF itself
    if (exifBuf.length < 10) return result;
    parseTiff(exifBuf, 4 + exifBuf.readUInt32BE(0), result);
  } catch (e) {}
  return result;
}

// ── MP4/MOV METADATA PARSER ──────────────────────────────────────────────────
function parseBoxes(buf, start, end, result, depth) {
  if (depth > 10) return;
  const limit = Math.min(end, buf.length);
  let pos = start;
  while (pos + 8 <= limit) {
    let size = buf.readUInt32BE(pos);
    if (size === 0) size = limit - pos; // "extends to end of enclosing box"
    if (size === 1) {
      if (pos + 16 > buf.length) break;
      size = buf.readUInt32BE(pos + 8) * 0x100000000 + buf.readUInt32BE(pos + 12);
      if (size < 16) break;
    }
    if (size < 8) break;
    const realEnd = Math.min(pos + size, limit);
    const ts = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
    if (ts==='moov'||ts==='udta'||ts==='trak'||ts==='mdia'||ts==='minf') {
      parseBoxes(buf, pos + 8, realEnd, result, depth + 1);
    } else if (ts === 'meta') {
      // Apple's QuickTime 'meta' is a plain container (hdlr comes right after the header);
      // the ISO/MP4 flavour has 4 bytes of version/flags first.
      const qt = pos + 16 <= limit && buf.toString('latin1', pos + 12, pos + 16) === 'hdlr';
      parseBoxes(buf, pos + (qt ? 8 : 12), realEnd, result, depth + 1);
    } else if (ts === 'keys') {
      // QuickTime metadata keys (iPhone): version/flags, count, then [size, namespace, name] entries.
      // The matching 'ilst' items are typed by their 1-based index into this list.
      const keys = [];
      const count = pos + 16 <= limit ? buf.readUInt32BE(pos + 12) : 0;
      let k = pos + 16;
      for (let i = 0; i < count && k + 8 <= realEnd; i++) {
        const ksz = buf.readUInt32BE(k);
        if (ksz < 8) break;
        keys.push(buf.toString('utf8', k + 8, Math.min(k + ksz, realEnd)));
        k += ksz;
      }
      result._keys = keys;
    } else if (ts === 'ilst') {
      if (result._keys) {
        let p = pos + 8;
        while (p + 8 <= realEnd) {
          const isz = buf.readUInt32BE(p);
          if (isz < 8) break;
          const key = result._keys[buf.readUInt32BE(p + 4) - 1];
          const val = key ? extractBoxData(buf, p + 8, Math.min(p + isz, realEnd)) : null;
          if (key === 'com.apple.quicktime.location.ISO6709' && !result.gps) result.gps = parseIso6709(val);
          else if (key === 'com.apple.quicktime.make' && val && !result.make) result.make = val;
          else if (key === 'com.apple.quicktime.model' && val && !result.model) result.model = val;
          else if (key === 'com.apple.quicktime.creationdate' && val && !result.dateTime) result.dateTime = val;
          p += isz;
        }
      }
      parseBoxes(buf, pos + 8, realEnd, result, depth + 1); // iTunes-style ©-named items
    } else if (ts === 'loci' && !result.gps) {
      // 3GPP location box (some Android phones): version/flags, language, a null-terminated
      // place name, a role byte, then longitude, latitude, altitude as signed 16.16 fixed point.
      let p = pos + 14;
      while (p < realEnd && buf[p] !== 0) p++;
      p += 2; // name terminator + role
      if (p + 8 <= realEnd) {
        const lng = buf.readInt32BE(p) / 65536, lat = buf.readInt32BE(p + 4) / 65536;
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) result.gps = { lat, lng };
      }
    } else if (buf[pos+4] === 0xA9) {
      const name = ts.slice(1);
      const val = extractBoxData(buf, pos + 8, realEnd);
      if (name==='mak' && val && !result.make) result.make = val;
      else if (name==='mod' && val && !result.model) result.model = val;
      else if ((name==='day'||name==='crt') && val && !result.dateTime) result.dateTime = val;
      else if (name==='xyz' && val && !result.gps) result.gps = parseIso6709(val); // e.g. "+40.6892-074.0445+009.999/"
    } else if (ts === 'FIRM') {
      if (!result.make) result.make = 'GoPro';
    }
    if (pos + size <= pos) break;
    pos += size;
  }
}

function extractBoxData(buf, start, end) {
  try {
    let pos = start;
    while (pos + 8 <= end && pos + 8 <= buf.length) {
      const sz = buf.readUInt32BE(pos);
      if (sz < 8 || pos + sz > end + 8) break;
      const type = buf.slice(pos+4, pos+8).toString('ascii');
      if (type === 'data' && sz > 16) {
        const s = pos + 16, e2 = Math.min(pos + sz, buf.length);
        if (s < e2) return buf.slice(s, e2).toString('utf8').replace(/\0/g,'').trim() || null;
      }
      if (sz === 0) break;
      pos += sz;
    }
    const raw = buf.slice(start, Math.min(end, buf.length, start + 256)).toString('utf8')
      .replace(/\0/g,'').replace(/[^\x20-\x7e]/g,' ').trim();
    return (raw.length > 1 && raw.length < 128) ? raw : null;
  } catch(e) { return null; }
}

// Finds the 'moov' box (where location/date/camera live) by hopping from one top-level box
// header to the next, then reads just that box. Phones - iPhone .MOV and Android .mp4 alike -
// write moov at the END, after the video data; reading only the first few MB (as this used to)
// never reached it on anything but the shortest clips, so phone videos came in with no location
// even though the phone itself shows one. Box sizes can be 64-bit (videos over 4 GB).
const VIDEO_MOOV_MAX_BYTES = 64 * 1024 * 1024; // moov is small (a few hundred KB even for long clips); cap against corrupt sizes
function parseVideoMeta(filePath) {
  const result = { make: null, model: null, dateTime: null, gps: null };
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const hdr = Buffer.alloc(16);
    let pos = 0, found = false;
    for (let i = 0; i < 256 && pos + 8 <= size; i++) {
      fs.readSync(fd, hdr, 0, 16, pos);
      let boxSize = hdr.readUInt32BE(0), hdrLen = 8;
      const type = hdr.toString('latin1', 4, 8);
      if (boxSize === 1) { boxSize = hdr.readUInt32BE(8) * 0x100000000 + hdr.readUInt32BE(12); hdrLen = 16; }
      else if (boxSize === 0) boxSize = size - pos; // "extends to end of file"
      if (boxSize < hdrLen || !/^[\x20-\x7e]{4}$/.test(type)) break; // not a box stream (or corrupt) - fall back below
      if (type === 'moov') {
        const len = Math.min(boxSize, VIDEO_MOOV_MAX_BYTES, size - pos);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, pos);
        parseBoxes(buf, 0, buf.length, result, 0);
        found = true;
        break;
      }
      pos += boxSize;
    }
    if (!found) {
      // Unusual layouts: fall back to scanning the start of the file, as before.
      const readSize = Math.min(size, 5 * 1024 * 1024);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, 0);
      parseBoxes(buf, 0, buf.length, result, 0);
    }
  } catch(e) {
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch(e) {}
  }
  delete result._keys;
  return result;
}

// ── 360 ANGLE LOCK (Insta360 motion data, see viewer360.js) ─────────────────
// Insta360 cameras append a trailer after the video: a list of records read backwards from a
// fixed 72-byte footer (32 bytes padding, u32 trailer size, u32 version, 32-byte magic). Each
// record ends with [format u8, id u8, size u32 LE] and its payload sits just before that.
//   id 3 = IMU at ~1 kHz, 20 bytes each: u64 µs timestamp, then accel xyz and gyro xyz as
//          u16 offset-binary (0x8000 = zero). Accel is 1024/g, gyro the usual ±2000°/s range -
//          both checked against real X3 footage (gravity magnitude, and gyro-predicted gravity
//          motion matching the accelerometer).
//   id 4 = one entry per video frame, 16 bytes: u64 µs timestamp (same clock as the IMU), f64 exposure.
const INSTA360_MAGIC = '8db42d694ccc418790edff439fe026bf';
function readInsta360Records(filePath, wanted) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 200) return null;
    const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
    const footer = read(size - 72, 72);
    if (footer.toString('latin1', 40, 72) !== INSTA360_MAGIC) return null;
    const trailerSize = footer.readUInt32LE(32);
    const out = {};
    for (let off = 78, n = 0; off < trailerSize && off < size && n < 64; n++) {
      const h = read(size - off, 6), len = h.readUInt32LE(2);
      if (wanted.includes(h[1]) && len > 0 && len < 512 * 1024 * 1024) out[h[1]] = read(size - off - len, len);
      off += len + 6;
    }
    return out;
  } catch (e) { return null; }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) {} }
}

// Lens frame used by the viewer's shader: x right, y up, z out of the front lens. The IMU's
// axes relative to it, for the X3: -X points up the camera body (a tripod clip reads a steady
// (-0.98, 0.10, -0.19) g). The rows are the lens axes written in IMU coordinates.
const INSTA360_LENS_FROM_IMU = { y: [-1, 0, 0], z: [0, 0, 1] };

// One 3x3 matrix per video frame (column-major, ready for gl.uniformMatrix3fv) turning a
// direction in a level, steadily-turning virtual camera into the real lens's frame at that
// instant. Orientation comes from a Mahony-style filter: gyro for the fast motion, gravity
// pulling the tilt back so the horizon stays level and drift can't build up. Heading is not
// locked outright - it follows the camera's own heading through a ~1 s smoothing, so walking
// round a bend still turns the view, but shake and sway don't.
const stabCache = new Map();
function computeInsta360Stabilization(filePath) {
  if (stabCache.has(filePath)) return stabCache.get(filePath);
  const recs = readInsta360Records(filePath, [3, 4]);
  const imu = recs && recs[3], frames = recs && recs[4];
  if (!imu || !frames || imu.length % 20 !== 0 || frames.length % 16 !== 0) return null;
  const n = imu.length / 20, nf = frames.length / 16;
  // Raw 20-byte layout sanity check: timestamps must step by roughly a millisecond.
  const step = Number(imu.readBigUInt64LE(20) - imu.readBigUInt64LE(0));
  if (n < 1000 || nf < 2 || step < 200 || step > 20000) return null;

  const G = 1 / 1024, W = (2000 / 32768) * Math.PI / 180, KP = 0.5;
  const ly = INSTA360_LENS_FROM_IMU.y, lz = INSTA360_LENS_FROM_IMU.z;
  const lx = [ly[1] * lz[2] - ly[2] * lz[1], ly[2] * lz[0] - ly[0] * lz[2], ly[0] * lz[1] - ly[1] * lz[0]];
  const val = (i, k) => imu.readUInt16LE(i * 20 + 8 + k * 2) - 32768;

  // Start level: the rotation taking the first ~0.1 s of averaged "up" onto world +y.
  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < Math.min(100, n); i++) { ax += val(i, 0); ay += val(i, 1); az += val(i, 2); }
  let l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
  // q = rotation from (ax,ay,az) to (0,1,0): axis = a x y, angle = acos(a.y)
  let qw = 1 + ay, qx = -az, qy = 0, qz = ax;
  if (qw < 1e-6) { qw = 0; qx = 1; qy = 0; qz = 0; }
  l = Math.hypot(qw, qx, qy, qz); qw /= l; qx /= l; qy /= l; qz /= l;

  const R = new Float64Array(nf * 9); // body -> world, row-major, per frame
  const heading = new Float64Array(nf);
  let f = 0, prevT = Number(imu.readBigUInt64LE(0));
  const frameT = j => Number(frames.readBigUInt64LE(j * 16));
  let nextFrameT = frameT(0);
  for (let i = 0; i < n && f < nf; i++) {
    const t = Number(imu.readBigUInt64LE(i * 20));
    const dt = Math.min(Math.max((t - prevT) / 1e6, 0), 0.02); prevT = t;
    let wx = val(i, 3) * W, wy = val(i, 4) * W, wz = val(i, 5) * W;
    const bx = val(i, 0) * G, by = val(i, 1) * G, bz = val(i, 2) * G, bn = Math.hypot(bx, by, bz);
    if (bn > 0.8 && bn < 1.2) {
      // World up seen from the body: q* (0,1,0) q, the middle row of the rotation matrix.
      const ux = 2 * (qx * qy + qw * qz), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz - qw * qx);
      const mx = bx / bn, my = by / bn, mz = bz / bn;
      wx += KP * (my * uz - mz * uy); wy += KP * (mz * ux - mx * uz); wz += KP * (mx * uy - my * ux);
    }
    const hx = wx * dt / 2, hy = wy * dt / 2, hz = wz * dt / 2;
    const nw = qw - qx * hx - qy * hy - qz * hz, nx = qx + qw * hx + qy * hz - qz * hy;
    const ny = qy + qw * hy + qz * hx - qx * hz, nz = qz + qw * hz + qx * hy - qy * hx;
    l = Math.hypot(nw, nx, ny, nz); qw = nw / l; qx = nx / l; qy = ny / l; qz = nz / l;
    while (f < nf && nextFrameT <= t) {
      const r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
                 2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
                 2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)];
      R.set(r, f * 9);
      // Front lens axis in the world; its horizontal direction is the camera's heading.
      const fx = r[0] * lz[0] + r[1] * lz[1] + r[2] * lz[2], fz = r[6] * lz[0] + r[7] * lz[1] + r[8] * lz[2];
      heading[f] = Math.hypot(fx, fz) > 0.2 ? Math.atan2(fx, fz) : (f ? heading[f - 1] : 0);
      f++;
      nextFrameT = f < nf ? frameT(f) : Infinity;
    }
  }
  if (f < nf) { for (let j = f; j < nf; j++) { R.copyWithin(j * 9, (f - 1) * 9, f * 9); heading[j] = heading[f - 1]; } }

  // Unwrap, then smooth with three box passes (close to a Gaussian) over ~±0.5 s.
  for (let j = 1; j < nf; j++) { let d = heading[j] - heading[j - 1]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; heading[j] = heading[j - 1] + d; }
  const fps = (nf - 1) / ((frameT(nf - 1) - frameT(0)) / 1e6);
  const half = Math.max(1, Math.round(fps * 0.5));
  let sm = heading;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float64Array(nf), cs = new Float64Array(nf + 1);
    for (let j = 0; j < nf; j++) cs[j + 1] = cs[j] + sm[j];
    for (let j = 0; j < nf; j++) { const a = Math.max(0, j - half), b = Math.min(nf, j + half + 1); out[j] = (cs[b] - cs[a]) / (b - a); }
    sm = out;
  }

  // M = C * R^T * Ry(heading): virtual camera -> world -> body -> lens.
  const mats = new Float32Array(nf * 9);
  for (let j = 0; j < nf; j++) {
    const r = R.subarray(j * 9, j * 9 + 9), c = Math.cos(sm[j]), s = Math.sin(sm[j]);
    const Ry = [c, 0, s, 0, 1, 0, -s, 0, c];
    for (let row = 0; row < 3; row++) {
      const cr = row === 0 ? lx : row === 1 ? ly : lz;
      // (C R^T) row = sum_k cr[k] * R^T[k][*] = sum_k cr[k] * R[*][k]
      const a0 = cr[0] * r[0] + cr[1] * r[1] + cr[2] * r[2];
      const a1 = cr[0] * r[3] + cr[1] * r[4] + cr[2] * r[5];
      const a2 = cr[0] * r[6] + cr[1] * r[7] + cr[2] * r[8];
      for (let col = 0; col < 3; col++) mats[j * 9 + col * 3 + row] = a0 * Ry[col] + a1 * Ry[3 + col] + a2 * Ry[6 + col];
    }
  }
  const result = { frames: nf, fps, mats };
  stabCache.clear(); // one video's worth (a few MB) is plenty to keep around
  stabCache.set(filePath, result);
  return result;
}

// ISO 6709 location string, as phones write it: "+45.9237+006.8694+1034.2/" (lat, lng, optional
// altitude). Searched for, not anchored - in a QuickTime udta ©xyz box it's preceded by a 2-byte
// length and 2-byte language code, and the language code can decode to a printable letter.
function parseIso6709(val) {
  const m = val && String(val).match(/([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function detectCameraFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename)).toUpperCase();
  const full = path.basename(filename).toUpperCase();
  if (/^(GOPR|GH\d\d|GX\d\d|GP\d\d)\d/.test(base) || base.includes('GOPRO'))
    return { brand: 'GoPro', folder: 'GoPro' };
  if (/\.(INSV|INSP)$/.test(full) || base.includes('INSTA360'))
    return { brand: 'Insta360', folder: 'Insta360' };
  if (/^DJI[_\d]/.test(base) || /^DJIM\d/.test(base))
    return { brand: 'DJI', folder: 'DJI' };
  if (full.endsWith('.MOV') && /^IMG_\d{4,}$/.test(base))
    return { brand: 'iPhone', folder: 'iPhone' };
  return null;
}

function detectCamera(make, model) {
  if (!make && !model) return null;
  const combined = ((make||'') + ' ' + (model||'')).toLowerCase();
  if (combined.includes('gopro')) return { brand: 'GoPro', folder: 'GoPro' };
  if (combined.includes('insta360') || combined.includes('insta 360')) return { brand: 'Insta360', folder: 'Insta360' };
  if (combined.includes('dji')) {
    if (combined.includes('osmo') && combined.includes('4')) return { brand: 'DJI Osmo 4', folder: 'DJI Osmo 4' };
    if (combined.includes('osmo')) return { brand: 'DJI Osmo', folder: 'DJI Osmo' };
    if (combined.includes('mini')) return { brand: 'DJI Mini', folder: 'DJI Mini' };
    if (combined.includes('mavic')) return { brand: 'DJI Mavic', folder: 'DJI Mavic' };
    return { brand: 'DJI', folder: 'DJI' };
  }
  if (combined.includes('apple') || combined.includes('iphone')) return { brand: 'iPhone', folder: 'iPhone' };
  if (combined.includes('samsung')) return { brand: 'Samsung', folder: 'Samsung' };
  if (combined.includes('canon')) return { brand: 'Canon', folder: 'Canon' };
  if (combined.includes('nikon')) return { brand: 'Nikon', folder: 'Nikon' };
  if (combined.includes('sony')) return { brand: 'Sony', folder: 'Sony' };
  if (combined.includes('fuji')) return { brand: 'Fujifilm', folder: 'Fujifilm' };
  if (combined.includes('panasonic')) return { brand: 'Panasonic', folder: 'Panasonic' };
  if (make) return { brand: make.trim(), folder: make.trim() };
  return null;
}

// User-taught camera recognition (see buildCameraProfile in renderer.js - "Create
// Camera Profile" on a folder under Cameras). Checked before the hardcoded brand
// list above, since its whole purpose is to override/refine it - e.g. telling
// apart a GoPro flown on a drone from an identical GoPro used handheld, which
// make/model EXIF alone can never disambiguate (both say "GoPro HERO11 Black").
// appData here is this process's own copy, kept current by the save-data IPC
// handler every time the renderer saves - see the top of this file.
function detectCameraFromProfile(make, model, filePath) {
  const profiles = appData.folders.filter(f => f.cameraProfile);
  if (!profiles.length) return null;
  const md = (model || '').trim().toLowerCase();
  const base = filePath ? path.basename(filePath).toUpperCase() : '';
  for (const folder of profiles) {
    const p = folder.cameraProfile;
    if (md && p.models?.some(m => m.toLowerCase() === md)) return { brand: folder.name, folder: folder.name };
    if (base && p.filenamePrefixes?.some(pre => base.startsWith(pre))) return { brand: folder.name, folder: folder.name };
  }
  return null;
}

// ── CONTENT-TYPE TAGS (best-effort - users can fix them in Edit Properties) ──
function detectTags(filePath, exif, camera, gps) {
  const tags = new Set();
  const base = path.basename(filePath, path.extname(filePath)).toUpperCase();
  const combined = ((exif.make || '') + ' ' + (exif.model || '')).toLowerCase();
  const camFolder = (camera ? camera.folder : '').toLowerCase();
  const isDjiHandheld = /osmo|pocket|action/.test(combined) || /osmo/.test(camFolder);

  // FPV - DJI FPV/Avata/O3 air-unit/goggle hardware, or goggle-DVR filename patterns
  const fpvHardware = /avata|dji fpv|o3 air|air unit|goggles|caddx|runcam|walksnail|hdzero/.test(combined);
  if (fpvHardware || /^DJIG\d/.test(base) || /(^|[_\-\s])FPV([_\-\s]|$)/.test(base) || base.startsWith('AVATA'))
    tags.add('FPV');

  // Drone - known aircraft model, or GPS present on a non-handheld DJI device
  const isDji = combined.includes('dji') || camFolder.startsWith('dji');
  const droneModel = /mavic|phantom|inspire|matrice|avata|dji fpv/.test(combined)
    || (isDji && !isDjiHandheld && /\bmini\b|\bair\b/.test(combined));
  if (droneModel || (gps && isDji && !isDjiHandheld)) tags.add('Drone');
  if (/avata|dji fpv/.test(combined)) tags.add('Drone');

  // Filename-convention tags
  if (/^(RPREPLAY|SCREENREC)/.test(base) || /SCREEN[ _\-]?REC/.test(base)) tags.add('Screen Recording');
  if (base.includes('PANO')) tags.add('Panorama');
  if (/SLO[ _\-]?MO|SLOWMO|SLOW[ _\-]?MOTION/.test(base)) tags.add('Slow-Mo');
  if (/TIME[ _\-]?LAPSE|HYPERLAPSE|TLAPSE/.test(base)) tags.add('Timelapse');

  return [...tags];
}

function buildFileEntry(filePath) {
  const stat = (() => { try { return fs.statSync(filePath); } catch(e) { return null; } })();
  const ext = path.extname(filePath).toLowerCase();
  const imgExts = TroveMedia.IMAGE, vidExts = TroveMedia.VIDEO;
  let exif = {}, camera = null;

  if (TroveMedia.HEIF.has(ext)) {
    exif = parseHeicExif(filePath);
    camera = detectCameraFromProfile(exif.make, exif.model, filePath) || detectCamera(exif.make, exif.model);
  } else if (imgExts.has(ext)) {
    exif = parseExif(filePath);
    camera = detectCameraFromProfile(exif.make, exif.model, filePath) || detectCamera(exif.make, exif.model);
  } else if (vidExts.has(ext)) {
    const vmeta = parseVideoMeta(filePath);
    exif.make = vmeta.make; exif.model = vmeta.model; exif.dateTime = vmeta.dateTime; exif.gps = vmeta.gps;
    camera = detectCameraFromProfile(exif.make, exif.model, filePath);
    if (!camera && (exif.make || exif.model)) camera = detectCamera(exif.make, exif.model);
    if (!camera) camera = detectCameraFromFilename(filePath);
  }

  let fileDate = stat ? stat.mtime.getTime() : null;
  if (exif.dateTime) {
    try {
      const dt = exif.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const parsed = new Date(dt).getTime();
      if (!isNaN(parsed)) fileDate = parsed;
    } catch(e) {}
  }

  return {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    path: filePath,
    name: path.basename(filePath),
    ext,
    size: stat ? stat.size : 0,
    fileDate,
    addedAt: Date.now(),
    folders: [],
    favorite: false,
    gps: exif.gps || null,
    cameraMake: exif.make || null,
    cameraModel: exif.model || null,
    cameraFolder: camera ? camera.folder : null,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    tags: detectTags(filePath, exif, camera, exif.gps || null),
    notes: null
  };
}

function reprocessMeta(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const imgExts = TroveMedia.IMAGE, vidExts = TroveMedia.VIDEO;
  let exif = {}, camera = null;
  if (TroveMedia.HEIF.has(ext)) {
    exif = parseHeicExif(filePath);
    camera = detectCameraFromProfile(exif.make, exif.model, filePath) || detectCamera(exif.make, exif.model);
  } else if (imgExts.has(ext)) {
    exif = parseExif(filePath);
    camera = detectCameraFromProfile(exif.make, exif.model, filePath) || detectCamera(exif.make, exif.model);
  } else if (vidExts.has(ext)) {
    const vmeta = parseVideoMeta(filePath);
    exif.make = vmeta.make; exif.model = vmeta.model; exif.dateTime = vmeta.dateTime; exif.gps = vmeta.gps;
    camera = detectCameraFromProfile(exif.make, exif.model, filePath);
    if (!camera && (exif.make || exif.model)) camera = detectCamera(exif.make, exif.model);
    if (!camera) camera = detectCameraFromFilename(filePath);
  }
  let fileDate = null;
  if (exif.dateTime) {
    try {
      const dt = exif.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const parsed = new Date(dt).getTime();
      if (!isNaN(parsed)) fileDate = parsed;
    } catch(e) {}
  }
  return { gps: exif.gps || null, cameraMake: exif.make || null, cameraModel: exif.model || null, cameraFolder: camera ? camera.folder : null, fileDate, tags: detectTags(filePath, exif, camera, exif.gps || null) };
}

// ── GEOCODING (rate-limited 1 req/s) ─────────────────────────────────────────
const geocodeInMemory = {};
let geocodeLastMs = 0;
const geocodeJobQueue = [];
let geocodeRunning = false;

async function runGeocodeQueue() {
  if (geocodeRunning) return;
  geocodeRunning = true;
  while (geocodeJobQueue.length > 0) {
    const now = Date.now();
    const wait = Math.max(0, geocodeLastMs + 1200 - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const { lat, lng, resolve } = geocodeJobQueue.shift();
    geocodeLastMs = Date.now();
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (geocodeInMemory[key]) { resolve(geocodeInMemory[key]); continue; }
    await new Promise((res) => {
      // zoom=10 returns the full address hierarchy: country + state/region + city. Coordinates
      // go out rounded to the same ~1 km grid as the cache key above, never the photo's exact
      // spot (which can be someone's home) - city-level results don't need more.
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}&format=json&zoom=10`;
      https.get(url, { headers: { 'User-Agent': 'Trove/1.0' } }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const j = JSON.parse(d);
            const a = j.address || {};
            const result = {
              country: a.country || 'Unknown',
              countryCode: (a.country_code || 'xx').toUpperCase(),
              region: a.state || a.region || a.province || a.state_district || a.county || null,
              city: a.city || a.town || a.village || a.municipality || null
            };
            geocodeInMemory[key] = result;
            resolve(result);
          } catch(e) { resolve(null); }
          res();
        });
      }).on('error', () => { resolve(null); res(); });
    });
  }
  geocodeRunning = false;
}

// One-time migration: earlier versions stored the library under the OS's per-machine
// profile (%APPDATA%/filelinker etc). Move it into the portable data/ folder so anyone
// upgrading keeps their existing library instead of it silently going missing.
// Each piece migrates independently (gated on its own destination, not a shared flag) so
// that if a run gets interrupted partway through copying thumbs/backups, the next launch
// resumes the pieces that never finished instead of treating the whole migration as done.
(function migrateFromUserDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { return; }
  const legacyData = path.join(LEGACY_USERDATA_DIR, 'filelinker-data.json');
  if (!fs.existsSync(DATA_PATH) && fs.existsSync(legacyData)) {
    try { fs.copyFileSync(legacyData, DATA_PATH); } catch (e) {}
  }
  const legacyThumbs = path.join(LEGACY_USERDATA_DIR, 'thumbs');
  if (!fs.existsSync(THUMB_DIR) && fs.existsSync(legacyThumbs)) {
    try { fs.cpSync(legacyThumbs, THUMB_DIR, { recursive: true }); } catch (e) {}
  }
  const legacyBackups = path.join(LEGACY_USERDATA_DIR, 'backups');
  if (!fs.existsSync(BACKUP_DIR) && fs.existsSync(legacyBackups)) {
    try { fs.cpSync(legacyBackups, BACKUP_DIR, { recursive: true }); } catch (e) {}
  }
})();

// One-time migration: earlier packaged builds (portable target) stored the library next to
// the exe. Move it into the new per-user DATA_DIR so anyone upgrading from one of those
// keeps their existing library instead of it silently going missing (or being wiped by an
// NSIS uninstall/upgrade of the old install directory).
(function migrateFromLegacyPortableDir() {
  if (!LEGACY_PORTABLE_DIR || LEGACY_PORTABLE_DIR === DATA_DIR) return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { return; }
  const legacyData = path.join(LEGACY_PORTABLE_DIR, 'filelinker-data.json');
  if (!fs.existsSync(DATA_PATH) && fs.existsSync(legacyData)) {
    try { fs.copyFileSync(legacyData, DATA_PATH); } catch (e) {}
  }
  const legacyThumbs = path.join(LEGACY_PORTABLE_DIR, 'thumbs');
  if (!fs.existsSync(THUMB_DIR) && fs.existsSync(legacyThumbs)) {
    try { fs.cpSync(legacyThumbs, THUMB_DIR, { recursive: true }); } catch (e) {}
  }
  const legacyEmbeds = path.join(LEGACY_PORTABLE_DIR, 'embeddings');
  if (!fs.existsSync(EMBED_DIR) && fs.existsSync(legacyEmbeds)) {
    try { fs.cpSync(legacyEmbeds, EMBED_DIR, { recursive: true }); } catch (e) {}
  }
  const legacyBackups = path.join(LEGACY_PORTABLE_DIR, 'backups');
  if (!fs.existsSync(BACKUP_DIR) && fs.existsSync(legacyBackups)) {
    try { fs.cpSync(legacyBackups, BACKUP_DIR, { recursive: true }); } catch (e) {}
  }
})();

let mainWindow;
let appData = loadData();

// One-time migration: fold any pre-existing root-level backup files (from before the
// backups/ folder existed) into it, so all snapshots live in one place.
(function migrateLegacyBackups() {
  try {
    const dir = path.dirname(DATA_PATH);
    const legacy = fs.readdirSync(dir).filter(f => /^filelinker-data\.backup-\d+\.json$/.test(f));
    if (!legacy.length) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    for (const f of legacy) fs.renameSync(path.join(dir, f), path.join(BACKUP_DIR, f));
  } catch(e) {}
})();

// A snapshot of exactly what was loaded, taken before any edits this session can happen -
// this is the safety net that guarantees every session start leaves a recovery point.
maybeSnapshot(appData, true);

// Same hex values as --bg/--text in index.html's :root / dark-theme CSS blocks - kept in sync
// by hand since main.js can't read the stylesheet. Used for the initial window background/
// title-bar-overlay colors below, and (on Windows) refreshed at runtime by 'set-titlebar-overlay'
// so a theme switch via cycleTheme() doesn't leave the overlay in the old theme's colors.
const THEME_COLORS = {
  light: { bg: '#eef2f4', text: '#212a30' },
  dark:  { bg: '#1c1a17', text: '#ece7df' }
};

function createWindow() {
  // Matches the renderer's applyTheme() (renderer.js) so the native window doesn't flash the
  // wrong-theme color before index.html's CSS takes over - 'system' here follows the OS via
  // nativeTheme, same as the unset-data-theme case in the CSS does via prefers-color-scheme.
  const themeMode = appData.settings?.themeMode || 'system';
  const isDarkTheme = themeMode === 'dark' || (themeMode === 'system' && nativeTheme.shouldUseDarkColors);
  const colors = isDarkTheme ? THEME_COLORS.dark : THEME_COLORS.light;
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1200, height: 760, minWidth: 900, minHeight: 600,
    // No native "Trove" title bar on any platform - just the window controls. macOS keeps its
    // usual inset traffic lights (titleBarStyle alone gives you that, no overlay concept there).
    // Windows/Linux use Window Controls Overlay (titleBarStyle:'hidden' + titleBarOverlay): the
    // native minimize/maximize/close buttons still render, just with no title text/icon bar
    // above them - index.html supplies its own thin draggable strip since frame:false means
    // nothing is draggable by default (see #titlebarDrag).
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : { titleBarOverlay: { color: colors.bg, symbolColor: colors.text, height: 32 } }),
    frame: false,
    backgroundColor: colors.bg,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  mainWindow.loadFile('index.html');
  // Sandbox runs look like the real app, so mark them: a small pill that can't be clicked.
  if (SANDBOX_DIR) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.insertCSS(
        "body::after{content:'SANDBOX LIBRARY';position:fixed;bottom:8px;right:8px;z-index:2147483647;" +
        "pointer-events:none;padding:3px 8px;border-radius:999px;background:#e5484d;color:#fff;" +
        "font:600 10px/1.4 system-ui,sans-serif;letter-spacing:.08em;opacity:.85}");
    });
  }
  // The renderer holds the window open (beforeunload) while a photo editor has unsaved edits -
  // neither editor saves as you go. Electron shows nothing for that by itself, so ask here;
  // preventDefault on this event means "close anyway".
  mainWindow.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', buttons: ['Keep editing', 'Quit without saving'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Unsaved edits', message: "You have edits on this photo that you haven't saved.",
      detail: 'Quit now and they are lost. Keep editing to go back and save them.'
    });
    if (choice === 1) e.preventDefault();
  });
  if (process.env.FL_DEBUG_CONSOLE) {
    mainWindow.webContents.on('console-message', (e) => {
      console.log(`[renderer] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
  }
}

// Electron's default application menu (File/Edit/View/Window/Help) is generic dev chrome -
// Reload, Toggle DevTools, Zoom, etc. - that doesn't belong in a finished consumer app, so it's
// removed rather than left in place. macOS is the one exception: its menu bar is a system-level
// element (not part of the window), and losing it entirely would also silently break Cmd+Q and
// every native text input's Cmd+C/V/X/Z (those rely on the Edit menu's roles being registered -
// Electron doesn't wire them without it) - so Mac keeps the bare minimum needed for that, with
// none of the boilerplate menus. Windows/Linux have no such dependency and just get nothing.
function setAppMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'quit' }] },
      { label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ] }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// Releases are published as GitHub prereleases (see build.yml), so the updater has to be told
// to consider them - otherwise it only ever looks at full releases and never finds one.
autoUpdater.allowPrerelease = true;
autoUpdater.autoDownload = true;
autoUpdater.on('update-downloaded', () => {
  if (mainWindow) mainWindow.webContents.send('update-ready');
});
// Silent no-op on failure (e.g. offline, or dev/unpackaged run with no update feed configured) -
// this is a background check, not something worth interrupting the user over.
autoUpdater.on('error', () => {});

function checkForAppUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

// A long face scan keeps working while Trove is minimised or behind another window. On top of
// lifting throttling for exactly that time (set-background-work), Chromium's own "window is
// hidden, slow it down" behaviour has to be off from launch - it can't be switched later. Trove
// already pauses its own animations when it isn't in front (the globe's ambient spin), so this
// costs nothing when there's no job running.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(() => {
  setAppMenu();
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(EMBED_DIR, { recursive: true });
  createWindow();
  loadEmbeddingIndex(); // not awaited - see comment above, runs in the background
  checkForAppUpdates();
  setInterval(checkForAppUpdates, 4 * 60 * 60 * 1000); // re-check every 4h for long-running sessions
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('restart-and-install', async () => {
  // An update only ever replaces the app binary, never the %APPDATA%/Trove library (see
  // DATA_DIR above) - but force one fresh backup snapshot (bypassing the normal 15-min
  // throttle) right before quitting anyway, as insurance against the install going wrong.
  await maybeSnapshot(appData, true);
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-data', () => appData);
ipcMain.handle('get-last-saved', () => { try { return fs.statSync(DATA_PATH).mtimeMs; } catch(e) { return null; } });
ipcMain.handle('save-data', async (_, data) => { appData = data; await saveData(data); return true; });

// ── SEMANTIC SEARCH (embedding storage + similarity search) ────────────────────
// The actual CLIP model only ever runs in the renderer's worker/semantic-worker.js
// (browser-first WASM, off the UI thread) - this process just persists the resulting
// vectors and does the plain-JS cosine-similarity scan. No ML dependency here at all.
// Files are shortcuts and never edited in place (see this app's whole premise), so a
// fileId's embedding is valid forever once computed - no size/mtime invalidation needed,
// unlike THUMB_DIR's cache (which can go stale from in-app photo edits).
const embeddingIndex = new Map(); // fileId -> Float32Array

// Async + concurrent (not the old readdirSync/readFileSync loop) so thousands of small
// embedding files never block createWindow() - on a cold disk/AV cache that loop alone
// could hold the window from appearing for several seconds. Runs in the background after
// the window is already up; safe because the renderer doesn't touch getIndexedIds() until
// 4s after its own startup (see initSemanticIndex() in renderer.js).
const EMBED_LOAD_CONCURRENCY = 32;
async function loadEmbeddingIndex() {
  let names;
  try { names = await fs.promises.readdir(EMBED_DIR); } catch (e) { return; }
  const binNames = names.filter(n => n.endsWith('.bin'));
  for (let i = 0; i < binNames.length; i += EMBED_LOAD_CONCURRENCY) {
    const batch = binNames.slice(i, i + EMBED_LOAD_CONCURRENCY);
    await Promise.all(batch.map(async name => {
      try {
        const buf = await fs.promises.readFile(path.join(EMBED_DIR, name));
        embeddingIndex.set(name.slice(0, -4), new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
      } catch (e) {}
    }));
  }
}

ipcMain.handle('save-embedding', async (_, fileId, vector) => {
  const arr = Float32Array.from(vector);
  embeddingIndex.set(fileId, arr);
  await fs.promises.writeFile(path.join(EMBED_DIR, fileId + '.bin'), Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  return true;
});

ipcMain.handle('get-indexed-ids', () => [...embeddingIndex.keys()]);

ipcMain.handle('delete-embeddings', async (_, fileIds) => {
  for (const id of fileIds) {
    embeddingIndex.delete(id);
    try { await fs.promises.unlink(path.join(EMBED_DIR, id + '.bin')); } catch (e) {}
  }
  return true;
});

// Raw CLIP text-vs-image cosine similarity for this (small, quantized) model has no clean
// match/no-match gap - profiling against a real library showed every query, including ones
// for concepts genuinely absent from what was indexed, ranking its "best" candidates in the
// same ~0.18-0.29 band as a query for something the library actually contains plenty of.
// Below this floor a result is indistinguishable from noise, so it's dropped rather than
// padding out a fixed result count with whatever happened to rank highest.
const SEMANTIC_MIN_SCORE = 0.25;

function normalizeVec(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

ipcMain.handle('search-semantic', (_, queryVector, limit) => {
  const q = normalizeVec(Float32Array.from(queryVector));
  const scored = [];
  for (const [id, vec] of embeddingIndex) {
    const score = cosine(vec, q);
    if (score >= SEMANTIC_MIN_SCORE) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 40);
});

// "Find more files that look like these" - given a set of already-categorized files (e.g.
// everything currently in a "Wildlife" folder), averages their embeddings into one reference
// vector and finds other library files that visually resemble that reference, even though
// they were never filed there. Image-vs-image similarity runs far higher than the
// text-vs-image case above (no cross-modal gap), so it needs its own, much stricter floor -
// calibrated against this app's own real library: a folder's genuine members cluster
// ~0.6-0.9 similarity to their own centroid, and the strongest true "should probably be in
// this folder too" candidates outside it still land firmly above 0.8, while the general
// library sits around a ~0.68 mean - SEMANTIC_MIN_SCORE's 0.25 would flood this with noise
// the way unthresholded text search did before that floor existed.
const CENTROID_MIN_SCORE = 0.8;

ipcMain.handle('search-similar-to-files', (_, fileIds, limit) => {
  const vecs = fileIds.map(id => embeddingIndex.get(id)).filter(Boolean);
  if (!vecs.length) return [];
  const dim = vecs[0].length;
  const centroid = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) centroid[i] += v[i];
  for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;
  normalizeVec(centroid);

  const exclude = new Set(fileIds);
  const scored = [];
  for (const [id, vec] of embeddingIndex) {
    if (exclude.has(id)) continue;
    const score = cosine(vec, centroid);
    if (score >= CENTROID_MIN_SCORE) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 40);
});

// Mirrors renderer.js's getOrCreateCategoryRoot() convention (matched by name, not a fixed
// id) - every folder at any depth under the "Categories" root, the tree the app's Guided
// Sort "category" step already uses for content tags like Wildlife/Activity/Miata.
function getCategoryDescendantIds() {
  const catRoot = appData.folders.find(f => f.name === 'Categories' && !f.parentId);
  if (!catRoot) return new Set();
  const ids = new Set();
  const stack = appData.folders.filter(f => f.parentId === catRoot.id).map(f => f.id);
  while (stack.length) {
    const id = stack.pop();
    ids.add(id);
    appData.folders.filter(f => f.parentId === id).forEach(f => stack.push(f.id));
  }
  return ids;
}

function computeCentroid(vecs) {
  const dim = vecs[0].length;
  const centroid = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) centroid[i] += v[i];
  for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;
  return normalizeVec(centroid);
}

// Below this many embedded members, a folder's centroid is just averaging 1-2 photos - not
// a stable "what this category looks like" signal, so it's not offered as a match target.
// Same floor used for the search cross-reference feature's centroid trigger.
const MIN_FOLDER_MEMBERS_FOR_CENTROID = 3;
// Calibrated against this app's real library (holding out real Activity-subfolder photos
// and re-clustering them from scratch, blind to their real folder): 0.8 - the same value as
// CENTROID_MIN_SCORE, which makes sense, it's the same kind of comparison (image-vs-image) -
// gives ~99% cluster purity (almost never blends two different activities together) at the
// cost of over-fragmenting a single real activity into several same-topic clusters (e.g.
// "Hike" split 8 ways). A looser 0.7-0.75 keeps them together but drops purity to ~71-88%,
// visibly blending unrelated activities (e.g. Foil+Paddle+Parapente all in one group) -
// a wrong grouping is a worse failure than a merely-fragmented one here, so precision wins.
const CLUSTER_MIN_SCORE = 0.8;
const CLUSTER_MIN_SIZE = 3;
// A second, gentler pass merging clusters whose centroids are themselves this close - trims
// some of the easy over-fragmentation from the strict threshold above without giving back
// its purity (also calibrated against the same real holdout: 0.9 keeps ~99% purity while
// 0.85-0.88 starts re-blending genuinely different but visually-similar activities).
const CLUSTER_MERGE_SCORE = 0.9;

// Two-phase "help me sort this batch" suggestion: (1) does each file look like it belongs in
// a folder that already has enough photos to define what it looks like, and (2) for whatever
// doesn't match anything, do groups of mutually-similar leftovers exist worth turning into a
// new folder. Everything here is a *suggestion* - see renderer.js's Guided Sort "content" step
// for the review UI; nothing gets filed or created until the user confirms.
ipcMain.handle('suggest-groups', (_, fileIds) => {
  const batchVecs = [];
  for (const id of fileIds) {
    const v = embeddingIndex.get(id);
    if (v) batchVecs.push({ id, vec: v });
  }
  if (!batchVecs.length) return { folderMatches: [], newClusters: [] };

  // Phase 1: match against existing CONTENT-category folders only (anything under the
  // Categories root, at any depth) - not camera, trip, or people folders. Visual similarity
  // is a genuinely useful signal for "what activity/subject is in this photo," but a
  // meaningless-to-harmful one for "which camera shot this" or "which trip was this" - those
  // already have their own, far more reliable signals (EXIF, import-time grouping) via the
  // wizard's dedicated camera/trip/people steps. Confirmed empirically: without this scope,
  // real Hike/CliffJumping test photos got suggested for folders named "DJI", "Suisse 2024",
  // "Iceland 2025", and person names - visually-similar-looking but categorically wrong.
  const categoryIds = getCategoryDescendantIds();
  const folderCentroids = [];
  for (const folder of appData.folders) {
    if (!categoryIds.has(folder.id)) continue;
    const memberVecs = appData.files
      .filter(f => f.folders && f.folders.includes(folder.id))
      .map(f => embeddingIndex.get(f.id))
      .filter(Boolean);
    if (memberVecs.length < MIN_FOLDER_MEMBERS_FOR_CENTROID) continue;
    folderCentroids.push({ folderId: folder.id, folderName: folder.name, centroid: computeCentroid(memberVecs) });
  }

  const folderMatchesMap = new Map(); // folderId -> {folderId, folderName, fileIds}
  const unmatched = [];
  for (const { id, vec } of batchVecs) {
    let best = null, bestScore = -1;
    for (const fc of folderCentroids) {
      const score = cosine(vec, fc.centroid);
      if (score > bestScore) { bestScore = score; best = fc; }
    }
    if (best && bestScore >= CENTROID_MIN_SCORE) {
      let g = folderMatchesMap.get(best.folderId);
      if (!g) { g = { folderId: best.folderId, folderName: best.folderName, fileIds: [] }; folderMatchesMap.set(best.folderId, g); }
      g.fileIds.push(id);
    } else {
      unmatched.push({ id, vec });
    }
  }

  // Phase 2: single-pass "leader" clustering over the leftovers - approximate and
  // order-dependent, which is fine since every suggestion is reviewed before anything
  // is created. Each item joins its most-similar existing cluster if close enough,
  // else starts a new one; the cluster's centroid updates incrementally as it grows.
  const clusters = [];
  for (const { id, vec } of unmatched) {
    let best = null, bestScore = -1;
    for (const c of clusters) {
      const score = cosine(vec, c.centroid);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= CLUSTER_MIN_SCORE) {
      best.members.push(id);
      for (let i = 0; i < vec.length; i++) best.sum[i] += vec[i];
      best.centroid = normalizeVec(Float32Array.from(best.sum));
    } else {
      clusters.push({ members: [id], sum: Float32Array.from(vec), centroid: Float32Array.from(vec) });
    }
  }

  const newClusters = mergeClusters(clusters, CLUSTER_MERGE_SCORE)
    .filter(c => c.members.length >= CLUSTER_MIN_SIZE)
    .sort((a, b) => b.members.length - a.members.length)
    // Centroid goes back as a plain array so the renderer's worker (the only place with a
    // text encoder - main.js stays free of any ML dependency) can match it against a naming
    // vocabulary client-side; this process has no way to embed text itself.
    .map(c => ({ fileIds: c.members, centroid: [...c.centroid] }));

  return { folderMatches: [...folderMatchesMap.values()], newClusters };
});

// Mirrors renderer.js's People/Vacations/Cameras root conventions (fixed ids for the first
// two, name-matched for Cameras, since main.js has no import of renderer.js's constants) -
// Smart Match should learn from any folder that represents a visual category (Categories, or
// any plain custom folder - a made-up nickname, an inside joke, whatever), but not folders
// whose organizing signal is something else entirely (who's in it, which trip, which device).
// Same reasoning as getCategoryDescendantIds() above, just broadened beyond just "Categories".
function getSmartMatchExcludedIds() {
  const excluded = new Set();
  const roots = [
    appData.folders.find(f => f.id === 'people-root'),
    appData.folders.find(f => f.id === 'vacations-root'),
    appData.folders.find(f => f.id === 'adventures-root'),
    appData.folders.find(f => f.name === 'Cameras' && !f.parentId),
  ].filter(Boolean);
  for (const root of roots) {
    excluded.add(root.id);
    const stack = appData.folders.filter(f => f.parentId === root.id).map(f => f.id);
    while (stack.length) {
      const id = stack.pop();
      excluded.add(id);
      appData.folders.filter(f => f.parentId === id).forEach(f => stack.push(f.id));
    }
  }
  return excluded;
}
// Deliberately far stricter than CENTROID_MIN_SCORE (0.8, already ~99% pure) - Smart Match's
// whole premise is the user doing almost nothing but confirming, so a wrong suggestion here
// costs more trust than a missed one. Set at the user's explicit request for "only show
// suggestions when 95% sure" - cosine similarity doesn't map linearly to a probability, so
// this reads as "meaningfully stricter than the already-conservative 0.8 bar," not a literal
// percentage; expect it to surface fewer, later, once folders have real history to learn from.
const SMART_MATCH_MIN_SCORE = 0.95;

// Smart Match: for each To Sort file, which already-established folders (any that clear
// getSmartMatchExcludedIds()) does it confidently resemble? Unlike suggest-groups above (which
// picks each file's single best-matching folder), a file can surface more than one suggestion
// here - the review UI shows all of them as toggleable, since a photo can genuinely belong to
// several categories. Files with zero qualifying suggestion are simply absent from the result,
// not included with an empty list - the caller should never open a review screen for those.
ipcMain.handle('smart-match-suggest', (_, fileIds) => {
  const excluded = getSmartMatchExcludedIds();
  const folderCentroids = [];
  for (const folder of appData.folders) {
    if (excluded.has(folder.id)) continue;
    const memberVecs = appData.files
      .filter(f => f.folders && f.folders.includes(folder.id))
      .map(f => embeddingIndex.get(f.id))
      .filter(Boolean);
    if (memberVecs.length < MIN_FOLDER_MEMBERS_FOR_CENTROID) continue;
    folderCentroids.push({ folderId: folder.id, folderName: folder.name, centroid: computeCentroid(memberVecs) });
  }
  const results = [];
  for (const id of fileIds) {
    const vec = embeddingIndex.get(id);
    if (!vec) continue;
    const suggestions = [];
    for (const fc of folderCentroids) {
      const score = cosine(vec, fc.centroid);
      if (score >= SMART_MATCH_MIN_SCORE) suggestions.push({ folderId: fc.folderId, folderName: fc.folderName, score });
    }
    if (suggestions.length) {
      suggestions.sort((a, b) => b.score - a.score);
      results.push({ id, suggestions });
    }
  }
  return results;
});

// Recombines clusters whose centroids are themselves near-identical - recovers some of the
// single-pass pass above's over-fragmentation (the same real topic landing in several
// separate clusters just because of processing order) without touching CLUSTER_MIN_SCORE's
// carefully-precise boundary between genuinely different topics.
function mergeClusters(clusters, mergeThreshold) {
  const merged = clusters.map(c => ({ members: c.members.slice(), sum: Float32Array.from(c.sum), centroid: Float32Array.from(c.centroid) }));
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (cosine(merged[i].centroid, merged[j].centroid) >= mergeThreshold) {
          merged[i].members.push(...merged[j].members);
          for (let k = 0; k < merged[i].sum.length; k++) merged[i].sum[k] += merged[j].sum[k];
          merged[i].centroid = normalizeVec(Float32Array.from(merged[i].sum));
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}

// ── BACKUPS ──────────────────────────────────────────────────────────────────
ipcMain.handle('list-backups', () => listBackupFiles().map(b => {
  let folders = 0, files = 0;
  try { const d = JSON.parse(fs.readFileSync(b.full, 'utf8')); folders = (d.folders||[]).length; files = (d.files||[]).length; } catch(e) {}
  return { file: b.file, mtime: b.mtime, folders, files };
}));
ipcMain.handle('read-backup', (_, file) => {
  // file must be a bare filename we ourselves listed - reject anything path-like to stop traversal
  if (typeof file !== 'string' || file.includes('/') || file.includes('\\') || file.includes('..')) return null;
  try { return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), 'utf8')); } catch(e) { return null; }
});
ipcMain.handle('reveal-backups-folder', () => {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); shell.openPath(BACKUP_DIR); return true; } catch(e) { return false; }
});

function dirSizeSync(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSizeSync(full);
    else { try { total += fs.statSync(full).size; } catch (err) {} }
  }
  return total;
}
// Surfaced in the Backups modal so the app's own on-disk footprint isn't invisible -
// see MAX_BACKUP_BYTES above for why backups specifically needed a size cap in the
// first place. "Clean Up Now" just runs the same pruneBackups() the 15-min snapshot
// timer already calls, on demand.
ipcMain.handle('get-storage-stats', () => {
  let dataFileBytes = 0;
  try { dataFileBytes = fs.statSync(DATA_PATH).size; } catch (e) {}
  const backups = listBackupFiles();
  return {
    dataFileBytes,
    backupsBytes: backups.reduce((sum, b) => sum + b.size, 0),
    backupsCount: backups.length,
    thumbsBytes: dirSizeSync(THUMB_DIR),
    maxBackups: MAX_BACKUPS,
    maxBackupBytes: MAX_BACKUP_BYTES,
  };
});
ipcMain.handle('prune-backups-now', () => { pruneBackups(); return true; });
// Per-file EXIF/HEIC/video metadata parsing (buildFileEntry/reprocessMeta) is genuinely
// synchronous CPU work - that part doesn't change. But running it over a whole dropped
// folder (up to 20,000 files) in one unbroken loop inside a single ipcMain handler holds
// the main process hostage for the entire import, freezing every window and all other
// IPC the whole time. Yielding back to the event loop every few dozen files lets queued
// IPC/paint work interleave in between, so the app stays responsive during a big import
// instead of appearing to hang - total import time is essentially unaffected.
const IMPORT_YIELD_EVERY = 25;
async function mapYielding(items, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    out[i] = fn(items[i]);
    if (i % IMPORT_YIELD_EVERY === IMPORT_YIELD_EVERY - 1) await new Promise(r => setImmediate(r));
  }
  return out;
}

ipcMain.handle('open-file-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return mapYielding(r.filePaths, buildFileEntry);
});
// Folders to import whole (the first-run wizard's "Choose a folder") - each one then goes through
// process-dropped-folder, exactly like a folder dropped on the window.
ipcMain.handle('open-folder-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('open-file', async (_, fp) => {
  try { await shell.openPath(fp); return { success: true }; } catch(e) { return { success: false }; }
});
ipcMain.handle('show-in-folder', (_, fp) => { shell.showItemInFolder(fp); return true; });

// Reveals several files at once with ALL of them selected in Explorer, so a
// multi-selection made in the app can be dragged/cut/moved together outside it.
// shell.showItemInFolder only ever selects a single item (that's a Windows Shell
// limitation, not an Electron one), so multi-select needs its own path here.
// Files are grouped by parent folder first, since an Explorer selection only
// ever lives inside one folder window - a selection spanning several folders
// opens one window per folder, each with just that folder's files selected.
// A folder that only contributes one file skips the PowerShell/COM route
// entirely and just uses the plain single-item reveal.
let multiSelectScriptPath = null;
function ensureMultiSelectScript() {
  if (multiSelectScriptPath && fs.existsSync(multiSelectScriptPath)) return multiSelectScriptPath;
  // Drives Explorer's own Shell COM API (IShellFolderViewDual.SelectItem) - the
  // same mechanism Explorer uses internally for "select this item" - adding
  // every requested item to the window's selection instead of just the first.
  // SelectItem flags: 1=select, 4=deselect everything else first, 8=scroll into
  // view. First item gets 1|4|8=13 (start a fresh selection); the rest get
  // 1|8=9 (add to it without clearing what's already selected).
  const script = `param(
  [string]$Folder,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$Names
)
$ErrorActionPreference = 'SilentlyContinue'
$Folder = $Folder.TrimEnd('\\')
$shellApp = New-Object -ComObject Shell.Application
$shellApp.Open($Folder)
$win = $null
$deadline = (Get-Date).AddSeconds(6)
while (-not $win -and (Get-Date) -lt $deadline) {
  foreach ($w in @($shellApp.Windows())) {
    try { if ($w.Document.Folder.Self.Path.TrimEnd('\\') -eq $Folder) { $win = $w } } catch {}
  }
  if (-not $win) { Start-Sleep -Milliseconds 200 }
}
if (-not $win) { exit 1 }
$folderObj = $win.Document.Folder
$first = $true
foreach ($name in $Names) {
  $item = $folderObj.ParseName($name)
  if ($item) {
    if ($first) { $win.Document.SelectItem($item, 13); $first = $false }
    else { $win.Document.SelectItem($item, 9) }
  }
}
`;
  multiSelectScriptPath = path.join(os.tmpdir(), 'filelinker-select-multi.ps1');
  fs.writeFileSync(multiSelectScriptPath, script);
  return multiSelectScriptPath;
}
function selectMultipleInFolder(dir, names) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureMultiSelectScript(), dir, ...names],
        { windowsHide: true }
      );
    } catch (e) { resolve(); return; }
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}
ipcMain.handle('show-multiple-in-folder', async (_, paths) => {
  const valid = [...new Set((paths || []).filter(Boolean))];
  if (!valid.length) return true;
  if (valid.length === 1 || process.platform !== 'win32') {
    shell.showItemInFolder(valid[0]);
    return true;
  }
  const byDir = new Map();
  for (const p of valid) {
    const dir = path.dirname(p);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(path.basename(p));
  }
  for (const [dir, names] of byDir) {
    if (names.length === 1) shell.showItemInFolder(path.join(dir, names[0]));
    else await selectMultipleInFolder(dir, names);
  }
  return true;
});
ipcMain.handle('process-dropped-paths', (_, paths) => mapYielding(paths, buildFileEntry));
ipcMain.handle('read-360-motion', (_, filePath) => { try { return computeInsta360Stabilization(filePath); } catch (e) { return null; } });
ipcMain.handle('reprocess-files', (_, filePaths) => mapYielding(filePaths, fp => ({ path: fp, meta: reprocessMeta(fp) })));

// ── FOLDER IMPORT ────────────────────────────────────────────────────────────
const MEDIA_EXTS = TroveMedia.MEDIA; // see media-types.js

function collectMediaFiles(dir, out, depth = 0) {
  if (depth > 12 || out.length > 20000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectMediaFiles(full, out, depth + 1);
    else if (MEDIA_EXTS.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

ipcMain.handle('is-directory', (_, p) => {
  try { return fs.statSync(p).isDirectory(); } catch(e) { return false; }
});
ipcMain.handle('process-dropped-folder', async (_, folderPath) => {
  const paths = [];
  collectMediaFiles(folderPath, paths);
  return { name: path.basename(folderPath), files: await mapYielding(paths, buildFileEntry) };
});
ipcMain.handle('geocode', (_, lat, lng) => {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (geocodeInMemory[key]) return geocodeInMemory[key];
  return new Promise(resolve => { geocodeJobQueue.push({ lat, lng, resolve }); runGeocodeQueue(); });
});

// Real disk deletion (Duplicate Detection, Burst Review, bulk/single delete). Default sends to the Recycle Bin;
// permanent=true bypasses it. Files already gone are treated as deleted so the
// library entry still gets cleaned up.
// Windows refuses to delete or recycle a file that still has an open handle, and that's often
// only for a moment - a <video> the renderer just told to let go releases the file on another
// thread a beat later - so a failed file gets a few short retries before it counts. inUse says
// how many of the failures were still locked at the end, for the renderer's message.
ipcMain.handle('delete-files', async (_, paths, permanent) => {
  const deleted = [], failed = [];
  let bytes = 0, inUse = 0;
  const locked = e => ['EBUSY', 'EPERM', 'EACCES'].includes(e?.code) || /in use|being used|trash/i.test(e?.message || '');
  for (const p of paths) {
    if (!fs.existsSync(p)) { deleted.push(p); continue; }
    let size = 0;
    try { size = fs.statSync(p).size; } catch (e) {}
    for (let attempt = 0; ; attempt++) {
      try {
        if (permanent) fs.unlinkSync(p);
        else await shell.trashItem(p);
        deleted.push(p);
        bytes += size;
        break;
      } catch (e) {
        if (!fs.existsSync(p)) { deleted.push(p); bytes += size; break; } // gone after all
        if (attempt < 5 && locked(e)) { await new Promise(r => setTimeout(r, 300)); continue; }
        failed.push(p);
        if (locked(e)) inUse++;
        break;
      }
    }
  }
  return { deleted, failed, bytes, inUse };
});

// ── MISSING FILE RELOCATION ───────────────────────────────────────────────────
ipcMain.handle('check-files-exist', (_, paths) => paths.map(p => fs.existsSync(p)));

ipcMain.handle('pick-replacement-file', async (_, defaultPath) => {
  const r = await dialog.showOpenDialog(mainWindow, { defaultPath, properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// After the user manually relocates one file, look for its former siblings (other
// missing files that lived in the same old folder) inside the new folder, matched
// by filename + exact byte size - so the user isn't asked to relocate each one.
ipcMain.handle('find-folder-matches', (_, dirPath, candidates) => {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch(e) { return []; }
  const byName = new Map(entries.filter(e => e.isFile()).map(e => [e.name, e]));
  const results = [];
  for (const cand of candidates) {
    const ent = byName.get(cand.name);
    if (!ent) continue;
    const full = path.join(dirPath, ent.name);
    try {
      if (fs.statSync(full).size === cand.size) results.push({ id: cand.id, path: full });
    } catch(e) {}
  }
  return results;
});

// ── LONG BACKGROUND JOBS ─────────────────────────────────────────────────────
// A face scan of a whole library takes minutes, and people switch to something else meanwhile.
// Chromium slows a window that isn't in front (and all but stops a minimised one), and the OS
// may suspend the app - so while the renderer says a job is running, neither happens. Both go
// back to normal the moment it says it's done, so an idle Trove costs nothing in the background.
let backgroundWorkBlocker = null;
ipcMain.handle('set-background-work', (_, on) => {
  try {
    mainWindow?.webContents.setBackgroundThrottling(!on);
    if (on && backgroundWorkBlocker === null) backgroundWorkBlocker = powerSaveBlocker.start('prevent-app-suspension');
    if (!on && backgroundWorkBlocker !== null) { powerSaveBlocker.stop(backgroundWorkBlocker); backgroundWorkBlocker = null; }
    return true;
  } catch (e) { return false; }
});

// ── MATCHING CACHE (Find Duplicates / Find Edited) ───────────────────────────
// Each photo's visual fingerprint (a 64-bit hash plus a colour profile, a few dozen bytes) and
// each video's length. Computing them means reading every thumbnail / opening every video, so
// they're kept between sessions: the Sort menu's counts and both scans start instantly after
// the first time. Just a cache - deleting the file only costs one slow recount.
const MATCH_CACHE_FILE = path.join(DATA_DIR, 'match-cache.json');
ipcMain.handle('match-cache-load', async () => {
  try { return JSON.parse(await fs.promises.readFile(MATCH_CACHE_FILE, 'utf8')); } catch (e) { return null; }
});
ipcMain.handle('match-cache-save', async (_, json) => {
  if (typeof json !== 'string') return false;
  try {
    const tmp = MATCH_CACHE_FILE + '.tmp';
    await fs.promises.writeFile(tmp, json);
    await fs.promises.rename(tmp, MATCH_CACHE_FILE);
    return true;
  } catch (e) { return false; }
});

// ── FACES (People's opt-in face recognition, see faceIndex.js) ──────────────
// Kept apart from the library JSON on purpose: it's biometric data, it only exists while the
// feature is switched on, and turning it off has to be able to delete every trace of it in
// one go (faces-clear). index.json holds each face's box and 128-number description; crops/
// holds a small picture of each face for the review screen.
const FACES_DIR = path.join(DATA_DIR, 'faces');
const FACES_INDEX = path.join(FACES_DIR, 'index.json');
const FACE_CROPS_DIR = path.join(FACES_DIR, 'crops');
const FACE_ID_RE = /^[\w-]+$/;
ipcMain.handle('faces-load', async () => {
  try { return JSON.parse(await fs.promises.readFile(FACES_INDEX, 'utf8')); } catch (e) { return null; }
});
ipcMain.handle('faces-save', async (_, json) => {
  if (typeof json !== 'string') return false;
  try {
    await fs.promises.mkdir(FACES_DIR, { recursive: true });
    const tmp = FACES_INDEX + '.tmp';
    await fs.promises.writeFile(tmp, json);
    await fs.promises.rename(tmp, FACES_INDEX); // never leave a half-written index behind
    return true;
  } catch (e) { return false; }
});
ipcMain.handle('face-crop-save', async (_, faceId, base64) => {
  if (typeof faceId !== 'string' || !FACE_ID_RE.test(faceId) || typeof base64 !== 'string') return false;
  try {
    await fs.promises.mkdir(FACE_CROPS_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(FACE_CROPS_DIR, faceId + '.jpg'), Buffer.from(base64, 'base64'));
    return true;
  } catch (e) { return false; }
});
ipcMain.handle('face-crops-get', async (_, faceIds) => {
  const out = {};
  await Promise.all((faceIds || []).filter(id => typeof id === 'string' && FACE_ID_RE.test(id)).map(async id => {
    try { out[id] = (await fs.promises.readFile(path.join(FACE_CROPS_DIR, id + '.jpg'))).toString('base64'); } catch (e) {}
  }));
  return out;
});
ipcMain.handle('face-crops-delete', async (_, faceIds) => {
  await Promise.all((faceIds || []).filter(id => typeof id === 'string' && FACE_ID_RE.test(id))
    .map(id => fs.promises.unlink(path.join(FACE_CROPS_DIR, id + '.jpg')).catch(() => {})));
  return true;
});
ipcMain.handle('faces-clear', async () => {
  try { await fs.promises.rm(FACES_DIR, { recursive: true, force: true }); return true; } catch (e) { return false; }
});

// ── RAW PREVIEWS ─────────────────────────────────────────────────────────────
// Nearly every RAW format carries a JPEG the camera rendered for its own screen, often at full
// resolution. When the OS has no codec for the RAW itself (no Raw Image Extension on Windows,
// an unknown camera), that JPEG is the photo as the photographer saw it. Rather than learn two
// dozen container layouts, this scans the file for complete JPEG streams and keeps the biggest
// one a normal decoder can read - lossless-JPEG sensor data (SOF3, CR2/DNG) is skipped.
const JPEG_SOI = Buffer.from([0xFF, 0xD8, 0xFF]);
function jpegStreamAt(buf, s) {
  let i = s + 2, displayable = false;
  while (i + 2 <= buf.length) { // an end marker can be the file's last two bytes
    if (buf[i] !== 0xFF) return null;
    const m = buf[i + 1];
    if (m === 0xFF) { i++; continue; }
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    if (m === 0xD9) return displayable ? { start: s, end: i + 2 } : null;
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (m === 0xC0 || m === 0xC1 || m === 0xC2) displayable = true;       // baseline / extended / progressive
    if (m === 0xC3 || (m >= 0xC5 && m <= 0xCF && m !== 0xC8 && m !== 0xCC)) return null; // lossless, hierarchical, arithmetic
    if (m !== 0xDA) { i += 2 + len; continue; }
    // Entropy-coded data runs to the next real marker: 0xFF00 is an escaped byte and
    // 0xFFD0-D7 are restart markers, both part of the data.
    let j = i + 2 + len;
    for (;;) {
      j = buf.indexOf(0xFF, j);
      if (j < 0 || j + 1 >= buf.length) return null;
      const n = buf[j + 1];
      if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { j += 2; continue; }
      if (n === 0xFF) { j += 1; continue; }
      break;
    }
    i = j;
  }
  return null;
}
// Exif orientation (1-8) from a TIFF structure at `base`, or 0 when there isn't one.
function tiffOrientation(buf, base) {
  if (!isTiffHeader(buf, base)) return 0;
  const le = buf[base] === 0x49;
  const r16 = o => base + o + 2 <= buf.length ? (le ? buf.readUInt16LE(base + o) : buf.readUInt16BE(base + o)) : 0;
  const r32 = o => base + o + 4 <= buf.length ? (le ? buf.readUInt32LE(base + o) : buf.readUInt32BE(base + o)) : 0;
  const ifd = r32(4), count = r16(ifd);
  for (let t = 0; t < count && t < 200; t++) {
    const e = ifd + 2 + t * 12;
    if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}
function jpegOrientation(jpeg) {
  const at = jpeg.indexOf('Exif\0\0', 0, 'latin1');
  return at >= 0 && at < 65536 ? tiffOrientation(jpeg, at + 6) : 0;
}
// nativeImage can't rotate, so turns happen on the raw BGRA bitmap. Only the four orientations
// that matter for photos (upright, 90, 180, 270); mirrored ones are left as they are.
function rotateNativeImage(img, orientation) {
  const turn = orientation === 6 ? 90 : orientation === 3 ? 180 : orientation === 8 ? 270 : 0;
  if (!turn) return img;
  const { width: w, height: h } = img.getSize();
  const src = img.toBitmap();
  const out = Buffer.alloc(src.length);
  const W = turn === 180 ? w : h, H = turn === 180 ? h : w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = turn === 90 ? h - 1 - y : turn === 180 ? w - 1 - x : y;
      const ny = turn === 90 ? x : turn === 180 ? h - 1 - y : w - 1 - x;
      src.copy(out, (ny * W + nx) * 4, (y * w + x) * 4, (y * w + x) * 4 + 4);
    }
  }
  return nativeImage.createFromBitmap(out, { width: W, height: H });
}
const rawPreviewCache = new Map(); // path -> Promise<nativeImage|null>, a few recent ones - thumb, preview and editor often ask back to back
async function rawEmbeddedPreview(filePath) {
  if (rawPreviewCache.has(filePath)) return rawPreviewCache.get(filePath);
  const job = (async () => {
    const buf = await fs.promises.readFile(filePath);
    const streams = [];
    for (let i = buf.indexOf(JPEG_SOI); i >= 0; i = buf.indexOf(JPEG_SOI, i + 3)) {
      const s = jpegStreamAt(buf, i);
      if (s && s.end - s.start > 8 * 1024) { streams.push(s); i = s.end - 3; }
    }
    streams.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const containerOrientation = tiffOrientation(buf, 0);
    for (const s of streams.slice(0, 4)) {
      const jpeg = buf.subarray(s.start, s.end);
      const img = nativeImage.createFromBuffer(jpeg);
      if (img.isEmpty()) continue;
      return rotateNativeImage(img, jpegOrientation(jpeg) || containerOrientation);
    }
    return null;
  })().catch(() => null);
  rawPreviewCache.set(filePath, job);
  if (rawPreviewCache.size > 3) rawPreviewCache.delete(rawPreviewCache.keys().next().value);
  return job;
}
function fitNativeImage(img, maxW, maxH) {
  const { width: w, height: h } = img.getSize();
  const k = Math.min(1, maxW / w, maxH / h);
  return k < 1 ? img.resize({ width: Math.round(w * k), height: Math.round(h * k), quality: 'good' }) : img;
}
// ── HEIC FALLBACK DECODER ──
// iPhone HEIC photos are HEVC inside, and Windows only decodes them once the Store's "HEVC
// Video Extensions" is installed (the free HEIF Image Extension alone isn't enough). Without
// it the shell thumbnailer fails, Chromium can't decode HEIC either, and the photo got no
// thumbnail, preview or editor. Two ways around that:
// - Viewer and editor: the renderer decodes the HEVC tiles on the graphics card first (see
//   get-heic-layout below and heicGpu.js), and only falls back to get-preview-image.
// - Here, libheif in utility processes (see worker/heic-decoder.js). Grid thumbnails come from
//   the small preview every iPhone HEIC carries, ~10ms each; anything bigger is a full
//   software decode, ~0.75s for 12MP, and the renderer is told once so it can say why.
// They start on demand and quit when idle: WebAssembly memory never shrinks, so an idle
// decoder would sit on ~200MB.
const HEIC_DECODERS = 2;
const HEIC_IDLE_MS = 30000;
const heicPool = []; // { proc, job, idleTimer }
const heicQueue = []; // { filePath, maxW, maxH, resolve }
let heicSlowReported = false;
function spawnHeicDecoder() {
  const w = { proc: utilityProcess.fork(path.join(__dirname, 'worker', 'heic-decoder.js'), [], { serviceName: 'Trove HEIC decoder' }), job: null, idleTimer: null };
  w.proc.on('message', m => {
    if (m.full && !heicSlowReported && mainWindow) { heicSlowReported = true; mainWindow.webContents.send('heic-slow'); }
    finishHeicJob(w, m.bitmap ? nativeImage.createFromBitmap(Buffer.from(m.bitmap.buffer, m.bitmap.byteOffset, m.bitmap.byteLength), { width: m.width, height: m.height }) : null);
  });
  w.proc.on('exit', () => {
    clearTimeout(w.idleTimer);
    const i = heicPool.indexOf(w);
    if (i >= 0) heicPool.splice(i, 1);
    finishHeicJob(w, null);
  });
  heicPool.push(w);
  return w;
}
function finishHeicJob(w, img) {
  const job = w.job;
  w.job = null;
  if (job) job.resolve(img && !img.isEmpty() ? img : null);
  pumpHeicQueue();
  if (!w.job && heicPool.includes(w)) w.idleTimer = setTimeout(() => w.proc.kill(), HEIC_IDLE_MS);
}
function pumpHeicQueue() {
  while (heicQueue.length) {
    let w = heicPool.find(p => !p.job);
    if (!w && heicPool.length < HEIC_DECODERS) w = spawnHeicDecoder();
    if (!w) return;
    clearTimeout(w.idleTimer);
    w.job = heicQueue.shift();
    w.proc.postMessage({ filePath: w.job.filePath, maxW: w.job.maxW, maxH: w.job.maxH, thumbOnly: w.job.thumbOnly });
  }
}
function decodeHeic(filePath, maxW, maxH, thumbOnly) {
  return new Promise(resolve => {
    const job = { filePath, maxW, maxH, thumbOnly, resolve };
    // A photo the user just opened goes ahead of the grid thumbnails already waiting.
    if (Math.max(maxW, maxH) > 320) heicQueue.unshift(job); else heicQueue.push(job);
    pumpHeicQueue();
  });
}

// The OS first, whatever the format (it knows the codecs installed on this machine), then a
// RAW's own embedded preview or libheif for a HEIC. null means none could: the renderer tries
// Chromium next. thumbOnly (grid thumbnails) stops a HEIC at its built-in preview: one without
// gets decoded on the GPU by the renderer instead (rendererThumb), software only as a last resort.
async function renderStill(filePath, maxW, maxH, { thumbOnly = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  // Windows' thumbnailer squashes animated GIFs onto a wide strip (a 600x600 GIF came back
  // 320x117). Chromium decodes GIF properly - and animates it in the viewer - so it gets them.
  if (ext === '.gif') return null;
  try {
    const img = await nativeImage.createThumbnailFromPath(filePath, { width: maxW, height: maxH });
    if (!img.isEmpty()) return img;
  } catch (e) {}
  if (TroveMedia.RAW.has(ext)) {
    const img = await rawEmbeddedPreview(filePath);
    if (img) return fitNativeImage(img, maxW, maxH);
  }
  if (TroveMedia.HEIF.has(ext) && !TroveMedia.BROWSER_IMAGE.has(ext)) return decodeHeic(filePath, maxW, maxH, thumbOnly);
  return null;
}

// Thumbnails the renderer had to make itself (Chromium decoded a format the OS couldn't, or
// grabbed a frame from a video with no shell thumbnailer) are cached like any other, so the
// work happens once per file.
ipcMain.handle('cache-thumb', async (_, fileId, base64) => {
  if (typeof fileId !== 'string' || !/^[\w-]+$/.test(fileId) || typeof base64 !== 'string') return false;
  try { await fs.promises.writeFile(path.join(THUMB_DIR, fileId + '.jpg'), Buffer.from(base64, 'base64')); return true; }
  catch (e) { return false; }
});

ipcMain.handle('get-thumb', async (_, fileId, filePath) => {
  // A thumbnail the user picked for a video wins over everything - see CUSTOM VIDEO THUMBNAILS below.
  try { return (await fs.promises.readFile(customThumbPath(fileId))).toString('base64'); } catch(e) {}
  // An edited photo always wins over the plain OS-shell thumbnail - see PHOTO EDITOR below.
  // Fired once per visible grid cell while scrolling, so every sync fs call here was
  // blocking the whole app for the duration of a disk read on every single thumbnail.
  const editedFile = path.join(THUMB_DIR, fileId + '-edited.jpg');
  try { return (await fs.promises.readFile(editedFile)).toString('base64'); } catch(e) {}
  const cacheFile = path.join(THUMB_DIR, fileId + '.jpg');
  try {
    const cached = await fs.promises.readFile(cacheFile);
    // Thumbs cached before stripInsta360Banner existed still carry the banner - strip it once and re-cache.
    const stripped = /\.insv$/i.test(filePath) ? stripInsta360Banner(nativeImage.createFromBuffer(cached)) : null;
    if (!stripped) return cached.toString('base64');
    const buf = stripped.toJPEG(82);
    fs.promises.writeFile(cacheFile, buf).catch(() => {});
    return buf.toString('base64');
  } catch(e) {}
  try {
    let img = null;
    // Windows has no shell thumbnailer for Insta360's .insp (a plain JPEG under another
    // extension), so decode it from its bytes instead.
    if (/\.insp$/i.test(filePath)) img = nativeImage.createFromBuffer(await fs.promises.readFile(filePath)).resize({ width: 320 });
    else img = await renderStill(filePath, 320, 240, { thumbOnly: true });
    if (!img || img.isEmpty()) return null;
    if (/\.insv$/i.test(filePath)) img = stripInsta360Banner(img) || img;
    const buf = img.toJPEG(82);
    fs.promises.writeFile(cacheFile, buf).catch(() => {}); // cache write, not on the return-value critical path
    return buf.toString('base64');
  } catch(e) { return null; }
});

// Insta360 Studio's Windows thumbnailer draws a grey "INSV" bar with a blue stripe under the
// picture. The grid shows its own 360 badge instead, so cut the bar off: walk up the right edge
// (clear of the bar's icon and text) past the blue stripe and the flat grey, and crop there.
// Returns null when the bar isn't there, so thumbs from any other source are left alone.
function stripInsta360Banner(img) {
  const { width: w, height: h } = img.getSize();
  if (!w || !h) return null;
  const bmp = img.toBitmap(); // BGRA
  const px = y => { const i = (y * w + w - 4) * 4; return { b: bmp[i], g: bmp[i + 1], r: bmp[i + 2] }; };
  let y = h - 1;
  while (y > h / 2 && (p => p.b > 180 && p.b > p.r + 60)(px(y))) y--;
  const blueRows = h - 1 - y;
  y -= 3; // JPEG blurs the blue/grey boundary into a few rows that are neither
  const greyStart = y;
  while (y > h / 2 && (p => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) < 8 && p.r >= 40 && p.r <= 52)(px(y))) y--;
  if (blueRows < 2 || greyStart - y < 10) return null;
  return img.crop({ x: 0, y: 0, width: w, height: y }); // y itself is often a blurred edge row
}

// Writes the flattened result of an edit session next to the original, with no save dialog -
// the editor bakes layers into a real file on close (see peBakeLayers in renderer.js) so the
// library JSON doesn't have to carry base64 PNGs around forever. Never overwrites: an existing
// name gets a numeric suffix, so repeated sessions pile up as -edited, -edited-2, -edited-3.
// `ext` must match what the renderer actually encoded: PhotoMod writes PNG when the picture
// needs it (see pmOutputFormat), and a PNG saved under a .jpg name confuses other apps.
ipcMain.handle('bake-edited-image', async (_, base64, sourcePath, ext) => {
  try {
    const dir = path.dirname(sourcePath);
    const base = path.basename(sourcePath).replace(/\.[^.]+$/, '');
    const suffix = ext === 'png' ? 'png' : 'jpg';
    let target = path.join(dir, `${base}-edited.${suffix}`);
    for (let i = 2; fs.existsSync(target) && i < 500; i++) target = path.join(dir, `${base}-edited-${i}.${suffix}`);
    await fs.promises.writeFile(target, Buffer.from(base64, 'base64'));
    return { success: true, path: target };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── FRAME GRABS (a still pulled out of a video, see grabFrameToLibrary in viewer360.js) ──
// The renderer hands over a JPEG straight from a canvas, which carries no metadata at all. A
// frame is a photo taken at a known moment by a known camera, so it gets real EXIF written in
// here - DateTimeOriginal, Make/Model and GPS - so the date and camera survive being copied out
// of Trove into any other app, and buildFileEntry's own parseExif reads them back on import.
function buildExifSegment(meta) {
  // Padded past 4 bytes so every string sits behind an offset: the spec stores <=4-byte values
  // inline, and plenty of readers don't handle that.
  const ascii = s => {
    const b = Buffer.from(String(s).slice(0, 63) + '\0', 'latin1');
    return b.length > 4 ? b : Buffer.concat([b, Buffer.alloc(5 - b.length)]);
  };
  const rationals = vals => {
    const b = Buffer.alloc(vals.length * 8);
    vals.forEach(([n, d], i) => { b.writeUInt32LE(n >>> 0, i * 8); b.writeUInt32LE(d >>> 0, i * 8 + 4); });
    return b;
  };
  const dms = deg => {
    const a = Math.abs(deg), d = Math.floor(a), mFloat = (a - d) * 60, m = Math.floor(mFloat);
    return rationals([[d, 1], [m, 1], [Math.round((mFloat - m) * 60 * 10000), 10000]]);
  };
  // Entries: [tag, type, count, Buffer-or-null, inlineValue]. Types: 1 BYTE, 2 ASCII, 4 LONG, 5 RATIONAL.
  const ifd0 = [], exif = [], gps = [];
  if (meta.make) ifd0.push([0x010F, 2, null, ascii(meta.make)]);
  if (meta.model) ifd0.push([0x0110, 2, null, ascii(meta.model)]);
  ifd0.push([0x0131, 2, null, ascii('Trove frame grab')]);
  if (meta.dateTime) {
    ifd0.push([0x0132, 2, null, ascii(meta.dateTime)]);
    exif.push([0x9003, 2, null, ascii(meta.dateTime)], [0x9004, 2, null, ascii(meta.dateTime)]);
  }
  if (meta.subSec) exif.push([0x9291, 2, null, ascii(meta.subSec)]);
  if (meta.gps && isFinite(meta.gps.lat) && isFinite(meta.gps.lng)) {
    gps.push([0x0000, 1, 4, null, Buffer.from([2, 3, 0, 0])],
      [0x0001, 2, 2, null, Buffer.from((meta.gps.lat < 0 ? 'S' : 'N') + '\0\0\0', 'latin1')],
      [0x0002, 5, 3, dms(meta.gps.lat)],
      [0x0003, 2, 2, null, Buffer.from((meta.gps.lng < 0 ? 'W' : 'E') + '\0\0\0', 'latin1')],
      [0x0004, 5, 3, dms(meta.gps.lng)]);
  }
  if (exif.length) ifd0.push([0x8769, 4, 1, null, 'EXIF']);
  if (gps.length) ifd0.push([0x8825, 4, 1, null, 'GPS']);

  // Layout: header(8) | IFD0 | EXIF IFD | GPS IFD | value blobs. Offsets are from the TIFF start.
  const ifdSize = entries => 2 + entries.length * 12 + 4;
  const ifd0Off = 8, exifOff = ifd0Off + ifdSize(ifd0), gpsOff = exifOff + (exif.length ? ifdSize(exif) : 0);
  let dataOff = gpsOff + (gps.length ? ifdSize(gps) : 0);
  const blobs = [];
  const writeIfd = entries => {
    entries.sort((a, b) => a[0] - b[0]);
    const b = Buffer.alloc(ifdSize(entries));
    b.writeUInt16LE(entries.length, 0);
    entries.forEach(([tag, type, count, data, inline], i) => {
      const e = 2 + i * 12;
      b.writeUInt16LE(tag, e); b.writeUInt16LE(type, e + 2);
      if (data) {
        const n = type === 5 ? data.length / 8 : data.length;
        b.writeUInt32LE(count || n, e + 4);
        if (data.length <= 4) data.copy(b, e + 8);
        else { b.writeUInt32LE(dataOff, e + 8); blobs.push(data); dataOff += data.length + (data.length & 1); if (data.length & 1) blobs.push(Buffer.alloc(1)); }
      } else if (inline === 'EXIF' || inline === 'GPS') {
        b.writeUInt32LE(1, e + 4); b.writeUInt32LE(inline === 'EXIF' ? exifOff : gpsOff, e + 8);
      } else {
        b.writeUInt32LE(count, e + 4); inline.copy(b, e + 8);
      }
    });
    return b; // next-IFD pointer stays 0
  };
  const header = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
  const parts = [header, writeIfd(ifd0)];
  if (exif.length) parts.push(writeIfd(exif));
  if (gps.length) parts.push(writeIfd(gps));
  const tiff = Buffer.concat([...parts, ...blobs]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([seg, body]);
}

// Photo Sphere XMP (the GPano namespace) is what Google Photos, Facebook and most 360 viewers
// look for to show a JPEG as an interactive sphere instead of a very wide flat picture.
function buildPanoXmpSegment(width, height) {
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:FullPanoWidthPixels="${width}" GPano:FullPanoHeightPixels="${height}" GPano:CroppedAreaImageWidthPixels="${width}" GPano:CroppedAreaImageHeightPixels="${height}" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const body = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xmp, 'utf8')]);
  const seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([seg, body]);
}

// Writes next to the source video and never overwrites, same rule as bake-edited-image.
ipcMain.handle('save-video-frame', async (_, base64, sourcePath, meta = {}) => {
  try {
    let jpeg = Buffer.from(base64, 'base64');
    if (jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return { success: false, error: 'not a JPEG' };
    // Metadata goes right after SOI, or after the JFIF APP0 when the encoder wrote one.
    let at = 2;
    if (jpeg[2] === 0xFF && jpeg[3] === 0xE0) at = 4 + jpeg.readUInt16BE(4);
    const segs = [buildExifSegment(meta)];
    if (meta.pano) segs.push(buildPanoXmpSegment(meta.width, meta.height));
    jpeg = Buffer.concat([jpeg.slice(0, at), ...segs, jpeg.slice(at)]);

    const dir = path.dirname(sourcePath);
    const base = path.basename(sourcePath).replace(/\.[^.]+$/, '');
    const suffix = String(meta.suffix || 'frame').replace(/[^\w.-]/g, '');
    let target = path.join(dir, `${base}-${suffix}.jpg`);
    for (let i = 2; fs.existsSync(target) && i < 500; i++) target = path.join(dir, `${base}-${suffix}-${i}.jpg`);
    await fs.promises.writeFile(target, jpeg);
    return { success: true, path: target };
  } catch (e) { return { success: false, error: e.message }; }
});

// Fallback for the photo editor's Ctrl+V (see setupPhotoEditorPaste in renderer.js): some apps
// publish only a raw bitmap to the system clipboard, which doesn't always reach the renderer as
// a DataTransfer item. Returns null rather than an empty image so the caller can just test it.
ipcMain.handle('read-clipboard-image', () => {
  try {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toDataURL();
  } catch (e) { return null; }
});

// ── NATIVE DRAG-OUT (drag a card straight into another app, e.g. a video/photo editor) ──
// Mirrors Electron's documented native-file-drag-drop recipe: the renderer's dragstart handler
// calls preventDefault() and forwards here instead of running the normal HTML5 DnD sequence, so
// startDrag() hands the OS a real file reference - the target app receives it exactly as if it
// were dragged from Explorer (zero-copy, matches Trove's own zero-copy philosophy). Reuses the
// grid thumbnail (already cached in THUMB_DIR by get-thumb above) as the drag icon when there's
// exactly one file and it's already been thumbnailed; falls back to the app icon otherwise -
// icon is a required field for startDrag (must be non-empty on macOS).
const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon-256.png');
ipcMain.on('start-file-drag', (event, payload) => {
  const paths = Array.isArray(payload?.paths) ? payload.paths.filter(p => typeof p === 'string' && p) : [];
  if (!paths.length) return;
  let icon = null;
  if (paths.length === 1 && payload.fileId) {
    for (const f of [payload.fileId + '-custom.jpg', payload.fileId + '-edited.jpg', payload.fileId + '.jpg']) {
      try {
        const img = nativeImage.createFromPath(path.join(THUMB_DIR, f));
        if (!img.isEmpty()) { icon = img.resize({ width: 96, height: 96 }); break; }
      } catch (e) {}
    }
  }
  if (!icon || icon.isEmpty()) {
    try { icon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 64, height: 64 }); } catch (e) {}
  }
  const item = { file: paths[0], icon: icon || nativeImage.createEmpty() };
  if (paths.length > 1) item.files = paths;
  try { event.sender.startDrag(item); } catch (e) {}
});

// Sharper-than-grid-thumbnail preview for the full-size popup - big enough to look crisp at
// popup size, still far smaller/faster than reading the original multi-MB file over IPC.
// Skips edited photos entirely (their small edited-look thumb from get-thumb is used instead,
// since this must never show unedited pixels as if they were the current look of the photo).
const PREVIEW_MAX_DIM = 1800;
// The compressed tiles of a HEIC plus how to put them together, for the renderer's hardware
// decoder (heicGpu.js). null when the file isn't laid out the usual way.
ipcMain.handle('get-heic-layout', (_, filePath) => readHeifLayout(filePath));

ipcMain.handle('get-preview-image', async (_, filePath, maxDim) => {
  try {
    const dim = maxDim || PREVIEW_MAX_DIM;
    const img = await renderStill(filePath, dim, dim);
    if (!img) return null;
    return img.toJPEG(88).toString('base64');
  } catch (e) { return null; }
});

// For the "Image Size"/"Resolution" library filters - reads dimensions straight out of
// each format's header (a few dozen bytes) instead of decoding the image. The renderer
// backfills this for the whole library in the background, so a real decode per file
// (what createThumbnailFromPath does - it's a bitmap, not a byte-parsed thumbnail; asking
// for a huge box like the true resolution just means "decode at full size") pegged the
// main process hard enough to freeze the whole app once a few thousand of those queued up.
function readImageSizeSync(filePath, ext) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const readSize = Math.min(stat.size, 256 * 1024);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    if (ext === '.png') return getPngSize(buf);
    if (ext === '.gif') return getGifSize(buf);
    if (ext === '.bmp') return getBmpSize(buf);
    if (ext === '.webp') return getWebpSize(buf);
    if (ext === '.tiff' || ext === '.tif') return getTiffSize(buf);
    if (TroveMedia.HEIF.has(ext)) return getHeicSize(buf);
    // A RAW's first IFD usually describes a small preview, not the sensor, so reading it would
    // put a 24MP photo in the "small" bucket - better unknown than wrong.
    if (TroveMedia.RAW.has(ext)) return null;
    return getJpegSize(buf); // .jpg/.jpeg/.jfif, and a reasonable default for anything unrecognized
  } finally {
    fs.closeSync(fd);
  }
}

function getJpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xFF) { i++; continue; } // fill byte between markers
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; } // no length field
    if (marker === 0xDA || marker === 0xD9) break; // start of scan / end of image - dimensions always come before this
    const len = buf.readUInt16BE(i + 2);
    // SOF0-15 carry width/height in the same layout, except DHT(C4)/JPG(C8)/DAC(CC) which reuse the SOF number range
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (i + 8 >= buf.length) return null;
      const height = buf.readUInt16BE(i + 5), width = buf.readUInt16BE(i + 7);
      return (width && height) ? { width, height } : null;
    }
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

function getPngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  return (width && height) ? { width, height } : null;
}

function getGifSize(buf) {
  if (buf.length < 10 || buf.slice(0, 3).toString('ascii') !== 'GIF') return null;
  const width = buf.readUInt16LE(6), height = buf.readUInt16LE(8);
  return (width && height) ? { width, height } : null;
}

function getBmpSize(buf) {
  if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4D) return null;
  const width = buf.readInt32LE(18), height = Math.abs(buf.readInt32LE(22)); // negative height = top-down bitmap, same magnitude
  return (width && height) ? { width, height } : null;
}

function getWebpSize(buf) {
  if (buf.length < 30 || buf.slice(0, 4).toString('ascii') !== 'RIFF' || buf.slice(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = buf.slice(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    const width = 1 + (buf.readUIntLE(24, 3)), height = 1 + (buf.readUIntLE(27, 3));
    return (width && height) ? { width, height } : null;
  }
  if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    const width = buf.readUInt16LE(26) & 0x3FFF, height = buf.readUInt16LE(28) & 0x3FFF;
    return (width && height) ? { width, height } : null;
  }
  return null; // VP8L (lossless) isn't worth the bit-packed-header complexity for how rarely it shows up in a photo library
}

function getTiffSize(buf) {
  const result = {};
  parseTiff(buf, 0, result); // TIFF IS the same IFD structure JPEG EXIF embeds - parseTiff already reads ImageWidth/ImageLength when present (see parseTiff above)
  return (result.width && result.height) ? { width: result.width, height: result.height } : null;
}

function getHeicSize(buf) {
  try {
    const meta = iterBoxes(buf, 0, buf.length).find(b => b.type === 'meta');
    if (!meta) return null;
    const iprp = iterBoxes(buf, meta.bodyStart + 4, meta.end).find(b => b.type === 'iprp');
    if (!iprp) return null;
    const ipco = iterBoxes(buf, iprp.bodyStart, iprp.end).find(b => b.type === 'ipco');
    if (!ipco) return null;
    // Takes the first 'ispe' (Image Spatial Extents) property rather than resolving the full
    // ipma item-property association - HEIC files with more than one image (bursts, depth
    // maps) could in principle list the primary photo's ispe out of order, but a single-photo
    // HEIC (the overwhelming common case) only has one anyway.
    const ispe = iterBoxes(buf, ipco.bodyStart, ipco.end).find(b => b.type === 'ispe');
    if (!ispe || ispe.bodyStart + 12 > buf.length) return null;
    const width = buf.readUInt32BE(ispe.bodyStart + 4), height = buf.readUInt32BE(ispe.bodyStart + 8);
    return (width && height) ? { width, height } : null;
  } catch (e) { return null; }
}

ipcMain.handle('get-image-size', async (_, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    return readImageSizeSync(filePath, ext);
  } catch (e) { return null; }
});

// ── PHOTO EDITOR ─────────────────────────────────────────────────────────────
// Non-destructive editing: the original file is never opened for writing. We only ever
// (a) hand the renderer a decoded bitmap to edit in a WebGL canvas, (b) cache a small
// preview of the edited look next to the normal thumbnail cache, and (c) on explicit
// export, write a brand new file wherever the user picks via a save dialog.
const EDIT_MAX_DIM = 4096; // formats Chromium can't decode (HEIC, TIFF, RAW) - the real ceiling depends on the OS codec
ipcMain.handle('get-editable-image', async (_, fileId, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (!TroveMedia.BROWSER_IMAGE.has(ext)) {
      // Chromium can't decode HEIC, TIFF or RAW itself, so the OS (or a RAW's own embedded
      // preview, or libheif) is the only source of pixels we have - same path as get-thumb above, just
      // asking for a much bigger render.
      const img = await renderStill(filePath, EDIT_MAX_DIM, EDIT_MAX_DIM);
      if (!img) return null;
      const size = img.getSize();
      return { base64: img.toJPEG(92).toString('base64'), mime: 'image/jpeg', downsampled: true, width: size.width, height: size.height };
    }
    const mimeMap = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.jpe':'image/jpeg', '.jfif':'image/jpeg', '.insp':'image/jpeg',
      '.png':'image/png', '.apng':'image/png', '.webp':'image/webp', '.avif':'image/avif', '.gif':'image/gif',
      '.bmp':'image/bmp', '.dib':'image/bmp', '.ico':'image/x-icon' };
    const buf = await fs.promises.readFile(filePath);
    return { base64: buf.toString('base64'), mime: mimeMap[ext] || 'application/octet-stream', downsampled: false };
  } catch (e) { return null; }
});

ipcMain.handle('export-edited-image', async (_, base64, suggestedName, defaultDir) => {
  try {
    // PhotoMod exports PNG (its documents can be transparent) and can be editing a canvas that
    // never came from a file, so neither the extension nor the starting folder is fixed here:
    // the filter follows the suggested name, and a missing folder falls back to Pictures.
    const isPng = /\.png$/i.test(suggestedName || '');
    const dir = defaultDir && fs.existsSync(defaultDir) ? defaultDir : app.getPath('pictures');
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(dir, suggestedName),
      filters: isPng ? [{ name: 'PNG Image', extensions: ['png'] }] : [{ name: 'JPEG Image', extensions: ['jpg'] }]
    });
    if (r.canceled || !r.filePath) return { success: false };
    await fs.promises.writeFile(r.filePath, Buffer.from(base64, 'base64'));
    return { success: true, path: r.filePath };
  } catch (e) { return { success: false }; }
});

// Byte-for-byte copy of one file, named like Explorer/Finder would ("name copy.ext", then
// "name copy 2.ext"...) - used by the first-run wizard's Find Duplicates demo, which needs a
// guaranteed real duplicate of one of the user's own just-imported files to scan for live.
ipcMain.handle('duplicate-file', async (_, filePath) => {
  try {
    const dir = path.dirname(filePath), ext = path.extname(filePath), base = path.basename(filePath, ext);
    let dest = path.join(dir, `${base} copy${ext}`), n = 2;
    while (fs.existsSync(dest)) dest = path.join(dir, `${base} copy ${n++}${ext}`);
    await fs.promises.copyFile(filePath, dest);
    return { success: true, entry: buildFileEntry(dest) };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── BEST OF ALBUM EXPORT ─────────────────────────────────────────────────────
// Copies the actual files (not shortcuts) into a standalone folder plus a static
// index.html gallery, so the export is something you can hand to someone who has
// neither Trove nor access to your drives - the one place in the app that
// deliberately breaks the zero-copy rule, because a shareable export has to stand
// on its own by definition.
function escapeHtmlAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function buildAlbumHtml(title, items) {
  const cards = items.map(it => {
    const media = it.isVideo
      ? `<video src="${escapeHtmlAttr(it.destName)}" controls preload="metadata"></video>`
      : `<img src="${escapeHtmlAttr(it.destName)}" alt="${escapeHtmlAttr(it.destName)}" loading="lazy">`;
    const caption = it.caption ? `<div class="cap">${escapeHtmlAttr(it.caption)}</div>` : '';
    return `<a class="card" href="${escapeHtmlAttr(it.destName)}" target="_blank" rel="noopener">${media}${caption}</a>`;
  }).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtmlAttr(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef2f4;color:#212a30;font-family:system-ui,sans-serif;padding:24px}
h1{font-size:20px;font-weight:600;margin:0 0 4px}
.sub{color:#5c6870;font-size:13px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{display:block;background:#ffffff;border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;border:1px solid #d6dee3}
.card img,.card video{width:100%;height:220px;object-fit:cover;display:block;background:#000}
.cap{padding:6px 10px;font-size:12px;color:#5c6870;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head>
<body><h1>${escapeHtmlAttr(title)}</h1><div class="sub">${items.length} item${items.length !== 1 ? 's' : ''} - exported from Trove</div>
<div class="grid">${cards}</div></body></html>`;
}
ipcMain.handle('export-best-of-album', async (_, files, title) => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return { success: false };
    const stamp = new Date().toISOString().slice(0, 10);
    const safeTitle = (title || 'Best Of').replace(/[\\/:*?"<>|]/g, '_');
    let destDir = path.join(r.filePaths[0], `${safeTitle} - ${stamp}`);
    for (let n = 2; fs.existsSync(destDir); n++) destDir = path.join(r.filePaths[0], `${safeTitle} - ${stamp} (${n})`);
    await fs.promises.mkdir(destDir, { recursive: true });

    const usedNames = new Set();
    const items = [];
    for (const f of files) {
      if (!fs.existsSync(f.path)) continue;
      let destName = f.name;
      let n = 2;
      while (usedNames.has(destName.toLowerCase())) {
        const ext = path.extname(f.name);
        destName = `${path.basename(f.name, ext)} (${n})${ext}`;
        n++;
      }
      usedNames.add(destName.toLowerCase());
      try {
        await fs.promises.copyFile(f.path, path.join(destDir, destName));
        items.push({ destName, isVideo: !!f.isVideo, caption: f.caption || '' });
      } catch (e) {}
    }
    await fs.promises.writeFile(path.join(destDir, 'index.html'), buildAlbumHtml(safeTitle, items));
    shell.openPath(destDir);
    return { success: true, count: items.length, skipped: files.length - items.length, folderPath: destDir };
  } catch (e) { return { success: false }; }
});

ipcMain.handle('save-edited-thumb', async (_, fileId, base64) => {
  try { await fs.promises.writeFile(path.join(THUMB_DIR, fileId + '-edited.jpg'), Buffer.from(base64, 'base64')); return true; }
  catch (e) { return false; }
});

ipcMain.handle('clear-edited-thumb', async (_, fileId) => {
  for (const suffix of ['-edited.jpg', '-edited-full.jpg']) {
    try { await fs.promises.unlink(path.join(THUMB_DIR, fileId + suffix)); } catch (e) {}
  }
  return true;
});

// The edited look at viewing size. An edit is a recipe only the editor's WebGL pipeline can
// replay, so the viewer can't render it from the original the way it renders a plain photo -
// without this it could only blow up the 480px edited thumb above, which looked like what it
// was. Written by the editor on save (peSaveEditedThumbnail), next to that thumb.
const EDIT_ID_RE = /^[\w-]+$/;
ipcMain.handle('save-edited-preview', async (_, fileId, base64) => {
  if (typeof fileId !== 'string' || !EDIT_ID_RE.test(fileId)) return false;
  try { await fs.promises.writeFile(path.join(THUMB_DIR, fileId + '-edited-full.jpg'), Buffer.from(base64, 'base64')); return true; }
  catch (e) { return false; }
});
ipcMain.handle('get-edited-preview', async (_, fileId) => {
  if (typeof fileId !== 'string' || !EDIT_ID_RE.test(fileId)) return null;
  try { return (await fs.promises.readFile(path.join(THUMB_DIR, fileId + '-edited-full.jpg'))).toString('base64'); }
  catch (e) { return null; }
});

// ── CUSTOM VIDEO THUMBNAILS ─────────────────────────────────────────────────
// A user-chosen still for a video (a frame from the popup player, or any image off disk),
// already downscaled to thumbnail size by the renderer (see setCustomThumb in renderer.js).
// Lives next to the regular cached thumb and wins over it in get-thumb above; the video file
// itself is never touched.
function customThumbPath(fileId) { return path.join(THUMB_DIR, fileId + '-custom.jpg'); }

ipcMain.handle('save-custom-thumb', async (_, fileId, base64) => {
  try { await fs.promises.writeFile(customThumbPath(fileId), Buffer.from(base64, 'base64')); return true; }
  catch (e) { return false; }
});

ipcMain.handle('clear-custom-thumb', async (_, fileId) => {
  try { await fs.promises.unlink(customThumbPath(fileId)); } catch (e) {}
  return true;
});

// Picks an image to use as a video's thumbnail and hands its bytes back as a data URL: the
// renderer decodes it with Chromium (so WebP/GIF/BMP work, not just what nativeImage reads)
// and a data URL can never taint the canvas it's drawn into.
const THUMB_PICK_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
ipcMain.handle('pick-thumbnail-image', async (_, defaultPath) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a thumbnail image',
    defaultPath: defaultPath || undefined,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: Object.keys(THUMB_PICK_MIME).map(e => e.slice(1)) }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  const mime = THUMB_PICK_MIME[path.extname(p).toLowerCase()];
  if (!mime) return { error: 'unsupported' };
  try { return { dataUrl: `data:${mime};base64,${(await fs.promises.readFile(p)).toString('base64')}` }; }
  catch (e) { return { error: 'read' }; }
});

// ── GPX IMPORT (hike/walk legs - see Relive Trip route tracing) ─────────────
ipcMain.handle('open-gpx-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'GPX Track', extensions: ['gpx'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});
ipcMain.handle('read-text-file', async (_, fp, maxBytes) => {
  let fh = null;
  try {
    const stat = await fs.promises.stat(fp);
    const size = Math.min(maxBytes || stat.size, stat.size);
    const buf = Buffer.alloc(size);
    fh = await fs.promises.open(fp, 'r');
    await fh.read(buf, 0, size, 0);
    return buf.toString('utf8');
  } catch(e) { return null; }
  finally { if (fh) await fh.close().catch(() => {}); }
});
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// setTitleBarOverlay is a real (Windows-only) BrowserWindow API for updating Window Controls
// Overlay colors after creation - lets cycleTheme() in renderer.js keep the native min/max/close
// buttons matching the app's theme instead of freezing at whatever theme was active on launch.
// No-ops everywhere else (Mac has no overlay concept, frame:false there uses inset traffic lights).
ipcMain.handle('set-titlebar-overlay', (_, isDark) => {
  if (process.platform !== 'win32' || !mainWindow || typeof mainWindow.setTitleBarOverlay !== 'function') return;
  const colors = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
  try { mainWindow.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.text, height: 32 }); } catch (e) {}
});

// ── TELEMETRY (anonymous, opt-in, no accounts) ──────────────────────────────────
// No SDK, no login, no per-user identity - just a plain HTTPS POST of a Firestore REST API
// document, fired from here (not the renderer) so it goes out over a normal Node request
// regardless of the page's file:// origin. installId is a random uuid stamped once per
// install (see DEFAULT_DATA/loadData below), never anything that identifies a person.
// telemetry-config.js (see telemetry-config.example.js) holds the Firestore project id + a
// public Web API key - both meant to be embedded in a client, protected by this project's
// Firestore security rules (create-only, no read/update/delete - see the example file), not
// by keeping them secret. Missing config = silently does nothing. Loaded from __dirname, not
// APP_ROOT: electron-builder packs it into app.asar next to this file, while APP_ROOT is the
// folder holding Trove.exe, where it never exists (so packaged builds never sent anything).
let telemetryConfig = { FIREBASE_PROJECT_ID: '', FIREBASE_API_KEY: '' };
try { telemetryConfig = require(path.join(__dirname, 'telemetry-config.js')); } catch (e) { /* not set up - pings below just no-op */ }

function firestoreValue(v) {
  if (typeof v === 'number') return { integerValue: String(Math.round(v)) };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v === null || v === undefined) return { nullValue: null };
  return { stringValue: String(v) };
}

ipcMain.on('send-telemetry', (_, payload) => {
  // Only packaged builds count as real users - running from source (npm start) never pings,
  // so contributors working on Trove don't show up in the usage numbers.
  if (!app.isPackaged) return;
  if (!telemetryConfig.FIREBASE_PROJECT_ID || !telemetryConfig.FIREBASE_API_KEY) return;
  if (!payload || typeof payload !== 'object') return;
  const fields = {};
  for (const k of ['event', 'installId', 'sessionDurationMs', 'fileCount', 'folderCount', 'bestOfCount', 'pinnedCount']) {
    fields[k] = firestoreValue(payload[k]);
  }
  fields.appVersion = firestoreValue(app.getVersion());
  fields.platform = firestoreValue(process.platform);
  fields.expireAt = { timestampValue: new Date(Date.now() + TELEMETRY_RETENTION_MS).toISOString() };
  const body = JSON.stringify({ fields });
  const req = https.request({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${telemetryConfig.FIREBASE_PROJECT_ID}/databases/(default)/documents/telemetry_events?key=${telemetryConfig.FIREBASE_API_KEY}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  });
  req.on('error', () => {}); // best-effort - a failed ping should never surface to the user
  req.write(body);
  req.end();
});
