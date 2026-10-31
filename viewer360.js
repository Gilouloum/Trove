// ── 360° viewer + frame grabbing ────────────────────────────────────────────
// Loaded after renderer.js and leans on its globals (appData, toast, esc, pathToFileUrl, the
// popup cluster state...). Two features live here because they share one job - turning a
// video frame into pixels you can keep:
//
//  1. A 360 viewer for Insta360 .insv/.insp (and any 360 JPEG Trove made itself). Everything is
//     one fragment shader: each screen pixel becomes a view ray, and the ray is looked up in
//     whatever the source is - an equirectangular panorama, two fisheye circles side by side
//     (how Insta360 stores both lenses in one file), or one fisheye per file (the _00_/_10_
//     pairs higher-resolution modes write). No stitching data is read from the file, so the
//     lens FOV / rotation / swap settings are there to line the seam up by eye. Videos that
//     carry the camera's gyro get an angle lock (level horizon, no shake) - see read-360-motion.
//
//  2. Frame grabbing, from both the normal video popup and the 360 viewer. The frame is saved
//     at the video's full resolution next to the source, with the video's camera, GPS and the
//     exact moment of the frame (recording start + playhead) written into real EXIF.

const V360_ICON_PATHS = {
  play:      '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause:     '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  volume:    '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute:      '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  lock:      '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock:    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  zoomIn:    '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut:   '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  reset:     '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  camera:    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  settings:  '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  expand:    '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  prev:      '<path d="m15 18-6-6 6-6"/>',
  next:      '<path d="m9 18 6-6-6-6"/>',
  close:     '<path d="M18 6 6 18M6 6l12 12"/>'
};
function v360Icon(name) {
  return `<svg class="pe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${V360_ICON_PATHS[name] || ''}</svg>`;
}

const V360_EXTS = new Set(['.insv', '.insp']);
function is360File(f) { return !!f && (V360_EXTS.has((f.ext || '').toLowerCase()) || f.is360 === true); }

// ── Shader ──────────────────────────────────────────────────────────────────
const V360_VS = `attribute vec2 aPos; varying vec2 vPos; void main(){ vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const V360_FS = `
precision highp float;
varying vec2 vPos;
uniform sampler2D uTex, uTex2;
uniform float uYaw, uPitch, uFov, uAspect, uLensFov, uLensRot, uSwap;
uniform mat3 uStab;  // angle lock: level, steady view -> the lens's actual frame (identity when off)
uniform int uMode;   // 0 perspective, 2 flat equirect (only for full-360 grabs, letterboxed to the canvas)
uniform int uProj;   // 0 equirect, 1 dual fisheye side by side, 2 single fisheye, 3 two files (one lens each)
const float PI = 3.14159265359;

vec3 rayDir(out bool outside) {
  outside = false;
  vec3 d;
  if (uMode == 2) {
    vec2 p = vPos;
    if (uAspect > 2.0) p.x *= uAspect / 2.0; else p.y *= 2.0 / uAspect;
    if (abs(p.x) > 1.0 || abs(p.y) > 1.0) { outside = true; return vec3(0.0, 0.0, 1.0); }
    float lon = p.x * PI, lat = p.y * PI * 0.5;
    d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  } else {
    float t = tan(uFov * 0.5);
    d = normalize(vec3(vPos.x * t * uAspect, vPos.y * t, 1.0));
    float cp = cos(uPitch), sp = sin(uPitch);
    d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  }
  float cy = cos(uYaw), sy = sin(uYaw);
  return uStab * vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
}

// d is in the lens's own frame (optical axis +z). Returns uv inside that lens's circle.
vec2 fishUv(vec3 d) {
  float theta = acos(clamp(d.z, -1.0, 1.0));
  float r = theta / (uLensFov * 0.5);
  float phi = atan(d.y, d.x) + uLensRot;
  return 0.5 + 0.5 * r * vec2(cos(phi), -sin(phi));
}

