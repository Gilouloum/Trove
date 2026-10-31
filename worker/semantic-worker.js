// Runs the CLIP text/vision towers entirely off the UI thread, browser-first (this is
// transformers.js's own recommended non-blocking pattern) - main.js's Node process never
// touches ML at all, it only stores/searches the resulting vectors (see main.js's
// save-embedding/search-semantic handlers). Everything loads from local disk
// (env.allowRemoteModels=false below) - see scripts/vendor-transformers.js and
// scripts/vendor-clip-model.js for how assets/vendor/transformers and assets/models got here.
//
// Message protocol (see semanticIndex.js, the renderer-side owner of this worker):
//   in:  {type:'init'}
//        {type:'embed-image', id, dataUrl}
//        {type:'embed-text', reqId, text}
//   out: {type:'ready'} | {type:'error', context, message}
//        {type:'embed-image-result', id, vector: Float32Array}
//        {type:'embed-text-result', reqId, vector: Float32Array}

import {
  env, AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage,
} from '../assets/vendor/transformers/transformers.js';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DTYPE = 'q8'; // matches the quantized weights actually vendored (see vendor-clip-model.js)

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../assets/models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('../assets/vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('../assets/vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};

// The threaded WASM build above only actually runs multi-threaded when SharedArrayBuffer is
// available (requires cross-origin isolation) - otherwise onnxruntime-web silently falls back
// to single-threaded execution, which is several times slower with no visible error anywhere.
// This is the only signal that a fallback happened, so it's worth surfacing even though it's
// not actionable from in here.
if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) {
  console.warn('[semantic-worker] SharedArrayBuffer/crossOriginIsolated unavailable - threaded WASM will silently fall back to single-threaded, indexing will be noticeably slower');
}

let tokenizer, processor, textModel, visionModel;
let readyPromise = null;

function loadModels() {
  if (!readyPromise) {
    readyPromise = Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoProcessor.from_pretrained(MODEL_ID),
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: DTYPE }),
      CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: DTYPE }),
    ]).then(([t, p, tm, vm]) => {
      tokenizer = t; processor = p; textModel = tm; visionModel = vm;
      postMessage({ type: 'ready' });
    });
  }
  return readyPromise;
}

// CLIP's raw projection output isn't unit-length - normalizing here means main.js's
// cosine-similarity search (which also normalizes defensively) is comparing like-for-like,
// and a plain dot product would already be a valid similarity score on these vectors.
function normalize(data) {
  const vec = new Float32Array(data);
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      await loadModels();
      return;
    }
    await loadModels(); // lazily ensure ready even if the caller skipped an explicit init
    if (msg.type === 'embed-text') {
      const inputs = tokenizer([msg.text], { padding: true, truncation: true });
      const { text_embeds } = await textModel(inputs);
      const vector = normalize(text_embeds.data);
      postMessage({ type: 'embed-text-result', reqId: msg.reqId, vector }, [vector.buffer]);
    } else if (msg.type === 'embed-image') {
      const image = await RawImage.read(msg.dataUrl);
      const inputs = await processor(image);
      const { image_embeds } = await visionModel(inputs);
      const vector = normalize(image_embeds.data);
      postMessage({ type: 'embed-image-result', id: msg.id, vector }, [vector.buffer]);
    }
  } catch (err) {
    postMessage({
      type: 'error',
      context: msg?.type,
      id: msg?.id, reqId: msg?.reqId,
      message: err?.message || String(err),
    });
  }
};
