// PhotoMod's smart eraser: fills a hole in a picture with texture borrowed from around it.
//
// Two steps, on an image pyramid:
//   1. At a coarse level, the hole is filled from the outside in, one ring of pixels at a time:
//      every pixel copies the centre of the source patch that best matches what is already known
//      around it (Criminisi-style exemplar filling). Because each pixel is a real pixel from
//      somewhere else in the picture, edges and texture - a waterline, a jetty, ripples, sand -
//      carry on into the hole instead of fading out.
//   2. That "copied from here" map is carried up level by level to full resolution, and every
//      hole pixel copies its source pixel there. Neighbouring pixels that came from neighbouring
//      sources stay neighbours, so the fine detail arrives intact rather than resynthesised.
//
// There is deliberately no averaging step. The textbook recipe (PatchMatch plus voting, as in
// Wexler et al.) repaints each pixel as the mean of every patch that overlaps it, and on real
// photos that mean drifts to the flattest thing nearby: rippling water is matched better by a
// smooth patch of mountainside than by the same water shifted a few pixels, so a person standing
// in front of a lake came out as a grey smudge. Copying never invents a colour.
//
// No model and no download: it is plain arithmetic, which is why it lives in a worker - a big
// hole is a second or two of it, and the editor must stay responsive meanwhile.
//
// In:  { id, width, height, pixels: Uint8ClampedArray RGBA, mask: Uint8Array (1 = remove), grow }
// Out: { id, progress } while working, then { id, pixels, mask } (mask = the hole actually filled,
//      i.e. the input grown by `grow` px) or { id, error }.
'use strict';

const R = 3;           // patch radius: 7x7 patches
const P = 2 * R + 1;
// The coarse level is where the fill's layout is decided, so it must still be fine enough to
// hold the picture's bands (a strip of water between a mountain and a jetty) as more than a
// patch across. Coarsening stops once the hole is this many patches wide.
const COARSE_HOLE = 8 * P;
// Source patches tried per pixel on top of the neighbours' picks: an even spread of the picture.
const ONION_SAMPLE = 2500;