void main() {
  bool outside;
  vec3 d = rayDir(outside);
  if (outside) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uProj == 0) {
    float lon = atan(d.x, d.z), lat = asin(clamp(d.y, -1.0, 1.0));
    gl_FragColor = texture2D(uTex, vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI));
    return;
  }
  vec2 uf = fishUv(d);
  vec2 ub = fishUv(vec3(-d.x, d.y, -d.z)); // the back lens looks along -z, so its right is -x
  // The lenses see a little past 180 each; blend across exactly that overlap band.
  float band = max(sin(uLensFov * 0.5 - PI * 0.5), 0.002);
  float w = smoothstep(-band, band, d.z);
  vec4 cf, cb;
  if (uProj == 1) {
    // Front lens on the right half, the layout ffmpeg's dfisheye (and the usual Insta360 recipes) use.
    float fo = uSwap > 0.5 ? 0.0 : 0.5, bo = 0.5 - fo;
    cf = texture2D(uTex, vec2(fo + clamp(uf.x, 0.0, 1.0) * 0.5, uf.y));
    cb = texture2D(uTex, vec2(bo + clamp(ub.x, 0.0, 1.0) * 0.5, ub.y));
  } else if (uProj == 3) {
    cf = texture2D(uTex, uf);
    cb = texture2D(uTex2, ub);
  } else {
    cf = texture2D(uTex, uf);
    cb = vec4(0.0, 0.0, 0.0, 1.0);
  }
  gl_FragColor = mix(cb, cf, w);
}`;

// ── State ───────────────────────────────────────────────────────────────────
const V360_DEFAULTS = { fov: 1.6 };
const V360_IDENTITY = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const v360 = {
  open: false, file: null, isVideo: false,
  media: null, media2: null,           // <video>/<img>; media2 only for split-lens pairs
  gl: null, prog: null, u: null, tex: null, tex2: null,
  yaw: 0, pitch: 0, fov: V360_DEFAULTS.fov,
  motion: null,                        // { frames, mats } from the camera's gyro - see read-360-motion in main.js
  proj: 'auto', detected: 'equirect',
  dragging: false, lastX: 0, lastY: 0, velYaw: 0, velPitch: 0,
  dirty: true, raf: 0, newFrame: false, hideTimer: 0, loadToken: 0
};
// Lens settings are per-camera rather than per-file, so they're remembered between sessions.
const v360Lens = (() => {
  const def = { lensFov: 200, lensRot: 0, swap: false, proj: 'auto' };
  try { return { ...def, ...JSON.parse(localStorage.getItem('trove.v360Lens') || '{}') }; } catch (e) { return def; }
})();
// Angle lock is on by default and remembered, like the lens settings.
let v360Lock = (() => { try { return localStorage.getItem('trove.v360Lock') !== '0'; } catch (e) { return true; } })();
function v360ToggleLock() {
  v360Lock = !v360Lock;
  try { localStorage.setItem('trove.v360Lock', v360Lock ? '1' : '0'); } catch (e) {}
  v360.dirty = true;
  v360RenderControls();
}
function v360SaveLens() { try { localStorage.setItem('trove.v360Lens', JSON.stringify(v360Lens)); } catch (e) {} }

// ── Open / close ────────────────────────────────────────────────────────────
async function open360Viewer(file) {
  const root = document.getElementById('v360');
  if (!root) return;
  if (!v360.open) {
    v360.open = true;
    root.classList.add('open');
    v360EnsureGl();
    v360Loop();
  }
  v360.file = file;
  v360.isVideo = isVid(file.ext);
  v360.yaw = 0; v360.pitch = 0; v360.velYaw = 0; v360.velPitch = 0;
  v360.fov = V360_DEFAULTS.fov;
  v360.motion = null;
  v360Teardown();
  const token = ++v360.loadToken;

  document.getElementById('v360Error').style.display = 'none';
  document.getElementById('v360Loading').style.display = '';
  root.classList.toggle('is-photo', !v360.isVideo);
  v360RenderControls();
  v360Poke();

  try {
    if (v360.isVideo) {
      v360.media = v360MakeVideo(pathToFileUrl(file.path));
      // Higher-res Insta360 modes write one file per lens: VID_..._00_001.insv (front) and
      // VID_..._10_001.insv (back). Opening either one pulls in its partner.
      const pair = v360PairPath(file.path);
      if (pair && (await window.api.checkFilesExist([pair]))[0]) {
        v360.media2 = v360MakeVideo(pathToFileUrl(pair));
        if (/_10_\d+\.insv$/i.test(file.path)) [v360.media, v360.media2] = [v360.media2, v360.media];
        v360.media2.muted = true; // one soundtrack is plenty; the front lens file carries it
      }
      await v360WaitReady(v360.media);
      if (v360.media2) await v360WaitReady(v360.media2);
    } else {
      v360.media = await v360LoadImage(pathToFileUrl(file.path));
    }
  } catch (e) {
    if (token !== v360.loadToken) return;
    v360ShowError(v360.isVideo
      ? 'This video could not be decoded. Insta360 records in H.265 (HEVC) - on Windows, installing the "HEVC Video Extensions" from the Microsoft Store usually fixes it.'
      : 'This photo could not be opened.');
    return;
  }
  if (token !== v360.loadToken) return;
  v360.detected = v360DetectProjection(v360.media, !!v360.media2);
  document.getElementById('v360Loading').style.display = 'none';
  v360.newFrame = true;
  v360.dirty = true;
  v360RenderControls();
  if (v360.isVideo) {
    v360.media.play().catch(() => {});
    // Motion data lives in the front-lens (_00_) file of a split pair. Loaded after playback
    // starts - it reads a few MB off the end of the file - and the lock kicks in when it lands.
    const motionPath = /_10_\d+\.insv$/i.test(file.path) ? v360PairPath(file.path) : file.path;
    window.api.read360Motion(motionPath).then(m => {
      if (token !== v360.loadToken || !m || !m.frames) return;
      v360.motion = m;
      v360.dirty = true;
      v360RenderControls();
    }).catch(() => {});
  }
}

// The preview owns the Prev/Next list and the file on show; this only stops the player.
function close360Viewer() {
  if (!v360.open) return;
  v360.open = false;
  v360.loadToken++;
  v360Teardown();
  cancelAnimationFrame(v360.raf);
  document.getElementById('v360').classList.remove('open');
  document.getElementById('v360Settings').classList.remove('open');
  document.getElementById('v360GrabMenu').classList.remove('open');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function v360Teardown() {
  for (const m of [v360.media, v360.media2]) {
    if (m && m.tagName === 'VIDEO') { m.pause(); m.removeAttribute('src'); m.load(); }
  }
  v360.media = null; v360.media2 = null;
}

function v360Prev() { if (popupClusterFiles.length > 1) popupPrev(); }
function v360Next() { if (popupClusterFiles.length > 1) popupNext(); }

function v360PairPath(p) {
  if (/_00_\d+\.insv$/i.test(p)) return p.replace(/_00_(\d+\.insv)$/i, '_10_$1');
  if (/_10_\d+\.insv$/i.test(p)) return p.replace(/_10_(\d+\.insv)$/i, '_00_$1');
  return null;
}

function v360MakeVideo(src) {
  const v = document.createElement('video');
  v.src = src; v.preload = 'auto'; v.playsInline = true;
  v.addEventListener('timeupdate', v360OnTime);
  v.addEventListener('play', v360RenderControls);
  v.addEventListener('pause', () => { v360RenderControls(); v360Poke(); });
  v.addEventListener('ended', v360RenderControls);
  // mediaTime is the exact frame on screen, which the angle lock needs to line up with the gyro.
  const onFrame = (now, meta) => { v360.newFrame = true; v._frameTime = meta?.mediaTime; if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame); };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
  return v;
}
function v360WaitReady(v) {
  return new Promise((res, rej) => {
    if (v.readyState >= 2 && v.videoWidth) return res();
    v.addEventListener('loadeddata', () => v.videoWidth ? res() : rej(new Error('no video track')), { once: true });
    v.addEventListener('error', () => rej(v.error || new Error('decode')), { once: true });
  });
}
function v360LoadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
function v360ShowError(msg) {
  document.getElementById('v360Loading').style.display = 'none';
  const box = document.getElementById('v360Error');
  box.innerHTML = `<div>${esc(msg)}</div><button class="v360-pill" onclick="openPopupFile()">Open in default player</button>`;
  box.style.display = 'flex';
}

// Two lenses side by side and a flat equirectangular frame are both 2:1, so shape alone can't
// tell them apart. Fisheye frames have black corners outside the lens circles (and a black
// notch where the two circles meet); a panorama has picture everywhere.
function v360DetectProjection(media, hasPair) {
  if (hasPair) return 'pair';
  const w = media.videoWidth || media.naturalWidth, h = media.videoHeight || media.naturalHeight;
  if (!w || !h) return 'equirect';
  const ratio = w / h;
  if (Math.abs(ratio - 1) < 0.1) return 'single';
  if (Math.abs(ratio - 2) > 0.15) return 'equirect';
  try {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(media, 0, 0, 128, 64);
    const dark = (x, y) => { const p = ctx.getImageData(x, y, 1, 1).data; return p[0] + p[1] + p[2] < 45; };
    const probes = [[1, 1], [126, 1], [1, 62], [126, 62], [64, 1], [64, 62], [63, 1], [63, 62]];
    return probes.filter(([x, y]) => dark(x, y)).length >= 6 ? 'dual' : 'equirect';
  } catch (e) { return 'equirect'; }
}
function v360Proj() { return v360Lens.proj !== 'auto' ? v360Lens.proj : v360.detected; }

// ── WebGL ───────────────────────────────────────────────────────────────────
function v360EnsureGl() {
  if (v360.gl && !v360.gl.isContextLost()) return true;
  const canvas = document.getElementById('v360Canvas');
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
  if (!gl) { v360ShowError('WebGL is not available, so the 360 view cannot be drawn.'); return false; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, V360_VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, V360_FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  ['uTex', 'uTex2', 'uYaw', 'uPitch', 'uFov', 'uAspect', 'uLensFov', 'uLensRot', 'uSwap', 'uStab', 'uMode', 'uProj']
    .forEach(n => { u[n] = gl.getUniformLocation(prog, n); });
  const mkTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  Object.assign(v360, { gl, prog, u, tex: mkTex(), tex2: mkTex() });
  gl.uniform1i(u.uTex, 0);
  gl.uniform1i(u.uTex2, 1);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); v360.gl = null; });
  return true;
}

function v360Upload() {
  const { gl } = v360;
  const up = (tex, unit, m) => {
    if (!m) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, m); } catch (e) {}
  };
  up(v360.tex, 0, v360.media);
  up(v360.tex2, 1, v360.media2);
}

// Draws one frame into whatever size the canvas currently is. `view` overrides the live camera
// (used for grabs, which render the same scene at a different size or projection).
function v360Draw(view = {}) {
  const { gl, u } = v360;
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  gl.viewport(0, 0, w, h);
  const mode = view.mode || 'normal';
  const projIdx = { equirect: 0, dual: 1, single: 2, pair: 3 }[v360Proj()] ?? 0;
  gl.uniform1f(u.uYaw, view.yaw ?? v360.yaw);
  gl.uniform1f(u.uPitch, view.pitch ?? v360.pitch);
  gl.uniform1f(u.uFov, view.fov ?? v360.fov);
  gl.uniform1f(u.uAspect, w / h);
  gl.uniform1f(u.uLensFov, v360Lens.lensFov * Math.PI / 180);
  gl.uniform1f(u.uLensRot, v360Lens.lensRot * Math.PI / 180);
  gl.uniform1f(u.uSwap, v360Lens.swap ? 1 : 0);
  gl.uniformMatrix3fv(u.uStab, false, v360StabMatrix());
  gl.uniform1i(u.uMode, mode === 'flat' ? 2 : 0);
  gl.uniform1i(u.uProj, projIdx);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// The motion data has one entry per video frame, in order, so the frame on screen is found by
// its position in the video - which also holds for timelapses, where recording time and
// playback time differ.
function v360StabMatrix() {
  const mo = v360.motion, m = v360.media;
  if (!v360Lock || !mo || !m || !m.duration) return V360_IDENTITY;
  const t = Number.isFinite(m._frameTime) && !m.seeking ? m._frameTime : m.currentTime;
  const i = Math.max(0, Math.min(mo.frames - 1, Math.round(t / m.duration * mo.frames)));
  return mo.mats.subarray(i * 9, i * 9 + 9);
}

function v360Loop() {
  if (!v360.open) return;
  v360.raf = requestAnimationFrame(v360Loop);
  if (!v360.gl && !v360EnsureGl()) return;
  const canvas = v360.gl.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; v360.dirty = true; }
  // Coasting after a flick, like every other 360 player.
  if (!v360.dragging && (Math.abs(v360.velYaw) > 1e-4 || Math.abs(v360.velPitch) > 1e-4)) {
    v360.yaw += v360.velYaw; v360.pitch = v360ClampPitch(v360.pitch + v360.velPitch);
    v360.velYaw *= 0.92; v360.velPitch *= 0.92;
    v360.dirty = true;
  }
  const keyTurn = v360KeyTurn();
  if (keyTurn) v360.dirty = true;
  if (!v360.media) {
    v360.gl.clearColor(0, 0, 0, 1); v360.gl.clear(v360.gl.COLOR_BUFFER_BIT);
    return;
  }
  // No requestVideoFrameCallback -> just re-upload while playing.
  if (v360.isVideo && !v360.media.requestVideoFrameCallback && !v360.media.paused) v360.newFrame = true;
  if (v360.newFrame) { v360Upload(); v360.newFrame = false; v360.dirty = true; }
  if (v360.dirty) { v360Draw(); v360.dirty = false; }
  if (v360.media2 && !v360.media.paused) v360SyncPair();
}

// The back-lens video just follows the front one; nudge it back if it drifts.
function v360SyncPair() {
  const a = v360.media, b = v360.media2;
  if (Math.abs(a.currentTime - b.currentTime) > 0.08) b.currentTime = a.currentTime;
  if (b.paused) b.play().catch(() => {});
}

function v360ClampPitch(p) { return Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p)); }
function v360Zoom(factor) {
  v360.fov = Math.max(0.35, Math.min(2.2, v360.fov * factor));
  v360.dirty = true;
}
function v360ResetView() {
  v360.yaw = 0; v360.pitch = 0; v360.velYaw = 0; v360.velPitch = 0;
  v360.fov = V360_DEFAULTS.fov;
  v360.dirty = true;
}

// ── Input ───────────────────────────────────────────────────────────────────
function setup360Viewer() {
  const canvas = document.getElementById('v360Canvas');
  if (!canvas || canvas.dataset.ready) return;
  canvas.dataset.ready = '1';
  const fill = (id, icon, text = '') => { const el = document.getElementById(id); if (el) el.innerHTML = v360Icon(icon) + (text ? `<span>${text}</span>` : ''); };
  fill('v360ZoomOut', 'zoomOut'); fill('v360ZoomIn', 'zoomIn'); fill('v360ResetBtn', 'reset');
  fill('v360SettingsBtn', 'settings'); fill('v360GrabBtn', 'camera', 'Grab'); fill('v360FsBtn', 'expand');
  document.getElementById('v360').addEventListener('click', v360ClosePops);
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    v360.dragging = true; v360.lastX = e.clientX; v360.lastY = e.clientY;
    v360.velYaw = 0; v360.velPitch = 0;
    document.getElementById('v360').classList.add('dragging');
    v360ClosePops();
  });
  canvas.addEventListener('pointermove', e => {
    v360Poke();
    if (!v360.dragging) return;
    const dx = e.clientX - v360.lastX, dy = e.clientY - v360.lastY;
    v360.lastX = e.clientX; v360.lastY = e.clientY;
    // Scale by the current zoom so the picture stays under the cursor at any FOV.
    const k = v360.fov / canvas.clientHeight;
    const dYaw = -dx * k, dPitch = dy * k;
    v360.yaw += dYaw; v360.pitch = v360ClampPitch(v360.pitch + dPitch);
    v360.velYaw = dYaw; v360.velPitch = dPitch;
    v360.dirty = true;
  });
  const end = () => { v360.dragging = false; document.getElementById('v360').classList.remove('dragging'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); v360Zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('dblclick', v360ResetView);
  document.getElementById('v360').addEventListener('pointermove', v360Poke);
  document.getElementById('v360Seek').addEventListener('input', e => {
    const m = v360.media;
    if (!m || !m.duration) return;
    m.currentTime = (e.target.value / 1000) * m.duration;
    if (v360.media2) v360.media2.currentTime = m.currentTime;
  });
  document.getElementById('v360Volume').addEventListener('input', e => {
    if (!v360.media) return;
    v360.media.volume = +e.target.value;
    v360.media.muted = +e.target.value === 0;
    v360RenderControls();
  });
  document.addEventListener('keyup', e => { v360Keys.delete(e.key); });
  window.addEventListener('blur', () => v360Keys.clear());
}

const v360Keys = new Set();
function v360KeyTurn() {
  if (!v360Keys.size) return false;
  const step = 0.025 * v360.fov / 1.6;
  let moved = false;
  if (v360Keys.has('ArrowLeft')) { v360.yaw -= step; moved = true; }
  if (v360Keys.has('ArrowRight')) { v360.yaw += step; moved = true; }
  if (v360Keys.has('ArrowUp')) { v360.pitch = v360ClampPitch(v360.pitch + step); moved = true; }
  if (v360Keys.has('ArrowDown')) { v360.pitch = v360ClampPitch(v360.pitch - step); moved = true; }
  return moved;
}

// Called first by the global keydown handler while the viewer is showing (and no dialog is on
// top of the preview); it owns every key then - the arrows look around rather than step files.
function v360HandleKey(e) {
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
  const k = e.key;
  v360Poke();
  if (k === 'Escape') {
    e.preventDefault();
    if (document.querySelector('.v360-pop.open')) v360ClosePops();
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else closePhotoPopup();
  } else if (k.startsWith('Arrow')) { e.preventDefault(); v360Keys.add(k); }
  else if (k === ' ' || k === 'k') { e.preventDefault(); v360TogglePlay(); }
  else if (k === '+' || k === '=') { e.preventDefault(); v360Zoom(0.85); }
  else if (k === '-' || k === '_') { e.preventDefault(); v360Zoom(1 / 0.85); }
  else if (k === 'r' || k === '0') v360ResetView();
  else if (k === 'L') v360ToggleLock();
  else if (k === 'f') v360ToggleFullscreen();
  else if (k === 'm') v360ToggleMute();
  else if (k === 'g') { e.preventDefault(); v360GrabView(); }
  else if (k === 'G') { e.preventDefault(); v360GrabSphere(); }
  else if (k === 'PageUp' || k === ',') { e.preventDefault(); v360Prev(); }
  else if (k === 'PageDown' || k === '.') { e.preventDefault(); v360Next(); }
  else if (k === 'j') v360SeekBy(-5);
  else if (k === 'l') v360SeekBy(5);
}

function v360SeekBy(sec) {
  const m = v360.media;
  if (!m || !v360.isVideo || !m.duration) return;
  m.currentTime = Math.max(0, Math.min(m.duration, m.currentTime + sec));
  if (v360.media2) v360.media2.currentTime = m.currentTime;
}
function v360TogglePlay() {
  const m = v360.media;
  if (!m || !v360.isVideo) return;
  if (m.paused || m.ended) { m.play().catch(() => {}); } else { m.pause(); v360.media2?.pause(); }
}
function v360ToggleMute() {
  const m = v360.media;
  if (!m || !v360.isVideo) return;
  m.muted = !m.muted;
  if (!m.muted && m.volume === 0) m.volume = 1;
  v360RenderControls();
}
function v360ToggleFullscreen() {
  const root = document.getElementById('v360');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else root.requestFullscreen?.().catch(() => {});
}

// Controls fade out while a video plays and nothing moves, and come back on any mouse move.
function v360Poke() {
  const root = document.getElementById('v360');
  if (!root) return;
  root.classList.remove('idle');
  clearTimeout(v360.hideTimer);
  v360.hideTimer = setTimeout(() => {
    if (v360.open && v360.isVideo && v360.media && !v360.media.paused && !document.querySelector('.v360-pop.open')) root.classList.add('idle');
  }, 2500);
}

function v360FmtTime(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function v360OnTime() {
  const m = v360.media;
  if (!m || !v360.isVideo) return;
  document.getElementById('v360Cur').textContent = v360FmtTime(m.currentTime);
  document.getElementById('v360Dur').textContent = v360FmtTime(m.duration);
  const seek = document.getElementById('v360Seek');
  if (document.activeElement !== seek && m.duration) seek.value = Math.round(m.currentTime / m.duration * 1000);
}

// ── Controls ────────────────────────────────────────────────────────────────
function v360RenderControls() {
  const m = v360.media;
  const playing = m && v360.isVideo && !m.paused && !m.ended;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('v360PlayBtn', v360Icon(playing ? 'pause' : 'play'));
  set('v360MuteBtn', v360Icon(m && (m.muted || m.volume === 0) ? 'mute' : 'volume'));
  const vol = document.getElementById('v360Volume');
  if (vol && m && v360.isVideo) vol.value = m.muted ? 0 : m.volume;
  const lockBtn = document.getElementById('v360LockBtn');
  if (lockBtn) {
    lockBtn.style.display = v360.motion ? '' : 'none'; // only videos that carry gyro data
    lockBtn.classList.toggle('active', v360Lock);
    lockBtn.innerHTML = v360Icon(v360Lock ? 'lock' : 'unlock') + '<span>Angle lock</span>';
  }
  document.getElementById('v360Hint').textContent = 'Drag to look around · Scroll to zoom · Double-click to reset';
  v360RenderSettings();
  v360OnTime();
}

function v360RenderSettings() {
  const box = document.getElementById('v360Settings');
  if (!box) return;
  const proj = v360Proj();
  const fisheye = proj !== 'equirect';
  const label = { equirect: 'Equirectangular', dual: 'Dual fisheye', single: 'Single fisheye', pair: 'Two lens files' };
  box.innerHTML = `
    <div class="v360-pop-title">Lens & projection</div>
    <label class="v360-row">Projection
      <select onchange="v360SetLens('proj', this.value)">
        <option value="auto"${v360Lens.proj === 'auto' ? ' selected' : ''}>Auto (${label[v360.detected] || 'unknown'})</option>
        ${['equirect', 'dual', 'single', 'pair'].map(p => `<option value="${p}"${v360Lens.proj === p ? ' selected' : ''}${p === 'pair' && !v360.media2 ? ' disabled' : ''}>${label[p]}</option>`).join('')}
      </select>
    </label>
    <div class="${fisheye ? '' : 'v360-disabled'}">
      <label class="v360-row">Lens field of view <span>${v360Lens.lensFov}°</span></label>
      <input type="range" min="180" max="230" step="0.5" value="${v360Lens.lensFov}" oninput="v360SetLens('lensFov', +this.value)"/>
      <label class="v360-row">Lens rotation <span>${v360Lens.lensRot}°</span></label>
      <input type="range" min="-180" max="180" step="1" value="${v360Lens.lensRot}" oninput="v360SetLens('lensRot', +this.value)"/>
      <label class="v360-check"><input type="checkbox" ${v360Lens.swap ? 'checked' : ''} onchange="v360SetLens('swap', this.checked)"/> Swap front and back lens</label>
    </div>
    <div class="v360-pop-note">Adjust these if the seam between the two lenses looks doubled or the horizon is tilted. Saved for next time.</div>
    <button class="v360-pill" onclick="v360SetLens('reset')">Reset lens settings</button>`;
}
function v360SetLens(key, val) {
  if (key === 'reset') Object.assign(v360Lens, { lensFov: 200, lensRot: 0, swap: false, proj: 'auto' });
  else v360Lens[key] = val;
  v360SaveLens();
  v360.dirty = true;
  // Sliders re-render only their own readouts, so the thumb isn't swapped out mid-drag.
  if (key === 'lensFov' || key === 'lensRot') {
    const spans = document.querySelectorAll('#v360Settings .v360-row span');
    if (spans[0]) spans[0].textContent = v360Lens.lensFov + '°';
    if (spans[1]) spans[1].textContent = v360Lens.lensRot + '°';
  } else v360RenderSettings();
}

function v360TogglePop(id, e) {
  e?.stopPropagation();
  const pop = document.getElementById(id);
  const willOpen = !pop.classList.contains('open');
  v360ClosePops();
  if (willOpen) { if (id === 'v360Settings') v360RenderSettings(); pop.classList.add('open'); }
}
function v360ClosePops() { document.querySelectorAll('.v360-pop.open').forEach(p => p.classList.remove('open')); }

// ── Frame grabbing ──────────────────────────────────────────────────────────
function v360ExifDate(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function v360TimeSuffix(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s${String(ms).padStart(3, '0')}`;
}

