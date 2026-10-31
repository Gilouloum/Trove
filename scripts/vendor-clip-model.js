// One-off download: pulls the quantized CLIP ViT-B/32 weights (vision + text towers,
// tokenizer, processors, configs) down from the HuggingFace Hub via transformers.js's own
// Node-side from_pretrained() caching, then copies the result into assets/models/ so the
// app loads it from local disk at runtime (env.allowRemoteModels=false - see
// worker/semantic-worker.js) instead of fetching it on first run. Needs network access
// only when run; re-run only if the model choice changes (see the plan doc).
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const TMP_CACHE = path.join(os.tmpdir(), 'filelinker-clip-vendor-cache');
const DEST = path.join(__dirname, '..', 'assets', 'models', MODEL_ID);
// Windows can still hold a brief handle on a just-downloaded/just-copied file (AV scan, async
// close not yet settled) even after the JS-level operation that wrote it has resolved -
// rmSync's recursive delete then hits ENOTEMPTY/EBUSY on that one file. maxRetries/retryDelay
// are Node's built-in fix for exactly this race; harmless (no-op) on macOS/Linux, where the
// first attempt always succeeds.
const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 500 };

async function main() {
  const { env, AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection } =
    require('@huggingface/transformers');

  fs.rmSync(TMP_CACHE, RM_OPTS);
  fs.mkdirSync(TMP_CACHE, { recursive: true });
  env.cacheDir = TMP_CACHE;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;

  console.log(`Downloading ${MODEL_ID} (text + vision towers, tokenizer, processor)…`);
  // dtype: 'q8' forces the quantized (~small/fast) weights. Left to its own default this
  // resolves against Node's onnxruntime-node/cpu execution provider (fp32, ~600MB combined)
  // rather than the wasm-device default this app actually runs under - so it must be pinned
  // explicitly at download time, not just left to "whatever the wasm backend would pick".
  await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoProcessor.from_pretrained(MODEL_ID),
    CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8' }),
    CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8' }),
  ]);

  const src = path.join(TMP_CACHE, MODEL_ID);
  if (!fs.existsSync(src)) {
    console.error(`Expected downloaded files at ${src} but found nothing.`);
    process.exit(1);
  }

  fs.rmSync(DEST, RM_OPTS);
  fs.mkdirSync(DEST, { recursive: true });
  fs.cpSync(src, DEST, { recursive: true });
  // Best-effort: the vendored output at DEST is already complete at this point, so a lingering
  // AV/handle lock on the OS tmpdir (see RM_OPTS comment above) shouldn't fail the whole build -
  // the runner/OS will reclaim tmpdir on its own regardless.
  try {
    fs.rmSync(TMP_CACHE, RM_OPTS);
  } catch (e) {
    console.warn(`Could not clean up temp cache at ${TMP_CACHE}: ${e.message}`);
  }

  console.log(`Vendored ${MODEL_ID} into ${DEST}`);
}

main().catch(e => { console.error(e); process.exit(1); });
