// HEIC photos decoded on the graphics card, through WebCodecs - what an iPhone or a Mac does,
// and what makes the viewer and the editor open a 12MP HEIC in ~0.1s instead of the ~0.75s
// libheif needs in software. Main splits the file into its HEVC tiles (heif-layout.js); each
// tile is decoded as one video keyframe and drawn into place on a canvas, then the photo's
// own crop, rotation and mirroring are applied.
// Chromium has no software HEVC decoder, so a PC whose GPU can't do HEVC gets null here, and
// so does any file laid out unusually: callers then fall back to main (OS codec, then libheif).
(function (root) {
  const NCLX = {
    primaries: { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020', 12: 'smpte432' },
    transfer: { 1: 'bt709', 6: 'smpte170m', 8: 'linear', 13: 'iec61966-2-1', 16: 'pq', 18: 'hlg' },
    matrix: { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' },
  };
  const TIMEOUT_MS = 15000;
  const supportCache = new Map(); // codec string -> Promise<config|null>
  let chain = Promise.resolve(); // one decode at a time: hardware decoders have few frames to spare

  function configFor(layout) {
    const config = { codec: layout.codec, description: layout.description, codedWidth: layout.tileW, codedHeight: layout.tileH, optimizeForLatency: true };
    const c = layout.color;
    if (c) {
      const colorSpace = { primaries: NCLX.primaries[c.primaries], transfer: NCLX.transfer[c.transfer], matrix: NCLX.matrix[c.matrix], fullRange: c.fullRange };
      if (colorSpace.primaries && colorSpace.transfer && colorSpace.matrix) config.colorSpace = colorSpace;
    }
    return config;
  }

  function supported(config) {
    const key = config.codec + JSON.stringify(config.colorSpace || null);
    if (!supportCache.has(key)) {
      supportCache.set(key, (async () => {
        if (typeof VideoDecoder === 'undefined') return false;
        try { return (await VideoDecoder.isConfigSupported(config)).supported; } catch (e) { return false; }
      })());
    }
    return supportCache.get(key);
  }

  // All tiles onto one canvas, already scaled by k so a preview never holds the full 12MP.
  function decodeGrid(layout, config, k) {
    const W = Math.max(1, Math.round(layout.width * k)), H = Math.max(1, Math.round(layout.height * k));
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const edgeX = c => Math.round(c * layout.tileW * k), edgeY = r => Math.round(r * layout.tileH * k);
    return new Promise((resolve, reject) => {
      let drawn = 0, failed = false;
      const timer = setTimeout(() => fail(new Error('HEVC decode timed out')), TIMEOUT_MS);
      const decoder = new VideoDecoder({
        output: frame => {
          const i = frame.timestamp, c = i % layout.cols, r = Math.floor(i / layout.cols);
          ctx.drawImage(frame, edgeX(c), edgeY(r), edgeX(c + 1) - edgeX(c), edgeY(r + 1) - edgeY(r));
          frame.close();
          drawn++;
        },
        error: e => fail(e),
      });
      function fail(e) {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        try { decoder.close(); } catch (_) {}
        reject(e);
      }
      try {
        decoder.configure(config);
        layout.tiles.forEach((data, i) => decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: i, data })));
      } catch (e) { fail(e); return; }
      decoder.flush().then(() => {
        if (failed) return;
        clearTimeout(timer);
        decoder.close();
        if (drawn !== layout.tiles.length) reject(new Error(`decoded ${drawn} of ${layout.tiles.length} tiles`));
        else resolve(canvas);
      }, fail);
    });
  }

  // clap / irot / imir, each one producing a new canvas, in the order the file lists them.
  function applyOp(src, op, k) {
    const w = src.width, h = src.height;
    if (op.type === 'clap') {
      const cw = Math.max(1, Math.round(op.width * k)), ch = Math.max(1, Math.round(op.height * k));
      const x = Math.round((w - cw) / 2 + op.dx * k), y = Math.round((h - ch) / 2 + op.dy * k);
      const out = new OffscreenCanvas(cw, ch);
      out.getContext('2d').drawImage(src, x, y, cw, ch, 0, 0, cw, ch);
      return out;
    }
    if (op.type === 'irot' && op.angle) {
      const swap = op.angle % 2 === 1;
      const out = new OffscreenCanvas(swap ? h : w, swap ? w : h);
      const ctx = out.getContext('2d');
      ctx.translate(out.width / 2, out.height / 2);
      ctx.rotate(-op.angle * Math.PI / 2); // irot turns anti-clockwise
      ctx.drawImage(src, -w / 2, -h / 2);
      return out;
    }
    if (op.type === 'imir') {
      const out = new OffscreenCanvas(w, h);
      const ctx = out.getContext('2d');
      if (op.axis === 0) { ctx.translate(w, 0); ctx.scale(-1, 1); } // about a vertical axis: left-right
      else { ctx.translate(0, h); ctx.scale(1, -1); }
      ctx.drawImage(src, 0, 0);
      return out;
    }
    return src;
  }

  // Size the photo ends up at once cropped and turned, to scale the grid down to maxDim.
  function finalSize(layout) {
    let w = layout.width, h = layout.height;
    for (const op of layout.ops) {
      if (op.type === 'clap') { w = op.width; h = op.height; }
      else if (op.type === 'irot' && op.angle % 2) [w, h] = [h, w];
    }
    return { w, h };
  }

  async function decodeToCanvas(filePath, maxDim) {
    const layout = await root.api.getHeicLayout(filePath).catch(() => null);
    if (!layout) return null;
    const config = configFor(layout);
    if (!(await supported(config))) {
      if (!config.colorSpace) return null;
      delete config.colorSpace; // an nclx Chromium can't express: let the bitstream's own say
      if (!(await supported(config))) return null;
    }
    const { w, h } = finalSize(layout);
    const k = Math.min(1, maxDim / Math.max(w, h));
    let canvas = await decodeGrid(layout, config, k);
    for (const op of layout.ops) canvas = applyOp(canvas, op, k);
    return canvas;
  }

  // -> { blob (JPEG), width, height } or null
  function decode(filePath, maxDim, quality = 0.88) {
    const job = chain.then(async () => {
      const canvas = await decodeToCanvas(filePath, maxDim);
      if (!canvas) return null;
      return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality }), width: canvas.width, height: canvas.height };
    }).catch(e => { console.warn('HEIC GPU decode failed, falling back:', filePath, e && e.message); return null; });
    chain = job;
    return job;
  }

  root.HeicGpu = { decode };
})(typeof self !== 'undefined' ? self : this);
