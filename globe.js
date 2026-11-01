// ── 3D GLOBE - real zoomable satellite imagery (CesiumJS, loaded from assets/vendor) ──
// Contract: buildGlobe(canvas, gpsFiles) -> { cleanup() }
// Called by initGlobe() in renderer.js. `canvas` is actually a <div> container -
// CesiumWidget creates and manages its own internal canvas inside it.
//
// Imagery streams live from Esri World Imagery (free, no API key) so zooming in
// reveals real detail instead of magnifying a static texture. Flourishes on top:
// Esri place-name/border labels, and photo-tile pins (the pin IS the photo). The idle
// intro also shows Cesium's day/night lighting and a translucent drifting cloud shell;
// both fade out on the first interaction so browsing is evenly lit and unobstructed.

const EARTH_TEXTURES = {
  clouds: 'assets/earth/earth_clouds_2048.png'
};

const ESRI_WORLD_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const ESRI_PLACE_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer';
// Camera altitudes (m) for the labels fade: none above HIDDEN, full strength below FULL.
// The labels are raster tiles, so country names can't be dropped on their own - but at
// whole-Earth zooms they're all the layer shows, so fading the layer by altitude is
// what makes nation names appear later on zoom.
const LABELS_HIDDEN_ALT = 8000000;
const LABELS_FULL_ALT = 5000000;
// Free, keyless global elevation (~30m posts almost everywhere) - same no-token
// Esri service Cesium's own docs use as the canonical ArcGISTiledElevationTerrainProvider
// example, so it needs no Cesium ion account, matching how the imagery above needs none.
const ESRI_WORLD_ELEVATION_URL = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';

// Only cluster/render photos whose GPS falls within (a padded margin around) what
// the camera can currently see. Without this, a library with thousands of geotagged
// photos across many trips would project and proximity-test all of them on every
// pan/zoom - the actual source of the earlier lag, since clustering alone doesn't
// help once you're zoomed in close enough that almost nothing merges. Bails out
// (shows everything) if the rectangle can't be computed (camera tilted up off the
// globe) or the view is already ~whole-earth, where culling wouldn't reduce anything.
function visibleGpsFiles(gpsFiles, camera, ellipsoid) {
  try {
    const rect = camera.computeViewRectangle(ellipsoid);
    if (!rect) return gpsFiles;
    const south = Cesium.Math.toDegrees(rect.south), north = Cesium.Math.toDegrees(rect.north);
    const west = Cesium.Math.toDegrees(rect.west), east = Cesium.Math.toDegrees(rect.east);
    const crosses = west > east; // view spans the antimeridian
    const lngSpan = crosses ? (360 - west + east) : (east - west);
    if (lngSpan > 300 || (north - south) > 150) return gpsFiles;
    const latPad = (north - south) * 0.25, lngPad = lngSpan * 0.25;
    const s = Math.max(south - latPad, -90), n = Math.min(north + latPad, 90);
    const inLng = lng => crosses ? (lng >= west - lngPad || lng <= east + lngPad) : (lng >= west - lngPad && lng <= east + lngPad);
    return gpsFiles.filter(f => f.gps.lat >= s && f.gps.lat <= n && inLng(f.gps.lng));
  } catch (e) {
    return gpsFiles;
  }
}

// Screen-space clustering: two pins join the same group once they project within
// CLUSTER_TOUCH_PX of each other on screen - i.e. once they'd visually touch/overlap
// - and that grouping is transitive (single-linkage): A+B touching and B+C touching
// merges all three into one pin even if A and C themselves are further apart than
// the threshold. Doing this in screen space rather than geographic degrees means
// zoom handles itself for free - the same two GPS points drift further apart in
// pixels as you zoom in, so they "pop" apart the moment they'd stop overlapping,
// and re-merge the moment they would again on zooming out - no hand-tuned
// degrees-per-altitude table needed. Points on the far side of the globe are
// dropped via `occluder` before projecting (worldToWindowCoordinates doesn't know
// about occlusion, only perspective). `tripColors` is a Map of file.id -> hex color
// (the trip folder's color, built by renderer.js); a group's color is its
// representative (Best Of, then newest) file's trip color, or null for untripped photos.
// `roundIds` (Set of file ids) marks photos filed under an Adventure: their pins are drawn
// round, a trip's stay square, so the two read differently at a glance - same representative rule.
// `groupOf` (Map of file id -> trip/adventure id) limits merging to photos of the SAME trip or
// adventure (unfiled photos only merge with each other), so a grouped pin's fanned preview
// photos always come from that one trip/adventure - zooming out never mixes in other photos
// or swallows an adventure into a trip's bubble.
// `tripTouchPx` is the (wider) threshold used between two photos of the same trip/adventure -
// see tripTouchPxForHeight below; unfiled photos always use CLUSTER_TOUCH_PX.
const CLUSTER_TOUCH_PX = 30;
// file -> its world position, so re-clustering on every zoom step doesn't re-run the
// degrees -> Cartesian conversion (and allocate a fresh vector) for every visible photo.
// Keyed on the file object and re-checked against its lat/lng, so a photo whose location
// was just edited picks up the new spot.
const gpsWorldPosCache = new WeakMap();
function gpsWorldPos(f) {
  let e = gpsWorldPosCache.get(f);
  if (!e || e.lat !== f.gps.lat || e.lng !== f.gps.lng) {
    e = { lat: f.gps.lat, lng: f.gps.lng, pos: Cesium.Cartesian3.fromDegrees(f.gps.lng, f.gps.lat, 0) };
    gpsWorldPosCache.set(f, e);
  }
  return e.pos;
}
let scratchWindowPos = null; // created on first use - Cesium is loaded lazily, after this file
function clusterByScreenProximity(gpsFiles, scene, occluder, tripColors, roundIds, groupOf, tripTouchPx) {
  const tripPx = Math.max(tripTouchPx || CLUSTER_TOUCH_PX, CLUSTER_TOUCH_PX);
  if (!scratchWindowPos) scratchWindowPos = new Cesium.Cartesian2();
  const pts = [];
  for (const f of gpsFiles) {
    const pos = gpsWorldPos(f);
    if (!occluder.isPointVisible(pos)) continue;
    const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos, scratchWindowPos);
    if (!sp) continue;
    pts.push({ f, x: sp.x, y: sp.y, g: (groupOf && groupOf.get(f.id)) || '' });
  }

  // Union-find over a proximity graph, built via spatial hashing (bucket size =
  // the widest touch threshold in play) so this stays roughly linear instead of
  // comparing every point against every other one.
  const n = pts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const bucketPx = tripPx;
  const buckets = new Map();
  const keyOf = (bx, by) => bx + ',' + by;
  pts.forEach((p, i) => {
    const key = keyOf(Math.floor(p.x / bucketPx), Math.floor(p.y / bucketPx));
    (buckets.get(key) || buckets.set(key, []).get(key)).push(i);
  });
  const thresholdSq = CLUSTER_TOUCH_PX * CLUSTER_TOUCH_PX;
  const tripThresholdSq = tripPx * tripPx;
  pts.forEach((p, i) => {
    const gi = p.g;
    const limitSq = gi ? tripThresholdSq : thresholdSq;
    const bx = Math.floor(p.x / bucketPx), by = Math.floor(p.y / bucketPx);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const neighbors = buckets.get(keyOf(bx + dx, by + dy));
      if (!neighbors) continue;
      for (const j of neighbors) {
        if (j <= i) continue;
        const ddx = p.x - pts[j].x, ddy = p.y - pts[j].y;
        if (ddx * ddx + ddy * ddy < limitSq && gi === pts[j].g) union(i, j);
      }
    }
  });

  const groups = new Map();
  pts.forEach((p, i) => {
    const root = find(i);
    let g = groups.get(root);
    if (!g) groups.set(root, g = { latSum: 0, lngSum: 0, count: 0, file: p.f, files: [] });
    g.latSum += p.f.gps.lat; g.lngSum += p.f.gps.lng; g.count++;
    g.files.push(p.f);
    if ((p.f.bestOf && !g.file.bestOf) ||
        (!!p.f.bestOf === !!g.file.bestOf && (p.f.fileDate || 0) > (g.file.fileDate || 0))) g.file = p.f;
  });

  return [...groups.values()].map(g => ({
    lat: g.latSum / g.count, lng: g.lngSum / g.count, count: g.count, file: g.file,
    files: [g.file, ...g.files.filter(f => f !== g.file)], // representative first, rest in original order
    color: (tripColors && tripColors.get(g.file.id)) || null,
    round: !!(roundIds && roundIds.has(g.file.id))
  }));
}