// Shared tail of every grab: encode, write (with EXIF) next to the video, add to the library
// carrying the video's camera/place/folders, dated to the frame's own moment.
async function grabFrameToLibrary(video, canvas, timeSec, opts = {}) {
  if (!video) return null;
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
  if (!blob) { toast('⚠️ Could not encode the frame'); return null; }
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  const hasStart = Number.isFinite(video.fileDate);
  const frameMs = hasStart ? video.fileDate + Math.round((timeSec || 0) * 1000) : null;
  const meta = {
    suffix: `${opts.kind || 'frame'}-${v360TimeSuffix(timeSec || 0)}`,
    dateTime: frameMs ? v360ExifDate(frameMs) : null,
    subSec: frameMs ? String(frameMs % 1000).padStart(3, '0') : null,
    make: video.cameraMake || null,
    model: video.cameraModel || null,
    gps: video.gps || null,
    pano: !!opts.pano, width: canvas.width, height: canvas.height
  };
  const res = await window.api.saveVideoFrame(base64, video.path, meta).catch(() => null);
  if (!res?.success) { toast('⚠️ Could not save the frame next to the video'); return null; }
  const added = await window.api.processDroppedPaths([res.path]).catch(() => []);
  const entry = added && added[0];
  if (!entry) { toast('⚠️ Saved the frame, but could not add it to the library'); return null; }
  syncEditedMetadataFromOriginal(video, entry);
  if (frameMs) entry.fileDate = frameMs;
  entry.folders = [...(video.folders || [])];
  entry.grabbedFromId = video.id;
  entry.grabbedAt = timeSec || 0;
  entry.tags = [...new Set([...(entry.tags || []), ...(video.tags || []).filter(t => t !== 'Timelapse'), 'Frame grab'])];
  if (opts.pano) { entry.is360 = true; entry.tags.push('360'); }
  appData.files.push(entry);
  if (typeof queueForIndexing === 'function') queueForIndexing([entry]);
  await saveData();
  renderFiles();
  toast(`📸 Saved ${entry.name} · ${canvas.width}×${canvas.height}${frameMs ? ' · dated ' + fmtDate(frameMs) + ' ' + fmtTime(frameMs) : ''}`, 5000);
  return entry;
}

