// Takes a HEIC file apart into what a hardware HEVC decoder needs to rebuild the photo:
// the codec setup (hvcC), the compressed tiles, how they sit on the grid, and the crop,
// rotation and mirroring to apply afterwards. The renderer feeds the tiles to WebCodecs (see
// heicGpu.js), which decodes them on the graphics card - the same way an iPhone or a Mac
// shows these photos, and ~10x faster than decoding them in software with libheif.
// An iPhone photo is a grid of 512x512 HEVC tiles (48 of them at 12MP); other cameras
// often write a single HEVC image instead, which is just a 1x1 grid here.
// Returns null for anything it doesn't understand, so the caller falls back to libheif.
const fs = require('fs');

function boxes(buf, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos), hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < hdr || pos + size > end) break;
    out.push({ type: buf.toString('latin1', pos + 4, pos + 8), start: pos + hdr, end: pos + size });
    pos += size;
  }
  return out;
}

function parseHeifLayout(buf) {
  const meta = boxes(buf, 0, buf.length).find(b => b.type === 'meta');
  if (!meta) return null;
  const kids = boxes(buf, meta.start + 4, meta.end); // +4: meta is a FullBox
  const child = t => kids.find(b => b.type === t);
  const pitm = child('pitm'), iinf = child('iinf'), iloc = child('iloc'), iprp = child('iprp');
  if (!pitm || !iinf || !iloc || !iprp) return null;
  const primaryId = buf[pitm.start] === 0 ? buf.readUInt16BE(pitm.start + 4) : buf.readUInt32BE(pitm.start + 4);

  // Item types (infe v2/v3 only - nothing writes the older layouts in a HEIC)
  const types = new Map();
  for (const b of boxes(buf, iinf.start + 4 + (buf[iinf.start] === 0 ? 2 : 4), iinf.end)) {
    if (b.type !== 'infe') continue;
    const v = buf[b.start];
    if (v < 2) continue;
    const id = v === 2 ? buf.readUInt16BE(b.start + 4) : buf.readUInt32BE(b.start + 4);
    const q = b.start + 4 + (v === 2 ? 2 : 4) + 2;
    types.set(id, buf.toString('latin1', q, q + 4));
  }

  // Where each item's bytes live: in the file (construction method 0) or in idat (1)
  const idat = child('idat');
  const locs = new Map();
  {
    let p = iloc.start;
    const v = buf[p]; p += 4;
    const offSize = buf[p] >> 4, lenSize = buf[p] & 15, baseSize = buf[p + 1] >> 4, idxSize = v ? buf[p + 1] & 15 : 0;
    p += 2;
    const readN = n => { const r = n === 0 ? 0 : n === 4 ? buf.readUInt32BE(p) : n === 8 ? Number(buf.readBigUInt64BE(p)) : buf.readUInt16BE(p); p += n; return r; };
    const count = v < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p); p += v < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const id = v < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p); p += v < 2 ? 2 : 4;
      let method = 0;
      if (v === 1 || v === 2) { method = buf.readUInt16BE(p) & 15; p += 2; }
      p += 2; // data_reference_index
      const base = readN(baseSize);
      const n = buf.readUInt16BE(p); p += 2;
      const extents = [];
      for (let e = 0; e < n; e++) {
        readN(idxSize);
        const offset = readN(offSize), length = readN(lenSize);
        extents.push({ offset: base + offset, length });
      }
      locs.set(id, { method, extents });
    }
  }
  const itemData = id => {
    const loc = locs.get(id);
    if (!loc || loc.method > 1 || (loc.method === 1 && !idat)) return null;
    const origin = loc.method === 1 ? idat.start : 0;
    const parts = loc.extents.map(e => buf.subarray(origin + e.offset, origin + e.offset + e.length));
    if (parts.some((part, i) => part.length !== loc.extents[i].length || !part.length)) return null;
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  };

  // Properties, in the order ipma lists them for each item
  const iprpKids = boxes(buf, iprp.start, iprp.end);
  const ipco = iprpKids.find(b => b.type === 'ipco');
  if (!ipco) return null;
  const props = boxes(buf, ipco.start, ipco.end);
  const assoc = new Map();
  for (const ipma of iprpKids.filter(b => b.type === 'ipma')) {
    const v = buf[ipma.start], wide = buf[ipma.start + 3] & 1;
    let p = ipma.start + 4;
    const count = buf.readUInt32BE(p); p += 4;
    for (let i = 0; i < count; i++) {
      const id = v < 1 ? buf.readUInt16BE(p) : buf.readUInt32BE(p); p += v < 1 ? 2 : 4;
      const n = buf[p++], list = [];
      for (let j = 0; j < n; j++) {
        const idx = wide ? buf.readUInt16BE(p) & 0x7FFF : buf[p] & 0x7F;
        p += wide ? 2 : 1;
        if (idx && props[idx - 1]) list.push(props[idx - 1]);
      }
      assoc.set(id, (assoc.get(id) || []).concat(list));
    }
  }
  const propsOf = id => assoc.get(id) || [];
  const prop = (id, type) => propsOf(id).find(b => b.type === type);

  // Which items make up the primary image
  let tileIds, cols = 1, rows = 1, width, height;
  const primaryType = types.get(primaryId);
  if (primaryType === 'grid') {
    const iref = child('iref');
    if (!iref) return null;
    const wide = buf[iref.start] !== 0;
    for (const r of boxes(buf, iref.start + 4, iref.end)) {
      if (r.type !== 'dimg') continue;
      let p = r.start;
      const from = wide ? buf.readUInt32BE(p) : buf.readUInt16BE(p); p += wide ? 4 : 2;
      if (from !== primaryId) continue;
      const n = buf.readUInt16BE(p); p += 2;
      tileIds = [];
      for (let i = 0; i < n; i++) { tileIds.push(wide ? buf.readUInt32BE(p) : buf.readUInt16BE(p)); p += wide ? 4 : 2; }
    }
    const grid = itemData(primaryId);
    if (!tileIds || !grid || grid.length < 8) return null;
    const big = grid[1] & 1;
    rows = grid[2] + 1; cols = grid[3] + 1;
    width = big ? grid.readUInt32BE(4) : grid.readUInt16BE(4);
    height = big ? grid.readUInt32BE(8) : grid.readUInt16BE(6);
    if (tileIds.length !== rows * cols) return null;
  } else if (primaryType === 'hvc1') {
    tileIds = [primaryId];
  } else {
    return null; // AVIF, JPEG-in-HEIF, overlays... rare enough to leave to libheif
  }
  if (tileIds.some(id => types.get(id) !== 'hvc1')) return null;

  const hvcC = prop(tileIds[0], 'hvcC'), ispe = prop(tileIds[0], 'ispe');
  if (!hvcC || !ispe) return null;
  const tileW = buf.readUInt32BE(ispe.start + 4), tileH = buf.readUInt32BE(ispe.start + 8);
  if (primaryType === 'hvc1') { width = tileW; height = tileH; }
  const tiles = tileIds.map(itemData);
  if (tiles.some(t => !t)) return null;

  // Crop, rotation and mirroring, in the order they're listed (that's the order they apply in)
  const ops = [];
  for (const b of propsOf(primaryId)) {
    if (b.type === 'irot') ops.push({ type: 'irot', angle: buf[b.start] & 3 });
    else if (b.type === 'imir') ops.push({ type: 'imir', axis: buf[b.start] & 1 });
    else if (b.type === 'clap') {
      const r = i => buf.readInt32BE(b.start + i * 4);
      ops.push({ type: 'clap', width: r(0) / r(1), height: r(2) / r(3), dx: r(4) / r(5), dy: r(6) / r(7) });
    }
  }

  // nclx colour description; an ICC profile ('prof') is left to what the bitstream says
  let color = null;
  const colr = [prop(primaryId, 'colr'), prop(tileIds[0], 'colr')].find(b => b && buf.toString('latin1', b.start, b.start + 4) === 'nclx');
  if (colr) color = { primaries: buf.readUInt16BE(colr.start + 4), transfer: buf.readUInt16BE(colr.start + 6), matrix: buf.readUInt16BE(colr.start + 8), fullRange: !!(buf[colr.start + 10] & 0x80) };

  return { codec: hevcCodecString(buf.subarray(hvcC.start, hvcC.end)), description: buf.subarray(hvcC.start, hvcC.end), tiles, cols, rows, tileW, tileH, width, height, ops, color };
}

// RFC 6381 codec string from an HEVCDecoderConfigurationRecord, e.g. "hvc1.1.6.L93.B0"
function hevcCodecString(c) {
  const space = c[1] >> 6, tier = (c[1] >> 5) & 1, idc = c[1] & 31;
  let compat = c.readUInt32BE(2), reversed = 0;
  for (let i = 0; i < 32; i++) { reversed = (reversed << 1) | (compat & 1); compat >>>= 1; }
  const constraints = [...c.subarray(6, 12)];
  while (constraints.length && !constraints[constraints.length - 1]) constraints.pop();
  return ['hvc1', ['', 'A', 'B', 'C'][space] + idc, (reversed >>> 0).toString(16), (tier ? 'H' : 'L') + c[12],
    ...constraints.map(b => b.toString(16).toUpperCase())].join('.');
}

async function readHeifLayout(filePath) {
  try { return parseHeifLayout(await fs.promises.readFile(filePath)); }
  catch (e) { return null; }
}

module.exports = { readHeifLayout };
