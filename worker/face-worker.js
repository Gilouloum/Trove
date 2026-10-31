// People's face recognition: finds the faces in a photo and describes each one as 128 numbers,
// off the UI thread. Two photos of the same person give descriptions that sit close together,
// which is all faceIndex.js needs to group them - nothing here knows who anyone is, and
// nothing leaves this computer: the models load from assets/models/face-api (see
// scripts/vendor-face-api.js).
//
// Message protocol (see faceIndex.js):
//   in:  {type:'detect', id, width, height, pixels: Uint8ClampedArray RGBA}
//   out: {type:'faces', id, faces:[{box:[x,y,w,h] in 0..1, score, desc: Float32Array(128), lm: [x0,y0,...x67,y67] in thousandths of the box}]}
//        {type:'error', id, message}

import * as faceapi from '../assets/vendor/face-api/face-api.esm.js';

// face-api decides it's in a browser by looking for window and document, neither of which a
// worker has, and then refuses to start. Everything it needs has a worker equivalent, so it's
// told about them directly. Inputs here are always tensors, so the Image/Video slots are
// never actually used.
class NoElement { constructor() { throw new Error('not available in a worker'); } }
faceapi.env.setEnv({
  Canvas: OffscreenCanvas,
  CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
  Image: ImageBitmap,
  ImageData,
  Video: NoElement,
  createCanvasElement: () => new OffscreenCanvas(1, 1),
  createImageElement: () => new NoElement(),
  createVideoElement: () => new NoElement(),
  fetch: self.fetch.bind(self),
  readFile: () => { throw new Error('no filesystem in a worker'); },
});

const MODEL_URL = new URL('../assets/models/face-api/', import.meta.url).href;
const MIN_CONFIDENCE = 0.6;
// Faces smaller than this (in pixels of the picture analysed) are too blurry to recognise
// reliably, and a wrong match is worse than no match.
const MIN_FACE_PX = 36;

let loading = null;
function load() {
  if (!loading) {
    loading = (async () => {
      try { await faceapi.tf.setBackend('webgl'); } catch (e) { await faceapi.tf.setBackend('cpu'); }
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
    })();
  }
  return loading;
}

async function detect({ id, width, height, pixels }) {
  await load();
  const input = faceapi.tf.tidy(() => faceapi.tf.browser.fromPixels(new ImageData(pixels, width, height)));
  let results;
  try {
    results = await faceapi
      .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }))
      .withFaceLandmarks()
      .withFaceDescriptors();
  } finally {
    input.dispose();
  }
  const faces = results
    .filter(r => r.detection.box.width >= MIN_FACE_PX && r.detection.box.height >= MIN_FACE_PX)
    .map(r => {
      const b = r.detection.box;
      // The 68 landmarks (jaw, brows, nose, eyes, mouth), relative to the face's box in
      // thousandths - what faceIndex.js reads to pick a person's best picture (smile, pose, eyes).
      const lm = r.landmarks.positions.flatMap(p => [Math.round((p.x - b.x) / b.width * 1000), Math.round((p.y - b.y) / b.height * 1000)]);
      return { box: [b.x / width, b.y / height, b.width / width, b.height / height], score: r.detection.score, desc: r.descriptor, lm };
    });
  postMessage({ type: 'faces', id, faces }, faces.map(f => f.desc.buffer));
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'detect') await detect(data);
    else if (data.type === 'info') { await load(); postMessage({ type: 'info', id: data.id, backend: faceapi.tf.getBackend() }); }
  } catch (err) {
    postMessage({ type: 'error', id: data.id, message: String((err && err.message) || err) });
  }
};
