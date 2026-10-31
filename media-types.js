// Every photo and video format Trove recognises, in one place. main.js (import, metadata,
// thumbnails) and renderer.js (what counts as a photo or a video, what can be edited) both read
// this file, so a format can't be importable in one and unknown to the other again.
//
// Recognising a format doesn't depend on Chromium being able to decode it: thumbnails and
// previews come from the OS (Windows' shell thumbnailer, macOS Quick Look), then from the JPEG
// preview a RAW file carries inside it, then from Chromium itself (see get-thumb in main.js
// and ensureRendererThumb in renderer.js). A video Chromium can't play still gets its
// thumbnail and an "Open in default player" button.
(function (root) {
  const RAW = [
    '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.raf', '.orf', '.rw2', '.rwl',
    '.pef', '.srw', '.x3f', '.3fr', '.fff', '.iiq', '.mos', '.mrw', '.erf', '.dcr', '.kdc', '.gpr'
  ];
  const IMAGE = [
    '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.apng', '.gif', '.bmp', '.dib', '.webp', '.avif',
    '.heic', '.heif', '.hif', '.tif', '.tiff', '.ico', '.jxl', '.jxr', '.wdp', '.hdp',
    '.insp', // Insta360 360 photo (a JPEG under its own extension)
    ...RAW
  ];
  // Left out on purpose: .lrv (GoPro/Insta360 low-res proxy of a video already imported),
  // .thm (a camera's thumbnail of one), and .ts (far more often TypeScript than MPEG-TS; camera
  // transport streams use .mts/.m2ts).
  const VIDEO = [
    '.mp4', '.m4v', '.mov', '.qt', '.avi', '.mkv', '.webm', '.3gp', '.3g2', '.wmv', '.asf',
    '.mpg', '.mpeg', '.mpe', '.m2v', '.mts', '.m2ts', '.vob', '.flv', '.f4v', '.ogv', '.dv',
    '.mxf', '.divx',
    '.insv', // Insta360 360 video
    '.360'   // GoPro MAX 360 video
  ];
  // Formats Chromium decodes by itself, so the renderer can draw them when the OS can't.
  const BROWSER_IMAGE = ['.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.apng', '.gif', '.bmp', '.dib', '.webp', '.avif', '.ico', '.insp'];
  // ISO-BMFF stills, whose Exif sits in an item box rather than a JPEG APP1 segment.
  const HEIF = ['.heic', '.heif', '.hif', '.avif'];
  // Containers parseVideoMeta can read (the MP4/QuickTime box family).
  const ISO_VIDEO = ['.mp4', '.m4v', '.mov', '.qt', '.3gp', '.3g2', '.insv', '.360'];

  const TroveMedia = {
    RAW: new Set(RAW),
    IMAGE: new Set(IMAGE),
    VIDEO: new Set(VIDEO),
    BROWSER_IMAGE: new Set(BROWSER_IMAGE),
    HEIF: new Set(HEIF),
    ISO_VIDEO: new Set(ISO_VIDEO),
  };
  TroveMedia.MEDIA = new Set([...IMAGE, ...VIDEO]);

  if (typeof module !== 'undefined' && module.exports) module.exports = TroveMedia;
  else root.TroveMedia = TroveMedia;
})(typeof self !== 'undefined' ? self : this);
