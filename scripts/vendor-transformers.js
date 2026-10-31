// One-off copy: pulls transformers.js's browser bundle and the one WASM binary/glue pair
// it actually resolves to in a non-Safari (i.e. Electron/Chromium) environment out of
// node_modules and into assets/vendor/transformers, so both load from local disk at
// runtime with no CDN fetch (see the "!ONNX_ENV.wasm.wasmPaths" jsdelivr default inside
// transformers.js's dist bundle - worker/semantic-worker.js overrides it before any model
// loads). Re-run after bumping the @huggingface/transformers devDependency version.
const fs = require('fs');
const path = require('path');

const TRANSFORMERS_SRC = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'dist');
const ORT_SRC = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const DEST = path.join(__dirname, '..', 'assets', 'vendor', 'transformers');

// The non-minified browser bundle (transformers.js, not transformers.min.js) - easier to
// debug during development; worth switching to the minified build once the feature is stable.
const TRANSFORMERS_FILE = 'transformers.js';
// Chromium (Electron's engine) takes the "asyncify" wasm variant by default - see
// transformers.js dist's own `apis.IS_SAFARI ? {..threaded..} : {..asyncify..}` branch.
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

if (!fs.existsSync(TRANSFORMERS_SRC)) {
  console.error('transformers.js build output not found at ' + TRANSFORMERS_SRC + ' - run npm install first.');
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

fs.copyFileSync(path.join(TRANSFORMERS_SRC, TRANSFORMERS_FILE), path.join(DEST, TRANSFORMERS_FILE));
for (const f of ORT_FILES) {
  fs.copyFileSync(path.join(ORT_SRC, f), path.join(DEST, f));
}

console.log('Vendored transformers.js + onnxruntime-web wasm into ' + DEST);