let grabBusy = false;
// Regular video popup: the untouched decoded frame at the video's own resolution, turned the
// same way the popup shows it (file.rotation is a CSS-only rotate there).
async function grabPopupVideoFrame() {
  if (grabBusy) return;
  const vid = document.getElementById('photoPopupVideo');
  const file = appData.files.find(f => f.id === popupFileId);
  if (!vid || !file || !isVid(file.ext) || !vid.videoWidth) { toast('⚠️ The video has not loaded a frame yet'); return; }
  grabBusy = true;
  try {
    vid.pause();
    const rot = (((file.rotation || 0) % 360) + 360) % 360;
    const w = vid.videoWidth, h = vid.videoHeight, swap = rot === 90 || rot === 270;
    const c = document.createElement('canvas');
    c.width = swap ? h : w; c.height = swap ? w : h;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(vid, -w / 2, -h / 2, w, h);
    const btn = document.getElementById('popupGrabBtn');
    btn?.classList.add('flash'); setTimeout(() => btn?.classList.remove('flash'), 400);
    await grabFrameToLibrary(file, c, vid.currentTime);
  } finally { grabBusy = false; }
}

// Renders the scene at a given size and mode, and reads it back into a 2D canvas.
function v360RenderOffscreen(width, height, view) {
  const gl = v360.gl, canvas = gl.canvas;
  const maxDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS), maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  const cap = Math.min(maxDims[0], maxDims[1], maxRb, 16384);
  const s = Math.min(1, cap / Math.max(width, height));
  canvas.width = Math.round(width * s); canvas.height = Math.round(height * s);
  v360Upload();
  v360Draw(view);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) imgData.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row); // GL rows are bottom-up
  ctx.putImageData(imgData, 0, 0);
  v360.dirty = true; // the loop resizes the canvas back and redraws on its next tick
  return out;
}