self.onmessage = e => {
  const { id, width, height, pixels, mask, grow } = e.data;
  try {
    const out = inpaint(width, height, pixels, mask, grow || 0, p => self.postMessage({ id, progress: p }));
    self.postMessage({ id, pixels: out.pixels, mask: out.mask }, [out.pixels.buffer, out.mask.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};

// Square dilation, separable: grows the hole by g px so the fill also covers the soft edge and
// shadow fringe a brush stroke tends to miss.
function dilate(m, w, h, g) {
  if (g <= 0) return m;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (m[row + x]) last = x; if (x - last <= g) tmp[row + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (m[row + x]) last = x; if (last - x <= g) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= g) out[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= g) out[y * w + x] = 1; }
  }
  return out;
}

// Halves a level. A coarse pixel is a hole if any of its children is, so the hole never shrinks
// on the way down and no half-object colour leaks into the coarse fill.
function downsample(L) {
  const { w, h, img, hole } = L;
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const img2 = new Float32Array(w2 * h2 * 4), hole2 = new Uint8Array(w2 * h2);
  for (let y2 = 0; y2 < h2; y2++) {
    for (let x2 = 0; x2 < w2; x2++) {
      let n = 0, r = 0, g = 0, b = 0, a = 0, anyHole = 0;
      for (let dy = 0; dy < 2; dy++) {
        const y = y2 * 2 + dy;
        if (y >= h) continue;
        for (let dx = 0; dx < 2; dx++) {
          const x = x2 * 2 + dx;
          if (x >= w) continue;
          const i = y * w + x;
          if (hole[i]) { anyHole = 1; continue; }
          r += img[i * 4]; g += img[i * 4 + 1]; b += img[i * 4 + 2]; a += img[i * 4 + 3]; n++;
        }
      }
      const j = y2 * w2 + x2;
      hole2[j] = anyHole;
      if (n) { img2[j * 4] = r / n; img2[j * 4 + 1] = g / n; img2[j * 4 + 2] = b / n; img2[j * 4 + 3] = a / n; }
    }
  }
  return { w: w2, h: h2, img: img2, hole: hole2 };
}

function holeExtent(L) {
  let x0 = L.w, y0 = L.h, x1 = -1, y1 = -1;
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (!L.hole[y * L.w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? 0 : Math.max(x1 - x0 + 1, y1 - y0 + 1);
}

// Where a source patch may come from: fully inside the picture and touching no hole pixel.
// A summed-area table of the hole makes the "touching no hole" test O(1) per position.
function sourceSet(L) {
  const { w, h, hole } = L;
  const sat = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += hole[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const valid = new Uint8Array(w * h);
  const list = [];
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const x0 = x - R, y0 = y - R, x1 = x + R + 1, y1 = y + R + 1;
      const s = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      if (s === 0) { valid[y * w + x] = 1; list.push(y * w + x); }
    }
  }
  return { valid, list: Int32Array.from(list) };
}

// Step 1: peel the hole from the outside in. Each ring pixel compares its surroundings - only
// the pixels already known, as a mean so a patch that sees fewer of them isn't favoured - with
// candidate source patches, and copies the best one's centre. Candidates are what its filled
// neighbours copied, shifted to line up (so a texture continues where it left off), then an
// even spread of the picture, then a close look around the best of those. `from` records which
// source pixel every hole pixel copied.
function onionFill(L, S, from, onProgress) {
  const { w, h, img, hole } = L;
  const known = new Uint8Array(w * h);
  let remaining = 0;
  for (let i = 0; i < w * h; i++) { known[i] = hole[i] ? 0 : 1; if (hole[i]) remaining++; }
  const total = remaining;
  const all = S.list, step = Math.max(1, Math.floor(all.length / ONION_SAMPLE));
  const spread = [];
  for (let i = 0; i < all.length; i += step) spread.push(all[i]);
  const near = Math.min(step, 8);
  const dist = (px, py, q) => {
    const qx = q % w, qy = (q / w) | 0;
    let s = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) {
      const ty = py + dy;
      if (ty < 0 || ty >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const tx = px + dx;
        if (tx < 0 || tx >= w) continue;
        const t = ty * w + tx;
        if (!known[t]) continue;
        const ti = t * 4, qi = ((qy + dy) * w + qx + dx) * 4;
        const a = img[ti] - img[qi], b = img[ti + 1] - img[qi + 1], c = img[ti + 2] - img[qi + 2];
        s += a * a + b * b + c * c; n++;
      }
    }
    return n ? s / n : Infinity;
  };
  const cand = [];
  while (remaining > 0) {
    const ring = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w]) ||
          (x > 0 && y > 0 && known[i - w - 1]) || (x < w - 1 && y > 0 && known[i - w + 1]) ||
          (x > 0 && y < h - 1 && known[i + w - 1]) || (x < w - 1 && y < h - 1 && known[i + w + 1])) ring.push(i);
    }
    if (!ring.length) break; // no known pixel anywhere - nothing to grow from
    // Chosen against the picture as it stood before this ring, so a ring's fill doesn't depend on
    // the order its own pixels happen to be visited in.
    const picks = new Int32Array(ring.length);
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k], px = p % w, py = (p / w) | 0;
      cand.length = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (!hole[nb] || !known[nb] || from[nb] < 0) continue;
        const cx = from[nb] % w - dx, cy = ((from[nb] / w) | 0) - dy;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h && S.valid[cy * w + cx]) cand.push(cy * w + cx);
      }
      let best = Infinity, bq = spread[0];
      for (const q of cand) { const d = dist(px, py, q); if (d < best) { best = d; bq = q; } }
      for (const q of spread) { const d = dist(px, py, q); if (d < best) { best = d; bq = q; } }
      const bx = bq % w, by = (bq / w) | 0;
      for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
        const cx = bx + dx, cy = by + dy;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h || !S.valid[cy * w + cx]) continue;
        const d = dist(px, py, cy * w + cx);
        if (d < best) { best = d; bq = cy * w + cx; }
      }
      picks[k] = bq;
    }
    for (let k = 0; k < ring.length; k++) {
      const i = ring[k], q = picks[k];
      img.set(img.subarray(q * 4, q * 4 + 4), i * 4);
      from[i] = q;
      known[i] = 1;
      remaining--;
    }
    onProgress(1 - remaining / total);
  }
}

