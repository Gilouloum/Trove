// Copies @vladmandic/face-api (MIT; the maintained fork of face-api.js, TensorFlow.js bundled
// in) and the three models People's face recognition uses out of node_modules into
// assets/vendor and assets/models, the same way the CLIP and SAM models are vendored - the
// packaged app never ships devDependencies, and everything has to load from local disk.
//   ssd_mobilenetv1   finds faces
//   face_landmark_68  lines each face up (eyes, nose, mouth) before it's described
//   face_recognition  turns a face into a 128-number description; two photos of the same
//                     person land close together, which is all People's grouping relies on
// Run after `npm install` (needs no network).
const fs = require('fs');
const path = require('path');

const PKG = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api');
const VENDOR = path.join(__dirname, '..', 'assets', 'vendor', 'face-api');
const MODELS = path.join(__dirname, '..', 'assets', 'models', 'face-api');
const MODEL_NAMES = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'];

if (!fs.existsSync(PKG)) {
  console.error('node_modules/@vladmandic/face-api is missing - run npm install first.');
  process.exit(1);
}
fs.rmSync(VENDOR, { recursive: true, force: true });
fs.rmSync(MODELS, { recursive: true, force: true });
fs.mkdirSync(VENDOR, { recursive: true });
fs.mkdirSync(MODELS, { recursive: true });
fs.copyFileSync(path.join(PKG, 'dist', 'face-api.esm.js'), path.join(VENDOR, 'face-api.esm.js'));
fs.copyFileSync(path.join(PKG, 'LICENSE'), path.join(VENDOR, 'LICENSE'));
for (const name of MODEL_NAMES) {
  for (const f of [`${name}-weights_manifest.json`, `${name}.bin`]) fs.copyFileSync(path.join(PKG, 'model', f), path.join(MODELS, f));
}
console.log(`Vendored face-api into ${VENDOR} and ${MODEL_NAMES.length} models into ${MODELS}`);