function v360SourceSize() {
  const m = v360.media;
  return { w: m.videoWidth || m.naturalWidth, h: m.videoHeight || m.naturalHeight };
}

// Full 360 photo: the whole sphere as a 2:1 equirectangular JPEG with Photo Sphere metadata,
// centred on where you're looking. Sized so no source detail is thrown away.
async function v360GrabSphere() {
  v360ClosePops();
  if (grabBusy || !v360.media || !v360.gl) return;
  grabBusy = true;
  try {
    const wasPlaying = v360.isVideo && !v360.media.paused;
    if (wasPlaying) { v360.media.pause(); v360.media2?.pause(); }
    const { w, h } = v360SourceSize();
    const proj = v360Proj();
    let outW = proj === 'single' || proj === 'pair' ? h * 2 : w;
    outW = Math.round(outW / 2) * 2;
    const out = v360RenderOffscreen(outW, outW / 2, { mode: 'flat', yaw: v360.yaw });
    v360Flash();
    await v360SaveGrab(out, { kind: '360', pano: true });
  } finally { grabBusy = false; }
}

// What's on screen right now, as an ordinary flat photo - rendered at the source's own angular
// resolution rather than the window's, so zooming in gives you a genuinely sharp crop.
async function v360GrabView() {
  v360ClosePops();
  if (grabBusy || !v360.media || !v360.gl) return;
  grabBusy = true;
  try {
    if (v360.isVideo && !v360.media.paused) { v360.media.pause(); v360.media2?.pause(); }
    const canvas = v360.gl.canvas;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const { w, h } = v360SourceSize();
    const proj = v360Proj();
    const pxPerRad = proj === 'equirect' ? w / (2 * Math.PI)
      : (proj === 'dual' ? h : Math.min(w, h)) / (v360Lens.lensFov * Math.PI / 180);
    let outH = Math.round(pxPerRad * v360.fov);
    outH = Math.max(canvas.height, Math.min(outH, 8192));
    let outW = Math.round(outH * aspect);
    if (outW > 8192) { outH = Math.round(outH * 8192 / outW); outW = 8192; }
    const out = v360RenderOffscreen(outW, outH, {});
    v360Flash();
    await v360SaveGrab(out, { kind: 'view' });
  } finally { grabBusy = false; }
}

async function v360SaveGrab(canvas, opts) {
  const file = v360.file;
  if (!file) return;
  // A .insp photo goes through the same path with t = 0, so it keeps the photo's own date.
  await grabFrameToLibrary(file, canvas, v360.isVideo ? v360.media.currentTime : 0, opts);
}

function v360Flash() {
  const f = document.getElementById('v360Flash');
  if (!f) return;
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

document.addEventListener('DOMContentLoaded', setup360Viewer);
if (document.readyState !== 'loading') setup360Viewer();
