// PhotoMod's Auto select: runs SlimSAM (a pruned Segment Anything) off the UI thread. The
// expensive half - encoding the picture - happens once per version of the document; every click
// after that only runs the small prompt decoder, which is what makes adding and removing parts
// feel immediate. Everything loads from local disk, same as worker/semantic-worker.js - see
// scripts/vendor-sam-model.js for how assets/models/Xenova/slimsam-77-uniform got there.
//
// Message protocol (see pmSeg* in renderer.js):
//   in:  {type:'embed', id, width, height, pixels: Uint8ClampedArray RGBA}
//        {type:'decode', id, points: [{x, y, label}], pick}   x/y in 0..1 of the embedded image, label 1 = include, 0 = exclude;
//                                                            pick 'best' (default) or 'part'
//   out: {type:'embedded', id}
//        {type:'mask', id, width, height, mask: Uint8Array (1 = selected), score}
//        {type:'error', id, message}

import { env, AutoProcessor, SamModel, RawImage, Tensor } from '../assets/vendor/transformers/transformers.js';

const MODEL_ID = 'Xenova/slimsam-77-uniform';
const DTYPE = 'q8'; // matches the quantized weights actually vendored

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../assets/models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('../assets/vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('../assets/vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};

let model = null, processor = null, loading = null;
let imageInputs = null, imageEmbeddings = null;

function load() {
  if (!loading) {
    loading = Promise.all([
      SamModel.from_pretrained(MODEL_ID, { dtype: DTYPE }),
      AutoProcessor.from_pretrained(MODEL_ID),
    ]).then(([m, p]) => { model = m; processor = p; });
  }
  return loading;
}

async function embed({ id, width, height, pixels }) {
  await load();
  imageInputs = imageEmbeddings = null;
  const image = new RawImage(pixels, width, height, 4).rgb();
  const inputs = await processor(image);
  imageEmbeddings = await model.get_image_embeddings(inputs);
  imageInputs = inputs;
  postMessage({ type: 'embedded', id });
}

async function decode({ id, points, pick }) {
  if (!imageEmbeddings) throw new Error('No picture has been analysed yet');
  // The processor resized the picture before encoding it, so the points go in that space.
  const [rh, rw] = imageInputs.reshaped_input_sizes[0];
  const input_points = new Tensor('float32', points.flatMap(p => [p.x * rw, p.y * rh]), [1, 1, points.length, 2]);
  const input_labels = new Tensor('int64', points.map(p => BigInt(p.label)), [1, 1, points.length]);
  const outputs = await model({ ...imageEmbeddings, input_points, input_labels });
  const masks = await processor.post_process_masks(outputs.pred_masks, imageInputs.original_sizes, imageInputs.reshaped_input_sizes);
  // SAM proposes three nested masks (part, object, whole) with a confidence for each. Normally
  // take the one it is surest of; 'part' takes the smallest one it is nearly as sure of, which is
  // what "take this bit away" means.
  const scores = outputs.iou_scores.data;
  const [, , h, w] = masks[0].dims;
  const all = masks[0].data;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  if (pick === 'part') {
    let smallest = Infinity;
    for (let m = 0; m < scores.length; m++) {
      if (scores[m] < scores[best] - 0.1) continue;
      let area = 0;
      for (let i = m * w * h, end = i + w * h; i < end; i++) area += all[i] ? 1 : 0;
      if (area && area < smallest) { smallest = area; best = m; }
    }
  }
  const mask = new Uint8Array(w * h);
  const off = best * w * h;
  for (let i = 0; i < mask.length; i++) mask[i] = all[off + i] ? 1 : 0;
  postMessage({ type: 'mask', id, width: w, height: h, mask, score: scores[best] }, [mask.buffer]);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'embed') await embed(data);
    else if (data.type === 'decode') await decode(data);
  } catch (err) {
    postMessage({ type: 'error', id: data.id, message: String((err && err.message) || err) });
  }
};
