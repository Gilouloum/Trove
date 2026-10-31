// HEIC decoder for when the OS has none (see decodeHeic in main.js). Runs as an Electron
// utility process: libheif is WebAssembly and decodes synchronously, ~0.75s of solid CPU for a
// 12MP iPhone photo, which would stall every window if it ran in the main process.
// Takes { filePath, maxW, maxH }, answers { width, height, bitmap, full } (BGRA, what
// nativeImage.createFromBitmap takes; full = it took a whole-photo decode) or { error }.
// libheif applies the photo's rotation itself, so the pixels come back upright.
const fs = require('fs');
const decode = require('heic-decode');
const libheif = require('libheif-js/wasm-bundle'); // the same instance heic-decode uses

// Every iPhone HEIC carries a ~320x240 HEVC preview of itself. When that's big enough for what
// was asked (a grid thumbnail), decoding it takes ~10ms against ~750ms for the 12MP photo.
// heic-decode doesn't expose it, so this goes through libheif's C API directly.
function decodeEmbeddedThumb(buffer, maxW, maxH) {
  const M = libheif, ERR = 16;
  const scratch = M._malloc(ERR + 8), out = scratch + ERR;
  const mem = M._malloc(buffer.length);
  const ctx = M._heif_context_alloc();
  let handle = 0, thumb = 0, img = 0;
  const ok = () => M.HEAP32[scratch >> 2] === 0; // heif_error.code, returned through the hidden first argument
  try {
    M.HEAPU8.set(buffer, mem);
    M._heif_context_read_from_memory(scratch, ctx, mem, buffer.length, 0);
    if (!ok()) return null;
    M._heif_context_get_primary_image_handle(scratch, ctx, out);
    if (!ok()) return null;
    handle = M.HEAP32[out >> 2];
    if (!M._heif_image_handle_get_number_of_thumbnails(handle)) return null;
    M._heif_image_handle_get_list_of_thumbnail_IDs(handle, out, 1);
    M._heif_image_handle_get_thumbnail(scratch, handle, M.HEAP32[out >> 2], out);
    if (!ok()) return null;
    thumb = M.HEAP32[out >> 2];
    // Too small for the box asked for? Then the full photo it is.
    const W = M._heif_image_handle_get_width(handle), H = M._heif_image_handle_get_height(handle);
    const k = Math.min(1, maxW / W, maxH / H);
    if (M._heif_image_handle_get_width(thumb) + 1 < W * k || M._heif_image_handle_get_height(thumb) + 1 < H * k) return null;
    M._heif_decode_image(scratch, thumb, out, 1 /* RGB */, 11 /* interleaved RGBA */, 0);
    if (!ok()) return null;
    img = M.HEAP32[out >> 2];
    const w = M._heif_image_get_width(img, 10), h = M._heif_image_get_height(img, 10); // 10 = interleaved channel
    const plane = M._heif_image_get_plane_readonly(img, 10, out), stride = M.HEAP32[out >> 2];
    if (!plane || w <= 0 || h <= 0) return null;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) data.set(M.HEAPU8.subarray(plane + y * stride, plane + y * stride + w * 4), y * w * 4);
    return { width: w, height: h, data };
  } finally {
    if (img) M._heif_image_release(img);
    if (thumb) M._heif_image_handle_release(thumb);
    if (handle) M._heif_image_handle_release(handle);
    M._heif_context_free(ctx);
    M._free(mem);
    M._free(scratch);
  }
}

// Area-average downscale and RGBA -> BGRA in one pass. Shrinking here keeps a 320px thumb from
// shipping the full 48MB bitmap back over IPC.
function fitBgra({ width: w, height: h, data }, maxW, maxH) {
  const k = Math.min(1, maxW / w, maxH / h);
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  const out = new Uint8Array(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const y0 = Math.floor(Y * h / H), y1 = Math.max(y0 + 1, Math.floor((Y + 1) * h / H));
    for (let X = 0; X < W; X++) {
      const x0 = Math.floor(X * w / W), x1 = Math.max(x0 + 1, Math.floor((X + 1) * w / W));
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y++) {
        for (let i = (y * w + x0) * 4, end = (y * w + x1) * 4; i < end; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0), o = (Y * W + X) * 4;
      out[o] = b / n + 0.5; out[o + 1] = g / n + 0.5; out[o + 2] = r / n + 0.5; out[o + 3] = a / n + 0.5;
    }
  }
  return { width: W, height: H, bitmap: out };
}

// thumbOnly: answer with the built-in preview or nothing, never a whole-photo decode.
process.parentPort.on('message', async ({ data: { filePath, maxW, maxH, thumbOnly } }) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    await libheif.ready;
    let img = null;
    try { img = decodeEmbeddedThumb(buffer, maxW, maxH); } catch (e) {}
    const full = !img;
    if (full && thumbOnly) { process.parentPort.postMessage({ error: 'no built-in preview' }); return; }
    if (full) img = await decode({ buffer });
    process.parentPort.postMessage({ ...fitBgra(img, maxW, maxH), full });
  } catch (e) {
    process.parentPort.postMessage({ error: String(e && e.message || e) });
  }
});
