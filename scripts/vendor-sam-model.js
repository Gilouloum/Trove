// One-off download: pulls the quantized SlimSAM weights (a pruned Segment Anything - image
// encoder + prompt decoder, processor, config) down from the HuggingFace Hub via transformers.js's
// own Node-side from_pretrained() caching, then copies the result into assets/models/ so
// PhotoMod's Auto select loads it from local disk at runtime (env.allowRemoteModels=false - see
// worker/segment-worker.js). Same shape as vendor-clip-model.js; needs network access only when
// run, and only again if the model choice changes.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL_ID = 'Xenova/slimsam-77-uniform';
const TMP_CACHE = path.join(os.tmpdir(), 'trove-sam-vendor-cache');
const DEST = path.join(__dirname, '..', 'assets', 'models', MODEL_ID);
// See vendor-clip-model.js: Windows can briefly hold a handle on a just-written file.
const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 500 };

async function main() {
  const { env, AutoProcessor, SamModel } = require('@huggingface/transformers');

  fs.rmSync(TMP_CACHE, RM_OPTS);
  fs.mkdirSync(TMP_CACHE, { recursive: true });
  env.cacheDir = TMP_CACHE;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;

  console.log(`Downloading ${MODEL_ID} (image encoder, prompt decoder, processor)…`);
  // dtype pinned for the same reason as the CLIP script: left alone, Node would resolve the
  // fp32 weights for onnxruntime-node, not the quantized ones the app's wasm backend loads.
  await Promise.all([
    AutoProcessor.from_pretrained(MODEL_ID),
    SamModel.from_pretrained(MODEL_ID, { dtype: 'q8' }),
  ]);

  const src = path.join(TMP_CACHE, MODEL_ID);
  if (!fs.existsSync(src)) {
    console.error(`Expected downloaded files at ${src} but found nothing.`);
    process.exit(1);
  }

  fs.rmSync(DEST, RM_OPTS);
  fs.mkdirSync(DEST, { recursive: true });
  fs.cpSync(src, DEST, { recursive: true });
  try {
    fs.rmSync(TMP_CACHE, RM_OPTS);
  } catch (e) {
    console.warn(`Could not clean up temp cache at ${TMP_CACHE}: ${e.message}`);
  }
  console.log(`Vendored ${MODEL_ID} into ${DEST}`);
}

main().catch(e => { console.error(e); process.exit(1); });