// Trips and adventures merge much more eagerly than loose photos when zoomed out, so a
// whole trip reads as one big pin at country/continent scale instead of a scatter of
// small ones along its route. The merge radius shrinks (on a log scale of camera height)
// back to the normal CLUSTER_TOUCH_PX as you zoom in, so once you're close enough to
// care about the individual stops (city level) a trip splits exactly like loose photos.
const TRIP_CLUSTER_TOUCH_PX_FAR = 160;
const TRIP_CLUSTER_FAR_HEIGHT = 1500e3; // m - at/above this, the full wide radius
const TRIP_CLUSTER_NEAR_HEIGHT = 40e3;  // m - at/below this, same radius as loose photos
function tripTouchPxForHeight(height) {
  if (!(height > TRIP_CLUSTER_NEAR_HEIGHT)) return CLUSTER_TOUCH_PX;
  if (height >= TRIP_CLUSTER_FAR_HEIGHT) return TRIP_CLUSTER_TOUCH_PX_FAR;
  const t = Math.log(height / TRIP_CLUSTER_NEAR_HEIGHT) / Math.log(TRIP_CLUSTER_FAR_HEIGHT / TRIP_CLUSTER_NEAR_HEIGHT);
  return CLUSTER_TOUCH_PX + t * (TRIP_CLUSTER_TOUCH_PX_FAR - CLUSTER_TOUCH_PX);
}

// ── Photo-tile markers - the pin IS the photo ───────────────────────────────
// Each marker is a small rounded-corner square thumbnail with a downward pointer
// tail beneath it, tip touching the exact GPS point - a classic map-pin shape,
// just with a real photo as the "head" instead of a plain dot. A cluster of
// several photos at one spot fans two extra tiles out behind the front one
// (one rotated left, one rotated right) as a quick "there's more than one
// here" cue, rather than a plain count badge.
//
// Thumbnails come from the OS-native thumbnail pipeline already used everywhere
// else in the app (getThumb(), defined in renderer.js - loaded after this file,
// but only ever called once the app is running, so load order doesn't matter).
// Loading is async, so every marker starts as a shape-matched gray placeholder
// (built instantly) and swaps to the real photo the moment it decodes - the
// same "thumb-loading" pattern the rest of the UI already uses.
const PHOTO_TILE = 46;             // on-screen size of one square photo tile, px
const POINTER_W = 13, POINTER_H = 10; // pin tail beneath the tile; tip = exact GPS point
const FAN_WING = 15;               // horizontal offset of the two background tiles
const FAN_ANGLE = 0.26;            // radians, ~15°
const FAN_SCALE = 0.86;            // background tiles are drawn slightly smaller

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws one rounded-corner photo square, cropped to cover (never stretched),
// centered at (cx, cy) and optionally rotated. `img` null draws a neutral
// placeholder instead so the loading and loaded states share identical geometry.
function drawPhotoTile(ctx, img, cx, cy, size, angle, borderColor, round) {
  ctx.save();
  ctx.translate(cx, cy);
  if (angle) ctx.rotate(angle);
  const half = size / 2, r = size * 0.2;
  if (round) { ctx.beginPath(); ctx.arc(0, 0, half, 0, Math.PI * 2); ctx.closePath(); }
  else roundRectPath(ctx, -half, -half, size, size, r);
  ctx.save();
  ctx.clip();
  if (img) {
    const s = Math.max(size / img.width, size / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.fillStyle = 'rgba(50,52,68,0.92)';
    ctx.fillRect(-half, -half, size, size);
  }
  ctx.restore();
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = borderColor || 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.restore();
}

// Full marker: the fan (if `isCluster`) plus the front tile and its pointer tail.
// `front`/`left`/`right` are HTMLImageElements, or null for a still-loading tile.
// `borderColor` tints the border/tail to a trip's folder color; omitted, it's white.
function composePhotoPin(front, left, right, isCluster, borderColor, round) {
  const padTop = 6, padSide = 6;
  const w = PHOTO_TILE + (isCluster ? FAN_WING * 2 : 0) + padSide * 2;
  const h = PHOTO_TILE + POINTER_H + padTop;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const cx = w / 2, cy = padTop + PHOTO_TILE / 2;

  if (isCluster) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4;
    drawPhotoTile(ctx, left, cx - FAN_WING, cy - 4, PHOTO_TILE * FAN_SCALE, -FAN_ANGLE, 'rgba(255,255,255,0.85)', round);
    drawPhotoTile(ctx, right, cx + FAN_WING, cy - 4, PHOTO_TILE * FAN_SCALE, FAN_ANGLE, 'rgba(255,255,255,0.85)', round);
    ctx.shadowBlur = 0;
  }

  // Pointer tail - drawn before the front tile so the tile's bottom edge covers the seam.
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
  ctx.fillStyle = borderColor || '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - POINTER_W / 2, cy + PHOTO_TILE / 2 - 2);
  ctx.lineTo(cx + POINTER_W / 2, cy + PHOTO_TILE / 2 - 2);
  ctx.lineTo(cx, cy + PHOTO_TILE / 2 + POINTER_H);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
  drawPhotoTile(ctx, front, cx, cy, PHOTO_TILE, 0, borderColor, round);

  return c;
}

// The size (in CSS px) a marker will occupy on screen - fixed regardless of camera
// distance, so photos stay legibly sized both zoomed all the way out and zoomed
// all the way in (see the missing scaleByDistance on the pin billboards below),
// and never grows so large up close that it swallows neighboring markers.
function photoPinDimensions(isCluster) {
  return {
    width: PHOTO_TILE + (isCluster ? FAN_WING * 2 : 0) + 12,
    height: PHOTO_TILE + POINTER_H + 6
  };
}

// Bounds a Map to `max` entries with least-recently-used eviction (Map preserves
// insertion order, so re-inserting a touched key on get/set moves it to the "most
// recent" end; the oldest entry sits at the front and is what gets dropped). Without
// this, a long globe session panning/zooming over a large geotagged library re-keys
// these caches combinatorially and they grow for as long as the globe stays open -
// module-scoped, so that memory also never comes back down across repeated
// open/close of the globe view within the same app run.
function lruGet(map, key) {
  if (!map.has(key)) return undefined;
  const v = map.get(key);
  map.delete(key);
  map.set(key, v);
  return v;
}
function lruSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

// One Image per source file, decoded once and reused by every marker/cluster it
// appears in - a photo that shows up near several others gets decoded exactly once.
const TILE_IMAGE_CACHE_MAX = 1500;
const tileImageCache = new Map(); // file.id -> Promise<HTMLImageElement|null>
function loadTileImage(file) {
  if (!file) return Promise.resolve(null);
  let p = lruGet(tileImageCache, file.id);
  if (p) return p;
  p = getThumb(file).then(dataUrl => {
    if (!dataUrl) return null;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }).catch(() => null);
  lruSet(tileImageCache, file.id, p, TILE_IMAGE_CACHE_MAX);
  return p;
}

// Final composed canvas per distinct marker, cached by which file(s) it's made of -
// re-clustering on every pan/zoom reuses the same canvas (and the same Cesium
// texture-atlas entry) instead of rebuilding it from scratch each time. Bounded
// (unlike the plain Map this used to be) because the cache key includes which
// neighboring files ended up in the same cluster, which changes on nearly every
// pan/zoom for a large library - an uncapped cache here grows without bound over
// a session, each entry holding a real HTMLCanvasElement.
const PHOTO_PIN_CANVAS_CACHE_MAX = 800;
const photoPinCanvasCache = new Map();      // key -> Promise<HTMLCanvasElement>
const photoPinPlaceholderCache = new Map(); // 'single:'|'cluster:' + color -> HTMLCanvasElement

// Bumped whenever a photo's thumbnail changes (a custom video thumbnail, see forgetGlobeTile).
// Part of every pin's texture-atlas id and identity in rebuildPins, so an open globe re-uploads
// and redraws affected pins instead of reusing the stale image already in its atlas.
let globeThumbRevision = 0;
// Called by renderer.js when a file's thumbnail changes: drops its decoded tile and every
// composed marker canvas it appears in (as front or fanned tile).
function forgetGlobeTile(fileId) {
  tileImageCache.delete(fileId);
  for (const key of [...photoPinCanvasCache.keys()]) {
    if (key.slice(2).split(':')[0].split(',').includes(fileId)) photoPinCanvasCache.delete(key);
  }
  globeThumbRevision++;
}

function photoPinPlaceholder(isCluster, color, round) {
  const key = (isCluster ? 'cluster:' : 'single:') + (round ? 'o:' : '') + (color || '');
  let c = photoPinPlaceholderCache.get(key);
  if (!c) { c = composePhotoPin(null, null, null, isCluster, color, round); photoPinPlaceholderCache.set(key, c); }
  return c;
}

// `cluster` is one entry from clusterByScreenProximity(): { file, files, color, count }.
function pinCacheKeyFor(cluster) {
  const files = cluster.files;
  const tail = ':' + (cluster.color || '') + (cluster.round ? ':o' : '');
  if (cluster.count <= 1) return 'p:' + files[0].id + tail;
  const left = files[1] || files[0], right = files[2] || files[0];
  return 'c:' + files[0].id + ',' + left.id + ',' + right.id + tail;
}