// Step 2: one level up. A fine pixel's source is its coarse parent's source, doubled, plus the
// same offset within the 2x2 block - so the patch copied at the coarse level arrives with its
// full detail. Where that lands on a hole pixel (the finer hole's edge doesn't line up exactly
// with the coarse one), the pixel continues its left or upper neighbour's source instead.
function upsampleFrom(C, fromC, F) {
  const { w, h, img, hole } = F;
  const from = new Int32Array(w * h).fill(-1);
  const usable = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !hole[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!hole[i]) continue;
    let q = -1;
    const cq = fromC[Math.min(C.h - 1, y >> 1) * C.w + Math.min(C.w - 1, x >> 1)];
    if (cq >= 0) {
      const qx = (cq % C.w) * 2 + (x & 1), qy = ((cq / C.w) | 0) * 2 + (y & 1);
      if (usable(qx, qy)) q = qy * w + qx;
    }
    if (q < 0 && x > 0 && from[i - 1] >= 0 && usable(from[i - 1] % w + 1, (from[i - 1] / w) | 0)) q = from[i - 1] + 1;
    if (q < 0 && y > 0 && from[i - w] >= 0 && usable(from[i - w] % w, ((from[i - w] / w) | 0) + 1)) q = from[i - w] + w;
    if (q < 0) {
      // Last resort: the nearest pixel outside the hole along the row.
      for (let d = 1; d < w && q < 0; d++) {
        if (usable(x - d, y)) q = i - d;
        else if (usable(x + d, y)) q = i + d;
      }
    }
    if (q < 0) continue;
    from[i] = q;
    img.set(img.subarray(q * 4, q * 4 + 4), i * 4);
  }
  return from;
}

function inpaint(width, height, pixels, maskIn, grow, onProgress) {
  const hole0 = dilate(maskIn, width, height, grow);
  const img0 = new Float32Array(width * height * 4);
  for (let i = 0; i < img0.length; i++) img0[i] = pixels[i];
  const levels = [{ w: width, h: height, img: img0, hole: hole0 }];
  let S = sourceSet(levels[0]);
  if (!S.list.length) throw new Error('Not enough of the picture is left around the object to fill it from');

  // Down until the hole is COARSE_HOLE across, or the picture itself gets too small to hold
  // patches, keeping only levels that still have somewhere to copy from.
  while (levels.length < 10) {
    const L = levels[levels.length - 1];
    if (Math.min(L.w, L.h) < 4 * P || holeExtent(L) <= COARSE_HOLE) break;
    const next = downsample(L);
    const S2 = sourceSet(next);
    if (S2.list.length < 16) break;
    levels.push(next);
    S = S2;
  }

  const n = levels.length;
  const coarse = levels[n - 1];
  let from = new Int32Array(coarse.w * coarse.h).fill(-1);
  // The coarse fill is most of the work; the climb back up is quick.
  onionFill(coarse, S, from, p => onProgress(p * 0.85));
  for (let li = n - 2; li >= 0; li--) {
    from = upsampleFrom(levels[li + 1], from, levels[li]);
    onProgress(0.85 + 0.15 * (n - 1 - li) / Math.max(1, n - 1));
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i++) out[i] = img0[i];
  return { pixels: out, mask: hole0 };
}
