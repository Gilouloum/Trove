// node scripts/preview-similar-shots.js [--data <library folder>] [--out <file.html>]
//
// Renders similarShots.js's groups for every trip in a library as one local HTML page, with a
// strictness slider, so the grouping can be judged on real photos before any duel is built on
// it. Read-only: it reads the library JSON, the embeddings and the cached thumbnails, and
// writes nothing but the page (to the system temp folder by default). The page loads the
// thumbnails straight from the library's thumbs folder and makes no network request.
//
// --data defaults to the sandbox library (data-sandbox/). Point it at a *copy* of a real
// library's filelinker-data.json + embeddings/ if you like; --thumbs can then point at the
// original thumbs/ folder, which is only ever read.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const TroveMedia = require('../media-types');
const { MAX_GAP_MS } = require('../similarShots');

const root = path.join(__dirname, '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const dataDir = path.resolve(arg('--data') || path.join(root, 'data-sandbox'));
const thumbDir = path.resolve(arg('--thumbs') || path.join(dataDir, 'thumbs'));
const out = path.resolve(arg('--out') || path.join(os.tmpdir(), 'trove-similar-shots.html'));

const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'filelinker-data.json'), 'utf8'));
const vecCache = new Map();
function vec(id) {
  if (!vecCache.has(id)) {
    let v = null;
    try { const b = fs.readFileSync(path.join(dataDir, 'embeddings', id + '.bin')); v = new Float32Array(b.buffer, b.byteOffset, b.length / 4); } catch (e) {}
    vecCache.set(id, v);
  }
  return vecCache.get(id);
}
function cosine(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

const tripRoots = new Set(['vacations-root', 'adventures-root']);
const trips = data.folders.filter(f => tripRoots.has(f.parentId));
const report = [];
for (const trip of trips) {
  const photos = data.files
    .filter(f => f.folders?.includes(trip.id) && TroveMedia.IMAGE.has((f.ext || "").toLowerCase()) && f.fileDate && !f._missing && !f.isLivePhotoVideo)
    .sort((a, b) => a.fileDate - b.fileDate);
  if (!photos.length) continue;
  // Only pairs the grouping can ever compare (within MAX_GAP_MS) are needed, which keeps the
  // page small enough to regroup live as the slider moves.
  const sims = {};
  for (let i = 0; i < photos.length; i++) {
    const a = vec(photos[i].id);
    for (let j = i + 1; j < photos.length && photos[j].fileDate - photos[i].fileDate <= MAX_GAP_MS; j++) {
      const b = vec(photos[j].id);
      if (a && b) sims[photos[i].id + '|' + photos[j].id] = +cosine(a, b).toFixed(4);
    }
  }
  report.push({
    name: trip.name,
    photos: photos.map(f => ({
      id: f.id, t: f.fileDate, name: f.name, embedded: !!vec(f.id),
      thumb: fs.existsSync(path.join(thumbDir, f.id + '.jpg')) ? pathToFileURL(path.join(thumbDir, f.id + '.jpg')).href : null,
    })),
    sims,
  });
}

const moduleSrc = fs.readFileSync(path.join(root, 'similarShots.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Similar shots preview</title>
<style>
body{font:14px system-ui,sans-serif;background:#111;color:#ddd;margin:0;padding:16px 24px}
header{position:sticky;top:0;background:#111;padding:8px 0 12px;border-bottom:1px solid #333;z-index:1}
h2{margin:28px 0 6px;font-size:18px}.sub{color:#999;font-size:13px}
.group{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:8px;margin:6px 0;background:#1c1c1c;border-radius:6px}
.group .meta{width:100%;color:#999;font-size:12px;margin-bottom:2px}
.group img,.group .noimg{height:110px;border-radius:3px;background:#333}.noimg{width:110px;display:inline-block}
.singles img{height:56px;opacity:.6}
label{margin-right:16px}
</style></head><body>
<header><strong>Similar shots preview</strong>
<label style="margin-left:24px">Strictness <input id="s" type="range" min="-0.06" max="0.04" step="0.01" value="0"> <span id="sv">0</span></label>
<label><input id="showSingles" type="checkbox"> show single shots</label>
<span id="total" class="sub"></span></header>
<div id="out"></div>
<script>${moduleSrc}</script>
<script>
const REPORT = ${JSON.stringify(report)};
const fmt = ms => ms < 60000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 60000) + 'min';
const img = p => p.thumb ? '<img loading="lazy" src="' + p.thumb + '" title="' + p.name + '">' : '<span class="noimg" title="' + p.name + '"></span>';
function render() {
  const strictness = +document.getElementById('s').value;
  document.getElementById('sv').textContent = (strictness > 0 ? '+' : '') + strictness.toFixed(2);
  const showSingles = document.getElementById('showSingles').checked;
  let html = '', allPhotos = 0, allGroups = 0, allInGroups = 0;
  for (const trip of REPORT) {
    const byId = new Map(trip.photos.map(p => [p.id, p]));
    const sim = (a, b) => trip.sims[a + '|' + b] ?? trip.sims[b + '|' + a] ?? null;
    const groups = SimilarShots.groupSimilarShots(trip.photos.map(p => ({ id: p.id, t: p.t })), sim, { strictness });
    const multi = groups.filter(g => g.length > 1), singles = groups.filter(g => g.length === 1);
    const inGroups = multi.reduce((n, g) => n + g.length, 0);
    allPhotos += trip.photos.length; allGroups += multi.length; allInGroups += inGroups;
    const unembedded = trip.photos.filter(p => !p.embedded).length;
    html += '<h2>' + trip.name + '</h2><div class="sub">' + trip.photos.length + ' photos: ' + multi.length + ' groups holding ' + inGroups +
      ' photos, ' + singles.length + ' single shots' + (unembedded ? ', ' + unembedded + ' not analyzed yet' : '') + '</div>';
    for (const g of multi) {
      const ps = g.map(id => byId.get(id));
      html += '<div class="group"><div class="meta">' + ps.length + ' shots over ' + fmt(ps[ps.length - 1].t - ps[0].t) + ', ' + new Date(ps[0].t).toLocaleString() + '</div>' + ps.map(img).join('') + '</div>';
    }
    if (showSingles && singles.length) html += '<div class="group singles"><div class="meta">Single shots</div>' + singles.map(g => img(byId.get(g[0]))).join('') + '</div>';
  }
  document.getElementById('out').innerHTML = html;
  document.getElementById('total').textContent = allPhotos + ' photos in ' + REPORT.length + ' trips: ' + allGroups + ' groups holding ' + allInGroups + ' photos';
}
document.getElementById('s').oninput = render;
document.getElementById('showSingles').onchange = render;
render();
</script></body></html>`;

fs.writeFileSync(out, html);
console.log(`${report.length} trip(s) written to ${out}`);