function buildPhotoPinCanvas(cluster) {
  const key = pinCacheKeyFor(cluster);
  let p = lruGet(photoPinCanvasCache, key);
  if (p) return p;
  const files = cluster.files;
  const isCluster = cluster.count > 1;
  const front = files[0], left = files[1] || files[0], right = files[2] || files[0];
  p = Promise.all([
    loadTileImage(front),
    isCluster ? loadTileImage(left) : Promise.resolve(null),
    isCluster ? loadTileImage(right) : Promise.resolve(null)
  ]).then(([frontImg, leftImg, rightImg]) => {
    // Kept on the promise too, so a later rebuild that hits this cache can hand the finished
    // canvas straight to its billboard instead of flashing the placeholder for a frame.
    p.canvas = composePhotoPin(frontImg, leftImg, rightImg, isCluster, cluster.color, cluster.round);
    return p.canvas;
  });
  lruSet(photoPinCanvasCache, key, p, PHOTO_PIN_CANVAS_CACHE_MAX);
  return p;
}

// Trip "regroup" marker - a plain tinted circle with a white core, reading as a higher-level
// kind of pin than the photo tiles above. Round for trips and adventures alike.
function composeTripPinCanvas(hexColor) {
  const size = 46, cx = size / 2, cy = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const color = hexColor || '#06b6d4';
  const shape = () => { ctx.beginPath(); ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2); };
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  shape(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = size * 0.06;
  shape(); ctx.stroke();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.16);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0.5)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2); ctx.fill();
  return c;
}

// Distinct crosshair-style marker for the pending pick in "set location" mode -
// visually different from the photo-tile pins above so it can't be mistaken for a real one.
function makeTargetPinCanvas() {
  const size = 30, cx = size / 2, cy = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(6,182,212,0.95)';
  ctx.lineWidth = size * 0.08;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.46); ctx.lineTo(cx, cy - size * 0.2);
  ctx.moveTo(cx, cy + size * 0.2); ctx.lineTo(cx, cy + size * 0.46);
  ctx.moveTo(cx - size * 0.46, cy); ctx.lineTo(cx - size * 0.2, cy);
  ctx.moveTo(cx + size * 0.2, cy); ctx.lineTo(cx + size * 0.46, cy);
  ctx.stroke();
  ctx.fillStyle = 'rgba(6,182,212,1)';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2); ctx.fill();
  return c;
}

// Double ring around a bright core - "this exact spot", distinct from every other
// marker on the globe. Used by controller.showHighlight() (hover in Relive's day
// photo panel, "See on Map" from any file's context menu).
function makeHighlightCanvas() {
  const size = 72, cx = size / 2, cy = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Glowing outer ring - a real shadow blur, not just another stroke, so it reads
  // as "lit up" even against bright/busy satellite imagery.
  ctx.shadowColor = 'rgba(255,205,60,0.95)';
  ctx.shadowBlur = 16;
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,205,60,1)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.24, 0, Math.PI * 2); ctx.stroke();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.15);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,190,40,1)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2); ctx.fill();
  return c;
}

// ── TRIP ROUTES (Relive Trip only - see showRoutes/clearRoutes below) ──────────
// One style per transport mode. Ferry/train reuse the walk dash pattern at a
// different length/density purely so the three read as visually distinct without
// needing new assets - see renderer.js's buildTripLegs for how a leg gets its mode.
const MODE_ROUTE_STYLE = {
  drive:  { dash: false },
  flight: { dash: false, arc: true },
  walk:   { dash: true, dashLength: 6,  dashPattern: 255    },
  ferry:  { dash: true, dashLength: 14, dashPattern: 0x00FF },
  train:  { dash: true, dashLength: 4,  dashPattern: 0xF0F0 }
};
const MODE_ROUTE_EMOJI = { drive: '🚗', flight: '✈️', walk: '🥾', ferry: '⛴️', train: '🚆' };

// Small round badge with the transport emoji - floats over the midpoint of each
// route line so a glance says how that leg was traveled, without clicking anything.
const modeIconCache = new Map();
function modeIconCanvas(mode) {
  let img = modeIconCache.get(mode);
  if (img) return img;
  const size = 44, cx = size / 2, cy = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
  ctx.fillStyle = 'rgba(12,12,28,0.92)';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2); ctx.stroke();
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(MODE_ROUTE_EMOJI[mode] || '🚗', cx, cy + 1);
  modeIconCache.set(mode, c);
  return c;
}

// A geodesic path between two points, raised into a parabolic arc peaking at the
// midpoint - reads as "flew" rather than "drove", the one mode that gets genuinely
// different geometry rather than just a different line style. Pure geometry, no
// external data: EllipsoidGeodesic gives the true curved path along the surface,
// height is just sin() layered on top.
function buildFlightArcPositions(startLat, startLng, endLat, endLng, segments = 64) {
  const startCarto = Cesium.Cartographic.fromDegrees(startLng, startLat);
  const endCarto = Cesium.Cartographic.fromDegrees(endLng, endLat);
  const geodesic = new Cesium.EllipsoidGeodesic(startCarto, endCarto);
  const peakHeight = Math.min(Math.max(geodesic.surfaceDistance * 0.12, 40000), 600000);
  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const carto = geodesic.interpolateUsingFraction(f);
    positions.push(Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, peakHeight * Math.sin(Math.PI * f)));
  }
  return positions;
}

function buildGlobe(canvas, gpsFiles, opts = {}) {
  if (typeof Cesium === 'undefined') { toast('⚠️ 3D library failed to load'); return { cleanup(){} }; }

  // Esri World Imagery is served in Web Mercator, which is mathematically undefined
  // past ±85.05° latitude - so with it as the only layer, the globe surface above/
  // below that line has no imagery at all and shows raw space through to the far
  // side (a "hole" at each pole). Cesium's own fix (used for exactly this reason by
  // every non-geographic base layer, e.g. Bing) is a full-coverage, geographic-
  // projection layer underneath: NaturalEarthII, bundled with Cesium itself, so it
  // needs no network/ion account. It covers the whole globe including both poles;
  // Esri's high-res imagery draws on top of it everywhere Esri actually has data,
  // and NaturalEarthII simply shows through in the polar caps Esri can't reach.
  const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
    {}
  );

  const widget = new Cesium.CesiumWidget(canvas, {
    baseLayer,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(), // real terrain, if opts.terrainEnabled, is swapped in below - see setTerrainEnabled
    skyAtmosphere: new Cesium.SkyAtmosphere(),
    sceneMode: Cesium.SceneMode.SCENE3D,
    contextOptions: { webgl: { alpha: false } }
  });
  const esriLayer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY_URL, { enablePickFeatures: false }),
    {}
  );
  widget.scene.imageryLayers.add(esriLayer);
  // Place names + borders on top of the satellite imagery (transparent label tiles, same
  // keyless Esri server) - without them it's very hard to tell where you are once zoomed in.
  // Hidden on the whole-Earth view, faded in as you zoom - see LABELS_* and onPreRender.
  const labelsLayer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_PLACE_LABELS_URL, { enablePickFeatures: false }),
    { show: false, alpha: 0 }
  );
  widget.scene.imageryLayers.add(labelsLayer); // add() returns nothing - keep our own reference
  // Pinned directly rather than relying on the provider's async metadata credit,
  // which doesn't reliably reach the on-screen credit bar - Esri's ToS require it stay visible.
  widget.creditDisplay.addStaticCredit(new Cesium.Credit('Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', true));

  const scene = widget.scene;
  // ── Perf: render on demand, not every vsync ─────────────────────────────
  // Without this, Cesium redraws the whole scene continuously at the display's
  // full refresh rate (60/120/144Hz+) even when the camera is dead still and
  // nothing on screen is changing - burning GPU/CPU the entire time the globe
  // is open. requestRenderMode makes Cesium only render on an actual change
  // (camera move, tile load, entity update - all handled internally). The
  // only things here that change every frame regardless of camera motion are
  // decorative: idle auto-spin, cloud drift, and marker pulse (see
  // ambientTicker below), so those alone still need to keep requesting frames.
  scene.requestRenderMode = true;
  scene.maximumRenderTimeChange = Infinity;
  const globe = scene.globe;
  // Needed both by per-frame far-side pin hiding below and by screen-space
  // cluster projection (worldToWindowCoordinates doesn't know about occlusion).
  const occluder = new Cesium.EllipsoidalOccluder(globe.ellipsoid);

  // Day/night shading is part of the idle intro only - it fades out with the clouds on
  // the first interaction (see onPreRender), so browsing is always evenly lit.
  globe.enableLighting = true;
  const DEFAULT_LIGHT_FADE_OUT = globe.lightingFadeOutDistance;
  const DEFAULT_LIGHT_FADE_IN = globe.lightingFadeInDistance;
  globe.showGroundAtmosphere = true;
  globe.baseColor = Cesium.Color.fromCssColorString('#070714');

  // ── Polar cap fill - plugs the real hole in the terrain MESH when 3D Terrain
  // is on ──────────────────────────────────────────────────────────────────
  // Esri's elevation service (arcgisTerrain() below) is Web Mercator, same as its
  // imagery, so it's mathematically undefined past ~85.05° latitude - but unlike
  // imagery (a texture problem, fixed by the NaturalEarthII base layer above),
  // this is the terrain PROVIDER, and Cesium builds the globe's entire terrain
  // quadtree from that one provider's tiling scheme. Past ~85°, there is no tile
  // to build at all - an actual gap in the mesh, not just a bare/untextured patch,
  // so the camera looks straight through to whatever's behind (usually empty
  // space). Cesium has no supported way to blend a second terrain provider in for
  // just that region, so instead these four flat patches sit at the bare
  // ellipsoid surface, independent of the terrain quadtree entirely, right where
  // real coverage stops (84.9°, just inside Esri's 85.05° cutoff so real relief -
  // which does extend fractionally further - overlaps and hides the seam via the
  // normal depth test). Only shown while terrain is actually on; with it off the
  // flat EllipsoidTerrainProvider already covers the poles natively and this
  // would just z-fight with that surface.
  //
  // Textured with the real map, not a flat color: NaturalEarthII's own level-0
  // tiles (the same bundled asset used as the base imagery layer above) are just
  // two 256×256 JPGs, each spanning one full hemisphere of longitude and the
  // *entire* -90..90 latitude range - so rather than fight Cesium's material
  // shader over which end of the image is which pole, each is loaded once into a
  // plain <canvas> and cropped with ctx.drawImage to just its outermost sliver of
  // rows (image row 0 is unambiguously the top = north, in every raster format),
  // then that already-correctly-cropped canvas is used directly as the material
  // image with a plain 0..1 UV mapping - no shader-side coordinate math to get
  // backwards.
  const NE2_TILE_URLS = {
    west: 'assets/vendor/cesium/Assets/Textures/NaturalEarthII/0/0/0.jpg', // lng -180..0, lat -90..90
    east: 'assets/vendor/cesium/Assets/Textures/NaturalEarthII/0/1/0.jpg'  // lng 0..180,  lat -90..90
  };
  const POLAR_CAP_MIN_LAT = 84.9; // just inside Esri's ~85.05° real-coverage edge
  const POLAR_CAP_FRAC = (90 - POLAR_CAP_MIN_LAT) / 180; // slice of the full-hemisphere tile this is
  function cropStrip(img, fromTop) {
    const h = Math.max(1, Math.round(img.height * POLAR_CAP_FRAC));
    const c = document.createElement('canvas');
    c.width = img.width; c.height = h;
    c.getContext('2d').drawImage(img, 0, fromTop ? 0 : img.height - h, img.width, h, 0, 0, img.width, h);
    return c;
  }
  function loadImage(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  function polarCapPrimitive(minLng, maxLng, minLat, maxLat, image) {
    return scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.RectangleGeometry({
          rectangle: Cesium.Rectangle.fromDegrees(minLng, minLat, maxLng, maxLat),
          vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST
        })
      }),
      appearance: new Cesium.MaterialAppearance({
        material: Cesium.Material.fromType('Image', { image }),
        flat: false
      }),
      asynchronous: false,
      show: false // toggled with terrain - see setTerrainEnabled below
    }));
  }
  let polarCapPrimitives = [];
  let polarCapShow = false; // set for real by setTerrainEnabled below, once terrainOn is known
  Promise.all([loadImage(NE2_TILE_URLS.west), loadImage(NE2_TILE_URLS.east)]).then(([west, east]) => {
    if (widget.isDestroyed()) return;
    [[west, -180, 0], [east, 0, 180]].forEach(([img, minLng, maxLng]) => {
      if (!img) return; // vendored asset missing/failed to decode - leave that slice as a hole rather than guess
      polarCapPrimitives.push(polarCapPrimitive(minLng, maxLng, POLAR_CAP_MIN_LAT, 90, cropStrip(img, true)));
      polarCapPrimitives.push(polarCapPrimitive(minLng, maxLng, -90, -POLAR_CAP_MIN_LAT, cropStrip(img, false)));
    });
    polarCapPrimitives.forEach(p => p.show = polarCapShow);
    scene.requestRender();
  });

  // ── 3D terrain relief (toggleable - real elevation costs real GPU/network) ──
  // The ArcGIS elevation service is only ever fetched at all if the user has
  // actually turned this on (initially opts.terrainEnabled, from the persisted
  // setting), never eagerly - no point paying for tiles nobody asked to see.
  // The fetched provider is kept around so switching back on after switching
  // off reuses it instead of re-requesting metadata.
  let terrainOn = !!opts.terrainEnabled;
  let arcgisTerrainPromise = null;
  function arcgisTerrain() {
    if (!arcgisTerrainPromise) arcgisTerrainPromise = Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(ESRI_WORLD_ELEVATION_URL);
    return arcgisTerrainPromise;
  }
  // Cesium's own defaults, restored whenever terrain is off so flat-globe browsing
  // is pixel-for-pixel what it always was - only real elevation pays the reduced-
  // detail cost below.
  const DEFAULT_TERRAIN_SSE = globe.maximumScreenSpaceError; // 2
  const DEFAULT_FOG_DENSITY = scene.fog.density;              // 0.0006
  const DEFAULT_FOG_SSE_FACTOR = scene.fog.screenSpaceErrorFactor; // 2.0
  function setTerrainEnabled(on) {
    terrainOn = on;
    polarCapShow = on;
    polarCapPrimitives.forEach(p => p.show = on);
    if (!on) {
      scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      globe.maximumScreenSpaceError = DEFAULT_TERRAIN_SSE;
      scene.fog.density = DEFAULT_FOG_DENSITY;
      scene.fog.screenSpaceErrorFactor = DEFAULT_FOG_SSE_FACTOR;
      return;
    }
    // Real terrain is the expensive part: a much heavier mesh than the flat
    // ellipsoid, streamed in as you pan/zoom. Two levers, both trading a bit of
    // close-up crispness for meaningfully less geometry/tile traffic:
    //  - maximumScreenSpaceError: how coarse a tile is allowed to look before
    //    Cesium fetches a more detailed replacement. Doubling it roughly quarters
    //    the triangle/tile count for the same view.
    //  - fog.screenSpaceErrorFactor (+ a denser fog): lets tiles near the horizon
    //    go even coarser than that, and fog.density pulls in how close "near the
    //    horizon" starts - this is the actual "limit render distance" knob; fog
    //    auto-disables above ~800km altitude, so it never affects the zoomed-out
    //    whole-Earth view, only close-up browsing where tile count is the real cost.
    globe.maximumScreenSpaceError = DEFAULT_TERRAIN_SSE * 2;
    scene.fog.density = DEFAULT_FOG_DENSITY * 2.5;
    scene.fog.screenSpaceErrorFactor = DEFAULT_FOG_SSE_FACTOR * 2;
    arcgisTerrain().then(p => {
      if (!terrainOn || widget.isDestroyed()) return; // toggled off (or closed) again before this resolved
      scene.terrainProvider = p;
    }).catch(() => { terrainOn = false; toast('⚠️ Terrain relief unavailable - showing flat globe'); });
  }
  if (terrainOn) setTerrainEnabled(true);

  // ── Clouds: translucent shell just above the ellipsoid, drifts independently ──
  const cloudRadius = 6378137 * 1.006;
  const cloudsPrimitive = scene.primitives.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.EllipsoidGeometry({
        radii: new Cesium.Cartesian3(cloudRadius, cloudRadius, cloudRadius),
        vertexFormat: Cesium.MaterialAppearance.VERTEX_FORMAT
      })
    }),
    appearance: new Cesium.MaterialAppearance({
      material: Cesium.Material.fromType('Image', { image: EARTH_TEXTURES.clouds }),
      faceForward: true,
      translucent: true,
      // Decorative haze only - must never write depth, or this shell (fixed ~38km
      // above the surface) occludes/hides pins whose offset is smaller than that
      // while clouds are fading in (they did: a dead pickability zone at exactly the
      // camera altitudes where the cloud fade is partway in).
      renderState: { depthMask: false }
    }),
    // Decorative only - must never intercept clicks either, or it blocks picking
    // pins during the exact camera range where the cloud fade is partway in
    // (confirmed: scene.pick() was hitting the cloud shell instead of the pin).
    allowPicking: false,
    asynchronous: false
  }));
  let cloudAngle = 0;
  // Reused every frame instead of letting fromRotationZ/fromRotationTranslation
  // allocate a fresh Matrix3+Matrix4 each time - same scratch-variable convention
  // Cesium's own per-frame code uses, avoids needless GC churn on an animation
  // that runs for as long as the globe stays open.
  const scratchCloudRotation = new Cesium.Matrix3();
  const scratchCloudMatrix = new Cesium.Matrix4();

  // ── Trip routes: only ever populated by controller.showRoutes(), which
  // renderer.js calls exclusively from Relive Trip's day playback - never built
  // or shown during ordinary free-roam browsing. Recreated (not re-styled) on
  // every call, same as the pin billboards, since the set of legs/modes changes
  // each time the day changes.
  let routeCollection = null;
  let routeIconBillboards = null; // one emoji badge per leg, at its line's midpoint
  function clearRoutesInternal() {
    if (routeCollection) { scene.primitives.remove(routeCollection); routeCollection = null; }
    if (routeIconBillboards) { scene.primitives.remove(routeIconBillboards); routeIconBillboards = null; }
  }

  // ── Pins: photo-tile markers (see composePhotoPin above), clustered and colored
  // by trip. Rebuilt (not just re-styled) whenever the camera settles after a pan
  // or zoom - narrowed to only the currently-visible photos (see visibleGpsFiles)
  // and grouped by on-screen proximity (see clusterByScreenProximity), so pins that
  // visually touch pop apart into individual photos once you zoom in far enough to
  // separate them, and re-merge on zooming back out, without ever building
  // billboards for the (often thousands of) off-screen photos elsewhere in the
  // library - kept in its own collection, separate from the pending "set location"
  // marker below, so rebuilding never touches that.
  // `scene` must be passed to the constructor (not just added via scene.primitives.add)
  // for heightReference (ground-clamping, below) to work at all - omitting it doesn't
  // just skip clamping, it crashes the whole render loop the first time a clamped
  // billboard is drawn, since Cesium's internal writer for that vertex attribute
  // unconditionally dereferences collection._scene.globe with no defined() guard.
  let pinBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  // Every image a billboard shows is packed into the collection's GPU texture atlas under
  // an id, and Cesium never frees atlas entries. Pins are given stable ids (the canvas cache
  // key) so re-clustering reuses what's already uploaded; this set counts what's been
  // uploaded so far, and once it passes PIN_ATLAS_MAX_IMAGES the whole collection (and its
  // atlas) is swapped for a fresh one at the next rebuild, so a long session of zooming
  // around a big library can't grow the atlas without bound (each growth step re-copies
  // the whole texture on the GPU - a visible hitch).
  const PIN_ATLAS_MAX_IMAGES = 600;
  let pinAtlasIds = new Set();
  // Live pins by identity (see pinIdentity in rebuildPins), so a rebuild only removes the
  // pins whose cluster actually changed and adds the new ones, instead of tearing down and
  // recreating every billboard on every zoom step.
  let pinByKey = new Map();

  // ── Trip markers: one round "regroup" badge per trip, tinted with its folder
  // color, independent of the regular per-photo billboards above, which are
  // untouched. Built once (trips don't change while the globe is open) and kept
  // in their own collection - see groupedTripIds below for when each is shown.
  const tripPinImageCache = new Map();
  function tripPinImageForColor(color) {
    const key = color || '';
    let img = tripPinImageCache.get(key);
    if (!img) { img = composeTripPinCanvas(color); tripPinImageCache.set(key, img); }
    return img;
  }
  const tripBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const tripRefs = (opts.trips || []).map(trip => {
    const position = Cesium.Cartesian3.fromDegrees(trip.lng, trip.lat, 0);
    const b = tripBillboards.add({
      position,
      image: tripPinImageForColor(trip.color),
      width: 40, height: 40,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      // Clamps the billboard's actual render height to the real terrain surface at
      // its lat/lng each time terrain data updates there - a no-op when terrain is
      // off (flat ellipsoid = height 0 everywhere anyway) but keeps markers sitting
      // on the ground instead of at literal sea level once real relief is on.
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      show: false,
      id: trip
    });
    return { billboard: b, position, trip, fileIdSet: new Set(trip.fileIds), offsetY: 0, spread: false };
  });
  // Globe filter (renderer.js's "Show" menu): which trips/adventures may show a dot at all.
  // null = every one. Photo pins are filtered upstream - see setFilter() below.
  let allowedTripIds = opts.allowedTripIds || null;

  // Mutable so Relive Trip (renderer.js) can narrow the map down to a single day's
  // photos via controller.showSubset() below, then hand back the whole library via
  // controller.showAll() - rebuildPins() always reads this, not the original
  // gpsFiles param directly, so both modes share the exact same clustering/pin code.
  // baseGpsFiles is what the free-roam view shows (the whole library, or whatever the globe
  // filter / hidden photos leave of it - see setFilter()); showAll() returns to it after Relive.
  let baseGpsFiles = gpsFiles;
  let activeGpsFiles = gpsFiles;

  let pinRefs = [];
  // A trip's fat marker sits on whichever screen-cluster currently holds the most of
  // that trip's photos (its "main mass"), not a fixed average position - so a single
  // outlier (e.g. one photo from the airport you flew into) doesn't drag the marker to
  // a meaningless spot or block it from showing. With 1 or 2 clusters (a tight trip, or a
  // tight trip plus one stray outlier) the dot sits right on that cluster. A trip whose
  // photos are spread over 3+ clusters (a road trip - Cinque Terre along the coast) used to
  // lose its dot entirely and could never be clicked; now it keeps it, floating just above
  // its biggest cluster's pin so it doesn't cover the photo. Recomputed alongside the pins
  // every time they rebuild, so both stay in lockstep on every pan/zoom.
  const TRIP_SPREAD_CLUSTERS = 3; // from this many clusters on, the dot floats above the pin
  let groupedTripIds = new Set();
  let lastPinRebuild = 0;
  function rebuildPins() {
    lastPinRebuild = performance.now();
    if (pinAtlasIds.size > PIN_ATLAS_MAX_IMAGES) {
      scene.primitives.remove(pinBillboards); // also destroys it and its atlas
      pinBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
      pinAtlasIds = new Set();
      for (const ref of pinByKey.values()) ref.dead = true;
      pinByKey = new Map();
    }
    const visible = visibleGpsFiles(activeGpsFiles, widget.camera, globe.ellipsoid);
    // Relive Trip (trip markers hidden) is already one trip's single day - keep its pins
    // at the normal radius so the day's individual stops stay visible.
    const tripTouchPx = tripBillboards.show
      ? tripTouchPxForHeight(widget.camera.positionCartographic.height)
      : CLUSTER_TOUCH_PX;
    const clusters = clusterByScreenProximity(visible, scene, occluder, opts.tripColors, opts.roundPinIds, opts.pinGroupOf, tripTouchPx);

    // fileId -> cluster index, built once per rebuild so the two passes below
    // (dominant-cluster-per-trip, and carousel visibility) are each a per-trip
    // walk of just that trip's own file ids with an O(1) lookup, instead of every
    // trip re-scanning every cluster's whole file list (O(trips × visible files)).
    const clusterIdxOf = new Map();
    clusters.forEach((c, i) => { for (const f of c.files) clusterIdxOf.set(f.id, i); });

    groupedTripIds = new Set();
    for (const t of tripRefs) {
      const countByCluster = new Map(); // cluster index -> how many of this trip's photos landed there
      for (const fid of t.fileIdSet) {
        const idx = clusterIdxOf.get(fid);
        if (idx === undefined) continue;
        countByCluster.set(idx, (countByCluster.get(idx) || 0) + 1);
      }
      if (countByCluster.size === 0) continue;
      if (allowedTripIds && !allowedTripIds.has(t.trip.id)) continue;
      let bestIdx = -1, bestCount = -1;
      for (const [idx, n] of countByCluster) if (n > bestCount) { bestCount = n; bestIdx = idx; }
      const dominant = clusters[bestIdx];
      // Only touched when it actually moved - re-setting a ground-clamped billboard's
      // position re-registers its terrain height lookup even if nothing changed.
      if (t.lat !== dominant.lat || t.lng !== dominant.lng) {
        t.lat = dominant.lat; t.lng = dominant.lng;
        t.position = Cesium.Cartesian3.fromDegrees(dominant.lng, dominant.lat, 0);
        t.billboard.position = t.position;
      }
      t.spread = countByCluster.size >= TRIP_SPREAD_CLUSTERS;
      const offsetY = t.spread ? -(photoPinDimensions(dominant.count > 1).height + 20) : 0;
      if (offsetY !== t.offsetY) { t.offsetY = offsetY; t.billboard.pixelOffset = new Cesium.Cartesian2(0, offsetY); }
      groupedTripIds.add(t.trip.id);
    }

    // Globe trip carousel (renderer.js): which trips have a photo actually on
    // screen right now, reusing the cluster lookup built above.
    // Suppressed during Relive Trip (tripBillboards hidden via showSubset()) -
    // that has its own day-bar UI for the trip it's already reliving.
    if (opts.onGlobeCarouselUpdate) {
      const visibleTripIds = new Set();
      if (tripBillboards.show) {
        for (const t of tripRefs) {
          if (allowedTripIds && !allowedTripIds.has(t.trip.id)) continue;
          for (const fid of t.fileIdSet) { if (clusterIdxOf.has(fid)) { visibleTripIds.add(t.trip.id); break; } }
        }
      }
      opts.onGlobeCarouselUpdate({ visibleTripIds });
    }

    // A pin is kept as-is across rebuilds when it would look identical: same marker image
    // (representative + fan photos + color/shape), same photo count, same spot, and the
    // same terrain mode (heightReference below depends on it).
    const pinIdentity = c => globeThumbRevision + '|' + pinCacheKeyFor(c) + '|' + c.count + '|' + c.lat + ',' + c.lng + (terrainOn ? '|t' : '');
    const setPinImage = (b, id, canvas) => {
      pinAtlasIds.add(id);
      b.setImage(id, canvas);
    };
    const nextByKey = new Map();
    pinRefs = clusters.map(c => {
      const key = pinIdentity(c);
      const kept = pinByKey.get(key);
      if (kept && !nextByKey.has(key)) {
        kept.billboard.id = c; // fresh cluster object (same photos) for click/context menu
        nextByKey.set(key, kept);
        return kept;
      }
      const isCluster = c.count > 1;
      const { width, height } = photoPinDimensions(isCluster);
      // The pointer tail's tip (bottom of the marker image) sits right at the true GPS point.
      const position = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 0);
      const b = pinBillboards.add({
        position,
        width, height,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        // No scaleByDistance: photos stay the same on-screen size at every zoom level
        // (see photoPinDimensions), so they're always big enough to recognize and never
        // balloon up close into obscuring their neighbors.
        //
        // Never depth-tested against the globe - a height offset large enough to clear
        // the depth buffer's precision floor at every zoom level made pins visibly float
        // off their true position when viewed from the side. Occlusion on the far side
        // is instead handled manually below via EllipsoidalOccluder each frame.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Orthogonal to the above: this clamps the pin's actual world position to
        // wherever the real ground is (mountain, valley...) instead of literal sea
        // level, it just doesn't affect whether it's depth-tested once placed there.
        // Flat globe (terrain off): the ground IS height 0, so clamping would only add a
        // per-pin terrain height lookup (registered on add, torn down on remove) for nothing.
        heightReference: terrainOn ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        id: c // whole cluster (c.files holds every photo at this spot, not just the representative)
      });
      // Hit-test radius for click picking (see the click handler below) - roughly
      // half the marker's on-screen footprint, a little padded for easy clicking.
      const ref = { billboard: b, position, hitRadius: Math.max(width, height) / 2 + 4, dead: false };
      const imageKey = globeThumbRevision + ':' + pinCacheKeyFor(c);
      const canvasPromise = buildPhotoPinCanvas(c);
      if (canvasPromise.canvas) {
        setPinImage(b, 'pin:' + imageKey, canvasPromise.canvas); // already composed - no placeholder flash
      } else {
        setPinImage(b, 'ph:' + (isCluster ? 'c' : 's') + (c.round ? 'o' : '') + ':' + (c.color || ''), photoPinPlaceholder(isCluster, c.color, c.round));
        canvasPromise.then(canvas => {
          if (ref.dead || widget.isDestroyed()) return; // removed by a later rebuild
          setPinImage(b, 'pin:' + imageKey, canvas);
        });
      }
      nextByKey.set(key, ref);
      return ref;
    });
    for (const [key, ref] of pinByKey) {
      if (nextByKey.get(key) === ref) continue;
      ref.dead = true;
      pinBillboards.remove(ref.billboard);
    }
    pinByKey = nextByKey;
  }

  // Re-cluster as the camera moves - both zoom and pan matter (zoom changes how far apart
  // pins project on screen, pan changes which photos are in view). camera.changed only
  // fires once the camera has "moved more than ~15%" since last time, and on top of that a
  // fast scroll-zoom is capped to one rebuild per PIN_REBUILD_MIN_MS so a quick flick into
  // a dense trip doesn't stack several full re-clusters into the same few frames. moveEnd
  // always gets a final, immediate rebuild so the pins match exactly where you stopped.
  scene.camera.percentageChanged = 0.15;
  const PIN_REBUILD_MIN_MS = 150;
  let pinRebuildTimer = null;
  const runScheduledRebuild = () => {
    pinRebuildTimer = null;
    if (widget.isDestroyed()) return;
    rebuildPins();
    scene.requestRender();
  };
  const onCameraChanged = () => {
    if (pinRebuildTimer) return;
    const wait = Math.max(0, PIN_REBUILD_MIN_MS - (performance.now() - lastPinRebuild));
    pinRebuildTimer = setTimeout(runScheduledRebuild, wait);
  };
  const onCameraMoveEnd = () => {
    if (pinRebuildTimer) clearTimeout(pinRebuildTimer);
    runScheduledRebuild();
  };
  scene.camera.changed.addEventListener(onCameraChanged);
  scene.camera.moveEnd.addEventListener(onCameraMoveEnd);

  // ── Pending location marker (set-location pick mode only) - its own collection,
  // untouched by rebuildPins() above ─────────────────────────────────────────
  const pendingBillboards = opts.pickMode ? scene.primitives.add(new Cesium.BillboardCollection({ scene })) : null;
  const pendingPin = opts.pickMode ? {
    billboard: pendingBillboards.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
      image: makeTargetPinCanvas(),
      width: 28, height: 28,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 2.0e7, 2.6),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      show: false
    }),
    position: null
  } : null;

  // ── Location highlight (hover in Relive's day photo panel, "See on Map") ───
  const highlightBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const highlightBillboard = highlightBillboards.add({
    position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
    image: makeHighlightCanvas(),
    width: 60, height: 60,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 2.0e7, 1.8), // stays readable zoomed way out too
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    show: false
  });
  let highlightPosition = null;

  // ── Idle auto-spin: stops for good after the first user interaction ────────
  // (in pick mode, precision matters immediately, so it never starts spinning)
  // Clouds follow the exact same rule: visible only before the user has touched the
  // globe at all, quick-fading out the moment they pan/zoom/drag, and - like the
  // spin - never coming back once that first interaction happens.
  const CLOUD_FADE_MS = 500;
  let hasInteracted = !!opts.pickMode;
  let cloudFadeStart = hasInteracted ? -Infinity : null; // -Infinity = already fully faded from frame 1
  const stopAutoSpin = () => {
    if (hasInteracted) return;
    hasInteracted = true;
    cloudFadeStart = performance.now();
  };
  scene.canvas.addEventListener('pointerdown', stopAutoSpin);
  scene.canvas.addEventListener('wheel', stopAutoSpin);

  const onPreRender = () => {
    if (!hasInteracted) widget.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00025);
    cloudAngle += 0.00004;
    cloudsPrimitive.modelMatrix = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationZ(cloudAngle, scratchCloudRotation), Cesium.Cartesian3.ZERO, scratchCloudMatrix
    );

    const cloudFade = cloudFadeStart === null ? 1 : Math.max(0, 1 - (performance.now() - cloudFadeStart) / CLOUD_FADE_MS);
    cloudsPrimitive.show = cloudFade > 0.005;
    cloudsPrimitive.appearance.material.uniforms.color.alpha = cloudFade;

    // Day/night fades on the same curve. Cesium only has a distance-based lighting fade
    // (shader: lit = clamp((camDist - fadeOut) / (fadeIn - fadeOut))), so the fade
    // distances are slid each frame to scale that down by cloudFade at the current
    // camera distance, then lighting is switched off entirely once fully faded.
    if (cloudFade <= 0.005) {
      if (globe.enableLighting) globe.enableLighting = false;
    } else if (cloudFade < 1) {
      const camDist = Cesium.Cartesian3.magnitude(scene.camera.positionWC);
      const span = DEFAULT_LIGHT_FADE_IN - DEFAULT_LIGHT_FADE_OUT;
      const lit = Cesium.Math.clamp((camDist - DEFAULT_LIGHT_FADE_OUT) / span, 0, 1) * cloudFade;
      globe.lightingFadeOutDistance = camDist - lit * span;
      globe.lightingFadeInDistance = globe.lightingFadeOutDistance + span;
    }

    const camAlt = globe.ellipsoid.cartesianToCartographic(scene.camera.positionWC)?.height ?? LABELS_HIDDEN_ALT;
    const labelsAlpha = Cesium.Math.clamp((LABELS_HIDDEN_ALT - camAlt) / (LABELS_HIDDEN_ALT - LABELS_FULL_ALT), 0, 1);
    labelsLayer.alpha = labelsAlpha;
    labelsLayer.show = labelsAlpha > 0.005;

    occluder.cameraPosition = scene.camera.positionWC;
    const t = performance.now() / 1000;
    pinRefs.forEach(r => {
      // Depth testing is disabled on these billboards (see above), so hiding pins on
      // the far side of the globe has to be done by hand instead of relying on the GPU.
      // No pulsing scale here (unlike trip/highlight markers below) - photo tiles hold
      // a fixed on-screen size so they stay legible and don't crowd their neighbors.
      r.billboard.show = occluder.isPointVisible(r.position);
    });
    if (pendingPin && pendingPin.position) pendingPin.billboard.show = occluder.isPointVisible(pendingPin.position);

    tripRefs.forEach(r => {
      const pulse = 1 + 0.06 * Math.sin(t * 1.6);
      r.billboard.scale = pulse * (r.spread ? 0.85 : 1);
      r.billboard.show = groupedTripIds.has(r.trip.id) && occluder.isPointVisible(r.position);
    });

    if (highlightPosition) {
      highlightBillboard.scale = 1 + 0.22 * Math.sin(t * 3);
      highlightBillboard.show = occluder.isPointVisible(highlightPosition);
    }
  };
  scene.preRender.addEventListener(onPreRender);
  // Drives the decorative per-frame animations (auto-spin, cloud drift, marker
  // pulse) now that requestRenderMode means nothing redraws on its own. Capped
  // well below display refresh rate on purpose - none of those motions are
  // fast enough for the eye to tell 30fps from 144fps, so this is pure GPU/CPU
  // savings with no visible quality loss. Camera drags/zooms stay perfectly
  // fluid regardless - Cesium's own controller calls scene.requestRender()
  // on every camera change independently of this ticker.
  let ambientTicker = setInterval(() => scene.requestRender(), 33);

  // ── Camera bounds & starting view, click-to-open pins ──────────────────────
  scene.screenSpaceCameraController.minimumZoomDistance = 300;
  scene.screenSpaceCameraController.maximumZoomDistance = 30000000;
  widget.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(15, 20, 22000000) });
  rebuildPins(); // initial pins, now that the camera is at its real starting position

  // scene.pick() (GPU id-buffer picking) turns out to reliably miss everything -
  // not just pins, the globe too - across large, reproducible bands of the zoom
  // range (confirmed: unpickable roughly 100km-800km up and again near the surface,
  // regardless of clouds/scaleByDistance, which were ruled out as the cause). So
  // clicks are matched by screen-space proximity to each pin's own live projected
  // position instead - the same technique the old Three.js globe used, and provably
  // reliable since worldToWindowCoordinates stayed accurate everywhere it was tested.
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction(movement => {
    if (pendingPin) {
      const point = widget.camera.pickEllipsoid(movement.position, globe.ellipsoid);
      if (!point) return; // click missed the globe (off into space)
      pendingPin.position = point;
      pendingPin.billboard.position = point;
      pendingPin.billboard.show = true;
      if (opts.onPick) {
        const carto = Cesium.Cartographic.fromCartesian(point);
        opts.onPick(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
      }
      return;
    }
    // Trip markers (only live/clickable while currently shown - see groupedTripIds)
    // take priority over the regular photo pins, since they're the bigger marker
    // sitting on top visually. Gated on the collection's own show flag, not just
    // each billboard's - r.billboard.show is recomputed every frame from cluster
    // count alone (see onPreRender) with no idea whether Relive Trip has hidden the
    // whole collection via showSubset(); during Relive a day's photos are usually
    // tight enough to still count as "grouped", so without this check clicking a
    // regular pin could hit an invisible trip marker sitting on top of it and pop
    // the "Relive Trip" popup instead of opening the photo you clicked.
    let tBestDist = 28, tBestRef = null;
    if (tripBillboards.show) tripRefs.forEach(r => {
      if (!r.billboard.show) return;
      const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, r.billboard.position);
      if (!sp) return;
      sp.y += r.offsetY;
      const d = Cesium.Cartesian2.distance(sp, movement.position);
      if (d < tBestDist) { tBestDist = d; tBestRef = r; }
    });
    if (tBestRef) {
      if (opts.onTripClick) {
        const canvasRect = scene.canvas.getBoundingClientRect();
        opts.onTripClick(tBestRef.trip, canvasRect.left + movement.position.x, canvasRect.top + movement.position.y);
      }
      return;
    }
    const bestRef = pinAt(movement.position);
    if (bestRef) openMediaPopup(bestRef.billboard.id);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function pinAt(position) {
    let bestDist = Infinity, bestRef = null;
    pinRefs.forEach(r => {
      if (!r.billboard.show) return; // hidden on the far side
      const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, r.billboard.position);
      if (!sp) return;
      const d = Cesium.Cartesian2.distance(sp, position);
      if (d < r.hitRadius && d < bestDist) { bestDist = d; bestRef = r; }
    });
    return bestRef;
  }
  // Right-click a photo pin: the same context menu as in the library (renderer.js decides
  // what it shows). A stacked pin hands over every photo in the stack.
  handler.setInputAction(movement => {
    if (pendingPin || !opts.onPinContextMenu) return;
    const ref = pinAt(movement.position);
    if (!ref) return;
    const rect = scene.canvas.getBoundingClientRect();
    opts.onPinContextMenu(ref.billboard.id, rect.left + movement.position.x, rect.top + movement.position.y);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  scene.canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ── Recon readout and sensors (Guided Sort's locate mission, pick mode only) ──
  // The lat/lng under the pointer, at most once a frame, for the HUD's coordinates readout;
  // null when the pointer is off the globe (out in space).
  if (opts.pickMode && opts.onHover) {
    let hoverAt = null, hoverFrame = 0;
    handler.setInputAction(movement => {
      hoverAt = movement.endPosition;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (widget.isDestroyed()) return;
        const point = widget.camera.pickEllipsoid(hoverAt, globe.ellipsoid);
        if (!point) { opts.onHover(null); return; }
        const carto = Cesium.Cartographic.fromCartesian(point);
        opts.onHover(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
      });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // A lat/lng box padded so a single point (or a tight cluster) isn't framed absurdly close.
  function paddedRect(bounds) {
    const latPad = Math.max((bounds.maxLat - bounds.minLat) * 0.35, 0.06);
    const lngPad = Math.max((bounds.maxLng - bounds.minLng) * 0.35, 0.06);
    return Cesium.Rectangle.fromDegrees(bounds.minLng - lngPad, bounds.minLat - latPad, bounds.maxLng + lngPad, bounds.maxLat + latPad);
  }
  // Is this lat/lng on screen right now: projected inside the canvas (minus a margin) and on
  // the near side of the globe.
  function isInFrame(lat, lng, margin) {
    const pos = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
    occluder.cameraPosition = scene.camera.positionWC;
    if (!occluder.isPointVisible(pos)) return false;
    const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
    return !!sp && sp.x > margin && sp.x < scene.canvas.clientWidth - margin &&
      sp.y > margin && sp.y < scene.canvas.clientHeight - margin;
  }

  return {
    cleanup() {
      clearInterval(ambientTicker);
      scene.canvas.removeEventListener('pointerdown', stopAutoSpin);
      scene.canvas.removeEventListener('wheel', stopAutoSpin);
      scene.preRender.removeEventListener(onPreRender);
      scene.camera.changed.removeEventListener(onCameraChanged);
      scene.camera.moveEnd.removeEventListener(onCameraMoveEnd);
      if (pinRebuildTimer) clearTimeout(pinRebuildTimer);
      handler.destroy();
      if (!widget.isDestroyed()) widget.destroy();
    },
    // Live toggle for the globe topbar's "3D Terrain" button - swaps the terrain
    // provider without reopening the globe. Also re-clusters immediately so
    // clamped pin heights (see heightReference below) pick up the new surface
    // right away instead of waiting for the next pan/zoom to settle.
    setTerrainEnabled(on) { setTerrainEnabled(on); rebuildPins(); scene.requestRender(); },
    // Pauses the decorative ambient-render ticker (auto-spin/cloud drift/marker pulse) without
    // touching anything else - used when the app loses OS focus (see onAppFocusChange() in
    // renderer.js) so an idle-but-open globe doesn't keep requesting GPU frames nobody's
    // watching while a video/photo editor running alongside needs that headroom. Camera drags/
    // zooms still render fine either way - Cesium's own controller calls requestRender()
    // independently of this ticker (see the comment above it).
    setAmbientPaused(paused) {
      clearInterval(ambientTicker);
      if (!paused) ambientTicker = setInterval(() => scene.requestRender(), 33);
    },
    // Hides the pending "set location" marker without touching the camera or
    // rebuilding anything - lets Guided Sort's location picker confirm one photo's
    // spot and immediately be ready for the next click, camera exactly where it was
    // (placing several nearby photos in a row shouldn't mean re-finding the spot).
    clearPendingPin() {
      if (!pendingPin) return;
      pendingPin.position = null;
      pendingPin.billboard.show = false;
    },
    // Where a lat/lng is in the page right now ({x, y} in client pixels), or null when it's
    // on the far side of the globe - for effects drawn over the globe at a spot.
    screenPosition(lat, lng) {
      const pos = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
      occluder.cameraPosition = scene.camera.positionWC;
      if (!occluder.isPointVisible(pos)) return null;
      const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
      if (!sp) return null;
      const rect = scene.canvas.getBoundingClientRect();
      return { x: rect.left + sp.x, y: rect.top + sp.y };
    },
    cameraHeight() {
      return Cesium.Cartographic.fromCartesian(widget.camera.positionWC).height;
    },
    // ── Relive Trip (renderer.js) ──────────────────────────────────────────
    // Narrows the map down to exactly `files` (typically one day's photos) -
    // same clustering/pin code as the normal view, just a smaller input set -
    // and hides the trip markers so they don't compete for attention with that
    // day's own pins while stepping through a trip.
    showSubset(files) {
      activeGpsFiles = files;
      tripBillboards.show = false;
      stopAutoSpin(); // never let idle auto-spin fight the Relive camera - also fades the clouds, same as a manual interaction
      rebuildPins();
    },
    // Globe filter / hidden photos: swaps which photos the free-roam view shows and which
    // trips may show a dot, without rebuilding the globe (camera stays where it is).
    setFilter(files, tripIds) {
      baseGpsFiles = files;
      allowedTripIds = tripIds || null;
      if (tripBillboards.show) activeGpsFiles = files; // not mid-Relive - that keeps its own subset
      rebuildPins();
      scene.requestRender();
    },
    // Trip objects are patched in place by renderer.js (a photo hidden from the map changes a
    // trip's photo list); re-read their file lists.
    refreshTrips() {
      tripRefs.forEach(r => { r.fileIdSet = new Set(r.trip.fileIds || []); });
      rebuildPins();
    },
    showAll() {
      activeGpsFiles = baseGpsFiles;
      tripBillboards.show = true;
      clearRoutesInternal(); // leaving Relive (or the whole free-roam view) must never leave a route behind
      rebuildPins();
    },
    // Frames a lat/lng bounding box - padded so a single-point (or tightly
    // clustered) day doesn't fly in absurdly close - used to fly the camera to
    // each day of a trip in turn, and by "See on Map".
    flyToBounds(bounds, durationSec = 1.5) {
      // Any programmatic camera move must count as "interacted" - without this,
      // opening the globe via "See on Map" (never touched by the mouse) left the
      // idle auto-spin running underneath the fly-to, so the camera kept drifting
      // right after settling on the target instead of holding still on it. Routed
      // through stopAutoSpin() (not a bare hasInteracted=true) so this also starts the
      // cloud fade - a raw assignment here left clouds stuck at full opacity forever,
      // since stopAutoSpin()'s own "if (hasInteracted) return" guard then skipped the
      // fade-start on every later manual scroll/drag too, once hasInteracted was already
      // true from this fly-to. Caught via the onboarding wizard's auto fly-to-trip step.
      stopAutoSpin();
      widget.camera.flyTo({ destination: paddedRect(bounds), duration: durationSec });
    },
    // Guided Sort's location suggestions: bring these points into view without undoing the
    // user's own zoom. Zoomed further out than flyToBounds would frame them -> fly in to them.
    // Zoomed in that close or closer -> keep the zoom: leave the camera alone if every point is
    // already on screen, otherwise slide over (same height and tilt) to centre them.
    focusPoints(points) {
      if (!points.length) return;
      const bounds = {
        minLat: Math.min(...points.map(p => p.lat)), maxLat: Math.max(...points.map(p => p.lat)),
        minLng: Math.min(...points.map(p => p.lng)), maxLng: Math.max(...points.map(p => p.lng))
      };
      const rect = paddedRect(bounds);
      const framedHeight = Cesium.Cartographic.fromCartesian(widget.camera.getRectangleCameraCoordinates(rect)).height;
      const curHeight = Cesium.Cartographic.fromCartesian(widget.camera.positionWC).height;
      stopAutoSpin();
      if (curHeight > framedHeight * 1.3) { widget.camera.flyTo({ destination: rect, duration: 1.2 }); return; }
      if (points.every(p => isInFrame(p.lat, p.lng, 40))) return;
      // Slide: aim at the points' centre from the current distance, keeping heading and pitch.
      const centre = Cesium.Cartesian3.fromDegrees((bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2, 0);
      const mid = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
      const onGround = widget.camera.pickEllipsoid(mid, globe.ellipsoid);
      const range = onGround ? Cesium.Cartesian3.distance(widget.camera.positionWC, onGround) : curHeight;
      widget.camera.flyToBoundingSphere(new Cesium.BoundingSphere(centre, 0), {
        offset: new Cesium.HeadingPitchRange(widget.camera.heading, widget.camera.pitch, range),
        duration: 0.8
      });
    },
    // Renders one polyline per leg - segments: [{ points:[{lat,lng}...], mode, color }].
    // Relive-Trip-only by construction: the only caller is renderDayLegRoutes() in
    // renderer.js, itself only reachable from showReliveDay(). Recreated from scratch
    // each call (cheap - a trip day has a handful of legs at most).
    showRoutes(segments) {
      clearRoutesInternal();
      if (!segments || !segments.length) return;
      routeCollection = scene.primitives.add(new Cesium.PolylineCollection());
      routeIconBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
      segments.forEach(seg => {
        if (!seg.points || seg.points.length < 2) return;
        const style = MODE_ROUTE_STYLE[seg.mode] || MODE_ROUTE_STYLE.drive;
        const color = Cesium.Color.fromCssColorString(seg.color || '#06b6d4');
        let positions;
        if (style.arc) {
          const a = seg.points[0], b = seg.points[seg.points.length - 1];
          positions = buildFlightArcPositions(a.lat, a.lng, b.lat, b.lng);
        } else {
          const flat = [];
          seg.points.forEach(p => flat.push(p.lng, p.lat));
          positions = Cesium.Cartesian3.fromDegreesArray(flat);
        }
        const material = style.dash
          ? Cesium.Material.fromType('PolylineDash', { color, dashLength: style.dashLength, dashPattern: style.dashPattern })
          : Cesium.Material.fromType('Color', { color: color.withAlpha(0.85) });
        routeCollection.add({ positions, width: 3.5, material });
        // Emoji badge at the line's midpoint - for flight arcs the midpoint is the
        // arc's peak (positions already carry height there), which reads perfectly.
        routeIconBillboards.add({
          position: positions[Math.floor(positions.length / 2)],
          image: modeIconCanvas(seg.mode),
          width: 30, height: 30,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        });
      });
    },
    clearRoutes() { clearRoutesInternal(); },
    // "Where exactly was this photo taken" - a pulsing ring at one precise lat/lng,
    // used by Relive's day photo panel (on hover) and "See on Map" (any file's
    // context menu). Doesn't move the camera - callers that need that call
    // flyToBounds separately (see ctxSeeOnMap in renderer.js).
    showHighlight(lat, lng) {
      highlightPosition = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
      highlightBillboard.position = highlightPosition;
      highlightBillboard.show = true;
    },
    hideHighlight() {
      highlightPosition = null;
      highlightBillboard.show = false;
    },
    // Hovering a photo in Relive's day photo panel: shows the marker AND helps you
    // actually find it - nudges the camera a little toward the point if it's already
    // on screen (a hint of "it's this way", not a jarring snap), or fully recenters
    // on it (same zoom/tilt, just repositioned) if it's out of frame entirely. Plain
    // linear lerp between the camera's current ground point and the target - fine at
    // trip scale, never near a pole or the antimeridian.
    hoverHighlight(lat, lng) {
      highlightPosition = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
      highlightBillboard.position = highlightPosition;
      highlightBillboard.show = true;
      stopAutoSpin(); // this counts as a deliberate camera move - stop the idle spin (and fade the clouds, if not already)

      const inFrame = isInFrame(lat, lng, 70);

      const camCarto = Cesium.Cartographic.fromCartesian(widget.camera.positionWC);
      const curLat = Cesium.Math.toDegrees(camCarto.latitude), curLng = Cesium.Math.toDegrees(camCarto.longitude);
      const t = inFrame ? 0.25 : 1; // small nudge if already visible, full recenter otherwise
      widget.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(curLng + (lng - curLng) * t, curLat + (lat - curLat) * t, camCarto.height),
        orientation: { heading: widget.camera.heading, pitch: widget.camera.pitch, roll: widget.camera.roll },
        duration: inFrame ? 0.4 : 0.7
      });
    }
  };
}
