// ── STATE ────────────────────────────────────────────────────────────────────
// Temporary master switch: Mapbox road-snapped routing is fully implemented (see
// canUseMapbox()/resolveLegRoute() below and the Settings modal in index.html) but turned
// off for now. Flip this back to true to re-enable it. The "⚙️ Settings" sidebar button
// stays regardless of this flag now, since Settings also holds the delete toggle and the
// telemetry toggle (see sendTelemetryPing() below). Everything else (straight-line routes, the
// globe, pins, photo organizing) is unaffected either way.
const MAPBOX_ENABLED = false;
// Temporary master switch: leg-based routes and transport-mode detection (drive/walk/
// flight/ferry/train, see buildTripLegs/classifyLegMode above) are fully implemented but
// not clean enough to ship yet. Without Mapbox the fallback route is just a straight line
// between photo points, and the heuristic mode classifier misfires often enough not to be
// trustworthy on its own. Turned off for now: Relive Trip shows no route lines, leg chips,
// or mode badges, just the day cards, photo panel, and camera framing. Flip back to true
// once reworked (renderDayLegChips/renderDayLegRoutes/renderReliveDayCards below).
const LEG_ROUTES_ENABLED = false;
let appData = { folders: [], files: [] };
const sessionStartMs = Date.now(); // for the 'session_end' telemetry ping's duration - see sendTelemetryPing()
// True whenever this window has OS focus. Trove is meant to run alongside a video/photo editor
// all day, so the moment focus moves to another app, onAppFocusChange() (below) throttles the
// heaviest background work - the semantic search worker's idle indexing loop (semanticIndex.js)
// and the Globe's decorative ambient-render ticker (globe.js) - so that editor gets full use of
// the CPU/GPU. Nothing interactive (an active search, the editor, Guided Sort) is affected;
// only opportunistic background work pauses, and it resumes the instant focus returns.
let appFocused = true;
let currentFolder = 'timeline'; // 'timeline' = Photo Library, the app's main/default page
let currentView = 'grid';
let sortDir = 'desc'; // default: File Date, newest first
let modalFileId = null;
let assigningMultiple = false;
let thumbCache = {};
let globeOpen = false;
let globeCtrl = null;
let locateModeFileIds = null; // non-null while the globe is in "Set Location" pick mode
let locatePending = null; // {lat,lng} of the last-clicked point, awaiting confirmation
let popupFileId = null;
let ctxFileId = null;
let folderCtxId = null;
let editFileId = null;
let editFileIds = [];
let selectedIds = new Set();
let lastSelectedIds = new Set(); // what updateSelectionUI() last painted - see its delta logic below
let editingFolderId = null;
let forcedNewFolderParent = null;
// Set when the New Folder modal was opened from inside the Assign-to-Folders modal (rather
// than the sidebar) - lets createFolder() hand control back to buildAssignBody() and
// pre-check the just-created folder, instead of just closing out to the folder tree.
let newFolderReturnToAssign = false;
// Set while the New Folder modal is open for "+ Add Section" rather than a plain folder - tells
// createFolder() to mark the new top-level folder isSection:true so it gets its own sidebar
// section (see buildCustomSectionDef) instead of landing in the generic 📁 Folders catch-all.
let creatingSection = false;
// Data URL of the custom image icon picked in the New Folder modal, or null to use the emoji
// field instead - see refreshNfmIconImageUI()/handleNfmIconImageSelect() and folderIconHtml().
let nfmIconImage = null;
let showAllFilesHere = false; // "Show all files ↓" toggle in non-leaf folders
let bestOfFilters = { type: 'all', tripId: '', cameraFolder: '', year: '', sort: 'newest' };
let chipFilters = { photos: false, videos: false, bestOf: false, pinned: false, edited: false, year: '', camera: '', location: '', orientation: '', resolution: '', tags: [] };
let openCountryRegions = new Set(); // countries expanded in the By Location sidebar
let searchTimer = null;
let saveTimer = null;
let coverPickerFolderId = null;
let missingFilesList = []; // live refs into appData.files currently shown in the Missing Files modal
let backupConfirmFile = null; // filename awaiting a second "are you sure" click in the Backups modal
let versionModalFileId = null; // file whose version tree #versionModal is currently showing
let peOpen = false;
// The same editor engine wears two shapes. 'simple' is what "Edit Photo" opens: Colors,
// Direction, Brush and Masks, and nothing else - no tool rail, no layer stack, no selections.
// 'pro' is PhotoMod: every tool, and - unlike simple mode - it never writes anything on its own.
// See the .pe-simple/.pe-pro CSS block in index.html for the layout half of this.
let peMode = 'simple'; // 'simple' | 'pro'
const peIsPro = () => peMode === 'pro';
let peFileId = null;
let peDirty = false; // true once any slider has moved since opening - gates the final saveData() on close
let peRotationAtOpen = 0; // file.rotation when the editor opened: its 90° turns set it live, so Discard puts it back
let peGl = null, peProgram = null, peTexture = null, peUniforms = null;
let peAdjustments = null; // live-edited copy; only written into appData.files on commit
let peBypass = false; // true while "hold to compare" is held down
let peSaveTimer = null;
let peSourceCanvas = null; // the decoded, EXIF-corrected full-res image - kept around for histogram sampling
let peToneLUTTex = null; // 256x1 texture built from peCurves, sampled by the shader's tone-curve step
let peCurves = null; // { master:[{x,y},...], r:[...], g:[...], b:[...] } - control points per channel, x/y in 0..255
let peActiveCurveChannel = 'master'; // 'master' | 'r' | 'g' | 'b'
let peHsl = null; // { red:{h,s,l}, orange:{...}, ... } - one of PE_HSL_BANDS per key
let peHistogram = null; // 256-bucket luminance histogram of the original decoded image
let peChannelHistograms = null; // { r:[256], g:[256], b:[256] } - built lazily the first time a channel tab is opened
let peCurveDrag = null; // index of the control point being dragged in peCurves[peActiveCurveChannel], or null
let peActiveTab = 'colors'; // 'colors' (Light+Curve+HSL merged) | 'rotate' | 'draw' | 'masks'
let peColorSections = { light: true, curve: true, hsl: true }; // collapsible groups inside the Colors tab
// Photoshop-style layer stack composited ABOVE the photo. The photo itself stays the
// non-destructive base (adjustments/curves/HSL/masks are still a recipe in file.edits, replayed
// from the untouched original), so nothing here ever rasterizes or overwrites it - see the
// "Layer stack" block in the PHOTO EDITOR section.
let peLayers = null; // [{id,name,visible,opacity,x,y,scale,dataUrl,_bitmap}] - null = not loaded this session
let peActiveLayerId = null;
let peTool = 'move'; // 'move' (layers) | 'brush' (peDrawTool picks pencil/eraser) | 'mask'
let peLayersCanvas = null, peLayersCtx = null;
let peLayerDrag = null; // {id, startX, startY, originX, originY} while dragging a layer with the Move tool
let peActiveHslBand = 'red';
let peStraighten = 0; // fine-angle correction in degrees, -45..45, on top of file.rotation's 90° steps
let peRawCanvas = null; // this photo's freshly-decoded, EXIF-corrected canvas *before* file.rotation is applied - cached so the 90° Rotate buttons can re-derive without re-reading the file from disk
// PhotoMod is a document editor, not a recipe editor: Canvas Size, Image Size and Rotate all
// change the document's own pixels rather than a field on the library file. peBaseOverride is
// that document base - once set, peApplyRotationAndInit uses it instead of re-deriving the
// source from peRawCanvas + file.rotation, so the library entry is never touched. Simple mode
// leaves it null and keeps the original non-destructive behaviour.
let peBaseOverride = null;
let pmDocName = null; // a file-less document's display name ("Untitled"), null when editing a library photo
// Draw tool: a plain 2D overlay layer painted independently of the WebGL adjustment
// pipeline (composited on top only when saving a thumbnail/export), so strokes stay
// crisp and unaffected by Light/Tone/Color changes made before or after them.
let peDrawCanvas = null, peDrawCtx = null; // the #peDrawCanvas element + its 2D context, fetched once and reused per photo
let peDrawColor = '#ff2d55';
let peDrawSize = 24; // brush diameter in on-screen CSS px - converted to canvas-space per stroke so it feels consistent regardless of image resolution/zoom
let peDrawTool = 'pencil'; // 'pencil' | 'eraser'
let peDrawing = false;
let peDrawLastPoint = null;
let peDrawUndoStack = []; // small stack of PNG data URLs snapshotted just before each stroke/clear
let peDrawHasContent = false; // whether the layer has (or might have) anything painted on it - gates persisting/compositing it
// Local (masked) adjustments: independent brush-painted regions, each with its own copy of
// the Light-tab sliders, composited via extra GL passes on top of the global adjustments -
// see peRender() and PE_MASK_FRAGMENT_SRC below. null (as opposed to []) means "not yet
// loaded for this file", distinguishing a fresh session from one where every layer was deleted.
let peLocalLayers = null; // [{id,name,visible,maskType,maskDataUrl,invert,amount,adjustments,_maskCanvas}]
let peEditingLayerId = null; // id of the layer currently loaded into #peMaskCanvas for painting, or null
let peMaskCanvas = null, peMaskCtx = null; // the #peMaskCanvas element + its 2D context, reused per photo (shared across layers - see peSelectMaskLayer)
let peMaskCanvasHasContent = false; // whether the *currently edited* layer's canvas has any paint on it
let peMaskDrawing = false, peMaskLastPoint = null;
let peMaskUndoStack = []; // scoped to whichever layer is currently being edited, reset on layer switch
let peMaskTool = 'add'; // 'add' | 'subtract'
let peMaskSize = 60; // brush diameter in on-screen CSS px, same convention as peDrawSize
let peMaskFeather = 30; // 0..100, drives a canvas blur() filter for soft brush edges
let peMaskShowOverlay = true; // whether the painted mask is tinted visible on top of the photo while editing
let peFbo = null; // { tex:[a,b], fb:[a,b], width, height } - offscreen ping-pong render targets used only when >=1 local layer is visible
let peMaskProgram = null, peMaskUniforms = null; // the local-adjustment pass shader (PE_MASK_FRAGMENT_SRC)
let peMaskGlTex = null; // single reusable ALPHA texture, re-uploaded from whichever layer's mask canvas is being composited this pass

const COLORS = ['#3d6f8f','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#06b6d4','#f97316'];
let selectedColor = COLORS[0];

const CAMERA_BRANDS = {
  'gopro': { name: 'GoPro', icon: '🎥' },
  'insta360': { name: 'Insta360', icon: '🔮' },
  'dji': { name: 'DJI', icon: '🚁' },
  'iphone': { name: 'iPhone', icon: '📱' },
  'apple': { name: 'iPhone', icon: '📱' },
  'samsung': { name: 'Samsung', icon: '📱' },
  'canon': { name: 'Canon', icon: '📷' },
  'nikon': { name: 'Nikon', icon: '📷' },
  'sony': { name: 'Sony', icon: '📷' },
  'fujifilm': { name: 'Fujifilm', icon: '📷' },
  'panasonic': { name: 'Panasonic', icon: '📷' },
};

// The format lists live in media-types.js, shared with main.js.
const IMG_EXTS = TroveMedia.IMAGE;
const VID_EXTS = TroveMedia.VIDEO;
const isImg = e => IMG_EXTS.has(e?.toLowerCase());
const isVid = e => VID_EXTS.has(e?.toLowerCase());
const isMedia = e => isImg(e) || isVid(e);
// Every still except 360 photos (an equirectangular sphere, not a flat picture) and icons.
// Formats Chromium can't decode arrive through the OS or a RAW's embedded preview instead - see
// get-editable-image in main.js.
const EDITABLE_EXTS = new Set([...TroveMedia.IMAGE].filter(e => e !== '.insp' && e !== '.ico'));
const isEditable = e => EDITABLE_EXTS.has(e?.toLowerCase());
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getEmoji(ext) {
  if (isImg(ext)) return '🖼️';
  if (isVid(ext)) return '🎬';
  const m={'.pdf':'📄','.doc':'📝','.docx':'📝','.txt':'📃','.xls':'📊','.xlsx':'📊','.csv':'📊',
    '.ppt':'📽️','.pptx':'📽️','.mp3':'🎵','.wav':'🎵','.flac':'🎵',
    '.zip':'📦','.rar':'📦','.7z':'📦','.js':'⚡','.ts':'⚡','.py':'🐍',
    '.html':'🌐','.json':'🗂️','.app':'📱','.exe':'⚙️','.dmg':'💿','.psd':'🎨','.fig':'🎨'};
  return m[ext?.toLowerCase()] || '📄';
}

function fmtSize(b) {
  if (!b) return '-';
  if (b<1024) return b+' B';
  if (b<1048576) return (b/1024).toFixed(1)+' KB';
  if (b<1073741824) return (b/1048576).toFixed(1)+' MB';
  if (b<1099511627776) return (b/1073741824).toFixed(2)+' GB';
  return (b/1099511627776).toFixed(2)+' TB';
}
function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return 'Unknown length';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'});
}
function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── I18N ─────────────────────────────────────────────────────────────────────
// Covers the First-Run Wizard and the Settings modal only - the rest of the app's UI stays
// English for now (see I18N below for the full string list). `native` names are shown as-is in
// the language picker itself, never translated. appData.settings.language is '' until the user
// picks one (in the wizard's language step, or Settings), meaning "follow the OS locale".
const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'fr', native: 'Français' },
  { code: 'de', native: 'Deutsch' },
  { code: 'es', native: 'Español' },
  { code: 'zh', native: '中文' }
];
let currentLang = 'en';
function detectDefaultLanguage() {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some(l => l.code === nav) ? nav : 'en';
}
function resolveLanguage(stored) {
  return stored && LANGUAGES.some(l => l.code === stored) ? stored : detectDefaultLanguage();
}
// entry[lang] may be a plain string or a (vars) => string function (used wherever pluralization
// or interpolation is needed) - falls back to English, then to the raw key, if a translation is missing.
function t(key, vars) {
  const entry = I18N[key];
  if (!entry) return key;
  const raw = entry[currentLang] ?? entry.en;
  return typeof raw === 'function' ? raw(vars || {}) : raw;
}
function setLanguage(lang) {
  currentLang = LANGUAGES.some(l => l.code === lang) ? lang : 'en';
  if (!appData.settings) appData.settings = {};
  appData.settings.language = currentLang;
  applyI18n();
  if (typeof frOpen !== 'undefined' && frOpen) frRender();
  saveData();
}
// Static (non-wizard-body) DOM text - the Settings modal and the wizard's own topbar - driven by
// data-i18n[-html/-placeholder/-title] attributes in index.html. The wizard's per-step body
// (#frBody/#frBar) is entirely JS-generated instead, so those call t() directly at render time.
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
}
const I18N = {
  // Language picker step
  langStepTitle: { en: 'Choose your language', fr: 'Choisissez votre langue', de: 'Wählen Sie Ihre Sprache', es: 'Elige tu idioma', zh: '选择语言' },
  langStepBody: { en: 'You can change this anytime in Settings.', fr: 'Vous pourrez la modifier à tout moment dans les Paramètres.', de: 'Sie können dies jederzeit in den Einstellungen ändern.', es: 'Puedes cambiarlo en cualquier momento desde Ajustes.', zh: '你可以随时在设置中更改语言。' },
  continueArrow: { en: 'Continue →', fr: 'Continuer →', de: 'Weiter →', es: 'Continuar →', zh: '继续 →' },
  // Welcome step
  frWelcomeBody: {
    en: `<strong>Welcome to Trove.</strong><br>Everything stays on your computer - zero-copy, nothing uploaded, nothing changed without you. Organize your photos and videos into trips, people, and categories; Trove just links to the files exactly where they already are.<br><br>The few minutes you spend tagging trips, people, and categories now is what makes finding any of it instant later - let's get your first batch in.`,
    fr: `<strong>Bienvenue sur Trove.</strong><br>Tout reste sur votre ordinateur - aucune copie, rien n'est envoyé en ligne, rien n'est modifié sans vous. Organisez vos photos et vidéos en voyages, personnes et catégories ; Trove se contente de créer des liens vers vos fichiers, exactement là où ils se trouvent déjà.<br><br>Les quelques minutes passées à organiser voyages, personnes et catégories maintenant sont ce qui rendra tout instantané à retrouver plus tard - importons votre premier lot.`,
    de: `<strong>Willkommen bei Trove.</strong><br>Alles bleibt auf Ihrem Computer - keine Kopien, nichts wird hochgeladen, nichts wird ohne Ihr Zutun verändert. Organisieren Sie Ihre Fotos und Videos in Reisen, Personen und Kategorien; Trove verknüpft die Dateien einfach genau dort, wo sie bereits liegen.<br><br>Die paar Minuten, die Sie jetzt in Reisen, Personen und Kategorien investieren, sorgen dafür, dass Sie später alles sofort wiederfinden - legen wir los mit Ihrer ersten Auswahl.`,
    es: `<strong>Bienvenido a Trove.</strong><br>Todo permanece en tu ordenador: sin copias, nada se sube ni se modifica sin tu permiso. Organiza tus fotos y vídeos en viajes, personas y categorías; Trove solo enlaza los archivos justo donde ya están.<br><br>Los pocos minutos que dediques ahora a etiquetar viajes, personas y categorías son los que harán que después encuentres todo al instante. Vamos a añadir tu primer lote.`,
    zh: `<strong>欢迎使用 Trove。</strong><br>一切都保存在你的电脑上——不复制文件、不上传任何内容、未经你同意绝不更改。将照片和视频整理成旅行、人物和分类;Trove 只是在文件原本所在的位置创建链接。<br><br>现在花几分钟为旅行、人物和分类打标签,以后查找时就能瞬间找到——我们先导入第一批照片吧。`
  },
  frWelcomeSkip: { en: "Skip, I'll explore on my own", fr: 'Passer, je vais explorer par moi-même', de: 'Überspringen, ich schaue mich selbst um', es: 'Omitir, prefiero explorar por mi cuenta', zh: '跳过,我自己探索' },
  frWelcomeGo: { en: "Let's go →", fr: 'C\'est parti →', de: "Los geht's →", es: 'Empecemos →', zh: '开始吧 →' },
  // Goal step
  frGoalOrganize: { en: 'Get a messy library organized', fr: "Remettre de l'ordre dans une bibliothèque en désordre", de: 'Eine unordentliche Bibliothek aufräumen', es: 'Poner orden en una biblioteca desordenada', zh: '整理一个杂乱的照片库' },
  frGoalCleanup: { en: 'Find and clean up duplicates or edited photos', fr: 'Trouver et supprimer les doublons ou les photos modifiées', de: 'Duplikate oder bearbeitete Fotos finden und bereinigen', es: 'Buscar y limpiar duplicados o fotos editadas', zh: '查找并清理重复或已编辑的照片' },
  frGoalBrowse: { en: 'Just browse and relive old trips', fr: "Simplement parcourir et revivre d'anciens voyages", de: 'Einfach alte Reisen durchstöbern und noch einmal erleben', es: 'Solo explorar y revivir viajes antiguos', zh: '只是浏览、重温以前的旅行' },
  frGoalSubDupes: { en: 'Mostly exact duplicates', fr: 'Principalement des doublons exacts', de: 'Meist exakte Duplikate', es: 'Sobre todo duplicados exactos', zh: '主要是完全相同的重复项' },
  frGoalSubEdited: { en: 'Mostly edited versions', fr: 'Principalement des versions modifiées', de: 'Meist bearbeitete Versionen', es: 'Sobre todo versiones editadas', zh: '主要是已编辑的版本' },
  frGoalSubBoth: { en: 'Honestly, both', fr: 'Honnêtement, les deux', de: 'Ehrlich gesagt, beides', es: 'Sinceramente, ambas cosas', zh: '老实说,两者都有' },
  frGoalTitle: { en: 'What brings you to Trove?', fr: 'Qu\'est-ce qui vous amène sur Trove ?', de: 'Was führt Sie zu Trove?', es: '¿Qué te trae a Trove?', zh: '是什么原因让你使用 Trove?' },
  frGoalSub: { en: 'This just decides what we show you first, nothing is ever off-limits either way.', fr: 'Cela détermine simplement ce qui vous sera montré en premier, rien ne vous sera jamais interdit pour autant.', de: 'Das entscheidet nur, was wir Ihnen zuerst zeigen - nichts bleibt Ihnen dadurch verwehrt.', es: 'Esto solo decide qué te mostramos primero, nada queda fuera de tu alcance de todos modos.', zh: '这只是决定先向你展示什么内容,无论如何你都能使用全部功能。' },
  frGoalFollowupTitle: { en: 'Mostly exact duplicates, edited versions, or both?', fr: 'Plutôt des doublons exacts, des versions modifiées, ou les deux ?', de: 'Eher exakte Duplikate, bearbeitete Versionen oder beides?', es: '¿Sobre todo duplicados exactos, versiones editadas, o ambas cosas?', zh: '主要是完全相同的重复项、已编辑的版本,还是两者都有?' },
  // Size step
  frSizeQuick: { en: 'Just a quick recent batch', fr: 'Juste un petit lot récent', de: 'Nur ein kleiner, aktueller Stapel', es: 'Solo un lote reciente y rápido', zh: '只是最近的一小批照片' },
  frSizeThousands: { en: 'A few thousand photos', fr: 'Quelques milliers de photos', de: 'Ein paar tausend Fotos', es: 'Unos pocos miles de fotos', zh: '几千张照片' },
  frSizeBacklog: { en: 'Years of backlog', fr: "Des années d'archives en retard", de: 'Jahrelanger Rückstau', es: 'Años de fotos acumuladas', zh: '积压了好几年的照片' },
  frSizeTitle: { en: 'How much are you bringing in today?', fr: 'Combien allez-vous importer aujourd\'hui ?', de: 'Wie viel bringen Sie heute mit?', es: '¿Cuánto vas a importar hoy?', zh: '你今天要导入多少照片?' },
  // Add files step
  frAddFilesTipBacklog: {
    en: v => `Got years of backlog? Drop it all in, we'll only walk you through the first ${v.cap} here, the rest lands safely in To Sort.`,
    fr: v => `Des années d'archives en retard ? Déposez tout, nous ne vous guiderons que pour les ${v.cap} premières ici, le reste atterrira en toute sécurité dans "À trier".`,
    de: v => `Jahrelanger Rückstau? Legen Sie einfach alles ab - wir führen Sie hier nur durch die ersten ${v.cap}, der Rest landet sicher in "Zu sortieren".`,
    es: v => `¿Tienes años de fotos acumuladas? Suéltalas todas, aquí solo te guiaremos con las primeras ${v.cap}; el resto llegará sin problema a "Por ordenar".`,
    zh: v => `积压多年的照片?全部拖进来吧,我们只会在这里引导你处理前 ${v.cap} 张,其余的会安全进入"待整理"。`
  },
  frAddFilesTipDefault: {
    en: '💡 Tip: Trove sorts fastest one trip at a time. Got more than you expected? Drop it all in anyway - the rest lands safely in To Sort.',
    fr: '💡 Astuce : Trove trie plus vite un voyage à la fois. Vous en avez plus que prévu ? Déposez tout quand même - le reste atterrira en toute sécurité dans "À trier".',
    de: '💡 Tipp: Trove sortiert am schnellsten eine Reise nach der anderen. Mehr als erwartet? Legen Sie trotzdem alles ab - der Rest landet sicher in "Zu sortieren".',
    es: '💡 Consejo: Trove ordena más rápido un viaje a la vez. ¿Tienes más de lo esperado? Suéltalo todo igualmente - el resto llegará sin problema a "Por ordenar".',
    zh: '💡 小提示:Trove 一次整理一趟旅行时速度最快。照片比预期多?照样全部拖进来——其余的会安全进入"待整理"。'
  },
  frAddFilesIntro: { en: v => `<strong>Add your photos & videos.</strong> ${v.tip}`, fr: v => `<strong>Ajoutez vos photos et vidéos.</strong> ${v.tip}`, de: v => `<strong>Fügen Sie Ihre Fotos & Videos hinzu.</strong> ${v.tip}`, es: v => `<strong>Añade tus fotos y vídeos.</strong> ${v.tip}`, zh: v => `<strong>添加你的照片和视频。</strong>${v.tip}` },
  frDropzoneText: { en: 'Click to choose files, or drag &amp; drop them here', fr: 'Cliquez pour choisir des fichiers, ou glissez-déposez-les ici', de: 'Klicken Sie, um Dateien auszuwählen, oder ziehen Sie sie hierher', es: 'Haz clic para elegir archivos, o arrástralos y suéltalos aquí', zh: '点击选择文件,或将文件拖放到此处' },
  frCapNote: {
    en: v => `${v.cap} shown here for this walkthrough. ${v.n} more ${v.n!==1?'are':'is'} already queued in To Sort for after.`,
    fr: v => `${v.cap} affichées ici pour cette visite guidée. ${v.n} photo${v.n!==1?'s':''} supplémentaire${v.n!==1?'s':''} déjà en attente dans "À trier" pour plus tard.`,
    de: v => `${v.cap} werden hier für diese Einführung angezeigt. ${v.n} weitere Foto${v.n!==1?'s':''} liegen bereits in "Zu sortieren" für später bereit.`,
    es: v => `${v.cap} se muestran aquí para este recorrido. ${v.n} foto${v.n!==1?'s':''} más ya ${v.n!==1?'están':'está'} en cola en "Por ordenar" para después.`,
    zh: v => `本次引导在此显示 ${v.cap} 张。另有 ${v.n} 张已在"待整理"中排队,稍后处理。`
  },
  frBarInfoDeferred: { en: v => `${v.files} of ${v.cap} added (+${v.deferred} queued)`, fr: v => `${v.files} sur ${v.cap} ajoutées (+${v.deferred} en attente)`, de: v => `${v.files} von ${v.cap} hinzugefügt (+${v.deferred} in Warteschlange)`, es: v => `${v.files} de ${v.cap} añadidas (+${v.deferred} en cola)`, zh: v => `已添加 ${v.files} / ${v.cap}(另有 ${v.deferred} 张排队中)` },
  frBarInfoFiles: { en: v => `${v.n} file${v.n!==1?'s':''} added`, fr: v => `${v.n} fichier${v.n!==1?'s':''} ajouté${v.n!==1?'s':''}`, de: v => `${v.n} Datei${v.n!==1?'en':''} hinzugefügt`, es: v => `${v.n} archivo${v.n!==1?'s':''} añadido${v.n!==1?'s':''}`, zh: v => `已添加 ${v.n} 个文件` },
  frSkipForNow: { en: 'Skip for now', fr: "Passer pour l'instant", de: 'Vorerst überspringen', es: 'Omitir por ahora', zh: '暂时跳过' },
  // Trip ask step
  frTripAskFollowupText: {
    en: v => `${v.n} photo${v.n!==1?'s':''} didn't match the dates of the trip you just created. Are these from another trip too?`,
    fr: v => `${v.n} photo${v.n!==1?'s':''} ne correspond${v.n!==1?'ent':''} pas aux dates du voyage que vous venez de créer. Viennent-elles aussi d'un autre voyage ?`,
    de: v => `${v.n} Foto${v.n!==1?'s':''} passte${v.n!==1?'n':''} nicht zu den Daten der gerade erstellten Reise. Stammen diese auch von einer anderen Reise?`,
    es: v => `${v.n} foto${v.n!==1?'s':''} no coincid${v.n!==1?'ieron':'ió'} con las fechas del viaje que acabas de crear. ¿Son también de otro viaje?`,
    zh: v => `有 ${v.n} 张照片与你刚创建的旅行日期不符。这些也是另一趟旅行的照片吗?`
  },
  frTripAskDefaultText: {
    en: v => `${v.n} photo${v.n!==1?'s':''} added. If they're from somewhere you went, we'll create a trip folder for them. If it's just everyday life, no folder needed - go straight to tagging.`,
    fr: v => `${v.n} photo${v.n!==1?'s':''} ajoutée${v.n!==1?'s':''}. Si elles viennent d'un endroit où vous êtes allé, nous créerons un dossier de voyage pour elles. Si ce sont simplement des photos du quotidien, aucun dossier n'est nécessaire - passez directement au marquage.`,
    de: v => `${v.n} Foto${v.n!==1?'s':''} hinzugefügt. Falls sie von einem Ort stammen, an dem Sie waren, erstellen wir dafür einen Reiseordner. Falls es einfach Alltagsfotos sind, ist kein Ordner nötig - weiter geht's direkt mit dem Verschlagworten.`,
    es: v => `${v.n} foto${v.n!==1?'s':''} añadida${v.n!==1?'s':''}. Si son de algún lugar al que fuiste, crearemos una carpeta de viaje para ellas. Si son solo fotos del día a día, no hace falta carpeta - pasa directamente a etiquetarlas.`,
    zh: v => `已添加 ${v.n} 张照片。如果这些是你某次出行拍的,我们会为它们创建一个旅行文件夹;如果只是日常照片,不需要文件夹——直接开始打标签即可。`
  },
  frClusterRow: {
    en: v => `${v.n} photo${v.n!==1?'s':''}${v.match?` · looks like ${v.match}`:''}`,
    fr: v => `${v.n} photo${v.n!==1?'s':''}${v.match?` · ressemble à ${v.match}`:''}`,
    de: v => `${v.n} Foto${v.n!==1?'s':''}${v.match?` · sieht aus wie ${v.match}`:''}`,
    es: v => `${v.n} foto${v.n!==1?'s':''}${v.match?` · parece ${v.match}`:''}`,
    zh: v => `${v.n} 张照片${v.match?` · 看起来像是「${v.match}」`:''}`
  },
  frClusterBreakdownIntro: {
    en: v => `These look like ${v.n} separate groups by date. Answering "Yes" only asks about <strong>one trip at a time</strong> - enter that trip's dates and only the matching photos get filed; you'll be asked again for the rest right after, as many times as needed.`,
    fr: v => `Cela ressemble à ${v.n} groupes distincts par date. Répondre « Oui » ne concerne qu'<strong>un voyage à la fois</strong> - indiquez les dates de ce voyage et seules les photos correspondantes seront classées ; on vous reposera la question pour le reste juste après, autant de fois que nécessaire.`,
    de: v => `Das sieht nach ${v.n} unterschiedlichen Gruppen nach Datum aus. Mit „Ja" wird immer nur <strong>eine Reise auf einmal</strong> abgefragt - geben Sie die Daten dieser Reise ein, und nur die passenden Fotos werden einsortiert; direkt danach werden Sie für den Rest erneut gefragt, so oft wie nötig.`,
    es: v => `Esto parece ${v.n} grupos distintos por fecha. Responder "Sí" solo pregunta por <strong>un viaje a la vez</strong> - introduce las fechas de ese viaje y solo se archivarán las fotos que coincidan; se te volverá a preguntar por el resto justo después, tantas veces como haga falta.`,
    zh: v => `这些照片看起来分成了 ${v.n} 个不同的日期组。选择"是"每次只会询问<strong>一趟旅行</strong>——输入该趟旅行的日期后,只有匹配的照片会被归档;之后会针对剩余照片再次询问,直到全部处理完。`
  },
  frTripAskTitle: { en: 'Are these from a specific trip?', fr: "Ces photos viennent-elles d'un voyage particulier ?", de: 'Stammen diese Fotos von einer bestimmten Reise?', es: '¿Son de un viaje concreto?', zh: '这些照片来自某次特定的旅行吗?' },
  frTripYes: { en: '✈️ Yes, name one trip', fr: '✈️ Oui, nommer un voyage', de: '✈️ Ja, eine Reise benennen', es: '✈️ Sí, nombrar un viaje', zh: '✈️ 是的,为这趟旅行命名' },
  frTripNo: { en: 'No, just everyday photos', fr: 'Non, juste des photos du quotidien', de: 'Nein, nur Alltagsfotos', es: 'No, solo fotos del día a día', zh: '不是,只是日常照片' },
  // Trip create step
  frTripCreateIntro: {
    en: "<strong>Name this trip.</strong> Where did you go? The year is worked out from the dates below, so it never has to go in the name itself.",
    fr: "<strong>Nommez ce voyage.</strong> Où êtes-vous allé ? L'année est déduite des dates ci-dessous, elle n'a donc jamais besoin de figurer dans le nom.",
    de: "<strong>Benennen Sie diese Reise.</strong> Wohin ging es? Das Jahr wird aus den Daten unten ermittelt und muss daher nie im Namen selbst stehen.",
    es: "<strong>Ponle nombre a este viaje.</strong> ¿A dónde fuiste? El año se calcula a partir de las fechas de abajo, así que nunca hace falta incluirlo en el nombre.",
    zh: "<strong>为这趟旅行命名。</strong>你去了哪里?年份会根据下方的日期自动计算,因此名称中无需包含年份。"
  },
  frTripNamePlaceholder: { en: "e.g. Iceland, Grandma's house, Ski week…", fr: 'ex. Islande, Chez mamie, Semaine au ski…', de: 'z. B. Island, Omas Haus, Skiwoche…', es: 'p. ej. Islandia, Casa de la abuela, Semana de esquí…', zh: '例如:冰岛、奶奶家、滑雪周……' },
  frTripDatesSub: { en: 'When was this trip? (optional - future photo dumps auto-file here if the dates match)', fr: 'Quand a eu lieu ce voyage ? (facultatif - les futurs imports de photos seront classés ici automatiquement si les dates correspondent)', de: 'Wann fand diese Reise statt? (optional - künftige Fotoimporte werden hier automatisch einsortiert, wenn die Daten übereinstimmen)', es: 'Cuándo fue este viaje? (opcional - las futuras importaciones de fotos se archivarán aquí automáticamente si las fechas coinciden)', zh: '这趟旅行是什么时候?(可选——如果日期匹配,以后导入的照片会自动归入此处)' },
  frTripColorSub: { en: "Color - pick one that's easy to spot in the sidebar and on the Globe", fr: 'Couleur - choisissez-en une facile à repérer dans la barre latérale et sur le Globe', de: 'Farbe - wählen Sie eine, die in der Seitenleiste und auf dem Globus leicht zu erkennen ist', es: 'Color - elige uno fácil de distinguir en la barra lateral y en el Globo', zh: '颜色——选一个在侧边栏和地球视图中容易辨认的颜色' },
  frDateRangeTo: { en: 'to', fr: 'à', de: 'bis', es: 'a', zh: '至' },
  frSkipTrip: { en: 'Skip trip', fr: 'Passer le voyage', de: 'Reise überspringen', es: 'Omitir viaje', zh: '跳过此旅行' },
  frCreateTripContinue: { en: 'Create trip & continue →', fr: 'Créer le voyage et continuer →', de: 'Reise erstellen & weiter →', es: 'Crear viaje y continuar →', zh: '创建旅行并继续 →' },
  // People step
  frEverydayPhotos: { en: 'Everyday photos', fr: 'Photos du quotidien', de: 'Alltagsfotos', es: 'Fotos del día a día', zh: '日常照片' },
  frScopeNote: { en: v => ` - ${v.label} (${v.i} of ${v.n})`, fr: v => ` - ${v.label} (${v.i} sur ${v.n})`, de: v => ` - ${v.label} (${v.i} von ${v.n})`, es: v => ` - ${v.label} (${v.i} de ${v.n})`, zh: v => ` - ${v.label}(第 ${v.i} 组,共 ${v.n} 组)` },
  frPeopleExplainHas: {
    en: 'Click every photo that includes someone, then tap their name to file it. Double-click (or 🔍) a photo to see it larger. Nobody to tag? Just continue.',
    fr: 'Cliquez sur chaque photo où figure quelqu\'un, puis appuyez sur son nom pour la classer. Double-cliquez (ou 🔍) sur une photo pour l\'agrandir. Personne à identifier ? Continuez simplement.',
    de: 'Klicken Sie auf jedes Foto, auf dem jemand zu sehen ist, und tippen Sie dann auf den Namen, um es einzusortieren. Doppelklicken (oder 🔍) Sie auf ein Foto, um es größer anzuzeigen. Niemand zu markieren? Einfach weiter.',
    es: 'Haz clic en cada foto que incluya a alguien y luego pulsa su nombre para archivarla. Haz doble clic (o 🔍) en una foto para verla más grande. ¿Nadie que etiquetar? Simplemente continúa.',
    zh: '点击每一张包含某人的照片,然后点按其姓名进行归档。双击(或点击 🔍)可放大查看照片。没有人需要标记?直接继续即可。'
  },
  frPeopleExplainNone: {
    en: 'Nobody added yet - click a photo below, then tap <strong>"+ New person"</strong> to name them. That\'s how you add the first one.',
    fr: 'Personne n\'a encore été ajouté - cliquez sur une photo ci-dessous, puis appuyez sur <strong>« + Nouvelle personne »</strong> pour la nommer. C\'est ainsi que vous ajoutez la première.',
    de: 'Noch niemand hinzugefügt - klicken Sie unten auf ein Foto und tippen Sie dann auf <strong>„+ Neue Person"</strong>, um sie zu benennen. So fügen Sie die erste Person hinzu.',
    es: 'Todavía no se ha añadido a nadie - haz clic en una foto de abajo y luego pulsa <strong>"+ Nueva persona"</strong> para ponerle nombre. Así es como añades a la primera.',
    zh: '还没有添加任何人——点击下方的照片,然后点按<strong>"+ 新建人物"</strong>为其命名。这样就添加了第一个人物。'
  },
  frPeopleTitle: { en: v => `Tag the people in these photos${v.scopeNote}.`, fr: v => `Identifiez les personnes sur ces photos${v.scopeNote}.`, de: v => `Markieren Sie die Personen auf diesen Fotos${v.scopeNote}.`, es: v => `Etiqueta a las personas de estas fotos${v.scopeNote}.`, zh: v => `为这些照片中的人物打标签${v.scopeNote}。` },
  frNewPerson: { en: '+ New person', fr: '+ Nouvelle personne', de: '+ Neue Person', es: '+ Nueva persona', zh: '+ 新建人物' },
  frBarSelectedPeople: { en: v => `${v.n} photo${v.n!==1?'s':''} selected - tap a name above to file them`, fr: v => `${v.n} photo${v.n!==1?'s':''} sélectionnée${v.n!==1?'s':''} - appuyez sur un nom ci-dessus pour les classer`, de: v => `${v.n} Foto${v.n!==1?'s':''} ausgewählt - tippen Sie oben auf einen Namen, um sie einzusortieren`, es: v => `${v.n} foto${v.n!==1?'s':''} seleccionada${v.n!==1?'s':''} - pulsa un nombre arriba para archivarlas`, zh: v => `已选择 ${v.n} 张照片——点按上方的姓名进行归档` },
  frBarBatchCount: { en: v => `${v.n} photo${v.n!==1?'s':''} in this batch`, fr: v => `${v.n} photo${v.n!==1?'s':''} dans ce lot`, de: v => `${v.n} Foto${v.n!==1?'s':''} in diesem Stapel`, es: v => `${v.n} foto${v.n!==1?'s':''} en este lote`, zh: v => `此批次共有 ${v.n} 张照片` },
  frNextLabel: { en: v => `Next: ${v.label} →`, fr: v => `Suivant : ${v.label} →`, de: v => `Weiter: ${v.label} →`, es: v => `Siguiente: ${v.label} →`, zh: v => `下一步:${v.label} →` },
  frToastPickPhotosPerson: { en: 'Click some photos of them first, then tap their name', fr: "Cliquez d'abord sur quelques photos d'elle, puis appuyez sur son nom", de: 'Klicken Sie zuerst auf ein paar Fotos von ihr/ihm und dann auf den Namen', es: 'Haz clic primero en algunas fotos suyas y luego pulsa su nombre', zh: '请先点击几张包含此人的照片,然后点按其姓名' },
  frToastPeopleNudge: {
    en: "No one tagged yet, that's fine. You can always tag people later from any photo's right-click menu.",
    fr: "Personne n'a encore été identifié, ce n'est pas grave. Vous pourrez toujours identifier des personnes plus tard via le clic droit sur n'importe quelle photo.",
    de: 'Noch niemand markiert, das ist völlig in Ordnung. Sie können Personen jederzeit später über das Rechtsklickmenü eines Fotos markieren.',
    es: 'Todavía no se ha etiquetado a nadie, no pasa nada. Siempre puedes etiquetar personas más tarde desde el menú contextual (clic derecho) de cualquier foto.',
    zh: '还没有标记任何人,没关系。你随时可以之后在任意照片的右键菜单中标记人物。'
  },
  // Categories step
  frCategoriesTitle: { en: v => `Add categories${v.scopeNote}.`, fr: v => `Ajoutez des catégories${v.scopeNote}.`, de: v => `Kategorien hinzufügen${v.scopeNote}.`, es: v => `Añade categorías${v.scopeNote}.`, zh: v => `添加分类${v.scopeNote}。` },
  frCategoriesExplain: {
    en: 'Click photos that fit one below, then tap it to file them. A photo can belong to more than one. Skip if none apply.',
    fr: 'Cliquez sur les photos correspondant à une catégorie ci-dessous, puis appuyez dessus pour les classer. Une photo peut appartenir à plusieurs catégories. Passez si aucune ne convient.',
    de: 'Klicken Sie auf Fotos, die zu einer der Kategorien unten passen, und tippen Sie dann darauf, um sie einzusortieren. Ein Foto kann zu mehreren Kategorien gehören. Überspringen Sie, falls keine passt.',
    es: 'Haz clic en las fotos que encajen con una categoría de abajo y luego pulsa sobre ella para archivarlas. Una foto puede pertenecer a más de una categoría. Omite este paso si ninguna aplica.',
    zh: '点击符合下方某个分类的照片,然后点按该分类进行归档。一张照片可以属于多个分类。如果都不适用,可以跳过。'
  },
  frCustomEllipsis: { en: '+ Custom…', fr: '+ Personnalisé…', de: '+ Benutzerdefiniert…', es: '+ Personalizada…', zh: '+ 自定义……' },
  frBarSelectedCategories: { en: v => `${v.n} photo${v.n!==1?'s':''} selected - tap a category above to file them`, fr: v => `${v.n} photo${v.n!==1?'s':''} sélectionnée${v.n!==1?'s':''} - appuyez sur une catégorie ci-dessus pour les classer`, de: v => `${v.n} Foto${v.n!==1?'s':''} ausgewählt - tippen Sie oben auf eine Kategorie, um sie einzusortieren`, es: v => `${v.n} foto${v.n!==1?'s':''} seleccionada${v.n!==1?'s':''} - pulsa una categoría arriba para archivarlas`, zh: v => `已选择 ${v.n} 张照片——点按上方的分类进行归档` },
  frFinishArrow: { en: 'Finish →', fr: 'Terminer →', de: 'Fertig →', es: 'Finalizar →', zh: '完成 →' },
  frToastPickPhotosCategory: { en: 'Click some photos first, then tap the category', fr: "Cliquez d'abord sur quelques photos, puis appuyez sur la catégorie", de: 'Klicken Sie zuerst auf ein paar Fotos und dann auf die Kategorie', es: 'Haz clic primero en algunas fotos y luego pulsa la categoría', zh: '请先点击几张照片,然后点按该分类' },
  // Orientation step
  frOrientationTitle: { en: 'Quick tour of where things live.', fr: 'Petit tour rapide pour savoir où trouver les choses.', de: 'Kurzer Rundgang, wo Sie was finden.', es: 'Un breve recorrido por dónde está todo.', zh: '快速了解各功能的位置。' },
  frOrientationSub: { en: "This chrome is dimmed behind the wizard right now, but it's exactly what you'll see once you're in your library.", fr: "Cette interface est assombrie derrière l'assistant pour le moment, mais c'est exactement ce que vous verrez une fois dans votre bibliothèque.", de: 'Diese Oberfläche ist gerade hinter dem Assistenten abgedunkelt, aber genau das sehen Sie, sobald Sie in Ihrer Bibliothek sind.', es: 'Esta interfaz está atenuada detrás del asistente ahora mismo, pero es exactamente lo que verás una vez dentro de tu biblioteca.', zh: '此刻界面在向导后方是暗淡的,但这正是你进入照片库后会看到的样子。' },
  frOrientSidebarTitle: { en: 'Sidebar', fr: 'Barre latérale', de: 'Seitenleiste', es: 'Barra lateral', zh: '侧边栏' },
  frOrientSidebarDesc: { en: 'Trips, People, Categories, Cameras, and Location, on the left. Click any section to browse just those photos.', fr: 'Voyages, Personnes, Catégories, Appareils et Lieux, sur la gauche. Cliquez sur une section pour parcourir uniquement ces photos.', de: 'Reisen, Personen, Kategorien, Kameras und Standort, links. Klicken Sie auf einen Bereich, um nur diese Fotos zu durchsuchen.', es: 'Viajes, Personas, Categorías, Cámaras y Ubicación, a la izquierda. Haz clic en cualquier sección para ver solo esas fotos.', zh: '左侧是旅行、人物、分类、相机和地点。点击任意分区即可只浏览该分类下的照片。' },
  frOrientFilterTitle: { en: 'Filter', fr: 'Filtre', de: 'Filter', es: 'Filtro', zh: '筛选' },
  frOrientFilterDesc: { en: "Top of the library view. Narrows what's shown by date, camera, or favorites.", fr: 'En haut de la vue bibliothèque. Restreint l\'affichage par date, appareil ou favoris.', de: 'Oben in der Bibliotheksansicht. Grenzt die Anzeige nach Datum, Kamera oder Favoriten ein.', es: 'En la parte superior de la biblioteca. Reduce lo mostrado por fecha, cámara o favoritos.', zh: '位于照片库视图顶部,可按日期、相机或收藏来缩小显示范围。' },
  frOrientSortTitle: { en: 'Sort', fr: 'Trier', de: 'Sortieren', es: 'Ordenar', zh: '排序' },
  frOrientSortDesc: { en: 'Next to Filter. Change the order: newest first, by name, by size, and more.', fr: "À côté de Filtre. Change l'ordre d'affichage : plus récent d'abord, par nom, par taille, etc.", de: 'Neben Filter. Ändert die Reihenfolge: neueste zuerst, nach Name, nach Größe und mehr.', es: 'Junto a Filtro. Cambia el orden: más recientes primero, por nombre, por tamaño y más.', zh: '位于筛选旁边,可更改排序方式:最新优先、按名称、按大小等。' },
  frOrientAddTitle: { en: 'Add Files', fr: 'Ajouter des fichiers', de: 'Dateien hinzufügen', es: 'Añadir archivos', zh: '添加文件' },
  frOrientAddDesc: { en: 'Top-right, always there. Click it any time you want to bring in more photos or videos.', fr: "En haut à droite, toujours visible. Cliquez dessus chaque fois que vous voulez importer plus de photos ou de vidéos.", de: 'Oben rechts, immer sichtbar. Klicken Sie jederzeit darauf, um weitere Fotos oder Videos hinzuzufügen.', es: 'Arriba a la derecha, siempre visible. Haz clic cuando quieras añadir más fotos o vídeos.', zh: '位于右上角,始终可见。想要导入更多照片或视频时随时点击。' },
  frGotIt: { en: 'Got it →', fr: 'Compris →', de: 'Verstanden →', es: 'Entendido →', zh: '知道了 →' },
  // Tour intro
  frTourIntroTitle: { en: "Let's take Trove's core features for a spin.", fr: 'Découvrons ensemble les fonctionnalités clés de Trove.', de: 'Lassen Sie uns die Kernfunktionen von Trove ausprobieren.', es: 'Probemos juntos las funciones principales de Trove.', zh: '让我们体验一下 Trove 的核心功能吧。' },
  frTourIntroSub: { en: 'Using what you just added, no separate demo data. Takes under a minute.', fr: 'En utilisant ce que vous venez d\'ajouter, sans données de démonstration séparées. Cela prend moins d\'une minute.', de: 'Mit dem, was Sie gerade hinzugefügt haben, keine separaten Demodaten. Dauert weniger als eine Minute.', es: 'Usando lo que acabas de añadir, sin datos de demostración aparte. Lleva menos de un minuto.', zh: '使用你刚才添加的照片,无需单独的演示数据。用时不到一分钟。' },
  frStartTour: { en: 'Start the tour →', fr: 'Démarrer la visite →', de: 'Tour starten →', es: 'Empezar el recorrido →', zh: '开始体验 →' },
  frSkipTour: { en: 'Skip the tour', fr: 'Passer la visite', de: 'Tour überspringen', es: 'Omitir el recorrido', zh: '跳过体验' },
  // Tour step intro
  frTourGlobeTitle: { en: 'Explore the Globe', fr: 'Explorez le Globe', de: 'Entdecken Sie den Globus', es: 'Explora el Globo', zh: '探索地球视图' },
  frTourGlobeBodyTrip: { en: "Trove plots every trip on a real 3D globe. Let's fly to the one you just made.", fr: "Trove place chaque voyage sur un véritable globe 3D. Envolons-nous vers celui que vous venez de créer.", de: 'Trove zeichnet jede Reise auf einem echten 3D-Globus ein. Fliegen wir zu der, die Sie gerade erstellt haben.', es: 'Trove marca cada viaje en un globo 3D real. Volemos hasta el que acabas de crear.', zh: 'Trove 会在真实的 3D 地球上标出每一趟旅行。我们飞到你刚创建的那趟旅行看看吧。' },
  frTourGlobeBodyNoTrip: { en: "Trove plots every trip on a real 3D globe. Let's take a quick look around.", fr: 'Trove place chaque voyage sur un véritable globe 3D. Faisons un petit tour.', de: 'Trove zeichnet jede Reise auf einem echten 3D-Globus ein. Schauen wir uns kurz um.', es: 'Trove marca cada viaje en un globo 3D real. Echemos un vistazo rápido.', zh: 'Trove 会在真实的 3D 地球上标出每一趟旅行。我们先四处看看吧。' },
  frTourGlobeBodySuffix: { en: " When you're done looking around, click ✕ Close up top to pick up right where you left off.", fr: ' Une fois votre exploration terminée, cliquez sur ✕ Fermer en haut pour reprendre exactement là où vous en étiez.', de: ' Wenn Sie fertig sind, klicken Sie oben auf ✕ Schließen, um genau dort weiterzumachen, wo Sie aufgehört haben.', es: ' Cuando termines de mirar, haz clic en ✕ Cerrar arriba para retomar justo donde lo dejaste.', zh: ' 看完之后,点击顶部的 ✕ 关闭,即可从刚才的位置继续。' },
  frTourGlobeBtn: { en: 'Open the Globe', fr: 'Ouvrir le Globe', de: 'Globus öffnen', es: 'Abrir el Globo', zh: '打开地球视图' },
  frTourEditorTitle: { en: 'Try the Photo Editor', fr: "Essayez l'éditeur de photos", de: 'Probieren Sie den Fotoeditor aus', es: 'Prueba el Editor de fotos', zh: '试试照片编辑器' },
  frTourEditorBody: {
    en: v => `Every photo gets a full, non-destructive editor: exposure, color, curves, and more. Try one real adjustment on <strong>${v.file}</strong>, then click ✕ Close up top to pick up right where you left off.`,
    fr: v => `Chaque photo bénéficie d'un éditeur complet et non destructif : exposition, couleur, courbes, et plus encore. Essayez un vrai réglage sur <strong>${v.file}</strong>, puis cliquez sur ✕ Fermer en haut pour reprendre exactement là où vous en étiez.`,
    de: v => `Jedes Foto erhält einen vollständigen, zerstörungsfreien Editor: Belichtung, Farbe, Kurven und mehr. Probieren Sie eine echte Anpassung an <strong>${v.file}</strong> aus, klicken Sie dann oben auf ✕ Schließen, um genau dort weiterzumachen, wo Sie aufgehört haben.`,
    es: v => `Cada foto tiene un editor completo y no destructivo: exposición, color, curvas y más. Prueba un ajuste real en <strong>${v.file}</strong>, luego haz clic en ✕ Cerrar arriba para retomar justo donde lo dejaste.`,
    zh: v => `每张照片都配有完整的非破坏性编辑器:曝光、色彩、曲线等等。在 <strong>${v.file}</strong> 上试着做一次真实调整,然后点击顶部的 ✕ 关闭,即可从刚才的位置继续。`
  },
  frTourEditorBtn: { en: 'Open the Editor', fr: "Ouvrir l'éditeur", de: 'Editor öffnen', es: 'Abrir el editor', zh: '打开编辑器' },
  frTourDuplicateTitle: { en: 'Watch Find Duplicates work', fr: 'Découvrez la détection de doublons en action', de: 'Sehen Sie, wie Duplikate finden funktioniert', es: 'Mira cómo funciona Buscar duplicados', zh: '看看"查找重复项"如何工作' },
  frTourDuplicateBody: {
    en: v => `Find Duplicates catches copies automatically, even renamed ones. We'll make one small demo copy of <strong>${v.file}</strong> right now so you can watch it get caught live. Keep it or remove it, your call, then click ✕ Close up top to pick up right where you left off.`,
    fr: v => `La détection de doublons repère automatiquement les copies, même renommées. Nous allons créer une petite copie de démonstration de <strong>${v.file}</strong> pour que vous puissiez la voir détectée en direct. Gardez-la ou supprimez-la, à vous de voir, puis cliquez sur ✕ Fermer en haut pour reprendre exactement là où vous en étiez.`,
    de: v => `Duplikate finden erkennt Kopien automatisch, auch umbenannte. Wir erstellen jetzt eine kleine Demo-Kopie von <strong>${v.file}</strong>, damit Sie live sehen können, wie sie erkannt wird. Behalten oder entfernen Sie sie, ganz wie Sie möchten, klicken Sie dann oben auf ✕ Schließen, um genau dort weiterzumachen, wo Sie aufgehört haben.`,
    es: v => `Buscar duplicados detecta copias automáticamente, incluso si están renombradas. Ahora crearemos una pequeña copia de demostración de <strong>${v.file}</strong> para que veas cómo se detecta en directo. Consérvala o elimínala, tú decides, luego haz clic en ✕ Cerrar arriba para retomar justo donde lo dejaste.`,
    zh: v => `"查找重复项"会自动识别重复文件,即使文件被重命名过也不例外。我们现在会创建一份 <strong>${v.file}</strong> 的演示副本,让你实时看到它被识别出来。保留或删除都由你决定,之后点击顶部的 ✕ 关闭,即可从刚才的位置继续。`
  },
  frTourDuplicateBtn: { en: 'Try Find Duplicates', fr: 'Essayer la détection de doublons', de: 'Duplikate finden ausprobieren', es: 'Probar Buscar duplicados', zh: '试试查找重复项' },
  frDefaultPhoto: { en: 'one of your photos', fr: "l'une de vos photos", de: 'eines Ihrer Fotos', es: 'una de tus fotos', zh: '你的一张照片' },
  frSkipThis: { en: 'Skip this', fr: 'Passer cette étape', de: 'Diesen Schritt überspringen', es: 'Omitir este paso', zh: '跳过此步骤' },
  // Unlock step
  frUnlockTitle: { en: 'A batch this size deserves the fast lane.', fr: 'Un lot de cette taille mérite la voie rapide.', de: 'Ein Stapel dieser Größe verdient die Überholspur.', es: 'Un lote de este tamaño merece vía rápida.', zh: '这么大的一批照片,值得走"快速通道"。' },
  frUnlockBody: {
    en: v => `${v.n} more file${v.n!==1?'s':''} just got queued and ${v.n!==1?'are':'is'} already safe in To Sort, waiting whenever you're ready.`,
    fr: v => `${v.n} fichier${v.n!==1?'s':''} de plus vien${v.n!==1?'nent':'t'} d'être mis en attente et se trouve${v.n!==1?'nt':''} déjà en sécurité dans "À trier", prêts quand vous le serez.`,
    de: v => `${v.n} weitere Datei${v.n!==1?'en':''} wurde${v.n!==1?'n':''} gerade in die Warteschlange gestellt und liegen bereits sicher in "Zu sortieren", bereit, wann immer Sie es sind.`,
    es: v => `${v.n} archivo${v.n!==1?'s':''} más acaba${v.n!==1?'n':''} de entrar en cola y ya está${v.n!==1?'n':''} a salvo en "Por ordenar", esperando a que estés listo.`,
    zh: v => `另有 ${v.n} 个文件刚刚被加入队列,已安全存放在"待整理"中,随时等你处理。`
  },
  frUnlockTakeMe: { en: '📥 Take me there now', fr: "📥 M'y emmener maintenant", de: '📥 Jetzt dorthin bringen', es: '📥 Llévame allí ahora', zh: '📥 立即前往' },
  // Rating step
  frRatingTitle: { en: "How's it going so far?", fr: 'Comment ça se passe jusqu\'ici ?', de: "Wie läuft's bisher?", es: '¿Qué tal va todo hasta ahora?', zh: '目前使用体验如何?' },
  frStarTitle: { en: v => `${v.n} star${v.n!==1?'s':''}`, fr: v => `${v.n} étoile${v.n!==1?'s':''}`, de: v => `${v.n} Stern${v.n!==1?'e':''}`, es: v => `${v.n} estrella${v.n!==1?'s':''}`, zh: v => `${v.n} 星` },
  frSkip: { en: 'Skip', fr: 'Passer', de: 'Überspringen', es: 'Omitir', zh: '跳过' },
  frRatingThanksTitle: { en: 'Glad to hear it.', fr: "Ravi de l'entendre.", de: 'Freut uns zu hören.', es: 'Nos alegra saberlo.', zh: '很高兴听到这个消息。' },
  frRatingThanksBody: {
    en: "If Trove's been useful, a star on GitHub helps more than you'd think, it's close to the only marketing this project has.",
    fr: "Si Trove vous a été utile, une étoile sur GitHub aide plus que vous ne le pensez, c'est quasiment la seule publicité dont bénéficie ce projet.",
    de: 'Wenn Trove hilfreich war, hilft ein Stern auf GitHub mehr, als Sie denken - es ist fast das Einzige an Werbung, das dieses Projekt hat.',
    es: 'Si Trove te ha resultado útil, una estrella en GitHub ayuda más de lo que crees, es casi el único marketing que tiene este proyecto.',
    zh: '如果 Trove 对你有帮助,在 GitHub 上点一个星标会有意想不到的帮助——这几乎是这个项目唯一的"营销方式"。'
  },
  frStarGithub: { en: '⭐ Star Trove on GitHub', fr: '⭐ Mettre une étoile à Trove sur GitHub', de: '⭐ Trove auf GitHub mit einem Stern versehen', es: '⭐ Dale una estrella a Trove en GitHub', zh: '⭐ 在 GitHub 上为 Trove 加星' },
  frFeedbackTitle: { en: 'Sorry to hear that.', fr: "Désolé de l'entendre.", de: 'Das tut uns leid.', es: 'Lamentamos escuchar eso.', zh: '很遗憾听到这个消息。' },
  frFeedbackBody: { en: "What's not working? This stays on your computer, nothing gets sent anywhere.", fr: 'Qu\'est-ce qui ne fonctionne pas ? Cela reste sur votre ordinateur, rien n\'est envoyé où que ce soit.', de: 'Was funktioniert nicht? Das bleibt auf Ihrem Computer, es wird nirgendwohin gesendet.', es: '¿Qué no funciona? Esto se queda en tu ordenador, no se envía a ningún sitio.', zh: '哪里出了问题?这些内容只保存在你的电脑上,不会发送到任何地方。' },
  frFeedbackPlaceholder: { en: "Tell us what's not clicking...", fr: 'Dites-nous ce qui ne va pas…', de: 'Sagen Sie uns, was nicht passt…', es: 'Cuéntanos qué no te convence…', zh: '告诉我们哪里不顺手……' },
  frSendFeedback: { en: 'Send feedback', fr: 'Envoyer le retour', de: 'Feedback senden', es: 'Enviar comentario', zh: '发送反馈' },
  frFeedbackThanksToast: { en: 'Thanks, saved locally, this never leaves your computer', fr: 'Merci, enregistré localement, cela ne quitte jamais votre ordinateur', de: 'Danke, lokal gespeichert, das verlässt Ihren Computer nie', es: 'Gracias, guardado localmente, esto nunca sale de tu ordenador', zh: '谢谢,已保存在本地,不会离开你的电脑' },
  // Done step
  frTripPhraseSingle: { en: v => ` to ${v.name}${v.yearSuffix}`, fr: v => ` vers ${v.name}${v.yearSuffix}`, de: v => ` nach ${v.name}${v.yearSuffix}`, es: v => ` a ${v.name}${v.yearSuffix}`, zh: v => ` 前往 ${v.name}${v.yearSuffix}` },
  frTripPhraseMulti: { en: v => ` across ${v.n} trips (${v.names})`, fr: v => ` répartis sur ${v.n} voyages (${v.names})`, de: v => ` über ${v.n} Reisen verteilt (${v.names})`, es: v => ` repartidas en ${v.n} viajes (${v.names})`, zh: v => ` 分布在 ${v.n} 趟旅行中(${v.names})` },
  frUnlockPhrase: { en: v => `, plus ${v.n} more file${v.n!==1?'s':''} unlocked in To Sort`, fr: v => `, plus ${v.n} fichier${v.n!==1?'s':''} de plus débloqué${v.n!==1?'s':''} dans "À trier"`, de: v => `, plus ${v.n} weitere Datei${v.n!==1?'en':''} in "Zu sortieren" freigeschaltet`, es: v => `, más ${v.n} archivo${v.n!==1?'s':''} desbloqueado${v.n!==1?'s':''} en "Por ordenar"`, zh: v => `,另有 ${v.n} 个文件已在"待整理"中解锁` },
  frPeoplePhrase: { en: v => `, ${v.n} tagged to someone`, fr: v => `, ${v.n} associée${v.n!==1?'s':''} à quelqu'un`, de: v => `, ${v.n} einer Person zugeordnet`, es: v => `, ${v.n} asociada${v.n!==1?'s':''} a alguien`, zh: v => `,其中 ${v.n} 张已关联到某人` },
  frDoneTitle: { en: "You're set up!", fr: 'Tout est configuré !', de: 'Alles eingerichtet!', es: '¡Todo listo!', zh: '设置完成!' },
  frDoneBody: {
    en: v => `${v.n} photo${v.n!==1?'s':''} added${v.tripPhrase}${v.peoplePhrase}${v.unlockPhrase}. They're still in <strong>To Sort</strong> - that's on purpose: camera and location still need confirming there (Guided Sort can help). Leave them until you're fully done with a batch; nothing here is lost if you stop and come back later.`,
    fr: v => `${v.n} photo${v.n!==1?'s':''} ajoutée${v.n!==1?'s':''}${v.tripPhrase}${v.peoplePhrase}${v.unlockPhrase}. Elles sont encore dans <strong>"À trier"</strong> - c'est voulu : la caméra et le lieu doivent encore y être confirmés (le Tri guidé peut vous aider). Laissez-les tant que vous n'avez pas fini un lot ; rien n'est perdu ici si vous vous arrêtez et revenez plus tard.`,
    de: v => `${v.n} Foto${v.n!==1?'s':''} hinzugefügt${v.tripPhrase}${v.peoplePhrase}${v.unlockPhrase}. Sie befinden sich noch in <strong>"Zu sortieren"</strong> - das ist Absicht: Kamera und Standort müssen dort noch bestätigt werden (Geführtes Sortieren kann helfen). Lassen Sie sie dort, bis Sie mit einem Stapel ganz fertig sind; hier geht nichts verloren, wenn Sie aufhören und später zurückkommen.`,
    es: v => `${v.n} foto${v.n!==1?'s':''} añadida${v.n!==1?'s':''}${v.tripPhrase}${v.peoplePhrase}${v.unlockPhrase}. Siguen en <strong>"Por ordenar"</strong> - es intencionado: ahí falta confirmar cámara y ubicación (el Orden guiado puede ayudarte). Déjalas ahí hasta que termines del todo con un lote; nada se pierde aquí si te detienes y vuelves más tarde.`,
    zh: v => `已添加 ${v.n} 张照片${v.tripPhrase}${v.peoplePhrase}${v.unlockPhrase}。它们仍在<strong>"待整理"</strong>中——这是有意为之:相机和地点信息还需要在那里确认("引导整理"可以帮忙)。在完全处理完一批照片之前先留在那里;即使中途停止、以后再回来,这里的内容也不会丢失。`
  },
  frAddAnotherTrip: { en: '➕ Add another trip', fr: '➕ Ajouter un autre voyage', de: '➕ Weitere Reise hinzufügen', es: '➕ Añadir otro viaje', zh: '➕ 添加另一趟旅行' },
  frViewTrip: { en: 'View your trip', fr: 'Voir votre voyage', de: 'Ihre Reise ansehen', es: 'Ver tu viaje', zh: '查看你的旅行' },
  frBrowseLibrary: { en: 'Browse your library', fr: 'Parcourir votre bibliothèque', de: 'Ihre Bibliothek durchsuchen', es: 'Explorar tu biblioteca', zh: '浏览你的照片库' },
  frFinishToSort: { en: '📥 Finish in To Sort →', fr: '📥 Terminer dans "À trier" →', de: '📥 In "Zu sortieren" abschließen →', es: '📥 Terminar en "Por ordenar" →', zh: '📥 前往"待整理"完成 →' },
  frTipsTitle: { en: '💡 A few things worth knowing', fr: '💡 Quelques infos utiles à connaître', de: '💡 Ein paar nützliche Dinge', es: '💡 Algunas cosas útiles que saber', zh: '💡 一些值得了解的小提示' },
  frTipFindDuplicates: { en: '🔁 Find Duplicates & Edits', fr: '🔁 Trouver doublons et retouches', de: '🔁 Duplikate & Bearbeitungen finden', es: '🔁 Buscar duplicados y ediciones', zh: '🔁 查找重复和编辑版本' },
  frTipExploreGlobe: { en: '🌍 Explore the Globe', fr: '🌍 Explorer le Globe', de: '🌍 Globus entdecken', es: '🌍 Explorar el Globo', zh: '🌍 探索地球视图' },
  frTipSearch: {
    en: 'Search finds photos by what\'s actually in them, not just the filename, try typing something like "birthday cake" in the search bar.',
    fr: 'La recherche trouve les photos d\'après leur contenu réel, pas seulement leur nom de fichier ; essayez de taper quelque chose comme « gâteau d\'anniversaire » dans la barre de recherche.',
    de: 'Die Suche findet Fotos anhand ihres tatsächlichen Inhalts, nicht nur des Dateinamens - versuchen Sie, etwas wie „Geburtstagskuchen" in die Suchleiste einzugeben.',
    es: 'La búsqueda encuentra fotos por lo que realmente contienen, no solo por el nombre del archivo; prueba a escribir algo como "tarta de cumpleaños" en la barra de búsqueda.',
    zh: '搜索功能能根据照片实际内容查找,而不仅仅是文件名——试着在搜索框中输入类似"生日蛋糕"这样的词试试。'
  },
  frTipBestOf: {
    en: '⭐ Add your favorites to <strong>Best Of</strong> (right-click any photo) to build a highlight reel separate from the full library.',
    fr: '⭐ Ajoutez vos favoris à <strong>Meilleures photos</strong> (clic droit sur n\'importe quelle photo) pour créer une sélection à part de la bibliothèque complète.',
    de: '⭐ Fügen Sie Ihre Favoriten zu <strong>Bestenliste</strong> hinzu (Rechtsklick auf ein beliebiges Foto), um eine Highlight-Auswahl getrennt von der vollständigen Bibliothek zu erstellen.',
    es: '⭐ Añade tus favoritas a <strong>Lo mejor</strong> (clic derecho en cualquier foto) para crear una selección destacada aparte de la biblioteca completa.',
    zh: '⭐ 将喜欢的照片添加到<strong>精选</strong>(在任意照片上右键点击),即可建立一个独立于完整照片库的精彩集锦。'
  },
  frTipTagMore: {
    en: "The more you tag now - people, categories, trips - the easier everything is to find later. It doesn't have to be all at once.",
    fr: 'Plus vous étiquetez maintenant - personnes, catégories, voyages - plus tout sera facile à retrouver ensuite. Pas besoin de tout faire d\'un coup.',
    de: 'Je mehr Sie jetzt markieren - Personen, Kategorien, Reisen -, desto leichter finden Sie später alles wieder. Es muss nicht alles auf einmal sein.',
    es: 'Cuanto más etiquetes ahora - personas, categorías, viajes -, más fácil será encontrarlo todo después. No hace falta hacerlo todo de golpe.',
    zh: '现在打的标签越多——人物、分类、旅行——以后查找就越轻松。不必一次性全部完成。'
  },
  frTipToSort: {
    en: "It's fine to leave photos in <strong>To Sort</strong> - especially ones with no date or location, which are the hardest to auto-sort. Come back to them any time.",
    fr: 'Il est tout à fait normal de laisser des photos dans <strong>"À trier"</strong> - surtout celles sans date ni lieu, les plus difficiles à trier automatiquement. Revenez-y quand vous voulez.',
    de: 'Es ist völlig in Ordnung, Fotos in <strong>"Zu sortieren"</strong> zu lassen - besonders solche ohne Datum oder Standort, die am schwersten automatisch zu sortieren sind. Kommen Sie jederzeit darauf zurück.',
    es: 'No pasa nada por dejar fotos en <strong>"Por ordenar"</strong> - sobre todo las que no tienen fecha ni ubicación, que son las más difíciles de ordenar automáticamente. Vuelve a ellas cuando quieras.',
    zh: '把照片留在<strong>"待整理"</strong>中完全没问题——尤其是那些没有日期或地点信息、最难自动整理的照片。你可以随时回来处理。'
  },
  frTipColors: {
    en: "Give trips and other folders distinct <strong>colors</strong> so they're easy to spot at a glance in the sidebar and on the Globe.",
    fr: 'Donnez aux voyages et autres dossiers des <strong>couleurs</strong> distinctes pour les repérer facilement d\'un coup d\'œil dans la barre latérale et sur le Globe.',
    de: 'Geben Sie Reisen und anderen Ordnern unterschiedliche <strong>Farben</strong>, damit Sie sie in der Seitenleiste und auf dem Globus auf einen Blick erkennen.',
    es: 'Dale a los viajes y otras carpetas <strong>colores</strong> distintos para reconocerlos de un vistazo en la barra lateral y en el Globo.',
    zh: '为不同的旅行和文件夹设置不同的<strong>颜色</strong>,这样在侧边栏和地球视图中就能一眼认出。'
  },
  // Wizard toasts
  frToastAlreadyInLibrary: { en: 'ℹ️ Already in library', fr: 'ℹ️ Déjà dans la bibliothèque', de: 'ℹ️ Bereits in der Bibliothek', es: 'ℹ️ Ya está en la biblioteca', zh: 'ℹ️ 已存在于照片库中' },
  frToastAddedDeferred: { en: v => `✅ Added ${v.added} for this walkthrough, +${v.deferred} queued in To Sort`, fr: v => `✅ ${v.added} ajoutée${v.added!==1?'s':''} pour cette visite guidée, +${v.deferred} en attente dans "À trier"`, de: v => `✅ ${v.added} für diese Einführung hinzugefügt, +${v.deferred} in "Zu sortieren"`, es: v => `✅ ${v.added} añadida${v.added!==1?'s':''} para este recorrido, +${v.deferred} en cola en "Por ordenar"`, zh: v => `✅ 已为本次引导添加 ${v.added} 张,另有 ${v.deferred} 张在"待整理"中排队` },
  frToastAdded: { en: v => `✅ Added ${v.n} file${v.n!==1?'s':''}`, fr: v => `✅ ${v.n} fichier${v.n!==1?'s':''} ajouté${v.n!==1?'s':''}`, de: v => `✅ ${v.n} Datei${v.n!==1?'en':''} hinzugefügt`, es: v => `✅ ${v.n} archivo${v.n!==1?'s':''} añadido${v.n!==1?'s':''}`, zh: v => `✅ 已添加 ${v.n} 个文件` },
  frToastNoPaths: { en: '⚠️ Could not read file paths', fr: '⚠️ Impossible de lire les chemins des fichiers', de: '⚠️ Dateipfade konnten nicht gelesen werden', es: '⚠️ No se pudieron leer las rutas de los archivos', zh: '⚠️ 无法读取文件路径' },
  frToastDupCopyFailed: { en: "⚠️ Couldn't create a demo copy, skipping this one", fr: '⚠️ Impossible de créer une copie de démonstration, cette étape est ignorée', de: '⚠️ Demo-Kopie konnte nicht erstellt werden, dieser Schritt wird übersprungen', es: '⚠️ No se pudo crear una copia de demostración, se omite este paso', zh: '⚠️ 无法创建演示副本,跳过此步骤' },
  // Wizard shell (index.html)
  frWizardTitle: { en: '🚀 Getting Started', fr: '🚀 Prise en main', de: '🚀 Erste Schritte', es: '🚀 Primeros pasos', zh: '🚀 快速上手' },
  frWizardExit: { en: '✕ Exit', fr: '✕ Quitter', de: '✕ Beenden', es: '✕ Salir', zh: '✕ 退出' },
  // Settings modal
  settingsTitle: { en: '⚙️ Settings', fr: '⚙️ Paramètres', de: '⚙️ Einstellungen', es: '⚙️ Ajustes', zh: '⚙️ 设置' },
  settingsAppearance: { en: 'Appearance', fr: 'Apparence', de: 'Erscheinungsbild', es: 'Apariencia', zh: '外观' },
  settingsLanguage: { en: 'Language', fr: 'Langue', de: 'Sprache', es: 'Idioma', zh: '语言' },
  settingsHelp: { en: 'Help', fr: 'Aide', de: 'Hilfe', es: 'Ayuda', zh: '帮助' },
  settingsGettingStartedTitle: { en: 'Add a trip, the guided way - walks you through creating it, adding photos, and tagging people', fr: 'Ajouter un voyage, étape par étape - création, ajout de photos et identification des personnes', de: 'Eine Reise anlegen, Schritt für Schritt - Erstellen, Fotos hinzufügen und Personen markieren', es: 'Añadir un viaje, paso a paso - crearlo, añadir fotos y etiquetar personas', zh: '按引导添加旅程 - 创建、添加照片并标记人物' },
  settingsGettingStartedHint: { en: 'Walks you through creating a trip, adding photos to it, and tagging the people in them.', fr: 'Vous guide pour créer un voyage, y ajouter des photos et identifier les personnes.', de: 'Führt Sie durch das Anlegen einer Reise, das Hinzufügen von Fotos und das Markieren von Personen.', es: 'Te guía para crear un viaje, añadirle fotos y etiquetar a las personas.', zh: '引导你创建旅程、添加照片并标记其中的人物。' },
  settingsViewBackups: { en: '🗄️ View Backups', fr: '🗄️ Voir les sauvegardes', de: '🗄️ Sicherungen anzeigen', es: '🗄️ Ver copias de seguridad', zh: '🗄️ 查看备份' },
  settingsViewBackupsTitle: { en: 'View and restore backups', fr: 'Voir et restaurer les sauvegardes', de: 'Sicherungen anzeigen und wiederherstellen', es: 'Ver y restaurar copias de seguridad', zh: '查看并恢复备份' },
  settingsHiddenSections: { en: 'Hidden sidebar sections', fr: 'Sections masquées de la barre latérale', de: 'Ausgeblendete Seitenleistenbereiche', es: 'Secciones ocultas de la barra lateral', zh: '隐藏的侧边栏分区' },
  settingsHiddenSectionsHint: {
    en: 'Right-click Trips, People, Categories, Cameras or Location in the sidebar to hide it - nothing inside is touched, bring it back here anytime.',
    fr: 'Faites un clic droit sur Voyages, Personnes, Catégories, Appareils ou Lieux dans la barre latérale pour le masquer - rien à l\'intérieur n\'est modifié, vous pouvez le réafficher ici à tout moment.',
    de: 'Klicken Sie mit der rechten Maustaste auf Reisen, Personen, Kategorien, Kameras oder Standort in der Seitenleiste, um sie auszublenden - nichts darin wird verändert, Sie können sie hier jederzeit wiederherstellen.',
    es: 'Haz clic derecho en Viajes, Personas, Categorías, Cámaras o Ubicación en la barra lateral para ocultarlo - nada de su contenido se toca, puedes recuperarlo aquí en cualquier momento.',
    zh: '在侧边栏的旅行、人物、分类、相机或地点上点击右键即可隐藏——内部内容不会受影响,随时可以在此处恢复。'
  },
  settingsNothingHidden: { en: 'Nothing hidden.', fr: "Rien n'est masqué.", de: 'Nichts ausgeblendet.', es: 'No hay nada oculto.', zh: '没有隐藏的内容。' },
  settingsShow: { en: 'Show', fr: 'Afficher', de: 'Anzeigen', es: 'Mostrar', zh: '显示' },
  settingsAllowDelete: { en: 'Allow deleting files from disk', fr: 'Autoriser la suppression des fichiers du disque', de: 'Löschen von Dateien von der Festplatte zulassen', es: 'Permitir eliminar archivos del disco', zh: '允许从磁盘删除文件' },
  settingsAllowDeleteHint: {
    en: 'When off, every "delete from disk" action in Trove (bulk delete, Duplicate/Burst review, the photo viewer) is turned off. Removing a shortcut from the library - which never touches the real file - is unaffected.',
    fr: 'Une fois désactivé, toute action « supprimer du disque » dans Trove (suppression groupée, révision des doublons/rafales, visionneuse) est désactivée. Retirer un raccourci de la bibliothèque - ce qui ne touche jamais le fichier réel - n\'est pas concerné.',
    de: 'Wenn deaktiviert, wird jede „Von der Festplatte löschen"-Aktion in Trove (Massenlöschung, Duplikat-/Serienbild-Überprüfung, Fotoansicht) deaktiviert. Das Entfernen einer Verknüpfung aus der Bibliothek - was die eigentliche Datei nie berührt - ist davon nicht betroffen.',
    es: 'Cuando está desactivado, se desactiva toda acción "eliminar del disco" en Trove (eliminación masiva, revisión de duplicados/ráfagas, el visor de fotos). Quitar un acceso directo de la biblioteca - que nunca toca el archivo real - no se ve afectado.',
    zh: '关闭后,Trove 中所有"从磁盘删除"的操作(批量删除、重复项/连拍审查、照片查看器)都会被禁用。从照片库中移除快捷方式——不会影响真实文件本身——不受此设置影响。'
  },
  settingsTelemetry: { en: 'Help improve Trove', fr: 'Aider à améliorer Trove', de: 'Trove verbessern helfen', es: 'Ayudar a mejorar Trove', zh: '帮助改进 Trove' },
  settingsTelemetryHint: {
    en: 'Sends a small anonymous ping when the app opens/closes: a random install id (not linked to your name or email, renewed every 13 months), session length, and rough counts (files, folders, favorites). Never your file names, paths, photos, or locations. Stored with Google Firebase and deleted after 25 months. Off any time, right here.',
    fr: 'Envoie un petit signal anonyme à l\'ouverture/fermeture de l\'application : un identifiant d\'installation aléatoire (non lié à votre nom ni à votre e-mail, renouvelé tous les 13 mois), la durée de session, et des comptages approximatifs (fichiers, dossiers, favoris). Jamais vos noms de fichiers, chemins, photos ni lieux. Stocké chez Google Firebase et supprimé après 25 mois. Désactivable à tout moment, ici même.',
    de: 'Sendet beim Öffnen/Schließen der App ein kleines anonymes Signal: eine zufällige Installations-ID (nicht mit Ihrem Namen oder Ihrer E-Mail verknüpft, alle 13 Monate erneuert), Sitzungsdauer und grobe Zählungen (Dateien, Ordner, Favoriten). Niemals Ihre Dateinamen, Pfade, Fotos oder Orte. Gespeichert bei Google Firebase und nach 25 Monaten gelöscht. Jederzeit hier deaktivierbar.',
    es: 'Envía una pequeña señal anónima al abrir/cerrar la app: un id de instalación aleatorio (no vinculado a tu nombre ni a tu email, renovado cada 13 meses), la duración de la sesión y recuentos aproximados (archivos, carpetas, favoritos). Nunca tus nombres de archivo, rutas, fotos ni ubicaciones. Se guarda en Google Firebase y se borra a los 25 meses. Se puede desactivar aquí mismo en cualquier momento.',
    zh: '在应用打开/关闭时发送一个小型匿名信号:一个随机的安装 ID(与你的姓名或邮箱无关,每 13 个月更换一次)、会话时长以及大致统计数据(文件数、文件夹数、收藏数)。绝不会包含你的文件名、路径、照片或位置。数据存储在 Google Firebase,25 个月后删除。可随时在此关闭。'
  },
  telemetryNotice: {
    en: 'Help improve Trove? If you say yes, it sends an anonymous usage ping (a random install id, session length and library counts). Never your photos, file names or locations. Off unless you choose it, and you can change it any time in Settings.',
    fr: 'Aider à améliorer Trove ? Si vous acceptez, il envoie un signal d\'utilisation anonyme (un identifiant d\'installation aléatoire, la durée de session et des comptages de la bibliothèque). Jamais vos photos, noms de fichiers ni lieux. Désactivé sauf si vous l\'activez, modifiable à tout moment dans les Paramètres.',
    de: 'Trove verbessern helfen? Wenn Sie zustimmen, sendet es ein anonymes Nutzungssignal (eine zufällige Installations-ID, die Sitzungsdauer und Bibliothekszahlen). Niemals Ihre Fotos, Dateinamen oder Orte. Aus, solange Sie es nicht einschalten, jederzeit in den Einstellungen änderbar.',
    es: '¿Ayudar a mejorar Trove? Si aceptas, envía una señal de uso anónima (un id de instalación aleatorio, la duración de la sesión y recuentos de la biblioteca). Nunca tus fotos, nombres de archivo ni ubicaciones. Desactivado salvo que lo elijas, y puedes cambiarlo cuando quieras en Ajustes.',
    zh: '帮助改进 Trove?如果你同意,它会发送匿名使用信号(随机安装 ID、会话时长和照片库数量统计)。绝不包含你的照片、文件名或位置。除非你选择开启,否则保持关闭,可随时在设置中更改。'
  },
  telemetryNoticeOk: { en: 'Yes, share', fr: 'Oui, partager', de: 'Ja, teilen', es: 'Sí, compartir', zh: '好的,分享' },
  telemetryNoticeOff: { en: 'No thanks', fr: 'Non merci', de: 'Nein danke', es: 'No, gracias', zh: '不用了' },
  privacyPolicy: { en: 'Privacy policy', fr: 'Politique de confidentialité', de: 'Datenschutzerklärung', es: 'Política de privacidad', zh: '隐私政策' },
  privacyPolicyLink: { en: 'Privacy policy →', fr: 'Politique de confidentialité →', de: 'Datenschutzerklärung →', es: 'Política de privacidad →', zh: '隐私政策 →' },
  settingsCancel: { en: 'Cancel', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar', zh: '取消' },
  settingsSave: { en: 'Save', fr: 'Enregistrer', de: 'Speichern', es: 'Guardar', zh: '保存' },
  settingsSavedToast: { en: '⚙️ Settings saved', fr: '⚙️ Paramètres enregistrés', de: '⚙️ Einstellungen gespeichert', es: '⚙️ Ajustes guardados', zh: '⚙️ 设置已保存' },
  themeAuto: { en: '🖥️ Theme: Auto', fr: '🖥️ Thème : Auto', de: '🖥️ Design: Automatisch', es: '🖥️ Tema: Automático', zh: '🖥️ 主题:自动' },
  themeLight: { en: '☀️ Theme: Light', fr: '☀️ Thème : Clair', de: '☀️ Design: Hell', es: '☀️ Tema: Claro', zh: '☀️ 主题:浅色' },
  themeDark: { en: '🌙 Theme: Dark', fr: '🌙 Thème : Sombre', de: '🌙 Design: Dunkel', es: '🌙 Tema: Oscuro', zh: '🌙 主题:深色' },
  themeToggleTitle: { en: "Click to switch between matching your computer's setting, Light, and Dark", fr: "Cliquez pour basculer entre le réglage de votre ordinateur, Clair et Sombre", de: 'Klicken Sie, um zwischen der Einstellung Ihres Computers, Hell und Dunkel zu wechseln', es: 'Haz clic para alternar entre la configuración de tu ordenador, Claro y Oscuro', zh: '点击可在跟随系统设置、浅色和深色之间切换' },

  // Photo preview: dragging the file out
  popupZoomHint: { en: '🔍 Scroll to zoom · Drag the photo out to another app · Zoomed in, drag to pan', fr: "🔍 Molette pour zoomer · Glissez la photo vers une autre application · En zoom, glissez pour vous déplacer", de: '🔍 Scrollen zum Zoomen · Foto in eine andere App ziehen · Gezoomt: ziehen zum Verschieben', es: '🔍 Rueda para hacer zoom · Arrastra la foto a otra aplicación · Con zoom, arrastra para moverte', zh: '🔍 滚动缩放 · 将照片拖到其他应用 · 放大后拖动可平移' },
  popupDragFile: { en: 'Drag file', fr: 'Glisser le fichier', de: 'Datei ziehen', es: 'Arrastrar archivo', zh: '拖出文件' },
  popupDragTitle: { en: 'Drag this file into another app, an email or a folder, without closing the preview. You can also drag the photo itself.', fr: "Faites glisser ce fichier vers une autre application, un e-mail ou un dossier, sans fermer l'aperçu. Vous pouvez aussi faire glisser la photo elle-même.", de: 'Ziehen Sie diese Datei in eine andere App, eine E-Mail oder einen Ordner, ohne die Vorschau zu schließen. Sie können auch das Foto selbst ziehen.', es: 'Arrastra este archivo a otra aplicación, un correo o una carpeta sin cerrar la vista previa. También puedes arrastrar la propia foto.', zh: '无需关闭预览,即可将此文件拖到其他应用、邮件或文件夹中。也可以直接拖动照片本身。' }
};

// A folder's icon is normally an emoji string, but folder.iconImage (a data URL, set via the
// New Folder modal's "Use image as icon" upload) lets someone use an actual logo/photo instead -
// this is the one place that decides which of the two to render, so every call site (sidebar
// rows, section headers, Guided Sort's category chips) stays in sync automatically.
// People used to get cartoon avatars; they're shown by real photos of their faces now (see
// faceIndex.js). This drops what the avatars left on person folders. A picture someone set
// themselves is kept - only the generated cartoon ones (SVG) go.
function removeAvatarLeftovers() {
  let changed = false;
  for (const f of appData.folders) {
    if (!('avatar' in f || 'avatarAuto' in f || 'avatarOff' in f || 'avatarFaceCount' in f)) continue;
    if (typeof f.iconImage === 'string' && f.iconImage.startsWith('data:image/svg')) delete f.iconImage;
    delete f.avatar; delete f.avatarAuto; delete f.avatarOff; delete f.avatarFaceCount;
    changed = true;
  }
  if (changed) saveData();
}
function folderIconHtml(folder, size) {
  size = size || 16;
  // People get round pictures - a face reads as a person, not a logo.
  const round = folder?.parentId === PEOPLE_ROOT_ID;
  const img = round && typeof personPictureUrl === 'function' ? personPictureUrl(folder) : folder?.iconImage;
  if (img) return `<img src="${img}" alt="" style="width:${size}px;height:${size}px;border-radius:${round ? '50%' : '4px'};object-fit:cover;vertical-align:-3px;flex-shrink:0">`;
  return esc(folderEmoji(folder));
}

// Trips, Adventures, People and Cameras (their roots and everything under them) carry no emoji:
// the sidebar section icon and the folder's colour dot already identify them, and a beach/face/
// camera emoji on every row was noise. Any stale folder.icon from older saves is just ignored.
function isEmojiFreeFolder(folder) {
  for (let f = folder, hops = 0; f && hops < 50; f = appData.folders.find(p => p.id === f.parentId), hops++) {
    if (f.parentId) continue;
    return f.id === VACATIONS_ROOT_ID || f.id === ADVENTURES_ROOT_ID || f.id === PEOPLE_ROOT_ID || f.name === 'Cameras';
  }
  return false;
}
function folderEmoji(folder) {
  return isEmojiFreeFolder(folder) ? '' : (folder?.icon || '📁');
}
// "🏷️ Name" for folders that keep an emoji, just "Name" for the emoji-free ones above.
function folderEmojiPrefix(folder) {
  const e = folderEmoji(folder);
  return e ? e + ' ' : '';
}

// No node 'path' module in the renderer (contextIsolation) - small string-based stand-ins.
function pathDirname(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i === -1 ? '' : p.slice(0, i); }
function pathBasename(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i === -1 ? p : p.slice(i + 1); }
function pathExtname(p) { const b = pathBasename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i); }

function countryFlag(code) {
  if (!code || code.length !== 2) return '🌍';
  const off = 0x1F1E6 - 65;
  return String.fromCodePoint(off + code.charCodeAt(0)) + String.fromCodePoint(off + code.charCodeAt(1));
}

// ── LAZY THUMBNAILS ──────────────────────────────────────────────────────────
let thumbObserver = null;
let thumbsLoading = 0;
const THUMB_CONCURRENT = 8;
const thumbPendingQueue = [];

function makeThumbObserver() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      obs.unobserve(el);
      const fileId = el.dataset.thumbFor;
      if (!fileId) return;
      const file = appData.files.find(f => f.id === fileId);
      if (file) enqueueThumb(file, el);
    });
  }, { rootMargin: '600px 0px' });
  return obs;
}

function initThumbObserver() {
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = makeThumbObserver();
}

// Guided Sort gets its own observer, separate from the main library's - saveData()
// re-renders #fileArea (and re-inits thumbObserver) even while the wizard modal is
// open on top of it, and that used to silently kill every thumbnail the wizard's
// grid was mid-observing (e.g. right after confirming a location on the globe).
let gsThumbObserver = null;
function gsObserveThumb(el) {
  if (!gsThumbObserver) gsThumbObserver = makeThumbObserver();
  gsThumbObserver.observe(el);
}

function enqueueThumb(file, el) {
  thumbPendingQueue.push({ file, el });
  drainThumbQueue();
}

function drainThumbQueue() {
  while (thumbsLoading < THUMB_CONCURRENT && thumbPendingQueue.length > 0) {
    const { file, el } = thumbPendingQueue.shift();
    thumbsLoading++;
    getThumb(file).then(url => {
      thumbsLoading--;
      if (el.isConnected) {
        el.classList.remove('thumb-loading');
        if (url) {
          el.innerHTML = `<img src="${url}" alt="" decoding="async"/>`;
          if (isVid(file.ext)) el.innerHTML += '<div class="video-badge">▶ VIDEO</div>';
        }
      }
      drainThumbQueue();
    });
  }
}

// Top-centre "360°" pill on cards for Insta360 footage (is360File is in viewer360.js). Goes on
// the card itself, not inside data-thumb-for, which drainThumbQueue overwrites on load.
function badge360Html(file) {
  if (!is360File(file)) return '';
  return '<div class="badge-360" title="360° media"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/></svg>360°</div>';
}

function observeThumb(el) {
  if (thumbObserver) thumbObserver.observe(el);
}

// ── ROTATION ─────────────────────────────────────────────────────────────────
// file.rotation (0/90/180/270, clockwise) never touches the file on disk - it's baked
// into whatever bitmap this app itself displays (thumbnail/preview canvases below, and
// the photo editor's own source canvas), the same "shortcut only" spirit as everything
// else Trove does. Opening the file externally still shows it exactly as taken.
function drawRotatedToCanvas(img, rotationDeg) {
  const rotation = ((rotationDeg || 0) % 360 + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return canvas;
}

function rotateDataUrl(dataUrl, rotation) {
  return new Promise(resolve => {
    if (!rotation) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => resolve(drawRotatedToCanvas(img, rotation).toDataURL('image/jpeg', 0.92));
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function bumpRotation(file, delta = 90) {
  file.rotation = (((file.rotation || 0) + delta) % 360 + 360) % 360;
  delete thumbCache[file.id];
  delete previewCache[file.id];
  delete hiresCache[file.id];
}

async function rotateFile(fileId) {
  const file = appData.files.find(f => f.id === fileId);
  if (!file || !isMedia(file.ext)) return;
  bumpRotation(file);
  await saveData();
  if (popupClusterFiles[popupClusterIndex]?.id === file.id) renderPopupFile();
}

// Context menu can act on the whole selection, not just the right-clicked file - rotating
// a batch of sideways photos together is the common case, not rotating one at a time.
async function ctxRotate() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  const targets = ids.map(id => appData.files.find(f => f.id === id)).filter(f => f && isMedia(f.ext));
  if (!targets.length) return;
  targets.forEach(bumpRotation);
  await saveData();
  if (targets.some(f => popupClusterFiles[popupClusterIndex]?.id === f.id)) renderPopupFile();
  toast(`↻ Rotated ${targets.length} file${targets.length!==1?'s':''}`);
}

// Uses OS native thumbnail provider via main process - persisted to disk cache.
// First open: OS generates thumbnail (fast, off renderer thread).
// All subsequent opens: instant disk cache read.
const THUMB_CACHE_MAX = 500;
const thumbCacheOrder = []; // insertion order for LRU eviction
// file.id -> Promise of the load in progress. A grid re-rendered mid-load (saveData redraws
// #fileArea) asks again for the same thumbnails; without this the second ask raced the first,
// found rendererThumb already tried, and left those cards empty even though the first ask
// went on to succeed - every thumbnail made by the renderer (HEIC without a built-in preview,
// WebP, AVIF, some videos) could lose it.
const thumbInflight = new Map();

function getThumb(file) {
  if (thumbCache[file.id]) return Promise.resolve(thumbCache[file.id]);
  if (!thumbInflight.has(file.id)) thumbInflight.set(file.id, loadThumb(file).finally(() => thumbInflight.delete(file.id)));
  return thumbInflight.get(file.id);
}

async function loadThumb(file) {
  const b64 = await window.api.getThumb(file.id, file.path).catch(() => null);
  const raw = b64 ? `data:image/jpeg;base64,${b64}` : await rendererThumb(file);
  if (!raw) return null;
  thumbCache[file.id] = file.rotation ? await rotateDataUrl(raw, file.rotation) : raw;
  thumbCacheOrder.push(file.id);
  while (thumbCacheOrder.length > THUMB_CACHE_MAX) {
    delete thumbCache[thumbCacheOrder.shift()];
  }
  return thumbCache[file.id];
}

// When neither the OS nor a RAW's embedded preview could make a thumbnail (see renderStill in
// main.js), Chromium gets a go: it decodes WebP/AVIF/GIF/BMP/ICO on any machine, and can pull a
// frame out of any video it can play. main.js caches the result like an OS thumbnail, so this
// runs once per file, and at most two at a time - a grid full of them would otherwise open
// dozens of <video> elements at once.
// A HEIC lands here only when it has no small preview built in (iPhone-edited IMG_E photos):
// the GPU decodes it (heicGpuImage), else main does it in software.
const RENDERER_THUMB_MAX = 480;
const rendererThumbTried = new Set();
let rendererThumbActive = 0;
const rendererThumbQueue = [];
async function rendererThumb(file) {
  const ext = (file.ext || '').toLowerCase();
  if (file._missing || rendererThumbTried.has(file.id)) return null;
  const heic = TroveMedia.HEIF.has(ext) && !TroveMedia.BROWSER_IMAGE.has(ext);
  if (!TroveMedia.BROWSER_IMAGE.has(ext) && !isVid(ext) && !heic) return null;
  rendererThumbTried.add(file.id);
  if (rendererThumbActive >= 2) await new Promise(res => rendererThumbQueue.push(res));
  rendererThumbActive++;
  try {
    if (heic) {
      const b64 = await fetchPreviewBase64(file, RENDERER_THUMB_MAX);
      if (!b64) return null;
      window.api.cacheThumb(file.id, b64).catch(() => {});
      return `data:image/jpeg;base64,${b64}`;
    }
    const src = pathToFileUrl(file.path);
    const canvas = isVid(ext) ? await thumbFromVideo(src) : await thumbFromImage(src);
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    window.api.cacheThumb(file.id, dataUrl.slice(dataUrl.indexOf(',') + 1)).catch(() => {});
    return dataUrl;
  } catch (e) {
    return null;
  } finally {
    rendererThumbActive--;
    rendererThumbQueue.shift()?.();
  }
}
function thumbCanvasFrom(src, sw, sh) {
  const k = Math.min(1, RENDERER_THUMB_MAX / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function thumbFromImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? thumbCanvasFrom(img, img.naturalWidth, img.naturalHeight) : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
// A frame a tenth of the way in, capped at 3s - the very first frame is so often black.
function thumbFromVideo(src) {
  return new Promise(resolve => {
    const vid = document.createElement('video');
    let done = false;
    const finish = canvas => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      vid.removeAttribute('src'); vid.load();
      resolve(canvas);
    };
    const timer = setTimeout(() => finish(null), 10000);
    vid.muted = true;
    vid.preload = 'auto';
    const grab = () => finish(vid.videoWidth ? thumbCanvasFrom(vid, vid.videoWidth, vid.videoHeight) : null);
    vid.onloadedmetadata = () => {
      if (!vid.videoWidth) { finish(null); return; } // audio only here: no decoder for its picture
      const t = Math.min(3, (vid.duration || 0) * 0.1);
      if (t > 0) vid.currentTime = t; else vid.onloadeddata = grab; // a zero-length seek never fires 'seeked'
    };
    vid.onseeked = grab;
    vid.onerror = () => finish(null);
    vid.src = src;
  });
}

// ── CUSTOM VIDEO THUMBNAILS ──────────────────────────────────────────────────
// A video's grid thumbnail is whatever frame the OS thumbnailer picked, often a black or blurry
// first frame. The user can replace it with the frame currently showing in the popup player
// (setPopupFrameAsThumb) or any image off disk (right-click > Set Thumbnail…). Saved as a small
// JPEG in the thumb cache (main.js's save-custom-thumb), which get-thumb serves ahead of the OS
// one; file.customThumb only records that one exists, for the menu's Reset item. Stored in the
// video's own unrotated orientation, so getThumb's file.rotation turn applies to it like any
// other thumb and it keeps following the video if it's rotated again later.
const CUSTOM_THUMB_MAX_DIM = 480;

// `src` (a <video> or <img>) scaled to thumbnail size, turned by `rot` degrees (a multiple of 90).
function customThumbCanvas(src, sw, sh, rot) {
  rot = (((rot || 0) % 360) + 360) % 360;
  const scale = Math.min(1, CUSTOM_THUMB_MAX_DIM / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const swap = rot === 90 || rot === 270;
  const c = document.createElement('canvas');
  c.width = swap ? h : w; c.height = swap ? w : h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

// Drops every cached copy of a file's thumbnail and reloads the ones on screen right now.
function refreshFileThumbs(file) {
  delete thumbCache[file.id];
  thumbInflight.delete(file.id); // a load started before the change would bring back the old look
  const i = thumbCacheOrder.indexOf(file.id);
  if (i !== -1) thumbCacheOrder.splice(i, 1);
  if (typeof forgetGlobeTile === 'function') forgetGlobeTile(file.id);
  document.querySelectorAll('[data-thumb-for]').forEach(el => {
    if (el.dataset.thumbFor === file.id) enqueueThumb(file, el);
  });
}

async function setCustomThumb(file, canvas) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) { toast('⚠️ Could not encode the thumbnail'); return false; }
  const ok = await window.api.saveCustomThumb(file.id, arrayBufferToBase64(await blob.arrayBuffer())).catch(() => false);
  if (!ok) { toast('⚠️ Could not save the thumbnail'); return false; }
  file.customThumb = true;
  persistQuiet();
  refreshFileThumbs(file);
  return true;
}

async function clearCustomThumb(file) {
  await window.api.clearCustomThumb(file.id).catch(() => {});
  delete file.customThumb;
  persistQuiet();
  refreshFileThumbs(file);
}

async function pickCustomThumb(file) {
  const res = await window.api.pickThumbnailImage(pathDirname(file.path)).catch(() => ({ error: 'read' }));
  if (!res) return; // dialog canceled
  const img = res.dataUrl && await new Promise(resolve => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = res.dataUrl;
  });
  if (!img || !img.naturalWidth) { toast('⚠️ Could not open that image'); return; }
  // Counter-turned by the video's rotation: getThumb turns it back, so it shows upright.
  if (await setCustomThumb(file, customThumbCanvas(img, img.naturalWidth, img.naturalHeight, -(file.rotation || 0)))) {
    toast('🖼 Thumbnail updated');
  }
}

// Popup player: the frame on screen right now becomes the video's thumbnail.
async function setPopupFrameAsThumb() {
  const vid = document.getElementById('photoPopupVideo');
  const file = appData.files.find(f => f.id === popupFileId);
  if (!vid || !file || !isVid(file.ext) || !vid.videoWidth) { toast('⚠️ The video has not loaded a frame yet'); return; }
  vid.pause();
  if (await setCustomThumb(file, customThumbCanvas(vid, vid.videoWidth, vid.videoHeight, 0))) {
    toast('🖼 Thumbnail set to this frame');
  }
}

// One menu for both ways to set a thumbnail (a frame from the video, or an imported image),
// plus going back to the automatic one. Opened from the popup's Thumbnail button, where
// "frame" means the one on screen, or from the right-click menu, where it opens the video so
// the user can pause on the frame they want. A video with no custom thumbnail just keeps the
// automatic OS one - nothing changes until one of these is picked.
let thumbMenuFileId = null;
let thumbMenuFromPopup = false;

function openThumbMenu(file, x, y, fromPopup, above) {
  thumbMenuFileId = file.id;
  thumbMenuFromPopup = fromPopup;
  const is360 = typeof is360File === 'function' && is360File(file);
  document.getElementById('thumbMenuStatus').textContent = file.customThumb ? 'Showing your custom thumbnail' : 'Showing the automatic thumbnail';
  // 360 footage plays in its own player (viewer360.js), not the popup <video> a frame is read from.
  document.getElementById('thumbMenuFrame').style.display = is360 ? 'none' : '';
  document.getElementById('thumbMenuFrameLabel').textContent = fromPopup ? 'Use current frame' : 'Pick a frame from the video…';
  document.getElementById('thumbMenuReset').style.display = file.customThumb ? '' : 'none';
  document.getElementById('thumbMenuResetSep').style.display = file.customThumb ? '' : 'none';
  const menu = document.getElementById('thumbMenu');
  menu.classList.add('open');
  positionCtxMenu(menu, x, above ? y - menu.offsetHeight - 6 : y);
}

function hideThumbMenu() { document.getElementById('thumbMenu')?.classList.remove('open'); }

function togglePopupThumbMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('thumbMenu');
  if (menu.classList.contains('open')) { hideThumbMenu(); return; }
  const file = appData.files.find(f => f.id === popupFileId);
  if (!file) return;
  const r = e.currentTarget.getBoundingClientRect();
  openThumbMenu(file, r.left, r.top, true, true);
}

function ctxThumbnail(e) {
  hideCtxMenu();
  const file = appData.files.find(f => f.id === ctxFileId);
  if (file && isVid(file.ext)) openThumbMenu(file, e.clientX, e.clientY, false, false);
}

function thumbMenuFile() { return appData.files.find(f => f.id === thumbMenuFileId); }

async function thumbMenuUseFrame() {
  hideThumbMenu();
  const file = thumbMenuFile();
  if (!file) return;
  if (thumbMenuFromPopup) { setPopupFrameAsThumb(); return; }
  await openMediaPopup(file);
  toast('⏸ Pause on the frame you want, then Thumbnail ▾ > Use current frame');
}

function thumbMenuImport() {
  hideThumbMenu();
  const file = thumbMenuFile();
  if (file) pickCustomThumb(file);
}

function thumbMenuReset() {
  hideThumbMenu();
  const file = thumbMenuFile();
  if (file?.customThumb) clearCustomThumb(file).then(() => toast('↺ Back to the automatic thumbnail'));
}

// Sharper preview for the full-size popup only - kept separate + much smaller-cached than
// thumbCache since these are ~5-15x the bytes. An edited photo gets the full-size render of its
// edits instead (see getPreviewImage), so the popup never shows unedited pixels as the "current" look.
const previewCache = {};
const PREVIEW_CACHE_MAX = 12;
const previewCacheOrder = [];
const PREVIEW_MAX_DIM = 1800; // same as main.js's default

// HEIC with no OS codec to lean on: the graphics card first (heicGpu.js, ~0.1s for a 12MP
// iPhone photo), and only then main, whose last resort is libheif in software (~0.75s).
// { base64, width, height } or null for anything else, or when the GPU can't.
async function heicGpuImage(file, maxDim, quality) {
  const ext = (file.ext || '').toLowerCase();
  if (!window.HeicGpu || !TroveMedia.HEIF.has(ext) || TroveMedia.BROWSER_IMAGE.has(ext)) return null;
  const r = await HeicGpu.decode(file.path, maxDim, quality);
  if (!r) return null;
  return { base64: arrayBufferToBase64(await r.blob.arrayBuffer()), width: r.width, height: r.height };
}
async function fetchPreviewBase64(file, maxDim) {
  const gpu = await heicGpuImage(file, maxDim, 0.88).catch(() => null);
  return gpu ? gpu.base64 : window.api.getPreviewImage(file.path, maxDim).catch(() => null);
}

// The editor's version of the same: the GPU for a HEIC, otherwise main's get-editable-image.
const EDIT_MAX_DIM = 4096; // same as main.js
async function loadEditableImage(file) {
  const gpu = await heicGpuImage(file, EDIT_MAX_DIM, 0.92).catch(() => null);
  if (gpu) return { base64: gpu.base64, mime: 'image/jpeg', downsampled: true, width: gpu.width, height: gpu.height };
  return window.api.getEditableImage(file.id, file.path);
}

// Main says so the first time it has to decode a whole HEIC in software (no OS codec, and the
// GPU path above couldn't), so a photo that takes a second to open doesn't look broken. Only
// on Windows: a Mac decodes HEIC itself, so it practically never gets here.
window.api.onHeicSlow?.(() => {
  if (window.api.platform !== 'win32') return;
  toast('ℹ️ This PC has no HEIC decoder, so Trove decodes iPhone photos itself and they take a moment to open. Installing "HEVC Video Extensions" from the Microsoft Store makes them faster.', 10000);
});

// An edited photo's look is what the editor saved on its way out (peSaveEditedThumbnail), at up
// to 4000px - it serves the zoomed-in view as well. Never the original file: that would show
// the photo without its edits. A photo edited before those were saved only has its 480px edited
// thumb, until it's next saved in the editor.
async function getPreviewImage(file) {
  if (previewCache[file.id]) return previewCache[file.id];
  const b64 = file.edits
    ? await window.api.getEditedPreview(file.id).catch(() => null)
    : await fetchPreviewBase64(file, PREVIEW_MAX_DIM);
  if (!b64) return file.edits ? getThumb(file) : null;
  const raw = `data:image/jpeg;base64,${b64}`;
  previewCache[file.id] = file.rotation ? await rotateDataUrl(raw, file.rotation) : raw;
  previewCacheOrder.push(file.id);
  while (previewCacheOrder.length > PREVIEW_CACHE_MAX) {
    delete previewCache[previewCacheOrder.shift()];
  }
  return previewCache[file.id];
}

// Even sharper render, fetched on-demand only once the user actually zooms in past 1x in the
// popup - keeps the common "just browse the folder" case fast (1800px preview) while still
// giving real detail to someone who zooms, without paying that bigger cost on every photo.
const hiresCache = {};
const HIRES_CACHE_MAX = 4;
const hiresCacheOrder = [];
const HIRES_MAX_DIM = 4000;

async function getHiresPreview(file) {
  if (file.edits) return getPreviewImage(file); // already full size, see getPreviewImage
  if (hiresCache[file.id]) return hiresCache[file.id];
  const b64 = await fetchPreviewBase64(file, HIRES_MAX_DIM);
  if (!b64) return null;
  const raw = `data:image/jpeg;base64,${b64}`;
  hiresCache[file.id] = file.rotation ? await rotateDataUrl(raw, file.rotation) : raw;
  hiresCacheOrder.push(file.id);
  while (hiresCacheOrder.length > HIRES_CACHE_MAX) {
    delete hiresCache[hiresCacheOrder.shift()];
  }
  return hiresCache[file.id];
}

// ── PAGINATION ───────────────────────────────────────────────────────────────
const PAGE_SIZE = 60;
let pageObserver = null;

function setupPageObserver(sentinel, allFiles, container, renderFn, startCount = PAGE_SIZE) {
  let rendered = startCount;
  if (pageObserver) pageObserver.disconnect();

  function loadNextBatch() {
    const batch = allFiles.slice(rendered, rendered + PAGE_SIZE);
    if (batch.length === 0) { pageObserver.disconnect(); return; }
    rendered += batch.length;
    renderFn(batch, container, true);
    if (rendered >= allFiles.length) { pageObserver.disconnect(); return; }
    // At a small enough card size (more columns per row), one batch's added height can
    // stay entirely within the observer's rootMargin, so the sentinel never crosses back
    // out of view and the browser never re-fires a fresh intersection event. Pagination
    // then silently stalls mid-scroll, even though more files remain. Checking the
    // sentinel's actual position after every batch and loading again immediately while
    // it's still in range keeps this going until it's genuinely off-screen.
    const rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 300) loadNextBatch();
  }

  pageObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadNextBatch();
  }, { rootMargin: '300px' });
  pageObserver.observe(sentinel);
}

// Recycles far off-screen Grid/List cards back to an empty same-size placeholder instead
// of keeping every rendered card's full DOM/thumbnail alive forever. setupPageObserver
// above only ever appends, so a long scroll session in a large library would otherwise
// leave the live DOM node count growing with no ceiling. The card/row element itself is
// never removed (only its innerHTML), so its data-file-id, class list, and click/dblclick/
// contextmenu listeners - all bound once at creation, closed over the file object rather
// than re-read from the DOM - stay intact and correct across evict/remount cycles, and the
// selection-diff in updateSelectionUI() keeps working on evicted cards unchanged.
let evictionObserver = null;
function setupEvictionObserver(populateFn) {
  if (evictionObserver) evictionObserver.disconnect();
  evictionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const el = entry.target;
      if (entry.isIntersecting) {
        if (el.dataset.evicted !== '1') continue;
        delete el.dataset.evicted;
        el.style.height = ''; el.style.width = '';
        const file = appData.files.find(f => f.id === el.dataset.fileId);
        if (file) populateFn(el, file);
      } else if (el.dataset.evicted !== '1') {
        const rect = el.getBoundingClientRect();
        el.style.height = rect.height + 'px';
        el.style.width = rect.width + 'px';
        el.innerHTML = '';
        el.dataset.evicted = '1';
      }
    }
  }, { rootMargin: '1500px 0px' });
  return evictionObserver;
}
function observeEviction(el) { if (evictionObserver) evictionObserver.observe(el); }

// ── CAMERA NAMES ─────────────────────────────────────────────────────────────
// Camera folders are tied to files by name (file.cameraFolder), so two spellings of one camera
// used to become two cameras - "Intsa360" next to "Insta360", from one swapped pair of letters
// typed in Guided Sort. Two names are the same camera when they differ only by capitals,
// spaces/dashes/underscores, or two neighbouring letters swapped. Deliberately no looser:
// "GoPro 8" and "GoPro 9", or "Canon R" and "Canon M", are different cameras one character apart.
// The names import detection gives (detectCamera* in main.js) - the spelling that wins a merge.
const OFFICIAL_CAMERA_NAMES = ['Canon', 'DJI', 'DJI Mavic', 'DJI Mini', 'DJI Osmo', 'DJI Osmo 4', 'Fujifilm', 'GoPro', 'Insta360', 'Nikon', 'Panasonic', 'Samsung', 'Sony', 'iPhone'];
function cameraNameKey(name) { return (name || '').toLowerCase().replace(/[\s_-]+/g, ''); }
function sameCameraName(a, b) {
  const x = cameraNameKey(a), y = cameraNameKey(b);
  if (x === y) return true;
  if (x.length !== y.length || x.length < 5) return false;
  const diff = [];
  for (let i = 0; i < x.length && diff.length <= 2; i++) if (x[i] !== y[i]) diff.push(i);
  const [i, j] = diff;
  return diff.length === 2 && j === i + 1 && x[i] === y[j] && x[j] === y[i] && /[a-z]/.test(x[i] + x[j]);
}
function getCameraRoot() { return appData.folders.find(f => f.name === 'Cameras' && !f.parentId); }
function getCameraFolders() { const root = getCameraRoot(); return root ? appData.folders.filter(f => f.parentId === root.id) : []; }
// The existing camera folder a name means - an exact match first, then a same-camera spelling.
function findCameraFolder(name) {
  const cams = getCameraFolders();
  return cams.find(f => f.name === name) || cams.find(f => sameCameraName(f.name, name)) || null;
}
// What a typed camera name should be stored as: an existing camera's own spelling when it's that
// camera, otherwise the name as typed.
function resolveCameraName(name) { return findCameraFolder(name)?.name || name; }

// Folds one camera folder into another: its files' links and camera labels move over, any
// subfolders and a learned profile come along, and the folder itself goes. Every other folder a
// file is in is left alone.
function mergeCameraFolder(fromId, intoId) {
  const from = appData.folders.find(f => f.id === fromId), into = appData.folders.find(f => f.id === intoId);
  if (!from || !into || from === into) return;
  for (const file of appData.files) {
    if (file.folders?.includes(fromId)) file.folders = [...new Set(file.folders.map(id => id === fromId ? intoId : id))];
    if (file.cameraFolder === from.name) file.cameraFolder = into.name;
    if (file.cameraMake === from.name) file.cameraMake = into.name;
  }
  appData.folders.forEach(f => { if (f.parentId === fromId) f.parentId = intoId; });
  if (from.cameraProfile && !into.cameraProfile) into.cameraProfile = from.cameraProfile;
  appData.folders = appData.folders.filter(f => f.id !== fromId);
  if (currentFolder === fromId) currentFolder = intoId;
}
// Startup/import repair: any camera folders that are one camera under two spellings become one,
// keeping the official spelling if one of them has it, otherwise whichever holds more files.
function mergeSameCameraFolders() {
  let changed = false;
  for (let merged = true; merged;) {
    merged = false;
    const cams = getCameraFolders();
    outer: for (let a = 0; a < cams.length; a++) {
      for (let b = a + 1; b < cams.length; b++) {
        if (!sameCameraName(cams[a].name, cams[b].name)) continue;
        const count = f => appData.files.filter(x => x.folders?.includes(f.id)).length;
        const official = f => OFFICIAL_CAMERA_NAMES.includes(f.name);
        const keep = official(cams[a]) !== official(cams[b]) ? (official(cams[a]) ? cams[a] : cams[b])
          : count(cams[a]) >= count(cams[b]) ? cams[a] : cams[b];
        mergeCameraFolder((keep === cams[a] ? cams[b] : cams[a]).id, keep.id);
        changed = merged = true;
        break outer;
      }
    }
  }
  return changed;
}

// ── CAMERA AUTO-FOLDERS ──────────────────────────────────────────────────────
async function autoCreateCameraFolders(files) {
  let changed = false;
  let camRoot = getCameraRoot();
  if (!camRoot) {
    camRoot = { id: 'cam-root', name: 'Cameras', icon: '📸', color: '#3d6f8f', parentId: null };
    appData.folders.push(camRoot);
    changed = true;
  }
  if (mergeSameCameraFolders()) changed = true;
  for (const file of files) {
    if (!file.cameraFolder) continue;
    // A same-camera spelling joins the existing camera, label and all.
    const existing = findCameraFolder(file.cameraFolder);
    if (existing && existing.name !== file.cameraFolder) {
      if (file.cameraMake === file.cameraFolder) file.cameraMake = existing.name;
      file.cameraFolder = existing.name;
      changed = true;
    }
    let folder = existing;
    if (!folder) {
      const brand = file.cameraFolder;
      folder = { id:'cam-'+brand.replace(/\s+/g,'-').toLowerCase()+'-'+Date.now().toString(36), name:brand, color:'#3d6f8f', parentId:camRoot.id };
      appData.folders.push(folder);
      changed = true;
    }
    if (!file.folders || !file.folders.includes(folder.id)) {
      if (!file.folders) file.folders = [];
      file.folders.push(folder.id);
      changed = true;
    }
  }
  return changed;
}

// ── CAMERA PROFILES ───────────────────────────────────────────────────────────
// Teaches a Cameras folder to recognize future imports as "this camera" - learned
// from the EXIF model of files already in it, plus a shared filename prefix if
// one exists (covers footage with no usable EXIF, e.g. some FPV DVR/goggle
// recordings, or a stabilized/re-exported clip that lost its original metadata).
// Consumed by detectCameraFromProfile() in main.js at import time, checked before
// the built-in hardcoded brand list - the point of a profile is to override/
// refine that default, e.g. so a GoPro flown on a drone gets recognized apart
// from an identical GoPro used handheld, something make/model EXIF alone can
// never disambiguate (both just say "GoPro HERO11 Black").
//
// Any learned model or prefix is cross-checked against your OTHER camera
// folders' files and dropped if it also matches a meaningful share of them -
// otherwise a shared naming convention (e.g. DJI's own "DJI_" prefix, used by
// both a plain drone clip and a stabilized FPV export) would teach a profile
// that misfiles your other camera's future imports into this folder instead.
const GENERIC_FILENAME_PREFIXES = new Set(['IMG_', 'DSC_', 'DSCN', 'MOV_', 'VID_', 'PXL_', '100_', 'MVI_', 'DCIM']);
const PROFILE_COLLISION_MAX = 0.1; // reject a signal shared by more than this share of other cameras' files

// The run of non-digit characters at the start of the filename - e.g.
// "DJI_20250705200718_0001" -> "DJI_". Uses whichever prefix a clear majority
// of the folder's files share, so one or two oddly-named outliers (a clip
// dragged in from elsewhere) don't sink the whole profile the way requiring
// every single file to agree on one exact prefix would.
function filenamePrefixOf(name) {
  const base = name.replace(/\.[^.]+$/, '').toUpperCase();
  return base.match(/^[^\d]+/)?.[0] || '';
}
function majorityFilenamePrefix(files) {
  const counts = new Map();
  files.forEach(f => {
    const p = filenamePrefixOf(f.name);
    if (p.length >= 4 && !GENERIC_FILENAME_PREFIXES.has(p.slice(0, 4))) counts.set(p, (counts.get(p) || 0) + 1);
  });
  if (!counts.size) return null;
  const [topPrefix, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return (topCount / files.length >= 0.6) ? topPrefix : null; // no clear majority
}

function buildCameraProfile(folderId) {
  const folder = appData.folders.find(f => f.id === folderId);
  if (!folder) return;
  const ids = new Set([folderId, ...getAllDesc(folderId)]);
  const files = appData.files.filter(f => f.folders?.some(id => ids.has(id)));
  if (!files.length) { toast('⚠️ This folder has no files to learn from yet'); return; }

  const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const siblingIds = camRoot
    ? new Set(appData.folders.filter(sf => sf.parentId === camRoot.id && sf.id !== folder.id).flatMap(sf => [sf.id, ...getAllDesc(sf.id)]))
    : new Set();
  const otherFiles = siblingIds.size ? appData.files.filter(f => f.folders?.some(id => siblingIds.has(id))) : [];

  const makes = [...new Set(files.map(f => f.cameraMake).filter(Boolean))];
  const otherModels = new Set(otherFiles.map(f => f.cameraModel).filter(Boolean).map(m => m.toLowerCase()));
  const models = [...new Set(files.map(f => f.cameraModel).filter(Boolean))].filter(m => !otherModels.has(m.toLowerCase()));

  let filenamePrefixes = [];
  const prefix = majorityFilenamePrefix(files);
  if (prefix) {
    const collisionShare = otherFiles.length ? otherFiles.filter(f => f.name.toUpperCase().startsWith(prefix)).length / otherFiles.length : 0;
    if (collisionShare <= PROFILE_COLLISION_MAX) filenamePrefixes = [prefix];
  }

  if (!models.length && !filenamePrefixes.length) {
    toast(`⚠️ Nothing distinctive enough to learn in "${folder.name}" - these files have no camera model or filename pattern that isn't also shared by your other camera folders`, 6000);
    return;
  }

  folder.cameraProfile = { makes, models, filenamePrefixes, updatedAt: Date.now() };
  saveData();
  const parts = [];
  if (models.length) parts.push(models.join(', '));
  if (filenamePrefixes.length) parts.push(`filenames starting "${filenamePrefixes[0]}"`);
  toast(`🎯 "${folder.name}" will now recognize: ${parts.join(' + ')}`, 5000);
}

// ── TRAVEL / GEOCODING ───────────────────────────────────────────────────────
let geocodingActive = false;

async function geocodeFiles() {
  if (geocodingActive) return;
  // region === undefined catches files geocoded before region/city existed
  const needGeocode = appData.files.filter(f => f.gps && !f.noGeocode && (!f.country || f.region === undefined));
  if (!needGeocode.length) return;
  geocodingActive = true;
  let count = 0;
  for (const file of needGeocode) {
    try {
      const key = `${file.gps.lat.toFixed(2)},${file.gps.lng.toFixed(2)}`;
      let result = appData.geocodeCache[key];
      if (!result || result.region === undefined) {
        result = await window.api.geocode(file.gps.lat, file.gps.lng);
        if (result) appData.geocodeCache[key] = result;
      }
      if (result) {
        file.country = result.country;
        file.countryCode = result.countryCode;
        file.region = result.region ?? null;
        file.city = result.city ?? null;
        count++;
        if (count % 5 === 0) {
          await window.api.saveData(appData);
          renderTravelSidebar();
        }
      }
    } catch(e) {}
  }
  if (count > 0) { await window.api.saveData(appData); renderTravelSidebar(); }
  geocodingActive = false;
}

function renderTravelSidebar() { renderSidebar(); } // kept for geocodeFiles callers

// ── BURST DETECTION ──────────────────────────────────────────────────────────
// iPhone timer/burst shots land as N separate-looking files. fileDate is only
// second-precision (no sub-second EXIF tag is parsed anywhere in this app), so
// several burst frames commonly share the exact same fileDate - the filename's
// trailing number is the tiebreaker that actually orders them correctly.
const BURST_GAP_MS = 2000;  // max gap between consecutive shots to stay in the same burst
const BURST_MIN_SIZE = 3;   // fewer than this isn't worth collapsing into a group
let burstCoverMap = new Map(); // coverId -> { count, memberIds } - refreshed by getVisibleFiles() each render
let currentViewImages = []; // photos AND videos in the currently rendered view, for double-click "browse all" popup nav - refreshed by renderFilesInner() each render

function burstFilenameNumber(name) {
  const m = name.match(/(\d+)(?=\.[^.]*$)/);
  return m ? parseInt(m[1], 10) : 0;
}

// Computed live from existing fields every time - no group identity is persisted,
// only which single member is the chosen cover (file.burstCover). Runs on an
// already folder/chip-filtered file list so a burst is only collapsed within a
// view that actually contains every one of its members.
function computeBurstGroups(files) {
  const byKey = new Map();
  for (const f of files) {
    if (!isImg(f.ext) || !f.fileDate || f.burstDismissed) continue;
    const key = (f.cameraMake || f.cameraFolder || '?') + '|' + f.ext.toLowerCase() + '|' + pathDirname(f.path);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  const coverMap = new Map();
  const memberToCover = new Map();
  for (const group of byKey.values()) {
    group.sort((a, b) => (a.fileDate - b.fileDate) || (burstFilenameNumber(a.name) - burstFilenameNumber(b.name)));
    let cluster = [];
    const flush = () => {
      if (cluster.length >= BURST_MIN_SIZE) {
        const cover = cluster.find(f => f.burstCover) || cluster[0];
        const memberIds = cluster.map(f => f.id);
        coverMap.set(cover.id, { count: cluster.length, memberIds });
        memberIds.forEach(id => memberToCover.set(id, cover.id));
      }
      cluster = [];
    };
    for (const f of group) {
      if (cluster.length && (f.fileDate - cluster[cluster.length - 1].fileDate) > BURST_GAP_MS) flush();
      cluster.push(f);
    }
    flush();
  }
  return { coverMap, memberToCover };
}

// ── VERSION LINKING (original ↔ edited "branches", PLM-style) ──────────────────
// A file that's an edited version of another carries file.versionParentId = the
// original's id. Only that pointer is persisted - membership is derived from it
// live (like bursts above), so unlinking or deleting either side just falls out
// of the derived sets on the next render with nothing else to clean up.
function getVersionChildren(fileId) {
  return appData.files.filter(f => f.versionParentId === fileId);
}
// Walks up the parent chain to the oldest ancestor still present in the library -
// guards against a corrupt/cyclical chain rather than looping forever.
function getVersionRoot(file) {
  let cur = file;
  const seen = new Set();
  while (cur.versionParentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = appData.files.find(f => f.id === cur.versionParentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}
// An edited copy depicts the exact same moment as its original, so once linked it should
// carry the original's real capture data rather than whatever (or nothing) it arrived
// with - an export/re-share commonly loses EXIF entirely and picks up today's date and
// no GPS, or a phone backup restore can scramble it. Overwrites unconditionally: the
// original's metadata is definitionally correct for what is now known to be the same shot.
function syncEditedMetadataFromOriginal(original, edited) {
  const fields = ['fileDate', 'country', 'region', 'city', 'countryCode', 'cameraMake', 'cameraModel', 'cameraFolder', 'gpsManual', 'noGeocode'];
  fields.forEach(f => {
    if (original[f] !== undefined) edited[f] = original[f];
    else delete edited[f];
  });
  edited.gps = original.gps ? { ...original.gps } : original.gps;
}

async function unlinkVersion(fileId) {
  const file = appData.files.find(f => f.id === fileId);
  if (!file || !file.versionParentId) return;
  delete file.versionParentId;
  await saveData();
  toast('🔓 Unlinked from its original');
  if (versionModalFileId) renderVersionModal();
}

// One-time backfill (see v3 migration in init()): re-reads each image's real EXIF
// with the corrected GPS-ref parser and only overwrites lat/lng whose sign the
// old buggy parser actually got wrong. Files where the reparse agrees with what's
// stored - already correct, or already hand-fixed by the user - are left alone,
// and file.gpsManual (set by the Edit Properties modal) is always respected.
async function fixGpsSigns() {
  const candidates = appData.files.filter(f => f.gps && !f.gpsManual && isImg(f.ext));
  if (!candidates.length) return;
  const results = await window.api.reprocessFiles(candidates.map(f => f.path)).catch(() => []);
  const metaByPath = new Map(results.map(r => [r.path, r.meta]));
  let fixed = 0;
  for (const file of candidates) {
    const meta = metaByPath.get(file.path);
    if (!meta?.gps) continue; // file missing/unreadable, or no GPS in its EXIF - don't touch
    const signWrong = (a, b) => a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b);
    if (!signWrong(meta.gps.lat, file.gps.lat) && !signWrong(meta.gps.lng, file.gps.lng)) continue;
    file.gps = meta.gps;
    file.country = null; file.countryCode = null; file.region = null; file.city = null; file.noGeocode = false;
    fixed++;
  }
  if (fixed > 0) {
    await window.api.saveData(appData);
    toast(`📍 Fixed GPS sign on ${fixed} file${fixed!==1?'s':''} - re-locating…`, 4000);
    setTimeout(() => geocodeFiles(), 800);
  }
}

// One-time backfill (see v4 migration in init()): HEIC (the default iPhone photo
// format) stores Exif in an ISO-BMFF item box, not a JPEG APP1 marker, so it was
// never parsed before and every HEIC photo silently got gps:null regardless of
// what its Exif actually contained. Re-reads each HEIC file that still has no GPS.
async function backfillHeicGps() {
  const candidates = appData.files.filter(f => f.ext === '.heic' && !f.gps && !f.gpsManual);
  if (!candidates.length) return;
  const results = await window.api.reprocessFiles(candidates.map(f => f.path)).catch(() => []);
  const metaByPath = new Map(results.map(r => [r.path, r.meta]));
  let fixed = 0;
  for (const file of candidates) {
    const meta = metaByPath.get(file.path);
    if (!meta) continue;
    if (meta.gps) {
      file.gps = meta.gps;
      file.country = null; file.countryCode = null; file.region = null; file.city = null; file.noGeocode = false;
      fixed++;
    }
    if (meta.cameraMake && !file.cameraMake) file.cameraMake = meta.cameraMake;
    if (meta.cameraModel && !file.cameraModel) file.cameraModel = meta.cameraModel;
    if (meta.cameraFolder && !file.cameraFolder) file.cameraFolder = meta.cameraFolder;
  }
  if (fixed > 0) {
    await window.api.saveData(appData);
    toast(`📍 Recovered GPS on ${fixed} HEIC photo${fixed!==1?'s':''} - re-locating…`, 4000);
    setTimeout(() => geocodeFiles(), 800);
  }
}

// One-time backfill (see v6 migration in init()): video files' location (stored in
// the moov/udta ©xyz ISO-6709 atom) was never parsed at all - main.js only pulled
// make/model/date out of a video's metadata boxes, so every video silently got
// gps:null even when it had a real embedded location. Re-reads each video that
// still has no GPS.
async function backfillVideoGps() {
  const candidates = appData.files.filter(f => isVid(f.ext) && (!f.gps || !f.cameraMake) && !f.gpsManual);
  if (!candidates.length) return;
  const results = await window.api.reprocessFiles(candidates.map(f => f.path)).catch(() => []);
  const metaByPath = new Map(results.map(r => [r.path, r.meta]));
  let fixed = 0;
  for (const file of candidates) {
    const meta = metaByPath.get(file.path);
    if (!meta) continue;
    // Camera too, while we're here - it lives in the same block, so it was missed the same way.
    if (!file.cameraMake && meta.cameraMake) { file.cameraMake = meta.cameraMake; file.cameraModel = meta.cameraModel || file.cameraModel || null; }
    if (!file.cameraFolder && meta.cameraFolder) file.cameraFolder = meta.cameraFolder;
    if (file.gps || file.noGeocode === true || !meta.gps) continue; // noGeocode = you cleared it on purpose (clearLocationFields)
    file.gps = meta.gps;
    file.country = null; file.countryCode = null; file.region = null; file.city = null; file.noGeocode = false;
    fixed++;
  }
  if (fixed > 0) {
    await window.api.saveData(appData);
    toast(`📍 Recovered GPS on ${fixed} video${fixed!==1?'s':''} - re-locating…`, 4000);
    setTimeout(() => geocodeFiles(), 800);
  }
}

// ── IMAGE DIMENSIONS (for the "Image Size" / "Resolution" library filters) ─────
const PANORAMA_ASPECT_RATIO = 2.4; // longer/shorter edge at or above this reads as a panorama, not just "pretty wide"
function fileOrientation(f) {
  if (!f.width || !f.height) return null;
  const longer = Math.max(f.width, f.height), shorter = Math.min(f.width, f.height);
  if (shorter && longer / shorter >= PANORAMA_ASPECT_RATIO) return 'panorama';
  return f.height > f.width ? 'vertical' : 'horizontal';
}
function fileResolutionTier(f) {
  if (!f.width || !f.height) return null;
  const longer = Math.max(f.width, f.height);
  if (longer >= 3840) return '4k';
  if (longer >= 1920) return '1080p';
  if (longer >= 1280) return 'hd';
  return 'sd';
}

// Fetches real pixel dimensions for whichever of `files` don't have them yet. Video is
// deliberately excluded - the OS Shell thumbnail this reads for images would only give a
// poster frame's rendered size for a video, not its real resolution. width/height land
// directly on the file record (like edits/rotation), not a separate cache, since they're
// permanent facts about the file rather than a rendering.
let dimBackfillInFlight = new Set();
async function ensureDimensionsFor(files) {
  const targets = files.filter(f => isImg(f.ext) && !f._missing && f.width == null && !dimBackfillInFlight.has(f.id));
  if (!targets.length) return;
  if (targets.length > 15) toast('🔍 Reading photo dimensions…', 2500);
  targets.forEach(f => dimBackfillInFlight.add(f.id));
  const CONCURRENCY = 6;
  let next = 0, changed = false;
  async function worker() {
    while (next < targets.length) {
      const f = targets[next++];
      const size = await window.api.getImageSize(f.path).catch(() => null);
      dimBackfillInFlight.delete(f.id);
      if (size) { f.width = size.width; f.height = size.height; changed = true; }
      else { f.width = 0; f.height = 0; } // tried and failed to read it - 0 still fails the truthy checks above, so this just quietly stays excluded from Size/Resolution rather than being retried every render
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  // saveData(), not persistQuiet() - this must bump dataGen or getVisibleFiles() keeps
  // serving its pre-backfill cached result forever, since nothing else about the current
  // filter/folder/search key changed to naturally invalidate it.
  if (changed) await saveData();
}

// Slowly fills in dimensions for the whole library in the background so Image Size and
// Resolution have real data the first time someone actually opens those filters - paced
// well below ensureDimensionsFor's own concurrency so it never competes with whatever's
// on screen right now. Safe to just re-run every launch: anything already backfilled
// (here or on-demand via ensureDimensionsFor) is skipped instantly, so an interrupted
// sweep simply picks up the remainder next time rather than needing its own completion flag.
async function backfillAllDimensions() {
  const files = appData.files.filter(f => isImg(f.ext) && !f._missing && f.width == null);
  for (let i = 0; i < files.length; i += 40) {
    await ensureDimensionsFor(files.slice(i, i + 40));
    await new Promise(r => setTimeout(r, 400));
  }
}

// ── SIDEBAR SECTIONS (draggable) ─────────────────────────────────────────────
// Line icons for the built-in sections, same 24px grid/stroke as PE_ICON_PATHS, tinted with
// each section's folder colour. Emoji looked different on every OS and clashed with the rest
// of the sidebar; these stay crisp and on-palette.
const SECTION_ICON_PATHS = {
  trips:      '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  adventures: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z" fill="currentColor" fill-opacity=".25"/>',
  people:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  categories: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/>',
  cameras:    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  locations:  '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
};
const SECTION_ICON_COLORS = { trips: '#06b6d4', adventures: '#f97316', people: '#ec4899', categories: '#10b981', cameras: '#6b9bc3', locations: '#8b5cf6' };
function sectionIcon(key) {
  return `<svg class="sb-sec-icon" style="color:${SECTION_ICON_COLORS[key]}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SECTION_ICON_PATHS[key]}</svg>`;
}

// `label` is HTML (icon + name) for the header and Settings; `name` is the plain text for toasts.
const SIDEBAR_SECTIONS = {
  trips:      { name: 'Trips',      label: `${sectionIcon('trips')} Trips`,           add: () => addVacation(),          render: renderTripsList },
  adventures: { name: 'Adventures', label: `${sectionIcon('adventures')} Adventures`, add: () => addAdventure(),         render: renderAdventuresList },
  people:     { name: 'People',     label: `${sectionIcon('people')} People`,         add: () => addPersonManual(),      render: renderPeopleList },
  categories: { name: 'Categories', label: `${sectionIcon('categories')} Categories`, add: () => openCategoryQuickAdd(), render: renderCategoriesList },
  cameras:    { name: 'Cameras',    label: `${sectionIcon('cameras')} Cameras`,       add: () => addCameraManual(),      render: renderCamerasList },
  // No `add` - Location is auto-generated from each photo's GPS data, so creating one
  // manually isn't a real action; renderSidebarSections() skips the "+ New…" button below
  // for any section with noAdd set instead of giving it a button that can't do anything.
  locations:  { name: 'Location',   label: `${sectionIcon('locations')} Location`,    noAdd: true, render: renderLocationsList },
  // No generic "Folders" catch-all anymore - every folder already lives under one of the
  // sections above or a custom section, so a leftover uncategorized-folders bucket was never
  // actually useful. Removing the key here is enough on its own: renderSidebarSections()'s
  // self-heal (below) treats any id no longer in this object as stale and drops it from
  // appData.sidebarOrder on the very next render, for every existing install too - no separate
  // migration needed.
};

// Closed on every launch - a section only stays open for the current session once expanded.
const collapsedSidebarSections = new Set(Object.keys(SIDEBAR_SECTIONS));

// Beyond the fixed sections above, someone can also add their own top-level sections (see
// openNewSectionModal/"+ Add Section") - each one is just a regular top-level folder with
// isSection:true, so it rides on all the same machinery (icons, colors, drag-reorder, the
// right-click Customize/Delete menu) instead of needing a parallel data model. This builds the
// same {label,add,render} shape SIDEBAR_SECTIONS entries have, on the fly, for one such folder.
function buildCustomSectionDef(folderId) {
  const folder = appData.folders.find(f => f.id === folderId && !f.parentId && f.isSection);
  if (!folder) return null;
  return {
    label: `${folderIconHtml(folder)} ${esc(folder.name)}`,
    add: () => openNewFolderModalForced(folder.id, `New folder in ${folder.name}`),
    isCustomSection: true,
    folderId: folder.id,
    render: (list) => {
      const kids = appData.folders.filter(f => f.parentId === folder.id);
      if (!kids.length) { list.innerHTML = `<div class="sb-empty sb-empty-cta" onclick="openNewFolderModalForced('${folder.id}')">Empty - tap to add a folder here</div>`; return; }
      kids.forEach(k => renderSidebarFolder(k, list, 0, new Set()));
    },
  };
}

// Every folder that belongs to one of the special sidebar sections above (Trips/People/
// Categories/Cameras/custom sections) - used to keep those out of the generic catch-all Folders
// list below, and out of the New Folder modal's parent picker, so nothing shows up twice.
function getManagedFolderIds() {
  const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const vacRoot = appData.folders.find(f => f.id === VACATIONS_ROOT_ID);
  const advRoot = appData.folders.find(f => f.id === ADVENTURES_ROOT_ID);
  const peopleRoot = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  const catRoot = appData.folders.find(f => !f.parentId && f.name.toLowerCase() === CATEGORY_ROOT_NAME.toLowerCase());
  const customRoots = appData.folders.filter(f => !f.parentId && f.isSection);
  return new Set([
    ...(camRoot ? [camRoot.id, ...getAllDesc(camRoot.id)] : []),
    ...(vacRoot ? [vacRoot.id, ...getAllDesc(vacRoot.id)] : []),
    ...(advRoot ? [advRoot.id, ...getAllDesc(advRoot.id)] : []),
    ...(peopleRoot ? [peopleRoot.id, ...getAllDesc(peopleRoot.id)] : []),
    ...(catRoot ? [catRoot.id, ...getAllDesc(catRoot.id)] : []),
    ...customRoots.flatMap(r => [r.id, ...getAllDesc(r.id)]),
  ]);
}
// Just the root ids themselves (not their descendants, unlike getManagedFolderIds above) -
// used by the New Folder modal's parent picker, which should hide the roots (each has its own
// dedicated "+ New…" flow) but still let existing subfolders under them (e.g. a "Wildlife" or
// "Activity" category, a specific trip) be picked as the parent for a new nested folder.
function getManagedRootIds() {
  const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const vacRoot = appData.folders.find(f => f.id === VACATIONS_ROOT_ID);
  const peopleRoot = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  const catRoot = appData.folders.find(f => !f.parentId && f.name.toLowerCase() === CATEGORY_ROOT_NAME.toLowerCase());
  const customRoots = appData.folders.filter(f => !f.parentId && f.isSection);
  return new Set([camRoot?.id, vacRoot?.id, ADVENTURES_ROOT_ID, peopleRoot?.id, catRoot?.id, ...customRoots.map(r => r.id)].filter(Boolean));
}
// A clickable empty-state for a sidebar section, instead of inert text - the CTA fires the
// same `add` action as the section's own "+ New…" button so there's never a dead end.
function sbEmptyHtml(text, sectionKey) {
  return `<div class="sb-empty sb-empty-cta" onclick="SIDEBAR_SECTIONS['${sectionKey}'].add()">${esc(text)}</div>`;
}

function toggleSidebarSection(key) {
  if (collapsedSidebarSections.has(key)) collapsedSidebarSections.delete(key);
  else collapsedSidebarSections.add(key);
  document.querySelector(`.sb-sec[data-sec="${key}"]`)?.classList.toggle('collapsed', collapsedSidebarSections.has(key));
}

function renderSidebarSections() {
  // Self-healing, same idea as the folder/camera sync checks in init(): fold any user-created
  // sections into the saved order (new ones go at the end) and drop ids for sections that no
  // longer exist (deleted via the header's right-click Delete) - so sidebarOrder never needs its
  // own dedicated add/remove bookkeeping at every call site that can create or delete one.
  const customSectionIds = appData.folders.filter(f => !f.parentId && f.isSection).map(f => f.id);
  const validKeys = new Set([...Object.keys(SIDEBAR_SECTIONS), ...customSectionIds]);
  const order = appData.sidebarOrder.filter(k => validKeys.has(k));
  customSectionIds.forEach(id => { if (!order.includes(id)) order.push(id); });
  // Built-in sections added in a later version (Adventures) join existing libraries too, right
  // after the section they belong next to rather than at the very bottom.
  const BUILTIN_AFTER = { adventures: 'trips' };
  Object.keys(SIDEBAR_SECTIONS).forEach(k => {
    if (order.includes(k)) return;
    const after = order.indexOf(BUILTIN_AFTER[k]);
    order.splice(after >= 0 ? after + 1 : order.length, 0, k);
  });
  appData.sidebarOrder = order;

  const host = document.getElementById('sidebarSections');
  host.innerHTML = '';
  appData.sidebarOrder.forEach(key => {
    if (appData.hiddenSidebarSections?.includes(key)) return; // see hideSidebarSection()/showSidebarSection()
    const def = SIDEBAR_SECTIONS[key] || buildCustomSectionDef(key);
    if (!def) return;
    const sec = document.createElement('div');
    sec.className = 'sb-sec sb-draggable' + (collapsedSidebarSections.has(key) ? ' collapsed' : '');
    sec.dataset.sec = key;
    const header = document.createElement('div');
    header.className = 'sb-label sb-sec-header';
    header.title = def.isCustomSection ? 'Click to expand/collapse - drag to reorder - right-click to rename, recolor or delete' : 'Click to expand/collapse - drag to reorder - right-click to hide';
    header.innerHTML = `<span class="sb-sec-chevron">▾</span><span>${def.label}</span>`;
    header.addEventListener('click', () => toggleSidebarSection(key));
    if (def.isCustomSection) header.addEventListener('contextmenu', e => showFolderCtxMenu(e, def.folderId));
    else header.addEventListener('contextmenu', e => showSectionCtxMenu(e, key));
    sec.appendChild(header);
    const list = document.createElement('div');
    list.className = 'sb-sec-list';
    def.render(list);
    sec.appendChild(list);
    if (!def.noAdd) {
      const add = document.createElement('button');
      add.className = 'sb-add-btn';
      add.innerHTML = `<span style="font-size:15px;line-height:1">+</span> New…`;
      add.onclick = def.add;
      sec.appendChild(add);
    }
    setupSectionDrag(sec, header);
    host.appendChild(sec);
  });
}

// ── HIDE / RESTORE BUILT-IN SIDEBAR SECTIONS ────────────────────────────────
// Trips/People/Categories/Cameras/Location can be hidden from the sidebar without deleting
// anything underneath them - the folders/trips/people/etc. they contain are untouched, only
// whether the section renders at all. Reinstating is always available in Settings.
let sectionCtxKey = null;

function showSectionCtxMenu(e, key) {
  e.preventDefault(); e.stopPropagation();
  hideCtxMenu(); hideFolderCtxMenu();
  sectionCtxKey = key;
  const menu = document.getElementById('sectionCtxMenu');
  menu.classList.add('open');
  positionCtxMenu(menu, e.clientX, e.clientY);
}
function hideSectionCtxMenu() { document.getElementById('sectionCtxMenu')?.classList.remove('open'); }

function sectionCtxHideAction() {
  if (sectionCtxKey) hideSidebarSection(sectionCtxKey);
  hideSectionCtxMenu();
}

function hideSidebarSection(key) {
  if (!appData.hiddenSidebarSections) appData.hiddenSidebarSections = [];
  if (!appData.hiddenSidebarSections.includes(key)) appData.hiddenSidebarSections.push(key);
  saveData();
  renderSidebarSections();
  renderHiddenSectionsSettings();
  toast(`${SIDEBAR_SECTIONS[key]?.name || key} hidden - bring it back anytime in Settings`);
}

function showSidebarSection(key) {
  if (!appData.hiddenSidebarSections) return;
  appData.hiddenSidebarSections = appData.hiddenSidebarSections.filter(k => k !== key);
  saveData();
  renderSidebarSections();
  renderHiddenSectionsSettings();
  toast(`${SIDEBAR_SECTIONS[key]?.name || key} restored`);
}

// Populates Settings' "Hidden sections" list - a no-op if the modal isn't open/doesn't have
// the element yet, so it's safe to call from hideSidebarSection()/showSidebarSection() too.
function renderHiddenSectionsSettings() {
  const el = document.getElementById('setHiddenSections');
  if (!el) return;
  const hidden = (appData.hiddenSidebarSections || []).filter(k => SIDEBAR_SECTIONS[k]);
  if (!hidden.length) { el.innerHTML = `<div class="settings-hint" style="margin-top:0">${t('settingsNothingHidden')}</div>`; return; }
  el.innerHTML = hidden.map(key => `
    <div class="settings-hidden-row">
      <span>${SIDEBAR_SECTIONS[key].label}</span>
      <button class="btn-cancel" onclick="showSidebarSection('${key}')">${t('settingsShow')}</button>
    </div>
  `).join('');
}

function setupSectionDrag(sec, header) {
  header.addEventListener('mousedown', () => { sec.draggable = true; });
  sec.addEventListener('dragstart', e => {
    if (!sec.draggable) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/sidebar-sec', sec.dataset.sec);
    e.dataTransfer.effectAllowed = 'move';
    sec.classList.add('dragging');
  });
  sec.addEventListener('dragend', () => {
    sec.draggable = false;
    sec.classList.remove('dragging');
    document.querySelectorAll('.sb-draggable').forEach(s => s.classList.remove('drag-over'));
  });
  sec.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/sidebar-sec')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    sec.classList.add('drag-over');
  });
  sec.addEventListener('dragleave', () => sec.classList.remove('drag-over'));
  sec.addEventListener('drop', async e => {
    const from = e.dataTransfer.getData('text/sidebar-sec');
    if (!from) return;
    e.preventDefault(); e.stopPropagation();
    const to = sec.dataset.sec;
    if (from === to) return;
    const order = appData.sidebarOrder.filter(k => k !== from);
    const idx = order.indexOf(to);
    order.splice(idx >= 0 ? idx : order.length, 0, from);
    appData.sidebarOrder = order;
    await saveData();
    toast('↕ Sidebar order saved');
  });
}

// Trips/People/Categories/Cameras all delegate to renderSidebarFolder (the same recursive,
// expand/collapse, drag/drop, delete-button renderer the generic Folders tree uses) instead of
// each hand-rolling a flat one-level list - a category like "Activity" full of its own
// sub-subfolders (Hiking, Skiing, ...) was previously invisible past the first level here, even
// though those sub-subfolders exist and are reachable elsewhere. The empty 4th argument is the
// exclusion set renderSidebarFolder normally uses to skip camera subfolders when walking the
// generic tree - not relevant here since each of these is already scoped to its own root.
function renderTripsList(list) {
  const vacRoot = appData.folders.find(f => f.id === 'vacations-root');
  const trips = vacRoot ? appData.folders.filter(f => f.parentId === vacRoot.id) : [];
  if (!trips.length) { list.innerHTML = sbEmptyHtml('No trips yet - tap to create one, or drop a folder from Explorer', 'trips'); return; }
  trips.forEach(f => renderSidebarFolder(f, list, 0, new Set()));
}

function renderAdventuresList(list) {
  const root = appData.folders.find(f => f.id === ADVENTURES_ROOT_ID);
  const adventures = root ? appData.folders.filter(f => f.parentId === root.id) : [];
  if (!adventures.length) {
    list.innerHTML = sbEmptyHtml('Trips are travel away from home. Adventures are the memorable days in between: a trek, a festival, a day on the water. Tap to add one', 'adventures');
    return;
  }
  adventures.forEach(f => renderSidebarFolder(f, list, 0, new Set()));
}

function renderPeopleList(list) {
  const root = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  const people = root ? appData.folders.filter(f => f.parentId === root.id) : [];
  if (!people.length) { list.innerHTML = sbEmptyHtml('No one tagged yet - tap to add someone', 'people'); return; }
  people.forEach(f => renderSidebarFolder(f, list, 0, new Set()));
}

// A smart category, not a real appData.folders entry - membership is computed on the fly
// from file.edits (edited in Trove's own editor) / file.versionParentId (linked as an
// edited version via Find Edited or a manual link), so it can never drift out of sync the
// way a manually-assigned folder would if every edit/link/unlink site had to remember to
// also update this folder's membership. Hand-rolled rather than going through
// renderSidebarFolder for the same reason Best Of/Photo Library/To Sort are: no delete
// button, no drag, no drop target - there's no real folder record here to act on.
function renderEditedCategoryRow(list) {
  const row = document.createElement('div');
  row.className = 'si' + (currentFolder === 'edited' ? ' active' : '');
  row.dataset.folder = 'edited';
  row.innerHTML = `
    <span style="width:14px;flex-shrink:0"></span>
    <div class="si-dot" style="background:var(--accent)"></div>
    <span class="si-name">✏️ Edited</span>
    <span class="si-count">${editedFileCount}</span>`;
  row.addEventListener('click', () => selectFolder('edited', row));
  list.appendChild(row);
}
function renderCategoriesList(list) {
  renderEditedCategoryRow(list);
  const root = appData.folders.find(f => !f.parentId && f.name.toLowerCase() === CATEGORY_ROOT_NAME.toLowerCase());
  const cats = root ? appData.folders.filter(f => f.parentId === root.id) : [];
  if (!cats.length) { list.insertAdjacentHTML('beforeend', sbEmptyHtml('No categories yet - tap to quick-add some', 'categories')); return; }
  cats.forEach(f => renderSidebarFolder(f, list, 0, new Set()));
}

// Quick-add picker for categories - a grid of common one-tap chips (STARTER_CATEGORIES) for
// whichever ones don't exist yet, plus a free-text field for anything else. Shared between the
// sidebar's Categories section and the first-run wizard's category step (renderFrCategoriesStep).
function openCategoryQuickAdd() {
  const root = getOrCreateCategoryRoot();
  const existingNames = new Set(appData.folders.filter(f => f.parentId === root.id).map(f => f.name.toLowerCase()));
  const grid = document.getElementById('catQuickAddGrid');
  grid.innerHTML = '';
  STARTER_CATEGORIES.filter(c => !existingNames.has(c.name.toLowerCase())).forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'gs-chip';
    chip.textContent = `${c.icon} ${c.name}`;
    chip.onclick = () => { getOrCreateCategoryFolder(c.name).icon = c.icon; saveData(); toast(`🏷️ "${c.name}" added`); closeCategoryQuickAdd(); };
    grid.appendChild(chip);
  });
  if (!grid.children.length) grid.innerHTML = '<div class="gs-bar-info" style="margin:0">You already have all the common starter categories.</div>';
  document.getElementById('catQuickAddCustom').value = '';
  document.getElementById('categoryQuickAddModal').classList.add('open');
}
function closeCategoryQuickAdd() {
  document.getElementById('categoryQuickAddModal').classList.remove('open');
}
function submitCategoryQuickAddCustom() {
  const name = document.getElementById('catQuickAddCustom').value.trim();
  if (!name) return;
  getOrCreateCategoryFolder(name);
  saveData();
  toast(`🏷️ "${name}" added`);
  closeCategoryQuickAdd();
}

function addPersonManual() {
  forcedNewFolderParent = getOrCreatePeopleRoot().id;
  editingFolderId = null;
  creatingSection = false;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji('');
  document.getElementById('nfmTitle').textContent = 'New Person';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = 'none';
  toggleNfmDatesRow(false);
  selectedColor = '#ec4899'; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(() => document.getElementById('nfmName').focus(), 60);
}

// Drag-to-reorder for folder/trip sidebar rows, via plain mouse events rather than native
// HTML5 drag-and-drop (which was unreliable here - the row would arm but never actually
// track the cursor). Scoped by parentId so a folder can only be reordered among its own
// siblings - subfolders stay inside their folder, trips stay in the Trips section -
// reparenting isn't possible via drag, only position within the same parent.
function attachFolderDrag(item, folder) {
  const parentKey = folder.parentId || 'root';
  item.dataset.folder = folder.id;
  item.dataset.parentKey = parentKey;
  // Grab anywhere on the row - a small move threshold tells a
  // drag apart from a plain click, so selecting the folder still works normally.
  item.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.si-del, .si-toggle')) return; // let those controls behave normally
    e.preventDefault(); // stop text selection from starting while we wait to see if this is a drag
    const startX = e.clientX, startY = e.clientY;
    function onMove(ev) {
      if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
      cleanup();
      // The click that would otherwise fire on mouseup (and re-select/toggle the folder) needs swallowing
      item.addEventListener('click', suppressClick, { capture: true, once: true });
      beginFolderDrag(folder, parentKey, item);
    }
    function onUp() { cleanup(); }
    function cleanup() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    function suppressClick(ev) { ev.stopImmediatePropagation(); ev.preventDefault(); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

let folderDropIndicator = null;
function beginFolderDrag(folder, parentKey, sourceRow) {
  if (!folderDropIndicator) {
    folderDropIndicator = document.createElement('div');
    folderDropIndicator.className = 'folder-drop-indicator';
    document.body.appendChild(folderDropIndicator);
  }
  const indicator = folderDropIndicator;
  sourceRow.classList.add('dragging');
  document.body.classList.add('folder-dragging');
  let pending = null; // { id, before }

  function onMove(e) {
    const rows = [...document.querySelectorAll(`.si[data-parent-key="${CSS.escape(parentKey)}"]`)];
    let hit = null;
    for (const row of rows) {
      if (row === sourceRow) continue;
      const r = row.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) { hit = { row, before: e.clientY < r.top + r.height / 2 }; break; }
    }
    if (hit) {
      pending = { id: hit.row.dataset.folder, before: hit.before };
      const r = hit.row.getBoundingClientRect();
      indicator.style.display = 'block';
      indicator.style.left = r.left + 'px';
      indicator.style.width = r.width + 'px';
      indicator.style.top = (hit.before ? r.top : r.bottom) - 1 + 'px';
    } else {
      pending = null;
      indicator.style.display = 'none';
    }
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    indicator.style.display = 'none';
    sourceRow.classList.remove('dragging');
    document.body.classList.remove('folder-dragging');
    if (pending) applyFolderDrop(folder.id, pending.id, pending.before);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function applyFolderDrop(draggedId, targetId, before) {
  if (draggedId === targetId) return;
  const dragged = appData.folders.find(f => f.id === draggedId);
  const target = appData.folders.find(f => f.id === targetId);
  if (!dragged || !target) return;
  if ((dragged.parentId || null) !== (target.parentId || null)) return; // scoped rows already guarantee this - extra safety
  appData.folders.splice(appData.folders.indexOf(dragged), 1);
  let idx = appData.folders.indexOf(target);
  if (!before) idx += 1;
  appData.folders.splice(idx, 0, dragged);
  saveData();
}

function renderCamerasList(list) {
  const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const cams = camRoot ? appData.folders.filter(f => f.parentId === camRoot.id) : [];
  if (!cams.length) { list.innerHTML = '<div class="sb-empty">No cameras detected yet</div>'; return; }
  cams.forEach(f => renderSidebarFolder(f, list, 0, new Set()));
}

function renderLocationsList(list) {
  const countries = new Map();
  for (const f of appData.files) {
    if (!f.country) continue;
    let c = countries.get(f.country);
    if (!c) countries.set(f.country, c = { code: f.countryCode || 'XX', count: 0, regions: new Map() });
    c.count++;
    if (f.region) c.regions.set(f.region, (c.regions.get(f.region) || 0) + 1);
  }
  if (!countries.size) {
    // GPS shows on the Globe the instant a file has coordinates, but this list needs the
    // country/region name, which comes from a background reverse-geocode call rate-limited to
    // ~1/sec (Nominatim's usage policy) - a big trip with many distinct spots can take a
    // while to fully appear here even though the pins are already on the globe. Say so, rather
    // than just looking empty/broken while it catches up.
    const pending = appData.files.filter(f => f.gps && !f.noGeocode && !f.country).length;
    list.innerHTML = pending
      ? `<div class="sb-empty">🌍 Locating ${pending} photo${pending!==1?'s':''}… already on the Globe, this list catches up shortly</div>`
      : '<div class="sb-empty">No GPS locations yet</div>';
    return;
  }
  [...countries.entries()].sort((a,b) => b[1].count - a[1].count).forEach(([country, info]) => {
    const fid = 'country:' + country;
    const hasRegions = info.regions.size > 0;
    const isOpen = openCountryRegions.has(country);
    const div = document.createElement('div');
    div.className = 'si';
    div.dataset.folder = fid;
    div.innerHTML = `${hasRegions ? `<button class="si-toggle ${isOpen?'open':''}">▶</button>` : '<span style="width:14px;flex-shrink:0"></span>'}<div class="si-dot" style="background:var(--cyan)"></div><span class="si-name">${countryFlag(info.code)} ${esc(country)}</span><span class="si-count">${info.count}</span>`;
    div.onclick = e => { if (!e.target.classList.contains('si-toggle')) selectFolder(fid, div); };
    const tog = div.querySelector('.si-toggle');
    if (tog) tog.onclick = e => {
      e.stopPropagation();
      if (isOpen) openCountryRegions.delete(country); else openCountryRegions.add(country);
      renderSidebar();
    };
    list.appendChild(div);
    if (hasRegions && isOpen) {
      [...info.regions.entries()].sort((a,b) => b[1] - a[1]).forEach(([region, cnt]) => {
        const rid = `region:${country}|${region}`;
        const rdiv = document.createElement('div');
        rdiv.className = 'si';
        rdiv.dataset.folder = rid;
        rdiv.style.paddingLeft = '22px';
        rdiv.innerHTML = `<div class="si-dot" style="background:var(--cyan);opacity:.5"></div><span class="si-name">📍 ${esc(region)}</span><span class="si-count">${cnt}</span>`;
        rdiv.onclick = () => selectFolder(rid, rdiv);
        list.appendChild(rdiv);
      });
    }
  });
}


// Keeps the startup splash up for at least a moment even on a fast/cached load, so it
// reads as an intentional loading screen rather than a one-frame flash.
async function hideSplash(startTime) {
  const MIN_VISIBLE_MS = 600;
  const remaining = MIN_VISIBLE_MS - (Date.now() - startTime);
  if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
  const el = document.getElementById('splashScreen');
  if (!el) return;
  el.classList.add('splash-hide');
  setTimeout(() => el.remove(), 450);
}

// ── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  const splashStart = Date.now();
  appData = await window.api.getData();
  window.api.getLastSaved().then(setLastSavedLabel);
  if (!appData.geocodeCache) appData.geocodeCache = {};
  if (!appData.routeCache) appData.routeCache = {};
  if (!appData.learnedCrossings) appData.learnedCrossings = [];
  if (!appData.legGpxTracks) appData.legGpxTracks = {};
  if (!appData.settings) appData.settings = {};
  if (!appData.dupIgnoredKeys) appData.dupIgnoredKeys = [];
  if (!appData.editedDismissedKeys) appData.editedDismissedKeys = [];
  if (!appData.stats) appData.stats = { bytesDeleted: 0 };
  if (!appData.hiddenSidebarSections) appData.hiddenSidebarSections = [];
  dupIgnoredKeys = new Set(appData.dupIgnoredKeys);
  editedDismissedKeys = new Set(appData.editedDismissedKeys);
  const settingsDefaults = { mapboxToken: '', useMapboxRouting: true, mapboxMonthlyCap: 8000, mapboxCallsThisMonth: 0, mapboxCallsMonthKey: '', themeMode: 'system', allowDeleteFiles: true, telemetryEnabled: false, gridCardMin: 155, sidebarWidth: 234, language: '' };
  for (const k in settingsDefaults) if (appData.settings[k] === undefined) appData.settings[k] = settingsDefaults[k];
  // Telemetry used to default on (opt-out, with a one-time "OK / Turn off" notice). It's opt-in
  // now, so everyone who hasn't answered the new yes/no question - upgraders included - starts
  // with it off until they do. See showTelemetryNotice().
  if (!appData.settings.telemetryAsked) appData.settings.telemetryEnabled = false;
  currentLang = resolveLanguage(appData.settings.language);
  applyI18n();
  applyTheme();
  applyDisplaySizes();
  // v2 migration: favorites become Best Of
  if (!appData.v2migrated) {
    appData.files.forEach(f => { if (f.favorite === true) f.bestOf = true; });
    appData.v2migrated = true;
    await window.api.saveData(appData);
  }
  if (!Array.isArray(appData.sidebarOrder) || !appData.sidebarOrder.includes('categories'))
    appData.sidebarOrder = ['trips','adventures','people','categories','cameras','locations'];
  // v3 migration: a GPS ref-byte parsing bug silently dropped the S/W sign
  // (mis-read as N/E) - re-derive from each file's real EXIF now that it's fixed.
  if (!appData.gpsSignFixed) {
    await fixGpsSigns();
    appData.gpsSignFixed = true;
    await window.api.saveData(appData);
  }
  // v4 migration: HEIC Exif (iPhone's default photo format) was never parsed at all -
  // backfill GPS/camera info for HEIC files now that main.js can read it.
  if (!appData.heicGpsBackfilled) {
    await backfillHeicGps();
    appData.heicGpsBackfilled = true;
    await window.api.saveData(appData);
  }
  // v5 migration: some folders predate parentId always being set explicitly, so it's
  // missing (undefined) rather than null. Most of the app treats those as top-level via
  // falsy checks, but a strict-equality lookup (the New Folder parent dropdown) silently
  // excluded them and everything nested under them - normalize so it can't happen elsewhere.
  if (!appData.parentIdNormalized) {
    appData.folders.forEach(f => { if (f.parentId === undefined) f.parentId = null; });
    appData.parentIdNormalized = true;
    await window.api.saveData(appData);
  }
  // v6 migration: video files' embedded location (the ©xyz ISO-6709 atom) was never
  // parsed at all - backfill GPS for videos now that main.js can read it.
  if (!appData.videoGpsBackfilled) {
    await backfillVideoGps();
    appData.videoGpsBackfilled = true;
    await window.api.saveData(appData);
  }
  // Ongoing self-healing check, not a one-time migration like the blocks above: a file's
  // cameraFolder tag can outlive the actual folder it points to - e.g. the camera folder
  // gets deleted (deleteFolderClick correctly strips the file's folder membership, but
  // leaves the "this was shot on an iPhone" metadata tag alone, since deleting a folder
  // shouldn't erase what camera actually took the photo) - which silently breaks "the iPhone
  // folder shows all my iPhone photos" forever with nothing to ever notice or re-sync it.
  // Cheap enough (a synchronous in-memory scan, no IPC per file) to just re-run every launch.
  if (await autoCreateCameraFolders(appData.files)) await window.api.saveData(appData);
  // Same idea for Live Photo pairing (see linkLivePhotoPairs() near saveData() below) - it
  // was only ever wired into the renderer's saveData() wrapper, so a library that hadn't
  // triggered so much as one star/pin/edit since the pairing feature shipped would sit there
  // with every pair still unlinked until something happened to save. Running it here too closes
  // that gap: it now also runs once up front on every launch, before the first render.
  // v8 migration: the pairing above originally matched on filename alone, which falsely
  // linked files that only coincidentally share an iPhone filename counter recycled years
  // apart (e.g. a Mexico "IMG_7097.jpeg" paired with an unrelated Iceland "IMG_7097.MOV" shot
  // seven years later) - unlink any already-saved pair that doesn't actually pass the stricter
  // date check now enforced in linkLivePhotoPairs(), and clear their livePhotoChecked flag so
  // the very next line re-evaluates them (correctly finding no match, or a real one).
  if (!appData.livePhotoDatesValidated) {
    appData.files.forEach(f => {
      if (f.isLivePhotoVideo && f.livePhotoStillId) {
        const still = appData.files.find(s => s.id === f.livePhotoStillId);
        if (!still || !livePhotoDatesMatch(still, f)) {
          if (still) { delete still.livePhotoVideoId; still.livePhotoChecked = false; }
          delete f.isLivePhotoVideo; delete f.livePhotoStillId; f.livePhotoChecked = false;
        }
      }
    });
    appData.livePhotoDatesValidated = true;
    await window.api.saveData(appData);
  }
  if (linkLivePhotoPairs()) await window.api.saveData(appData);
  // v7 migration: pre-seed Trips/People/Categories so a fresh install never looks empty in the
  // sidebar, and a curated set of starter categories exists to tap immediately rather than
  // everyone having to type "Wildlife"/"Food"/etc. themselves. Trips/People stay empty (there's
  // no sensible default trip or person) but render with a tappable empty-state CTA instead.
  if (!appData.starterCategoriesSeeded) {
    getOrCreateVacationsRoot();
    getOrCreatePeopleRoot();
    SEED_CATEGORY_NAMES.forEach(name => {
      const c = STARTER_CATEGORIES.find(sc => sc.name === name);
      const f = getOrCreateCategoryFolder(name);
      if (c) f.icon = c.icon;
    });
    appData.starterCategoriesSeeded = true;
    await window.api.saveData(appData);
  }
  // v8 migration: 'Edited' joined the seeded set after starterCategoriesSeeded had already run
  // for existing installs - backfill it once so it's not just new installs that get it.
  if (!appData.editedCategorySeeded) {
    const f = getOrCreateCategoryFolder('Edited');
    f.icon = '✨';
    appData.editedCategorySeeded = true;
    await window.api.saveData(appData);
  }
  initThumbObserver();
  renderSidebar();
  // Startup always shows the Photo Library (main page)
  selectFolder('timeline');
  setupColorSwatches();
  setupDragDrop();
  setupLasso();
  setupContextMenu();
  setupFolderContextMenu();
  setupPhotoEditorDraw();
  setupPhotoEditorMask();
  setupPhotoEditorLayers();
  setupPhotoEditorSelection();
  setupPhotoEditorPaste();
  setupPhotoModHandles();
  setupPhotoModTextEditor();
  setupPhotoModHeal();
  peApplyStaticIcons();
  setupPhotoEditorZoom();
  setupDisplayZoom();
  setupPopupVideoSpeedHold();
  setupPowerSaving();
  await hideSplash(splashStart);
  if (!appData.files.length && !appData.onboardingCompleted) openFirstRunWizard(true);
  if (appData.settings.telemetryAsked) sendTelemetryPing('app_open');
  else showTelemetryNotice();
  // Flush any pending debounced save before the window closes
  window.addEventListener('beforeunload', (e) => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; window.api.saveData(appData); }
    // Unsaved edits in either photo editor: hold the close so main can ask first
    // (will-prevent-unload in main.js), since neither editor saves as you go.
    if (peOpen && peDirty) { e.preventDefault(); e.returnValue = false; return; }
    sendTelemetryPing('session_end');
  });
  // v9: the video metadata reader only looked at the first 5 MB, but phones write location/date/
  // camera at the END of the file - so nearly every phone video came in without a location. The
  // reader is fixed (see parseVideoMeta in main.js); this re-reads the videos imported before that.
  // Runs after the first render, not before it like the migrations above: it opens every video
  // still missing a location, which on a slow or sleeping external drive kept the splash up for ages.
  if (!appData.videoMetaTailBackfilled) setTimeout(async () => {
    await backfillVideoGps();
    appData.videoMetaTailBackfilled = true;
    await window.api.saveData(appData);
  }, 1500);
  // Start geocoding in background
  setTimeout(() => geocodeFiles(), 3000);
  // Slowly backfill image dimensions in the background (Image Size / Resolution filters)
  setTimeout(() => backfillAllDimensions(), 6000);
  // Check for files whose disk paths no longer resolve (moved/renamed/deleted outside the app)
  setTimeout(() => checkMissingFiles(), 500);
  // Semantic (content) search: spin up the worker and start background-indexing the library
  // once things have settled - see semanticIndex.js.
  setTimeout(() => initSemanticIndex(), 4000);
  setTimeout(() => initFaceIndex(), 6000);
  loadMatchCache().then(() => scheduleSortCounts(15000));
  updateSortButton();
  removeAvatarLeftovers();
}

// ── MISSING FILES ─────────────────────────────────────────────────────────────
async function checkMissingFiles() {
  if (!appData.files.length) return;
  const paths = appData.files.map(f => f.path);
  const exists = await window.api.checkFilesExist(paths).catch(() => paths.map(() => true));
  let changed = false;
  appData.files.forEach((f, i) => {
    const missing = !exists[i];
    if (f._missing !== missing) changed = true;
    f._missing = missing;
  });
  // A missing Live Photo companion .mov doesn't belong in this list - the user never sees
  // it anywhere to "locate" it, and its still keeps working fine on its own either way; the
  // LIVE badge just quietly fails with the normal "file not found" toast if ever clicked.
  const missing = appData.files.filter(f => f._missing && !f.isLivePhotoVideo);
  if (changed) renderFiles();
  if (missing.length) openMissingFilesModal(missing);
}

function openMissingFilesModal(missing) {
  missingFilesList = missing;
  renderMissingFilesModal();
  document.getElementById('missingFilesModal').classList.add('open');
}

function closeMissingFilesModal() {
  document.getElementById('missingFilesModal').classList.remove('open');
  missingFilesList = [];
}

function renderMissingFilesModal() {
  const remaining = missingFilesList.filter(f => f._missing && appData.files.includes(f));
  if (!remaining.length) { closeMissingFilesModal(); return; }
  document.getElementById('missingFilesSub').textContent =
    `${remaining.length} shortcut${remaining.length !== 1 ? 's' : ''} point to files that can't be found. Locate one and Trove will look for the rest in the same folder.`;
  document.getElementById('missingFilesBody').innerHTML = remaining.map(f => `
    <div class="missing-row">
      <div class="missing-row-info">
        <div class="missing-row-name">${esc(f.name)}</div>
        <div class="missing-row-path">${esc(f.path)}</div>
      </div>
      <div class="missing-row-actions">
        <button class="btn-cancel" onclick="locateMissingFile('${f.id}')">Locate…</button>
        <button class="btn-cancel danger" onclick="removeMissingFile('${f.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

function applyRelink(file, newPath) {
  file.path = newPath;
  file.name = pathBasename(newPath);
  file.ext = pathExtname(newPath).toLowerCase();
  file._missing = false;
}

async function locateMissingFile(id) {
  const file = appData.files.find(f => f.id === id);
  if (!file) return;
  const oldDir = pathDirname(file.path);
  const picked = await window.api.pickReplacementFile(oldDir).catch(() => null);
  if (!picked) return;
  const newDir = pathDirname(picked);
  applyRelink(file, picked);

  // Auto-relink other still-missing files that shared this file's old folder,
  // if a same-named, same-size file exists in the newly chosen folder.
  const siblings = appData.files.filter(f => f.id !== file.id && f._missing && pathDirname(f.path) === oldDir);
  if (siblings.length) {
    const candidates = siblings.map(f => ({ id: f.id, name: f.name, size: f.size || 0 }));
    const matches = await window.api.findFolderMatches(newDir, candidates).catch(() => []);
    if (matches.length) {
      const byId = new Map(matches.map(m => [m.id, m.path]));
      let count = 0;
      for (const s of siblings) {
        const newPath = byId.get(s.id);
        if (newPath) { applyRelink(s, newPath); count++; }
      }
      if (count) toast(`🔗 Auto-relinked ${count} file${count !== 1 ? 's' : ''} found in the same folder`);
    }
  }
  await saveData();
  renderMissingFilesModal();
}

async function removeMissingFile(id) {
  appData.files = appData.files.filter(f => f.id !== id);
  await saveData();
  renderMissingFilesModal();
}

async function removeAllMissingFiles() {
  const ids = new Set(missingFilesList.filter(f => f._missing).map(f => f.id));
  appData.files = appData.files.filter(f => !ids.has(f.id));
  await saveData();
  closeMissingFilesModal();
  toast('🗑️ Removed missing shortcuts');
}

// ── BACKUPS ────────────────────────────────────────────────────────────────────
// Trove snapshots your library into a backups/ folder automatically (on every
// session start, and at most every 15 min while you work) - see main.js maybeSnapshot().
async function openBackupsModal() {
  backupConfirmFile = null;
  document.getElementById('backupsBody').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12.5px">Loading…</div>';
  document.getElementById('backupsModal').classList.add('open');
  const list = await window.api.listBackups().catch(() => []);
  renderBackupsModal(list);
  refreshStorageStats();
}

async function refreshStorageStats() {
  const line = document.getElementById('storageStatsLine');
  if (!line) return;
  const s = await window.api.getStorageStats().catch(() => null);
  if (!s) { line.textContent = ''; return; }
  line.textContent = `Library file: ${fmtSize(s.dataFileBytes)} · Backups: ${s.backupsCount} snapshot${s.backupsCount !== 1 ? 's' : ''}, ${fmtSize(s.backupsBytes)} (capped at ${s.maxBackups} / ${fmtSize(s.maxBackupBytes)}) · Thumbnails: ${fmtSize(s.thumbsBytes)}`;
}

async function pruneBackupsNow() {
  await window.api.pruneBackupsNow();
  const list = await window.api.listBackups().catch(() => []);
  renderBackupsModal(list);
  refreshStorageStats();
  toast('🧹 Old backups cleaned up');
}

function closeBackupsModal() {
  document.getElementById('backupsModal').classList.remove('open');
  backupConfirmFile = null;
}

function renderBackupsModal(list) {
  const body = document.getElementById('backupsBody');
  if (!list.length) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12.5px">No backups yet - one is taken automatically each time you open Trove.</div>';
    return;
  }
  body.innerHTML = list.map(b => `
    <div class="missing-row">
      <div class="missing-row-info">
        <div class="missing-row-name">${esc(new Date(b.mtime).toLocaleString())}</div>
        <div class="missing-row-path">${b.folders} folder${b.folders!==1?'s':''} · ${b.files} file${b.files!==1?'s':''}</div>
      </div>
      <div class="missing-row-actions">
        <button class="btn-cancel${backupConfirmFile===b.file?' danger':''}" onclick="restoreBackup('${b.file}')">${backupConfirmFile===b.file ? 'Confirm - Replace Everything' : 'Restore'}</button>
      </div>
    </div>
  `).join('');
}

async function restoreBackup(file) {
  if (backupConfirmFile !== file) { backupConfirmFile = file; const list = await window.api.listBackups().catch(() => []); renderBackupsModal(list); return; }
  const data = await window.api.readBackup(file);
  if (!data) { toast('⚠️ Could not read that backup'); return; }
  appData = data;
  if (!appData.geocodeCache) appData.geocodeCache = {};
  if (!appData.dupIgnoredKeys) appData.dupIgnoredKeys = [];
  if (!appData.editedDismissedKeys) appData.editedDismissedKeys = [];
  if (!appData.stats) appData.stats = { bytesDeleted: 0 };
  dupIgnoredKeys = new Set(appData.dupIgnoredKeys);
  editedDismissedKeys = new Set(appData.editedDismissedKeys);
  backupConfirmFile = null;
  closeBackupsModal();
  selectFolder('timeline');
  await saveData();
  toast('♻️ Backup restored');
}

// ── SIDEBAR ──────────────────────────────────────────────────────────────────
// One O(files + folders) pass building every folder's file count (a file counts toward
// a folder if it's assigned to that folder OR any of its descendants, matching what each
// of renderSidebarFolder/renderTripsList/renderCamerasList computed independently before -
// each used to re-scan the entire files array once per folder row, every sidebar render.
let folderFileCounts = new Map();
let editedFileCount = 0; // set in renderSidebar() before renderSidebarSections() rebuilds the DOM - see renderEditedCategoryRow
function buildFolderFileCounts() {
  const counts = new Map();
  const parentOf = new Map(appData.folders.map(f => [f.id, f.parentId || null]));
  for (const file of appData.files) {
    if (!file.folders?.length) continue;
    const seen = new Set(); // don't double-count a shared ancestor reached via two of this file's folders
    for (const fid of file.folders) {
      let id = fid;
      while (id && parentOf.has(id) && !seen.has(id)) {
        seen.add(id);
        counts.set(id, (counts.get(id) || 0) + 1);
        id = parentOf.get(id);
      }
    }
  }
  return counts;
}

function renderSidebar() {
  document.getElementById('count-bestof').textContent = appData.files.filter(f => f.bestOf).length;
  document.getElementById('count-timeline').textContent = appData.files.filter(f => isMedia(f.ext)).length;
  // Same rule as computeVisibleFiles(): a Live Photo's .mov companion is hidden behind its still
  const fileIds = new Set(appData.files.map(f => f.id));
  const toSortCount = appData.files.filter(f => f.toSort && !(f.isLivePhotoVideo && fileIds.has(f.livePhotoStillId))).length;
  const tsBadge = document.getElementById('count-tosort');
  if (tsBadge) { tsBadge.textContent = toSortCount; tsBadge.className = 'si-count' + (toSortCount > 0 ? ' count-warn' : ''); }
  editedFileCount = appData.files.filter(f => f.edits || f.versionParentId).length;

  folderFileCounts = buildFolderFileCounts();
  renderSidebarSections();

  document.querySelectorAll('#sidebar .si').forEach(el => el.classList.toggle('active', el.dataset.folder === currentFolder));

  const libEl = document.getElementById('librarySizeTagline');
  if (libEl) {
    // Missing files are left out - they're no longer on disk, so they don't count toward what Trove holds.
    let n = 0, bytes = 0;
    for (const f of appData.files) { if (f._missing) continue; n++; bytes += f.size || 0; }
    libEl.textContent = `${n.toLocaleString()} file${n === 1 ? '' : 's'} · ${bytes ? fmtSize(bytes) : '0 GB'} in Trove`;
  }

  const savedEl = document.getElementById('spaceSavedTagline');
  if (savedEl) {
    const freed = appData.stats?.bytesDeleted || 0;
    savedEl.textContent = freed ? `${fmtSize(freed)} freed` : 'Nothing freed yet';
  }
}

// Closed on every launch, regardless of any leftover _open flag in saved data - a folder
// only stays expanded for the current session once you click it open.
const openFolderIds = new Set();

function renderSidebarFolder(folder, container, depth, camIds) {
  const children = appData.folders.filter(f => f.parentId === folder.id && !camIds.has(f.id));
  const count = folderFileCounts.get(folder.id) || 0;
  const isOpen = openFolderIds.has(folder.id);
  const hasKids = children.length > 0;
  const wrap = document.createElement('div');
  const item = document.createElement('div');
  item.className = 'si' + (currentFolder === folder.id ? ' active' : '');
  item.dataset.folder = folder.id;
  item.style.paddingLeft = (8 + depth*14) + 'px';
  // People show a photo of their face where every other folder shows its colour dot.
  const isPerson = folder.parentId === PEOPLE_ROOT_ID;
  const personPic = isPerson && typeof personPictureUrl === 'function' && personPictureUrl(folder) ? folderIconHtml(folder, 20) : '';
  item.innerHTML = `
    ${hasKids ? `<button class="si-toggle ${isOpen?'open':''}" onclick="toggleFolderOpen(event,'${folder.id}')">▶</button>` : '<span style="width:14px;flex-shrink:0"></span>'}
    ${personPic ? `<span class="si-face">${personPic}</span>` : `<div class="si-dot" style="background:${folder.color||'#3d6f8f'}"></div>`}
    <span class="si-name">${isPerson ? '' : folder.iconImage ? folderIconHtml(folder) + ' ' : esc(folderEmojiPrefix(folder))}${esc(folder.name)}${esc(formatTripYearSuffix(folder))}</span>
    <span class="si-count">${count}</span>
    <button class="si-del" onclick="deleteFolderClick(event,'${folder.id}')">✕</button>`;
  item.addEventListener('click', e => {
    if (!e.target.classList.contains('si-del') && !e.target.classList.contains('si-toggle')) selectFolder(folder.id, item);
  });
  item.addEventListener('contextmenu', e => showFolderCtxMenu(e, folder.id));
  attachFolderDrag(item, folder);
  attachFolderDropTarget(item, folder.id);
  wrap.appendChild(item);
  if (hasKids) {
    const cw = document.createElement('div');
    cw.style.display = isOpen ? '' : 'none';
    cw.dataset.childOf = folder.id;
    children.forEach(c => renderSidebarFolder(c, cw, depth+1, camIds));
    wrap.appendChild(cw);
  }
  container.appendChild(wrap);
}

function getAllDesc(folderId) {
  const kids = appData.folders.filter(f => f.parentId === folderId);
  return kids.flatMap(k => [k.id, ...getAllDesc(k.id)]);
}
// All folders under a root, as {folder, label} pairs - label is just the name for a direct
// child, or a "Parent › Child" breadcrumb for anything nested deeper (e.g. "Activity › Ski"),
// so a flat chip row can still offer every subfolder, not just the top level. Used everywhere
// Guided Sort/the first-run wizard show a chip per trip/person/category - those chip rows used
// to only list direct children of Vacations/People/Categories, so a category like "Activity"
// with its own subfolders (Ski, Hiking...) had no way to file straight into the subfolder.
function getFolderChipList(rootId) {
  return getAllDesc(rootId).map(id => appData.folders.find(f => f.id === id)).filter(Boolean).map(folder => {
    const parts = [folder.name];
    let cur = folder;
    while (cur.parentId && cur.parentId !== rootId) {
      const parent = appData.folders.find(f => f.id === cur.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      cur = parent;
    }
    return { folder, label: parts.join(' › ') };
  });
}

function toggleFolderOpen(e, id) {
  e.stopPropagation();
  if (openFolderIds.has(id)) openFolderIds.delete(id); else openFolderIds.add(id);
  renderSidebar();
}

function selectFolder(folderId, el) {
  // Picking a folder means "take me there", so whatever is covering the file area closes first.
  // The editor can have unsaved work, so it goes through its own discard prompt - and if the
  // user backs out of that, so does the navigation. Its "reopen the viewer on close" hand-back
  // is dropped too, or the viewer would pop up over the folder just opened.
  if (peOpen) {
    const ret = popupReturn;
    popupReturn = null;
    closePhotoEditor().then(() => {
      if (peOpen) { popupReturn = ret; return; }
      selectFolder(folderId, el);
    });
    return;
  }
  if (gsOpen) exitGuidedSort();
  if (document.getElementById('dupMode').classList.contains('open')) closeDupMode();
  if (document.getElementById('facesMode').classList.contains('open')) closeFacesMode();
  if (document.getElementById('photoPopup').classList.contains('open')) closePhotoPopup();
  // Search ignores folder scope (see computeVisibleFiles), so leaving it in place would keep
  // showing the same results under the new folder's title.
  if (getSearchQuery()) {
    clearTimeout(searchTimer); searchTimer = null;
    document.getElementById('searchInput').value = '';
    semanticSearchToken++;
    semanticResults = { query: '', ids: [] };
    semanticResultGen++;
    updateSearchClearBtn();
  }
  if (globeOpen) toggleGlobe(); // navigating away from the globe via the sidebar always closes it
  currentFolder = folderId;
  showAllFilesHere = false;
  clearSelection();
  document.querySelectorAll('.si').forEach(i => i.classList.remove('active'));
  const target = el || document.querySelector(`[data-folder="${CSS.escape(folderId)}"]`);
  if (target) target.classList.add('active');

  let title = 'Photo Library';
  if (folderId === 'best-of') title = '⭐ Best Of';
  else if (folderId === 'all') title = 'All Files';
  else if (folderId === 'timeline') title = 'Photo Library';
  else if (folderId === 'to-sort') title = 'To Sort';
  else if (folderId === 'edited') title = '✏️ Edited';
  else if (folderId && folderId.startsWith('country:')) title = '✈️ ' + folderId.slice(8);
  else if (folderId && folderId.startsWith('region:')) {
    const s = folderId.slice(7), i = s.indexOf('|');
    title = `📍 ${s.slice(i + 1)} · ${s.slice(0, i)}`;
  }
  else if (folderId) {
    const f = appData.folders.find(f => f.id === folderId);
    if (f) title = `${folderEmojiPrefix(f)}${f.name}`;
  }
  document.getElementById('viewTitle').textContent = title;

  // Timeline shortcut: auto-switch to timeline view (and back when leaving)
  if (folderId === 'timeline' && currentView !== 'timeline') setView('timeline', false);
  if (folderId !== 'timeline' && currentView === 'timeline') setView('grid', false);

  // The Photo Library always renders as a chronological timeline (see renderFilesInner's
  // `currentFolder === 'timeline'` check) regardless of currentView, so the Grid/List/Timeline
  // toggle has nothing to actually toggle there - hide it rather than leave dead buttons.
  const viewToggle = document.getElementById('viewToggleWrap');
  if (viewToggle) viewToggle.style.display = folderId === 'timeline' ? 'none' : '';

  // Best Of has its own sort control (Newest/Oldest/By trip, in #bestOfBar) that actually
  // drives its order - see computeVisibleFiles()'s inBestOfView branch. This generic Name/
  // Size/Date dropdown doesn't apply there and was silently doing nothing while looking
  // exactly like it should work, which read as "sorting is broken."
  const sortSelectEl = document.getElementById('sortSelect');
  const sortDirBtn = document.getElementById('sortDirBtn');
  if (sortSelectEl) sortSelectEl.style.display = folderId === 'best-of' ? 'none' : '';
  if (sortDirBtn) sortDirBtn.style.display = folderId === 'best-of' ? 'none' : '';

  // Photo Library always comes back to its default (File Date, newest first) on entry,
  // regardless of whatever sort was left active in another folder - it can still be changed
  // to Name/Size/Date Added once you're actually there (see renderTimeline()).
  if (folderId === 'timeline') {
    if (sortSelectEl) sortSelectEl.value = 'filedate';
    sortDir = 'desc';
    if (sortDirBtn) sortDirBtn.textContent = '↓';
  }

  renderBreadcrumb();
  const area = document.getElementById('fileArea');
  area.innerHTML = ''; // fresh navigation: don't carry over the previous folder's paginated card count
  renderFiles();
  area.scrollTop = 0;
}

// ── BREADCRUMB ───────────────────────────────────────────────────────────────
function buildBreadcrumb(folderId) {
  const chain = [];
  let id = folderId;
  while (id) {
    const f = appData.folders.find(f => f.id === id);
    if (!f) break;
    chain.unshift(f);
    id = f.parentId;
  }
  return chain;
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  const specialFolders = ['all','timeline','to-sort','best-of','edited'];
  if (!currentFolder || specialFolders.includes(currentFolder) || currentFolder.startsWith('country:') || currentFolder.startsWith('region:')) { bc.style.display = 'none'; return; }
  const sysRootIds = new Set([...TRIP_LIKE_ROOT_IDS, appData.folders.find(f=>f.name==='Cameras'&&!f.parentId)?.id].filter(Boolean));
  const chain = buildBreadcrumb(currentFolder).filter(f => !sysRootIds.has(f.id));
  if (chain.length === 0) { bc.style.display = 'none'; return; }
  bc.style.display = 'flex';
  bc.innerHTML = '';
  const home = document.createElement('span');
  home.className = 'bc-part'; home.textContent = 'Photo Library';
  home.onclick = () => { selectFolder('timeline'); };
  bc.appendChild(home);
  chain.forEach((f, i) => {
    const sep = document.createElement('span'); sep.className = 'bc-sep'; sep.textContent = '›'; bc.appendChild(sep);
    const part = document.createElement('span');
    part.className = i === chain.length - 1 ? 'bc-current' : 'bc-part';
    part.textContent = `${folderEmojiPrefix(f)}${f.name}`;
    if (i < chain.length - 1) {
      part.onclick = () => {
        const el = document.querySelector(`[data-folder="${f.id}"]`);
        selectFolder(f.id, el);
      };
    }
    bc.appendChild(part);
  });
}

// ── SORT & FILTER ────────────────────────────────────────────────────────────
function getSearchQuery() {
  return document.getElementById('searchInput').value.toLowerCase().trim();
}

function isAssignableFolder(id) {
  return !!id && appData.folders.some(f => f.id === id);
}

// Map of folderId → owning trip name (lowercase) for all vacation descendants
function getTripNameMap() {
  const map = new Map();
  getTripLikeFolders().forEach(trip => {
    [trip.id, ...getAllDesc(trip.id)].forEach(id => map.set(id, trip.name.toLowerCase()));
  });
  return map;
}

// Map of folderId → the lowercase names of that folder AND every ancestor folder above it -
// so a file filed under Categories > Wildlife, or Vacations > Iceland 2025 > Rush > Drone, is
// found by searching "wildlife", or "iceland"/"rush"/"drone" (any level of the path), not
// just the file's own immediate folder. Strictly broader than the old trip-only version this
// replaced for search purposes (getTripNameMap still exists, unchanged, for Best Of's
// "by trip" grouping - a different, single-name-per-file use that must stay trip-scoped).
function getFolderSearchNames() {
  const map = new Map(); // folderId -> Set<lowercase name>
  appData.folders.forEach(folder => {
    const name = folder.name.toLowerCase();
    [folder.id, ...getAllDesc(folder.id)].forEach(id => {
      let set = map.get(id);
      if (!set) map.set(id, set = new Set());
      set.add(name);
    });
  });
  return map;
}

// One search token vs. every searchable field (OR across fields)
function fileMatchesToken(f, t, folderNames) {
  if (f.name.toLowerCase().includes(t)) return true;
  if (f.country && f.country.toLowerCase().includes(t)) return true;
  if (f.region && f.region.toLowerCase().includes(t)) return true;
  if (f.city && f.city.toLowerCase().includes(t)) return true;
  if (f.cameraFolder && f.cameraFolder.toLowerCase().includes(t)) return true;
  if (f.cameraMake && f.cameraMake.toLowerCase().includes(t)) return true;
  if (f.tags && f.tags.some(tag => tag.toLowerCase().includes(t))) return true;
  if (f.fileDate && String(new Date(f.fileDate).getFullYear()).includes(t)) return true;
  if (f.notes && f.notes.toLowerCase().includes(t)) return true;
  if (f.folders?.some(id => {
    const names = folderNames.get(id);
    if (!names) return false;
    for (const n of names) if (n.includes(t)) return true;
    return false;
  })) return true;
  return false;
}

// Faceted search: every whitespace-separated token must match at least one
// field (AND across tokens, OR across fields) - "fpv florida" ≡ "florida fpv"
function fileMatchesSearch(f, q, folderNames) {
  return q.split(/\s+/).filter(Boolean).every(t => fileMatchesToken(f, t, folderNames));
}

// Bumped once per saveData() call (see below) - the one funnel nearly every mutation in
// the app already goes through - so getVisibleFilesCached() below can tell "the same
// (folder, filters, search, sort) as last time, and nothing has changed since" apart from
// "the same key, but some file/folder was actually mutated," without having to track every
// individual mutation site.
let dataGen = 0;
let visCache = { key: '', gen: -1, result: null };

function getVisibleFiles() {
  const key = JSON.stringify([currentFolder, chipFilters, bestOfFilters, getSearchQuery(),
    document.getElementById('sortSelect').value, sortDir, semanticResultGen]);
  if (visCache.gen === dataGen && visCache.key === key) return visCache.result;
  const result = computeVisibleFiles();
  visCache = { key, gen: dataGen, result };
  return result;
}

function computeVisibleFiles() {
  const q = getSearchQuery();
  const by = document.getElementById('sortSelect').value;
  let files = [...appData.files];

  // Linked-version originals stay out of every normal view - only the edited file
  // they're attached to shows up; the original is still reachable from its 🌿 badge.
  const versionHiddenIds = new Set(appData.files.map(f => f.versionParentId).filter(Boolean));
  if (versionHiddenIds.size) files = files.filter(f => !versionHiddenIds.has(f.id));

  // A Live Photo's .mov companion stays out of every normal view too - only its still shows
  // up, with a LIVE badge (see renderGrid/renderList) to play the motion. Guarded on the still
  // actually still existing so deleting just the photo doesn't strand its video invisibly -
  // see linkLivePhotoPairs() (near saveData()) for how these get linked in the first place.
  const fileIdSet = new Set(appData.files.map(f => f.id));
  const livePhotoHiddenIds = new Set(
    appData.files.filter(f => f.isLivePhotoVideo && fileIdSet.has(f.livePhotoStillId)).map(f => f.id)
  );
  if (livePhotoHiddenIds.size) files = files.filter(f => !livePhotoHiddenIds.has(f.id));

  if (q) {
    // Global search ignores folder scope
  } else if (currentFolder === 'best-of') {
    files = files.filter(f => f.bestOf);
  } else if (currentFolder === 'timeline') {
    files = files.filter(f => isMedia(f.ext));
  } else if (currentFolder && currentFolder.startsWith('country:')) {
    const country = currentFolder.slice(8);
    files = files.filter(f => f.country === country);
  } else if (currentFolder && currentFolder.startsWith('region:')) {
    const s = currentFolder.slice(7), i = s.indexOf('|');
    const country = s.slice(0, i), region = s.slice(i + 1);
    files = files.filter(f => f.country === country && f.region === region);
  } else if (currentFolder === 'to-sort') {
    files = files.filter(f => f.toSort);
  } else if (currentFolder === 'edited') {
    // Smart category, not a real folder - see renderEditedCategoryRow for why membership is
    // computed here instead of via file.folders.
    files = files.filter(f => f.edits || f.versionParentId);
  } else if (currentFolder && currentFolder !== 'all') {
    const allIds = [currentFolder, ...getAllDesc(currentFolder)];
    files = files.filter(f => f.folders?.some(id => allIds.includes(id)));
  }
  // currentFolder === 'all' → all files

  // Best Of view filters
  if (!q && currentFolder === 'best-of') {
    if (bestOfFilters.type === 'photo') files = files.filter(f => isImg(f.ext));
    if (bestOfFilters.type === 'video') files = files.filter(f => isVid(f.ext));
    if (bestOfFilters.tripId) {
      const tripIds = new Set([bestOfFilters.tripId, ...getAllDesc(bestOfFilters.tripId)]);
      files = files.filter(f => f.folders?.some(id => tripIds.has(id)));
    }
    if (bestOfFilters.cameraFolder) {
      const camIds = new Set([bestOfFilters.cameraFolder, ...getAllDesc(bestOfFilters.cameraFolder)]);
      files = files.filter(f => f.folders?.some(id => camIds.has(id)));
    }
    if (bestOfFilters.year) files = files.filter(f => f.fileDate && new Date(f.fileDate).getFullYear() === +bestOfFilters.year);
  }

  // Global filter chips - photos/videos/bestOf/year/camera are skipped in Best Of view
  // itself, since bestOfFilters above already covers those (see updateFilterChips() for
  // why the corresponding chips are hidden there too). Without this, chipFilters being
  // global state that doesn't reset per-view meant a leftover selection from browsing a
  // different folder earlier would silently AND against Best Of's own filter with no
  // visible explanation for why results looked wrong or empty.
  const skipRedundantChips = !q && currentFolder === 'best-of';
  if (chipFilters.photos && !skipRedundantChips) files = files.filter(f => isImg(f.ext));
  if (chipFilters.videos && !skipRedundantChips) files = files.filter(f => isVid(f.ext));
  if (chipFilters.bestOf && !skipRedundantChips) files = files.filter(f => f.bestOf);
  if (chipFilters.pinned) files = files.filter(f => f.pinned);
  if (chipFilters.edited) files = files.filter(f => !!f.edits);
  if (chipFilters.orientation) files = files.filter(f => fileOrientation(f) === chipFilters.orientation);
  if (chipFilters.resolution) files = files.filter(f => fileResolutionTier(f) === chipFilters.resolution);
  if (chipFilters.year && !skipRedundantChips) files = files.filter(f => f.fileDate && new Date(f.fileDate).getFullYear() === +chipFilters.year);
  if (chipFilters.camera && !skipRedundantChips) {
    const camIds = new Set([chipFilters.camera, ...getAllDesc(chipFilters.camera)]);
    files = files.filter(f => f.folders?.some(id => camIds.has(id)));
  }
  if (chipFilters.tags.length) files = files.filter(f => chipFilters.tags.every(t => f.tags?.includes(t)));
  if (chipFilters.location) {
    if (chipFilters.location.startsWith('c:')) {
      const c = chipFilters.location.slice(2);
      files = files.filter(f => f.country === c);
    } else if (chipFilters.location.startsWith('r:')) {
      const s = chipFilters.location.slice(2), i = s.indexOf('|');
      const c = s.slice(0, i), r = s.slice(i + 1);
      files = files.filter(f => f.country === c && f.region === r);
    }
  }

  if (q) {
    const folderNames = getFolderSearchNames();
    const chipFilteredById = new Map(files.map(f => [f.id, f])); // same pool semantic matches must respect
    const metaMatches = files.filter(f => fileMatchesSearch(f, q, folderNames));
    semanticOnlyIds = new Set();
    let semanticMatches = [];
    if (semanticResults.query === q) {
      const metaIds = new Set(metaMatches.map(f => f.id));
      for (const id of semanticResults.ids) {
        if (metaIds.has(id) || !chipFilteredById.has(id)) continue;
        semanticMatches.push(chipFilteredById.get(id));
        semanticOnlyIds.add(id);
      }
    }
    files = [...metaMatches, ...semanticMatches];
  }

  const inBestOfView = !q && currentFolder === 'best-of';
  // Photo Library's month-grouped timeline is the other view Pinned's "float to the top"
  // shouldn't reach into below - it's meant for "top of this folder", and in a chronological
  // view spanning the whole library it instead yanks a handful of old pinned photos in front
  // of everything else, each landing in its own real month, which fragments the very start of
  // the timeline into a run of stray single-file sections before real order resumes.
  const inTimelineView = !q && (currentView === 'timeline' || currentFolder === 'timeline');
  let tripNameOf = null;
  if (inBestOfView && bestOfFilters.sort === 'bytrip') {
    const m = getTripNameMap();
    tripNameOf = f => f.folders?.map(id => m.get(id)).find(Boolean) || '~'; // '~' sorts last
  }

  // Collapse burst sequences to one card - skipped for search (don't hide a
  // specifically-searched-for frame) and Best Of (an explicitly starred frame
  // should never disappear behind a collapse).
  if (!q && !inBestOfView) {
    const { coverMap, memberToCover } = computeBurstGroups(files);
    burstCoverMap = coverMap;
    files = files.filter(f => { const cov = memberToCover.get(f.id); return !cov || cov === f.id; });
  } else {
    burstCoverMap = new Map();
  }

  files.sort((a, b) => {
    // Best Of has its own sort (Newest/Oldest/By trip, driven by bestOfFilters.sort - see
    // #bestOfBar) and isn't scoped to any one folder, so Pinned's "top of THIS folder"
    // shouldn't reach in and reorder it here either - same reasoning as excluding Best Of
    // itself from the general sort below.
    if (inBestOfView) {
      if (tripNameOf) {
        const ta = tripNameOf(a), tb = tripNameOf(b);
        if (ta !== tb) return ta < tb ? -1 : 1;
        return (b.fileDate||0) - (a.fileDate||0);
      }
      return bestOfFilters.sort === 'oldest'
        ? (a.fileDate||0) - (b.fileDate||0)
        : (b.fileDate||0) - (a.fileDate||0);
    }
    // Pinned floats to the top of its folder - the one feature actually meant to override
    // the chosen sort, outside Best Of's and Photo Library's own views above.
    if (!!a.pinned !== !!b.pinned && !inTimelineView) return a.pinned ? -1 : 1;
    // File Date falls back to Date Added when a file has no EXIF date, same as the month
    // grouping in renderTimeline/appendTimelineThumbs does - without this fallback matching,
    // an undated file sorts as if it were from 1970 while still grouping under whatever month
    // it was actually added in, fragmenting the timeline into a run of 1-file month sections.
    // Type groups by extension (the direction toggle flips A→Z), newest first inside a group.
    if (by === 'type') {
      const c = fileTypeKey(a).localeCompare(fileTypeKey(b));
      if (c) return c * (sortDir==='asc'?1:-1);
      return (b.fileDate||b.addedAt||0) - (a.fileDate||a.addedAt||0);
    }
    const va = by==='name'?a.name.toLowerCase():by==='size'?(a.size||0):by==='added'?(a.addedAt||0):(a.fileDate||a.addedAt||0);
    const vb = by==='name'?b.name.toLowerCase():by==='size'?(b.size||0):by==='added'?(b.addedAt||0):(b.fileDate||b.addedAt||0);
    return (va<vb?-1:va>vb?1:0) * (sortDir==='asc'?1:-1);
  });
  return files;
}

function getDirectChildren(folderId) {
  if (!folderId || ['all','timeline','to-sort','best-of','edited'].includes(folderId) || folderId.startsWith('country:') || folderId.startsWith('region:')) return [];
  const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const vacRoot = appData.folders.find(f => f.id === 'vacations-root');
  const systemIds = new Set([
    ...(camRoot ? [camRoot.id, ...getAllDesc(camRoot.id)] : []),
    ...(vacRoot ? [vacRoot.id] : []),
    ADVENTURES_ROOT_ID,
  ]);
  return appData.folders.filter(f => f.parentId === folderId && !systemIds.has(f.id));
}

function toggleSortDir() {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  document.getElementById('sortDirBtn').textContent = sortDir === 'asc' ? '↑' : '↓';
  renderFiles();
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function renderFiles() {
  const area = document.getElementById('fileArea');
  const savedScroll = area.scrollTop;
  const renderedCount = area.querySelectorAll('.file-card, .file-row, .tl-thumb').length;
  renderFilesInner(area, renderedCount);
  area.scrollTop = savedScroll;
}

function renderFilesInner(area, renderedCount = 0) {
  // Re-init observer each render (handles scroll container change)
  initThumbObserver();
  updateBestOfBar();
  updateFilterChips();
  updateSearchClearBtn();

  const q = getSearchQuery();
  const files = getVisibleFiles();
  currentViewImages = files.filter(f => isMedia(f.ext));

  // Timeline view
  if (!q && (currentView === 'timeline' || currentFolder === 'timeline')) {
    renderTimeline(files, area, renderedCount);
    return;
  }

  // Search mode - flat global results with folder path under each name
  if (q) {
    area.innerHTML = '<div id="lasso"></div>';
    // Content search only ever covers what's been indexed so far - a query that looks
    // unmatched while the library is still being learned isn't necessarily "not there",
    // just "not reached yet". Only worth mentioning when it's plausibly the explanation.
    const semProg = typeof getSemanticProgress === 'function' ? getSemanticProgress() : null;
    const semHint = (semProg && !semProg.complete)
      ? `<div class="search-index-hint">🧠 Still learning your library's content (${semProg.indexed.toLocaleString()} / ${semProg.total.toLocaleString()} indexed) - content matches will improve as this finishes.</div>`
      : '';
    if (!files.length) {
      area.innerHTML += `<div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No results</div>
        ${semHint}
        <button class="empty-btn" onclick="clearSearch()">✕ Clear search</button></div>`;
      return;
    }
    const info = document.createElement('div');
    info.className = 'search-info';
    info.innerHTML = `🔍 <strong>${files.length}</strong> result${files.length!==1?'s':''} for “${esc(q)}”
      <button class="search-clear-inline" onclick="clearSearch()">✕ Clear search</button>${semHint}`;
    area.appendChild(info);
    if (currentView === 'list') renderList(files, area, renderedCount); else renderGrid(files, area, renderedCount);
    return;
  }

  // Best Of master view
  if (currentFolder === 'best-of') {
    area.innerHTML = '<div id="lasso"></div>';
    if (!files.length) {
      area.innerHTML += `<div class="empty-state">
        <div class="empty-icon">⭐</div>
        <div class="empty-title">No Best Of picks${(bestOfFilters.type!=='all'||bestOfFilters.tripId||bestOfFilters.cameraFolder||bestOfFilters.year)?' match these filters':' yet'}</div>
        <div class="empty-sub">Right-click any file → “⭐ Add to Best Of” to build your highlight reel</div></div>`;
      return;
    }
    if (currentView === 'list') renderList(files, area, renderedCount); else renderGrid(files, area, renderedCount);
    return;
  }

  // Non-leaf folder - ONLY sub-folder cards, with optional "Show all files ↓"
  const children = getDirectChildren(currentFolder);
  if (children.length > 0) {
    area.innerHTML = '<div id="lasso"></div>';
    const head = document.createElement('div');
    head.className = 'area-head';
    head.innerHTML = `<span class="subf-section-label" style="margin:0">📁 ${children.length} folder${children.length!==1?'s':''}</span>
      ${files.length ? `<button class="files-here-btn" style="margin:0" onclick="toggleShowAllFiles()">${showAllFilesHere ? 'Hide files ↑' : `Show all files ↓ (${files.length})`}</button>` : ''}`;
    area.appendChild(head);
    renderFolderCardGrid(children, area);
    if (showAllFilesHere && files.length) {
      if (currentView === 'list') renderList(files, area, renderedCount); else renderGrid(files, area, renderedCount);
    }
    return;
  }

  // Leaf folder / flat lists - files
  if (files.length === 0) {
    if (currentFolder === 'to-sort') {
      area.innerHTML = `<div id="lasso"></div>
      <div class="fr-dropzone to-sort-dropzone" onclick="addFiles()">
        <div class="fr-dropzone-icon">📥</div>
        <div class="empty-title">All sorted - nothing left here!</div>
        <div class="empty-sub">Add a batch of files and Trove auto-sorts them by camera. Files it can't recognise land here for you to sort manually.</div>
        <div class="to-sort-dropzone-cta">Click to add files, or drag &amp; drop them anywhere</div>
      </div>`;
      return;
    }
    if (currentFolder === 'edited') {
      area.innerHTML = `<div id="lasso"></div><div class="empty-state">
        <div class="empty-icon">✏️</div>
        <div class="empty-title">No edited files yet</div>
        <div class="empty-sub">Files you edit in Trove's own editor, or link as an edited version via Sort → Find duplicates &amp; edits, show up here automatically.</div>
      </div>`;
      return;
    }
    area.innerHTML = `<div id="lasso"></div><div class="empty-state">
      <div class="empty-icon">📂</div>
      <div class="empty-title">No files here</div>
      <div class="empty-sub">Drag & drop files or click Add Files</div>
    </div>`;
    return;
  }

  area.innerHTML = '<div id="lasso"></div>';

  if (currentFolder === 'to-sort') {
    const banner = document.createElement('div');
    banner.className = 'dump-banner';
    banner.innerHTML = `📥 <strong style="color:var(--gold)">${files.length} file${files.length!==1?'s':''} to review</strong> - camera folders shown on cards are <em>suggestions</em>. Reassign via Folders, then select all &amp; click <strong>✓ Sorted</strong>
      <button class="dump-banner-btn dump-sort-btn" style="margin-left:0" onclick="enterGuidedSort()">🧭 Help me sort</button>
      <button class="dump-banner-btn" onclick="enterSmartMatch()" title="Reviews only the photos it's very confident about, one at a time - learned from how you've already organized your own folders">✨ Smart Match</button>`;
    area.appendChild(banner);
  }

  if (currentView === 'grid') renderGrid(files, area, renderedCount);
  else renderList(files, area, renderedCount);
}

function toggleShowAllFiles() {
  showAllFilesHere = !showAllFilesHere;
  renderFiles();
}

// ── HOME VIEW ────────────────────────────────────────────────────────────────
// ── FOLDER COVER CARDS ───────────────────────────────────────────────────────
function getFolderCoverFile(folderId) {
  const folder = appData.folders.find(f => f.id === folderId);
  if (folder?.coverFileId) {
    const chosen = appData.files.find(f => f.id === folder.coverFileId);
    if (chosen) return chosen;
  }
  const ids = new Set([folderId, ...getAllDesc(folderId)]);
  const media = appData.files.filter(f => isMedia(f.ext) && !f.isLivePhotoVideo && f.folders?.some(id => ids.has(id)));
  if (!media.length) return null;
  return media.find(f => f.bestOf)
      || media.find(f => f.pinned)
      || media.reduce((best, f) => ((f.fileDate||0) > (best.fileDate||0) ? f : best));
}

function getFolderDateRange(folderId) {
  const ids = new Set([folderId, ...getAllDesc(folderId)]);
  let min = Infinity, max = -Infinity;
  for (const f of appData.files) {
    if (!f.fileDate || !f.folders?.some(id => ids.has(id))) continue;
    if (f.fileDate < min) min = f.fileDate;
    if (f.fileDate > max) max = f.fileDate;
  }
  return min === Infinity ? null : { min, max };
}

function fmtDateRange(range) {
  if (!range) return '';
  const a = fmtDate(range.min), b = fmtDate(range.max);
  return a === b ? a : `${a} – ${b}`;
}

function renderFolderCardGrid(folders, area) {
  const grid = document.createElement('div');
  grid.className = 'folder-card-grid';
  folders.forEach(f => {
    const ids = new Set([f.id, ...getAllDesc(f.id)]);
    const folderFiles = appData.files.filter(file => file.folders?.some(id => ids.has(id)));
    const bestCount = folderFiles.filter(file => file.bestOf).length;
    const range = fmtDateRange(getFolderDateRange(f.id));
    const card = document.createElement('div');
    card.className = 'folder-cardv2';
    card.dataset.folderCard = f.id;
    card.innerHTML = `
      <div class="fcv2-cover" style="background:linear-gradient(135deg,${f.color||'#3d6f8f'}33,var(--bg3))"><span class="fcv2-fallback">${esc(folderEmoji(f))}</span></div>
      ${bestCount ? `<div class="fcv2-badge">⭐ ${bestCount}</div>` : ''}
      <div class="fcv2-overlay">
        <div class="fcv2-name">${esc(folderEmojiPrefix(f))}<span class="fcv2-name-text">${esc(f.name)}</span></div>
        <div class="fcv2-meta">${range ? esc(range)+' · ' : ''}${folderFiles.length} file${folderFiles.length!==1?'s':''}</div>
      </div>`;
    card.onclick = () => selectFolder(f.id);
    card.addEventListener('contextmenu', e => showFolderCtxMenu(e, f.id));
    grid.appendChild(card);
    const cover = getFolderCoverFile(f.id);
    if (cover) {
      getThumb(cover).then(url => {
        if (!url || !card.isConnected) return;
        card.querySelector('.fcv2-cover').innerHTML = `<img src="${url}" alt="" decoding="async"/>`;
      });
    }
  });
  area.appendChild(grid);
}

// ── BEST OF FILTER BAR ───────────────────────────────────────────────────────
function fillSelect(sel, options, value) {
  sel.innerHTML = '';
  options.forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    sel.appendChild(o);
  });
  sel.value = value || '';
}

function updateBestOfBar() {
  const bar = document.getElementById('bestOfBar');
  if (!bar) return;
  if (currentFolder !== 'best-of' || getSearchQuery()) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.querySelectorAll('.bof-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === bestOfFilters.type));
  const trips = getTripLikeFolders();
  fillSelect(document.getElementById('bofTrip'), [['', trips.some(isAdventureFolder) ? 'All trips & adventures' : 'All trips'], ...trips.map(t => [t.id, t.name])], bestOfFilters.tripId);
  const camRoot0 = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const bofCams = camRoot0
    ? appData.folders.filter(f => f.parentId === camRoot0.id && appData.files.some(file => file.bestOf && file.folders?.includes(f.id)))
    : [];
  fillSelect(document.getElementById('bofCamera'), [['','All cameras'], ...bofCams.map(c => [c.id, c.name])], bestOfFilters.cameraFolder);
  const years = [...new Set(appData.files.filter(f => f.bestOf && f.fileDate).map(f => new Date(f.fileDate).getFullYear()))].sort((a,b) => b-a);
  fillSelect(document.getElementById('bofYear'), [['','All years'], ...years.map(y => [String(y), String(y)])], String(bestOfFilters.year || ''));
  document.getElementById('bofSort').value = bestOfFilters.sort;
}

function setBestOfType(t) { bestOfFilters.type = t; renderFiles(); }

function onBestOfFilterChange() {
  bestOfFilters.tripId = document.getElementById('bofTrip').value;
  bestOfFilters.cameraFolder = document.getElementById('bofCamera').value;
  bestOfFilters.year = document.getElementById('bofYear').value;
  bestOfFilters.sort = document.getElementById('bofSort').value;
  renderFiles();
}

// Exports exactly what's currently on screen in Best Of (respecting the type/trip/
// camera/year filters above) as real file copies plus a static gallery page - see
// main.js's export-best-of-album handler for why this is the one place Trove
// deliberately copies files instead of just linking to them.
async function exportBestOfAlbum() {
  const files = getVisibleFiles();
  if (!files.length) { toast('⚠️ No Best Of files to export'); return; }
  const trips = getTripLikeFolders();
  const payload = files.map(f => {
    const trip = trips.find(t => f.folders?.includes(t.id));
    const caption = [fmtDate(f.fileDate), trip?.name].filter(Boolean).join(' · ');
    return { path: f.path, name: f.name, isVideo: isVid(f.ext), caption };
  });
  const title = bestOfFilters.tripId
    ? (trips.find(t => t.id === bestOfFilters.tripId)?.name || 'Best Of')
    : 'Best Of';
  toast(`⬇ Exporting ${payload.length} file${payload.length !== 1 ? 's' : ''}…`);
  const res = await window.api.exportBestOfAlbum(payload, title);
  if (!res?.success) { toast('Export cancelled'); return; }
  toast(`✅ Exported ${res.count} file${res.count !== 1 ? 's' : ''}${res.skipped ? ` (${res.skipped} missing, skipped)` : ''}`);
}

// ── SEARCH & FILTER CHIPS ────────────────────────────────────────────────────
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    renderFiles();
    runSemanticSearch(getSearchQuery()); // resolves later and re-renders once results land - see semanticIndex.js
  }, 200);
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  semanticSearchToken++; // supersede any in-flight query embedding
  semanticResults = { query: '', ids: [] };
  semanticResultGen++;
  renderFiles();
}

function updateSearchClearBtn() {
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.style.display = document.getElementById('searchInput').value ? '' : 'none';
}

function updateFilterChips() {
  // Best Of has its own Photos/Videos/trip/camera/year controls (bestOfBar) that already
  // drive its filtering (see computeVisibleFiles()'s Best Of view filters block) - these
  // global equivalents were staying visible AND still applying on top, as an unintentional
  // AND with whatever bestOfFilters had set (e.g. a leftover chipFilters.year from browsing
  // a different folder earlier could silently zero out Best Of's own year filter). Hidden
  // here, same as the camera/location chips are already hidden when they'd be redundant.
  const inBestOfFolder = currentFolder === 'best-of';
  ['photos','videos','bestOf'].forEach(name => {
    const el = document.querySelector(`#filterChips [data-chip="${name}"]`);
    if (el) el.style.display = inBestOfFolder ? 'none' : '';
  });
  document.querySelectorAll('#filterChips .chip[data-chip]').forEach(c => c.classList.toggle('active', !!chipFilters[c.dataset.chip]));
  const sel = document.getElementById('chipYear');
  if (sel) sel.style.display = inBestOfFolder ? 'none' : '';
  if (sel && !inBestOfFolder && document.activeElement !== sel) {
    const years = [...new Set(appData.files.filter(f => f.fileDate).map(f => new Date(f.fileDate).getFullYear()))].sort((a,b) => b-a);
    fillSelect(sel, [['','Any year'], ...years.map(y => [String(y), String(y)])], String(chipFilters.year || ''));
  }
  if (sel) sel.classList.toggle('active', !!chipFilters.year);

  // Device filter - lists the actual folders under Cameras (both auto-created from
  // detected brands and any you made yourself, e.g. a custom "FPV" folder), and
  // filters by real folder membership rather than the auto-detected cameraFolder
  // string - that string is never set for a manually-organized folder, which is
  // why custom camera folders used to be unselectable here. Hidden inside a
  // camera folder, where it's redundant (you're already scoped to one device) -
  // use the location filter there instead. Also hidden in Best Of - see above.
  const camSel = document.getElementById('chipCamera');
  if (camSel) {
    const inCameraFolder = !!currentFolder && buildBreadcrumb(currentFolder).some(f => f.name === 'Cameras' && !f.parentId);
    camSel.style.display = (inCameraFolder || inBestOfFolder) ? 'none' : '';
    if (!inCameraFolder && !inBestOfFolder && document.activeElement !== camSel) {
      const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
      const camFolders = camRoot ? appData.folders.filter(f => f.parentId === camRoot.id) : [];
      fillSelect(camSel, [['','Any device'], ...camFolders.map(c => [c.id, c.name])], chipFilters.camera);
    }
    camSel.classList.toggle('active', !!chipFilters.camera);
  }

  // Location filter - country (and indented regions) dropdown. Combines with
  // the current folder scope (AND), so e.g. Cameras→DJI + Iceland works.
  // Hidden inside a By Location view, where it's redundant.
  const locSel = document.getElementById('chipLocation');
  if (locSel) {
    const inLocationView = !!currentFolder && (currentFolder.startsWith('country:') || currentFolder.startsWith('region:'));
    locSel.style.display = inLocationView ? 'none' : '';
    if (!inLocationView && document.activeElement !== locSel) {
      const countries = new Map();
      for (const f of appData.files) {
        if (!f.country) continue;
        let c = countries.get(f.country);
        if (!c) countries.set(f.country, c = { count: 0, regions: new Set() });
        c.count++;
        if (f.region) c.regions.add(f.region);
      }
      const opts = [['', 'Any location']];
      [...countries.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([name, info]) => {
        opts.push(['c:' + name, '🌍 ' + name]);
        [...info.regions].sort().forEach(r => opts.push([`r:${name}|${r}`, ' 📍 ' + r]));
      });
      fillSelect(locSel, opts, chipFilters.location);
      if (locSel.value !== chipFilters.location) chipFilters.location = locSel.value; // stale location vanished
    }
    locSel.classList.toggle('active', !!chipFilters.location);
  }

  // Tag chips - one toggleable chip per distinct tag in the library (AND when multiple active).
  // "Drone" is left out: it's redundant with the device filter above (select the drone's
  // camera folder there instead). "Panorama" is left out too: it was a filename-guess tag
  // ("PANO..."), now redundant with (and less accurate than) the Image Size → Panorama
  // filter above, which goes by real aspect ratio - keeping both just meant two
  // similarly-named "Panorama" controls sitting right next to each other in the same menu.
  const tagHost = document.getElementById('moreFiltersTags');
  if (tagHost) {
    const allTags = [...new Set(appData.files.flatMap(f => f.tags || []))].filter(t => t !== 'Drone' && t !== 'Panorama').sort();
    chipFilters.tags = chipFilters.tags.filter(t => allTags.includes(t));
    tagHost.innerHTML = '';
    allTags.forEach(t => {
      const b = document.createElement('button');
      b.className = 'chip' + (chipFilters.tags.includes(t) ? ' active' : '');
      b.textContent = '🏷 ' + t;
      b.onclick = () => toggleTagChip(t);
      tagHost.appendChild(b);
    });
  }

  const orientSel = document.getElementById('chipOrientation');
  if (orientSel) orientSel.classList.toggle('active', !!chipFilters.orientation);
  const resSel = document.getElementById('chipResolution');
  if (resSel) resSel.classList.toggle('active', !!chipFilters.resolution);

  // "Filter" button shows active state whenever a filter hidden inside it is in effect,
  // so collapsing the menu never hides the fact that a filter is still applied.
  const moreBtn = document.getElementById('moreFiltersBtn');
  if (moreBtn) {
    const hiddenFilterActive = (!inBestOfFolder && (chipFilters.photos || chipFilters.videos || chipFilters.bestOf || chipFilters.year || chipFilters.camera)) || chipFilters.pinned || chipFilters.edited || chipFilters.location || chipFilters.orientation || chipFilters.resolution || chipFilters.tags.length > 0;
    moreBtn.classList.toggle('active', hiddenFilterActive);
  }
}

function toggleMoreFilters(e) {
  e.stopPropagation();
  document.getElementById('moreFiltersMenu').classList.toggle('open');
}

function toggleTagChip(tag) {
  const i = chipFilters.tags.indexOf(tag);
  if (i >= 0) chipFilters.tags.splice(i, 1); else chipFilters.tags.push(tag);
  renderFiles();
}

function onChipCamera() {
  chipFilters.camera = document.getElementById('chipCamera').value;
  renderFiles();
}

function onChipLocation() {
  chipFilters.location = document.getElementById('chipLocation').value;
  renderFiles();
}

function onChipOrientation() {
  const pool = getVisibleFiles(); // what's visible *before* the new filter value applies - that's the set worth backfilling, since a fresh filter matches nothing until these are known
  chipFilters.orientation = document.getElementById('chipOrientation').value;
  ensureDimensionsFor(pool);
  renderFiles();
}

function onChipResolution() {
  const pool = getVisibleFiles();
  chipFilters.resolution = document.getElementById('chipResolution').value;
  ensureDimensionsFor(pool);
  renderFiles();
}

function toggleChip(name) {
  chipFilters[name] = !chipFilters[name];
  if (name === 'photos' && chipFilters.photos) chipFilters.videos = false;
  if (name === 'videos' && chipFilters.videos) chipFilters.photos = false;
  renderFiles();
}

function onChipYear() {
  chipFilters.year = document.getElementById('chipYear').value;
  renderFiles();
}

// Folder path label shown under file names in search results
function getFilePathLabel(file) {
  if (!file.folders?.length) return '📥 Unsorted';
  const tripIds = getTripLikeDescendantIds();
  const fid = file.folders.find(id => tripIds.has(id)) || file.folders[0];
  const chain = buildBreadcrumb(fid).filter(f => !isTripLikeRootId(f.id) && !(f.name === 'Cameras' && !f.parentId));
  return chain.map(f => `${folderEmojiPrefix(f)}${f.name}`).join(' › ') || '📥 Unsorted';
}

function renderGrid(files, area, minCount = 0) {
  const wrap = document.createElement('div');
  wrap.className = 'files-grid';
  wrap.id = 'filesGrid';
  area.appendChild(wrap);
  setupEvictionObserver(populateGridCard);
  const initial = Math.min(files.length, Math.max(PAGE_SIZE, minCount));
  appendGridCards(files.slice(0, initial), wrap);
  if (files.length > initial) {
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    area.appendChild(sentinel);
    setupPageObserver(sentinel, files, wrap, appendGridCards, initial);
  }
}

// Fills (or refills, after eviction) a card's content for the given file - kept separate
// from appendGridCards so the eviction observer can rebuild an off-screen card's content
// without re-creating the element or its listeners. See setupEvictionObserver above.
function populateGridCard(card, file) {
  const searchOn = !!getSearchQuery();
  const isSel = selectedIds.has(file.id);
  card.className = 'file-card' + (file._missing?' file-missing':'') + (isSel?' selected':'');
  const thumbContainer = `<div class="file-card-thumb${(isMedia(file.ext)&&!file._missing)?' thumb-loading':''}" data-thumb-for="${file.id}" id="th-${file.id}">
      <span class="thumb-icon${file._missing?' thumb-icon-missing':''}" title="${file._missing?'File not found on disk':''}">${file._missing?'🚫':getEmoji(file.ext)}</span>
      ${isVid(file.ext)?'<div class="video-badge">▶ VIDEO</div>':''}
    </div>`;
  card.innerHTML = `
    <div class="sel-check">✓</div>
    ${file._missing?'<div class="missing-badge">Missing</div>':''}
    ${burstCoverMap.has(file.id)?`<div class="burst-badge" title="Burst of ${burstCoverMap.get(file.id).count} - click to pick a favorite" onclick="event.stopPropagation();openBurstReview('${file.id}')">🎞 ${burstCoverMap.get(file.id).count}</div>`:''}
    <button class="file-card-star ${file.bestOf?'starred':''}" title="${file.bestOf?'Remove from Best Of':'Add to Best Of'}" onclick="toggleBestOf(event,'${file.id}')">${file.bestOf?'⭐':'☆'}</button>
    ${file.edits?'<div class="edited-badge" title="Edited">✏️</div>':''}
    ${searchOn&&semanticOnlyIds.has(file.id)?'<div class="semantic-badge" title="Matched by visual content, not filename/tags">🧠</div>':''}
    ${file.versionParentId?`<div class="version-badge" title="Has a linked original - click to view versions" onclick="event.stopPropagation();openVersionModal('${file.id}')">🌿</div>`:''}
    ${file.livePhotoVideoId?`<div class="live-badge" title="Live Photo - click to play the motion" onclick="event.stopPropagation();playLivePhoto('${file.id}')">◎ LIVE</div>`:''}
    ${file.gps?'<div class="gps-badge">📍</div>':''}
    ${file.pinned?'<div class="pin-badge">📌</div>':''}
    ${badge360Html(file)}
    ${thumbContainer}
    <div class="file-card-body">
      <div class="file-card-name" title="${esc(file.name)}" onclick="event.stopPropagation();startInlineFileRename('${file.id}',this)">${esc(file.name)}</div>
      ${searchOn?`<div class="file-card-path">${esc(getFilePathLabel(file))}</div>`:''}
      <div class="file-card-meta">${fmtSize(file.size)} · ${fmtDate(file.fileDate||file.addedAt)}</div>
      ${(file.cameraFolder||file.cameraMake)?`<div class="file-card-cam">📷 ${esc(file.cameraFolder||file.cameraMake)}</div>`:''}
    </div>`;
  if (isMedia(file.ext)) {
    const thumbEl = card.querySelector('[data-thumb-for]');
    if (thumbEl) observeThumb(thumbEl);
  }
}

// ── Sort by Type: group headers ─────────────────────────────────────────────
// Grid, List and the flat Photo Library layout all page files in batches, so the header for a
// group goes in whenever the extension changes from the last card appended to that container
// (remembered on the container itself, which every full re-render replaces). The count and
// Select all cover the whole group in the current view, not just the cards scrolled in so far.
const FILE_TYPE_DESCRIPTIONS = {
  '.lrv': 'Low-res preview videos', '.thm': 'Camera thumbnails', '.insv': '360 videos', '.insp': '360 photos',
  '.jpg': 'Photos', '.jpeg': 'Photos', '.jpe': 'Photos', '.jfif': 'Photos', '.heic': 'Photos', '.heif': 'Photos', '.hif': 'Photos',
  '.avif': 'Images', '.png': 'Images', '.apng': 'Animations', '.webp': 'Images', '.gif': 'Animations', '.bmp': 'Images',
  '.tif': 'TIFF images', '.tiff': 'TIFF images', '.jxl': 'JPEG XL images', '.jxr': 'JPEG XR images',
  '.360': '360 videos', '.mts': 'Camcorder videos', '.m2ts': 'Camcorder videos', '.vob': 'DVD videos',
};
function fileTypeDescription(ext) {
  return FILE_TYPE_DESCRIPTIONS[ext] || (TroveMedia.RAW.has(ext) ? 'RAW photos' : isVid(ext) ? 'Videos' : null);
}
function fileTypeKey(f) { return (f.ext || '').toLowerCase(); }
function maybeAppendTypeHeader(file, container) {
  if (document.getElementById('sortSelect')?.value !== 'type') return;
  const key = fileTypeKey(file);
  if (container.dataset.lastType === key) return;
  container.dataset.lastType = key;
  const count = getVisibleFiles().filter(f => fileTypeKey(f) === key).length;
  const label = key ? key.slice(1).toUpperCase() : 'NO EXTENSION';
  const desc = fileTypeDescription(key) || '';
  const header = document.createElement('div');
  header.className = 'type-group-header';
  header.innerHTML = `<span class="type-group-ext">${esc(label)}</span>${desc ? `<span class="type-group-desc">${esc(desc)}</span>` : ''}
    <span class="type-group-count">${count} file${count === 1 ? '' : 's'}</span>
    <button class="type-group-select" title="Select every ${esc(label)} file in this view (Ctrl-click to add to the current selection)">Select all ${count}</button>`;
  header.querySelector('button').addEventListener('click', e => { e.stopPropagation(); selectFilesOfType(key, e.ctrlKey || e.metaKey); });
  container.appendChild(header);
}
function selectFilesOfType(key, additive) {
  if (!additive) selectedIds.clear();
  getVisibleFiles().forEach(f => { if (fileTypeKey(f) === key) selectedIds.add(f.id); });
  updateSelectionUI();
}

function appendGridCards(fileSlice, container) {
  for (const file of fileSlice) {
    maybeAppendTypeHeader(file, container);
    const card = document.createElement('div');
    card.dataset.fileId = file.id;
    populateGridCard(card, file);
    card.draggable = true;
    card.addEventListener('dragstart', e => handleFileDragStart(e, file.id));
    card.addEventListener('click', e => handleCardClick(e, file.id));
    card.addEventListener('dblclick', () => isMedia(file.ext) ? openMediaCluster(file) : openFileById(file.id));
    card.addEventListener('contextmenu', e => showCtxMenu(e, file.id));
    container.appendChild(card);
    observeEviction(card);
  }
}

function renderList(files, area, minCount = 0) {
  const wrap = document.createElement('div');
  wrap.className = 'files-list';
  wrap.id = 'filesList';
  area.appendChild(wrap);
  setupEvictionObserver(populateListRow);
  const initial = Math.min(files.length, Math.max(PAGE_SIZE, minCount));
  appendListRows(files.slice(0, initial), wrap);
  if (files.length > initial) {
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    area.appendChild(sentinel);
    setupPageObserver(sentinel, files, wrap, appendListRows, initial);
  }
}

// Fills (or refills, after eviction) a row's content for the given file - kept separate
// from appendListRows so the eviction observer can rebuild an off-screen row's content
// without re-creating the element or its listeners. See setupEvictionObserver above.
function populateListRow(row, file) {
  const searchOn = !!getSearchQuery();
  const isSel = selectedIds.has(file.id);
  row.className = 'file-row' + (file._missing?' file-missing':'') + (isSel?' selected':'');
  row.innerHTML = `
    <div class="file-row-thumb${(isMedia(file.ext)&&!file._missing)?' thumb-loading':''}" data-thumb-for="${file.id}" id="th-${file.id}"><span class="${file._missing?'thumb-icon-missing':''}" title="${file._missing?'File not found on disk':''}">${file._missing?'🚫':getEmoji(file.ext)}</span></div>
    <div class="file-row-info">
      <div class="file-row-name" onclick="event.stopPropagation();startInlineFileRename('${file.id}',this)">${esc(file.name)}${file.edits?' <span class="edited-badge" style="position:static;display:inline-block" title="Edited">✏️</span>':''}${searchOn&&semanticOnlyIds.has(file.id)?' <span class="semantic-badge" style="position:static;display:inline-block" title="Matched by visual content, not filename/tags">🧠</span>':''}${file.versionParentId?` <span class="version-badge" style="position:static;display:inline-block" title="Has a linked original - click to view versions" onclick="event.stopPropagation();openVersionModal('${file.id}')">🌿</span>`:''}${file.livePhotoVideoId?` <span class="live-badge" style="position:static;display:inline-block" title="Live Photo - click to play the motion" onclick="event.stopPropagation();playLivePhoto('${file.id}')">◎ LIVE</span>`:''}${burstCoverMap.has(file.id)?` <span class="burst-badge" style="position:static;display:inline-block" title="Burst of ${burstCoverMap.get(file.id).count} - click to pick a favorite" onclick="event.stopPropagation();openBurstReview('${file.id}')">🎞 ${burstCoverMap.get(file.id).count}</span>`:''}</div>
      <div class="file-row-path">${esc(searchOn ? getFilePathLabel(file) : file.path)}</div>
      ${(file.cameraFolder||file.cameraMake)?`<div class="file-row-cam">📷 ${esc(file.cameraFolder||file.cameraMake)}</div>`:''}
    </div>
    <div class="file-row-date">${fmtDate(file.fileDate||file.addedAt)}</div>
    <div class="file-row-size">${fmtSize(file.size)}</div>
    <button class="file-row-star ${file.bestOf?'starred':''}" title="${file.bestOf?'Remove from Best Of':'Add to Best Of'}" onclick="toggleBestOf(event,'${file.id}')">${file.bestOf?'⭐':'☆'}</button>
    ${file.pinned?'<span class="file-row-pin pinned" style="pointer-events:none" title="Pinned">📌</span>':''}`;
  if (isMedia(file.ext)) {
    const thumbEl = row.querySelector('[data-thumb-for]');
    if (thumbEl) observeThumb(thumbEl);
  }
}

function appendListRows(fileSlice, container) {
  for (const file of fileSlice) {
    maybeAppendTypeHeader(file, container);
    const row = document.createElement('div');
    row.dataset.fileId = file.id;
    populateListRow(row, file);
    row.draggable = true;
    row.addEventListener('dragstart', e => handleFileDragStart(e, file.id));
    row.addEventListener('click', e => handleCardClick(e, file.id));
    row.addEventListener('dblclick', () => isMedia(file.ext) ? openMediaCluster(file) : openFileById(file.id));
    row.addEventListener('contextmenu', e => showCtxMenu(e, file.id));
    container.appendChild(row);
    observeEviction(row);
  }
}

// ── TIMELINE VIEW ────────────────────────────────────────────────────────────
// One continuous scroll of every photo, newest first, grouped into month
// sections whose header sticks to the top of #fileArea while its section is
// in view (pure CSS position:sticky - no scroll-position JS to keep in sync),
// getting pushed off by the next month's header - the Apple Photos effect.
//
// Paginated the same way renderGrid/renderList are (PAGE_SIZE-at-a-time via
// setupPageObserver, see :239-254) - this is the app's default landing view, so
// unlike Grid/List it used to build one DOM node per file in the whole library
// synchronously on every launch regardless of library size.
// Whether appendTimelineThumbs below groups into month sections (File Date/Date Added sort)
// or lays everything out as one flat grid in the given order (Name/Size sort, where grouping
// by month would fragment into dozens of out-of-sequence mini-sections instead of actually
// reflecting the chosen sort) - set fresh by renderTimeline on every call, then read by both
// its own initial call and the later incremental calls the scroll IntersectionObserver makes.
let tlGroupByMonth = true;

function renderTimeline(files, area, minCount = 0) {
  if (!files.length) {
    area.innerHTML = `<div id="lasso"></div><div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">No media yet</div><div class="empty-sub">Drag &amp; drop files or click Add Files</div></div>`;
    return;
  }

  // files already comes fully sorted (by/direction, pinned-first) from computeVisibleFiles -
  // trust that order instead of re-sorting to a hardcoded newest-first here, which used to
  // silently undo whatever the sort dropdown/direction toggle said.
  const sorted = files;
  const sortBy = document.getElementById('sortSelect').value;
  tlGroupByMonth = sortBy === 'filedate' || sortBy === 'added';

  area.innerHTML = '<div id="lasso"></div>';
  const wrap = document.createElement('div');
  wrap.id = 'tlContainer';
  area.appendChild(wrap);

  // Re-renders (e.g. after editing properties) pass the previously-rendered count in via
  // minCount so the same amount of scrolled-in content comes back instead of collapsing to
  // just the first page - otherwise the shorter content can't hold the old scroll position
  // and the view snaps back up. See renderGrid/renderList's identical use of minCount.
  const initial = Math.min(sorted.length, Math.max(PAGE_SIZE, minCount));
  appendTimelineThumbs(sorted.slice(0, initial), wrap);
  if (sorted.length > initial) {
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    area.appendChild(sentinel);
    setupPageObserver(sentinel, sorted, wrap, appendTimelineThumbs, initial);
  }
}

// Builds one timeline thumb element - shared by both the month-grouped and flat layouts
// below, so neither has to duplicate the per-file badges/listeners.
function buildTlThumbEl(file) {
  const thumb = document.createElement('div');
  thumb.className = 'tl-thumb' + (file._missing?' file-missing':'') + (selectedIds.has(file.id) ? ' selected' : '');
  thumb.dataset.fileId = file.id;
  // The lazy thumbnail loader (drainThumbQueue) replaces data-thumb-for's own innerHTML
  // wholesale once the real image loads - it must be a nested wrapper, not this outer
  // .tl-thumb, or loading a thumbnail silently wipes every sibling badge (live/best-of/
  // burst) the instant it finishes. Grid cards already avoid this the same way via
  // .file-card-thumb; timeline just didn't until this was chasing down a missing LIVE badge.
  thumb.innerHTML = `<div class="tl-thumb-inner" data-thumb-for="${file.id}" id="th-${file.id}">
      <span class="tl-emoji${file._missing?' thumb-icon-missing':''}" title="${file._missing?'File not found on disk':''}">${file._missing?'🚫':getEmoji(file.ext)}</span>
    </div>`;
  if (isVid(file.ext)) thumb.innerHTML += '<div class="tl-vid-badge">▶</div>';
  thumb.innerHTML += badge360Html(file);
  if (file.livePhotoVideoId) thumb.innerHTML += `<div class="tl-live-badge" title="Live Photo - click to play the motion" onclick="event.stopPropagation();playLivePhoto('${file.id}')">◎ LIVE</div>`;
  if (file.bestOf) thumb.innerHTML += '<div class="tl-fav-dot"></div>';
  if (burstCoverMap.has(file.id)) thumb.innerHTML += `<div class="burst-badge" title="Burst of ${burstCoverMap.get(file.id).count} - click to pick a favorite" onclick="event.stopPropagation();openBurstReview('${file.id}')">🎞 ${burstCoverMap.get(file.id).count}</div>`;
  thumb.draggable = true;
  thumb.addEventListener('dragstart', e => handleFileDragStart(e, file.id));
  thumb.addEventListener('click', e => handleCardClick(e, file.id));
  thumb.addEventListener('dblclick', () => isMedia(file.ext) ? openMediaCluster(file) : openFileById(file.id));
  thumb.addEventListener('contextmenu', e => showCtxMenu(e, file.id));
  if (isMedia(file.ext)) {
    const thumbEl = thumb.querySelector('[data-thumb-for]');
    if (thumbEl) observeThumb(thumbEl);
  }
  return thumb;
}

function appendTimelineThumbs(fileSlice, wrap) {
  if (!tlGroupByMonth) {
    let grid = wrap.querySelector(':scope > .tl-grid.tl-flat');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'tl-grid tl-flat';
      wrap.appendChild(grid);
    }
    for (const file of fileSlice) { maybeAppendTypeHeader(file, grid); grid.appendChild(buildTlThumbEl(file)); }
    return;
  }

  let section = wrap.lastElementChild?.classList.contains('tl-month-section') ? wrap.lastElementChild : null;
  let grid = section ? section.querySelector('.tl-grid') : null;
  let countEl = section ? section.querySelector('.tl-month-count') : null;
  let curYr = section ? +section.dataset.yr : null;
  let curMo = section ? +section.dataset.mo : null;
  let curCount = section ? grid.children.length : 0;

  for (const file of fileSlice) {
    const d = new Date(file.fileDate || file.addedAt);
    const yr = d.getFullYear(), mo = d.getMonth();
    if (!section || curYr !== yr || curMo !== mo) {
      section = document.createElement('div');
      section.className = 'tl-month-section';
      section.dataset.yr = yr; section.dataset.mo = mo;

      const header = document.createElement('div');
      header.className = 'tl-month-header';
      countEl = document.createElement('span');
      countEl.className = 'tl-month-count';
      header.innerHTML = `<span class="tl-month-name">${MONTH_NAMES[mo]} ${yr}</span>`;
      header.appendChild(countEl);
      section.appendChild(header);

      grid = document.createElement('div');
      grid.className = 'tl-grid';
      section.appendChild(grid);
      wrap.appendChild(section);
      curYr = yr; curMo = mo; curCount = 0;
    }

    grid.appendChild(buildTlThumbEl(file));
    curCount++;
    countEl.textContent = `${curCount} memor${curCount !== 1 ? 'ies' : 'y'}`;
  }
}

// ── SELECTION ────────────────────────────────────────────────────────────────
function handleCardClick(e, fileId) {
  if (e.target.classList.contains('file-card-star') || e.target.classList.contains('file-row-star')) return;
  if (e.ctrlKey || e.metaKey) {
    toggleSelect(fileId);
  } else if (e.shiftKey && selectedIds.size > 0) {
    rangeSelect(fileId);
  } else if (selectedIds.size > 0) {
    if (selectedIds.has(fileId) && selectedIds.size === 1) clearSelection();
    else { clearSelection(); toggleSelect(fileId); }
  } else {
    toggleSelect(fileId);
  }
}

function toggleSelect(fileId) {
  if (selectedIds.has(fileId)) selectedIds.delete(fileId);
  else selectedIds.add(fileId);
  updateSelectionUI();
}

function rangeSelect(fileId) {
  const files = getVisibleFiles();
  const ids = files.map(f => f.id);
  const lastSel = [...selectedIds].pop();
  const a = ids.indexOf(lastSel), b = ids.indexOf(fileId);
  if (a < 0 || b < 0) { toggleSelect(fileId); return; }
  ids.slice(Math.min(a,b), Math.max(a,b)+1).forEach(id => selectedIds.add(id));
  updateSelectionUI();
}

function clearSelection() { selectedIds.clear(); updateSelectionUI(); }

function updateSelectionUI() {
  const count = selectedIds.size;
  // Every card is already created with the right 'selected' class baked in from
  // selectedIds at render time (see renderGrid/renderList/renderTimeline), so the
  // only thing this needs to patch is a selection change that happens WITHOUT a
  // full re-render (click, ctrl-click, lasso). Touch just the ids that actually
  // flipped rather than re-walking and re-toggling every rendered card in the
  // document on every single click - that was O(all visible cards) per click
  // regardless of how many selection states actually changed.
  for (const id of selectedIds) {
    if (lastSelectedIds.has(id)) continue;
    document.querySelectorAll(`[data-file-id="${CSS.escape(id)}"]`).forEach(el => el.classList.add('selected'));
  }
  for (const id of lastSelectedIds) {
    if (selectedIds.has(id)) continue;
    document.querySelectorAll(`[data-file-id="${CSS.escape(id)}"]`).forEach(el => el.classList.remove('selected'));
  }
  lastSelectedIds = new Set(selectedIds);
  document.getElementById('selBar').classList.toggle('visible', count > 0);
  document.getElementById('selCount').textContent = `${count} selected`;
  const msBtn = document.getElementById('markSortedBtn');
  if (msBtn) msBtn.style.display = currentFolder === 'to-sort' && count > 0 ? '' : 'none';
}

// Generic drag-to-select: `area` is the scrolling container the lasso drags
// within (its element persists across renders even though its innerHTML gets
// replaced, so listeners attached once here keep working); `lassoId` is looked
// up fresh on every move since the lasso <div> itself is re-created by each
// render pass. Reused for the main library (#fileArea/#lasso) and Guided Sort's
// per-step grids (.gs-body/#gsLasso), which otherwise had no way to multi-select
// by dragging like every other folder view.
function attachLasso(area, lassoId, excludeSelector) {
  let lassoing = false, startX, startY, cardRects = [], rafPending = false, lastEvent = null;
  area.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest(excludeSelector)) return;
    lassoing = true;
    const rect = area.getBoundingClientRect();
    startX = e.clientX - rect.left + area.scrollLeft;
    startY = e.clientY - rect.top + area.scrollTop;
    // Cards don't reflow mid-drag, so their positions are measured once here
    // (in the same scroll-independent coordinate space as startX/startY) rather
    // than re-querying + re-measuring every single card on every mousemove pixel -
    // that was forcing a synchronous layout read per card per event, which gets
    // very expensive with thousands of rendered cards during a drag-select.
    cardRects = [...area.querySelectorAll('[data-file-id]')].map(el => {
      const er = el.getBoundingClientRect();
      return {
        id: el.dataset.fileId,
        x: er.left - rect.left + area.scrollLeft,
        y: er.top - rect.top + area.scrollTop,
        w: er.width, h: er.height
      };
    });
    if (!e.ctrlKey && !e.metaKey) clearSelection();
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!lassoing) return;
    lastEvent = e;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!lassoing) return;
      const ev = lastEvent;
      const lasso = document.getElementById(lassoId);
      if (!lasso) return;
      const rect = area.getBoundingClientRect();
      const curX = ev.clientX - rect.left + area.scrollLeft;
      const curY = ev.clientY - rect.top + area.scrollTop;
      const x = Math.min(startX,curX), y = Math.min(startY,curY);
      const w = Math.abs(curX-startX), h = Math.abs(curY-startY);
      lasso.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      for (const cr of cardRects) {
        if (cr.x < x+w && cr.x+cr.w > x && cr.y < y+h && cr.y+cr.h > y) selectedIds.add(cr.id);
      }
      updateSelectionUI();
    });
  });
  document.addEventListener('mouseup', () => {
    if (!lassoing) return;
    lassoing = false;
    cardRects = [];
    const lasso = document.getElementById(lassoId);
    if (lasso) lasso.style.display = 'none';
  });
}

function setupLasso() {
  attachLasso(
    document.getElementById('fileArea'), 'lasso',
    '.file-card,.file-row,.file-card-star,.file-row-star,.folder-cardv2,.tl-thumb,.files-here-btn,.chip,.search-clear-inline'
  );
  attachLasso(
    document.getElementById('gsBody'), 'gsLasso',
    '.file-card,.gs-preview-btn,.gs-chip,.gs-choice,.gs-pick-card,.gs-match-card,.gs-note,button,a,input'
  );
  // First-run wizard grids (Add Files/People/Categories) - #frBody is reused across every
  // step (including forms with no grid at all), so the exclude list is broader than Guided
  // Sort's to keep drag-select from swallowing clicks/typing on inputs, buttons and swatches.
  attachLasso(
    document.getElementById('frBody'), 'frLasso',
    '.file-card,.gs-preview-btn,.gs-chip,input,button,.color-swatch'
  );
}

// ── FILE CONTEXT MENU ─────────────────────────────────────────────────────────
function setupContextMenu() {
  document.addEventListener('click', e => {
    if (!e.target.closest('#ctxMenu')) hideCtxMenu();
    if (!e.target.closest('#folderCtxMenu')) hideFolderCtxMenu();
    if (!e.target.closest('#thumbMenu') && !e.target.closest('#popupThumbBtn') && !e.target.closest('#ctxSetThumbItem')) hideThumbMenu();
    if (!e.target.closest('#sectionCtxMenu')) hideSectionCtxMenu();
    if (!e.target.closest('#addSectionMenu') && !e.target.closest('.sb-add-section-btn')) hideAddSectionMenu();
    if (!e.target.closest('.more-filters-wrap')) document.getElementById('moreFiltersMenu')?.classList.remove('open');
    if (!e.target.closest('#legModePopup') && !e.target.closest('.relive-leg-chip')) hideLegModePopup();
    if (!e.target.closest('#tripMarkerPopup')) {
      if (tripPopupSuppressNextDismiss) tripPopupSuppressNextDismiss = false;
      else hideTripMarkerPopup();
    }
  });
}

function showCtxMenu(e, fileId) {
  e.preventDefault(); e.stopPropagation();
  hideFolderCtxMenu();
  ctxFileId = fileId;
  if (!selectedIds.has(fileId)) { clearSelection(); selectedIds.add(fileId); updateSelectionUI(); }
  const file = appData.files.find(f => f.id === fileId);
  const best = file?.bestOf;
  document.getElementById('ctxBestIcon').textContent = best ? '⭐' : '☆';
  document.getElementById('ctxBestLabel').textContent = best ? 'Remove from Best Of' : 'Add to Best Of';
  const showLoc = file?.gps ? '' : 'none';
  document.getElementById('ctxClearLoc').style.display = showLoc;
  document.getElementById('ctxLocSep').style.display = showLoc;
  document.getElementById('ctxSeeOnMap').style.display = showLoc;
  const hideItem = document.getElementById('ctxHideOnMap');
  if (hideItem) {
    hideItem.style.display = showLoc;
    const sel = [...selectedIds].map(id => appData.files.find(f => f.id === id)).filter(f => f?.gps);
    const allHidden = sel.length > 0 && sel.every(f => f.hideOnMap);
    hideItem.innerHTML = allHidden ? '<span class="ctx-icon">👁</span> Show on Map' : '<span class="ctx-icon">🙈</span> Hide from Map';
  }
  const pinIcon = document.getElementById('ctxPinIcon');
  const pinLabel = document.getElementById('ctxPinLabel');
  if (pinIcon) pinIcon.textContent = '📌';
  if (pinLabel) pinLabel.textContent = file?.pinned ? 'Unpin' : 'Pin in Folder';
  document.getElementById('ctxEditPhotoItem').style.display = isEditable(file?.ext) ? '' : 'none';
  document.getElementById('ctxRotateItem').style.display = isMedia(file?.ext) ? '' : 'none';
  document.getElementById('ctxSetThumbItem').style.display = isVid(file?.ext) ? '' : 'none';
  document.getElementById('ctxVersionsItem').style.display = (file?.versionParentId || getVersionChildren(fileId).length) ? '' : 'none';
  // Rename only works on a single file
  document.getElementById('ctxRenameItem').classList.toggle('disabled', selectedIds.size > 1);
  const menu = document.getElementById('ctxMenu');
  menu.classList.add('open');
  positionCtxMenu(menu, e.clientX, e.clientY);
}

function hideCtxMenu() { document.getElementById('ctxMenu').classList.remove('open'); }

async function ctxReveal() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  const paths = ids.map(id => appData.files.find(f=>f.id===id)?.path).filter(Boolean);
  if (paths.length) await window.api.showMultipleInFolder(paths);
}
async function ctxToggleBestOf() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  const file = appData.files.find(f=>f.id===ids[0]);
  const newVal = !file?.bestOf;
  ids.forEach(id => { const f=appData.files.find(f=>f.id===id); if(f) f.bestOf=newVal; });
  await saveData();
  toast(newVal ? `⭐ Added ${ids.length} to Best Of` : `☆ Removed ${ids.length} from Best Of`);
}
function ctxMoveToFolder() { hideCtxMenu(); if (selectedIds.size > 1) bulkAssignFolders(); else if (ctxFileId) showAssignModal(new Event('click'), ctxFileId); }
function ctxEdit() { hideCtxMenu(); if (ctxFileId) showEditModal(ctxFileId); }
function ctxEditPhoto() { hideCtxMenu(); if (ctxFileId) openPhotoEditor(ctxFileId); }
function ctxOpenVersions() { hideCtxMenu(); if (ctxFileId) openVersionModal(ctxFileId); }

async function ctxCopyPath() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  const paths = ids.map(id => appData.files.find(f => f.id === id)?.path).filter(Boolean);
  if (!paths.length) return;
  try {
    await navigator.clipboard.writeText(paths.join('\n'));
    toast(`📋 Copied ${paths.length} path${paths.length!==1?'s':''}`);
  } catch(e) { toast('⚠️ Could not copy to clipboard'); }
}

function ctxRename() {
  hideCtxMenu();
  if (selectedIds.size > 1) return;
  if (ctxFileId) startInlineFileRename(ctxFileId);
}

// ── INLINE RENAME ────────────────────────────────────────────────────────────
// nameEl lets a direct click on the name pass its own element in (no DOM lookup
// needed); omitted for callers like the context menu's "Rename" that only have a
// fileId, which falls back to finding the currently-rendered card's name element.
function startInlineFileRename(fileId, nameEl) {
  const file = appData.files.find(f => f.id === fileId);
  if (!file) return;
  if (!nameEl) {
    const card = document.querySelector(`[data-file-id="${CSS.escape(fileId)}"]`);
    nameEl = card?.querySelector('.file-card-name, .file-row-name');
  }
  if (!nameEl) { toast('⚠️ Scroll the file into view to rename'); return; }
  startInlineEdit(nameEl, file.name, async (val) => {
    file.name = val;
    await saveData();
    toast('📝 Renamed');
  });
}

function startInlineEdit(el, initial, onSave) {
  el.textContent = initial;
  el.contentEditable = 'true';
  el.classList.add('inline-editing');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  // A draggable file card/row would otherwise hijack a click-drag inside this text (meant
  // to select text while renaming) as a whole-card drag instead - suspend it for the edit.
  const draggableAncestor = el.closest('[draggable="true"]');
  if (draggableAncestor) draggableAncestor.draggable = false;
  const stop = ev => ev.stopPropagation();
  el.addEventListener('click', stop);
  el.addEventListener('dblclick', stop);
  el.addEventListener('mousedown', stop);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    el.contentEditable = 'false';
    el.classList.remove('inline-editing');
    if (draggableAncestor) draggableAncestor.draggable = true;
    el.removeEventListener('click', stop);
    el.removeEventListener('dblclick', stop);
    el.removeEventListener('mousedown', stop);
    const val = el.textContent.trim();
    if (save && val && val !== initial) onSave(val);
    // Cancelled (or saved back to the same/empty value) - grid/list cards get fully rebuilt
    // by renderFiles() so their stale edited text is overwritten anyway, but standalone
    // elements like the popup's name aren't touched by that render, so restore explicitly.
    else { el.textContent = initial; renderSidebar(); renderFiles(); }
  };
  el.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  });
  el.addEventListener('blur', () => finish(true), { once: true });
}

// Clearing location must remove the actual coordinate (f.gps), not just the
// reverse-geocoded place name - leaving f.gps behind meant the file still showed
// its 📍 pin badge (driven by file.gps, not file.country) and still counted as
// geotagged everywhere else (the globe, Relive Trip, trip auto-detection).
function clearLocationFields(f) {
  f.gps = null; f.gpsManual = false;
  f.country = null; f.countryCode = null; f.region = null; f.city = null;
  f.noGeocode = true;
}

async function ctxClearLocation() {
  hideCtxMenu();
  const rawIds = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  const idSet = new Set(rawIds);
  rawIds.forEach(id => { burstCoverMap.get(id)?.memberIds.forEach(m => idSet.add(m)); });
  const ids = [...idSet];
  let count = 0;
  ids.forEach(id => {
    const f = appData.files.find(f => f.id === id);
    if (f && f.gps) { clearLocationFields(f); count++; }
  });
  if (count > 0) { await saveData(); toast(`📍 Location cleared for ${count} file${count!==1?'s':''}`); }
}

async function clearFileLocation(id) {
  const f = appData.files.find(f => f.id === id);
  if (!f || !f.gps) return;
  clearLocationFields(f);
  const siblings = (burstCoverMap.get(id)?.memberIds || [])
    .map(sid => appData.files.find(x => x.id === sid))
    .filter(s => s && s !== f);
  siblings.forEach(clearLocationFields);
  await saveData();
  toast(siblings.length ? `📍 Location cleared for all ${siblings.length + 1} photos in the burst` : '📍 Location cleared');
}

function ctxRemove(e) {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  openRemoveOrDelete(ids.filter(Boolean), null, e);
}

// ── FOLDER CONTEXT MENU ──────────────────────────────────────────────────────
function setupFolderContextMenu() {
  // Handled by showFolderCtxMenu / hideFolderCtxMenu
}

function showFolderCtxMenu(e, folderId) {
  e.preventDefault(); e.stopPropagation();
  hideCtxMenu();
  folderCtxId = folderId;
  const menu = document.getElementById('folderCtxMenu');
  const folder = appData.folders.find(f => f.id === folderId);
  // Excludes the Cameras root itself - a profile belongs to one specific camera folder, not the category.
  const isCameraFolder = !!folder?.parentId && buildBreadcrumb(folder.parentId).some(f => f.name === 'Cameras' && !f.parentId);
  const swapItem = document.getElementById('folderCtxSwapKindItem');
  if (swapItem) {
    const tripLike = isTripLikeRootId(folder?.parentId);
    swapItem.style.display = tripLike ? '' : 'none';
    if (tripLike) swapItem.innerHTML = folder.parentId === VACATIONS_ROOT_ID
      ? '<span class="ctx-icon">🧭</span> Move to Adventures' : '<span class="ctx-icon">✈️</span> Move to Trips';
  }
  const profileItem = document.getElementById('folderCtxProfileItem');
  if (profileItem) {
    profileItem.style.display = isCameraFolder ? '' : 'none';
    profileItem.innerHTML = `<span class="ctx-icon">🎯</span> ${folder?.cameraProfile ? 'Update' : 'Create'} Camera Profile`;
  }
  menu.classList.add('open');
  positionCtxMenu(menu, e.clientX, e.clientY);
}

function hideFolderCtxMenu() { document.getElementById('folderCtxMenu').classList.remove('open'); }

// Positions a context menu using its real rendered size (menus have variable
// height depending on which items are shown), clamped to stay fully within
// the viewport on every edge rather than assuming a fixed height/width.
function positionCtxMenu(menu, clientX, clientY) {
  const pad = 8;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(pad, Math.min(clientX, window.innerWidth - w - pad));
  const top = Math.max(pad, Math.min(clientY, window.innerHeight - h - pad));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

// Managed roots (a custom section included) never appear as options in the plain New Folder
// modal's parent picker (see openNewFolderModalForced above) - right-clicking one directly
// (only reachable via a custom section's header) needs the forced-parent variant instead, or
// "Add Sub-folder" would silently create the new folder at the top level.
function folderCtxAddSub() {
  hideFolderCtxMenu();
  if (getManagedRootIds().has(folderCtxId)) openNewFolderModalForced(folderCtxId);
  else openNewFolderModal(folderCtxId);
}

function folderCtxBuildProfile() { hideFolderCtxMenu(); buildCameraProfile(folderCtxId); }

function folderCtxSetCover() {
  hideFolderCtxMenu();
  openCoverPicker(folderCtxId);
}

// ── COVER PICKER ─────────────────────────────────────────────────────────────
function openCoverPicker(folderId) {
  const folder = appData.folders.find(f => f.id === folderId);
  if (!folder) return;
  const ids = new Set([folderId, ...getAllDesc(folderId)]);
  const media = appData.files
    .filter(f => isMedia(f.ext) && f.folders?.some(id => ids.has(id)))
    .sort((a,b) => (!!b.bestOf - !!a.bestOf) || (!!b.pinned - !!a.pinned) || ((b.fileDate||0) - (a.fileDate||0)))
    .slice(0, 80);
  if (!media.length) { toast('⚠️ No media in this folder yet'); return; }
  coverPickerFolderId = folderId;
  document.getElementById('coverPickerSub').textContent = `Choose a cover for “${folder.name}”`;
  const body = document.getElementById('coverPickerBody');
  body.innerHTML = '';
  media.forEach(f => {
    const cell = document.createElement('div');
    cell.className = 'cover-cell' + (folder.coverFileId === f.id ? ' current' : '');
    cell.title = f.name;
    cell.innerHTML = `<span>${getEmoji(f.ext)}</span>`;
    cell.onclick = async () => {
      folder.coverFileId = f.id;
      closeCoverPicker();
      await saveData();
      toast('🖼 Cover photo set');
    };
    body.appendChild(cell);
    getThumb(f).then(url => { if (url && cell.isConnected) cell.innerHTML = `<img src="${url}" alt="" decoding="async"/>`; });
  });
  document.getElementById('coverPicker').classList.add('open');
}

function closeCoverPicker() {
  document.getElementById('coverPicker').classList.remove('open');
  coverPickerFolderId = null;
}

async function clearFolderCover() {
  const folder = appData.folders.find(f => f.id === coverPickerFolderId);
  closeCoverPicker();
  if (!folder) return;
  delete folder.coverFileId;
  await saveData();
  toast('🖼 Cover reset to automatic');
}

function folderCtxRecolor() {
  hideFolderCtxMenu();
  editingFolderId = folderCtxId;
  creatingSection = false;
  const folder = appData.folders.find(f => f.id === folderCtxId);
  if (!folder) return;
  nfmIconImage = folder.iconImage || null;
  refreshNfmIconImageUI();
  document.getElementById('nfmName').value = folder.name;
  setNfmEmoji(folderEmoji(folder));
  document.getElementById('nfmTitle').textContent = folder.isSection ? 'Edit Section' : (folder.parentId === VACATIONS_ROOT_ID ? 'Edit Trip' : isAdventureFolder(folder) ? 'Edit Adventure' : 'Edit Folder');
  document.getElementById('nfmSaveBtn').textContent = 'Save';
  selectedColor = folder.color || COLORS[0];
  setupColorSwatches();
  toggleNfmDatesRow(isTripLikeRootId(folder.parentId), folder.dateStart, folder.dateEnd);
  // Hide parent selector when editing
  document.getElementById('nfmParent').style.display = 'none';
  document.querySelector('#newFolderModal .modal-sub')?.remove && false;
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(() => document.getElementById('nfmName').focus(), 60);
}

function folderCtxDelete() {
  hideFolderCtxMenu();
  deleteFolderClick({ stopPropagation: ()=>{} }, folderCtxId);
}

// ── BULK ACTIONS ──────────────────────────────────────────────────────────────
async function bulkReveal() {
  const ids = [...selectedIds];
  const paths = ids.map(id => appData.files.find(f=>f.id===id)?.path).filter(Boolean);
  if (paths.length) await window.api.showMultipleInFolder(paths);
}

async function bulkBestOf() {
  const ids = [...selectedIds];
  const first = appData.files.find(f=>f.id===ids[0]);
  const newVal = !first?.bestOf;
  ids.forEach(id => { const f=appData.files.find(f=>f.id===id); if(f) f.bestOf=newVal; });
  await saveData();
  toast(newVal ? `⭐ Added ${ids.length} to Best Of` : `☆ Removed ${ids.length} from Best Of`);
}

function bulkAssignFolders() {
  assigningMultiple = true; modalFileId = null;
  const name = selectedIds.size === 1 ? (appData.files.find(f=>f.id===[...selectedIds][0])?.name||'') : `${selectedIds.size} files`;
  document.getElementById('assignModalName').textContent = name;
  document.getElementById('assignModalSub').textContent = 'Select folders to link selected files to';
  buildAssignBody();
  document.getElementById('assignModal').classList.add('open');
}

// Deletes files from the actual hard drive (not just their shortcuts) via the shared
// #deleteConfirm modal - used by Bulk Delete, Duplicate Detection, Burst Review, and the
// photo popup. Each flow calls openDeleteConfirm() with its own copy/count and confirm
// handler; the modal element, its Cancel button, Escape handling, and backdrop-click
// dismissal are all wired once, here, instead of once per flow.
// Settings -> "Allow deleting files from disk" - defaults to allowed so nobody who never
// visits Settings notices a change. Only gates real disk deletes; removing a shortcut from the
// library never touches the real file and isn't covered by this.
function canDeleteFiles() {
  return appData.settings?.allowDeleteFiles !== false;
}

function openDeleteConfirm({ title, sub, bodyHtml, buttonLabel, onConfirm }) {
  if (!canDeleteFiles()) { toast('🔒 File deletion is turned off in Settings'); return; }
  document.getElementById('deleteConfirmTitle').textContent = title;
  document.getElementById('deleteConfirmSub').textContent = sub;
  document.getElementById('deleteConfirmText').innerHTML = bodyHtml;
  document.getElementById('deleteConfirmPermanent').checked = false;
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = false;
  btn.textContent = buttonLabel;
  btn.onclick = onConfirm;
  document.getElementById('deleteConfirm').classList.add('open');
}

function cancelDeleteConfirm() {
  document.getElementById('deleteConfirm').classList.remove('open');
}

// Lifetime running total of real disk space freed via window.api.deleteFiles() - Duplicate
// Detection, Burst Review, and manual deletes all funnel through here. Counted the moment a
// delete succeeds (res.bytes, from main.js's fs.statSync right before removal), regardless of
// whether it went to the Recycle Bin or was permanent - see the sidebar's "space freed" footer.
function recordSpaceFreed(bytes) {
  if (!bytes) return;
  appData.stats.bytesDeleted = (appData.stats.bytesDeleted || 0) + bytes;
}

// ── REMOVE OR DELETE (one button, one deliberate choice) ─────────────────────
// "Remove from library" and "Delete from disk" used to be two separate buttons sitting next to
// each other with near-identical labels - the difference being whether the user's actual photo
// survives. They're one action now: this dialog, where the two outcomes are spelled out and the
// user picks. Specialised cleanup flows (Duplicate Detection, Burst Review) keep their own
// delete-only confirm - there, "remove the shortcut but keep the duplicate file" is not a thing
// anyone wants, and those already explain themselves in terms of disk space.
let rdFileIds = [];      // ids this dialog is acting on
let rdMode = 'remove';   // 'remove' | 'delete'
let rdOnDone = null;

// Ctrl+click (Cmd+click on Mac) on any Remove button is the power-user escape hatch: skip this
// dialog and permanently delete straight away, no Recycle Bin. Still honours the Settings switch -
// with deletion turned off it just falls through to the normal dialog.
function openRemoveOrDelete(fileIds, onDone, e) {
  const files = (fileIds || []).map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  if (!files.length) return;
  rdFileIds = files.map(f => f.id);
  rdOnDone = onDone || null;
  if ((e?.ctrlKey || e?.metaKey) && canDeleteFiles()) {
    rdMode = 'delete';
    document.getElementById('rdPermanent').checked = true;
    rdConfirm();
    return;
  }
  rdMode = 'remove';
  const n = files.length;
  const plural = n !== 1;
  const bytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  document.getElementById('rdTitle').textContent = n === 1 ? `Remove "${files[0].name}"?` : `Remove ${n} photos?`;
  document.getElementById('rdSub').textContent = 'Two very different things - pick the one you mean.';
  document.getElementById('rdRemoveDesc').textContent = plural
    ? `Takes these ${n} shortcuts out of your library. The real files stay exactly where they are on your computer, untouched.`
    : 'Takes the shortcut out of your library. The real file stays exactly where it is on your computer, untouched.';
  // One lens of a split Insta360 recording going without its partner - see isInsta360LensPair.
  const ids = new Set(rdFileIds);
  const halfLens = files.filter(f => {
    const partner = typeof v360PairPath === 'function' && v360PairPath(f.path || '');
    return partner && appData.files.some(o => o.path === partner && !ids.has(o.id));
  });
  const lensWarn = halfLens.length
    ? `<br><span style="color:var(--gold)">⚠️ ${halfLens.length === 1 ? `"${esc(halfLens[0].name)}" is` : `${halfLens.length} of these are`} one lens of a 360 video. The _00_ and _10_ files are the front and back halves of the same recording, not copies: without both it can't be viewed in 360.</span>`
    : '';
  document.getElementById('rdDeleteDesc').innerHTML = canDeleteFiles()
    ? `Erases <strong style="color:var(--red)">${n} real file${plural ? 's' : ''}</strong> (${fmtSize(bytes)}) from your hard drive. This is the one you can't take back from inside Trove.${lensWarn}`
    : 'Turned off in Settings → "Allow deleting files from disk".';
  document.getElementById('rdChoiceDelete').disabled = !canDeleteFiles();
  document.getElementById('rdChoiceDelete').style.opacity = canDeleteFiles() ? '' : '.5';
  document.getElementById('rdPermanent').checked = false;
  document.getElementById('removeOrDelete').classList.add('open');
  rdRefresh();
}
function closeRemoveOrDelete() {
  document.getElementById('removeOrDelete').classList.remove('open');
  rdFileIds = [];
  rdOnDone = null;
}
function rdSelectMode(mode) {
  if (mode === 'delete' && !canDeleteFiles()) { toast('🔒 File deletion is turned off in Settings'); return; }
  rdMode = mode;
  rdRefresh();
}
function rdRefresh() {
  const n = rdFileIds.length;
  const plural = n !== 1;
  document.getElementById('rdChoiceRemove').classList.toggle('selected', rdMode === 'remove');
  document.getElementById('rdChoiceDelete').classList.toggle('selected', rdMode === 'delete');
  document.getElementById('rdDeleteExtra').style.display = rdMode === 'delete' ? '' : 'none';
  const btn = document.getElementById('rdConfirmBtn');
  const permanent = document.getElementById('rdPermanent').checked;
  btn.style.background = rdMode === 'delete' ? 'var(--red)' : '';
  btn.textContent = rdMode === 'delete'
    ? (permanent ? `🗑 Delete ${n} file${plural ? 's' : ''} permanently` : `🗑 Delete ${n} file${plural ? 's' : ''}`)
    : `↩︎ Remove ${n} shortcut${plural ? 's' : ''}`;
}
async function rdConfirm() {
  const ids = [...rdFileIds];
  if (!ids.length) { closeRemoveOrDelete(); return; }
  const onDone = rdOnDone;
  if (rdMode === 'remove') {
    closeRemoveOrDelete();
    await removeFilesFromLibrary(ids);
    if (onDone) onDone();
    return;
  }
  const files = ids.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const permanent = document.getElementById('rdPermanent').checked;
  const btn = document.getElementById('rdConfirmBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  const media = releaseMediaForDelete();
  const res = await window.api.deleteFiles(files.map(f => f.path), permanent).catch(() => null);
  btn.disabled = false;
  if (!res) { toast('⚠️ Deletion failed'); resumeMediaAfterDelete(media); rdRefresh(); return; }
  const deletedSet = new Set(res.deleted);
  window.api.deleteEmbeddings(files.filter(f => deletedSet.has(f.path)).map(f => f.id)).catch(() => {});
  appData.files = appData.files.filter(f => !deletedSet.has(f.path));
  recordSpaceFreed(res.bytes);
  syncPopupClusterAfterRemoval();
  resumeMediaAfterDelete(media);
  clearSelection();
  closeRemoveOrDelete();
  await saveData();
  const freed = fmtSize(res.bytes);
  if (res.deleted.length) toast(permanent
    ? `🗑 Deleted ${res.deleted.length} file${res.deleted.length !== 1 ? 's' : ''} - ${freed} freed`
    : `🗑 ${res.deleted.length} file${res.deleted.length !== 1 ? 's' : ''} moved to Recycle Bin (${freed}) - empty it to free the space`, 5000);
  toastDeleteFailures(res);
  if (onDone) onDone();
}
// Windows won't delete or recycle a file something still has open, and Trove's own players are
// the usual culprit: the preview's <video>, and the 360 player - which holds BOTH lens files of
// a split Insta360 recording open while showing either one, so deleting the lens you weren't
// looking at used to fail. Every disk delete lets go of all of them first, whatever is being
// deleted; resumeMediaAfterDelete puts the preview back if it's still showing a file that stayed.
function releaseMediaForDelete() {
  const vid = document.getElementById('photoPopupVideo');
  const was = { fileId: popupFileId, playing: !!vid.getAttribute('src') || v360.open };
  vid.pause(); vid.removeAttribute('src'); vid.load();
  if (v360.open) v360Teardown();
  return was;
}
function resumeMediaAfterDelete(was) {
  if (!was?.playing || !document.getElementById('photoPopup').classList.contains('open')) return;
  // A different file on show means syncPopupClusterAfterRemoval already moved on and rendered it.
  if (popupFileId === was.fileId && appData.files.some(f => f.id === popupFileId)) renderPopupFile();
}
function toastDeleteFailures(res) {
  if (!res.failed.length) return;
  const n = res.failed.length;
  toast(res.inUse
    ? `⚠️ ${n} file${n !== 1 ? 's' : ''} could not be deleted - still open in another program (an editor, Insta360 Studio, a player?). Close it and try again.`
    : `⚠️ ${n} file${n !== 1 ? 's' : ''} could not be deleted`, 7000);
}

// Keeps the photo viewer honest when the file it was showing (or one of its burst siblings)
// just left the library - step to the next one, or close if nothing's left.
function syncPopupClusterAfterRemoval() {
  if (!popupClusterFiles.length) return;
  const live = new Set(appData.files.map(f => f.id));
  popupClusterFiles = popupClusterFiles.filter(f => live.has(f.id));
  if (!popupClusterFiles.length) { closePhotoPopup(); return; }
  if (popupClusterIndex >= popupClusterFiles.length) popupClusterIndex = popupClusterFiles.length - 1;
  if (!live.has(popupFileId)) renderPopupFile();
}

// Shortcut-only removal, with the same undo affordance the old context-menu action had.
async function removeFilesFromLibrary(ids) {
  const idSet = new Set(ids);
  const removed = appData.files.map((f, idx) => ({ file: f, idx })).filter(r => idSet.has(r.file.id));
  if (!removed.length) return;
  appData.files = appData.files.filter(f => !idSet.has(f.id));
  syncPopupClusterAfterRemoval();
  clearSelection();
  await saveData();
  undoToast(`↩︎ Removed ${removed.length} shortcut${removed.length !== 1 ? 's' : ''} - the file${removed.length !== 1 ? 's are' : ' is'} still on your computer`, async () => {
    for (const { file, idx } of removed) appData.files.splice(Math.min(idx, appData.files.length), 0, file);
    await saveData();
  });
}

function bulkDelete(e) {
  const ids = [...selectedIds];
  if (!ids.length) return;
  openRemoveOrDelete(ids, null, e);
}

// ── DUMP / AUTO-SORT ─────────────────────────────────────────────────────────
async function dumpFiles() {
  const newFiles = await window.api.openFileDialog();
  if (!newFiles.length) return;
  const toAdd = newFiles.filter(nf => !appData.files.find(f => f.path === nf.path));
  if (!toAdd.length) { toast('ℹ️ All files already in library'); return; }
  await processDump(toAdd);
}

async function processDump(toAdd) {
  for (const f of toAdd) {
    if (!appData.files.find(e => e.path === f.path)) appData.files.push(f);
  }
  await autoCreateCameraFolders(toAdd);

  // ALL dumped files stay in To Sort for user review - camera folders are suggested but not confirmed
  const cameraDetected = toAdd.filter(f => f.folders?.length > 0).length;
  for (const file of toAdd) file.toSort = true;

  await saveData();
  queueForIndexing(toAdd);

  const msg = cameraDetected > 0
    ? `📥 ${toAdd.length} file${toAdd.length!==1?'s':''} added · 📷 ${cameraDetected} camera${cameraDetected!==1?'s':''} detected - confirm in To Sort`
    : `📥 ${toAdd.length} file${toAdd.length!==1?'s':''} added - review in To Sort`;
  toast(msg, 3500);
  // Big dumps (several trips at once) are still fully supported - Guided Sort's Trip Match
  // step groups them by date automatically - but a smaller, one-trip-at-a-time dump sorts
  // faster and with less to review, so it's worth saying so up front for a big one.
  if (toAdd.length > 150) setTimeout(() => toast(`💡 That's a big batch - Guided Sort will group it by trip automatically. Tip: adding one trip's photos at a time keeps sorting quick.`, 5000), 3800);

  const el = document.querySelector('[data-folder="to-sort"]');
  selectFolder('to-sort', el);
  setTimeout(() => geocodeFiles(), 1000);
}

async function bulkMarkSorted() {
  // Ctrl+A / clicking a burst's collapsed cover only selects the cover id - its
  // hidden sibling frames never get selectedIds entries, so without expanding
  // through burstCoverMap here they'd silently keep toSort:true and reappear in
  // To Sort every time, even after "everything" was just marked sorted.
  const ids = new Set(selectedIds);
  ids.forEach(id => { burstCoverMap.get(id)?.memberIds.forEach(m => ids.add(m)); });
  let count = 0;
  ids.forEach(id => { const f=appData.files.find(f=>f.id===id); if(f && f.toSort) { f.toSort=false; count++; } });
  clearSelection();
  await saveData();
  toast(count > 1 ? `✅ Marked ${count} files as sorted` : '✅ Marked as sorted');
}

// ── ADD FILES ─────────────────────────────────────────────────────────────────
async function addFiles() {
  if (currentFolder === 'to-sort') { await dumpFiles(); return; }
  const newFiles = await window.api.openFileDialog();
  if (!newFiles.length) return;
  let added = 0;
  newFiles.forEach(nf => {
    if (!appData.files.find(f=>f.path===nf.path)) {
      if (isAssignableFolder(currentFolder))
        nf.folders = [currentFolder];
      appData.files.push(nf); added++;
    }
  });
  if (added > 0) {
    await autoCreateCameraFolders(newFiles.filter(f => appData.files.includes(f) || true));
    await saveData();
    queueForIndexing(newFiles);
    toast(`✅ Added ${added} file${added>1?'s':''}`);
    setTimeout(() => geocodeFiles(), 1000);
  } else toast('ℹ️ Already in library');
}

async function openFileById(id) {
  const f = appData.files.find(f=>f.id===id);
  if (!f) return;
  const r = await window.api.openFile(f.path);
  if (!r.success) toast('⚠️ File not found - it may have moved');
}
function openFile(e, id) { e.stopPropagation(); openFileById(id); }
// The LIVE badge's click target - opens the hidden .mov companion with the OS's default
// player, same as double-clicking any other video would. See linkLivePhotoPairs() for how
// file.livePhotoVideoId gets set.
function playLivePhoto(stillId) {
  const still = appData.files.find(f => f.id === stillId);
  const video = still?.livePhotoVideoId ? appData.files.find(f => f.id === still.livePhotoVideoId) : null;
  if (video) openMediaPopup(video); // plays in the popup's own <video>, same as any other video - see renderPopupFile's isVid branch
  else toast('⚠️ Live Photo video not found - it may have moved');
}
async function showInFolder(e, id) { e.stopPropagation(); const f=appData.files.find(f=>f.id===id); if(f) await window.api.showInFolder(f.path); }

async function toggleBestOf(e, id) {
  e.stopPropagation();
  const f = appData.files.find(f=>f.id===id);
  if (!f) return;
  f.bestOf = !f.bestOf;
  await saveData();
  toast(f.bestOf ? '⭐ Added to Best Of' : '☆ Removed from Best Of');
}

async function ctxTogglePin() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : [ctxFileId];
  const first = appData.files.find(f => f.id === ids[0]);
  const newVal = !first?.pinned;
  ids.forEach(id => { const f = appData.files.find(f => f.id === id); if (f) f.pinned = newVal; });
  await saveData();
  renderFiles();
  const count = ids.length;
  toast(newVal ? `📌 Pinned ${count} file${count!==1?'s':''}` : `📌 Unpinned ${count} file${count!==1?'s':''}`);
}

async function removeFile(e, id) {
  e.stopPropagation();
  const idx = appData.files.findIndex(f => f.id === id);
  const file = appData.files[idx];
  if (!file) return;
  appData.files = appData.files.filter(f=>f.id!==id);
  await saveData();
  undoToast('🗑️ Shortcut removed', async () => {
    appData.files.splice(Math.min(idx, appData.files.length), 0, file);
    await saveData();
  });
}

// ── ASSIGN MODAL ──────────────────────────────────────────────────────────────
function showAssignModal(e, fileId) {
  e.stopPropagation(); assigningMultiple = false; modalFileId = fileId;
  const file = appData.files.find(f=>f.id===fileId);
  document.getElementById('assignModalName').textContent = file?.name || '';
  const burst = burstCoverMap.get(fileId);
  document.getElementById('assignModalSub').textContent = burst
    ? `Part of a burst of ${burst.count} - folders you pick apply to all ${burst.count} photos`
    : 'Select which folders to link this file to';
  buildAssignBody();
  document.getElementById('assignModal').classList.add('open');
}

function buildAssignBody() {
  const body = document.getElementById('assignModalBody');
  body.innerHTML = '';
  const newFolderRow = document.createElement('button');
  newFolderRow.className = 'fc-new-folder-btn';
  newFolderRow.textContent = '+ New Folder';
  newFolderRow.onclick = () => addFolderFromAssignModal(null);
  body.appendChild(newFolderRow);
  let bestChecked = assigningMultiple
    ? [...selectedIds].every(id => appData.files.find(f=>f.id===id)?.bestOf)
    : (appData.files.find(f=>f.id===modalFileId)?.bestOf || false);
  const favRow = document.createElement('div');
  favRow.className = 'fc-fav-row';
  favRow.innerHTML = `<input type="checkbox" id="fc-favorites" ${bestChecked?'checked':''}/><label class="fc-fav-label" for="fc-favorites">⭐ Best Of</label>`;
  body.appendChild(favRow);
  const camRoot = appData.folders.find(f=>f.name==='Cameras'&&!f.parentId);
  const vacRoot = appData.folders.find(f=>f.id==='vacations-root');
  const advRoot = appData.folders.find(f=>f.id===ADVENTURES_ROOT_ID);
  const sysRootIds = new Set([camRoot?.id, vacRoot?.id, advRoot?.id].filter(Boolean));
  // User folders
  const topLevel = appData.folders.filter(f => !f.parentId && !sysRootIds.has(f.id));
  if (topLevel.length) topLevel.forEach(f => buildFolderCheckItem(f, body, 0, sysRootIds));
  // Camera sub-folders
  const camSubs = camRoot ? appData.folders.filter(f => f.parentId === camRoot.id) : [];
  if (camSubs.length) {
    const sec = document.createElement('div'); sec.className = 'fc-section-label'; sec.textContent = '📷 Cameras'; body.appendChild(sec);
    camSubs.forEach(f => buildFolderCheckItem(f, body, 0, sysRootIds));
  }
  // Vacation sub-folders
  const vacSubs = vacRoot ? appData.folders.filter(f => f.parentId === vacRoot.id) : [];
  if (vacSubs.length) {
    const sec = document.createElement('div'); sec.className = 'fc-section-label'; sec.textContent = '✈️ Vacations'; body.appendChild(sec);
    vacSubs.forEach(f => buildFolderCheckItem(f, body, 0, sysRootIds));
  }
  const advSubs = advRoot ? appData.folders.filter(f => f.parentId === advRoot.id) : [];
  if (advSubs.length) {
    const sec = document.createElement('div'); sec.className = 'fc-section-label'; sec.textContent = '🧭 Adventures'; body.appendChild(sec);
    advSubs.forEach(f => buildFolderCheckItem(f, body, 0, sysRootIds));
  }
  if (!topLevel.length && !camSubs.length && !vacSubs.length && !advSubs.length) {
    body.innerHTML += '<div style="color:var(--text3);font-size:12.5px;padding:6px 0">No folders yet.</div>';
  }
}

function buildFolderCheckItem(folder, container, depth, camIds) {
  const getChecked = () => assigningMultiple
    ? [...selectedIds].every(id => appData.files.find(f=>f.id===id)?.folders?.includes(folder.id))
    : (appData.files.find(f=>f.id===modalFileId)?.folders?.includes(folder.id) || false);
  const item = document.createElement('div');
  item.className = 'fc-item';
  item.style.paddingLeft = (9 + depth*14) + 'px';
  item.innerHTML = `
    <input type="checkbox" id="fc-${folder.id}" ${getChecked()?'checked':''}/>
    <div class="si-dot" style="background:${folder.color||'#3d6f8f'}"></div>
    <label class="fc-label" for="fc-${folder.id}">${esc(folderEmojiPrefix(folder))}${esc(folder.name)}</label>
    <button type="button" class="fc-add-sub-btn" title="Add a subfolder inside ${esc(folder.name)}" onclick="event.preventDefault();addFolderFromAssignModal('${folder.id}')">+</button>`;
  container.appendChild(item);
  appData.folders.filter(f=>f.parentId===folder.id&&!camIds.has(f.id)).forEach(c => buildFolderCheckItem(c, container, depth+1, camIds));
}

function closeAssignModal() { document.getElementById('assignModal').classList.remove('open'); modalFileId=null; assigningMultiple=false; }

// Opens the New Folder modal on top of the still-open Assign modal (both share the same
// .modal-backdrop stacking, so this just layers correctly) - createFolder() checks
// newFolderReturnToAssign to hand back to buildAssignBody() instead of just closing out.
function addFolderFromAssignModal(parentId) {
  newFolderReturnToAssign = true;
  openNewFolderModal(parentId);
}

async function saveAssignments() {
  const favCb = document.getElementById('fc-favorites');
  const rawTargets = assigningMultiple ? [...selectedIds] : [modalFileId];
  // A burst's collapsed cover card represents N hidden sibling files - assigning
  // folders to "this photo" should mean the whole burst, or organizing one frame
  // silently leaves the other 9 unfiled with no way to tell from the UI.
  const targets = new Set(rawTargets);
  rawTargets.forEach(id => { burstCoverMap.get(id)?.memberIds.forEach(m => targets.add(m)); });
  for (const id of targets) {
    const file = appData.files.find(f=>f.id===id);
    if (!file) continue;
    if (favCb) file.bestOf = favCb.checked;
    if (!file.folders) file.folders = [];
    const camRoot = appData.folders.find(f=>f.name==='Cameras'&&!f.parentId);
    const vacRoot = appData.folders.find(f=>f.id==='vacations-root');
    const rootOnlyIds = new Set([camRoot?.id, vacRoot?.id, ADVENTURES_ROOT_ID].filter(Boolean));
    file.folders = [];
    appData.folders.filter(f => !rootOnlyIds.has(f.id)).forEach(folder => {
      const cb = document.getElementById(`fc-${folder.id}`);
      if (cb?.checked) file.folders.push(folder.id);
    });
  }
  await saveData(); closeAssignModal(); toast('✅ Folders updated');
  if (assigningMultiple) clearSelection(); // they're filed - the selection has done its job
}

// ── DRAG-FILES-ONTO-A-SIDEBAR-FOLDER, and OUT to another app ────────────────────
// A distinct, plain native HTML5 drag-and-drop pair (file card = source, sidebar folder
// row = target) - NOT the mousedown-based custom drag attachFolderDrag() uses for
// reordering folders among siblings (see its own comment for why that one avoids native
// DnD). The two never touch the same event stream: reordering only starts on a mousedown
// over the row itself, native DnD only starts once dragstart fires on a file card, so a
// folder row can freely be a reorder-source and a file-drop-target at the same time.
//
// handleFileDragStart hands the gesture to Electron's native startDrag (main.js's
// 'start-file-drag' handler) instead of running the ordinary HTML5 DnD sequence, so dropping a
// card onto another application (a video/photo editor, Explorer, anywhere) delivers the real
// file - zero-copy, exactly like dragging it out of Explorer, matching how Trove never
// duplicates files anywhere else either. preventDefault() on dragstart cancels the normal HTML5
// drag per spec, so the old FILE_DRAG_MIME dataTransfer payload below is no longer reachable by
// drop handlers - attachFolderDropTarget's drop handler instead resolves the real dropped Files
// back to file ids by path (a Trove-originated native drag landing back on a sidebar row still
// works this way; a genuinely new, never-imported file dropped there falls through untouched to
// the normal import flow in setupDragDrop() instead of being silently swallowed here). Known
// caveat (see electron/electron#7118): on Windows, a startDrag-initiated session doesn't always
// deliver a drop back into the same window - which is why a drag inside the window never goes
// native at all (see beginFileDrag below). Only leaving the window hands it to the OS.
const FILE_DRAG_MIME = 'application/x-filelinker-fileids';

function handleFileDragStart(e, fileId) {
  const ids = (selectedIds.has(fileId) && selectedIds.size > 1) ? [...selectedIds] : [fileId];
  const paths = ids.map(id => appData.files.find(f => f.id === id)?.path).filter(Boolean);
  if (!paths.length) return;
  e.preventDefault(); // no HTML5 drag - see beginFileDrag
  beginFileDrag(ids, paths, fileId, e);
}

// Dragging cards onto a sidebar folder, done by hand rather than through native drag and drop:
// a native drag started with startDrag (what lets a card be dropped into another app) often
// never delivers its drop back into Trove's own window on Windows, so dropping onto a folder
// silently did nothing. Inside the window a small thumbnail follows the cursor, the folder under
// it lights up and letting go adds the files to it (assignFilesToFolderAdditive - every other
// folder they're in stays). The moment the cursor leaves the window, the drag is handed to the
// OS as before, still holding the mouse button, so dropping into an editor or Explorer works.
let fileDrag = null; // { ids, paths, ghost, target }

function beginFileDrag(ids, paths, fileId, e) {
  endFileDrag();
  const file = appData.files.find(f => f.id === fileId);
  const src = document.querySelector(`[data-thumb-for="${CSS.escape(fileId)}"] img`)?.src;
  const ghost = document.createElement('div');
  ghost.className = 'file-drag-ghost';
  ghost.innerHTML = (src ? `<img src="${src}" alt=""/>` : `<span>${getEmoji(file?.ext || '')}</span>`)
    + (ids.length > 1 ? `<b>${ids.length}</b>` : '');
  document.body.appendChild(ghost);
  document.body.classList.add('file-dragging');
  fileDrag = { ids, paths, ghost, target: null };
  moveFileDrag(e.clientX, e.clientY);
  document.addEventListener('mousemove', onFileDragMove, true);
  document.addEventListener('mouseup', onFileDragUp, true);
  document.addEventListener('keydown', onFileDragKey, true);
  document.documentElement.addEventListener('mouseleave', handFileDragToOs);
  window.addEventListener('blur', endFileDrag);
}
function moveFileDrag(x, y) {
  if (!fileDrag) return;
  fileDrag.ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  const target = document.elementFromPoint(x, y)?.closest('[data-drop-folder]') || null;
  if (target === fileDrag.target) return;
  fileDrag.target?.classList.remove('si-drop-target');
  target?.classList.add('si-drop-target');
  fileDrag.target = target;
}
function onFileDragMove(e) {
  if (!fileDrag) return;
  if (!(e.buttons & 1)) { endFileDrag(); return; } // the button came up somewhere we didn't hear about
  const out = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth - 1 || e.clientY >= window.innerHeight - 1;
  if (out) { handFileDragToOs(); return; }
  moveFileDrag(e.clientX, e.clientY);
}
function onFileDragUp(e) {
  if (!fileDrag) return;
  const { ids, target } = fileDrag;
  endFileDrag();
  if (!target) return;
  e.preventDefault(); e.stopPropagation();
  // Dragging a selection onto a folder files all of it - after which it's deselected.
  assignFilesToFolderAdditive(ids, target.dataset.dropFolder).then(() => { if (ids.some(id => selectedIds.has(id))) clearSelection(); });
}
function onFileDragKey(e) {
  if (fileDrag && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endFileDrag(); }
}
function handFileDragToOs() {
  if (!fileDrag) return;
  const { ids, paths } = fileDrag;
  endFileDrag();
  window.api.startFileDrag(paths, ids.length === 1 ? ids[0] : null);
}
function endFileDrag() {
  if (!fileDrag) return;
  fileDrag.target?.classList.remove('si-drop-target');
  fileDrag.ghost.remove();
  fileDrag = null;
  document.body.classList.remove('file-dragging');
  document.removeEventListener('mousemove', onFileDragMove, true);
  document.removeEventListener('mouseup', onFileDragUp, true);
  document.removeEventListener('keydown', onFileDragKey, true);
  document.documentElement.removeEventListener('mouseleave', handFileDragToOs);
  window.removeEventListener('blur', endFileDrag);
}

// Shared by every sidebar row that represents a real, assignable folder (My Folders tree,
// Camera folders, Trip folders) - not attached to country/region rows, which are derived
// from GPS metadata rather than real folder membership and have nothing to assign into.
function attachFolderDropTarget(item, folderId) {
  item.dataset.dropFolder = folderId; // what an in-window card drag looks for - see beginFileDrag
  item.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes(FILE_DRAG_MIME) && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    item.classList.add('si-drop-target');
  });
  item.addEventListener('dragleave', () => item.classList.remove('si-drop-target'));
  item.addEventListener('drop', e => {
    if (!e.dataTransfer.types.includes(FILE_DRAG_MIME) && !e.dataTransfer.types.includes('Files')) return;
    item.classList.remove('si-drop-target');
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData(FILE_DRAG_MIME) || '[]'); } catch (err) {}
    if (!ids.length && e.dataTransfer.files?.length) {
      const paths = [...e.dataTransfer.files].map(f => { try { return window.api.getPathForFile(f); } catch (err) { return ''; } }).filter(Boolean);
      ids = paths.map(p => appData.files.find(f => f.path === p)?.id).filter(Boolean);
      if (!ids.length) return; // not a file Trove already knows about - let it bubble to the normal import handler
    }
    e.preventDefault(); e.stopPropagation();
    if (!ids.length) return;
    // Dragging a selection onto a folder files all of it - after which it's deselected.
    assignFilesToFolderAdditive(ids, folderId).then(() => { if (ids.some(id => selectedIds.has(id))) clearSelection(); });
  });
}

// Adds folderId to each file's folder list without touching any folder it's already in -
// the same net effect as opening "Move to Folder" and checking one more box, just without
// the modal. Expands burst covers the same way saveAssignments() does, so dropping a
// collapsed burst card doesn't silently skip its hidden sibling frames.
async function assignFilesToFolderAdditive(fileIds, folderId) {
  const folder = appData.folders.find(f => f.id === folderId);
  if (!folder) return;
  const idSet = new Set(fileIds);
  fileIds.forEach(id => { burstCoverMap.get(id)?.memberIds.forEach(m => idSet.add(m)); });
  let count = 0;
  idSet.forEach(id => {
    const file = appData.files.find(f => f.id === id);
    if (!file) return;
    if (!file.folders) file.folders = [];
    if (!file.folders.includes(folderId)) { file.folders.push(folderId); count++; }
  });
  if (!count) { toast(`ℹ️ Already in "${folder.name}"`); return; }
  await saveData();
  toast(`📁 Added ${count} file${count !== 1 ? 's' : ''} to "${folder.name}"`);
}

// ── EDIT PROPERTIES MODAL ─────────────────────────────────────────────────────
function showEditModal(fileId) {
  editFileId = fileId;
  // Multiple files selected (including this one) -> bulk edit: whatever the
  // form is set to on save applies to every selected file, not just fileId.
  editFileIds = (selectedIds.size > 1 && selectedIds.has(fileId)) ? [...selectedIds] : [fileId];
  const file = appData.files.find(f => f.id === fileId);
  if (!file) return;
  const burst = burstCoverMap.get(fileId);
  if (editFileIds.length > 1) {
    document.getElementById('editModalSub').textContent = `Editing ${editFileIds.length} selected files - changes apply to all of them`;
  } else {
    document.getElementById('editModalSub').textContent = burst
      ? `${file.name} - part of a burst of ${burst.count}, changes apply to all ${burst.count} photos`
      : file.name;
  }
  document.getElementById('epCamera').value = file.cameraFolder || file.cameraMake || '';
  document.getElementById('epTags').value = (file.tags || []).join(', ');
  document.getElementById('epNotes').value = file.notes || '';
  if (file.fileDate) {
    const d = new Date(file.fileDate);
    const local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('epDate').value = local;
  } else {
    document.getElementById('epDate').value = '';
  }
  document.getElementById('epLat').value = file.gps?.lat ?? '';
  document.getElementById('epLng').value = file.gps?.lng ?? '';
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() { document.getElementById('editModal').classList.remove('open'); editFileId = null; editFileIds = []; resumePopupReturn(); }

async function saveEditProperties() {
  // Every selected file (each expanded with its own burst siblings, since a
  // collapsed cover card stands in for N hidden frames) gets the same values
  // the form is set to - this is a bulk edit, not just an edit of editFileId.
  const targetIds = new Set(editFileIds.length ? editFileIds : [editFileId]);
  targetIds.forEach(id => { burstCoverMap.get(id)?.memberIds.forEach(m => targetIds.add(m)); });
  const files = [...targetIds].map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  if (!files.length) { closeEditModal(); return; }

  const typedCamera = document.getElementById('epCamera').value.trim();
  const camera = typedCamera && resolveCameraName(typedCamera); // "insta 360" files under the existing Insta360

  const dateVal = document.getElementById('epDate').value;
  const ts = dateVal ? new Date(dateVal).getTime() : NaN;

  const latVal = document.getElementById('epLat').value;
  const lat = parseFloat(latVal);
  const lng = parseFloat(document.getElementById('epLng').value);
  const gpsValid = !isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const gpsCleared = !latVal.trim();

  const tags = [...new Set(document.getElementById('epTags').value.split(',').map(t => t.trim()).filter(Boolean))];
  const notes = document.getElementById('epNotes').value.trim() || null;

  for (const file of files) {
    if (camera) { file.cameraFolder = camera; file.cameraMake = camera; }
    else { file.cameraFolder = null; }

    if (!isNaN(ts)) file.fileDate = ts;

    if (gpsValid) {
      file.gps = { lat, lng };
      file.gpsManual = true; // hand-entered - never touched by automated GPS re-derivation
      file.country = null; file.countryCode = null; file.region = null; file.city = null; file.noGeocode = false; // re-geocode with new coords
    } else if (gpsCleared) {
      file.gps = null; file.gpsManual = false; file.country = null; file.countryCode = null; file.region = null; file.city = null; file.noGeocode = false;
    }

    file.tags = [...tags];
    file.notes = notes;
  }

  // Auto-create camera folder if new camera set
  if (camera) await autoCreateCameraFolders(files);

  await saveData();
  closeEditModal();
  toast(files.length > 1 ? `✅ Properties saved for ${files.length} photos` : '✅ Properties saved');
  setTimeout(() => geocodeFiles(), 500);
}

// ── FOLDER CRUD ───────────────────────────────────────────────────────────────
function openNewFolderModal(parentId) {
  editingFolderId = null;
  forcedNewFolderParent = null;
  creatingSection = false;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji('📁');
  document.getElementById('nfmTitle').textContent = parentId ? 'New Subfolder' : 'New Folder';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = '';
  const sel = document.getElementById('nfmParent');
  sel.innerHTML = '<option value="">- None (top level) -</option>';
  const sysRoots = getManagedRootIds();
  sel.onchange = () => setNfmEmoji(isEmojiFreeFolder(appData.folders.find(f => f.id === sel.value)) ? '' : '📁');
  const addOpts = (pid, depth) => {
    // Some older folders predate parentId always being set explicitly to null, so they
    // have the key missing entirely (undefined) rather than null - treat those as root too.
    appData.folders.filter(f => (f.parentId ?? null) === pid).forEach(f => {
      if (sysRoots.has(f.id)) { addOpts(f.id, depth); return; }
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = ' '.repeat(depth * 3) + `${folderEmojiPrefix(f)}${f.name}`;
      if (f.id === parentId) o.selected = true;
      sel.appendChild(o);
      addOpts(f.id, depth + 1);
    });
  };
  addOpts(null, 0);
  toggleNfmDatesRow(false);
  selectedColor = COLORS[0]; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(()=>document.getElementById('nfmName').focus(),60);
}

// Like openNewFolderModal, but pins the parent and hides the picker entirely instead of just
// pre-selecting it. Needed for any managed root (Trips/People/Categories/Cameras, or a custom
// section) - those deliberately never appear as options in the picker itself (see addOpts
// above, which flattens straight past a sysRoot rather than listing it), so pre-selecting one
// there would silently fall back to top-level instead. Used by custom sections' own "+ New…"
// and by folderCtxAddSub when "Add Sub-folder" targets a root via a section header's right-click.
function openNewFolderModalForced(parentId, titleText) {
  editingFolderId = null;
  forcedNewFolderParent = parentId;
  creatingSection = false;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji(isEmojiFreeFolder(appData.folders.find(f => f.id === parentId)) ? '' : '📁');
  document.getElementById('nfmTitle').textContent = titleText || 'New Folder';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = 'none';
  toggleNfmDatesRow(false);
  const parent = appData.folders.find(f => f.id === parentId);
  selectedColor = parent?.color || COLORS[0]; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(()=>document.getElementById('nfmName').focus(),60);
}

// "+ Add Section…" - if any built-in section (Trips/People/Categories/Cameras/Location) is
// currently hidden, offer restoring it right here instead of making someone dig through Settings
// for what's usually a one-click undo of an accidental/exploratory hide - see hideSidebarSection().
// Only falls through to the actual "create a brand-new section" flow (openCreateSectionModal)
// when nothing's hidden, so the common case stays exactly as fast as it always was.
function openNewSectionModal(e) {
  const hidden = (appData.hiddenSidebarSections || []).filter(k => SIDEBAR_SECTIONS[k]);
  if (hidden.length && e) { showAddSectionMenu(e, hidden); return; }
  openCreateSectionModal();
}

function showAddSectionMenu(e, hidden) {
  e.preventDefault(); e.stopPropagation();
  hideCtxMenu(); hideFolderCtxMenu(); hideSectionCtxMenu();
  const menu = document.getElementById('addSectionMenu');
  menu.innerHTML = hidden.map(key => `
    <div class="ctx-item" onclick="restoreSectionFromAddMenu('${key}')"><span class="ctx-icon">↩️</span> Show ${SIDEBAR_SECTIONS[key].label}</div>
  `).join('') + `
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="hideAddSectionMenu();openCreateSectionModal();"><span class="ctx-icon">➕</span> New Section…</div>
  `;
  menu.classList.add('open');
  positionCtxMenu(menu, e.clientX, e.clientY);
}
function hideAddSectionMenu() { document.getElementById('addSectionMenu')?.classList.remove('open'); }
function restoreSectionFromAddMenu(key) { hideAddSectionMenu(); showSidebarSection(key); }

// A brand-new top-level sidebar section (its own header, own "+ New…", own right-click
// Customize/Delete) rather than a folder that lands in the generic 📁 Folders catch-all - see
// buildCustomSectionDef. Under the hood it's still just a top-level folder, marked isSection.
function openCreateSectionModal() {
  editingFolderId = null;
  forcedNewFolderParent = null;
  creatingSection = true;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji('📁');
  document.getElementById('nfmTitle').textContent = 'New Section';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = 'none';
  toggleNfmDatesRow(false);
  selectedColor = COLORS[0]; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(()=>document.getElementById('nfmName').focus(),60);
}

function closeNewFolderModal() {
  document.getElementById('newFolderModal').classList.remove('open');
  document.getElementById('nfmParent').style.display = '';
  editingFolderId = null;
  forcedNewFolderParent = null;
  newFolderReturnToAssign = false;
  creatingSection = false;
  clearNfmIconImage();
}

async function createFolder() {
  const name = document.getElementById('nfmName').value.trim();
  if (!name) { document.getElementById('nfmName').focus(); return; }
  const noEmoji = document.getElementById('nfmEmoji').style.display === 'none';
  const icon = document.getElementById('nfmEmoji').value.trim() || '📁';

  if (editingFolderId) {
    // Editing existing folder (rename / recolor)
    const folder = appData.folders.find(f => f.id === editingFolderId);
    // A camera folder is tied to its files by name, so renaming one renames their camera too -
    // and renaming it to a camera that already exists makes them one camera.
    const camRoot = getCameraRoot();
    const isCamera = folder && camRoot && folder.parentId === camRoot.id;
    const sameAs = isCamera && getCameraFolders().find(f => f !== folder && sameCameraName(f.name, name));
    if (sameAs) {
      mergeCameraFolder(folder.id, sameAs.id);
      await saveData(); closeNewFolderModal();
      if (currentFolder === sameAs.id) selectFolder(sameAs.id);
      toast(`📷 Merged into "${sameAs.name}" - it was the same camera`);
      return;
    }
    if (folder) {
      if (isCamera && folder.name !== name) {
        appData.files.forEach(f => {
          if (f.cameraFolder === folder.name) f.cameraFolder = name;
          if (f.cameraMake === folder.name) f.cameraMake = name;
        });
      }
      folder.name = name; folder.color = selectedColor;
      if (noEmoji) delete folder.icon; else folder.icon = icon;
      if (nfmIconImage) folder.iconImage = nfmIconImage; else delete folder.iconImage;
      if (isTripLikeRootId(folder.parentId)) Object.assign(folder, readNfmDates());
    }
    await saveData(); closeNewFolderModal(); toast('✅ Folder updated');
  } else {
    // A section is always top-level, full stop - forced to null rather than falling through to
    // the (hidden, possibly stale from an earlier create in this session) parent <select>.
    const parentId = creatingSection ? null : (forcedNewFolderParent || document.getElementById('nfmParent').value || null);
    const newFolder = { id:'f'+Date.now().toString(36), name, color:selectedColor, parentId };
    if (!noEmoji && !isEmojiFreeFolder(appData.folders.find(f => f.id === parentId))) newFolder.icon = icon;
    if (creatingSection) newFolder.isSection = true;
    if (nfmIconImage) newFolder.iconImage = nfmIconImage;
    if (isTripLikeRootId(parentId)) Object.assign(newFolder, readNfmDates());
    const returnToAssign = newFolderReturnToAssign;
    appData.folders.push(newFolder);
    await saveData(); closeNewFolderModal(); toast(`✅ "${name}" created`);
    if (returnToAssign) {
      buildAssignBody();
      const cb = document.getElementById('fc-' + newFolder.id);
      if (cb) cb.checked = true;
    }
  }
}

// ── FOLDER ICON IMAGE (custom logo instead of an emoji) ──────────────────────
// Optional - most folders just use the emoji field. This lets someone use an actual image
// (a logo, an icon) instead, stored inline as a data URL (folder.iconImage) and preferred over
// folder.icon everywhere folderIconHtml() is used. Capped at 2MB so appData.json (saved as one
// plain JSON blob, no separate asset store) doesn't balloon from a handful of full-res photos.
// Pre-fills the modal's emoji box, or hides it entirely for trips/adventures/people/cameras
// (value '') - see isEmojiFreeFolder(). createFolder() reads the hidden state back.
function setNfmEmoji(value) {
  const input = document.getElementById('nfmEmoji');
  input.value = value || '📁';
  input.style.display = value ? '' : 'none';
}
function refreshNfmIconImageUI() {
  const img = document.getElementById('nfmIconImagePreview');
  const clearBtn = document.getElementById('nfmIconImageClearBtn');
  const emojiInput = document.getElementById('nfmEmoji');
  if (!img || !clearBtn || !emojiInput) return;
  if (nfmIconImage) {
    img.src = nfmIconImage; img.style.display = '';
    clearBtn.style.display = '';
    emojiInput.style.opacity = '.4';
  } else {
    img.style.display = 'none';
    clearBtn.style.display = 'none';
    emojiInput.style.opacity = '';
  }
}
function handleNfmIconImageSelect(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('⚠️ Pick an image file'); return; }
  if (file.size > 2 * 1024 * 1024) { toast('⚠️ Image too large - pick one under 2MB'); return; }
  const reader = new FileReader();
  reader.onload = () => { nfmIconImage = reader.result; refreshNfmIconImageUI(); };
  reader.readAsDataURL(file);
}
function clearNfmIconImage() {
  nfmIconImage = null;
  refreshNfmIconImageUI();
}

async function deleteFolderClick(e, id) {
  e.stopPropagation();
  const folder = appData.folders.find(f=>f.id===id);
  if (!folder) return;
  const toRemove = [id, ...getAllDesc(id)];
  const removedFolders = toRemove
    .map(fid => ({ folder: appData.folders.find(f => f.id === fid), idx: appData.folders.findIndex(f => f.id === fid) }))
    .filter(r => r.folder)
    .sort((a, b) => a.idx - b.idx);
  const affectedFiles = appData.files
    .map(f => f.folders ? { file: f, removedIds: f.folders.filter(i => toRemove.includes(i)) } : null)
    .filter(r => r && r.removedIds.length);
  appData.folders = appData.folders.filter(f=>!toRemove.includes(f.id));
  appData.files.forEach(f=>{if(f.folders) f.folders=f.folders.filter(i=>!toRemove.includes(i));});
  if (toRemove.includes(currentFolder)) selectFolder('timeline');
  await saveData();
  undoToast(`🗑️ "${folder.name}" deleted`, async () => {
    for (const { folder: f, idx } of removedFolders) appData.folders.splice(Math.min(idx, appData.folders.length), 0, f);
    for (const { file, removedIds } of affectedFiles) {
      file.folders = file.folders || [];
      removedIds.forEach(fid => { if (!file.folders.includes(fid)) file.folders.push(fid); });
    }
    await saveData();
  });
}

// ── MANUAL VACATION / CAMERA ──────────────────────────────────────────────────
// Shows/hides the optional "when was this?" date range row in #newFolderModal - only
// relevant for trips (dates power date-based auto-matching of future dumps, see
// gsBuildTripMatchClusters). start/end are epoch-ms to pre-fill when editing an existing trip.
function toggleNfmDatesRow(show, start, end) {
  document.getElementById('nfmDatesLabel').style.display = show ? '' : 'none';
  document.getElementById('nfmDatesRow').style.display = show ? '' : 'none';
  document.getElementById('nfmDateStart').value = start ? new Date(start).toISOString().slice(0, 10) : '';
  document.getElementById('nfmDateEnd').value = end ? new Date(end).toISOString().slice(0, 10) : '';
}
// Reads the date row back as epoch-ms, or nulls if left blank - used by createFolder().
function readNfmDates() {
  const s = document.getElementById('nfmDateStart').value;
  const e = document.getElementById('nfmDateEnd').value;
  return {
    dateStart: s ? new Date(s + 'T00:00:00').getTime() : null,
    dateEnd: e ? new Date(e + 'T00:00:00').getTime() : null,
  };
}

function addVacation() {
  let vacRoot = appData.folders.find(f => f.id === 'vacations-root');
  if (!vacRoot) {
    vacRoot = { id: 'vacations-root', name: 'Vacations', icon: '✈️', color: '#06b6d4', parentId: null };
    appData.folders.push(vacRoot);
  }
  forcedNewFolderParent = vacRoot.id;
  editingFolderId = null;
  creatingSection = false;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji('');
  document.getElementById('nfmTitle').textContent = 'New Trip';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = 'none';
  toggleNfmDatesRow(true);
  selectedColor = '#06b6d4'; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(() => document.getElementById('nfmName').focus(), 60);
}

function addAdventure() {
  forcedNewFolderParent = getOrCreateAdventuresRoot().id;
  editingFolderId = null;
  creatingSection = false;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji('');
  document.getElementById('nfmTitle').textContent = 'New Adventure';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = 'none';
  toggleNfmDatesRow(true);
  selectedColor = ADVENTURE_COLOR; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(() => document.getElementById('nfmName').focus(), 60);
}

// Right-click "Move to Adventures" / "Move to Trips": the folder keeps its id, photos, cover,
// dates and subfolders - only which root it hangs off changes, so nothing has to be re-sorted.
async function folderCtxSwapTripKind() {
  hideFolderCtxMenu();
  const folder = appData.folders.find(f => f.id === folderCtxId);
  if (!folder || !isTripLikeRootId(folder.parentId)) return;
  const toAdventure = folder.parentId === VACATIONS_ROOT_ID;
  const target = toAdventure ? getOrCreateAdventuresRoot() : getOrCreateVacationsRoot();
  const clash = appData.folders.find(f => f.parentId === target.id && f.id !== folder.id && f.name.toLowerCase() === folder.name.toLowerCase());
  if (clash) { toast(`⚠️ There's already ${toAdventure ? 'an adventure' : 'a trip'} called "${folder.name}"`); return; }
  folder.parentId = target.id;
  await saveData();
  toast(toAdventure ? `🧭 "${folder.name}" is now an adventure` : `✈️ "${folder.name}" is now a trip`);
}

function addCameraManual() {
  let camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  if (!camRoot) {
    camRoot = { id: 'cam-root', name: 'Cameras', icon: '📸', color: '#3d6f8f', parentId: null };
    appData.folders.push(camRoot);
  }
  forcedNewFolderParent = camRoot.id;
  editingFolderId = null;
  creatingSection = false;
  clearNfmIconImage();
  document.getElementById('nfmName').value = '';
  setNfmEmoji('');
  document.getElementById('nfmTitle').textContent = 'New Camera';
  document.getElementById('nfmSaveBtn').textContent = 'Create';
  document.getElementById('nfmParent').style.display = 'none';
  toggleNfmDatesRow(false);
  selectedColor = COLORS[0]; setupColorSwatches();
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(() => document.getElementById('nfmName').focus(), 60);
}

// ── COLORS ────────────────────────────────────────────────────────────────────
function setupColorSwatches() {
  const row = document.getElementById('colorSwatches');
  row.innerHTML = '';
  COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'color-swatch'+(c===selectedColor?' selected':'');
    s.style.background = c;
    s.onclick = () => { selectedColor = c; setupColorSwatches(); };
    row.appendChild(s);
  });
  // Custom color - any color via the native OS picker, not just the 9 presets above
  const isCustom = !COLORS.includes(selectedColor);
  const custom = document.createElement('div');
  custom.className = 'color-swatch color-swatch-custom' + (isCustom ? ' selected' : '');
  custom.title = 'Custom color…';
  custom.style.background = isCustom ? selectedColor : '#2a2a32';
  custom.onclick = () => document.getElementById('colorCustomInput').click();
  row.appendChild(custom);
  const input = document.getElementById('colorCustomInput');
  input.value = isCustom ? selectedColor : COLORS[0];
  input.oninput = () => { selectedColor = input.value; setupColorSwatches(); };
}

function setView(v, doRender = true) {
  currentView = v;
  document.getElementById('gridBtn').classList.toggle('active', v==='grid');
  document.getElementById('listBtn').classList.toggle('active', v==='list');
  document.getElementById('tlBtn').classList.toggle('active', v==='timeline');
  if (doRender) renderFiles();
}

// Pure persistence: schedules the debounced disk write, nothing else. Shared by saveData()
// below and by persistQuiet() (used where the caller specifically needs to persist without
// triggering renderAfterChange() - see persistQuiet's own comment for why).
function persistToDisk() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await window.api.saveData(appData);
    setLastSavedLabel(Date.now());
  }, 400);
}

// Pure re-render: reflects the current in-memory appData in the UI, without touching disk.
function renderAfterChange() {
  renderSidebar();
  renderFiles();
  updateSelectionUI();
}

// The default, common case: persist (batched, 400ms) and re-render (immediate).
// A pending write is flushed on beforeunload (see init).
// iPhone Live Photos import as two separate files sharing one base filename - a still
// (HEIC/JPG) plus a short ~1-3s companion .mov - which otherwise show up as two unrelated
// library entries (a photo card AND a full video card) for what the user experiences as one
// photo. Matching on exact base filename + a HEIC/JPG-vs-.mov pair is Apple's own Live Photo
// export convention (Photos.app, AirDrop, Image Capture, Finder all preserve it), and is a far
// stronger signal than the date/GPS/visual-hash heuristics computeEditedPairs needs for actual
// edits - so this doesn't reuse that machinery, a Live Photo's video isn't "an edited version"
// of its still.
// Runs from saveData() (the one funnel nearly every mutation already goes through - see
// dataGen's comment below) so it self-heals an existing library the moment anything triggers a
// save, and keeps re-linking every future import, without needing a hook at each of the several
// places files get added. livePhotoChecked keeps repeat runs cheap: only files never
// examined before are looked at again, and matching still searches the whole library so a
// photo/video pair split across two separate import batches is caught either way.
function livePhotoBaseKey(filename) {
  return String(filename).replace(/\.[^.]+$/, '').toUpperCase();
}
// Filename alone isn't enough - iPhone's IMG_#### counter wraps around every few thousand
// shots, so "IMG_7097.jpeg" from a Mexico trip and an unrelated "IMG_7097.MOV" shot in
// Iceland seven years later share a base name by pure coincidence. A real Live Photo's
// still and video are captured within about a second of each other, so requiring both
// fileDate values to be present and close is what actually distinguishes a true pair from
// a same-numbered coincidence - a 60s window comfortably covers any rounding/timezone
// slop while still rejecting anything years (or even hours) apart.
const LIVE_PHOTO_MAX_DATE_DELTA_MS = 60 * 1000;
function livePhotoDatesMatch(a, b) {
  return !!(a.fileDate && b.fileDate && Math.abs(a.fileDate - b.fileDate) <= LIVE_PHOTO_MAX_DATE_DELTA_MS);
}
function linkLivePhotoPairs() {
  const unchecked = appData.files.filter(f => !f.livePhotoChecked);
  if (!unchecked.length) return false;
  const byBase = new Map();
  for (const f of appData.files) {
    const key = livePhotoBaseKey(f.name);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(f);
  }
  let changed = false;
  for (const f of unchecked) {
    if (f.livePhotoChecked) continue; // already settled by the other half of its pair, below
    f.livePhotoChecked = true;
    const isMov = f.ext?.toLowerCase() === '.mov';
    if (!isImg(f.ext) && !isMov) continue;
    const candidates = byBase.get(livePhotoBaseKey(f.name)) || [];
    if (isImg(f.ext)) {
      const vid = candidates.find(c => c.id !== f.id && c.ext?.toLowerCase() === '.mov' && !c.isLivePhotoVideo && livePhotoDatesMatch(f, c));
      if (vid) { f.livePhotoVideoId = vid.id; vid.isLivePhotoVideo = true; vid.livePhotoStillId = f.id; vid.livePhotoChecked = true; changed = true; }
    } else {
      const photo = candidates.find(c => c.id !== f.id && isImg(c.ext) && !c.livePhotoVideoId && livePhotoDatesMatch(f, c));
      if (photo) { photo.livePhotoVideoId = f.id; f.isLivePhotoVideo = true; f.livePhotoStillId = photo.id; photo.livePhotoChecked = true; changed = true; }
    }
  }
  return changed;
}

// A linked Live Photo .mov is hidden from every grid, so it can never be selected or walked
// through Guided Sort on its own - its toSort has to follow its still's, or it lingers in the
// To Sort count forever after the still was marked sorted.
function syncLivePhotoToSort() {
  const byId = new Map(appData.files.map(f => [f.id, f]));
  for (const f of appData.files) {
    if (!f.isLivePhotoVideo) continue;
    const still = byId.get(f.livePhotoStillId);
    if (still && !!f.toSort !== !!still.toSort) f.toSort = !!still.toSort;
  }
}

async function saveData() {
  linkLivePhotoPairs();
  syncLivePhotoToSort();
  dataGen++; // invalidates getVisibleFiles()'s cache - see computeVisibleFiles() above
  persistToDisk();
  renderAfterChange();
  if (typeof faceSchedulePictures === 'function') faceSchedulePictures();
  if (sortCounts.dups !== null) scheduleSortCounts(); // after the first count; later ones are quick
  updateSortButton();
}

function setLastSavedLabel(ts) {
  const btn = document.getElementById('lastSavedBtn');
  if (!btn) return;
  btn.textContent = ts ? `Last saved ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Last saved -';
}

// ── POWER SAVING (throttle background work while another app has focus) ────────
// Trove is meant to sit open all day next to a video/photo editor, so the two heaviest
// pieces of unattended background work - semanticIndex.js's idle CLIP-embedding loop and
// (when the Globe happens to be left open) its 30fps ambient-render ticker - back off the
// instant this window loses OS focus, and pick back up the instant it returns. Everything
// else (an active search, the editor, Guided Sort, saving) is user-driven, not idle
// background work, so none of it is touched here.
function setupPowerSaving() {
  window.addEventListener('blur', () => { appFocused = false; onAppFocusChange(); });
  window.addEventListener('focus', () => { appFocused = true; onAppFocusChange(); });
}
function onAppFocusChange() {
  globeCtrl?.setAmbientPaused?.(!appFocused);
  if (appFocused) { semanticRunIndexingLoop(); faceRunLoop(); }
}

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupDragDrop() {
  const overlay = document.getElementById('dropOverlay');
  document.addEventListener('dragenter', e => { e.preventDefault(); if(!frOpen && e.dataTransfer.types.includes('Files')) overlay.classList.add('visible'); });
  document.addEventListener('dragover', e => { e.preventDefault(); if(!frOpen && e.dataTransfer.types.includes('Files')) overlay.classList.add('visible'); });
  document.addEventListener('dragleave', e => { if(!e.relatedTarget||e.relatedTarget===document.documentElement) overlay.classList.remove('visible'); });
  document.addEventListener('drop', async e => {
    e.preventDefault(); overlay.classList.remove('visible');
    // The first-run wizard's Add Files step handles its own drops (frHandleDrop) and stays
    // open over the main library - anything that bubbles up here while it's open would
    // otherwise silently land in whatever folder is behind it instead of the wizard's batch.
    if (frOpen) {
      if (frStep === 'addfiles') await frHandleDrop(e);
      else toast('Go back to "Add files" in the wizard to drop more in');
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const paths = files.map(f => { try{return window.api.getPathForFile(f);}catch(err){return f.path||'';} }).filter(Boolean);
    if (!paths.length) { toast('⚠️ Could not read file paths'); return; }

    // Split dropped items into folders (imported as trips) and plain files
    const dirs = [], flat = [];
    for (const p of paths) {
      if (await window.api.isDirectory(p).catch(() => false)) dirs.push(p);
      else flat.push(p);
    }
    for (const dir of dirs) await importDroppedFolder(dir);
    if (!flat.length) return;

    const newFiles = await window.api.processDroppedPaths(flat);
    const toAdd = newFiles.filter(nf => !appData.files.find(f=>f.path===nf.path));
    if (!toAdd.length) { toast('ℹ️ Already in library'); return; }
    if (currentFolder === 'to-sort') {
      await processDump(toAdd);
    } else {
      toAdd.forEach(nf => {
        if (isAssignableFolder(currentFolder))
          nf.folders=[currentFolder];
        appData.files.push(nf);
      });
      await autoCreateCameraFolders(toAdd);
      await saveData(); toast(`✅ Added ${toAdd.length} file${toAdd.length>1?'s':''}`);
      queueForIndexing(toAdd);
      setTimeout(() => geocodeFiles(), 1000);
    }
  });
}

// Import a folder dropped from Explorer as a new trip
async function importDroppedFolder(dirPath) {
  toast('⏳ Scanning folder…', 1500);
  const res = await window.api.processDroppedFolder(dirPath).catch(() => null);
  if (!res || !res.files.length) { toast('⚠️ No media found in that folder'); return; }
  let vacRoot = appData.folders.find(f => f.id === 'vacations-root');
  if (!vacRoot) {
    vacRoot = { id: 'vacations-root', name: 'Vacations', icon: '✈️', color: '#06b6d4', parentId: null };
    appData.folders.push(vacRoot);
  }
  const trip = {
    id: 'f' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
    name: res.name, color: '#06b6d4', parentId: vacRoot.id
  };
  appData.folders.push(trip);
  const toAdd = res.files.filter(nf => !appData.files.find(f => f.path === nf.path));
  toAdd.forEach(nf => { nf.folders = [trip.id]; nf.toSort = true; appData.files.push(nf); });
  await autoCreateCameraFolders(toAdd);
  await saveData();
  queueForIndexing(toAdd);
  selectFolder(trip.id);
  toast(`✈️ Imported ${toAdd.length} file${toAdd.length!==1?'s':''} into '${res.name}'`);
  setTimeout(() => geocodeFiles(), 1000);
}

// ── GLOBE ─────────────────────────────────────────────────────────────────────
// Cesium used to load unconditionally via a static <link>/<script> in index.html on every
// app launch, regardless of whether the user ever opened the Globe - real parse/init cost
// paid by every user on every startup. Fetched on demand instead, the first time the Globe
// is actually opened; every later open in the same session is instant since window.Cesium
// is already present by then.
let cesiumLoadPromise = null;
function ensureCesiumLoaded() {
  if (window.Cesium) return Promise.resolve();
  if (cesiumLoadPromise) return cesiumLoadPromise;
  cesiumLoadPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/vendor/cesium/Widgets/widgets.css';
    document.head.appendChild(link);
    window.CESIUM_BASE_URL = 'assets/vendor/cesium/';
    const script = document.createElement('script');
    script.src = 'assets/vendor/cesium/Cesium.js';
    script.onload = () => resolve();
    script.onerror = () => { cesiumLoadPromise = null; reject(new Error('Cesium failed to load')); };
    document.body.appendChild(script);
  });
  return cesiumLoadPromise;
}

function toggleGlobe() {
  globeOpen = !globeOpen;
  document.getElementById('globeView').classList.toggle('open', globeOpen);
  document.getElementById('globeToggle').classList.toggle('active', globeOpen);
  if (globeOpen) {
    if (window.Cesium) {
      initGlobe();
    } else {
      toast('🌍 Loading globe…');
      ensureCesiumLoaded()
        .then(() => { if (globeOpen) initGlobe(); })
        .catch(() => toast('⚠️ 3D library failed to load'));
    }
  } else {
    if (globeCtrl) { globeCtrl.cleanup(); globeCtrl = null; }
    closeGlobeFilterMenu();
    // Closing (including clicking ✕ Close mid-pick) always cancels any pending "Set Location"
    locateModeFileIds = null;
    locatePending = null;
    document.getElementById('globeConfirmBtn').style.display = 'none';
    hideTripMarkerPopup();
    clearGlobeTripCarousel();
    closeReliveBar();
    if (gsPickMode) {
      gsPickMode = false;
      document.getElementById('gsLocatePanel')?.classList.remove('open');
      // Leaving the picker (whether via "Skip / Finish" or the topbar ✕) always
      // counts as done with this step - there's no separate grid to fall back to.
      if (gsStep === 'location') gsStep = 'done';
    }
    if (gsOpen) { clearSelection(); document.getElementById('guidedSort').classList.add('open'); renderGuidedSortStep(); }
    frResumeWizardIfPending();
  }
}

function initGlobe() {
  if (globeCtrl) globeCtrl.cleanup();
  clearGlobeTripCarousel(); // stale carousel from the previous session, before the new one is built
  updateTerrainToggleBtn();
  const canvas = document.getElementById('globeCanvas');
  const gpsFiles = appData.files.filter(f => isMedia(f.ext) && f.gps && !f.isLivePhotoVideo);
  // Pin colour = the trip/adventure's colour; shape = round for adventures, square for everything else.
  // pinGroupOf keeps each trip/adventure's photos clustering only among themselves.
  const tripColors = new Map(), roundPinIds = new Set(), pinGroupOf = new Map();
  gpsFiles.forEach(f => {
    const t = getTripLikeForFile(f);
    if (!t) return;
    pinGroupOf.set(f.id, t.id);
    tripColors.set(f.id, t.color || (isAdventureFolder(t) ? ADVENTURE_COLOR : '#06b6d4'));
    if (isAdventureFolder(t)) roundPinIds.add(f.id);
  });
  const pickMode = !!locateModeFileIds || gsPickMode;
  locatePending = null;
  document.getElementById('globeConfirmBtn').style.display = 'none';
  document.getElementById('globeNoGps').style.display = (gpsFiles.length===0 && !pickMode) ? '' : 'none';
  if (gsPickMode) {
    document.getElementById('globeTitle').textContent = '📍 Set Location';
    document.getElementById('globeHint').textContent = 'Select photos on the left, then click the globe to drop a pin for them';
  } else if (pickMode) {
    const ids = locateModeFileIds;
    const label = ids.length > 1 ? `${ids.length} files` : (appData.files.find(f=>f.id===ids[0])?.name || '1 file');
    document.getElementById('globeTitle').textContent = `📍 Set Location - ${esc(label)}`;
    document.getElementById('globeHint').textContent = 'Click anywhere on the globe to place the marker, then confirm';
  } else {
    document.getElementById('globeTitle').textContent = '';
    document.getElementById('globeHint').textContent = '';
  }
  const globeOpts = { tripColors, roundPinIds, pinGroupOf, terrainEnabled: !!appData.settings.use3dTerrain };
  const trips = pickMode ? [] : buildTripMarkers();
  globeTrips = trips;
  updateGlobeFilterBtn(pickMode);
  if (!pickMode) {
    globeOpts.trips = trips;
    globeOpts.allowedTripIds = globeAllowedTripIds();
    globeOpts.onTripClick = (trip, x, y) => showTripMarkerPopup(trip, x, y);
    globeOpts.onGlobeCarouselUpdate = onGlobeCarouselUpdate;
    globeOpts.onPinContextMenu = globePinContextMenu;
  }
  if (pickMode) {
    globeOpts.pickMode = true;
    globeOpts.onPick = (lat, lng) => {
      locatePending = { lat, lng };
      if (gsPickMode) { updateGslBar(); return; } // confirm button lives in the left panel instead
      const btn = document.getElementById('globeConfirmBtn');
      btn.style.display = '';
      btn.textContent = `✓ Set Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    };
  }
  // Must run before buildGlobe(): its first rebuildPins() fires onGlobeCarouselUpdate
  // synchronously, which needs gtclMaster already populated.
  initGlobeTripCarousel(trips);
  globeCtrl = buildGlobe(canvas, pickMode ? gpsFiles : globeFilteredFiles(gpsFiles), globeOpts);
  if (gsPickMode) renderGsLocatePanel();
}

// ── Globe filter + hide from map ────────────────────────────────────────────
// "Show" menu in the globe topbar: every photo, or only what's in trips, adventures, or both
// (appData.settings.globeFilter). Photos hidden from the map (file.hideOnMap, via right-click)
// never show, and don't count toward their trip's dot, bounds or Relive route either.
let globeTrips = [];
const GLOBE_FILTERS = {
  all: { label: 'All photos', icon: '🌍' },
  trips: { label: 'Trips only', icon: '✈️' },
  adventures: { label: 'Adventures only', icon: '🧭' },
  both: { label: 'Trips & adventures', icon: '✈️🧭' }
};
function globeFilterMode() { return GLOBE_FILTERS[appData.settings.globeFilter] ? appData.settings.globeFilter : 'all'; }
function globeFilteredFiles(files) {
  const mode = globeFilterMode();
  return files.filter(f => {
    if (f.hideOnMap) return false;
    if (mode === 'all') return true;
    const inTrip = f.folders?.some(id => { const t = tripLikeAncestorOf(id); return t && !isAdventureFolder(t); });
    const inAdv = f.folders?.some(id => isAdventureFolder(tripLikeAncestorOf(id)));
    return mode === 'trips' ? inTrip : mode === 'adventures' ? inAdv : (inTrip || inAdv);
  });
}
function globeAllowedTripIds() {
  const mode = globeFilterMode();
  if (mode === 'all' || mode === 'both') return null;
  return new Set(getTripLikeFolders().filter(t => mode === 'adventures' ? isAdventureFolder(t) : !isAdventureFolder(t)).map(t => t.id));
}
function updateGlobeFilterBtn(pickMode) {
  const btn = document.getElementById('globeFilterBtn');
  if (!btn) return;
  btn.style.display = pickMode ? 'none' : '';
  const f = GLOBE_FILTERS[globeFilterMode()];
  const hidden = appData.files.filter(x => x.hideOnMap && x.gps).length;
  btn.innerHTML = `${f.icon} ${f.label}${hidden ? ` · 🙈 ${hidden}` : ''} ▾`;
  btn.classList.toggle('active', globeFilterMode() !== 'all');
}
function openGlobeFilterMenu(anchor) {
  if (document.getElementById('globeFilterMenu')) { closeGlobeFilterMenu(); return; }
  const mode = globeFilterMode();
  const hidden = appData.files.filter(x => x.hideOnMap && x.gps);
  const menu = document.createElement('div');
  menu.className = 'gs-menu globe-filter-menu';
  menu.id = 'globeFilterMenu';
  menu.innerHTML = `<div class="gs-menu-label">Show on the map</div>
    ${Object.entries(GLOBE_FILTERS).map(([key, f]) => `<button class="gs-menu-item${key === mode ? ' active' : ''}" onclick="setGlobeFilter('${key}')"><span>${f.icon} ${f.label}</span>${key === mode ? '<small>✓</small>' : ''}</button>`).join('')}
    <div class="gs-menu-sep"></div>
    ${hidden.length
      ? `<div class="gs-menu-label">Hidden from the map</div><button class="gs-menu-item" onclick="unhideAllFromMap()"><span>🙈 ${hidden.length} photo${hidden.length !== 1 ? 's' : ''} hidden</span><small>Show all again</small></button>`
      : '<div class="globe-filter-note">Right-click a photo on the map to hide it - handy for a stray photo far from the rest of its trip.</div>'}`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('mousedown', globeFilterMenuOutside), 0);
}
function globeFilterMenuOutside(e) { if (!e.target.closest('#globeFilterMenu, #globeFilterBtn')) closeGlobeFilterMenu(); }
function closeGlobeFilterMenu() {
  document.getElementById('globeFilterMenu')?.remove();
  document.removeEventListener('mousedown', globeFilterMenuOutside);
}
async function setGlobeFilter(mode) {
  closeGlobeFilterMenu();
  appData.settings.globeFilter = mode;
  await saveData();
  refreshGlobeData();
}
// Re-applies filter + hidden photos to the open globe in place (camera stays put), and
// patches the trip objects the markers/carousel hold so bounds and photo lists drop hidden ones.
function refreshGlobeData() {
  updateGlobeFilterBtn(!!locateModeFileIds || gsPickMode);
  if (!globeOpen || !globeCtrl?.setFilter || locateModeFileIds || gsPickMode) return;
  const fresh = new Map(buildTripMarkers().map(m => [m.id, m]));
  globeTrips.forEach(t => {
    const m = fresh.get(t.id);
    if (m) Object.assign(t, m); else Object.assign(t, { fileIds: [], count: 0, sampleFileIds: [] });
  });
  globeCtrl.refreshTrips();
  document.querySelectorAll('.gtcl-card[data-trip-id]').forEach(el => {
    const t = globeTrips.find(x => x.id === el.dataset.tripId);
    const count = el.querySelector('.gtcl-count');
    if (t && count) count.textContent = `${t.count} geotagged file${t.count !== 1 ? 's' : ''}`;
  });
  const all = appData.files.filter(f => isMedia(f.ext) && f.gps && !f.isLivePhotoVideo);
  globeCtrl.setFilter(globeFilteredFiles(all), globeAllowedTripIds());
}
async function unhideAllFromMap() {
  closeGlobeFilterMenu();
  const n = appData.files.filter(f => f.hideOnMap).length;
  appData.files.forEach(f => { delete f.hideOnMap; });
  await saveData();
  refreshGlobeData();
  toast(`👁 ${n} photo${n !== 1 ? 's are' : ' is'} back on the map`);
}
// Right-click on a globe pin: the library's own context menu. A stacked pin selects every
// photo in the stack first, so Hide from Map / Move to Folder / Best Of apply to all of them.
function globePinContextMenu(cluster, x, y) {
  const ids = (cluster.files || [cluster.file]).map(f => f.id);
  clearSelection();
  ids.forEach(id => selectedIds.add(id));
  updateSelectionUI();
  showCtxMenu({ preventDefault() {}, stopPropagation() {}, clientX: x, clientY: y }, ids[0]);
}
async function ctxToggleHideOnMap() {
  hideCtxMenu();
  const ids = selectedIds.size ? [...selectedIds] : [ctxFileId];
  const files = ids.map(id => appData.files.find(f => f.id === id)).filter(f => f?.gps);
  if (!files.length) return;
  const hide = !files.every(f => f.hideOnMap);
  files.forEach(f => { if (hide) f.hideOnMap = true; else delete f.hideOnMap; });
  await saveData();
  refreshGlobeData();
  toast(hide
    ? `🙈 ${files.length === 1 ? files[0].name : files.length + ' photos'} hidden from the map - right-click in the library, or use the map's Show menu, to bring ${files.length === 1 ? 'it' : 'them'} back`
    : `👁 ${files.length === 1 ? files[0].name : files.length + ' photos'} back on the map`, 5000);
}

// Which trip (direct child of the Vacations root) a file is filed under, if any -
// used to color its globe pin so different trips are visually distinguishable.
function getTripLikeForFile(file) {
  if (!file.folders?.length) return null;
  let found = null;
  for (const id of file.folders) {
    const t = tripLikeAncestorOf(id);
    if (!t) continue;
    if (isAdventureFolder(t)) return t;
    found = found || t;
  }
  return found;
}
function getTripColorForFile(file) {
  const t = getTripLikeForFile(file);
  return t ? (t.color || (isAdventureFolder(t) ? ADVENTURE_COLOR : '#06b6d4')) : null;
}

// ── TRIP MARKERS (globe, fully-zoomed-out only) ─────────────────────────────────
// One aggregate marker per trip - independent of the regular per-photo screen-proximity
// clustering, which is untouched - centered on the average GPS position of that trip's
// geotagged photos. globe.js only shows these once the camera is far enough out.
function buildTripMarkers() {
  return getTripLikeFolders().map(trip => {
    const ids = new Set([trip.id, ...getAllDesc(trip.id)]);
    const photos = appData.files.filter(f => isMedia(f.ext) && f.gps && !f.hideOnMap && !f.isLivePhotoVideo && f.folders?.some(id => ids.has(id)));
    if (!photos.length) return null;
    const lats = photos.map(f => f.gps.lat), lngs = photos.map(f => f.gps.lng);
    // Best-of first, then newest - the globe trip carousel's per-card photo cycle.
    const sampleFileIds = photos.slice()
      .sort((a, b) => (b.bestOf ? 1 : 0) - (a.bestOf ? 1 : 0) || (b.fileDate || 0) - (a.fileDate || 0))
      .slice(0, 6).map(f => f.id);
    return {
      id: trip.id, name: trip.name, kind: isAdventureFolder(trip) ? 'adventure' : 'trip',
      color: trip.color || (isAdventureFolder(trip) ? ADVENTURE_COLOR : '#06b6d4'),
      lat: photos.reduce((s, f) => s + f.gps.lat, 0) / photos.length,
      lng: photos.reduce((s, f) => s + f.gps.lng, 0) / photos.length,
      count: photos.length,
      fileIds: photos.map(f => f.id),
      // Padded a bit further by flyToBounds() itself (globe.js) - used by the
      // globe trip carousel to center the camera on a trip when its card is clicked.
      bounds: { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) },
      sampleFileIds
    };
  }).filter(Boolean);
}

let tripPopupTripId = null;
// Cesium's own click handling (mouseup-driven, synchronous) fires before the browser's
// native 'click' event bubbles to document - so the very click that opens this popup via
// globe.js's onTripClick would immediately re-trigger the "click outside closes it" listener
// below and instantly hide it again. This flag survives just that one same-gesture dispatch.
let tripPopupSuppressNextDismiss = false;
function showTripMarkerPopup(trip, x, y) {
  tripPopupTripId = trip.id;
  tripPopupSuppressNextDismiss = true;
  setTimeout(() => { tripPopupSuppressNextDismiss = false; }, 0);
  const reliveBtn = document.querySelector('#tripMarkerPopup .tmp-relive');
  if (reliveBtn) reliveBtn.textContent = trip.kind === 'adventure' ? '🔄 Relive Adventure' : '🔄 Relive Trip';
  document.getElementById('tmpName').textContent = trip.name;
  document.getElementById('tmpCount').textContent = `${trip.count} geotagged file${trip.count !== 1 ? 's' : ''}`;
  const el = document.getElementById('tripMarkerPopup');
  el.classList.add('open');
  // Keep it on-screen - flip left/up if it would overflow the globe view's edge
  const w = 200, h = 110;
  el.style.left = Math.min(x, window.innerWidth - w - 12) + 'px';
  el.style.top = Math.min(y, window.innerHeight - h - 12) + 'px';
}

function hideTripMarkerPopup() {
  document.getElementById('tripMarkerPopup').classList.remove('open');
  tripPopupTripId = null;
}

function reliveTripClick() {
  const tripId = tripPopupTripId;
  if (!tripId) { hideTripMarkerPopup(); return; }
  startRelive(tripId);
}

// ── GLOBE TRIP CAROUSEL - always-on trip browser docked along the globe's
// right edge, so trips stay reachable ("Relive Trip" / open folder) without
// hunting for round markers that can pile into a mess once several trips are
// on screen at once. Exactly 3 cards are ever live: the centered one (full
// opacity, in front) plus its top/bottom neighbors (dimmed - see .gtcl-card
// CSS). Up/down arrows page through the currently-relevant trips; a single
// click on a card centers it and opens Relive Trip; a double click opens its
// folder instead. No auto-advance - a previous version paged itself on a
// timer and it just made the thing feel unpredictable to look at, so now it
// only ever moves on deliberate input.
//
// Only trips with a photo actually on screen right now are offered - globe.js's
// onGlobeCarouselUpdate callback (fired every camera settle) reports that set
// directly, so a trip that's off camera (e.g. Mexico while looking at Europe)
// drops out. The underlying trip list is shuffled once per globe session and
// that random order is preserved as trips enter/exit the filtered view, so
// the carousel doesn't re-shuffle out from under the user while they're
// browsing.
const GTCL_ANIM_MS = 700;
let gtclMaster = [];        // every trip this globe session, shuffled once
let gtclFiltered = [];      // gtclMaster filtered to the currently-visible trips, order preserved
let gtclCenterTripId = null;
let gtclEls = { left: null, center: null, right: null }; // slot -> live card element
let gtclClickTimer = null;  // disambiguates a single click from the first half of a double click

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Called once when the globe opens, BEFORE buildGlobe() - globe.js's first
// rebuildPins() fires onGlobeCarouselUpdate synchronously during that call, so
// gtclMaster has to be ready before then, not after.
function initGlobeTripCarousel(trips) {
  clearGlobeTripCarousel();
  gtclMaster = shuffled(trips);
  const wrap = document.getElementById('globeTripCarousel');
  if (wrap) wrap.classList.toggle('hidden', trips.length === 0);
}

function clearGlobeTripCarousel() {
  if (gtclClickTimer) { clearTimeout(gtclClickTimer); gtclClickTimer = null; }
  Object.values(gtclEls).forEach(el => gtclStopCycle(el));
  const stage = document.getElementById('gtclStage');
  if (stage) stage.querySelectorAll('.gtcl-card').forEach(el => el.remove());
  gtclEls = { left: null, center: null, right: null };
  gtclMaster = [];
  gtclFiltered = [];
  gtclCenterTripId = null;
}

// globe.js's per-rebuild report: which trips have a photo actually on screen
// right now.
function onGlobeCarouselUpdate({ visibleTripIds }) {
  const wrap = document.getElementById('globeTripCarousel');
  if (!wrap || !gtclMaster.length) return;

  gtclFiltered = gtclMaster.filter(t => visibleTripIds.has(t.id));
  wrap.classList.toggle('hidden', gtclFiltered.length === 0);
  gtclRefresh();
}

function gtclComputeTriple() {
  const list = gtclFiltered, n = list.length;
  if (!n) return { left: null, center: null, right: null };
  let idx = list.findIndex(t => t.id === gtclCenterTripId);
  if (idx === -1) { idx = 0; gtclCenterTripId = list[0].id; }
  return {
    left: n > 1 ? list[(idx - 1 + n) % n] : null,
    center: list[idx],
    right: n > 1 ? list[(idx + 1) % n] : null
  };
}

function gtclRefresh() {
  const wrap = document.getElementById('globeTripCarousel');
  if (wrap) wrap.classList.toggle('single', gtclFiltered.length === 1);
  gtclReconcile(gtclComputeTriple());
}

// Recomputes which trip belongs in each of the 3 slots and reconciles the live
// DOM elements against that - reassigning role-right → role-center on the SAME
// element (rather than recreating it) is what makes the position change
// animate via the CSS transition on .gtcl-card instead of just popping. An
// element that no longer belongs in
// any slot (arrow-paged away, or its trip scrolled out of the current
// viewport) is pushed further off (role-hidden-*) and removed once its exit
// transition finishes; a genuinely new neighbor is created already in its
// hidden-* position, then flipped to its visible role a frame later so it
// animates in too, rather than appearing already in place. Handles both a
// plain one-step arrow page AND an arbitrary jump (the visible-trips filter
// changing which trips exist at all) with the same logic. All 3 cards are
// plain siblings in #gtclStage - no separate layers to move between, so a
// role reassignment is nothing more than a className change and the CSS
// transition just runs.
function gtclReconcile(triple) {
  const roles = ['left', 'center', 'right'];
  const currentByTripId = {};
  roles.forEach(r => { const el = gtclEls[r]; if (el) currentByTripId[el.dataset.tripId] = el; });

  const nextEls = { left: null, center: null, right: null };
  roles.forEach(r => { const trip = triple[r]; if (trip && currentByTripId[trip.id]) nextEls[r] = currentByTripId[trip.id]; });

  roles.forEach(r => {
    const el = gtclEls[r];
    if (el && el !== nextEls.left && el !== nextEls.center && el !== nextEls.right) {
      gtclRetire(el, r === 'left' ? 'hidden-left' : 'hidden-right');
    }
  });

  roles.forEach(r => {
    const trip = triple[r];
    if (!trip) return;
    let el = nextEls[r];
    if (!el) {
      el = gtclMakeCard(trip, r === 'left' ? 'hidden-left' : 'hidden-right');
      requestAnimationFrame(() => { el.className = 'gtcl-card role-' + r; });
    } else {
      el.className = 'gtcl-card role-' + r;
    }
    nextEls[r] = el;
  });

  // Only the centered card auto-cycles through its trip's sample photos - the
  // side cards are meant to read as a single still frame (a preview, not a
  // second slideshow competing for attention) until they take over as the
  // centered one, at which point they pick up cycling on their own.
  roles.forEach(r => {
    const el = nextEls[r];
    if (!el) return;
    if (r === 'center') gtclStartCycle(el); else gtclStopCycle(el);
  });

  gtclEls = nextEls;
}

// One card. Shows the first of that trip's sample photos as a still frame -
// gtclStartCycle()/gtclStopCycle() (below) are what turn its own slideshow on
// and off, only ever while it's the centered card. Always created at a
// hidden-* position - gtclReconcile is what promotes it to its real role.
function gtclMakeCard(trip, role) {
  const el = document.createElement('div');
  el.className = 'gtcl-card role-' + role;
  el.dataset.tripId = trip.id;
  el.style.setProperty('--gtcl-color', trip.color || '#06b6d4');
  const sampleFileIds = trip.sampleFileIds || [];
  el._sampleFileIds = sampleFileIds;
  el._gtcIdx = 0;
  el.innerHTML = `
    <div class="gtcl-photo">
      <img class="gtcl-img" alt="${esc(trip.name)}">
      ${sampleFileIds.length > 1 ? `<div class="gtcl-dots">${sampleFileIds.map((_, i) => `<span class="gtcl-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
    </div>
    <div class="gtcl-body">
      <div class="gtcl-name">${esc(trip.name)}</div>
      <div class="gtcl-count">${trip.count} geotagged file${trip.count !== 1 ? 's' : ''}</div>
    </div>`;
  el.addEventListener('click', () => gtclCardClick(trip));
  el.addEventListener('dblclick', () => gtclCardDblClick(trip));
  document.getElementById('gtclStage').appendChild(el);

  if (sampleFileIds.length) gtclShowFrame(el, 0);
  return el;
}

function gtclShowFrame(el, i) {
  const sampleFileIds = el._sampleFileIds;
  const file = sampleFileIds && appData.files.find(f => f.id === sampleFileIds[i]);
  if (!file) return;
  getThumb(file).then(url => { if (url) el.querySelector('.gtcl-img').src = url; });
}

function gtclStartCycle(el) {
  if (!el || el._gtcTimer || (el._sampleFileIds || []).length <= 1) return;
  el._gtcTimer = setInterval(() => {
    const dots = [...el.querySelectorAll('.gtcl-dot')];
    dots[el._gtcIdx]?.classList.remove('active');
    el._gtcIdx = (el._gtcIdx + 1) % el._sampleFileIds.length;
    dots[el._gtcIdx]?.classList.add('active');
    gtclShowFrame(el, el._gtcIdx);
  }, 2200);
}

function gtclStopCycle(el) {
  if (el && el._gtcTimer) { clearInterval(el._gtcTimer); el._gtcTimer = null; }
}

// 260ms is enough to swallow the native click that precedes a dblclick (typical
// OS double-click windows run longer) without making a genuine single click feel
// laggy - the same tradeoff most click/dblclick-disambiguating UI code makes.
function gtclCardClick(trip) {
  if (gtclClickTimer) { clearTimeout(gtclClickTimer); gtclClickTimer = null; return; } // 2nd click of a dblclick - let dblclick own it
  // Used to just center the card and fly the camera over (see the old gtclSelect) - now opens
  // Relive Trip directly, since that's the actual point of a "trip card". Still centers the
  // clicked card in the carousel (it stays visible, docked on the right, while Relive's bar
  // opens along the bottom) but skips the fly-to-bounds hop: startRelive()'s own
  // showReliveDay(0) immediately flies the camera to frame day 1 anyway.
  gtclClickTimer = setTimeout(() => {
    gtclClickTimer = null;
    if (gtclFiltered.some(t => t.id === trip.id)) { gtclCenterTripId = trip.id; gtclRefresh(); }
    startRelive(trip.id);
  }, 260);
}
function gtclCardDblClick(trip) {
  if (gtclClickTimer) { clearTimeout(gtclClickTimer); gtclClickTimer = null; }
  selectFolder(trip.id);
}

function gtclArrowClick(direction) {
  const n = gtclFiltered.length;
  if (n < 2) return;
  const idx = gtclFiltered.findIndex(t => t.id === gtclCenterTripId);
  // Inverted on purpose: the arrow points the direction the "disk" turns, not
  // the direction along the trip list - clicking the right arrow spins the
  // wheel so the card sitting on the LEFT rotates into the center, and vice
  // versa, matching a physical dial rather than the underlying array order.
  gtclCenterTripId = gtclFiltered[(idx - direction + n) % n].id;
  gtclRefresh();
}

function gtclRetire(el, hiddenRole) {
  if (!el) return;
  el.className = 'gtcl-card role-' + hiddenRole;
  gtclStopCycle(el);
  setTimeout(() => el.remove(), GTCL_ANIM_MS + 50);
}

// ── RELIVE TRIP - day-by-day playback on the globe ───────────────────────────
// Splits a trip's geotagged photos into calendar days (see buildTripDays), shows
// them as a scrollable row of cards, and stepping/clicking through a day narrows
// the globe to just that day's photos and flies the camera to frame them
// (globeCtrl.showSubset/flyToBounds - see globe.js) - the Polarsteps-style
// "day 1, day 2… map follows you" experience.
let reliveTripId = null;
let reliveDays = [];
let reliveDayIndex = 0;
let reliveLegs = [];
let reliveRenderToken = 0; // guards against a slow async Mapbox response upgrading a route after the user has moved on to another day

function dateKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A day's label is "first place → last place" if it moved between two named
// places that day, or just its single dominant place if it mostly stayed put.
function buildTripDays(tripId) {
  const ids = new Set([tripId, ...getAllDesc(tripId)]);
  const photos = appData.files
    .filter(f => isMedia(f.ext) && f.gps && !f.hideOnMap && f.fileDate && f.folders?.some(id => ids.has(id)))
    .sort((a, b) => a.fileDate - b.fileDate);
  if (!photos.length) return [];

  const byDay = new Map();
  photos.forEach(f => {
    const key = dateKeyOf(f.fileDate);
    (byDay.get(key) || byDay.set(key, []).get(key)).push(f);
  });

  const placeOf = f => f.city || f.region || f.country || null;
  const minMax = arr => arr.reduce((a, v) => (v < a[0] ? [v, a[1]] : v > a[1] ? [a[0], v] : a), [arr[0], arr[0]]);

  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, dayPhotos], i) => {
    const placeCounts = new Map();
    dayPhotos.forEach(f => { const p = placeOf(f); if (p) placeCounts.set(p, (placeCounts.get(p) || 0) + 1); });
    const topPlace = [...placeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const firstPlace = placeOf(dayPhotos[0]), lastPlace = placeOf(dayPhotos[dayPhotos.length - 1]);
    const label = (firstPlace && lastPlace && firstPlace !== lastPlace)
      ? `${firstPlace} → ${lastPlace}` : (topPlace || 'Unknown location');

    const [minLat, maxLat] = minMax(dayPhotos.map(f => f.gps.lat));
    const [minLng, maxLng] = minMax(dayPhotos.map(f => f.gps.lng));
    const cover = dayPhotos.find(f => f.bestOf) || dayPhotos[Math.floor(dayPhotos.length / 2)];

    return {
      dayIndex: i + 1, dateKey: key, date: new Date(dayPhotos[0].fileDate),
      label, photos: dayPhotos, count: dayPhotos.length, coverFileId: cover.id,
      bounds: { minLat, maxLat, minLng, maxLng }
    };
  });
}

// ── TRIP LEGS & ROAD-SNAPPED ROUTES (Relive Trip only - never on the free-roam globe) ──
// A "leg" is a run of a trip's geotagged photos with no gap wider than LEG_GAP_MINUTES
// between consecutive shots - finer-grained than a day (a single day can have several
// legs: drive somewhere, walk around, drive on). Each leg gets a transport mode:
//   - flight: high-confidence auto-detect - nothing else implies 110+ km/h over real
//     distance between two consecutive points (phones don't get GPS lock mid-flight
//     anyway, so what the data actually shows is a clean teleport).
//   - walk: high-confidence auto-detect - sustained under ~7 km/h.
//   - drive: the default bucket for everything else. This deliberately also catches
//     ferries/trains/buses, because a ferry and a coastal road cruise in the same
//     20-45 km/h range and telling them apart needs real coastline data we don't have
//     and aren't bundling. See learnedCrossings below for how those get corrected.
// Route geometry per mode is resolved separately (resolveLegRoute) - drive tries a
// cached-or-fresh Mapbox Map Matching call (usage-governed, see canUseMapbox), walk
// prefers an imported GPX track if one exists, flight is a pure-geometry arc (globe.js),
// and everything else falls back to the same simplified point-thinned line.
const LEG_GAP_MINUTES = 75;
const LEG_FLIGHT_MIN_KMH = 110;
const LEG_FLIGHT_MIN_KM = 80;
const LEG_WALK_MAX_KMH = 7;
const LEG_MIN_STEP_KM = 1.5;      // simplified-fallback point thinning (same idea as the earlier removed buildTripRoutes)
const LEG_MIN_STEP_MS = 15 * 60 * 1000;
const MODE_LABELS = { drive: '🚗 Drive', walk: '🥾 Walk', ferry: '⛴️ Ferry', train: '🚆 Train', flight: '✈️ Flight' };
const MODE_EMOJI = { drive: '🚗', walk: '🥾', ferry: '⛴️', train: '🚆', flight: '✈️' };

function legsForDay(day) {
  return reliveLegs.filter(leg => dateKeyOf(leg.startTime) === day.dateKey || dateKeyOf(leg.endTime) === day.dateKey);
}

function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Learned crossings are keyed on the (sorted, so direction doesn't matter) region-or-
// country pair at each end, plus only reapplied when the new leg's speed is in the same
// ballpark - so correcting one ferry doesn't accidentally also relabel an unrelated fast
// drive between the same two regions.
function crossingKeyOf(startPlace, endPlace) {
  const a = (startPlace || '').toLowerCase(), b = (endPlace || '').toLowerCase();
  if (!a || !b || a === b) return null;
  return [a, b].sort().join('|');
}
function findLearnedCrossing(startPlace, endPlace, impliedKmh) {
  const key = crossingKeyOf(startPlace, endPlace);
  if (!key) return null;
  const match = appData.learnedCrossings.find(c => c.key === key && Math.abs(c.speedKmh - impliedKmh) < Math.max(c.speedKmh * 0.6, 12));
  return match ? match.mode : null;
}
function learnCrossing(leg, mode) {
  const key = crossingKeyOf(leg.startRegion, leg.endRegion);
  if (!key) return;
  appData.learnedCrossings = appData.learnedCrossings.filter(c => c.key !== key);
  appData.learnedCrossings.push({ key, mode, speedKmh: leg.impliedKmh, updatedAt: Date.now() });
  saveData();
}

// A long elapsed time (the classic case: overnight - asleep at a hotel, then off
// again in the morning) averages out to a "slow" speed no matter the real distance
// covered, because the math can't tell rested-then-traveled apart from continuously
// moving. Left unchecked that misreads as a hike - confirmed on real data: a 26km
// overnight gap came out "walk" before this cap existed. So walk additionally
// requires the leg to be a plausible hiking distance, not just a low average speed.
const LEG_WALK_MAX_KM = 15;

function classifyLegMode(leg) {
  const learned = findLearnedCrossing(leg.startRegion, leg.endRegion, leg.impliedKmh);
  if (learned) return learned;
  if (leg.impliedKmh >= LEG_FLIGHT_MIN_KMH && leg.distKm >= LEG_FLIGHT_MIN_KM) return 'flight';
  if (leg.impliedKmh <= LEG_WALK_MAX_KMH && leg.distKm <= LEG_WALK_MAX_KM) return 'walk';
  return 'drive';
}

// Every leg's endpoint must be the next leg's start - a hike that starts where the
// preceding drive ended, not floating disconnected from it. Two things used to
// break that: (1) a lone photo separated by >LEG_GAP_MINUTES on both sides never
// reached the 2-point minimum to become a leg at all, so it rendered as a bare pin
// with no line touching it; (2) even between two real legs, nothing ever bridged
// the gap between leg N's last point and leg N+1's first point - e.g. the walk from
// the car park to the trailhead, never photographed, just silently missing. Fixed
// by keeping every time-gap cluster (including singletons) and inserting a
// connector leg between every adjacent pair - classified and routed exactly like
// any other leg (so a car-to-trailhead connector correctly road-snaps, matching
// "if the point isn't on a road, take the nearest road to it").
function buildTripLegs(tripId) {
  const ids = new Set([tripId, ...getAllDesc(tripId)]);
  const photos = appData.files
    .filter(f => isMedia(f.ext) && f.gps && !f.hideOnMap && f.fileDate && f.folders?.some(id => ids.has(id)))
    .sort((a, b) => a.fileDate - b.fileDate);
  if (photos.length < 2) return [];

  const clusters = [];
  let cur = [photos[0]];
  for (let i = 1; i < photos.length; i++) {
    const gapMin = (photos[i].fileDate - photos[i - 1].fileDate) / 60000;
    if (gapMin > LEG_GAP_MINUTES) { clusters.push(cur); cur = [photos[i]]; }
    else cur.push(photos[i]);
  }
  clusters.push(cur);

  const legs = [];
  const makeLeg = legPhotos => {
    const start = legPhotos[0], end = legPhotos[legPhotos.length - 1];
    const distKm = haversineKm({ lat: start.gps.lat, lng: start.gps.lng }, { lat: end.gps.lat, lng: end.gps.lng });
    const hours = Math.max((end.fileDate - start.fileDate) / 3600000, 1 / 60);
    const leg = {
      id: `${tripId}-leg${legs.length}-${start.id}-${end.id}`,
      points: legPhotos.map(f => ({ lat: f.gps.lat, lng: f.gps.lng, t: f.fileDate })),
      startTime: start.fileDate, endTime: end.fileDate,
      startRegion: start.region || start.country || null, endRegion: end.region || end.country || null,
      startPlace: start.city || start.region || start.country || null,
      endPlace: end.city || end.region || end.country || null,
      distKm, impliedKmh: distKm / hours
    };
    leg.mode = classifyLegMode(leg);
    legs.push(leg);
  };

  let prevClusterLast = null;
  clusters.forEach(clusterPhotos => {
    if (prevClusterLast) makeLeg([prevClusterLast, clusterPhotos[0]]); // bridge the gap
    if (clusterPhotos.length > 1) makeLeg(clusterPhotos);              // the cluster itself
    prevClusterLast = clusterPhotos[clusterPhotos.length - 1];
  });

  return legs;
}

function relabelLeg(leg, newMode) {
  leg.mode = newMode;
  learnCrossing(leg, newMode);
  hideLegModePopup();
  toast(`${MODE_LABELS[newMode]} - remembered for similar crossings too`);
  renderReliveDayCards();
  refreshReliveView(); // re-render whatever's currently showing (a day, or the overview) with the new mode
}

let legModePopupLeg = null;
function showLegModePopup(e, leg) {
  e.stopPropagation();
  legModePopupLeg = leg;
  const el = document.getElementById('legModePopup');
  el.innerHTML = Object.keys(MODE_LABELS).map(m =>
    `<div class="ctx-item" onclick="relabelLeg(legModePopupLeg,'${m}')">${MODE_LABELS[m]}</div>`
  ).join('') + (leg.mode === 'walk'
    ? `<div class="ctx-sep"></div><div class="ctx-item" onclick="importGpxForLeg(legModePopupLeg)"><span class="ctx-icon">📥</span> Import GPX Track…</div>`
    : '');
  const r = e.target.getBoundingClientRect();
  el.style.left = Math.min(r.left, window.innerWidth - 200) + 'px';
  el.style.top = (r.top - 8) + 'px';
  el.classList.add('open');
}
function hideLegModePopup() {
  document.getElementById('legModePopup')?.classList.remove('open');
  legModePopupLeg = null;
}

// ── GPX IMPORT (hike/walk legs) ───────────────────────────────────────────────
// Generic - works with any GPX export (Strava, AllTrails, Komoot, Gaia GPS…), not
// tied to one service. The imported track's own points take priority over both the
// Mapbox-matched and simplified-fallback geometry for that specific leg.
async function importGpxForLeg(leg) {
  hideLegModePopup();
  const fp = await window.api.openGpxDialog().catch(() => null);
  if (!fp) return;
  const text = await window.api.readTextFile(fp, 10 * 1024 * 1024).catch(() => null);
  if (!text) { toast('⚠️ Could not read that file'); return; }

  let points;
  try {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('bad xml');
    points = [...xml.getElementsByTagName('trkpt')].map(pt => ({
      lat: parseFloat(pt.getAttribute('lat')),
      lng: parseFloat(pt.getAttribute('lon'))
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } catch (e) { points = null; }

  if (!points || points.length < 2) { toast('⚠️ No track points found in that GPX file'); return; }

  if (!appData.legGpxTracks) appData.legGpxTracks = {};
  appData.legGpxTracks[legGpxKey(leg)] = { points, importedAt: Date.now(), sourceFile: fp };
  persistQuiet(); // not saveData() - that re-render tears down the Relive thumbs' observer
  toast(`🥾 Imported ${points.length} track points for this hike`);
  refreshReliveView();
}

// A leg's own points, thinned - the fallback used whenever nothing better (a road
// match, a GPX import) is available, and the only geometry flight legs' straight
// endpoints need (globe.js turns those into an arc itself).
function simplifiedLegPoints(leg) {
  const points = [];
  let last = null;
  for (const p of leg.points) {
    if (last && haversineKm(last, p) < LEG_MIN_STEP_KM && (p.t - last.t) < LEG_MIN_STEP_MS) continue;
    points.push(p);
    last = p;
  }
  if (points.length < 2) return [leg.points[0], leg.points[leg.points.length - 1]];
  return points;
}

// Evenly samples down to AT MOST max points, first and last always kept. The
// hard cap matters: Directions rejects the whole request past 25 coordinates
// ("Too many coordinates"), so "max plus maybe one more for the endpoint" -
// the previous version's behavior - meant every long leg 400'd.
function thinToMax(points, max) {
  if (points.length <= max) return points;
  const stride = (points.length - 1) / (max - 1);
  const out = [];
  let prevIdx = -1;
  for (let i = 0; i < max; i++) {
    const idx = Math.min(points.length - 1, Math.round(i * stride));
    if (idx !== prevIdx) { out.push(points[idx]); prevIdx = idx; }
  }
  return out;
}

// ── MAPBOX USAGE GOVERNOR ────────────────────────────────────────────────────
// Mapbox itself has no spending cap (verified against their docs) - this is the
// app's own conservative ceiling, checked before every call, resetting monthly.
function canUseMapbox() {
  if (!MAPBOX_ENABLED) return false;
  const s = appData.settings;
  if (!s || !s.useMapboxRouting || !s.mapboxToken) return false;
  const monthKey = new Date().toISOString().slice(0, 7);
  if (s.mapboxCallsMonthKey !== monthKey) { s.mapboxCallsMonthKey = monthKey; s.mapboxCallsThisMonth = 0; }
  return s.mapboxCallsThisMonth < s.mapboxMonthlyCap;
}
// Persists to disk WITHOUT re-rendering the UI. saveData()'s renderAfterChange() rebuilds
// the thumbnail IntersectionObserver as part of renderFiles(), which silently unobserves
// the Relive day cards' thumbs mid-load. Background bookkeeping (usage counter ticks,
// route-cache writes) must therefore never trigger a re-render; this was exactly the
// "thumbnails stop loading when Mapbox is on" bug. Just calls the same persistToDisk()
// saveData() uses, minus the renderAfterChange() call.
function persistQuiet() {
  persistToDisk();
}

function recordMapboxCall() {
  appData.settings.mapboxCallsThisMonth++;
  persistQuiet();
  updateSettingsUsageDisplay();
}

function legRouteCacheKey(leg) {
  return 'v2:' + leg.points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
}

// Mapbox has no ferry/train profile, so both reuse driving (a real road route is
// still a far better approximation than a straight line for either). Flight is
// intentionally absent - it's pure arc geometry (globe.js), never an API call.
const MODE_ROUTING_PROFILE = { drive: 'driving', walk: 'walking', ferry: 'driving', train: 'driving' };

// Computes the real path a leg most likely followed via the Mapbox Directions API -
// photo A and photo B (plus any photos between) become waypoints, and Mapbox returns
// the real route through them: driving profile snaps a drive to actual roads (e.g.
// Paris → Troyes resolves to the real A5), walking profile snaps a hike onto real
// trails where OSM has them - and, critically, this is what makes the short
// car-to-trailhead (or trailhead-to-car) connector legs actually hug a real road/path
// instead of cutting a straight line across open country. (The Map Matching API was
// tried first and is the wrong tool here: it's built for dense GPS traces sampled
// seconds apart and returns nothing/garbage for photo points that are minutes and
// kilometres apart - that was the original "routes stay straight lines" bug.)
// Cached forever per exact point sequence + profile (appData.routeCache, same idea
// as the geocode cache) so an unchanged leg never calls the API twice. Returns null
// on any failure/no-budget/flight - callers are already showing the simplified
// fallback and treat this as a best-effort upgrade, never something Relive Trip
// blocks on.
async function resolveLegRoute(leg) {
  const profile = MODE_ROUTING_PROFILE[leg.mode];
  if (!profile) return null;
  const key = legRouteCacheKey(leg) + ':' + profile;
  if (appData.routeCache[key]) return appData.routeCache[key];
  if (!canUseMapbox()) return null;

  // Directions accepts at most 25 waypoints; thin evenly, endpoints always kept
  const pts = thinToMax(simplifiedLegPoints(leg), 25);
  const coordStr = pts.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}` +
    `?geometries=geojson&overview=full&access_token=${appData.settings.mapboxToken}`;

  recordMapboxCall();
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) return null;
    // Full geometry for a long leg can be 4000+ points - visually identical at 500,
    // and the cache lives inside the JSON library file, so store the thinned version.
    const raw = json.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat: +lat.toFixed(5), lng: +lng.toFixed(5) }));
    if (raw.length < 2) return null;
    const result = { points: thinToMax(raw, 500) };
    appData.routeCache[key] = result;
    persistQuiet();
    return result;
  } catch (e) { return null; }
}

function legGpxKey(leg) { return leg.id; }

// ── SETTINGS (delete permission, telemetry toggle, Mapbox token, usage governor, routing) ──
// The Mapbox fields below are null-guarded (document.getElementById(...) returns null) because
// that whole block is commented out in index.html's Settings modal - not deleted, just hidden
// from users for now (see MAPBOX_ENABLED). Re-enabling there needs no change here.
function openSettingsModal() {
  renderHiddenSectionsSettings();
  const langSel = document.getElementById('setLanguage');
  if (langSel) langSel.value = currentLang;
  document.getElementById('setAllowDelete').checked = appData.settings.allowDeleteFiles !== false;
  document.getElementById('setTelemetry').checked = appData.settings.telemetryEnabled === true;
  document.getElementById('setFaceRecognition').checked = !!appData.settings.faceRecognition;
  const mbToken = document.getElementById('setMapboxToken');
  if (mbToken) mbToken.value = appData.settings.mapboxToken || '';
  const mbUse = document.getElementById('setUseMapbox');
  if (mbUse) mbUse.checked = !!appData.settings.useMapboxRouting;
  const mbCap = document.getElementById('setMapboxCap');
  if (mbCap) mbCap.value = appData.settings.mapboxMonthlyCap;
  updateSettingsUsageDisplay();
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettingsModal() { document.getElementById('settingsModal').classList.remove('open'); }

function saveSettings() {
  const langSel = document.getElementById('setLanguage');
  if (langSel && langSel.value !== currentLang) setLanguage(langSel.value);
  appData.settings.allowDeleteFiles = document.getElementById('setAllowDelete').checked;
  appData.settings.telemetryEnabled = document.getElementById('setTelemetry').checked;
  appData.settings.telemetryAsked = true; // the Settings hint right under the toggle explains it in full
  // Switching face recognition either way does real work (a scan, or deleting its data), so
  // it goes through its own function - which asks before deleting anything.
  const faceOn = document.getElementById('setFaceRecognition').checked;
  if (faceOn !== !!appData.settings.faceRecognition) setFaceRecognition(faceOn);
  const mbToken = document.getElementById('setMapboxToken');
  if (mbToken) appData.settings.mapboxToken = mbToken.value.trim();
  const mbUse = document.getElementById('setUseMapbox');
  if (mbUse) appData.settings.useMapboxRouting = mbUse.checked;
  const mbCap = document.getElementById('setMapboxCap');
  if (mbCap) {
    const cap = parseInt(mbCap.value, 10);
    appData.settings.mapboxMonthlyCap = (Number.isFinite(cap) && cap > 0) ? cap : 8000;
  }
  saveData();
  closeSettingsModal();
  toast(t('settingsSavedToast'));
}

function updateSettingsUsageDisplay() {
  const el = document.getElementById('setMapboxUsage');
  if (!el) return;
  const s = appData.settings;
  const monthKey = new Date().toISOString().slice(0, 7);
  const used = s.mapboxCallsMonthKey === monthKey ? s.mapboxCallsThisMonth : 0;
  el.textContent = `${used} / ${s.mapboxMonthlyCap} Mapbox requests used this month`;
}

function openMapboxSignup() { window.api.openExternal('https://www.mapbox.com/'); }

// ── TELEMETRY (anonymous, opt-in, no accounts) ──────────────────────────────
// Fires a tiny ping so usage patterns (session length, roughly how big libraries get, which
// organizing features get used) can guide what to build next - never file names, paths, photo
// content, or anything identifying. installId is a random id main.js generates once per
// install (see DEFAULT_DATA in main.js), not tied to a person. Toggle lives in Settings
// ("Help improve Trove") and defaults off; this function is the one place that checks it, so
// flipping it off there is a hard stop, not just a UI label. Nothing is sent unless the user
// said yes to showTelemetryNotice() below (or turned it on in Settings). PRIVACY_URL is the
// public policy.
const PRIVACY_URL = 'https://github.com/Gilouloum/Trove/blob/main/PRIVACY.md';
function openPrivacyPolicy() { window.api.openExternal(PRIVACY_URL); }
function sendTelemetryPing(event) {
  if (appData.settings?.telemetryEnabled !== true) return;
  if (!appData.settings?.telemetryAsked) return;
  if (!window.api?.sendTelemetry) return;
  window.api.sendTelemetry({
    event,
    installId: appData.installId || null,
    sessionDurationMs: event === 'session_end' ? (Date.now() - sessionStartMs) : 0,
    fileCount: appData.files.length,
    folderCount: appData.folders.length,
    bestOfCount: appData.files.filter(f => f.bestOf).length,
    pinnedCount: appData.files.filter(f => f.pinned).length
    // appVersion/platform aren't collected here - main.js stamps those itself (it already
    // knows app.getVersion()/process.platform) when it receives this ping.
  });
}

// One-time yes/no question about the ping, shown to new installs and upgraders alike. Stays up
// until answered (no timeout), and nothing is sent before then: "Yes" starts the pings with
// this session's app_open, "No thanks" leaves them off, exactly like the Settings toggle.
function showTelemetryNotice() {
  const c = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item toast-undo';
  el.style.cssText = 'max-width:440px;flex-wrap:wrap';
  const span = document.createElement('span');
  span.style.flexBasis = '100%';
  span.textContent = t('telemetryNotice');
  const answer = (enabled) => {
    appData.settings.telemetryAsked = true;
    appData.settings.telemetryEnabled = enabled;
    saveData();
    el.remove();
    sendTelemetryPing('app_open');
  };
  const ok = document.createElement('button');
  ok.className = 'toast-undo-btn';
  ok.textContent = t('telemetryNoticeOk');
  ok.onclick = () => answer(true);
  const off = document.createElement('button');
  off.className = 'toast-undo-btn';
  off.style.cssText = 'background:transparent;color:var(--text3)';
  off.textContent = t('telemetryNoticeOff');
  off.onclick = () => answer(false);
  const policy = document.createElement('button');
  policy.className = 'toast-undo-btn';
  policy.style.cssText = 'background:transparent;color:var(--accent2)';
  policy.textContent = t('privacyPolicy');
  policy.onclick = openPrivacyPolicy;
  el.append(span, ok, off, policy);
  c.appendChild(el);
}

// ── THEME (Light / Dark / Auto) ─────────────────────────────────────────────
// 'system' leaves data-theme unset, so the CSS @media(prefers-color-scheme) block in
// index.html follows the OS setting live. An explicit 'light'/'dark' choice stamps
// data-theme on <html>, which wins over the OS setting in both directions - see the
// matching CSS structure at the top of index.html's <style>.
function applyTheme() {
  const mode = appData.settings.themeMode || 'system';
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = mode === 'dark' ? t('themeDark') : mode === 'light' ? t('themeLight') : t('themeAuto');
  // Keeps the native Window Controls Overlay buttons (Windows only - see main.js) matching the
  // theme instead of freezing at whatever was active on launch. isDark mirrors the same logic
  // index.html's CSS uses: an explicit choice wins outright, 'system' follows the OS live.
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  window.api.setTitleBarOverlay?.(isDark);
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(appData.settings.themeMode || 'system') + 1) % order.length];
  appData.settings.themeMode = next;
  applyTheme();
  saveData();
}

// ── DISPLAY ZOOM (Ctrl+scroll to resize, Spotify-style) ─────────────────────
// Two independent live-resizable regions, each just a CSS custom property nudged per wheel
// tick: the library grid's card size (--card-min, consumed by both .files-grid - individual
// folder views like Trips/People - and .tl-grid - the default "Photo Library" timeline view,
// see renderTimeline() - so this resizes whichever one is actually on screen) and the sidebar's
// width (--sw, already the var #sidebar's width/min-width were built on - see index.html). Both
// persist to appData.settings so "favourite display" survives a restart - applyDisplaySizes()
// re-applies them once at startup, right after applyTheme().
const GRID_CARD_MIN_RANGE = [90, 420];
const SIDEBAR_WIDTH_RANGE = [160, 460];
// Photo pickers (Link to original, PhotoMod's Open / Add photo & place, folder cover): their own
// card size (--picker-card-min), so enlarging thumbnails to compare before picking one doesn't
// resize the library grid too.
const PICKER_CARD_MIN_RANGE = [90, 420];
const PICKER_ZOOM_HOSTS = ['versionPickMode', 'photoModPick', 'coverPicker'];

function applyDisplaySizes() {
  const fileArea = document.getElementById('fileArea');
  if (fileArea) fileArea.style.setProperty('--card-min', (appData.settings.gridCardMin || 155) + 'px');
  document.documentElement.style.setProperty('--sw', (appData.settings.sidebarWidth || 234) + 'px');
  document.documentElement.style.setProperty('--picker-card-min', (appData.settings.pickerCardMin || 160) + 'px');
}

function clamp(v, [lo, hi]) { return Math.max(lo, Math.min(hi, v)); }

// Scales with how hard the wheel/trackpad actually moved instead of a flat per-event bump, so
// a deliberate fast scroll changes size a lot in one go and a slow nudge stays fine-grained -
// clamped on both ends so a tiny trackpad tick isn't imperceptible and a huge deltaY (some
// high-res mice/trackpads report much larger values than a standard wheel) can't jump wildly.
function wheelZoomStep(e) { return clamp(Math.round(Math.abs(e.deltaY) * 0.3), [16, 60]); }

function setupDisplayZoom() {
  const fileArea = document.getElementById('fileArea');
  // Hover effects are off while the grid scrolls (index.html, #fileArea.is-scrolling). The cursor
  // stays put while tiles slide under it, so every tile it crossed zoomed in and back out on the
  // way past - a fast scroll made them look loose from the page. Back on once scrolling settles.
  let scrollIdle = null;
  fileArea?.addEventListener('scroll', () => {
    fileArea.classList.add('is-scrolling');
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(() => fileArea.classList.remove('is-scrolling'), 150);
  }, { passive: true });
  fileArea?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || currentView === 'list') return; // list view has no card grid to resize
    e.preventDefault();
    const step = wheelZoomStep(e);
    const next = clamp((appData.settings.gridCardMin || 155) + (e.deltaY < 0 ? step : -step), GRID_CARD_MIN_RANGE);
    appData.settings.gridCardMin = next;
    fileArea.style.setProperty('--card-min', next + 'px');
    persistQuiet();
  }, { passive: false });

  const sidebar = document.getElementById('sidebar');
  sidebar?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const step = wheelZoomStep(e);
    const next = clamp((appData.settings.sidebarWidth || 234) + (e.deltaY < 0 ? step : -step), SIDEBAR_WIDTH_RANGE);
    appData.settings.sidebarWidth = next;
    document.documentElement.style.setProperty('--sw', next + 'px');
    persistQuiet();
  }, { passive: false });

  PICKER_ZOOM_HOSTS.forEach(id => document.getElementById(id)?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const step = wheelZoomStep(e);
    const next = clamp((appData.settings.pickerCardMin || 160) + (e.deltaY < 0 ? step : -step), PICKER_CARD_MIN_RANGE);
    appData.settings.pickerCardMin = next;
    document.documentElement.style.setProperty('--picker-card-min', next + 'px');
    persistQuiet();
  }, { passive: false }));
}

// Quick on/off right on the globe - real elevation data costs real GPU/network
// (extra terrain tile fetches + a much heavier mesh than the flat ellipsoid), so
// this defaults off and stays a deliberate opt-in rather than something that can
// quietly make the globe feel laggy on a slower machine. Persisted like any other
// setting, but with its own topbar shortcut since it's the kind of thing you want
// to flip mid-session the moment things feel sluggish, not go find in a menu for.
function toggle3dTerrain() {
  appData.settings.use3dTerrain = !appData.settings.use3dTerrain;
  saveData();
  updateTerrainToggleBtn();
  globeCtrl?.setTerrainEnabled(appData.settings.use3dTerrain);
  toast(appData.settings.use3dTerrain ? '🏔️ 3D Terrain: On' : '🏔️ 3D Terrain: Off - back to the flat globe');
}
function updateTerrainToggleBtn() {
  const btn = document.getElementById('terrainToggleBtn');
  if (!btn) return;
  const on = !!appData.settings?.use3dTerrain;
  btn.textContent = on ? '🏔️ 3D Terrain: On' : '🏔️ 3D Terrain: Off';
  btn.classList.toggle('active', on);
}

// Shown at most once per app session - resolveLegRoute() already falls back to a
// straight-line leg with zero user-facing error when there's no token, so without this
// a user would never learn that setting a free Mapbox token gets them real road-snapped
// routes instead. Skipped entirely if they've deliberately turned routing off.
let mapboxHintShownThisSession = false;
function startRelive(tripId) {
  hideTripMarkerPopup();
  document.getElementById('gsLocatePanel')?.classList.remove('open');
  const days = buildTripDays(tripId);
  if (!days.length) { toast(`📍 No geotagged photos in this ${isAdventureFolder(appData.folders.find(f => f.id === tripId)) ? 'adventure' : 'trip'} yet`); return; }
  reliveTripId = tripId;
  reliveDays = days;
  reliveLegs = buildTripLegs(tripId);
  const s = appData.settings;
  const hasRoutableLeg = reliveLegs.some(leg => MODE_ROUTING_PROFILE[leg.mode]);
  if (MAPBOX_ENABLED && !mapboxHintShownThisSession && hasRoutableLeg && s?.useMapboxRouting && !s.mapboxToken) {
    mapboxHintShownThisSession = true;
    toast('🛣️ Add a free Mapbox token in Settings to snap these routes to real roads');
  }
  const trip = appData.folders.find(f => f.id === tripId);
  document.getElementById('reliveTitle').textContent = trip?.name || 'Trip';
  renderReliveDayCards();
  document.getElementById('reliveBar').classList.add('open');
  document.getElementById('reliveDayPhotoPanel').classList.add('open');
  ensureReliveBarResizeSync();
  showReliveOverview();
}

// #reliveBar floats absolutely over the bottom of the split view (day cards + leg
// chips), and its height isn't fixed - it grows when a busy day's leg chips wrap to
// a second line. Without this, the day photo panel's grid extends underneath it and
// its bottom row or two gets covered. Keeps the panel's bottom padding in sync with
// the bar's live rendered height, for as long as the app is open - cheap, and a
// hidden 0-height bar just yields 0 padding, so it's harmless before Relive's first use.
let reliveBarResizeObserver = null;
function ensureReliveBarResizeSync() {
  if (reliveBarResizeObserver) return;
  const bar = document.getElementById('reliveBar');
  const panel = document.getElementById('reliveDayPhotoPanel');
  if (!bar || !panel) return;
  reliveBarResizeObserver = new ResizeObserver(() => {
    panel.style.paddingBottom = bar.getBoundingClientRect().height + 'px';
  });
  reliveBarResizeObserver.observe(bar);
}

// Left-half panel: a day's (or the whole trip's) photos in chronological order.
// Map keeps the right half (globeSplitArea in index.html handles the actual 50/50
// split).
function renderReliveDayPhotoPanel(day) {
  renderRelivePhotoPanel(
    `Day ${day.dayIndex}: ${esc(day.label)}`,
    `${day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${day.count} photo${day.count !== 1 ? 's' : ''}`,
    day.photos
  );
}

function renderReliveOverviewPhotoPanel(photos) {
  renderRelivePhotoPanel(
    'Entire Trip',
    `${reliveDays.length} day${reliveDays.length !== 1 ? 's' : ''} · ${photos.length} photo${photos.length !== 1 ? 's' : ''}`,
    photos
  );
}

function renderRelivePhotoPanel(title, subtitle, photos) {
  const panel = document.getElementById('reliveDayPhotoPanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="rdp-head">
      <div class="rdp-title">${title}</div>
      <div class="rdp-sub">${subtitle}</div>
    </div>
    <div class="rdp-grid" id="rdpGrid"></div>`;
  const grid = document.getElementById('rdpGrid');
  photos.forEach(f => {
    const item = document.createElement('div');
    item.className = 'rdp-item';
    item.onclick = () => openFileById(f.id);
    // Hover shows exactly where this photo was taken and nudges the camera toward
    // it (or fully recenters if it's off-screen) - see hoverHighlight in globe.js.
    item.onmouseenter = () => globeCtrl?.hoverHighlight(f.gps.lat, f.gps.lng);
    item.onmouseleave = () => globeCtrl?.hideHighlight();
    const time = new Date(f.fileDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    item.innerHTML = `
      <div class="rdp-thumb thumb-loading" data-thumb-for="${f.id}">${getEmoji(f.ext)}</div>
      ${isVid(f.ext) ? '<span class="rdp-item-video">▶️</span>' : ''}
      <span class="rdp-item-time">${time}</span>`;
    grid.appendChild(item);
    observeThumb(item.querySelector('.rdp-thumb'));
  });
}

function renderReliveDayCards() {
  const host = document.getElementById('reliveDayCards');
  host.innerHTML = '';

  const overviewCard = document.createElement('div');
  overviewCard.className = 'relive-day-card';
  overviewCard.dataset.dayIndex = -1;
  overviewCard.onclick = () => showReliveOverview();
  const totalPhotos = reliveDays.reduce((n, d) => n + d.count, 0);
  overviewCard.innerHTML = `
    <div class="relive-day-thumb">🧭</div>
    <div class="relive-day-body">
      <div class="relive-day-num">Entire Trip</div>
      <div class="relive-day-place">${reliveDays.length} day${reliveDays.length !== 1 ? 's' : ''}</div>
      <div class="relive-day-meta">${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}</div>
    </div>`;
  host.appendChild(overviewCard);

  reliveDays.forEach((day, i) => {
    const cover = appData.files.find(f => f.id === day.coverFileId);
    const modeBadges = LEG_ROUTES_ENABLED
      ? [...new Set(legsForDay(day).map(l => l.mode))].map(m => `<span class="relive-mode-badge" title="${MODE_LABELS[m]}">${MODE_EMOJI[m]}</span>`).join('')
      : '';
    const card = document.createElement('div');
    card.className = 'relive-day-card';
    card.dataset.dayIndex = i;
    card.onclick = () => showReliveDay(i);
    card.innerHTML = `
      <div class="relive-day-thumb thumb-loading" data-thumb-for="${day.coverFileId}">${cover && isVid(cover.ext) ? '🎬' : '🖼️'}</div>
      <div class="relive-day-body">
        <div class="relive-day-num">Day ${day.dayIndex} ${modeBadges}</div>
        <div class="relive-day-place">${esc(day.label)}</div>
        <div class="relive-day-meta">${day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${day.count} photo${day.count !== 1 ? 's' : ''}</div>
      </div>`;
    host.appendChild(card);
    observeThumb(card.querySelector('.relive-day-thumb'));
  });
}

function showReliveDay(index) {
  if (!reliveDays.length) return;
  reliveDayIndex = Math.max(0, Math.min(index, reliveDays.length - 1));
  const day = reliveDays[reliveDayIndex];

  highlightActiveReliveCard();

  document.getElementById('reliveCount').textContent = `Day ${day.dayIndex} of ${reliveDays.length}`;
  // Prev always has somewhere to go now: a previous day, or the Entire Trip
  // overview at day 0. See relivePrev().
  document.getElementById('relivePrevBtn').disabled = false;
  document.getElementById('reliveNextBtn').disabled = reliveDayIndex === reliveDays.length - 1;

  if (globeCtrl) {
    globeCtrl.showSubset(day.photos);
    globeCtrl.flyToBounds(day.bounds);
  }
  renderDayLegChips(legsForDay(day));
  renderDayLegRoutes(legsForDay(day));
  renderReliveDayPhotoPanel(day);
}

// Trip-wide overview: every day's photos and every leg, shown together and framed
// to the whole trip's bounds. This is what Relive Trip now opens on instead of
// jumping straight to Day 1, so you see the full picture before drilling into one day.
function showReliveOverview() {
  if (!reliveDays.length) return;
  reliveDayIndex = -1;
  const allPhotos = reliveDays.flatMap(d => d.photos);

  highlightActiveReliveCard();

  document.getElementById('reliveCount').textContent = `${allPhotos.length} photo${allPhotos.length !== 1 ? 's' : ''}`;
  document.getElementById('relivePrevBtn').disabled = true;
  document.getElementById('reliveNextBtn').disabled = false;

  if (globeCtrl) {
    globeCtrl.showSubset(allPhotos);
    globeCtrl.flyToBounds(tripBounds());
  }
  renderDayLegChips(reliveLegs);
  renderDayLegRoutes(reliveLegs);
  renderReliveOverviewPhotoPanel(allPhotos);
}

// Re-renders whichever view is currently open (a specific day, or the Entire
// Trip overview). Used after something that changes the current legs/routes
// (relabeling a leg, importing a GPX track) but shouldn't itself navigate.
function refreshReliveView() {
  if (reliveDayIndex === -1) showReliveOverview();
  else showReliveDay(reliveDayIndex);
}

function highlightActiveReliveCard() {
  document.querySelectorAll('#reliveDayCards .relive-day-card').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.dayIndex) === reliveDayIndex));
  document.querySelector(`#reliveDayCards .relive-day-card[data-day-index="${reliveDayIndex}"]`)
    ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

// Union of every day's bounds. Same padding logic as a single day (flyToBounds
// in globe.js), just covering the whole trip's spread instead of one day's.
function tripBounds() {
  const lats = reliveDays.flatMap(d => [d.bounds.minLat, d.bounds.maxLat]);
  const lngs = reliveDays.flatMap(d => [d.bounds.minLng, d.bounds.maxLng]);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

// Small clickable pills, one per leg that day - "🚗 Paris → Troyes" - the only way to
// correct a leg's mode (see the file header comment above buildTripLegs for why: no
// clicking the 3D line itself, that'd be fiddly to hit precisely in a rotating globe).
function renderDayLegChips(legs) {
  const host = document.getElementById('reliveLegChips');
  if (!host) return;
  host.innerHTML = '';
  if (!LEG_ROUTES_ENABLED) return;
  legs.forEach(leg => {
    const chip = document.createElement('button');
    chip.className = 'relive-leg-chip';
    const places = (leg.startPlace && leg.endPlace && leg.startPlace !== leg.endPlace) ? `${leg.startPlace} → ${leg.endPlace}` : (leg.startPlace || '');
    chip.textContent = `${MODE_EMOJI[leg.mode]} ${places}`;
    chip.onclick = e => showLegModePopup(e, leg);
    host.appendChild(chip);
  });
}

// Renders every leg of the day immediately with its simplified fallback line (so
// Relive Trip never waits on a network call), then best-effort upgrades any drive
// legs to a real Mapbox-matched road once that resolves - guarded by
// reliveRenderToken so a slow response can't overwrite the route after the user has
// already stepped to a different day.
async function renderDayLegRoutes(legs) {
  const myToken = ++reliveRenderToken;
  if (!globeCtrl) return;
  if (!LEG_ROUTES_ENABLED || !legs.length) { globeCtrl.showRoutes([]); return; }

  const trip = appData.folders.find(f => f.id === reliveTripId);
  const color = trip?.color || '#06b6d4';
  const segments = legs.map(leg => ({
    id: leg.id, mode: leg.mode, color,
    points: appData.legGpxTracks?.[legGpxKey(leg)]?.points || simplifiedLegPoints(leg)
  }));
  globeCtrl.showRoutes(segments);

  // Every non-flight leg without an imported GPX gets a best-effort road/trail
  // snap - including the connector legs buildTripLegs() now inserts between a
  // drive and a hike, which is what makes a hike's start/end actually land on the
  // road instead of floating.
  const routableLegs = legs.filter(l => MODE_ROUTING_PROFILE[l.mode] && !appData.legGpxTracks?.[legGpxKey(l)]);
  for (const leg of routableLegs) {
    resolveLegRoute(leg).then(matched => {
      if (!matched || myToken !== reliveRenderToken) return;
      const seg = segments.find(s => s.id === leg.id);
      if (seg) seg.points = matched.points;
      globeCtrl.showRoutes(segments);
    });
  }
}

function reliveNext() { showReliveDay(reliveDayIndex + 1); }
function relivePrev() {
  if (reliveDayIndex <= 0) { showReliveOverview(); return; }
  showReliveDay(reliveDayIndex - 1);
}

// Resets the bar/state only - does not touch globeCtrl (used both when explicitly
// exiting Relive and when the whole globe is closing, at which point globeCtrl is
// about to be destroyed anyway and calling showAll() on it would be pointless).
function closeReliveBar() {
  document.getElementById('reliveBar').classList.remove('open');
  document.getElementById('reliveDayPhotoPanel').classList.remove('open');
  hideLegModePopup();
  reliveTripId = null;
  reliveDays = [];
  reliveDayIndex = 0;
  reliveLegs = [];
  reliveRenderToken++; // invalidate any in-flight route upgrade
}

function exitRelive() {
  closeReliveBar();
  if (globeCtrl) globeCtrl.showAll(); // also clears any rendered routes - see globe.js
}

// ── SET LOCATION ON MAP ──────────────────────────────────────────────────────
function ctxSetLocation() {
  hideCtxMenu();
  const ids = selectedIds.size > 0 ? [...selectedIds] : (ctxFileId ? [ctxFileId] : []);
  if (!ids.length) return;
  locateModeFileIds = ids;
  if (globeOpen) initGlobe(); else toggleGlobe();
}

// "See on Map" - jumps to the regular (non-Relive) globe and flies straight to this
// one file's exact spot, with a brief highlight marker so it's unmistakable even if
// other nearby pins are clustered together at this zoom level.
function ctxSeeOnMap() {
  hideCtxMenu();
  const file = appData.files.find(f => f.id === ctxFileId);
  if (!file?.gps) return;
  if (!globeOpen) toggleGlobe();
  if (!globeCtrl) return;
  const { lat, lng } = file.gps;
  globeCtrl.flyToBounds({ minLat: lat, maxLat: lat, minLng: lng, maxLng: lng });
  globeCtrl.showHighlight(lat, lng);
  setTimeout(() => globeCtrl?.hideHighlight(), 4000);
}

function setManualLocation(f, lat, lng) {
  f.gps = { lat, lng };
  f.gpsManual = true; // hand-placed - never touched by automated GPS re-derivation
  f.country = null; f.countryCode = null; f.region = null; f.city = null; f.noGeocode = false;
}
// Guided Sort stays open at the same camera position/zoom after a confirm - this is the whole
// point when several remaining photos were taken near each other (no re-finding the spot on
// the map for every single one).
function gslAfterConfirm() {
  clearSelection();
  locatePending = null;
  globeCtrl?.clearPendingPin();
  renderGsLocatePanel();
}

async function confirmLocatePick() {
  const rawIds = gsPickMode ? [...selectedIds] : locateModeFileIds;
  if (!locatePending || !rawIds?.length) return;
  const idSet = new Set(rawIds);
  rawIds.forEach(id => { burstCoverMap.get(id)?.memberIds.forEach(m => idSet.add(m)); });
  const ids = [...idSet];
  const { lat, lng } = locatePending;
  ids.forEach(id => { const f = appData.files.find(f => f.id === id); if (f) setManualLocation(f, lat, lng); });
  await saveData();
  toast(`📍 Location set for ${ids.length} file${ids.length!==1?'s':''}`);
  setTimeout(() => geocodeFiles(), 500);

  if (gsPickMode) {
    gslAfterConfirm();
  } else {
    locateModeFileIds = null; // clear before toggleGlobe() closes so its cleanup doesn't re-cancel
    toggleGlobe();
  }
}

// buildGlobe(canvas, gpsFiles) now lives in globe.js (Three.js textured Earth).

// Generic non-blocking Undo toast - used by folder deletion and shortcut removal,
// previously the only two delete-adjacent actions in the app with neither a confirm
// dialog nor any way to undo them.
function undoToast(message, restoreFn) {
  const c = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item toast-undo';
  const span = document.createElement('span');
  span.textContent = message;
  const btn = document.createElement('button');
  btn.className = 'toast-undo-btn';
  btn.textContent = 'Undo';
  btn.onclick = async () => {
    el.remove();
    await restoreFn();
    toast('↩️ Restored');
  };
  el.append(span, btn);
  c.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ── DUPLICATE DETECTION ───────────────────────────────────────────────────────
// Finds visually-matching photos across the whole library (not just exact byte
// copies) by comparing a difference-hash (structure - a coarse "which patch is
// lighter than its neighbor" fingerprint of pixel positions) and a 4x4 average
// color grid, both computed from the already-cached OS thumbnail. Groups are
// found via bucketed union-find so this stays fast for large libraries, and
// nothing is ever deleted until the user reviews the pair/group side-by-side
// and confirms - the "best" file is only pre-selected, never auto-applied.
let dupPhase = 'scanning'; // 'scanning' | 'results' | 'compare'
let dupGroups = [];
// "Not duplicates - ignore" dismissals, persisted (appData.dupIgnoredKeys) so a rescan - or
// reopening the app - doesn't keep surfacing a group the user already reviewed and rejected.
// Rebuilt from appData in init()/restoreBackup(); kept as a Set here purely for fast lookup.
let dupIgnoredKeys = new Set();
let dupOpenGroupId = null;
let dupScanToken = 0; // bumped to cancel/ignore a stale in-flight scan (e.g. user closed the mode)
const dupFingerprintCache = new Map(); // fileId -> {hash:Uint8Array(8), color:Uint8Array(48), size} - session-only, keyed off file.size to auto-invalidate if the file changed

const DUP_POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let c = 0, v = i; while (v) { c += v & 1; v >>= 1; } DUP_POPCOUNT[i] = c; }
const DUP_HASH_THRESHOLD = 8;    // out of 64 bits (~12%) - how different the structure hash may be and still count as a match
const DUP_COLOR_THRESHOLD = 60;  // out of a max 48*255 - how different the 4x4 average-color grid may be
// Looser visual bar for two files that also share the moment and the place they were shot -
// covers copies that were resized, re-compressed or converted to another color profile hard
// enough to miss the strict bar, while still needing to look like the same picture.
const DUP_SAME_SHOT_HASH_THRESHOLD = 14;
const DUP_SAME_SHOT_COLOR_THRESHOLD = 180;
const DUP_SAME_MOMENT_MS = 2000;   // EXIF dates are whole seconds; 2s absorbs rounding between copies
const DUP_SAME_PLACE_KM = 0.1;
const DUP_FAR_APART_KM = 1;

function dupHammingDist(a, b) { let d = 0; for (let i = 0; i < 8; i++) d += DUP_POPCOUNT[a[i] ^ b[i]]; return d; }
function dupColorDist(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d; }

// GPS written by the camera, not typed in through Edit Properties - only that is evidence.
function dupCameraGps(f) { return f.gps && !f.gpsManual ? f.gps : null; }
// Same camera naming with a different shot counter (IMG_1234 / IMG_1235) is two shots, however
// alike - which matters for bursts, all fired within the same second and place.
function dupDifferentShotCounter(a, b) {
  const ma = a.name.replace(/\.[^.]+$/, '').match(/^(\D*)(\d+)$/), mb = b.name.replace(/\.[^.]+$/, '').match(/^(\D*)(\d+)$/);
  return !!(ma && mb && ma[1].toUpperCase() === mb[1].toUpperCase() && parseInt(ma[2], 10) !== parseInt(mb[2], 10));
}
// Insta360's higher-res modes record each lens to its own file - VID_..._00_004.insv (front) and
// VID_..._10_004.insv (back). Same moment, same length, similar thumbnail, but two halves of one
// 360 video: deleting either leaves the other unviewable as 360. Never copies, never edits.
function isInsta360LensPair(nameA, nameB) {
  const lens = /_(00|10)_(\d+\.insv)$/i;
  if (nameA === nameB || !lens.test(nameA) || !lens.test(nameB)) return false;
  return nameA.replace(lens, '_X_$2').toUpperCase() === nameB.replace(lens, '_X_$2').toUpperCase();
}
// Whether two files are copies of each other. The picture decides; date and GPS weigh in:
//  - camera GPS more than 1 km apart rules a match out - a copy keeps the coordinates or drops them
//  - the same second AND the same spot let a looser visual match through
// A different date never counts against a match: fileDate falls back to the file's modified time
// when there's no EXIF date, and an editor's re-save rewrites it, so copies often disagree on it.
function dupIsMatch(a, b, fpA, fpB, durA, durB) {
  if (isVid(a.ext) !== isVid(b.ext)) return false; // never group a photo with a video
  if (isInsta360LensPair(a.name, b.name)) return false;
  // A single extracted frame is much weaker evidence for "same video" than it is for
  // "same photo" (the OS thumbnailer's frame pick isn't pinned to a timestamp), so once
  // both durations are known, require them to actually line up too before calling it a dup.
  if (isVid(a.ext) && durationsMatch(durA, durB) === false) return false;
  const gpsA = dupCameraGps(a), gpsB = dupCameraGps(b);
  const km = gpsA && gpsB ? haversineKm(gpsA, gpsB) : null;
  if (km != null && km > DUP_FAR_APART_KM) return false;
  const hd = dupHammingDist(fpA.hash, fpB.hash), cd = dupColorDist(fpA.color, fpB.color);
  if (hd <= DUP_HASH_THRESHOLD && cd <= DUP_COLOR_THRESHOLD) return true;
  const sameShot = km != null && km <= DUP_SAME_PLACE_KM && a.fileDate && b.fileDate
    && Math.abs(a.fileDate - b.fileDate) <= DUP_SAME_MOMENT_MS && !dupDifferentShotCounter(a, b);
  return sameShot && hd <= DUP_SAME_SHOT_HASH_THRESHOLD && cd <= DUP_SAME_SHOT_COLOR_THRESHOLD;
}

function dupUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  return { find, union: (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; } };
}

// 9x8 grayscale dHash (64 bits, packed into 8 bytes: row i = 8 left>right comparisons)
// plus a 4x4 average-color grid (letting the canvas's own downscale filtering do the
// averaging) - "pixel location" (structure) and "color" as two independent signals.
function dupComputeFingerprint(img) {
  const hc = document.createElement('canvas');
  hc.width = 9; hc.height = 8;
  const hctx = hc.getContext('2d', { willReadFrequently: true });
  hctx.drawImage(img, 0, 0, 9, 8);
  const hd = hctx.getImageData(0, 0, 9, 8).data;
  const gray = new Float32Array(72);
  for (let i = 0; i < 72; i++) { const o = i * 4; gray[i] = 0.299 * hd[o] + 0.587 * hd[o + 1] + 0.114 * hd[o + 2]; }
  const hash = new Uint8Array(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (gray[row * 9 + col] > gray[row * 9 + col + 1] ? 1 : 0);
    hash[row] = byte;
  }

  const cc = document.createElement('canvas');
  cc.width = 4; cc.height = 4;
  const cctx = cc.getContext('2d', { willReadFrequently: true });
  cctx.drawImage(img, 0, 0, 4, 4);
  const cd = cctx.getImageData(0, 0, 4, 4).data;
  const color = new Uint8Array(48);
  for (let i = 0; i < 16; i++) { color[i * 3] = cd[i * 4]; color[i * 3 + 1] = cd[i * 4 + 1]; color[i * 3 + 2] = cd[i * 4 + 2]; }

  return { hash, color };
}

async function dupLoadFingerprint(file) {
  const cached = dupFingerprintCache.get(file.id);
  if (cached && cached.size === file.size) return cached;
  const url = await getThumb(file);
  if (!url) return null;
  const img = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  if (!img) return null;
  const { hash, color } = dupComputeFingerprint(img);
  const entry = { hash, color, size: file.size };
  dupFingerprintCache.set(file.id, entry);
  return entry;
}

// Video length, read via a throwaway <video>'s loadedmetadata event (same file:// loading the
// popup player already uses) rather than any decode/ffmpeg step - cheap, and a far stronger
// "is this the same footage" signal for video than a single extracted thumbnail frame, since
// re-encoding barely moves duration while the OS's frame-pick heuristic can land anywhere.
const dupDurationCache = new Map(); // fileId -> {duration:number|null, size}
function dupLoadVideoDuration(file) {
  const cached = dupDurationCache.get(file.id);
  if (cached && cached.size === file.size) return Promise.resolve(cached.duration);
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const finish = (duration) => {
      dupDurationCache.set(file.id, { duration, size: file.size });
      v.removeAttribute('src'); v.load();
      resolve(duration);
    };
    v.onloadedmetadata = () => finish(isFinite(v.duration) ? v.duration : null);
    v.onerror = () => finish(null);
    v.src = pathToFileUrl(file.path);
  });
}
// True once both durations are known and close enough to plausibly be the same underlying
// footage (a straight copy or re-encode) - tolerance scales with length so a couple of rounded
// seconds on a long video isn't punished while short clips still need a tight match.
function durationsMatch(durA, durB) {
  if (durA == null || durB == null) return null; // unknown - caller decides how to treat that
  const tol = Math.max(1, Math.min(durA, durB) * 0.05);
  return Math.abs(durA - durB) <= tol;
}

// Prefers whichever copy carries the most real metadata (GPS, camera, a real
// date, a resolved place name) - a re-share/screenshot/re-export of a duplicate
// commonly loses this on the way, so it's a solid proxy for "the original."
// File size only breaks ties, as a rough stand-in for "less recompressed."
function dupScoreFile(f) {
  let score = 0;
  if (f.gps) score += 4;
  if (f.cameraMake || f.cameraModel || f.cameraFolder) score += 3;
  if (f.fileDate) score += 1;
  if (f.country || f.city || f.region) score += 1;
  return score;
}
function dupPickRecommended(files) {
  return files.reduce((best, f) => {
    const sf = dupScoreFile(f), sb = dupScoreFile(best);
    if (sf > sb) return f;
    if (sf === sb && (f.size || 0) > (best.size || 0)) return f;
    return best;
  }, files[0]);
}

// Stable identity for a group independent of the "dg-<recommendedId>" display id (which
// shifts if the recommended file changes) - the sorted member-id list, so a dismissed group
// is still recognized as "the same group" on the next scan even if a member's metadata
// improved enough to change which file is recommended.
function dupGroupKey(files) { return files.map(f => f.id).sort().join(','); }

function dupBuildGroup(files) {
  const keep = dupPickRecommended(files);
  const wastedBytes = files.reduce((s, f) => s + (f.id === keep.id ? 0 : (f.size || 0)), 0);
  return { id: 'dg-' + keep.id, key: dupGroupKey(files), files, recommendedId: keep.id, keepIds: new Set([keep.id]), wastedBytes };
}

// ── EDITED PHOTO DETECTION (original ↔ edited → version pairs, library-wide) ───
// Normalizes a filename to a match key: strips the extension and a trailing
// "-edited"/"(edited)" suffix, then - only for the iPhone "IMG_E1234" convention
// (an E immediately after the last underscore, right before the trailing digits) -
// drops that E too, so "IMG_1234" and "IMG_E1234" resolve to the same key.
function versionBaseKey(filename) {
  let base = filename.replace(/\.[^.]+$/, '').trim();
  base = base.replace(/[-_ ]?\(?edited\)?$/i, '').replace(/[-_ ]?edit$/i, '');
  const m = base.match(/^(.*_)E(\d+)$/i);
  if (m) return (m[1] + m[2]).toUpperCase();
  return base.toUpperCase();
}
// True for a filename that itself carries an "this is the edited one" marker
// (the iPhone _E prefix, or a "-edited"/"-edit" suffix) - used only to break a
// same-key tie in favor of calling the OTHER file the original.
function isEditedNameVariant(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  return /_E\d+$/i.test(base) || /[-_ ]edited?$/i.test(base);
}

function versionPairKey(idA, idB) { return idA < idB ? idA + '|' + idB : idB + '|' + idA; }
function makeVersionPair(original, edited, method, confidence) {
  return { id: 'ep-' + original.id + '-' + edited.id, original, edited, method, confidence: confidence ?? (method === 'filename' ? 100 : null) };
}

// ── 100% sure: the edit's own name says so ───────────────────────────────────
// Phones, drones and editors name what they export after the shot it came from. These are the
// conventions, taken from pairs actually found in a real library:
//   iPhone        IMG_E1234.JPG                          -> IMG_1234.JPG
//   GoPro         G001E8928.JPG                          -> G0018928.JPG (same E, no underscore)
//   Exports       IMG_1878.jpeg / IMG_1123.PNG           -> IMG_1878.JPG / IMG_1123.JPG
//                 (same name, another format, same moment - a RAW+JPEG pair is not an edit)
//   DJI Fly app   dji_fly_20260406_112016_439_…_photo_optimized.jpeg -> DJI_0439.JPG
//                 (the 439 is the drone's shot counter; the date in the name has to match the
//                 original's, since counters restart and repeat)
//   Stabilisers   DJI_0123_stabilized.mp4 (DJI, Gyroflow)  -> DJI_0123.MP4
//   Editors       name-edited / name (edited) / name-Edit (Lightroom) -> name
// A match also has to be the same kind of file (a photo's edit is a photo) and, when both carry
// a date, taken within 3 days of each other - the same counter can recur years apart. With
// several candidate originals, the one closest in time wins.
// Which of two formats of the same shot is the camera's own: HEIC/JPG as the camera writes it
// (upper-case) before a lower-case re-save, before PNG and WebP exports.
function editedFormatRank(f) {
  const ext = f.name.slice(f.name.lastIndexOf('.') + 1);
  const order = ['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp'];
  const i = order.indexOf(ext.toLowerCase());
  return (i < 0 ? order.length : i) * 2 + (ext === ext.toUpperCase() ? 0 : 1);
}
function editedNamePairs(files) {
  const base = f => f.name.replace(/\.[^.]+$/, '');
  const byBase = new Map();
  for (const f of files) {
    const k = base(f).toUpperCase();
    if (!byBase.has(k)) byBase.set(k, []);
    byBase.get(k).push(f);
  }
  const djiByCounter = new Map();
  for (const f of files) {
    const m = base(f).match(/^DJI_0*(\d+)$/i);
    if (!m || !isImg(f.ext)) continue;
    if (!djiByCounter.has(m[1])) djiByCounter.set(m[1], []);
    djiByCounter.get(m[1]).push(f);
  }
  const DAY = 86400000;
  const closeInTime = (a, b, maxMs) => !a.fileDate || !b.fileDate || Math.abs(a.fileDate - b.fileDate) <= maxMs;
  const sameKind = (a, b) => isVid(a.ext) === isVid(b.ext);
  const closest = (edit, list) => list.filter(o => o !== edit)
    .sort((a, b) => Math.abs((a.fileDate || 0) - (edit.fileDate || 0)) - Math.abs((b.fileDate || 0) - (edit.fileDate || 0)))[0];
  const out = [];
  const usedEdits = new Set();
  for (const f of files) {
    const name = base(f);
    let originals = null;
    const iphone = name.match(/^(.*?)E(\d{3,})$/i);
    const suffix = name.match(/^(.+?)(?:[-_ ]\(?edited\)?|[-_ ]edit|\s\(edited\)|_stabilized.*)$/i);
    const djiFly = name.match(/^dji_fly_(\d{4})(\d{2})(\d{2})_\d{6}_0*(\d+)_\d+_(?:photo|pano)_optimized/i);
    if (iphone) {
      originals = (byBase.get((iphone[1] + iphone[2]).toUpperCase()) || []).filter(o => sameKind(o, f) && closeInTime(o, f, 3 * DAY));
    } else if (djiFly) {
      const shotDay = new Date(+djiFly[1], +djiFly[2] - 1, +djiFly[3]).getTime();
      originals = (djiByCounter.get(djiFly[4]) || []).filter(o => o.fileDate && Math.abs(o.fileDate - shotDay) <= 1.5 * DAY);
    } else if (suffix) {
      originals = (byBase.get(suffix[1].toUpperCase()) || []).filter(o => sameKind(o, f) && closeInTime(o, f, 3 * DAY));
    }
    if (!originals?.length && isImg(f.ext) && !TroveMedia.RAW.has(f.ext.toLowerCase())) {
      originals = (byBase.get(name.toUpperCase()) || []).filter(o => o !== f && isImg(o.ext) && !TroveMedia.RAW.has(o.ext.toLowerCase())
        && o.ext.toLowerCase() !== f.ext.toLowerCase() && o.fileDate && f.fileDate && Math.abs(o.fileDate - f.fileDate) <= 2000
        && editedFormatRank(o) < editedFormatRank(f));
    }
    const original = originals?.length ? closest(f, originals) : null;
    if (!original || usedEdits.has(f.id)) continue;
    usedEdits.add(f.id);
    out.push(makeVersionPair(original, f, 'filename', 100));
  }
  return out;
}

// ── How sure a visual match is, 0-100 ────────────────────────────────────────
// Only visual matches at 98 or above are suggested: with no name to go on, anything less was
// mostly two similar-looking but different shots. 100 means the same picture (identical
// structure), taken within the hour, in the same place; every difference costs points - the
// picture's structure most, since an edit changes colour and light, not composition. Videos
// use their length in place of the picture: an edit that's the same length to the half-second.
const EDITED_MIN_CONFIDENCE = 98;
function editedConfidence(a, b, fpA, fpB, durA, durB) {
  let conf = 100;
  if (isVid(a.ext)) {
    if (durA == null || durB == null || !fpA || !fpB) return 0;
    const d = Math.abs(durA - durB);
    conf -= d <= 0.5 ? 0 : Math.min(40, d * 3);
    // Same length isn't enough on its own (a drone's fixed-length shots all are) - it has to look
    // like the same footage too.
    conf -= [0, 1, 4, 8, 13, 19, 26][Math.min(dupHammingDist(fpA.hash, fpB.hash), 6)];
  } else {
    if (!fpA || !fpB) return 0;
    const hd = dupHammingDist(fpA.hash, fpB.hash);
    conf -= [0, 1, 4, 8, 13, 19, 26][Math.min(hd, 6)];
  }
  // An edit keeps the capture time of the shot it came from; two different shots are at least
  // seconds apart. So: the same moment is full marks, within a minute costs a little, and
  // anything further apart can't reach the bar on its own.
  if (a.fileDate && b.fileDate) {
    const sec = Math.abs(a.fileDate - b.fileDate) / 1000;
    conf -= sec <= 2 ? 0 : sec <= 60 ? 2 : Math.min(30, 4 + sec / 600);
  } else conf -= 5;
  if (a.gps && b.gps && haversineKm(a.gps, b.gps) > 1) conf -= 10;
  // Shared or saved iPhone edits keep the E marker even under a random name (RBZYE0403): with
  // the exact same capture time, that marker is real evidence.
  const eMarked = n => /[A-Z]E\d{4}\.[^.]+$/i.test(n);
  if ((eMarked(a.name) || eMarked(b.name)) && a.fileDate && b.fileDate && Math.abs(a.fileDate - b.fileDate) <= 2000) conf += 4;
  return Math.max(0, Math.min(100, Math.round(conf)));
}

// Two names that only differ by a small "which take/copy is this" artifact aren't an
// edit relationship even when they land close in the visual/date scoring below:
//  - a trailing " (1)"/"(2)" is how Windows/browsers name a second download of the
//    same file - i.e. a duplicate, not an edit (Find Duplicates already covers it)
//  - the same alphabetic prefix with numeric counters 1-2 apart is almost always two
//    different consecutive shots (a mini-burst too small to register as a real burst),
//    not the same photo before/after editing - an edit never bumps the shot counter
function looksLikeNonEditNamePattern(nameA, nameB) {
  const baseA = nameA.replace(/\.[^.]+$/, ''), baseB = nameB.replace(/\.[^.]+$/, '');
  if (baseA.replace(/\s*\(\d+\)$/, '') === baseB || baseB.replace(/\s*\(\d+\)$/, '') === baseA) return true;
  const ma = baseA.match(/^(\D*)(\d+)$/), mb = baseB.match(/^(\D*)(\d+)$/);
  // Same camera naming, different shot counter: different shots. An edit never bumps the
  // counter, however far apart the two numbers are (DJI_0265 vs DJI_0268 are two clips).
  if (ma && mb && ma[1].toUpperCase() === mb[1].toUpperCase() && parseInt(ma[2], 10) !== parseInt(mb[2], 10)) return true;
  // Insta360 writes the two lenses of one recording as _00_ and _10_ - a pair, not an edit.
  if (baseA.replace(/_(00|10)_/, '_X_') === baseB.replace(/_(00|10)_/, '_X_') && baseA !== baseB) return true;
  return false;
}

// Confidence score for a candidate (a, b) pair from date + GPS + visual-hash closeness -
// null means "not even worth suggesting". A real edit (crop aside) keeps the same
// structure/composition and only shifts color/exposure, so the hash threshold is as tight
// as duplicate detection's own (8) - loose enough to survive a filter/tone edit, tight
// enough to reject two merely similar, genuinely different shots (consecutive frames,
// the next shot in a sequence too small to register as a burst) that a looser cutoff let through.
function editedPairScore(a, b, fpA, fpB, durA, durB) {
  if (isVid(a.ext) !== isVid(b.ext)) return null; // a photo is never "the edit" of a video or vice versa
  if (/.gif$/i.test(a.name) || /.gif$/i.test(b.name)) return null; // animations: a frame says too little
  if (looksLikeNonEditNamePattern(a.name, b.name)) return null;
  if (isVid(a.ext)) return editedPairScoreVideo(a, b, durA, durB);
  if (!fpA || !fpB) return null;
  const hd = dupHammingDist(fpA.hash, fpB.hash);
  if (hd > 6) return null;
  let score = 64 - hd;
  if (a.fileDate && b.fileDate) {
    const deltaH = Math.abs(a.fileDate - b.fileDate) / 3600000;
    if (deltaH > 72) return null; // more than 3 days apart isn't worth suggesting
    score += Math.max(0, 20 - deltaH);
  }
  if (a.gps && b.gps) {
    const km = haversineKm(a.gps, b.gps);
    if (km < 5) score += Math.max(0, 10 - km * 2);
  }
  return score;
}

// Video counterpart of editedPairScore: a trimmed/re-exported/color-graded edit can land the
// OS's extracted thumbnail frame almost anywhere, so structure/color hashing (reliable for
// photos) isn't trustworthy here. Duration is instead the primary signal - a genuine edit is
// usually the same length or trimmed shorter, never wildly different - corroborated by date/GPS
// exactly as the photo path does. At least one real signal is required; date/GPS alone (no
// duration on either side) is kept but weighted low so it can't carry a match by itself.
function editedPairScoreVideo(a, b, durA, durB) {
  let score = 0, hasSignal = false;
  if (durA != null && durB != null) {
    const deltaS = Math.abs(durA - durB);
    const longer = Math.max(durA, durB);
    if (deltaS > Math.max(5, longer * 0.5)) return null; // too different in length to plausibly be the same footage
    score += Math.max(0, 20 - deltaS);
    hasSignal = true;
  }
  if (a.fileDate && b.fileDate) {
    const deltaH = Math.abs(a.fileDate - b.fileDate) / 3600000;
    if (deltaH > 72) return null;
    score += Math.max(0, 20 - deltaH);
    hasSignal = true;
  }
  if (a.gps && b.gps) {
    const km = haversineKm(a.gps, b.gps);
    if (km < 5) score += Math.max(0, 10 - km * 2);
  }
  return hasSignal ? score : null;
}

// "Not a match - ignore" dismissals, persisted (appData.editedDismissedKeys) so a rescan - or
// reopening the app - doesn't keep resurfacing a pair the user already reviewed and rejected.
// Rebuilt from appData in init()/restoreBackup(); kept as a Set here purely for fast lookup.
let editedDismissedKeys = new Set();

// The edit half of Find Duplicates & Edits, with no screen attached - see computeDuplicateGroups
// for why it's separate and what opts means. It catches pairs the duplicate matcher's stricter
// colour bar lets through (a heavy grade, an export to another format), and its results are
// merged into the same groups by computeMatchGroups. Returns null if it went stale.
async function computeEditedPairs(opts = {}) {
  // Already-linked children are settled; everything else (including files that are
  // already someone's original) stays eligible so a second edit can still be found.
  const eligible = appData.files.filter(f => isMedia(f.ext) && !f._missing && !f.versionParentId && !f.isLivePhotoVideo);
  const resolved = new Set();
  const pairs = [];
  for (const p of editedNamePairs(eligible)) {
    resolved.add(p.original.id); resolved.add(p.edited.id);
    pairs.push(p);
  }
  if (opts.isStale?.()) return null;

  // Burst-clustered shots (a rapid-fire sequence from the same camera) are exactly the
  // "many similar photos taken close together" case that would otherwise flood this pass
  // with false positives - the app already understands them as a burst, not an edit.
  const { memberToCover } = computeBurstGroups(eligible);
  const remaining = eligible.filter(f => !resolved.has(f.id) && isMedia(f.ext) && !memberToCover.has(f.id));
  if (remaining.length >= 2) {
    const fp = new Array(remaining.length);
    const dur = new Array(remaining.length);
    let next = 0;
    async function worker() {
      while (next < remaining.length) {
        const i = next++;
        const f = remaining[i];
        if (opts.background && !(dupFingerprintCache.has(f.id) && (!isVid(f.ext) || dupDurationCache.has(f.id)))) await sortCountYield();
        // Videos are scored on duration, not the frame hash (see editedPairScoreVideo) -
        // photos still get the fingerprint used everywhere else.
        if (isVid(f.ext)) dur[i] = await dupLoadVideoDuration(f).catch(() => null);
        fp[i] = await dupLoadFingerprint(f).catch(() => null);
        if (opts.isStale?.()) return;
        opts.onProgress?.(i + 1, remaining.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(opts.background ? 2 : 6, remaining.length) }, worker));
    if (opts.isStale?.()) return null;

    // An edit can shift the perceptual hash further than duplicate detection's own
    // near-identical-copy bucketing would tolerate (a coarse hash-prefix bucket can miss
    // it entirely), but a real edit is essentially always made from a shot taken close in
    // time. Sort dated files chronologically and only compare within a sliding 72h window
    // - same effect as bucketing (avoids full O(n²) pairwise scoring) without the blind spot.
    const dated = [];
    const undated = [];
    for (let i = 0; i < remaining.length; i++) {
      const hasSignal = isVid(remaining[i].ext) ? dur[i] != null : !!fp[i];
      if (!hasSignal) continue;
      (remaining[i].fileDate ? dated : undated).push(i);
    }
    dated.sort((i, j) => remaining[i].fileDate - remaining[j].fileDate);
    const candidates = [];
    const WINDOW_MS = 72 * 3600000;
    for (let a = 0; a < dated.length; a++) {
      for (let b = a + 1; b < dated.length; b++) {
        const i = dated[a], j = dated[b];
        if (remaining[j].fileDate - remaining[i].fileDate > WINDOW_MS) break; // sorted - nothing further out is closer
        const score = editedPairScore(remaining[i], remaining[j], fp[i], fp[j], dur[i], dur[j]);
        if (score === null) continue;
        const conf = editedConfidence(remaining[i], remaining[j], fp[i], fp[j], dur[i], dur[j]);
        if (conf >= EDITED_MIN_CONFIDENCE) candidates.push({ i, j, score: conf * 1000 + score, conf });
      }
    }
    // Undated files have no time signal to lean on - fall back to a coarse locality bucket
    // scoped to just this (typically small) subset: hash-prefix for photos (same as duplicate
    // detection), rounded duration for videos.
    const undatedBuckets = new Map();
    for (const i of undated) {
      const f = remaining[i];
      const key = isVid(f.ext) ? 'v' + Math.round(dur[i] / 5) : 'p' + ((fp[i].hash[0] << 8) | fp[i].hash[1]);
      if (!undatedBuckets.has(key)) undatedBuckets.set(key, []);
      undatedBuckets.get(key).push(i);
    }
    for (const idxs of undatedBuckets.values()) {
      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < idxs.length; b++) {
          const i = idxs[a], j = idxs[b];
          const score = editedPairScore(remaining[i], remaining[j], fp[i], fp[j], dur[i], dur[j]);
          if (score === null) continue;
          const conf = editedConfidence(remaining[i], remaining[j], fp[i], fp[j], dur[i], dur[j]);
          if (conf >= EDITED_MIN_CONFIDENCE) candidates.push({ i, j, score: conf * 1000 + score, conf });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const used = new Set();
    for (const c of candidates) {
      if (used.has(c.i) || used.has(c.j)) continue;
      used.add(c.i); used.add(c.j);
      const fa = remaining[c.i], fb = remaining[c.j];
      const original = (fa.fileDate || 0) <= (fb.fileDate || 0) ? fa : fb;
      const edited = original === fa ? fb : fa;
      pairs.push(makeVersionPair(original, edited, 'metadata', c.conf));
    }
  }
  if (opts.isStale?.()) return null;
  return pairs.filter(p => !editedDismissedKeys.has(versionPairKey(p.original.id, p.edited.id)));
}

function editedPanelHtml(f, roleLabel, otherId, footerHtml) {
  return `<div class="dup-panel">
    <div class="dup-panel-badge">${roleLabel === 'Original' ? '📷' : '✏️'} ${roleLabel}</div>
    <div class="dup-panel-imgwrap" title="Double-click to view full size" ondblclick="editedPanelOpenFull('${f.id}','${otherId}')">
      <span class="thumb-icon">${getEmoji(f.ext)}</span>
      <img id="edImg-${f.id}" style="display:none" onload="this.style.display=''" src=""/>
      <div class="dup-panel-zoom-hint">🔍 Double-click to view full size</div>
    </div>
    <div class="dup-panel-meta">
      <div class="dup-panel-name" title="${esc(f.name)}">${esc(f.name)}</div>
      ${isVid(f.ext) ? `<div class="dup-panel-row">⏱ ${fmtDuration(dupDurationCache.get(f.id)?.duration)}</div>` : ''}
      <div class="dup-panel-row">📅 ${f.fileDate ? fmtDate(f.fileDate) : 'Unknown date'}</div>
      ${f.gps ? `<div class="dup-panel-row">📍 Has GPS</div>` : ''}
    </div>
    ${footerHtml || ''}
  </div>`;
}

// Double-clicking a panel opens the same full-size, zoomable popup used everywhere
// else in the app (see dupOpenFull), browsing just this original/edited pair rather
// than the whole library. It's called from the Version Compare modal (versionCompareModal,
// z-index 500), and this popup is the very card that modal floats on top of (photoPopup,
// z-index 400, lower). Just updating its content wouldn't be visible with the modal
// still covering it, so close the modal first.
function editedPanelOpenFull(fileId, otherId) {
  const a = appData.files.find(f => f.id === fileId);
  const b = appData.files.find(f => f.id === otherId);
  if (!a) return;
  closeVersionCompareModal();
  openMediaPopup({ files: b ? [a, b] : [a], index: 0 });
}

// ── MANUAL LINK PICKER (full library browser, ranked + pixel-suggested) ────────
let vpTargetFileId = null;
let vpCandidates = [];
let vpScores = new Map(); // fileId -> score, refined in the background by vpComputeVisualScores
let vpVisualToken = 0; // stale background-scoring passes bail out as soon as they check this
let vpReturnTo = []; // ids of overlay elements that were open when the picker opened, reopened on close
let vpPageObserver = null;

function getVersionDescendantIds(fileId) {
  const ids = new Set();
  const walk = id => { getVersionChildren(id).forEach(c => { ids.add(c.id); walk(c.id); }); };
  walk(fileId);
  return ids;
}

// Ranks every other media file by how plausible it is as `target`'s original - same
// filename key first, then closeness in time, then closeness in space. Visual/pixel
// similarity is folded in afterward, once computed in the background (see below), since
// fingerprinting is too slow to block opening the picker on.
function vpRankCandidates(target) {
  const exclude = new Set([target.id, ...getVersionDescendantIds(target.id)]);
  const targetKey = versionBaseKey(target.name);
  vpScores = new Map();
  const ranked = appData.files
    .filter(f => isMedia(f.ext) && !f._missing && !exclude.has(f.id))
    .map(f => {
      let score = 0;
      if (versionBaseKey(f.name) === targetKey) score += 1000;
      if (target.fileDate && f.fileDate) score += Math.max(0, 200 - Math.abs(target.fileDate - f.fileDate) / 3600000);
      if (target.gps && f.gps) score += Math.max(0, 50 - haversineKm(target.gps, f.gps));
      vpScores.set(f.id, score);
      return f;
    });
  ranked.sort((a, b) => vpScores.get(b.id) - vpScores.get(a.id));
  return ranked;
}

// Fingerprints the target plus a bounded pool of its best name/date/location candidates
// (fingerprinting the whole library here would make the picker feel slow to open) and
// boosts any that actually look like the same photo, so a real pixel match reliably
// surfaces into Suggested even when the name/date signals alone were weak.
async function vpComputeVisualScores(target) {
  if (!isImg(target.ext)) return;
  const token = ++vpVisualToken;
  const pool = vpCandidates.filter(f => isImg(f.ext)).slice(0, 60);
  if (!pool.length) return;
  const targetFp = await dupLoadFingerprint(target).catch(() => null);
  if (!targetFp || token !== vpVisualToken) return;
  await Promise.all(pool.map(async f => {
    const fp = await dupLoadFingerprint(f).catch(() => null);
    if (!fp || token !== vpVisualToken) return;
    const hd = dupHammingDist(targetFp.hash, fp.hash);
    if (hd <= 12) vpScores.set(f.id, (vpScores.get(f.id) || 0) + (64 - hd) * 3);
  }));
  if (token !== vpVisualToken) return;
  vpCandidates.sort((a, b) => vpScores.get(b.id) - vpScores.get(a.id));
  vpRenderList();
}

function openVersionPickModal(targetFileId) {
  const target = appData.files.find(f => f.id === targetFileId);
  if (!target) return;
  vpTargetFileId = targetFileId;
  vpCandidates = vpRankCandidates(target);
  vpVisualToken++; // invalidate any still-running scoring pass from a previous open
  document.getElementById('photoPopup').classList.remove('open');
  vpReturnTo = ['versionModal'].filter(id => document.getElementById(id).classList.contains('open'));
  vpReturnTo.forEach(id => document.getElementById(id).classList.remove('open'));
  document.getElementById('vpModalSub').textContent = `Pick what "${target.name}" is an edited version of - once linked, its date, location and camera info take over here too.`;
  document.getElementById('vpSearchInput').value = '';
  document.getElementById('versionPickMode').classList.add('open');
  vpRenderList();
  setTimeout(() => document.getElementById('vpSearchInput').focus(), 60);
  vpComputeVisualScores(target);
}

function closeVersionPickModal() {
  vpVisualToken++;
  if (vpPageObserver) { vpPageObserver.disconnect(); vpPageObserver = null; }
  document.getElementById('versionPickMode').classList.remove('open');
  vpTargetFileId = null; vpCandidates = []; vpScores = new Map();
  vpReturnTo.forEach(id => document.getElementById(id)?.classList.add('open'));
  vpReturnTo = [];
}

const VP_SUGGEST_THRESHOLD = 50; // below this, a candidate's score is just coincidental proximity, not worth calling out
const VP_SUGGEST_MAX = 8;

function vpCardHtml(f, suggested) {
  return `<div class="vp-card${suggested?' vp-suggested':''}">
    <div class="file-card-thumb thumb-loading" data-thumb-for="${f.id}">
      <span class="thumb-icon">${getEmoji(f.ext)}</span>
      ${suggested ? '<span class="vp-suggested-badge">✨ Suggested</span>' : ''}
    </div>
    <div class="vp-card-name" title="${esc(f.name)}">${esc(f.name)}</div>
    <div class="vp-card-meta">${f.fileDate ? fmtDate(f.fileDate) : 'Unknown date'}</div>
  </div>`;
}

function vpAppendCards(files, container, suggested) {
  files.forEach(f => {
    const wrap = document.createElement('div');
    wrap.innerHTML = vpCardHtml(f, suggested);
    const el = wrap.firstElementChild;
    el.addEventListener('click', () => vpConfirm(f.id));
    container.appendChild(el);
    const thumbEl = el.querySelector('[data-thumb-for]');
    if (thumbEl) observeThumb(thumbEl);
  });
}

function vpRenderList() {
  const q = document.getElementById('vpSearchInput').value.trim().toLowerCase();
  const list = q ? vpCandidates.filter(f => f.name.toLowerCase().includes(q)) : vpCandidates;
  const box = document.getElementById('vpResultsList');
  if (vpPageObserver) { vpPageObserver.disconnect(); vpPageObserver = null; }
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">🌿</div><div class="empty-title">No matches</div><div class="empty-sub">Try a different search term.</div></div>`;
    return;
  }
  const suggested = !q ? list.filter(f => vpScores.get(f.id) >= VP_SUGGEST_THRESHOLD).slice(0, VP_SUGGEST_MAX) : [];
  if (suggested.length) {
    const sugLabel = document.createElement('div');
    sugLabel.className = 'vp-section-label';
    sugLabel.textContent = '✨ Suggested';
    box.appendChild(sugLabel);
    const sugGrid = document.createElement('div');
    sugGrid.className = 'vp-grid';
    box.appendChild(sugGrid);
    vpAppendCards(suggested, sugGrid, true);

    const allLabel = document.createElement('div');
    allLabel.className = 'vp-section-label';
    allLabel.textContent = '📷 All Photos';
    box.appendChild(allLabel);
  }
  const grid = document.createElement('div');
  grid.className = 'vp-grid';
  box.appendChild(grid);
  const initial = Math.min(list.length, PAGE_SIZE);
  vpAppendCards(list.slice(0, initial), grid, false);
  if (list.length > initial) {
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    box.appendChild(sentinel);
    let rendered = initial;
    vpPageObserver = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      const batch = list.slice(rendered, rendered + PAGE_SIZE);
      if (!batch.length) { vpPageObserver.disconnect(); return; }
      rendered += batch.length;
      vpAppendCards(batch, grid, false);
      if (rendered >= list.length) vpPageObserver.disconnect();
    }, { rootMargin: '400px' });
    vpPageObserver.observe(sentinel);
  }
}

async function vpConfirm(fileId) {
  const target = appData.files.find(f => f.id === vpTargetFileId);
  const parent = appData.files.find(f => f.id === fileId);
  if (!target || !parent) return;
  target.versionParentId = parent.id;
  syncEditedMetadataFromOriginal(parent, target);
  await saveData();
  closeVersionPickModal();
  toast(`🌿 Linked "${target.name}" to "${parent.name}"`);
  if (popupClusterFiles[popupClusterIndex]?.id === target.id) renderPopupFile(); // full refresh, not just the linkage chips - date/location/camera may have just changed too
  if (versionModalFileId) renderVersionModal();
}

// ── VERSION HISTORY (branches of a linked original/edit) ────────────────────────
function openVersionModal(fileId) {
  versionModalFileId = fileId;
  document.getElementById('versionModal').classList.add('open');
  renderVersionModal();
}

function closeVersionModal() {
  versionModalFileId = null;
  document.getElementById('versionModal').classList.remove('open');
}

function versionTreeRowHtml(file, depth, isRoot) {
  const isCurrent = file.id === versionModalFileId;
  return `<div class="version-tree-row${isCurrent?' current':''}" style="margin-left:${depth*18}px" onclick="versionTreeOpen('${file.id}')">
    <div class="version-tree-thumb thumb-loading" data-thumb-for="${file.id}"><span class="thumb-icon">${getEmoji(file.ext)}</span></div>
    <div class="version-tree-info">
      <div class="version-tree-name" title="${esc(file.name)}">${esc(file.name)}</div>
      <div class="version-tree-tag">${isRoot ? '📷 Original' : '✏️ Edited'}${isCurrent?' · viewing':''}</div>
    </div>
    ${file.versionParentId ? `<span class="version-tree-unlink" onclick="event.stopPropagation();unlinkVersion('${file.id}')" title="Unlink from its original">Unlink</span>` : ''}
  </div>`;
}

function renderVersionModal() {
  const body = document.getElementById('versionModalBody');
  const current = appData.files.find(f => f.id === versionModalFileId);
  if (!current) { closeVersionModal(); return; }
  const root = getVersionRoot(current);
  const rows = [];
  const walk = (file, depth) => {
    rows.push({ file, depth, isRoot: depth === 0 });
    getVersionChildren(file.id).forEach(child => walk(child, depth + 1));
  };
  walk(root, 0);
  body.innerHTML = `<div class="version-tree">${rows.map(r => versionTreeRowHtml(r.file, r.depth, r.isRoot)).join('')}</div>`;
  body.querySelectorAll('[data-thumb-for]').forEach(el => observeThumb(el));
  const linkBtn = document.getElementById('versionModalLinkBtn');
  if (linkBtn) linkBtn.style.display = current.versionParentId ? 'none' : '';
}

function versionTreeOpen(fileId) {
  const file = appData.files.find(f => f.id === fileId);
  if (!file) return;
  closeVersionModal();
  openMediaPopup(file);
}

function enterDupDetection() {
  dupOpenGroupId = null;
  document.getElementById('dupMode').classList.add('open');
  scanForDuplicates();
}

function closeDupMode() {
  dupScanToken++; // stale scan callbacks bail out as soon as they check this
  document.getElementById('dupMode').classList.remove('open');
  document.getElementById('deleteConfirm').classList.remove('open');
  frResumeWizardIfPending();
}

async function scanForDuplicates() {
  const token = ++dupScanToken;
  dupPhase = 'scanning';
  renderDupMode();
  const groups = await computeMatchGroups({
    isStale: () => token !== dupScanToken,
    onProgress: (done, total, label) => { const prog = document.getElementById('dupProgress'); if (prog) prog.textContent = `${label} ${done} / ${total}…`; },
  });
  if (!groups) return;
  dupGroups = groups;
  dupPhase = 'results';
  renderDupMode();
  saveMatchCache();
}
// Duplicates and edits come from two different matchers, but they're one question for the user -
// "these are the same picture: which do I keep, and how?" - so they share one screen and one list.
// The duplicate matcher runs first and caches every fingerprint, so the edit matcher after it is
// mostly comparisons. An edit pair that touches a duplicate group joins it (one card per picture,
// never two); one that doesn't becomes a group of its own - those are the heavier edits and
// format exports the duplicate matcher's colour bar can't see. The Sort menu's count runs exactly
// this too, so its number is what the screen will show.
async function computeMatchGroups(opts = {}) {
  const stage = label => opts.onProgress && ((done, total) => opts.onProgress(done, total, label));
  const dups = await computeDuplicateGroups({ ...opts, onProgress: stage('Scanning') });
  if (!dups) return null;
  const pairs = await computeEditedPairs({ ...opts, onProgress: stage('Checking for edits') });
  if (!pairs) return null;
  return mergeMatchGroups(dups, pairs);
}
function mergeMatchGroups(dups, pairs) {
  const byId = new Map(), parent = new Map();
  const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const add = f => { if (!parent.has(f.id)) { parent.set(f.id, f.id); byId.set(f.id, f); } };
  const join = (a, b) => { const ra = find(a.id), rb = find(b.id); if (ra !== rb) parent.set(ra, rb); };
  for (const g of dups) { g.files.forEach(add); g.files.forEach(f => join(g.files[0], f)); }
  for (const p of pairs) { add(p.original); add(p.edited); join(p.original, p.edited); }
  const sets = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!sets.has(root)) sets.set(root, []);
    sets.get(root).push(byId.get(id));
  }
  // A visual "edit" that the duplicate matcher's strict bar also caught is just a copy: an edit
  // changes colour and light, which that bar doesn't let through. Only the name-matched ones
  // and the ones the duplicate matcher missed say "this is an edit".
  const dupOf = new Map();
  dups.forEach((g, i) => g.files.forEach(f => dupOf.set(f.id, i)));
  const isEdit = p => p.method === 'filename' || !dupOf.has(p.original.id) || dupOf.get(p.original.id) !== dupOf.get(p.edited.id);
  const groups = [...sets.values()].map(files => {
    const ids = new Set(files.map(f => f.id));
    const g = dupBuildGroup(files);
    g.pairs = pairs.filter(p => ids.has(p.original.id)); // every pair, for "ignore" - see dupIgnoreGroup
    g.editPairs = g.pairs.filter(isEdit);
    g.dupKeys = dups.filter(d => ids.has(d.files[0].id)).map(d => d.key);
    g.kind = g.editPairs.length ? 'edit' : 'dup';
    g.confidence = g.kind === 'edit' ? Math.min(...g.editPairs.map(p => p.confidence ?? 100)) : null;
    // "Sure" = every file is accounted for by a name-matched edit, so the bulk link can't sweep
    // in a look-alike copy that only the duplicate matcher vouched for.
    g.sure = g.kind === 'edit' && g.pairs.every(p => p.method === 'filename') && files.length === g.pairs.length + 1;
    g.originalId = g.kind === 'edit' ? matchGroupOriginal(g.editPairs) : g.recommendedId;
    // An edit is usually worth keeping next to its original, so nothing starts out marked for
    // deletion there; a plain duplicate starts with only the best copy kept, as it always has.
    if (g.kind === 'edit') g.keepIds = new Set(ids);
    return g;
  });
  const rank = g => g.sure ? 0 : g.kind === 'edit' ? 1 : 2;
  groups.sort((a, b) => rank(a) - rank(b) || b.wastedBytes - a.wastedBytes);
  return groups;
}
// With several edits of one shot, the original is the file that's nobody's edit.
function matchGroupOriginal(pairs) {
  let cur = pairs[0].original;
  for (let i = 0; i < pairs.length; i++) {
    const up = pairs.find(p => p.edited.id === cur.id);
    if (!up) break;
    cur = up.original;
  }
  return cur.id;
}

// The duplicate half of computeMatchGroups.
// opts.background paces it for running unasked: fewer at a time, yielding between files, and
// only while Trove has focus. Returns null if it went stale.
async function computeDuplicateGroups(opts = {}) {
  const files = appData.files.filter(f => isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo);
  if (!files.length) return [];

  const fp = new Array(files.length);
  const dur = new Array(files.length);
  let done = 0, next = 0;
  const CONCURRENCY = opts.background ? 2 : 6;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      if (opts.background && !dupFingerprintCache.has(f.id)) await sortCountYield();
      fp[i] = await dupLoadFingerprint(f).catch(() => null);
      if (isVid(f.ext)) dur[i] = await dupLoadVideoDuration(f).catch(() => null);
      done++;
      if (opts.isStale?.()) return;
      opts.onProgress?.(done, files.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  if (opts.isStale?.()) return null;

  // Candidate pairs, so full comparison never runs library-wide. Bucketed by each of the hash's
  // 8 bytes separately: two hashes within 7 bits of each other always share at least one whole
  // byte, so a resized/re-saved copy whose few flipped bits happen to land early in the hash is
  // still compared (a single 16-bit key missed those).
  const buckets = new Map();
  for (let i = 0; i < files.length; i++) {
    if (!fp[i]) continue;
    for (let band = 0; band < 8; band++) {
      const key = (band << 8) | fp[i].hash[band];
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }
  }
  // Plus every pair shot in the same second with camera GPS: the same-shot path below can accept
  // a looser visual match than the byte buckets guarantee to surface.
  const dated = [];
  for (let i = 0; i < files.length; i++) if (fp[i] && files[i].fileDate && dupCameraGps(files[i])) dated.push(i);
  dated.sort((a, b) => files[a].fileDate - files[b].fileDate);
  const sameMomentPairs = [];
  for (let a = 0; a < dated.length; a++) {
    for (let b = a + 1; b < dated.length && files[dated[b]].fileDate - files[dated[a]].fileDate <= DUP_SAME_MOMENT_MS; b++) sameMomentPairs.push([dated[a], dated[b]]);
  }

  // Files already linked as versions of each other are settled - the user said "keep both" -
  // so they never come back as a match, which "Keep both & link" relies on.
  const familyId = files.map(f => (f.versionParentId ? getVersionRoot(f).id : f.id));
  const uf = dupUnionFind(files.length);
  const consider = (i, j) => {
    if (familyId[i] === familyId[j]) return;
    if (uf.find(i) === uf.find(j)) return; // already grouped (pairs recur across buckets)
    if (dupIsMatch(files[i], files[j], fp[i], fp[j], dur[i], dur[j])) uf.union(i, j);
  };
  for (const idxs of buckets.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) consider(idxs[a], idxs[b]);
    }
  }
  for (const [i, j] of sameMomentPairs) consider(i, j);
  const groupMap = new Map();
  for (let i = 0; i < files.length; i++) {
    if (!fp[i]) continue;
    const root = uf.find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(files[i]);
  }
  const groups = [...groupMap.values()].filter(g => g.length >= 2).map(dupBuildGroup)
    .filter(g => !dupIgnoredKeys.has(g.key));
  groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
  return groups;
}

function renderDupMode() {
  if (dupPhase === 'results') { sortCounts.dups = dupGroups.length; updateSortButton(); }
  const body = document.getElementById('dupBody');
  const progress = document.getElementById('dupProgress');
  if (dupPhase === 'scanning') {
    body.innerHTML = `<div class="empty-state"><div class="dup-spinner"></div><div class="empty-title">Looking for duplicates &amp; edits…</div><div class="empty-sub">Comparing pixel structure and colour (and, for videos, duration), then filenames, dates and places to spot edited versions - this can take a moment for large libraries.</div></div>`;
    return;
  }
  if (dupPhase === 'compare') { progress.textContent = ''; renderDupCompare(body); return; }
  if (!dupGroups.length) {
    progress.textContent = '';
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">✨</div><div class="empty-title">No duplicates or edits found</div><div class="empty-sub">No photo or video is in your library twice, and every edited version Trove can spot is already linked to its original. You can always link one by hand from its photo view.</div><button class="empty-btn" onclick="scanForDuplicates()">↺ Scan again</button></div>`;
    return;
  }
  const edits = dupGroups.filter(g => g.kind === 'edit');
  const dups = dupGroups.filter(g => g.kind === 'dup');
  const sure = edits.filter(g => g.sure);
  const totalWaste = dups.reduce((s, g) => s + g.wastedBytes, 0);
  progress.textContent = [
    edits.length && `${edits.length} edit${edits.length !== 1 ? 's' : ''} to link`,
    dups.length && `${dups.length} duplicate group${dups.length !== 1 ? 's' : ''} · ${fmtSize(totalWaste)} could be freed`,
  ].filter(Boolean).join(' · ');
  body.innerHTML = (edits.length ? `
    <div class="eg-section">
      <div class="eg-section-head">
        <div><div class="eg-section-title">Edited versions</div>
        <div class="eg-section-sub">An edit and the shot it came from. Link them to keep both with only the edit showing in your library, or delete the one you don't need. Cards marked "name" are certain: the file names say which is the edit.</div></div>
        ${sure.length ? `<button class="btn-save" onclick="dupLinkAllSure()">🌿 Link all ${sure.length} named</button>` : ''}
      </div>
      <div class="dup-groups">${edits.map(dupGroupCardHtml).join('')}</div>
    </div>` : '') + (dups.length ? `
    <div class="eg-section">
      <div class="eg-section-head"><div><div class="eg-section-title">Duplicates · ${fmtSize(totalWaste)} could be freed</div>
      <div class="eg-section-sub">The same picture more than once. Delete the extra copies, or keep them all and link them as versions of one original.</div></div></div>
      <div class="dup-groups">${dups.map(dupGroupCardHtml).join('')}</div>
    </div>` : '');
  dupGroups.forEach(g => { const el = document.getElementById('dgth-' + g.id); if (el) observeThumb(el); });
}

function dupGroupCardHtml(g) {
  // An edit shows the edit itself (what stays visible once linked); a duplicate its best copy.
  const coverId = g.kind === 'edit' ? g.editPairs[0].edited.id : g.recommendedId;
  const cover = g.files.find(f => f.id === coverId) || g.files[0];
  const tag = g.kind === 'edit'
    ? (g.sure ? '100% · name' : `${g.confidence}% · ${g.editPairs.some(p => p.method === 'filename') ? 'name' : 'visual'}`) + (g.files.length > 2 ? ` · ${g.files.length} files` : '')
    : `${g.files.length} copies`;
  return `<div class="dup-group-card" onclick="openDupCompare('${g.id}')">
    <div class="dup-group-thumb thumb-loading" data-thumb-for="${cover.id}" id="dgth-${g.id}"><span class="thumb-icon">${getEmoji(cover.ext)}</span></div>
    <div class="dup-group-count${g.kind === 'edit' ? ' eg-tag' : ''}">${tag}</div>
    ${g.kind === 'dup' ? `<div class="dup-group-waste">${fmtSize(g.wastedBytes)} wasted</div>` : ''}
  </div>`;
}

function openDupCompare(groupId) { dupOpenGroupId = groupId; dupPhase = 'compare'; renderDupMode(); }
function dupBackToResults() { dupOpenGroupId = null; dupPhase = 'results'; renderDupMode(); }
async function dupIgnoreGroup() {
  const group = dupGroups.find(g => g.id === dupOpenGroupId);
  if (group) {
    // Both matchers have to forget it, or whichever one wasn't told would bring it straight back.
    [group.key, ...group.dupKeys].forEach(k => dupIgnoredKeys.add(k));
    group.pairs.forEach(p => editedDismissedKeys.add(versionPairKey(p.original.id, p.edited.id)));
    appData.dupIgnoredKeys = [...dupIgnoredKeys];
    appData.editedDismissedKeys = [...editedDismissedKeys];
    await saveData();
  }
  dupGroups = dupGroups.filter(g => g.id !== dupOpenGroupId);
  dupBackToResults();
}

// Double-clicking a panel opens the same full-size, zoomable popup used everywhere
// else in the app, browsing across this group's own files (so Prev/Next cycles
// between just the duplicates, not the whole library).
function dupOpenFull(groupId, fileId) {
  const group = dupGroups.find(g => g.id === groupId);
  if (!group) return;
  const index = group.files.findIndex(f => f.id === fileId);
  openMediaPopup({ files: group.files, index: index >= 0 ? index : 0 });
}

function renderDupCompare(body) {
  const group = dupGroups.find(g => g.id === dupOpenGroupId);
  if (!group) { dupBackToResults(); return; }
  const toDelete = group.files.filter(f => !group.keepIds.has(f.id));
  const deleteBytes = toDelete.reduce((s, f) => s + (f.size || 0), 0);
  const original = group.files.find(f => f.id === group.originalId) || group.files[0];
  const others = group.files.filter(f => f !== original);
  const methodHint = group.kind === 'dup' ? 'Visually the same picture.'
    : group.editPairs.every(p => p.method === 'filename') ? 'Matched by filename.'
    : isVid(original.ext) ? 'Matched by duration, date and location.' : 'Matched by date, location and visual similarity.';
  const linkDesc = others.length === 1
    ? `"${esc(others[0].name)}" will be linked as an edited version of "${esc(original.name)}" - only it shows in your library afterward, with the original's date, location and camera info.`
    : `The other ${others.length} will be linked as edited versions of "${esc(original.name)}" - only they show in your library afterward, with the original's date, location and camera info.`;
  body.innerHTML = `
   <div class="dup-compare">
    <div class="dup-compare-head">
      <button class="btn-cancel" onclick="dupBackToResults()">← Back</button>
      <div class="dup-compare-hint">${methodHint} Mark the original, then keep both and link them, or untick the ones to delete.</div>
      <button class="btn-cancel" onclick="dupIgnoreGroup()">Not a match - ignore</button>
    </div>
    <div class="dup-compare-row">${group.files.map(f => dupPanelHtml(group, f)).join('')}</div>
    <div class="dup-compare-foot">
      <span id="dupCompareSummary">${toDelete.length ? `Will delete ${toDelete.length} file${toDelete.length !== 1 ? 's' : ''} - ${fmtSize(deleteBytes)} freed` : linkDesc}</span>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="${group.kind === 'edit' ? 'btn-save' : 'btn-cancel'}" title="${linkDesc}" onclick="dupLinkGroup()">🌿 ${group.files.length === 2 ? 'Keep both' : `Keep all ${group.files.length}`} &amp; link</button>
        <button class="btn-save" style="background:var(--red)" id="dupCompareDeleteBtn" ${toDelete.length ? '' : 'disabled'} onclick="dupOpenGroupDeleteConfirm()">🗑 Delete unselected</button>
      </div>
    </div>
   </div>`;
  group.files.forEach(f => {
    getPreviewImage(f).then(url => {
      if (!url || dupOpenGroupId !== group.id) return;
      const img = document.getElementById('dupImg-' + f.id);
      if (img) img.src = url;
    });
  });
}

function dupPanelHtml(group, f) {
  const isOriginal = group.originalId === f.id;
  const kept = group.keepIds.has(f.id);
  const place = [f.city, f.region, f.country].filter(Boolean).join(', ');
  const badge = group.kind === 'edit' ? (isOriginal ? '📷 Original' : '✏️ Edited')
    : group.recommendedId === f.id ? '⭐ Recommended' : '';
  return `<div class="dup-panel${kept ? ' keep' : ''}">
    ${badge ? `<div class="dup-panel-badge">${badge}</div>` : ''}
    <div class="dup-panel-imgwrap" title="Double-click to view full size" ondblclick="dupOpenFull('${group.id}','${f.id}')">
      <span class="thumb-icon">${getEmoji(f.ext)}</span>
      <img id="dupImg-${f.id}" style="display:none" onload="this.style.display=''" src=""/>
      <div class="dup-panel-zoom-hint">🔍 Double-click to view full size</div>
    </div>
    <label class="dup-panel-keep" title="The one the others get linked to when you keep them all">
      <input type="radio" name="dupOrig-${group.id}" ${isOriginal ? 'checked' : ''} onchange="dupSetOriginal('${group.id}','${f.id}')"/> Original
    </label>
    <label class="dup-panel-keep">
      <input type="checkbox" ${kept ? 'checked' : ''} onchange="dupToggleKeep('${group.id}','${f.id}',this.checked)"/> Keep this one
    </label>
    <div class="dup-panel-meta">
      <div class="dup-panel-name" title="${esc(f.name)}">${esc(f.name)}</div>
      <div class="dup-panel-row">📦 ${fmtSize(f.size || 0)}</div>
      ${isVid(f.ext) ? `<div class="dup-panel-row">⏱ ${fmtDuration(dupDurationCache.get(f.id)?.duration)}</div>` : ''}
      <div class="dup-panel-row">📅 ${f.fileDate ? fmtDate(f.fileDate) : 'Unknown date'}</div>
      <div class="dup-panel-row">📷 ${esc(f.cameraFolder || f.cameraMake || 'Unknown camera')}</div>
      <div class="dup-panel-row">${f.gps ? `📍 ${countryFlag(f.countryCode) || ''} ${esc(place || `${f.gps.lat.toFixed(4)}, ${f.gps.lng.toFixed(4)}`)}` : '📍 No location'}</div>
      ${f.edits ? '<div class="dup-panel-row">✏️ Edited in Trove</div>' : ''}
      <div class="dup-panel-path" title="${esc(f.path)}">${esc(f.path)}</div>
    </div>
  </div>`;
}

function dupSetOriginal(groupId, fileId) {
  const group = dupGroups.find(g => g.id === groupId);
  if (!group) return;
  group.originalId = fileId;
  renderDupCompare(document.getElementById('dupBody'));
}

function dupToggleKeep(groupId, fileId, checked) {
  const group = dupGroups.find(g => g.id === groupId);
  if (!group) return;
  if (!checked && group.keepIds.size === 1 && group.keepIds.has(fileId)) {
    toast('⚠️ Keep at least one photo');
    renderDupMode();
    return;
  }
  if (checked) group.keepIds.add(fileId); else group.keepIds.delete(fileId);
  renderDupCompare(document.getElementById('dupBody'));
}

// Keeps every file and links the rest under the chosen original as its edited versions - the
// same link "Link to original" makes by hand. A file that already belongs to a version family
// brings the whole family along (its root is what gets linked), and one already in the
// original's own family is left alone, so a link can never loop back on itself.
function linkMatchGroup(group) {
  const original = group.files.find(f => f.id === group.originalId);
  if (!original) return 0;
  const originalRoot = getVersionRoot(original).id;
  let linked = 0;
  for (const f of group.files) {
    const root = getVersionRoot(f);
    if (root.id === originalRoot) continue;
    root.versionParentId = original.id;
    syncEditedMetadataFromOriginal(original, root);
    linked++;
  }
  return linked;
}

async function dupLinkGroup() {
  const idx = dupGroups.findIndex(g => g.id === dupOpenGroupId);
  const group = dupGroups[idx];
  if (!group) return;
  const original = group.files.find(f => f.id === group.originalId);
  const others = group.files.filter(f => f !== original);
  const linked = linkMatchGroup(group);
  await saveData();
  toast(!linked ? '🌿 Already linked as versions of each other'
    : linked === 1 && others.length === 1 ? `🌿 Linked "${others[0].name}" to "${original.name}"`
    : `🌿 Linked ${linked} version${linked !== 1 ? 's' : ''} to "${original.name}"`);
  dupGroups = dupGroups.filter(g => g.id !== group.id);
  // Straight on to the next one, so a batch is a run of clicks rather than a trip back each time.
  if (!dupGroups.length) { dupBackToResults(); return; }
  openDupCompare(dupGroups[Math.min(idx, dupGroups.length - 1)].id);
}

// Links every name-certain edit at once. Each keeps its own original; nothing is deleted, and
// any one can still be unlinked from its photo view.
async function dupLinkAllSure() {
  const sure = dupGroups.filter(g => g.sure);
  if (!sure.length) return;
  let linked = 0;
  for (const g of sure) linked += linkMatchGroup(g);
  dupGroups = dupGroups.filter(g => !g.sure);
  await saveData();
  toast(`🌿 Linked ${linked} edited version${linked === 1 ? '' : 's'} to ${linked === 1 ? 'its original' : 'their originals'}`, 4000);
  renderDupMode();
}

function dupOpenGroupDeleteConfirm() {
  const group = dupGroups.find(g => g.id === dupOpenGroupId);
  if (!group) return;
  const toDelete = group.files.filter(f => !group.keepIds.has(f.id));
  if (!toDelete.length) return;
  const bytes = toDelete.reduce((s, f) => s + (f.size || 0), 0);
  const plural = toDelete.length !== 1;
  openDeleteConfirm({
    title: '🗑 Delete files from disk?',
    sub: `This removes the real file${plural ? 's' : ''} from your hard drive - not just the shortcut${plural ? 's' : ''}.`,
    bodyHtml: `You are about to delete <strong style="color:var(--red)">${toDelete.length} file${plural ? 's' : ''}</strong> - a total of <strong style="color:var(--red)">${fmtSize(bytes)}</strong> from your hard drive.`,
    buttonLabel: `🗑 Delete ${toDelete.length} file${plural ? 's' : ''}`,
    onConfirm: confirmDupGroupDelete
  });
}

async function confirmDupGroupDelete() {
  const group = dupGroups.find(g => g.id === dupOpenGroupId);
  if (!group) { cancelDeleteConfirm(); return; }
  const toDelete = group.files.filter(f => !group.keepIds.has(f.id));
  const permanent = document.getElementById('deleteConfirmPermanent').checked;
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  releaseMediaForDelete(); // the preview is closed to reach this button, but a 360 lens partner may still be open - see releaseMediaForDelete
  const res = await window.api.deleteFiles(toDelete.map(f => f.path), permanent).catch(() => null);
  btn.disabled = false;
  if (!res) { toast('⚠️ Deletion failed'); btn.textContent = '🗑 Delete'; return; }
  const deletedSet = new Set(res.deleted);
  window.api.deleteEmbeddings(toDelete.filter(f => deletedSet.has(f.path)).map(f => f.id)).catch(() => {});
  appData.files = appData.files.filter(f => !deletedSet.has(f.path));
  recordSpaceFreed(res.bytes);
  await saveData();
  cancelDeleteConfirm();
  const freed = fmtSize(res.bytes);
  if (res.deleted.length) toast(permanent
    ? `🗑 Deleted ${res.deleted.length} file${res.deleted.length !== 1 ? 's' : ''} - ${freed} freed`
    : `🗑 ${res.deleted.length} file${res.deleted.length !== 1 ? 's' : ''} moved to Recycle Bin (${freed}) - empty it to free the space`, 5000);
  toastDeleteFailures(res);
  // Nothing went: the group is still exactly as it was, so leave it open to try again.
  if (!res.deleted.length) { renderDupCompare(document.getElementById('dupBody')); return; }
  dupGroups = dupGroups.filter(g => g.id !== group.id);
  dupBackToResults();
}

// ── BURST REVIEW ─────────────────────────────────────────────────────────────
// Lets the user pick a favorite frame from an auto-detected burst (see
// computeBurstGroups() and BURST_GAP_MS above) and either keep everything (just
// remembers the pick via file.burstCover) or delete the rest from disk -
// reusing the exact same window.api.deleteFiles()/confirm pattern as Duplicate
// Detection (see confirmDupGroupDelete() above), just scoped to one burst.
let burstReviewMembers = [];
let burstReviewSelectedId = null;

function openBurstReview(coverId) {
  const info = burstCoverMap.get(coverId);
  if (!info) return;
  burstReviewMembers = info.memberIds.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  burstReviewSelectedId = burstReviewMembers.find(f => f.burstCover)?.id || burstReviewMembers[0]?.id;
  document.getElementById('burstReviewSub').textContent = `${burstReviewMembers.length} photos taken moments apart - pick your favorite`;
  renderBurstReviewBody();
  document.getElementById('burstReview').classList.add('open');
}

function closeBurstReview() {
  const el = document.getElementById('burstReview');
  if (el) el.classList.remove('open');
  burstReviewMembers = [];
  burstReviewSelectedId = null;
}

function renderBurstReviewBody() {
  const body = document.getElementById('burstReviewBody');
  body.innerHTML = '';
  burstReviewMembers.forEach(f => {
    const cell = document.createElement('div');
    cell.className = 'burst-cell' + (f.id === burstReviewSelectedId ? ' current' : '');
    cell.title = f.name;
    cell.innerHTML = `
      <span>${getEmoji(f.ext)}</span>
      <button class="burst-cell-preview" title="View full size - double-click also works">🔍</button>
      <span class="burst-cell-check">✓ Favorite</span>`;
    // Full-size view opens every member of the burst at once (reusing the existing
    // cluster-popup nav) so the user can arrow through all of them to compare - not
    // just the one they clicked, which was a real friction point.
    const openFullAtThis = () => {
      const ordered = [f, ...burstReviewMembers.filter(x => x.id !== f.id)];
      openMediaPopup({ files: ordered });
    };
    cell.onclick = () => { burstReviewSelectedId = f.id; renderBurstReviewBody(); };
    cell.addEventListener('dblclick', e => { e.stopPropagation(); openFullAtThis(); });
    const wirePreviewBtn = () => cell.querySelector('.burst-cell-preview').addEventListener('click', e => { e.stopPropagation(); openFullAtThis(); });
    wirePreviewBtn();
    body.appendChild(cell);
    getThumb(f).then(url => {
      if (!url || !cell.isConnected) return;
      cell.innerHTML = `
        <img src="${url}" alt="" decoding="async"/>
        <button class="burst-cell-preview" title="View full size - double-click also works">🔍</button>
        <span class="burst-cell-check">✓ Favorite</span>`;
      wirePreviewBtn();
    });
  });
  const rest = burstReviewMembers.filter(f => f.id !== burstReviewSelectedId);
  const bytes = rest.reduce((sum, f) => sum + (f.size || 0), 0);
  const btn = document.getElementById('burstKeepOnlyBtn');
  if (btn) btn.textContent = `Keep Only This One - frees ${fmtSize(bytes)}`;
}

async function burstKeepAll() {
  if (!burstReviewSelectedId) return;
  burstReviewMembers.forEach(f => { f.burstCover = f.id === burstReviewSelectedId; });
  await saveData();
  closeBurstReview();
  toast('🎞 Favorite saved');
}

// Un-groups this burst for good (never re-collapsed, even after re-sorting/re-scanning)
// and files every member alongside whichever one is the current pick, so they end up
// organized together instead of the rest being unfiled.
async function burstShowAll() {
  if (!burstReviewMembers.length) return;
  const parent = burstReviewMembers.find(f => f.id === burstReviewSelectedId) || burstReviewMembers[0];
  const parentFolders = [...(parent.folders || [])];
  burstReviewMembers.forEach(f => { f.folders = [...parentFolders]; f.burstDismissed = true; });
  await saveData();
  closeBurstReview();
  toast(`🗂 Showing all ${burstReviewMembers.length} photos separately`);
}

function burstKeepOnlySelected() {
  if (!burstReviewSelectedId || burstReviewMembers.length < 2) return;
  const rest = burstReviewMembers.filter(f => f.id !== burstReviewSelectedId);
  const bytes = rest.reduce((sum, f) => sum + (f.size || 0), 0);
  const plural = rest.length !== 1;
  openDeleteConfirm({
    title: '🗑 Delete the rest of this burst?',
    sub: `This removes the real file${plural ? 's' : ''} from your hard drive - not just the shortcut${plural ? 's' : ''}.`,
    bodyHtml: `You are about to delete <strong style="color:var(--red)">${rest.length} photo${plural ? 's' : ''}</strong> from this burst - a total of <strong style="color:var(--red)">${fmtSize(bytes)}</strong> from your hard drive. Only your chosen favorite will remain.`,
    buttonLabel: `🗑 Delete ${rest.length} photo${plural ? 's' : ''}`,
    onConfirm: confirmBurstDelete
  });
}

async function confirmBurstDelete() {
  const permanent = document.getElementById('deleteConfirmPermanent').checked;
  const rest = burstReviewMembers.filter(f => f.id !== burstReviewSelectedId);
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  releaseMediaForDelete();
  const res = await window.api.deleteFiles(rest.map(f => f.path), permanent).catch(() => null);
  btn.disabled = false;
  if (!res) { toast('⚠️ Deletion failed'); return; }
  const deletedSet = new Set(res.deleted);
  window.api.deleteEmbeddings(rest.filter(f => deletedSet.has(f.path)).map(f => f.id)).catch(() => {});
  appData.files = appData.files.filter(f => !deletedSet.has(f.path));
  recordSpaceFreed(res.bytes);
  const survivor = appData.files.find(f => f.id === burstReviewSelectedId);
  if (survivor) survivor.burstCover = false; // no group left to be the cover of once the rest are gone
  await saveData();
  cancelDeleteConfirm();
  closeBurstReview();
  const freed = fmtSize(res.bytes);
  toast(permanent
    ? `🎞 Deleted ${res.deleted.length} photos - ${freed} freed`
    : `🎞 ${res.deleted.length} photos moved to Recycle Bin (${freed}) - empty it to free the space`, 5000);
  toastDeleteFailures(res);
}

// ── MEDIA POPUP ───────────────────────────────────────────────────────────────
// Accepts either a single file (timeline thumbnails) or a globe pin cluster
// { files: [...] } - several geotagged photos can land in the same map cell,
// and without paging through them the rest were invisible/unreachable from the map.
let popupClusterFiles = [];
let popupClusterIndex = 0;

async function openMediaPopup(fileOrCluster) {
  const isCluster = fileOrCluster.files && fileOrCluster.files.length;
  popupClusterFiles = isCluster ? fileOrCluster.files : [fileOrCluster];
  popupClusterIndex = isCluster && Number.isInteger(fileOrCluster.index) ? fileOrCluster.index : 0;
  await renderPopupFile();
}

// Double-click on a photo or video opens it browsable alongside every other photo/video
// currently in view (its folder/search/best-of results), so Prev/Next cycles through
// what's actually on screen instead of the OS viewer's real disk folder.
// Keeps the view's natural order and opens directly at the clicked file's own position
// (e.g. photo 200 of 400 opens as "200 of 400", not reshuffled to the front as "1 of 400").
function openMediaCluster(file) {
  const pool = currentViewImages.length ? currentViewImages : [file];
  const index = pool.findIndex(f => f.id === file.id);
  openMediaPopup({ files: pool, index: index >= 0 ? index : 0 });
}

function popupPrev() { popupClusterIndex = (popupClusterIndex - 1 + popupClusterFiles.length) % popupClusterFiles.length; renderPopupFile(); }
function popupNext() { popupClusterIndex = (popupClusterIndex + 1) % popupClusterFiles.length; renderPopupFile(); }

// Turns a local disk path into a file:// URL a <video>/<img> src can load directly -
// unlike thumbnails, videos are streamed straight off disk rather than routed through
// IPC as base64 (they can be gigabytes; the browser's own buffering/seeking needs a
// real streamable URL, not an in-memory blob). Keeps the drive letter's colon literal
// and percent-encodes every other path segment (spaces, #, unicode, etc.).
function pathToFileUrl(p) {
  let norm = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(norm)) norm = '/' + norm;
  return 'file://' + norm.split('/').map(seg => /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)).join('/');
}

async function renderPopupFile() {
  const file = popupClusterFiles[popupClusterIndex];
  if (!file) return;
  popupFileId = file.id;
  setPopupLoading(false); // a spinner left by the photo navigated away from
  const is360 = is360File(file);
  if (!is360 && v360.open) close360Viewer();
  popupResetZoom();
  const img = document.getElementById('photoPopupImg');
  const vid = document.getElementById('photoPopupVideo');
  const fallback = document.getElementById('photoVideoFallback');
  const wrap = document.getElementById('photoImgWrap');
  vid.pause();
  document.getElementById('photoPopupName').textContent = file.name;
  const camStr = file.cameraFolder || file.cameraMake || 'Unknown camera';
  const placeStr = file.country ? '· ' + countryFlag(file.countryCode) + ' ' + esc([file.city, file.region, file.country].filter(Boolean).join(', ')) : '';
  const gpsStr = file.gps ? `📍 ${file.gps.lat.toFixed(4)}°, ${file.gps.lng.toFixed(4)}° ${placeStr}<br>` : '';
  document.getElementById('photoPopupMeta').innerHTML =
    `${gpsStr}📷 ${esc(camStr)}<br>📅 ${fmtDate(file.fileDate||file.addedAt)} · ${fmtTime(file.fileDate||file.addedAt)} · ${fmtSize(file.size)}${file.notes?`<br>📝 ${esc(file.notes)}`:''}`;
  const nav = document.getElementById('photoClusterNav');
  if (popupClusterFiles.length > 1) {
    nav.style.display = 'flex';
    document.getElementById('photoClusterCount').textContent = `${isVid(file.ext)?'🎬':'🖼'} ${popupClusterIndex+1} of ${popupClusterFiles.length}`;
  } else {
    nav.style.display = 'none';
  }
  const editBtn = document.getElementById('popupEditPhotoBtn');
  if (editBtn) editBtn.style.display = isEditable(file.ext) ? '' : 'none';
  // A 360 file has the player's own Grab (view or whole sphere), and a CSS turn means nothing
  // on a sphere you can already look around.
  const grabBtn = document.getElementById('popupGrabBtn');
  if (grabBtn) grabBtn.style.display = isVid(file.ext) && !is360 ? '' : 'none';
  // Every video, 360 included (the menu hides "Use current frame" for 360 - see openThumbMenu).
  hideThumbMenu(); // it acts on one file - don't leave it open across next/prev
  const thumbBtn = document.getElementById('popupThumbBtn');
  if (thumbBtn) thumbBtn.style.display = isVid(file.ext) ? '' : 'none';
  const rotateBtn = document.getElementById('popupRotateBtn');
  if (rotateBtn) rotateBtn.style.display = is360 ? 'none' : '';
  renderPopupLinkage(file);
  renderPopupFolderChips(file);
  updatePopupBestOfBtn(file);
  document.getElementById('photoPopup').classList.add('open');

  // 360 footage plays in the interactive player that sits inside this same picture area
  // (viewer360.js) - drag to look around, angle lock, grabs - with everything else about the
  // preview unchanged.
  if (is360) {
    img.style.display = 'none'; img.src = '';
    vid.removeAttribute('src'); vid.load(); vid.style.display = 'none';
    fallback.style.display = 'none';
    wrap.classList.add('video-mode');
    document.getElementById('photoZoomHint').style.display = 'none';
    applyVideoRotation(0);
    open360Viewer(file);
    return;
  }

  if (isVid(file.ext)) {
    img.style.display = 'none';
    fallback.style.display = 'none';
    wrap.classList.add('video-mode');
    document.getElementById('photoZoomHint').style.display = 'none';
    vid.style.display = '';
    // Chromium can't play every container (AVI, WMV, MPG, MTS...) - and a codec it lacks, like
    // HEVC on a PC without the HEVC extension, often doesn't even raise an error: it plays the
    // sound over a black box. Both end on the Open-in-default-player panel, over the file's
    // thumbnail so it's still clear which video this is.
    const unplayable = () => {
      if (popupClusterFiles[popupClusterIndex] !== file) return;
      vid.pause();
      vid.style.display = 'none';
      fallback.style.display = 'flex';
      getThumb(file).then(url => { if (url && popupClusterFiles[popupClusterIndex] === file) fallback.style.backgroundImage = `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.55)), url("${url}")`; });
    };
    fallback.style.backgroundImage = '';
    vid.onerror = unplayable;
    vid.onloadedmetadata = () => { if (!vid.videoWidth) unplayable(); };
    vid.src = pathToFileUrl(file.path);
    vid.load();
    vid.play().catch(() => {}); // opened via a user gesture (double-click/button), so autoplay is allowed - swallow the rare rejection instead of an unhandled promise warning
    applyVideoRotation(file.rotation);
    prefetchPopupNeighbors();
    return;
  }
  applyVideoRotation(0); // reset the <video>'s rotation styling even while a photo is showing, so it's not stale next time a rotated video is opened

  wrap.classList.remove('video-mode');
  document.getElementById('photoZoomHint').style.display = '';
  vid.removeAttribute('src'); vid.style.display = 'none'; fallback.style.display = 'none';
  img.src=''; img.style.display='';
  // Show the cached thumb immediately so navigation feels instant, then upgrade in place to a
  // sharp preview once it's loaded - the blurry-to-sharp swap happens well under a user's notice
  // of "loading", instead of a blank/spinner wait. A spinner does come up if the sharp version
  // is slow (a HEIC decoded in software, a huge TIFF), after a delay so fast loads never flash it.
  const isCurrent = () => popupClusterFiles[popupClusterIndex] === file;
  const spinTimer = setTimeout(() => { if (isCurrent()) setPopupLoading(true); }, 300);
  const thumbUrl = await getThumb(file);
  if (!isCurrent()) { clearTimeout(spinTimer); return; } // navigated away already
  if (!thumbUrl) { img.style.display = 'none'; } else { img.src = thumbUrl; }
  if (isImg(file.ext)) {
    let previewUrl = await getPreviewImage(file);
    // No OS codec for it (AVIF or WebP on a bare Windows install, say): Chromium decodes those
    // itself, straight from the file. Not an edited photo: the file doesn't have its edits.
    if (!previewUrl && !file.edits && TroveMedia.BROWSER_IMAGE.has((file.ext || '').toLowerCase())) {
      const direct = pathToFileUrl(file.path);
      previewUrl = file.rotation ? await rotateDataUrl(direct, file.rotation) : direct;
    }
    if (previewUrl && popupClusterFiles[popupClusterIndex] === file) {
      img.src = previewUrl;
      img.style.display = '';
    }
  }
  clearTimeout(spinTimer);
  if (isCurrent()) setPopupLoading(false);
  prefetchPopupNeighbors();
}

function setPopupLoading(on) {
  document.getElementById('photoPopupLoading')?.classList.toggle('show', on);
}

// Warms the cache for the photos a Prev/Next click would land on, so browsing through a
// folder feels fast after the first photo instead of re-paying the load cost every click.
function prefetchPopupNeighbors() {
  if (popupClusterFiles.length < 2) return;
  const nextFile = popupClusterFiles[(popupClusterIndex + 1) % popupClusterFiles.length];
  const prevFile = popupClusterFiles[(popupClusterIndex - 1 + popupClusterFiles.length) % popupClusterFiles.length];
  [nextFile, prevFile].forEach(f => { if (f && isImg(f.ext)) getPreviewImage(f); });
}

// A rotated <video> can't be pre-baked into new pixels like a photo thumbnail (that would
// mean re-encoding it) - CSS-rotate it live instead. object-fit:contain only sizes against
// the element's OWN pre-transform box, so for 90°/270° the element is constrained against
// the wrap's swapped dimensions first, then rotated into the actual space it needs to fill.
function applyVideoRotation(rotation) {
  const vid = document.getElementById('photoPopupVideo');
  const wrap = document.getElementById('photoImgWrap');
  if (!vid || !wrap) return;
  rotation = ((rotation || 0) % 360 + 360) % 360;
  if (!rotation) {
    vid.style.transform = '';
    vid.style.maxWidth = '100%';
    vid.style.maxHeight = '100%';
    return;
  }
  const rect = wrap.getBoundingClientRect();
  const swap = rotation === 90 || rotation === 270;
  vid.style.maxWidth = (swap ? rect.height : rect.width) + 'px';
  vid.style.maxHeight = (swap ? rect.width : rect.height) + 'px';
  vid.style.transform = `rotate(${rotation}deg)`;
}
window.addEventListener('resize', () => {
  const file = popupClusterFiles[popupClusterIndex];
  if (file && isVid(file.ext) && document.getElementById('photoPopup').classList.contains('open')) applyVideoRotation(file.rotation);
});

// The preview's own ↻ button, for a video that turns out to be sideways. A video turns in
// place (CSS, see applyVideoRotation) so playback carries on where it was; a photo goes
// through rotateFile like the context menu's Rotate.
async function rotatePopupFile() {
  const file = appData.files.find(f => f.id === popupFileId);
  if (!file || !isMedia(file.ext)) return;
  if (!isVid(file.ext)) { await rotateFile(file.id); return; }
  bumpRotation(file);
  applyVideoRotation(file.rotation);
  await saveData();
}

// Press and hold on the left or right third of the video to watch at 2x, like YouTube; let go
// and it drops back to normal speed. A quick click still plays/pauses as usual, and the middle
// third and the controls bar are left alone.
const SPEED_HOLD_MS = 350;
function setupPopupVideoSpeedHold() {
  const vid = document.getElementById('photoPopupVideo');
  const badge = document.getElementById('photoSpeedBadge');
  if (!vid || !badge) return;
  let timer = 0, boosted = false, eatClick = false, wasPaused = false, prevRate = 1;
  const release = () => {
    clearTimeout(timer); timer = 0;
    if (!boosted) return;
    boosted = false; eatClick = true;
    vid.playbackRate = prevRate;
    badge.classList.remove('show');
    // Letting go also lands as a click, which the native controls read as play/pause.
    setTimeout(() => {
      eatClick = false;
      if (vid.paused !== wasPaused) (wasPaused ? vid.pause() : vid.play().catch(() => {}));
    }, 0);
  };
  vid.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const rect = vid.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const file = appData.files.find(f => f.id === popupFileId);
    const upright = !(file && file.rotation); // rotated, the controls bar is no longer at the bottom
    if ((x > 1 / 3 && x < 2 / 3) || (upright && e.clientY > rect.bottom - 56)) return;
    wasPaused = vid.paused;
    timer = setTimeout(() => {
      boosted = true;
      prevRate = vid.playbackRate || 1;
      vid.playbackRate = 2;
      if (vid.paused) vid.play().catch(() => {});
      badge.classList.add('show');
    }, SPEED_HOLD_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => vid.addEventListener(t, release));
  vid.addEventListener('click', e => { if (eatClick) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // Moving to another file mid-hold must not leave it stuck at 2x.
  vid.addEventListener('emptied', () => { clearTimeout(timer); boosted = false; vid.playbackRate = 1; badge.classList.remove('show'); });
}

// Bottom-right "photo linkage" chips - the original this file was edited from (if
// any) and any edited versions made from it (if any), so a linked pair can be
// browsed right from the popup without a separate modal. Only the parent chip
// carries an unlink control - it's the one pointer that actually lives on `file`.
function renderPopupLinkage(file) {
  const box = document.getElementById('photoLinkage');
  if (!box) return;
  if (!isMedia(file.ext)) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const parent = file.versionParentId ? appData.files.find(f => f.id === file.versionParentId) : null;
  const children = getVersionChildren(file.id);
  const chip = (f, tag, unlinkable) => `
    <div class="pl-chip" onclick="openVersionCompare('${f.id}')">
      <div class="pl-chip-thumb" data-thumb-for="${f.id}"><span class="thumb-icon">${getEmoji(f.ext)}</span></div>
      <div class="pl-chip-text">${tag}<b title="${esc(f.name)}">${esc(f.name)}</b></div>
      ${unlinkable ? `<span class="pl-chip-unlink" title="Unlink from this original" onclick="event.stopPropagation();popupUnlink('${file.id}')">✕</span>` : ''}
    </div>`;
  // Always offer a way to link, even with nothing linked yet - easy manual assignment
  // is the whole point, not just a readout of what the auto-scan already found.
  const linkBtn = !parent ? `<div class="pl-link-btn" onclick="openVersionPickModal('${file.id}')">🌿 Link to original…</div>` : '';
  const liveBtn = file.livePhotoVideoId ? `<div class="pl-link-btn" onclick="playLivePhoto('${file.id}')">◎ Play Live Photo</div>` : '';
  box.innerHTML = (parent ? chip(parent, '📷 Original: ', true) : '')
    + children.map(c => chip(c, '✏️ Edited: ', false)).join('')
    + linkBtn + liveBtn;
  box.style.display = 'flex';
  box.querySelectorAll('[data-thumb-for]').forEach(el => observeThumb(el));
}

// Where this file is filed, as a row of bubbles over the bottom of the picture - "Iceland 2025",
// "Dad", "Me", "FPV" - so where a photo belongs reads at a glance without opening Edit Props.
// Trips and adventures first, then people (each with their face, cropped from this very photo
// when Trove found it here), then everything else, then the
// file's tags. Clicking a folder's bubble opens that folder.
function renderPopupFolderChips(file) {
  const box = document.getElementById('photoFolderChips');
  if (!box) return;
  const rootOf = f => { let r = f; for (let hops = 0; r?.parentId && hops < 50; hops++) r = appData.folders.find(p => p.id === r.parentId) || null; return r; };
  const rank = f => { const r = rootOf(f)?.id; return r === VACATIONS_ROOT_ID || r === ADVENTURES_ROOT_ID ? 0 : r === PEOPLE_ROOT_ID ? 1 : 2; };
  const folders = [...new Set(file.folders || [])]
    .map(id => appData.folders.find(f => f.id === id))
    .filter(f => f && f.parentId) // a section root (People, Trips) says nothing on its own
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const shown = new Set(folders.map(f => f.name.toLowerCase()));
  const tags = [...new Set(file.tags || [])].filter(t => !shown.has(t.toLowerCase()));
  const chip = f => {
    const person = f.parentId === PEOPLE_ROOT_ID;
    const emoji = person ? '' : folderEmoji(f);
    const icon = person ? `<span class="pfc-face" data-person="${f.id}">${personPictureUrl(f) ? folderIconHtml(f, 18) : `<span class="pfc-dot" style="background:${f.color || '#3d6f8f'}"></span>`}</span>`
      : !person && f.iconImage ? folderIconHtml(f, 16)
      : emoji ? `<span class="pfc-emoji">${esc(emoji)}</span>`
      : `<span class="pfc-dot" style="background:${f.color || '#3d6f8f'}"></span>`;
    const year = formatTripYearSuffix(f).replace(/^ · /, '');
    const label = year && !f.name.includes(year.slice(0, 4)) ? `${f.name} ${year}` : f.name;
    return `<button class="pfc" onclick="popupOpenFolder('${f.id}')" title="Open ${esc(f.name)}">${icon}<span>${esc(label)}</span></button>`;
  };
  box.innerHTML = folders.map(chip).join('') + tags.map(t => `<span class="pfc pfc-tag" title="Tag">${esc(t)}</span>`).join('');
  box.style.display = folders.length || tags.length ? '' : 'none';
  // Swap in each person's face as it appears in this photo. Videos aren't scanned for faces, so
  // they keep the person's usual picture.
  if (isImg(file.ext)) facePhotoHeadshots(file.id).then(heads => {
    if (popupFileId !== file.id) return;
    for (const [pid, url] of heads) {
      const slot = box.querySelector(`[data-person="${pid}"]`);
      if (slot) slot.innerHTML = `<img src="${url}" alt="" style="width:18px;height:18px;border-radius:50%;object-fit:cover;vertical-align:middle">`;
    }
  });
}
function popupOpenFolder(folderId) {
  closePhotoPopup();
  selectFolder(folderId);
}

// Shows the currently-open popup file and the chip's linked file side by side, reusing the
// same before/after panel Find Edited already confirms new pairs with (editedPanelHtml) -
// which of the two is "Original" vs "Edited" is worked out from the actual versionParentId
// relationship between them, not just which chip was clicked, so this stays correct even
// when a photo has several edited children and any one of their chips is opened.
function openVersionCompare(otherId) {
  const current = popupClusterFiles[popupClusterIndex];
  const other = appData.files.find(f => f.id === otherId);
  if (!current || !other) return;
  const otherIsOriginal = current.versionParentId === other.id;
  const original = otherIsOriginal ? other : current;
  const edited = otherIsOriginal ? current : other;
  document.getElementById('versionCompareBody').innerHTML = `
    <div class="dup-compare-row" style="height:100%">
      ${editedPanelHtml(original, 'Original', edited.id, vcDeleteButton(original, 'original'))}
      ${editedPanelHtml(edited, 'Edited', original.id, vcDeleteButton(edited, 'edited version'))}
    </div>`;
  document.getElementById('versionCompareModal').classList.add('open');
  [original, edited].forEach(f => {
    getPreviewImage(f).then(url => {
      if (!url) return;
      const img = document.getElementById('edImg-' + f.id);
      if (img) img.src = url;
    });
  });
}
function closeVersionCompareModal() { document.getElementById('versionCompareModal').classList.remove('open'); }
// Keeping just one of the pair - usually the edit, sometimes the original - is the decision this
// side-by-side view exists for, so each photo gets its own delete right underneath it. It goes
// through the same Remove-or-Delete dialog as everywhere else (remove the shortcut, or delete the
// file itself, subject to the Settings switch), then the compare closes: half a pair has
// nothing left to compare.
function vcDeleteButton(f, what) {
  return `<button class="vc-delete-btn" onclick="vcDeleteVersion('${f.id}',event)" title="Remove this ${what} from Trove, or delete the file (Ctrl+click: delete permanently, no confirmation)">${peIconLead('trash')}Delete this ${what}…</button>`;
}
function vcDeleteVersion(fileId, e) {
  openRemoveOrDelete([fileId], () => {
    closeVersionCompareModal();
    // The popup underneath may still be showing the one that was kept, with a linkage chip
    // pointing at the one that just went.
    const shown = appData.files.find(f => f.id === popupFileId);
    if (shown && document.getElementById('photoPopup').classList.contains('open')) renderPopupLinkage(shown);
  }, e);
}

async function popupUnlink(fileId) {
  await unlinkVersion(fileId);
  const file = appData.files.find(f => f.id === fileId);
  if (file && popupClusterFiles[popupClusterIndex] === file) renderPopupLinkage(file);
}

// ── POPUP ZOOM / PAN ─────────────────────────────────────────────────────────
// Center-anchored scroll-wheel zoom + drag-to-pan (translate applied outside scale, so
// pan tracks the mouse 1:1 in screen pixels regardless of zoom level). Reset on every
// photo change (renderPopupFile) and on close so it never leaks between photos.
let popupZoom = 1;
let popupPanX = 0;
let popupPanY = 0;
let popupDragging = false;
let popupDragStart = null;

function popupApplyTransform() {
  const img = document.getElementById('photoPopupImg');
  const wrap = document.getElementById('photoImgWrap');
  if (!img || !wrap) return;
  img.style.transform = `translate(${popupPanX}px, ${popupPanY}px) scale(${popupZoom})`;
  wrap.classList.toggle('zoomed', popupZoom > 1);
}

function popupResetZoom() {
  popupZoom = 1; popupPanX = 0; popupPanY = 0; popupDragging = false; popupDragStart = null;
  popupApplyTransform();
  document.getElementById('photoImgWrap')?.classList.remove('panning');
}

function popupOnWheel(e) {
  const file = popupClusterFiles[popupClusterIndex];
  if (file && (isVid(file.ext) || is360File(file))) return; // let native video controls handle input instead of zooming
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  popupZoom = Math.min(5, Math.max(1, popupZoom * factor));
  if (popupZoom <= 1.02) { popupZoom = 1; popupPanX = 0; popupPanY = 0; }
  popupApplyTransform();
  popupMaybeLoadHires();
}

function popupOnDblClick(e) {
  const file = popupClusterFiles[popupClusterIndex];
  if (file && (isVid(file.ext) || is360File(file))) return;
  e.stopPropagation();
  if (popupZoom > 1) { popupZoom = 1; popupPanX = 0; popupPanY = 0; }
  else { popupZoom = 2.5; }
  popupApplyTransform();
  popupMaybeLoadHires();
}

// Past this zoom level the 1800px preview starts showing its limits - fetch the ~4000px
// render once per photo and swap it in without disturbing the current zoom/pan.
const hiresInFlight = new Set();
function popupMaybeLoadHires() {
  if (popupZoom <= 1.3) return;
  const file = popupClusterFiles[popupClusterIndex];
  // An edited photo's preview is already its full-size render (see getPreviewImage).
  if (!file || !isImg(file.ext) || file.edits || hiresCache[file.id] || hiresInFlight.has(file.id)) return;
  hiresInFlight.add(file.id);
  getHiresPreview(file).then(url => {
    hiresInFlight.delete(file.id);
    if (url && popupClusterFiles[popupClusterIndex] === file) {
      document.getElementById('photoPopupImg').src = url;
    }
  });
}

// Dragging the file out of the preview, so it can go into an editor, an email or Explorer without
// closing the preview first. It's the same OS drag a grid card hands over once it leaves the
// window (handFileDragToOs): the real file, never a copy. A press only turns into a drag once the
// mouse has moved a few pixels, so a click or a double-click to zoom still work as before.
const POPUP_FILE_DRAG_PX = 6;
let popupFileDragStart = null; // { x, y, file } between the press and the drag starting
function popupWatchFileDrag(e) {
  const file = popupClusterFiles[popupClusterIndex];
  if (!file || file._missing || e.button !== 0) return false;
  popupFileDragStart = { x: e.clientX, y: e.clientY, file };
  e.preventDefault();
  return true;
}
// The side panel's handle: works for every file, zoomed in or not, videos and 360 included.
function popupDragHandleDown(e) { popupWatchFileDrag(e); }

function popupOnMouseDown(e) {
  const file = popupClusterFiles[popupClusterIndex];
  if (file && (isVid(file.ext) || is360File(file))) return; // don't hijack clicks on the native video controls
  // Unzoomed, pressing on the photo itself starts a file drag; zoomed in, a drag pans instead.
  if (popupZoom <= 1 && e.target.id === 'photoPopupImg' && popupWatchFileDrag(e)) return;
  if (popupZoom <= 1 || (e.button !== 0 && e.button !== 1)) return; // left- or middle-drag pans
  popupDragging = true;
  popupDragStart = { x: e.clientX, y: e.clientY, panX: popupPanX, panY: popupPanY };
  document.getElementById('photoImgWrap').classList.add('panning');
  e.preventDefault();
}

function popupOnMouseMove(e) {
  const start = popupFileDragStart;
  if (start) {
    if (!(e.buttons & 1)) { popupFileDragStart = null; return; } // released outside the window
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < POPUP_FILE_DRAG_PX) return;
    popupFileDragStart = null;
    window.api.startFileDrag([start.file.path], start.file.id);
    return;
  }
  if (!popupDragging) return;
  popupPanX = popupDragStart.panX + (e.clientX - popupDragStart.x);
  popupPanY = popupDragStart.panY + (e.clientY - popupDragStart.y);
  popupApplyTransform();
}

function popupOnMouseUp() {
  popupFileDragStart = null;
  if (!popupDragging) return;
  popupDragging = false;
  document.getElementById('photoImgWrap')?.classList.remove('panning');
}

// Keep backward compat for globe
const openGlobePopup = openMediaPopup;

function closePhotoPopup() {
  hideThumbMenu();
  if (v360.open) close360Viewer();
  document.getElementById('photoPopup').classList.remove('open');
  setPopupLoading(false);
  const vid = document.getElementById('photoPopupVideo');
  vid.pause(); vid.removeAttribute('src'); vid.load(); // stop playback/buffering, don't leave audio running behind the closed popup
  popupFileId=null; popupClusterFiles=[]; popupClusterIndex=0; popupResetZoom();
}
function openPopupFile() { if(popupFileId) openFileById(popupFileId); }
function renamePopupFile() { if (popupFileId) startInlineFileRename(popupFileId, document.getElementById('photoPopupName')); }
async function revealPopupFile() { const f=appData.files.find(f=>f.id===popupFileId); if(f) await window.api.showInFolder(f.path); }
// popupFileId is reset to null by closePhotoPopup() - it must be captured into a
// local before calling that, or showEditModal() below would be called with null
// and silently no-op (the bug: the popup closed but Edit Props never opened).
function editPopupFile() { if(!popupFileId) return; const id = popupFileId; stashPopupReturn(); closePhotoPopup(); showEditModal(id); }

// Editing from the preview (Edit Photo, PhotoMod, Edit Props) comes back to the preview on the
// same photo with the same Prev/Next list, instead of dropping you back in the folder.
let popupReturn = null;
function stashPopupReturn() {
  popupReturn = popupClusterFiles.length ? { ids: popupClusterFiles.map(f => f.id), index: popupClusterIndex } : null;
}
function resumePopupReturn() {
  const r = popupReturn;
  popupReturn = null;
  if (!r) return;
  const byId = new Map(appData.files.map(f => [f.id, f]));
  const files = r.ids.map(id => byId.get(id)).filter(Boolean);
  if (!files.length) return;
  let index = files.findIndex(f => f.id === r.ids[r.index]);
  if (index < 0) index = Math.min(r.index, files.length - 1);
  openMediaPopup({ files, index });
}

async function togglePopupBestOf() {
  const file = appData.files.find(f => f.id === popupFileId);
  if (!file) return;
  file.bestOf = !file.bestOf;
  await saveData();
  updatePopupBestOfBtn(file);
  toast(file.bestOf ? '⭐ Added to Best Of' : '☆ Removed from Best Of');
}

function updatePopupBestOfBtn(file) {
  const btn = document.getElementById('popupBestOfBtn');
  if (!btn) return;
  btn.textContent = file.bestOf ? '⭐ Best Of' : '☆ Add to Best Of';
  btn.style.color = file.bestOf ? 'var(--gold)' : '';
}

// Deletes the currently-viewed popup photo from the actual hard drive (reusing the
// same window.api.deleteFiles()/confirm pattern as Duplicate Detection and Burst Review),
// then advances the popup to whatever slid into its slot instead of closing it -
// so paging through a folder and deleting duds along the way keeps flowing.
function deletePopupFile(e) {
  const file = appData.files.find(f => f.id === popupFileId);
  if (!file) return;
  // Same one-button-two-outcomes dialog as the grid. No close-on-done here: both outcomes run
  // syncPopupClusterAfterRemoval(), which steps the viewer on to the next photo (or closes it
  // when none are left) - closing here as well threw you back to the folder every time.
  openRemoveOrDelete([file.id], null, e);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
// Message type is inferred from its leading emoji (already a consistent convention
// across call sites) so semantic color is applied without touching every call site.
const TOAST_TYPE_ICONS = { success:'✅', danger:'⚠️', info:['ℹ️','📍'] };
function toastType(msg){
  for (const [type,icons] of Object.entries(TOAST_TYPE_ICONS))
    if ([].concat(icons).some(icon=>msg.startsWith(icon))) return type;
  return null;
}
function toast(msg,ms=2500){
  const c=document.getElementById('toast'),el=document.createElement('div');
  const type=toastType(msg);
  el.className='toast-item'+(type?` toast-${type}`:'');
  el.textContent=msg;c.appendChild(el);setTimeout(()=>el.remove(),ms);
}

// ── GUIDED SORT WIZARD ───────────────────────────────────────────────────────
// Walks the To Sort batch through: trip, then people, then category, then
// camera, then location - each step skippable and cancelable at any point.
// Never touches toSort itself except on the final "mark as sorted"
// confirmation; folder membership changes made along the way are kept even
// if the wizard is exited early, since each round is saved as soon as it's
// confirmed.
//
// Every step keeps the full photo grid on screen the whole time (with a
// per-card preview button) rather than asking "who is this?" before showing
// any photos - the point of a dump-everything-then-sort workflow is that
// nobody remembers who/what/where in a given file until they can see it.
const PEOPLE_ROOT_ID = 'people-root';
const VACATIONS_ROOT_ID = 'vacations-root';
// Adventures are Trips' sibling: the memorable days that aren't travel (a trek near home, a
// festival, a day on the water). Same shape as a trip - a direct child of its own root, with
// optional dates - so every trip feature (map markers, carousel, Relive, Best Of filter) takes
// them by walking getTripLikeFolders() instead of the Vacations root alone. On the map their
// photos are round where a trip's are square (see roundPinIds in initGlobe / globe.js).
const ADVENTURES_ROOT_ID = 'adventures-root';
const ADVENTURE_COLOR = '#f97316';
const TRIP_LIKE_ROOT_IDS = [VACATIONS_ROOT_ID, ADVENTURES_ROOT_ID];
const CATEGORY_ROOT_NAME = 'Categories'; // matched by name, not id - see getOrCreateCategoryRoot
let gsOpen = false;
let gsStep = 'start'; // one of gsStepList(), or 'done'
let gsContentSuggestions = null; // {folderMatches, newClusters} for the current 'content' step batch, null until computed
let gsContentLoading = false;
let gsContentResolvedIds = new Set(); // fileIds already filed by this step this session, hidden from re-suggestion
let gsBatch = []; // file ids snapshotted when the wizard opened
let gsNamePromptKind = null; // 'person' | 'camera' | 'trip' | 'adventure' | 'category' | 'folder', while #gsNameModal is open
let gsBarUpdater = null; // refreshes the current step's bottom-bar count/button state on every card click
let gsPickMode = false; // true while the location step's globe + left-panel picker is open
let gsKinds = { trip: false, adventure: false, everyday: false }; // step 1's answers - decide which steps run
let gsPickedIds = [];      // trips/adventures chosen in the Pick step
let gsPickSeeded = false;  // date-overlapping ones get pre-ticked once per session, not on every re-render
let gsDateMatches = null;  // [{folderId, fileIds, undone}] filed automatically by date in the Dates step
let gsDateMatchKey = null; // which picks gsDateMatches was computed for - re-run only when they change
let gsOutsideDismissed = new Set(); // "not part of any trip or adventure" answers
let gsActiveTarget = null; // folder id being painted in the People/Folders steps, or null
let gsCardHooks = null;    // per-step card behaviour for gsAppendCards (see gsPaintHooks)
let gsFolderPanelOpen = false;

// Quick-add starter categories - offered as one-tap chips wherever categories are created
// (sidebar Categories section, the wizard's category step, Guided Sort's category step)
// so most people never need to type a category name at all.
const STARTER_CATEGORIES = [
  { name: 'Wildlife', icon: '🦁' }, { name: 'Sports', icon: '🏃' }, { name: 'Cars', icon: '🚗' },
  { name: 'Food', icon: '🍔' }, { name: 'Family & Friends', icon: '👨‍👩‍👧' }, { name: 'Pets', icon: '🐾' },
  { name: 'Screenshots', icon: '📱' }, { name: 'Events', icon: '🎉' }, { name: 'Nature & Landscape', icon: '🏔️' },
  { name: 'Selfies', icon: '🤳' }, { name: 'Edited', icon: '✨' },
];
// The 6 pre-created on first launch so Categories never looks empty - the rest stay
// one tap away via the "+ New…" quick-add picker instead of cluttering the sidebar.
const SEED_CATEGORY_NAMES = ['Wildlife', 'Sports', 'Family & Friends', 'Food', 'Pets', 'Events', 'Edited'];

// A trip's display label never includes the year in `name` (that's the whole point of
// splitting name/dates apart) - this appends it back on for display only, wherever a
// trip's full label is shown (sidebar, globe carousel, trip popup).
function formatTripYearSuffix(folder) {
  if (!folder || !folder.dateStart) return '';
  const y1 = new Date(folder.dateStart).getFullYear();
  const y2 = folder.dateEnd ? new Date(folder.dateEnd).getFullYear() : y1;
  return y1 === y2 ? ` · ${y1}` : ` · ${y1}–${y2}`;
}
function formatDateRangeShort(start, end) {
  if (!start) return '';
  const opts = { month: 'short', day: 'numeric' };
  const s = new Date(start).toLocaleDateString('en-US', opts);
  if (!end || new Date(end).toDateString() === new Date(start).toDateString()) return s;
  const e = new Date(end).toLocaleDateString('en-US', opts);
  return `${s} – ${e}`;
}

function getOrCreatePeopleRoot() {
  let root = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  if (!root) { root = { id: PEOPLE_ROOT_ID, name: 'People', icon: '🧑', color: '#ec4899', parentId: null }; appData.folders.push(root); }
  return root;
}
function getOrCreatePersonFolder(name) {
  const root = getOrCreatePeopleRoot();
  let f = appData.folders.find(f => f.parentId === root.id && f.name.toLowerCase() === name.toLowerCase());
  if (!f) { f = { id: 'person-'+name.replace(/\s+/g,'-').toLowerCase()+'-'+Date.now().toString(36), name, color: '#ec4899', parentId: root.id }; appData.folders.push(f); }
  return f;
}
// Trips are direct children of the Vacations root (also used by the globe's trip
// markers/carousel - see getTripColorForFile/buildTripMarkers above), so a trip
// picked or created here shows up everywhere else trips do, not just in this wizard.
function getOrCreateVacationsRoot() {
  let root = appData.folders.find(f => f.id === VACATIONS_ROOT_ID);
  if (!root) { root = { id: VACATIONS_ROOT_ID, name: 'Vacations', icon: '✈️', color: '#06b6d4', parentId: null }; appData.folders.push(root); }
  return root;
}
function getOrCreateAdventuresRoot() {
  let root = appData.folders.find(f => f.id === ADVENTURES_ROOT_ID);
  if (!root) { root = { id: ADVENTURES_ROOT_ID, name: 'Adventures', icon: '🧭', color: ADVENTURE_COLOR, parentId: null }; appData.folders.push(root); }
  return root;
}
const isTripLikeRootId = id => TRIP_LIKE_ROOT_IDS.includes(id);
const isAdventureFolder = f => f?.parentId === ADVENTURES_ROOT_ID;
// Every trip and adventure (direct children of either root), trips first.
function getTripLikeFolders() {
  return TRIP_LIKE_ROOT_IDS.flatMap(rootId => appData.folders.filter(f => f.parentId === rootId));
}
// A trip or adventure plus everything nested under it, for "which trip/adventure is this file in".
function getTripLikeDescendantIds() {
  return new Set(getTripLikeFolders().flatMap(t => [t.id, ...getAllDesc(t.id)]));
}
// The trip or adventure a folder sits under (the folder itself if it is one), or null.
function tripLikeAncestorOf(folderId) {
  return buildBreadcrumb(folderId).find(f => isTripLikeRootId(f.parentId)) || null;
}

function getOrCreateTripFolder(name, dateStart, dateEnd) {
  const root = getOrCreateVacationsRoot();
  let f = appData.folders.find(f => f.parentId === root.id && f.name.toLowerCase() === name.toLowerCase());
  if (!f) {
    f = { id: 'trip-'+name.replace(/\s+/g,'-').toLowerCase()+'-'+Date.now().toString(36), name, color: '#06b6d4', parentId: root.id, dateStart: dateStart || null, dateEnd: dateEnd || null };
    appData.folders.push(f);
  } else if (dateStart && !f.dateStart) {
    // Reusing an existing trip that didn't have dates yet (e.g. picked from the chip row) - fill them in rather than discarding what was entered.
    f.dateStart = dateStart; f.dateEnd = dateEnd || null;
  }
  return f;
}
// A catch-all for whatever loose categories someone actually uses (wildlife,
// activities, a specific car, food, selfies - anything) - unlike People/Trips,
// there's no fixed set of subfolders, so this is matched by name rather than a
// hardcoded id: an existing top-level "Categories" folder (however it was made)
// is reused as-is, subfolders and all, rather than starting a second, disconnected
// root next to it.
function getOrCreateCategoryRoot() {
  let root = appData.folders.find(f => !f.parentId && f.name.toLowerCase() === CATEGORY_ROOT_NAME.toLowerCase());
  if (!root) { root = { id: 'categories-root-'+Date.now().toString(36), name: CATEGORY_ROOT_NAME, icon: '🏷️', color: '#10b981', parentId: null }; appData.folders.push(root); }
  return root;
}
function getOrCreateCategoryFolder(name) {
  const root = getOrCreateCategoryRoot();
  let f = appData.folders.find(f => f.parentId === root.id && f.name.toLowerCase() === name.toLowerCase());
  if (!f) { f = { id: 'cat-'+name.replace(/\s+/g,'-').toLowerCase()+'-'+Date.now().toString(36), name, icon: '🏷️', color: '#10b981', parentId: root.id }; appData.folders.push(f); }
  return f;
}
// A subfolder one level under a top-level category (e.g. "Hiking" under "Activity") - used by
// Guided Sort's Folders step (the + on a folder in its Add to folder panel) so a new subfolder
// lands inside it instead of always adding another top-level category.
function getOrCreateCategorySubfolder(parentId, name) {
  let f = appData.folders.find(f => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase());
  if (!f) { f = { id: 'cat-'+name.replace(/\s+/g,'-').toLowerCase()+'-'+Date.now().toString(36), name, icon: '🏷️', color: '#10b981', parentId }; appData.folders.push(f); }
  return f;
}
// Returns the name actually used - an existing camera's spelling if the typed one means it.
async function guidedAssignCamera(fileIds, cameraName) {
  const name = resolveCameraName(cameraName);
  const files = fileIds.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  files.forEach(f => { f.cameraFolder = name; f.cameraMake = name; });
  await autoCreateCameraFolders(files);
  return name;
}

// ── SORT COUNTS ──────────────────────────────────────────────────────────────
// How many duplicates and unlinked edits are waiting, for the Sort menu's badge - worked out in
// the background with the very same matching the screen runs (computeMatchGroups), so the
// badge never promises something the screen won't show. The slow
// part - a fingerprint per photo, a length per video - is saved (match-cache.json in main.js),
// so after the first run a recount is only comparisons.
let sortCounts = { dups: null }; // groups on the Find Duplicates & Edits screen
let sortCountToken = 0, sortCountTimer = null;

// Unasked-for work goes one file per idle moment, and waits while Trove is in the background.
function sortCountYield() {
  return new Promise(resolve => {
    const go = () => (window.requestIdleCallback ? requestIdleCallback(() => resolve(), { timeout: 1000 }) : setTimeout(resolve, 50));
    if (typeof appFocused === 'undefined' || appFocused) { go(); return; }
    const wait = setInterval(() => { if (appFocused) { clearInterval(wait); go(); } }, 1000);
  });
}
function scheduleSortCounts(delay) {
  clearTimeout(sortCountTimer);
  sortCountTimer = setTimeout(runSortCounts, delay ?? 10000);
}
async function runSortCounts() {
  const token = ++sortCountToken;
  const isStale = () => token !== sortCountToken;
  const groups = await computeMatchGroups({ background: true, isStale }).catch(() => null);
  if (!groups || isStale()) return;
  sortCounts.dups = groups.length;
  updateSortButton();
  saveMatchCache();
}

async function loadMatchCache() {
  const j = await window.api.matchCacheLoad().catch(() => null);
  if (!j) return;
  const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  for (const [id, e] of Object.entries(j.fp || {})) if (!dupFingerprintCache.has(id)) dupFingerprintCache.set(id, { hash: dec(e.h), color: dec(e.c), size: e.s });
  for (const [id, e] of Object.entries(j.dur || {})) if (!dupDurationCache.has(id)) dupDurationCache.set(id, { duration: e.d, size: e.s });
}
function saveMatchCache() {
  const live = new Set(appData.files.map(f => f.id)); // files that left the library are dropped here
  const enc = u => btoa(String.fromCharCode(...u));
  const fp = {}, dur = {};
  for (const [id, e] of dupFingerprintCache) if (live.has(id)) fp[id] = { h: enc(e.hash), c: enc(e.color), s: e.size };
  for (const [id, e] of dupDurationCache) if (live.has(id)) dur[id] = { d: e.duration, s: e.size };
  window.api.matchCacheSave(JSON.stringify({ v: 1, fp, dur })).catch(() => {});
}
// Badges stop at 9+: past that the exact number doesn't change what you'd do.
function sortBadgeText(n) { return n > 9 ? '9+' : String(n); }

// ── SORT MENU ────────────────────────────────────────────────────────────────
// One button in the top bar for every job that tidies the library up, instead of a button each.
// Its badge counts the people found in photos who aren't in People yet (see faceReviewGroups).
function sortMenuItems() {
  const toSort = appData.files.filter(f => f.toSort && !f.isLivePhotoVideo).length;
  const faces = typeof faceRecognitionEnabled === 'function' && faceRecognitionEnabled();
  const people = typeof faceReviewCount === 'number' ? faceReviewCount : 0;
  return [
    { icon: peIcon('faceScan'), title: 'Find new people', sub: !faces ? 'Find the people in your photos who aren\'t in People yet' : people ? `${people} to look at: people not in People yet, or missing from photos` : 'Everyone in your photos is in People', badge: faces && people, run: 'openFacesMode()' },
    { icon: '📥', title: 'Sort the To Sort pile', sub: toSort ? `${toSort} photo${toSort === 1 ? '' : 's'} waiting, a question at a time` : 'Nothing waiting', badge: toSort, run: 'enterGuidedSort()' },
    { icon: peIcon('copy'), title: 'Find duplicates & edits', badge: sortCounts.dups,
      sub: sortCounts.dups ? `${sortCounts.dups} to look at: copies to clear out or edits to link` : sortCounts.dups === 0 ? 'No duplicates, and every edit is linked' : 'The same photo twice, or an edit and its original: delete one or link them', run: 'enterDupDetection()' },
  ];
}
function toggleSortMenu(e) {
  e?.stopPropagation();
  const menu = document.getElementById('sortMenu');
  if (menu.classList.contains('open')) { closeSortMenu(); return; }
  menu.innerHTML = sortMenuItems().map((it, i) => `
    <button class="sort-menu-item" onclick="closeSortMenu();${it.run}">
      <span class="sort-menu-icon">${it.icon}</span>
      <span class="sort-menu-text"><b>${it.title}</b><span>${it.sub}</span></span>
      ${it.badge ? `<span class="sort-menu-badge">${sortBadgeText(it.badge)}</span>` : ''}
    </button>`).join('');
  const btn = document.getElementById('sortMenuBtn').getBoundingClientRect();
  menu.style.top = (btn.bottom + 6) + 'px';
  menu.style.right = Math.max(8, window.innerWidth - btn.right) + 'px';
  menu.classList.add('open');
}
function closeSortMenu() { document.getElementById('sortMenu')?.classList.remove('open'); }
document.addEventListener('click', closeSortMenu); // anywhere outside it (the menu itself stops clicks from reaching here)
// The top button's badge: everything the menu has waiting, added up - one small nudge to go
// and clean up.
function updateSortButton() {
  const badge = document.getElementById('sortMenuBadge');
  if (!badge) return;
  const n = sortMenuItems().reduce((sum, it) => sum + (Number(it.badge) || 0), 0);
  badge.textContent = sortBadgeText(n);
  badge.style.display = n ? '' : 'none';
  const menu = document.getElementById('sortMenu');
  if (menu?.classList.contains('open')) { menu.classList.remove('open'); toggleSortMenu(); } // keep an open menu's numbers live
}

function enterGuidedSort() {
  gsBatch = appData.files.filter(f => f.toSort && !f.isLivePhotoVideo).map(f => f.id);
  if (!gsBatch.length) { toast('📥 Nothing left to sort'); return; }
  gsOpen = true;
  gsStep = 'start';
  gsKinds = { trip: false, adventure: false, everyday: false };
  gsPickedIds = [];
  gsPickSeeded = false;
  gsDateMatches = null;
  gsDateMatchKey = null;
  gsOutsideDismissed = new Set();
  gsActiveTarget = null;
  gsCardHooks = null;
  gsContentSuggestions = null;
  gsContentLoading = false;
  gsContentResolvedIds = new Set();
  clearSelection();
  document.getElementById('guidedSort').classList.add('open');
  renderGuidedSortStep();
}
function exitGuidedSort() {
  gsFlushSave();
  gsCloseMenus();
  gsOpen = false;
  gsCardHooks = null;
  gsActiveTarget = null;
  clearSelection();
  document.getElementById('guidedSort').classList.remove('open');
}
function gsFiles() {
  return gsBatch.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
}
function gsAdvanceStep(next) {
  gsFlushSave();
  gsCloseMenus();
  gsStep = next;
  gsActiveTarget = null;
  gsCardHooks = null;
  clearSelection();
  renderGuidedSortStep();
}

// Which steps this batch goes through - the trip steps only when step 1 said trip/adventure.
function gsStepList() {
  const steps = ['start'];
  if (gsKinds.trip || gsKinds.adventure) steps.push('pick', 'dates');
  steps.push('people', 'folders', 'content', 'camera', 'location');
  return steps;
}
const GS_STEP_TITLES = { start: 'Where from', pick: 'Trips & adventures', dates: 'Check dates', people: 'People', folders: 'Folders', content: 'Auto-Group', camera: 'Cameras', location: 'Location' };
function gsStepLabel(step = gsStep) {
  const list = gsStepList();
  return `Step ${list.indexOf(step) + 1} of ${list.length} - ${GS_STEP_TITLES[step]}.`;
}
function gsNextStep(step = gsStep) {
  const list = gsStepList();
  return list[list.indexOf(step) + 1] || 'done';
}

// ── Overall batch progress (shown as a % in the topbar) ────────────────────
// Steps already passed count as fully done; the step currently open contributes the share of
// the batch that already has what it asks for, so the bar creeps forward while tagging.
function gsStepCompletionFraction(step) {
  const files = gsFiles();
  if (!files.length) return 1;
  const inAny = ids => f => f.folders?.some(id => ids.has(id));
  if (step === 'start' || step === 'pick') return 0;
  if (step === 'dates') { const t = getTripLikeDescendantIds(); return files.filter(f => inAny(t)(f) || gsOutsideDismissed.has(f.id)).length / files.length; }
  if (step === 'people') return files.filter(inAny(gsPeopleIds())).length / files.length;
  if (step === 'folders' || step === 'content') return files.filter(inAny(gsOtherFolderIds())).length / files.length;
  if (step === 'camera') return files.filter(f => f.cameraFolder).length / files.length;
  if (step === 'location') return files.filter(f => f.gps).length / files.length;
  return 0;
}
function gsProgressPercent() {
  if (gsStep === 'done') return 100;
  const list = gsStepList();
  const idx = list.indexOf(gsStep);
  if (idx < 0) return 0;
  return Math.round(((idx + gsStepCompletionFraction(gsStep)) / list.length) * 100);
}

function gsStepsHtml(pct) {
  const list = gsStepList();
  const cur = list.indexOf(gsStep);
  const dots = list.map((s, i) => `<span class="gs-step-dot${s === gsStep ? ' active' : ''}${i < cur || gsStep === 'done' ? ' done' : ''}" title="${GS_STEP_TITLES[s]}"></span>`).join('');
  return `<span class="gs-pct">${pct}% sorted</span>${dots}`;
}
function renderGuidedSortStep() {
  const pct = gsProgressPercent();
  document.getElementById('gsSteps').innerHTML = gsStepsHtml(pct);
  const fill = document.getElementById('gsProgressFill');
  if (fill) fill.style.width = pct + '%';
  if (gsStep === 'start') renderGsStartStep();
  else if (gsStep === 'pick') renderGsPickStep();
  else if (gsStep === 'dates') renderGsDatesStep();
  else if (gsStep === 'people') renderGsPeopleStep();
  else if (gsStep === 'folders') renderGsFoldersStep();
  else if (gsStep === 'content') renderGsContentStep();
  else if (gsStep === 'camera') renderGsCameraStep();
  else if (gsStep === 'location') renderGsLocationStep();
  else renderGsDoneStep();
}

// Cards behave as a plain add/remove-from-selection checklist (no ctrl/shift
// needed) - the normal library's handleCardClick treats a bare click as
// "replace selection with just this file," which fights the wizard's whole
// point of quickly multi-selecting many photos in a row.
function gsAppendCards(files, container) {
  for (const file of files) {
    const isSel = selectedIds.has(file.id);
    const card = document.createElement('div');
    card.className = 'file-card' + (isSel ? ' selected' : '');
    card.dataset.fileId = file.id;
    card.innerHTML = `
      <div class="sel-check">✓</div>
      <button class="gs-preview-btn" title="View larger">🔍</button>
      ${badge360Html(file)}
      <div class="file-card-thumb${isMedia(file.ext)?' thumb-loading':''}" data-thumb-for="${file.id}">
        <span class="thumb-icon">${getEmoji(file.ext)}</span>
        ${isVid(file.ext)?'<div class="video-badge">▶ VIDEO</div>':''}
      </div>
      <div class="gs-card-tags"></div>
      <div class="file-card-body">
        <div class="file-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
      </div>`;
    gsDecorateCard(card, file);
    card.addEventListener('click', () => {
      if (gsCardHooks?.click && gsCardHooks.click(file, card)) return;
      if (selectedIds.has(file.id)) selectedIds.delete(file.id); else selectedIds.add(file.id);
      // Through updateSelectionUI, not a class toggle of its own: that's what keeps track of
      // which cards are highlighted, so clearing the selection later (after filing, or Escape)
      // un-highlights them too. A card toggled on its own stayed looking selected.
      updateSelectionUI();
      if (typeof gsBarUpdater === 'function') gsBarUpdater();
    });
    // Double-click opens the same larger preview as the 🔍 button - the button stays for
    // touch/trackpad use, this is just a faster path so scanning a big batch doesn't mean
    // hunting for a tiny icon on every card.
    card.addEventListener('dblclick', () => openMediaPopup(file));
    card.querySelector('.gs-preview-btn').addEventListener('click', e => { e.stopPropagation(); openMediaPopup(file); });
    container.appendChild(card);
    if (isMedia(file.ext)) { const thumbEl = card.querySelector('[data-thumb-for]'); if (thumbEl) gsObserveThumb(thumbEl); }
  }
}
// Applies the current step's hooks to one card: an outline when it's in the painted target,
// and small tags for what it's already filed under in this step's scope.
function gsDecorateCard(card, file) {
  const h = gsCardHooks;
  card.classList.toggle('gs-in-target', !!(h?.inTarget && h.inTarget(file)));
  card.classList.toggle('gs-painting', !!gsActiveTarget);
  const tagsEl = card.querySelector('.gs-card-tags');
  if (!tagsEl) return;
  const tags = h?.tags ? h.tags(file) : [];
  tagsEl.innerHTML = tags.slice(0, 2).map(t => `<span>${esc(t)}</span>`).join('') + (tags.length > 2 ? `<span>+${tags.length - 2}</span>` : '');
}
function gsRenderGrid(files) {
  const wrap = document.createElement('div');
  wrap.className = 'gs-grid-wrap';
  if (!files.length) {
    wrap.innerHTML = `<div class="gs-empty"><div style="font-size:40px">✨</div><div>Nothing left here</div></div>`;
    return wrap;
  }
  const grid = document.createElement('div');
  grid.className = 'files-grid';
  wrap.appendChild(grid);
  gsAppendCards(files, grid);
  return wrap;
}

let gsNamePromptContext = 'guided'; // 'guided' | 'firstrun' - which wizard's tag/re-render functions to call on submit
// The Folders step's "+" (new subfolder) reuses the same prompt, and remembers the parent here.
let gsNamePromptParentId = null;
function gsOpenNamePrompt(kind, context) {
  gsNamePromptKind = kind;
  gsNamePromptContext = context || 'guided';
  const titles = { person: 'New person', camera: 'New camera', trip: 'New trip', adventure: 'New adventure', category: 'New category', folder: 'New folder' };
  const placeholders = { person: 'Their name…', camera: 'Camera name…', trip: 'Trip name…', adventure: 'Adventure name… (e.g. Ridge trek)', category: 'Category name…', folder: 'Folder name…' };
  const parent = kind === 'folder' && gsNamePromptParentId ? appData.folders.find(f => f.id === gsNamePromptParentId) : null;
  document.getElementById('gsNameTitle').textContent = parent ? `New folder in ${parent.name}` : titles[kind];
  const input = document.getElementById('gsNameInput');
  input.value = '';
  input.placeholder = placeholders[kind];
  const dated = kind === 'trip' || kind === 'adventure';
  const label = document.getElementById('gsNameDatesLabel');
  label.style.display = dated ? '' : 'none';
  label.textContent = `When was this ${kind}? Photos taken in these dates get added automatically.`;
  document.getElementById('gsNameDatesRow').style.display = dated ? '' : 'none';
  // Pre-filled with the batch's own date range - usually exactly the trip, and easy to trim.
  const range = dated && gsOpen ? gsBatchDateRange() : null;
  const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  document.getElementById('gsNameDateStart').value = range ? ymd(range.start) : '';
  document.getElementById('gsNameDateEnd').value = range ? ymd(range.end) : '';
  document.getElementById('gsNameModal').classList.add('open');
  setTimeout(() => input.focus(), 60);
}
function gsCancelNamePrompt() {
  document.getElementById('gsNameModal').classList.remove('open');
  gsNamePromptKind = null;
  gsNamePromptParentId = null;
}
function getOrCreateAdventureFolder(name, dateStart, dateEnd) {
  const root = getOrCreateAdventuresRoot();
  let f = appData.folders.find(f => f.parentId === root.id && f.name.toLowerCase() === name.toLowerCase());
  if (!f) {
    f = { id: 'adv-' + name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now().toString(36), name, color: ADVENTURE_COLOR, parentId: root.id, dateStart: dateStart || null, dateEnd: dateEnd || null };
    appData.folders.push(f);
  } else if (dateStart && !f.dateStart) { f.dateStart = dateStart; f.dateEnd = dateEnd || null; }
  return f;
}
async function gsSubmitNamePrompt() {
  const name = document.getElementById('gsNameInput').value.trim();
  if (!name) return;
  document.getElementById('gsNameModal').classList.remove('open');
  const kind = gsNamePromptKind;
  const context = gsNamePromptContext;
  gsNamePromptKind = null;
  const wizard = context === 'firstrun';
  if (kind === 'person') {
    const folder = getOrCreatePersonFolder(name);
    if (wizard) { frTagSelectedToPerson(folder.id, folder.name); return; }
    if (!(await gsFileSelectionInto(folder.id))) { gsActiveTarget = folder.id; await saveData(); }
    renderGsPeopleChipsAndCards();
  } else if (kind === 'camera') {
    gsTagSelectedToCamera(name);
  } else if (kind === 'trip' || kind === 'adventure') {
    const s = document.getElementById('gsNameDateStart').value;
    const e = document.getElementById('gsNameDateEnd').value;
    const ds = s ? new Date(s + 'T00:00:00').getTime() : null, de = e ? new Date(e + 'T00:00:00').getTime() : null;
    const folder = kind === 'trip' ? getOrCreateTripFolder(name, ds, de) : getOrCreateAdventureFolder(name, ds, de);
    if (!gsPickedIds.includes(folder.id)) gsPickedIds.push(folder.id);
    if (gsStep === 'dates' && selectedIds.size) { await gsAddSelectedToTripLike(folder.id); return; }
    await saveData();
    toast(`${kind === 'trip' ? '✈️' : '🧭'} "${folder.name}" created`);
    renderGuidedSortStep();
  } else if (kind === 'category') {
    const folder = getOrCreateCategoryFolder(name);
    if (wizard) frTagSelectedToCategory(folder.id, folder.name);
  } else if (kind === 'folder') {
    const parentId = gsNamePromptParentId;
    gsNamePromptParentId = null;
    const folder = parentId ? getOrCreateCategorySubfolder(parentId, name) : getOrCreateCategoryFolder(name);
    if (!(await gsFileSelectionInto(folder.id))) { gsActiveTarget = folder.id; await saveData(); }
    gsRenderFolderBar(); gsRefreshCards(); if (typeof gsBarUpdater === 'function') gsBarUpdater();
  }
}

// ── Guided Sort: the question-first flow ────────────────────────────────────
// 1. Start - "where are these from?" (trip / adventure / everyday, any mix). The answer decides
//    whether the trip steps run at all, so an everyday dump goes straight to People.
// 2. Pick - which trip(s)/adventure(s), with "+ New". Ones whose dates overlap the batch are
//    pre-selected.
// 3. Dates - every photo inside a picked folder's dates is filed automatically (undoable). What's
//    left is shown with "Add to trip or adventure…" (any of them, dates or not - a video edited a
//    month after the trip still belongs to it) or "Not part of any".
// 4. People and 5. Folders - pick a target, then click photos to toggle them in or out of it
//    ("paint" mode); or select photos first, then pick the target. Same gesture in both steps.
// Auto-Group, Cameras and Location are unchanged and follow.
const GS_TRIP_CLUSTER_GAP_MS = 40 * 60 * 60 * 1000; // >40h between consecutive photos starts a new cluster
const GS_TRIP_CLUSTER_SLACK_MS = 36 * 60 * 60 * 1000; // slack around a trip's stored date range, for timezone/EXIF drift

// Shared with the first-run wizard's "is this a trip?" step (frRenderTripAsk) - takes any array
// of file ids and splits them where there's a multi-day gap, matching each group to a trip.
function buildDateClusters(fileIds) {
  const dated = fileIds.map(id => appData.files.find(f => f.id === id)).filter(f => f?.fileDate).sort((a, b) => a.fileDate - b.fileDate);
  if (!dated.length) return [];
  const trips = appData.folders.filter(f => f.parentId === VACATIONS_ROOT_ID);
  const clusters = [];
  let current = [dated[0]];
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].fileDate - dated[i - 1].fileDate > GS_TRIP_CLUSTER_GAP_MS) { clusters.push(current); current = []; }
    current.push(dated[i]);
  }
  clusters.push(current);
  return clusters.map(files => {
    const start = files[0].fileDate, end = files[files.length - 1].fileDate;
    const match = trips.find(t => t.dateStart && start >= t.dateStart - GS_TRIP_CLUSTER_SLACK_MS && end <= (t.dateEnd || t.dateStart) + GS_TRIP_CLUSTER_SLACK_MS);
    return { fileIds: files.map(f => f.id), start, end, match: match || null };
  });
}

const tripLikeCoversDate = (t, d) => !!(t.dateStart && d && d >= t.dateStart - GS_TRIP_CLUSTER_SLACK_MS && d <= (t.dateEnd || t.dateStart) + GS_TRIP_CLUSTER_SLACK_MS);
const tripLikeOverlaps = (t, range) => !!(t.dateStart && range && t.dateStart - GS_TRIP_CLUSTER_SLACK_MS <= range.end && (t.dateEnd || t.dateStart) + GS_TRIP_CLUSTER_SLACK_MS >= range.start);

function gsBatchDateRange() {
  let start = Infinity, end = -Infinity;
  for (const f of gsFiles()) if (f.fileDate) { if (f.fileDate < start) start = f.fileDate; if (f.fileDate > end) end = f.fileDate; }
  return start === Infinity ? null : { start, end };
}
function gsRangeLabel(start, end) {
  const y1 = new Date(start).getFullYear(), y2 = new Date(end || start).getFullYear();
  return `${formatDateRangeShort(start, end)}, ${y1 === y2 ? y1 : `${y1}–${y2}`}`;
}
function gsTripLikeDatesLabel(t) { return t.dateStart ? gsRangeLabel(t.dateStart, t.dateEnd) : 'No dates set'; }

// Writes are batched while painting (one click = one toggle), so a fast run of clicks is one save.
let gsSaveTimer = null;
function gsQueueSave() { clearTimeout(gsSaveTimer); gsSaveTimer = setTimeout(() => { gsSaveTimer = null; saveData(); }, 500); }
function gsFlushSave() { if (gsSaveTimer) { clearTimeout(gsSaveTimer); gsSaveTimer = null; saveData(); } }
function gsFileIn(file, folderId) { return !!file.folders?.includes(folderId); }
function gsSetFileIn(file, folderId, on) {
  if (!file.folders) file.folders = [];
  const i = file.folders.indexOf(folderId);
  if (on && i < 0) file.folders.push(folderId);
  else if (!on && i >= 0) file.folders.splice(i, 1);
}
function gsBatchCountIn(folderId) { return gsFiles().filter(f => gsFileIn(f, folderId)).length; }
function gsSelectedFiles() { return [...selectedIds].map(id => appData.files.find(f => f.id === id)).filter(Boolean); }

// ── Step 1: where are these from? ───────────────────────────────────────────
function renderGsStartStep() {
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  const files = gsFiles();
  const range = gsBatchDateRange();
  const opt = (key, icon, title, sub) => `
    <button class="gs-choice${gsKinds[key] ? ' active' : ''}" data-kind="${key}" onclick="gsToggleKind('${key}')">
      <span class="gs-choice-check">✓</span>
      <span class="gs-choice-icon">${icon}</span>
      <span class="gs-choice-title">${title}</span>
      <span class="gs-choice-sub">${sub}</span>
    </button>`;
  body.innerHTML = `<div id="gsLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${gsStepLabel()}</strong> Where are these ${files.length} photo${files.length !== 1 ? 's' : ''} from${range ? ` (taken ${gsRangeLabel(range.start, range.end)})` : ''}? Pick everything that applies - one batch can mix a trip with everyday shots. Your answer decides which steps come next.</div>
    <div class="gs-choice-grid">
      ${opt('trip', '✈️', 'A trip', 'Travel away from home')}
      ${opt('adventure', '🧭', 'An adventure', 'A trek, a festival, a day out')}
      ${opt('everyday', '📷', 'Everyday photos', 'Not part of anything special')}
    </div>
    <div class="gs-section-label">The photos in this batch</div>`;
  body.appendChild(gsRenderGrid(files));
  bar.innerHTML = `<span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn" id="gsStartContinue" onclick="gsAdvanceStep(gsNextStep())">Continue →</button>`;
  gsBarUpdater = gsUpdateStartBar;
  gsUpdateStartBar();
}
function gsUpdateStartBar() {
  const any = gsKinds.trip || gsKinds.adventure || gsKinds.everyday;
  const btn = document.getElementById('gsStartContinue');
  if (btn) btn.disabled = !any;
  const info = document.querySelector('#gsBar .gs-bar-info');
  if (info) info.textContent = any ? 'Next: ' + gsStepList().slice(1, 4).map(s => GS_STEP_TITLES[s]).join(' → ') + ' → …' : 'Pick at least one answer above';
}
function gsToggleKind(key) {
  gsKinds[key] = !gsKinds[key];
  document.querySelector(`.gs-choice[data-kind="${key}"]`)?.classList.toggle('active', gsKinds[key]);
  document.getElementById('gsSteps').innerHTML = gsStepsHtml(gsProgressPercent());
  gsUpdateStartBar();
}

// ── Step 2: which trip(s) / adventure(s)? ───────────────────────────────────
function gsPickRootIds() {
  return [gsKinds.trip && VACATIONS_ROOT_ID, gsKinds.adventure && ADVENTURES_ROOT_ID].filter(Boolean);
}
function renderGsPickStep() {
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  const range = gsBatchDateRange();
  const roots = gsPickRootIds();
  const candidates = appData.folders.filter(f => roots.includes(f.parentId));
  if (!gsPickSeeded) {
    candidates.filter(t => tripLikeOverlaps(t, range)).forEach(t => { if (!gsPickedIds.includes(t.id)) gsPickedIds.push(t.id); });
    gsPickSeeded = true;
  }
  gsPickedIds = gsPickedIds.filter(id => appData.folders.some(f => f.id === id));
  const sorted = candidates.slice().sort((a, b) =>
    (tripLikeOverlaps(b, range) ? 1 : 0) - (tripLikeOverlaps(a, range) ? 1 : 0) || (b.dateStart || 0) - (a.dateStart || 0));
  const what = gsKinds.trip && gsKinds.adventure ? 'trip or adventure' : gsKinds.trip ? 'trip' : 'adventure';
  body.innerHTML = `
    <div class="gs-intro"><strong>${gsStepLabel()}</strong> Which ${what} are these from? Select every one that applies${range ? ' - the ones whose dates match these photos are already ticked' : ''}. Next, photos are matched to them by date automatically.</div>
    <div class="gs-pick-list" id="gsPickList"></div>
    <div class="gs-pick-new">
      ${gsKinds.trip ? `<button class="gs-chip gs-chip-new" onclick="gsOpenNamePrompt('trip')">+ New trip</button>` : ''}
      ${gsKinds.adventure ? `<button class="gs-chip gs-chip-new" onclick="gsOpenNamePrompt('adventure')">+ New adventure</button>` : ''}
    </div>`;
  const list = document.getElementById('gsPickList');
  if (!sorted.length) list.innerHTML = `<div class="gs-empty" style="padding:24px 0"><div style="font-size:34px">${gsKinds.trip ? '✈️' : '🧭'}</div><div>No ${what}s yet - create one below. Adding its dates lets Trove file the photos for you.</div></div>`;
  sorted.forEach(t => {
    const adv = isAdventureFolder(t);
    const card = document.createElement('button');
    card.className = 'gs-pick-card' + (gsPickedIds.includes(t.id) ? ' active' : '');
    card.innerHTML = `
      <span class="gs-pick-check">✓</span>
      <span class="gs-pick-icon">${folderIconHtml(t)}</span>
      <span class="gs-pick-text">
        <span class="gs-pick-name">${esc(t.name)} <span class="gs-pick-kind ${adv ? 'adv' : ''}">${adv ? 'Adventure' : 'Trip'}</span></span>
        <span class="gs-pick-meta">${esc(gsTripLikeDatesLabel(t))}${tripLikeOverlaps(t, range) ? ' · <b>matches these photos</b>' : ''}</span>
      </span>`;
    card.onclick = () => {
      gsPickedIds = gsPickedIds.includes(t.id) ? gsPickedIds.filter(id => id !== t.id) : [...gsPickedIds, t.id];
      card.classList.toggle('active', gsPickedIds.includes(t.id));
      gsUpdatePickBar();
    };
    list.appendChild(card);
  });
  bar.innerHTML = `<span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="gsAdvanceStep('people')" title="Skip the trip steps">Skip</button>
    <button class="dump-banner-btn dump-sort-btn" id="gsPickContinue" onclick="gsAdvanceStep('dates')">Continue →</button>`;
  gsBarUpdater = null;
  gsUpdatePickBar();
}
function gsUpdatePickBar() {
  const n = gsPickedIds.length;
  const info = document.querySelector('#gsBar .gs-bar-info');
  if (info) info.textContent = n ? `${n} selected` : 'Select at least one, or create a new one';
  const btn = document.getElementById('gsPickContinue');
  if (btn) btn.disabled = !n;
}

// ── Step 3: match by date, then sort out the rest ───────────────────────────
function gsApplyDateMatches() {
  const key = gsPickedIds.slice().sort().join(',');
  if (gsDateMatchKey === key) return;
  gsDateMatchKey = key;
  const picked = gsPickedIds.map(id => appData.folders.find(f => f.id === id)).filter(Boolean);
  const dated = picked.filter(t => t.dateStart);
  const byFolder = new Map();
  for (const file of gsFiles()) {
    if (picked.some(p => gsFileIn(file, p.id))) continue; // already filed into one of them
    const t = dated.find(t => tripLikeCoversDate(t, file.fileDate));
    if (!t) continue;
    gsSetFileIn(file, t.id, true);
    (byFolder.get(t.id) || byFolder.set(t.id, []).get(t.id)).push(file.id);
  }
  gsDateMatches = [...byFolder].map(([folderId, fileIds]) => ({ folderId, fileIds, undone: false }));
  if (gsDateMatches.length) saveData();
}
function gsOutsideFiles() {
  const tripIds = getTripLikeDescendantIds();
  return gsFiles().filter(f => !gsOutsideDismissed.has(f.id) && !f.folders?.some(id => tripIds.has(id)));
}
function renderGsDatesStep() {
  gsApplyDateMatches();
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  const picked = gsPickedIds.map(id => appData.folders.find(f => f.id === id)).filter(Boolean);
  const undated = picked.filter(t => !t.dateStart);
  const outside = gsOutsideFiles();

  const matchCards = (gsDateMatches || []).map((m, i) => {
    const t = appData.folders.find(f => f.id === m.folderId);
    if (!t) return '';
    return m.undone
      ? `<div class="gs-match-card undone"><span>↩ Undone - ${m.fileIds.length} photo${m.fileIds.length !== 1 ? 's' : ''} taken out of ${esc(t.name)}</span><button class="gs-link-btn" onclick="gsRedoDateMatch(${i})">Redo</button></div>`
      : `<div class="gs-match-card"><span class="gs-match-icon">${folderIconHtml(t)}</span><span><b>${m.fileIds.length} photo${m.fileIds.length !== 1 ? 's' : ''}</b> fit ${esc(t.name)}'s dates (${esc(gsTripLikeDatesLabel(t))}) and were added.</span><button class="gs-link-btn" onclick="gsUndoDateMatch(${i})">Undo</button></div>`;
  }).join('');
  const undatedNote = undated.length
    ? `<div class="gs-note">📅 ${undated.map(t => `<b>${esc(t.name)}</b>`).join(', ')} ${undated.length === 1 ? 'has' : 'have'} no dates, so nothing could be matched automatically. Select the photos below and use <i>Add to trip or adventure…</i>, or add dates to it from the sidebar (right-click › Customize) for next time.</div>`
    : '';

  body.innerHTML = `<div id="gsLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${gsStepLabel()}</strong> ${outside.length
      ? `${outside.length} photo${outside.length !== 1 ? "s aren't" : " isn't"} in any trip or adventure yet${picked.some(t => t.dateStart) ? ' - taken outside the dates you picked' : ''}. Are they part of something? Select them and add them to a trip or adventure - even one whose dates don't match, like a video you edited after coming home. Or mark them as not part of any.`
      : 'Every photo in this batch is in a trip or adventure now.'}</div>
    ${matchCards ? `<div class="gs-match-list">${matchCards}</div>` : ''}
    ${undatedNote}
    ${outside.length ? `<div class="gs-chip-row" id="gsDatesActions">
      <button class="gs-chip" onclick="gsSelectAllVisible()">Select all</button>
      <button class="gs-chip gs-chip-primary" onclick="gsOpenTripLikeMenu(this)">Add to trip or adventure… ▾</button>
      ${picked.length === 1 && !picked[0].dateStart ? `<button class="gs-chip" onclick="gsAddAllOutsideTo('${picked[0].id}')">Add all to ${esc(picked[0].name)}</button>` : ''}
      <button class="gs-chip" id="gsDismissBtn" onclick="gsDismissOutside()"></button>
    </div>` : ''}`;
  if (outside.length) body.appendChild(gsRenderGrid(outside));
  else body.insertAdjacentHTML('beforeend', `<div class="gs-empty"><div style="font-size:40px">✅</div><div>All sorted into trips and adventures</div></div>`);

  gsBarUpdater = () => {
    const n = selectedIds.size;
    const info = bar.querySelector('.gs-bar-info');
    if (info) info.textContent = n ? `${n} selected` : outside.length ? `${outside.length} left to check` : '';
    const dismiss = document.getElementById('gsDismissBtn');
    if (dismiss) dismiss.textContent = n ? `Not part of any (${n})` : 'None of these are part of one';
  };
  bar.innerHTML = `<span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn" onclick="gsAdvanceStep('people')">Continue →</button>`;
  gsBarUpdater();
}
function gsUndoDateMatch(i) {
  const m = gsDateMatches?.[i];
  if (!m || m.undone) return;
  m.fileIds.forEach(id => { const f = appData.files.find(x => x.id === id); if (f) gsSetFileIn(f, m.folderId, false); });
  m.undone = true;
  saveData();
  renderGsDatesStep();
}
function gsRedoDateMatch(i) {
  const m = gsDateMatches?.[i];
  if (!m || !m.undone) return;
  m.fileIds.forEach(id => { const f = appData.files.find(x => x.id === id); if (f) gsSetFileIn(f, m.folderId, true); });
  m.undone = false;
  saveData();
  renderGsDatesStep();
}
function gsSelectAllVisible() {
  document.querySelectorAll('#gsBody .file-card').forEach(c => selectedIds.add(c.dataset.fileId));
  updateSelectionUI();
  if (typeof gsBarUpdater === 'function') gsBarUpdater();
}
function gsDismissOutside() {
  const ids = selectedIds.size ? [...selectedIds] : gsOutsideFiles().map(f => f.id);
  ids.forEach(id => gsOutsideDismissed.add(id));
  clearSelection();
  renderGsDatesStep();
}
async function gsAddAllOutsideTo(folderId) {
  const t = appData.folders.find(f => f.id === folderId);
  const files = gsOutsideFiles();
  files.forEach(f => gsSetFileIn(f, folderId, true));
  await saveData();
  toast(`${isAdventureFolder(t) ? '🧭' : '✈️'} Added ${files.length} photo${files.length !== 1 ? 's' : ''} to ${t?.name}`);
  renderGsDatesStep();
}
async function gsAddSelectedToTripLike(folderId) {
  gsCloseMenus();
  const t = appData.folders.find(f => f.id === folderId);
  const files = gsSelectedFiles();
  if (!t) return;
  if (!files.length) { toast('Select the photos first, then pick where they belong'); return; }
  files.forEach(f => gsSetFileIn(f, folderId, true));
  if (!gsPickedIds.includes(folderId)) gsPickedIds.push(folderId);
  gsDateMatchKey = gsPickedIds.slice().sort().join(','); // a manual add isn't a reason to re-run date matching
  clearSelection();
  await saveData();
  toast(`${isAdventureFolder(t) ? '🧭' : '✈️'} Added ${files.length} photo${files.length !== 1 ? 's' : ''} to ${t.name}`);
  renderGsDatesStep();
}
// Every trip and adventure, the ones picked in step 2 first - dates don't restrict anything here.
function gsOpenTripLikeMenu(anchor) {
  if (!selectedIds.size) { toast('Select the photos first, then pick where they belong'); return; }
  const all = getTripLikeFolders();
  const picked = all.filter(t => gsPickedIds.includes(t.id));
  const rest = all.filter(t => !gsPickedIds.includes(t.id));
  const row = t => `<button class="gs-menu-item" onclick="gsAddSelectedToTripLike('${t.id}')">${folderIconHtml(t)} <span>${esc(t.name)}</span><small>${isAdventureFolder(t) ? 'Adventure' : 'Trip'} · ${esc(gsTripLikeDatesLabel(t))}</small></button>`;
  gsShowMenu(anchor, `
    ${picked.length ? `<div class="gs-menu-label">You picked</div>${picked.map(row).join('')}` : ''}
    ${rest.filter(t => !isAdventureFolder(t)).length ? `<div class="gs-menu-label">Other trips</div>${rest.filter(t => !isAdventureFolder(t)).map(row).join('')}` : ''}
    ${rest.filter(isAdventureFolder).length ? `<div class="gs-menu-label">Other adventures</div>${rest.filter(isAdventureFolder).map(row).join('')}` : ''}
    <div class="gs-menu-sep"></div>
    <button class="gs-menu-item gs-menu-new" onclick="gsCloseMenus();gsOpenNamePrompt('trip')">+ New trip</button>
    <button class="gs-menu-item gs-menu-new" onclick="gsCloseMenus();gsOpenNamePrompt('adventure')">+ New adventure</button>`);
}

// Small popover menu anchored under a button; closes on the next outside click or Escape.
function gsShowMenu(anchor, html) {
  gsCloseMenus();
  const menu = document.createElement('div');
  menu.className = 'gs-menu';
  menu.id = 'gsMenu';
  menu.innerHTML = html;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
  menu.style.top = (r.bottom + 6 + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('mousedown', gsMenuOutside), 0);
}
function gsMenuOutside(e) {
  if (e.target.closest('#gsMenu, #gsFolderPanel, .gs-folder-btn')) return;
  gsCloseMenus();
}
function gsCloseMenus() {
  document.getElementById('gsMenu')?.remove();
  if (gsFolderPanelOpen) { gsFolderPanelOpen = false; document.getElementById('gsFolderPanel')?.remove(); }
  document.removeEventListener('mousedown', gsMenuOutside);
}
function gsAnyMenuOpen() { return !!document.getElementById('gsMenu') || gsFolderPanelOpen; }

// ── Paint mode, shared by People and Folders ────────────────────────────────
// With a target picked (gsActiveTarget), clicking a photo adds it to / removes it from that
// folder on the spot. With no target, clicks just select, and picking a target files the
// selection. Cards carry small name tags for what they're already in, and an outline when
// they're in the current target, so progress is visible without leaving the grid.
function gsPaintHooks(scopeIds, onChange) {
  return {
    tags: file => (file.folders || []).filter(id => scopeIds().has(id)).map(id => appData.folders.find(f => f.id === id)?.name).filter(Boolean),
    inTarget: file => !!gsActiveTarget && gsFileIn(file, gsActiveTarget),
    click: file => {
      if (!gsActiveTarget) return false;
      gsSetFileIn(file, gsActiveTarget, !gsFileIn(file, gsActiveTarget));
      gsQueueSave();
      onChange();
      if (typeof gsBarUpdater === 'function') gsBarUpdater();
      return true;
    }
  };
}
function gsRefreshCards() {
  document.querySelectorAll('#gsBody .file-card').forEach(card => {
    const file = appData.files.find(f => f.id === card.dataset.fileId);
    if (file) gsDecorateCard(card, file);
  });
}
async function gsFileSelectionInto(folderId) {
  const folder = appData.folders.find(f => f.id === folderId);
  const files = gsSelectedFiles();
  if (!folder || !files.length) return false;
  files.forEach(f => gsSetFileIn(f, folderId, true));
  clearSelection();
  await saveData();
  toast(`${folder.parentId && buildBreadcrumb(folder.id).some(f => f.id === PEOPLE_ROOT_ID) ? '🧑' : '📁'} Added ${files.length} photo${files.length !== 1 ? 's' : ''} to ${folder.name}`);
  return true;
}

// ── Step 4: people ──────────────────────────────────────────────────────────
function gsPeopleIds() {
  const root = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  return new Set(root ? getAllDesc(root.id) : []);
}
function renderGsPeopleStep() {
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  getOrCreatePeopleRoot();
  const files = gsFiles();
  if (typeof faceScanFirst === 'function') faceScanFirst(files);
  if (typeof faceBatchSettle === 'function') faceBatchSettle(files);
  const visible = gsPeopleVisible(files);
  gsPeopleGridKey = visible.map(f => f.id).join(',');
  body.innerHTML = `<div id="gsLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${gsStepLabel()}</strong> Pick a person, then click every photo they're in - click again to take one back out. Or select photos first and then tap the person. Double-click a photo to see it larger.</div>
    <div id="gsFaceSuggest" class="gs-face-suggest"></div>
    <div class="gs-chip-row" id="gsPeopleChips"></div>`;
  gsCardHooks = gsPaintHooks(gsPeopleIds, () => { gsRefreshCards(); gsRenderPeopleChips(); });
  body.appendChild(gsRenderGrid(visible));
  gsRenderPeopleChips();
  gsRenderFaceSuggestions();
  gsBarUpdater = () => {
    const n = selectedIds.size;
    const info = bar.querySelector('.gs-bar-info');
    const target = appData.folders.find(f => f.id === gsActiveTarget);
    const left = gsPeopleGridKey ? gsPeopleGridKey.split(',').length : 0;
    const status = left < files.length ? `${left} of ${files.length} photos left to check` : `${files.length} photo${files.length !== 1 ? 's' : ''} in this batch`;
    if (info) info.textContent = target ? `${gsBatchCountIn(target.id)} of ${files.length} photos have ${target.name}` : n ? `${n} selected - tap a person to add them` : status;
  };
  bar.innerHTML = `<span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn" onclick="gsAdvanceStep(gsNextStep())">Done with people →</button>`;
  gsBarUpdater();
}
function gsRenderPeopleChips() {
  const row = document.getElementById('gsPeopleChips');
  if (!row) return;
  const root = appData.folders.find(f => f.id === PEOPLE_ROOT_ID);
  const people = root ? getFolderChipList(root.id) : [];
  const active = appData.folders.find(f => f.id === gsActiveTarget);
  row.innerHTML = '';
  people.forEach(({ folder: p, label }) => {
    const chip = document.createElement('button');
    const n = gsBatchCountIn(p.id);
    chip.className = 'gs-chip' + (p.id === gsActiveTarget ? ' active' : '');
    chip.innerHTML = `${esc(label)}${n ? ` <span class="gs-chip-count">${n}</span>` : ''}`;
    chip.title = p.id === gsActiveTarget ? 'Click again to stop tagging' : `Tag ${p.name}`;
    chip.onclick = () => gsTargetChipClick(p.id, renderGsPeopleChipsAndCards);
    row.appendChild(chip);
  });
  const add = document.createElement('button');
  add.className = 'gs-chip gs-chip-new';
  add.textContent = '+ New person';
  add.onclick = () => gsOpenNamePrompt('person');
  row.appendChild(add);
  if (active) row.insertAdjacentHTML('beforeend', `<span class="gs-paint-hint">Tagging <b>${esc(active.name)}</b> - click photos to add or remove · <a onclick="gsTargetChipClick('${active.id}', renderGsPeopleChipsAndCards)">Stop</a></span>`);
}
function renderGsPeopleChipsAndCards() {
  gsRenderPeopleChips();
  gsRefreshCards();
  if (gsStep === 'people') { gsRefreshPeopleGrid(); gsRenderFaceSuggestions(); }
  if (typeof gsBarUpdater === 'function') gsBarUpdater();
}

// ── Face recognition in the People step ─────────────────────────────────────
// The step works down to nothing. With face recognition on:
//   1. Photos where everyone is already accounted for aren't shown at all, and each photo
//      leaves the grid as soon as everyone in it is - so the grid shrinks as you go, until
//      what's left has no one in it that Trove can see (or is a video, for tagging by hand).
//   2. For each person already in People: "Dad is probably in 5 of these photos", with their
//      faces as found here - one click files them all, a ✕ takes one face out, and hovering the
//      card outlines those photos in the grid (faceBatchSuggestions in faceIndex.js).
//   3. Once those are dealt with, the faces nobody could put a name to: "Who is this?", one
//      person at a time, biggest first - named, set aside for good, or left for later.
// Photos recognition was already sure of are filed before the step even opens.
let gsFaceSuggestTimer = null;
let gsFaceOfferDismissed = false;
let gsFaceShown = new Map();  // personId -> face ids on their card
let gsFaceAsking = null;      // the "Who is this?" group on screen: { faces, fileIds }
let gsFaceLater = new Set();  // first face id of groups the user put off, for this session
let gsFaceApart = new Set();  // faces taken out of a "Who is this?" group, asked about on their own
let gsPeopleGridKey = '';     // the photos the grid currently shows, to rebuild it only when that changes
// Called by faceIndex.js whenever faces change (a photo scanned, recognition re-run). Throttled,
// not debounced: during a scan of the whole library this fires several times a second, and a
// debounce would hold the step's update back until the scan ends.
function gsFacesChanged() {
  if (!gsOpen || gsStep !== 'people' || gsFaceSuggestTimer) return;
  gsFaceSuggestTimer = setTimeout(() => { gsFaceSuggestTimer = null; if (gsOpen && gsStep === 'people') renderGsPeopleChipsAndCards(); }, 800);
}
function gsPeopleVisible(files) {
  if (typeof faceBatchPhotoState !== 'function' || !faceRecognitionEnabled() || !faceStore) return files;
  const byPhoto = faceByPhoto(new Set(files.map(f => f.id)));
  return files.filter(f => faceBatchPhotoState(f, byPhoto) !== 'done');
}
// Rebuilds the grid when the photos it should show have changed - but never mid-paint, where a
// photo vanishing under the pointer would make a mis-click impossible to take back.
function gsRefreshPeopleGrid() {
  if (gsStep !== 'people' || gsActiveTarget || typeof faceBatchSettle !== 'function') return;
  const files = gsFiles();
  faceBatchSettle(files);
  const visible = gsPeopleVisible(files);
  const key = visible.map(f => f.id).join(',');
  if (key === gsPeopleGridKey) return;
  gsPeopleGridKey = key;
  const keep = new Set(visible.map(f => f.id));
  for (const id of [...selectedIds]) if (!keep.has(id)) selectedIds.delete(id);
  const body = document.getElementById('gsBody');
  const old = body?.querySelector('.gs-grid-wrap');
  if (!body || !old) return;
  const scroll = body.scrollTop;
  old.replaceWith(gsRenderGrid(visible));
  body.scrollTop = scroll;
  updateSelectionUI();
}
function gsRenderFaceSuggestions() {
  const box = document.getElementById('gsFaceSuggest');
  if (!box || typeof faceRecognitionEnabled !== 'function') return;
  const files = gsFiles();
  gsFaceShown = new Map();
  gsFaceAsking = null;
  if (!faceRecognitionEnabled()) {
    box.innerHTML = gsFaceOfferDismissed || !files.some(f => isImg(f.ext)) ? '' : `<div class="gs-face-offer">
      <span>Trove can spot who's in these photos and suggest them for you. It runs only on this computer, nothing is uploaded.</span>
      <button class="gs-chip gs-chip-primary" onclick="gsTurnOnFaces()">Turn on face recognition</button>
      <a onclick="gsFaceOfferDismissed = true; gsRenderFaceSuggestions()">Not now</a></div>`;
    return;
  }
  // Only the photos still on screen: one that's been dealt with has nothing left to suggest.
  const visibleIds = new Set(gsPeopleVisible(files).map(f => f.id));
  const open = files.filter(f => visibleIds.has(f.id));
  const waiting = open.filter(f => faceQueueSet.has(f.id)).length;
  const suggestions = faceBatchSuggestions(open).filter(s => s.person);
  const cropIds = [];
  let html = waiting ? `<div class="gs-face-status"><span class="gs-face-spinner"></span>Looking for faces in these photos… ${waiting} to go</div>` : '';
  html += suggestions.map(({ person, faces }) => {
    gsFaceShown.set(person.id, faces.map(f => f.id));
    const shown = faces.slice(0, 14);
    cropIds.push(...shown.map(f => f.id));
    const pic = personPictureUrl(person);
    const n = new Set(faces.map(f => f.f)).size;
    return `<div class="gs-face-card" onmouseenter="gsFaceHint('${person.id}', true)" onmouseleave="gsFaceHint('${person.id}', false)">
      <div class="gs-face-who"><span class="gs-face-pic"${pic ? ` style="background-image:url('${pic}')"` : ''}></span><span><b>${esc(person.name)}</b> is probably in ${n} of these photos</span></div>
      <div class="gs-face-crops">${shown.map(f => `<span class="gs-face-crop" data-face="${f.id}" title="Not ${esc(person.name)}? Click to take this one out" onclick="gsFaceDrop('${person.id}', '${f.id}')"><i>✕</i></span>`).join('')}${faces.length > shown.length ? `<span class="gs-face-more">+${faces.length - shown.length}</span>` : ''}</div>
      <div class="gs-face-actions">
        <button class="gs-chip gs-chip-primary" onclick="gsFaceAccept('${person.id}')">${n === 1 ? 'Add it' : `Add all ${n}`} to ${esc(person.name)}</button>
        <button class="gs-chip" onclick="gsFaceRejectAll('${person.id}')">Not ${esc(person.name)}</button>
      </div></div>`;
  }).join('');
  // The known people first; the unknown faces once they're settled and the scan has caught up.
  if (!suggestions.length && !waiting) {
    const groups = gsFaceQuestions(open);
    if (groups.length) {
      const g = gsFaceAsking = groups[0];
      const shown = g.faces.slice(0, 14);
      cropIds.push(...shown.map(f => f.id));
      const n = g.fileIds.length;
      const names = facePeopleFolders().map(p => `<option value="${esc(p.name)}">`).join('');
      html += `<div class="gs-face-card" onmouseenter="gsFaceHint(null, true)" onmouseleave="gsFaceHint(null, false)">
        <div class="gs-face-who"><span class="gs-face-pic" data-face="${g.faces[0].id}"></span><span><b>Who is this?</b> In ${n} of these photos${groups.length > 1 ? ` · ${groups.length - 1} more to ask about` : ''}</span></div>
        <div class="gs-face-crops">${shown.slice(1).map(f => `<span class="gs-face-crop" data-face="${f.id}" title="Not the same person? Click to take this one out" onclick="gsFaceAskDrop('${f.id}')"><i>✕</i></span>`).join('')}${g.faces.length > shown.length ? `<span class="gs-face-more">+${g.faces.length - shown.length}</span>` : ''}</div>
        <div class="gs-face-actions">
          <input id="gsFaceName" class="gs-face-name" list="gsFacePeople" placeholder="Their name…" onkeydown="if (event.key === 'Enter') gsFaceName()">
          <datalist id="gsFacePeople">${names}</datalist>
          <button class="gs-chip gs-chip-primary" onclick="gsFaceName()">Save</button>
          <button class="gs-chip" onclick="gsFaceIgnore()" title="Nobody to tag - a stranger, a poster, a statue">Don't tag</button>
          <a class="gs-face-skip" onclick="gsFaceLater.add('${g.faces[0].id}'); gsRenderFaceSuggestions()">Ask later</a>
        </div></div>`;
    } else if (open.length) {
      html += `<div class="gs-face-status">Everyone Trove can see in these photos is tagged. The ${open.length} left have no face it could make out: tag anyone in them by hand, or carry on.</div>`;
    }
  }
  box.innerHTML = html;
  if (cropIds.length) window.api.faceCropsGet(cropIds).then(crops => {
    for (const [id, b64] of Object.entries(crops)) {
      box.querySelectorAll(`[data-face="${id}"]`).forEach(el => { el.style.backgroundImage = `url("data:image/jpeg;base64,${b64}")`; });
    }
  }).catch(() => {});
}
async function gsTurnOnFaces() {
  await setFaceRecognition(true);
  if (typeof faceScanFirst === 'function') faceScanFirst(gsFiles());
  gsRenderFaceSuggestions();
}
// Outlines a card's photos in the grid; personId null = the "Who is this?" card.
function gsFaceHint(personId, on) {
  const faces = new Set(personId ? gsFaceShown.get(personId) || [] : (gsFaceAsking?.faces || []).map(f => f.id));
  const photos = new Set((faceStore?.faces || []).filter(f => faces.has(f.id)).map(f => f.f));
  document.querySelectorAll('#gsBody .file-card').forEach(card => card.classList.toggle('gs-face-hint', on && photos.has(card.dataset.fileId)));
}
async function gsFaceAccept(personId) {
  const person = appData.folders.find(f => f.id === personId);
  const n = await faceBatchConfirm(personId, gsFaceShown.get(personId) || []);
  gsFaceHint(personId, false);
  if (n && person) toast(`🧑 Added ${n} photo${n === 1 ? '' : 's'} to ${person.name}`);
  renderGsPeopleChipsAndCards();
}
function gsFaceRejectAll(personId) {
  faceBatchReject(personId, gsFaceShown.get(personId) || []);
  gsFaceHint(personId, false);
  renderGsPeopleChipsAndCards();
}
function gsFaceDrop(personId, faceId) {
  faceBatchReject(personId, [faceId]);
  gsRenderFaceSuggestions();
  gsFaceHint(personId, true); // the pointer is still on the card
}
// "Who is this?" answered with a name: an existing person, or a new one.
async function gsFaceName() {
  const name = document.getElementById('gsFaceName')?.value.trim();
  const g = gsFaceAsking;
  if (!name || !g) return;
  const person = facePeopleFolders().find(p => p.name.toLowerCase() === name.toLowerCase()) || getOrCreatePersonFolder(name);
  const n = await faceBatchConfirm(person.id, g.faces.map(f => f.id));
  gsFaceHint(null, false);
  renderSidebar();
  toast(`🧑 Added ${n} photo${n === 1 ? '' : 's'} to ${person.name}`);
  renderGsPeopleChipsAndCards();
}
function gsFaceIgnore() {
  if (!gsFaceAsking) return;
  faceBatchIgnore(gsFaceAsking.faces.map(f => f.id));
  gsFaceHint(null, false);
  renderGsPeopleChipsAndCards();
}
// A face that got grouped with the wrong person: out of this question, asked about on its own.
function gsFaceAskDrop(faceId) {
  gsFaceApart.add(faceId);
  gsFaceHint(null, false);
  gsRenderFaceSuggestions();
  gsFaceHint(null, true); // the pointer is still on the card
}
// The batch's unknown faces as questions: faces the user took out of a group become their own.
function gsFaceQuestions(open) {
  const apart = [];
  return faceBatchUnknownGroups(open).map(g => {
    const faces = g.faces.filter(f => !gsFaceApart.has(f.id));
    g.faces.filter(f => gsFaceApart.has(f.id)).forEach(f => apart.push({ faces: [f], fileIds: [f.f] }));
    return { faces, fileIds: [...new Set(faces.map(f => f.f))] };
  }).filter(g => g.faces.length).concat(apart).filter(g => !gsFaceLater.has(g.faces[0].id));
}
// A target chip: files the current selection if there is one, otherwise toggles paint mode.
async function gsTargetChipClick(folderId, refresh) {
  if (selectedIds.size) { await gsFileSelectionInto(folderId); refresh(); return; }
  gsActiveTarget = gsActiveTarget === folderId ? null : folderId;
  refresh();
}

// ── Step 5: other folders ───────────────────────────────────────────────────
// Everything that isn't People, a trip/adventure or a camera: Categories, custom sections and
// plain folders. One "Add to folder" button opens the whole tree with batch counts, instead of
// rows of chips that grow with the library.
function gsOtherExcludedIds() {
  const roots = [PEOPLE_ROOT_ID, ...TRIP_LIKE_ROOT_IDS].map(id => appData.folders.find(f => f.id === id)).filter(Boolean);
  const cam = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  if (cam) roots.push(cam);
  return new Set(roots.flatMap(r => [r.id, ...getAllDesc(r.id)]));
}
const gsIsGroupRoot = f => !f.parentId && (f.isSection || f.name.toLowerCase() === CATEGORY_ROOT_NAME.toLowerCase());
function gsOtherFolderIds() {
  const ex = gsOtherExcludedIds();
  return new Set(appData.folders.filter(f => !ex.has(f.id) && !gsIsGroupRoot(f)).map(f => f.id));
}
function renderGsFoldersStep() {
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  const files = gsFiles();
  body.innerHTML = `<div id="gsLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${gsStepLabel()}</strong> Anything else to file? Open <b>Add to folder</b> to see all your folders, pick one, then click the photos that go in it (or <i>Add all</i>). You can also select photos first and then pick the folder.</div>
    <div class="gs-chip-row gs-folder-bar" id="gsFolderBar"></div>`;
  gsCardHooks = gsPaintHooks(gsOtherFolderIds, () => { gsRefreshCards(); gsRenderFolderBar(); });
  body.appendChild(gsRenderGrid(files));
  gsRenderFolderBar();
  gsBarUpdater = () => {
    const n = selectedIds.size;
    const info = bar.querySelector('.gs-bar-info');
    const target = appData.folders.find(f => f.id === gsActiveTarget);
    if (info) info.textContent = target ? `${gsBatchCountIn(target.id)} of ${files.length} photos in ${target.name}` : n ? `${n} selected - pick a folder to add them` : `${files.length} photo${files.length !== 1 ? 's' : ''} in this batch`;
  };
  bar.innerHTML = `<span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn" onclick="gsAdvanceStep(gsNextStep())">Done with folders →</button>`;
  gsBarUpdater();
}
function gsRenderFolderBar() {
  const row = document.getElementById('gsFolderBar');
  if (!row) return;
  const target = appData.folders.find(f => f.id === gsActiveTarget);
  const n = target ? gsBatchCountIn(target.id) : 0;
  const total = gsBatch.length;
  row.innerHTML = `
    <button class="gs-chip gs-chip-primary gs-folder-btn" onclick="gsToggleFolderPanel(this)">📁 Add to folder ▾</button>
    ${target ? `<span class="gs-target-pill">${folderIconHtml(target)} <b>${esc(target.name)}</b> <span class="gs-chip-count">${n}/${total}</span></span>
      <button class="gs-chip" onclick="gsSetAllInTarget(true)"${n === total ? ' disabled' : ''}>Add all ${total}</button>
      <button class="gs-chip" onclick="gsSetAllInTarget(false)"${!n ? ' disabled' : ''}>Remove all</button>
      <button class="gs-chip gs-chip-back" onclick="gsActiveTarget=null;gsRenderFolderBar();gsRefreshCards();gsBarUpdater&&gsBarUpdater()">✕ Stop</button>
      <span class="gs-paint-hint">Click photos to add or remove them</span>`
    : `<span class="gs-paint-hint">No folder picked yet</span>`}`;
}
function gsSetAllInTarget(on) {
  if (!gsActiveTarget) return;
  gsFiles().forEach(f => gsSetFileIn(f, gsActiveTarget, on));
  gsQueueSave();
  gsRenderFolderBar(); gsRefreshCards(); if (typeof gsBarUpdater === 'function') gsBarUpdater();
}
function gsToggleFolderPanel(anchor) {
  if (gsFolderPanelOpen) { gsCloseMenus(); return; }
  gsCloseMenus();
  gsFolderPanelOpen = true;
  const panel = document.createElement('div');
  panel.className = 'gs-folder-panel';
  panel.id = 'gsFolderPanel';
  panel.innerHTML = gsFolderTreeHtml();
  document.body.appendChild(panel);
  const r = anchor.getBoundingClientRect();
  panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
  panel.style.top = (r.bottom + 6) + 'px';
  panel.style.maxHeight = (window.innerHeight - r.bottom - 24) + 'px';
  setTimeout(() => document.addEventListener('mousedown', gsMenuOutside), 0);
}
function gsFolderTreeHtml() {
  const ex = gsOtherExcludedIds();
  const counts = new Map();
  gsFiles().forEach(f => (f.folders || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  const rows = (parentId, depth) => appData.folders.filter(f => f.parentId === parentId && !ex.has(f.id)).map(f => `
    <div class="gs-ftree-row${f.id === gsActiveTarget ? ' active' : ''}" style="padding-left:${10 + depth * 18}px" onclick="gsPickFolderTarget('${f.id}')">
      <span class="gs-ftree-icon">${folderIconHtml(f)}</span><span class="gs-ftree-name">${esc(f.name)}</span>
      ${counts.get(f.id) ? `<span class="gs-chip-count">${counts.get(f.id)}</span>` : ''}
      <button class="gs-ftree-add" title="New subfolder inside ${esc(f.name)}" onclick="event.stopPropagation();gsNewFolderPrompt('${f.id}')">+</button>
    </div>${rows(f.id, depth + 1)}`).join('');
  const tops = appData.folders.filter(f => !f.parentId && !ex.has(f.id));
  const groups = tops.filter(gsIsGroupRoot).map(g => {
    const inner = rows(g.id, 0);
    return `<div class="gs-ftree-group">${folderIconHtml(g)} ${esc(g.name)}<button class="gs-ftree-add" title="New folder in ${esc(g.name)}" onclick="event.stopPropagation();gsNewFolderPrompt('${g.id}')">+</button></div>${inner || '<div class="gs-ftree-empty">Empty</div>'}`;
  }).join('');
  const plain = tops.filter(f => !gsIsGroupRoot(f));
  const plainHtml = plain.length ? `<div class="gs-ftree-group">📁 Other folders</div>${plain.map(f => `
    <div class="gs-ftree-row${f.id === gsActiveTarget ? ' active' : ''}" style="padding-left:10px" onclick="gsPickFolderTarget('${f.id}')">
      <span class="gs-ftree-icon">${folderIconHtml(f)}</span><span class="gs-ftree-name">${esc(f.name)}</span>
      ${counts.get(f.id) ? `<span class="gs-chip-count">${counts.get(f.id)}</span>` : ''}
    </div>${rows(f.id, 1)}`).join('')}` : '';
  return `<div class="gs-ftree-head">Your folders <span>number = photos from this batch already in it</span></div>
    <div class="gs-ftree-body">${groups}${plainHtml || ''}${!groups && !plainHtml ? '<div class="gs-ftree-empty">No folders yet</div>' : ''}</div>
    <button class="gs-menu-item gs-menu-new" onclick="gsNewFolderPrompt(null)">+ New folder in ${esc(CATEGORY_ROOT_NAME)}</button>`;
}
async function gsPickFolderTarget(folderId) {
  gsCloseMenus();
  if (selectedIds.size) await gsFileSelectionInto(folderId);
  else gsActiveTarget = folderId;
  gsRenderFolderBar(); gsRefreshCards(); if (typeof gsBarUpdater === 'function') gsBarUpdater();
}
function gsNewFolderPrompt(parentId) {
  gsCloseMenus();
  gsNamePromptParentId = parentId;
  gsOpenNamePrompt('folder');
}

// ── Content step (auto-grouping) ────────────────────────────────────────────
// Unlike every other Guided Sort step, this one isn't "manually multi-select photos, then
// click a target" - it's "review pre-computed suggestions." See semanticIndex.js's
// suggestGroupsForBatch() (embeds the batch with priority, asks main.js's suggest-groups for
// folder matches + new leftover clusters, then names the new clusters against a vocabulary)
// and main.js's suggest-groups handler for how the suggestions themselves are computed.
function gsContentRemaining() {
  const catRoot = appData.folders.find(f => !f.parentId && f.name.toLowerCase() === CATEGORY_ROOT_NAME.toLowerCase());
  const categoryIds = catRoot ? new Set([catRoot.id, ...getAllDesc(catRoot.id)]) : new Set();
  return gsFiles().filter(f => !gsContentResolvedIds.has(f.id) && !f.folders?.some(id => categoryIds.has(id)));
}

async function renderGsContentStep() {
  const remaining = gsContentRemaining();
  if (!remaining.length) {
    toast('🧠 Nothing left to auto-group');
    gsContentSuggestions = null;
    gsAdvanceStep('camera');
    return;
  }
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  bar.innerHTML = `
    <span class="gs-bar-info">${remaining.length} photo${remaining.length!==1?'s':''} not yet in a category</span>
    <button class="dump-banner-btn dump-sort-btn" onclick="gsAdvanceStep('camera')">Skip / Continue →</button>`;

  if (!gsContentSuggestions && !gsContentLoading) {
    gsContentLoading = true;
    body.innerHTML = `<div class="gs-intro"><strong>${gsStepLabel('content')}</strong> Looking for photos that match your existing categories, and grouping whatever's left by what's visually similar.</div>
      <div class="empty-state"><div class="dup-spinner"></div><div class="empty-title" id="gsContentProgress">Analyzing 0 / ${remaining.length}…</div></div>`;
    try {
      gsContentSuggestions = await suggestGroupsForBatch(remaining, (done, total) => {
        const el = document.getElementById('gsContentProgress');
        if (el) el.textContent = `Analyzing ${done} / ${total}…`;
      });
    } catch (e) {
      gsContentSuggestions = { folderMatches: [], newClusters: [] };
    }
    gsContentLoading = false;
    // Every suggested photo starts checked - the user un-checks whichever doesn't belong,
    // rather than building each group's selection up from nothing. Seeded once here, not on
    // every render, so confirming one card doesn't reset another card's selection the user
    // already adjusted (renderGsContentStep re-renders every remaining card each time).
    gsContentSuggestions.folderMatches.forEach(g => g.fileIds.forEach(id => selectedIds.add(id)));
    gsContentSuggestions.newClusters.forEach(c => c.fileIds.forEach(id => selectedIds.add(id)));
    if (gsStep === 'content') renderGsContentStep(); // re-render now that suggestions are ready
    return;
  }
  if (gsContentLoading) return; // already showing the spinner above

  const { folderMatches, newClusters } = gsContentSuggestions;
  const byId = new Map(appData.files.map(f => [f.id, f]));
  const suggestedCount = folderMatches.reduce((s, g) => s + g.fileIds.length, 0) + newClusters.reduce((s, c) => s + c.fileIds.length, 0);

  body.innerHTML = `<div class="gs-intro"><strong>${gsStepLabel('content')}</strong> ${suggestedCount
    ? `Found ${suggestedCount} match${suggestedCount!==1?'es':''} out of ${remaining.length} photo${remaining.length!==1?'s':''} - review below, nothing is filed until you confirm.`
    : `No confident matches or groups found among these ${remaining.length} photo${remaining.length!==1?'s':''} - continue whenever ready.`}</div>
    <div class="gs-suggest-list" id="gsSuggestList"></div>`;
  const list = document.getElementById('gsSuggestList');

  folderMatches.forEach((g, i) => {
    const folder = appData.folders.find(f => f.id === g.folderId);
    list.appendChild(gsSuggestionCardHtml({
      icon: folder ? folderIconHtml(folder) : '🏷️', title: `${g.fileIds.length} photo${g.fileIds.length!==1?'s':''} look like ${folder?.name || 'this folder'}`,
      fileIds: g.fileIds, byId,
      actionLabel: `✓ Add to ${folder?.name || 'folder'}`,
      onConfirm: () => gsConfirmFolderMatch(i),
    }));
  });
  newClusters.forEach((c, i) => {
    list.appendChild(gsSuggestionCardHtml({
      icon: '✨', title: `${c.fileIds.length} photo${c.fileIds.length!==1?'s':''} look similar to each other`,
      fileIds: c.fileIds, byId,
      nameInputId: `gsClusterName-${i}`, nameValue: c.suggestedName || `New Group ${i+1}`,
      actionLabel: 'Create Folder & File Them',
      onConfirm: () => gsConfirmNewCluster(i),
    }));
  });
  if (!folderMatches.length && !newClusters.length) {
    list.innerHTML = `<div class="gs-empty"><div style="font-size:40px">🤷</div><div>Nothing confident enough to suggest</div></div>`;
  }
  // Each card has its own full photo grid rather than one shared bottom bar - this refreshes
  // every card's confirm-button label/state after any click, so deselecting a photo in one
  // group updates that group's own count without disturbing any other card on screen.
  gsBarUpdater = gsUpdateContentConfirmButtons;
  gsUpdateContentConfirmButtons();
}

function gsUpdateContentConfirmButtons() {
  document.querySelectorAll('#gsSuggestList .gs-suggest-card').forEach(card => {
    const total = card.querySelectorAll('.file-card').length;
    const selected = card.querySelectorAll('.file-card.selected').length;
    const btn = card.querySelector('.gs-suggest-confirm');
    if (!btn) return;
    btn.textContent = selected ? `${btn.dataset.label} (${selected}/${total})` : 'Nothing selected';
    btn.disabled = !selected;
  });
}

// One suggestion card: the full photo grid for the group (every photo shown at real size,
// clickable to deselect one that doesn't belong, double-click or 🔍 to preview larger - the
// same gsRenderGrid/gsAppendCards every other Guided Sort step already uses, instead of a
// capped small thumbnail strip with no way to review or exclude individual photos), an
// optional editable name field (new-cluster suggestions only), and a confirm action that only
// files whatever is still checked - shared layout for both folder-match and new-cluster
// suggestions since they only differ in whether there's a name to edit and what the button does.
function gsSuggestionCardHtml({ icon, title, fileIds, byId, nameInputId, nameValue, actionLabel, onConfirm }) {
  const card = document.createElement('div');
  card.className = 'gs-suggest-card';
  card.innerHTML = `
    <div class="gs-suggest-head">
      <span class="gs-suggest-icon">${icon}</span>
      <span class="gs-suggest-title">${esc(title)}</span>
    </div>
    ${nameInputId ? `<input type="text" class="text-input gs-suggest-name" id="${nameInputId}" value="${esc(nameValue)}" placeholder="Folder name…"/>` : ''}
    <div class="gs-suggest-hint">Click a photo to leave it out of this suggestion. Double-click or 🔍 to see it larger.</div>`;
  const files = fileIds.map(id => byId.get(id)).filter(Boolean);
  card.appendChild(gsRenderGrid(files));
  const btn = document.createElement('button');
  btn.className = 'dump-banner-btn dump-sort-btn gs-suggest-confirm';
  btn.dataset.label = actionLabel;
  btn.addEventListener('click', onConfirm);
  card.appendChild(btn);
  return card;
}

async function gsConfirmFolderMatch(index) {
  const g = gsContentSuggestions.folderMatches[index];
  if (!g) return;
  const confirmedIds = g.fileIds.filter(id => selectedIds.has(id));
  if (!confirmedIds.length) { toast('Nothing selected - click at least one photo to file it here'); return; }
  await assignFilesToFolderAdditive(confirmedIds, g.folderId);
  confirmedIds.forEach(id => { gsContentResolvedIds.add(id); selectedIds.delete(id); }); // filed, so no longer selected
  updateSelectionUI();
  gsContentSuggestions.folderMatches.splice(index, 1);
  renderGsContentStep();
}

async function gsConfirmNewCluster(index) {
  const c = gsContentSuggestions.newClusters[index];
  if (!c) return;
  const nameInput = document.getElementById(`gsClusterName-${index}`);
  const name = (nameInput?.value || c.suggestedName || `New Group ${index+1}`).trim();
  if (!name) { nameInput?.focus(); return; }
  const confirmedIds = c.fileIds.filter(id => selectedIds.has(id));
  if (!confirmedIds.length) { toast('Nothing selected - click at least one photo to create the folder'); return; }
  const folder = getOrCreateCategoryFolder(name);
  await assignFilesToFolderAdditive(confirmedIds, folder.id);
  confirmedIds.forEach(id => { gsContentResolvedIds.add(id); selectedIds.delete(id); }); // filed, so no longer selected
  updateSelectionUI();
  gsContentSuggestions.newClusters.splice(index, 1);
  renderGsContentStep();
}

// ── Camera step ──────────────────────────────────────────────────────────────
function gsCameraRemaining() { return gsFiles().filter(f => !f.cameraFolder); }
function renderGsCameraStep() {
  const remaining = gsCameraRemaining();
  if (!remaining.length) {
    toast('📷 All photos already have a camera assigned');
    gsAdvanceStep('location');
    return;
  }
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  const camRoot = appData.folders.find(f => f.name === 'Cameras' && !f.parentId);
  const cams = camRoot ? appData.folders.filter(f => f.parentId === camRoot.id) : [];

  body.innerHTML = `<div id="gsLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${gsStepLabel('camera')}</strong> ${remaining.length} photo${remaining.length!==1?'s have':' has'} no camera assigned yet. Click the ones from the same camera, then tap it below. Click 🔍 on a photo to see it larger.</div>
    <div class="gs-chip-row" id="gsCameraChips"></div>`;
  const chipRow = document.getElementById('gsCameraChips');
  cams.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'gs-chip';
    chip.textContent = c.name;
    chip.onclick = () => gsTagSelectedToCamera(c.name);
    chipRow.appendChild(chip);
  });
  const addChip = document.createElement('button');
  addChip.className = 'gs-chip gs-chip-new';
  addChip.textContent = '+ New camera';
  addChip.onclick = () => gsOpenNamePrompt('camera');
  chipRow.appendChild(addChip);
  body.appendChild(gsRenderGrid(remaining));

  gsBarUpdater = () => {
    const n = selectedIds.size;
    bar.querySelector('.gs-bar-info').textContent = n ? `${n} selected - tap a camera above to assign` : `${remaining.length} photo${remaining.length!==1?'s':''} without a camera`;
  };
  bar.innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn" onclick="gsAdvanceStep('location')">Skip / Continue →</button>`;
  gsBarUpdater();
}
async function gsTagSelectedToCamera(cameraName) {
  if (!selectedIds.size) { toast('Click some photos from that camera first, then tap it'); return; }
  const ids = [...selectedIds];
  const name = await guidedAssignCamera(ids, cameraName);
  clearSelection();
  await saveData();
  toast(`📷 Assigned ${ids.length} photo${ids.length!==1?'s':''} to ${name}${name !== cameraName ? ` (you typed "${cameraName}")` : ''}`);
  renderGsCameraStep();
}

// ── Location step ────────────────────────────────────────────────────────────
// Opens the globe once with a picker panel down its left side listing every
// remaining no-location photo, instead of "select a batch in the wizard → jump to
// a full-screen globe → confirm → back to the wizard grid" (which closed and
// rebuilt the globe every round, resetting the camera each time). Selecting
// photos and confirming a pin here never rebuilds the globe, so placing several
// nearby photos in a row doesn't mean re-finding the spot on the map every time.
function gsLocationRemaining() { return gsFiles().filter(f => !f.gps); }

// Suggests a location for a file with no GPS by looking at every OTHER geotagged
// file in the whole library (not just this batch - the batch is exactly the files
// missing GPS, so there'd be nothing to match against within it) whose File Date
// falls within a widening time window: a shot taken minutes apart from an already-
// geotagged one, on the same walk/outing, is almost certainly from the same spot.
// Tries a tight ±30min window first (tends to mean "same stop"); only widens to
// ±1h if that finds nothing, trading precision for at least having a zone to offer.
// Returns the averaged {lat,lng} of every match in whichever tier hit, plus how
// many matched and the window that found them - this is a proximate zone, not the
// photo's real GPS, so callers should present it as a suggestion to confirm, never
// silently auto-apply it.
const GS_LOCATION_SUGGEST_TIERS_MIN = [30, 60];
function suggestLocationFor(file) {
  if (!file.fileDate) return null;
  for (const minutes of GS_LOCATION_SUGGEST_TIERS_MIN) {
    const windowMs = minutes * 60 * 1000;
    const matches = appData.files.filter(f =>
      f.id !== file.id && f.gps && f.fileDate && Math.abs(f.fileDate - file.fileDate) <= windowMs
    );
    if (matches.length) {
      const lat = matches.reduce((s, m) => s + m.gps.lat, 0) / matches.length;
      const lng = matches.reduce((s, m) => s + m.gps.lng, 0) / matches.length;
      return { lat, lng, count: matches.length, minutes };
    }
  }
  return null;
}
// Combines the per-file suggestions of every currently-selected photo into one
// proposed spot - the common case is selecting several photos taken close
// together specifically because they share a location.
function gslSuggestionForSelection() {
  const files = [...selectedIds].map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  if (!files.length) return null;
  const perFile = files.map(f => ({ file: f, s: suggestLocationFor(f) })).filter(x => x.s);
  const suggestions = perFile.map(x => x.s);
  if (!suggestions.length) return null;
  const lat = suggestions.reduce((s, x) => s + x.lat, 0) / suggestions.length;
  const lng = suggestions.reduce((s, x) => s + x.lng, 0) / suggestions.length;
  const totalMatches = suggestions.reduce((s, x) => s + x.count, 0);
  const minutes = Math.min(...suggestions.map(x => x.minutes));
  return { lat, lng, totalMatches, minutes, perFile, withoutSuggestion: files.length - perFile.length };
}

function renderGsLocationStep() {
  if (!gsLocationRemaining().length) {
    toast('📍 All photos already have a location');
    gsAdvanceStep('done');
    return;
  }
  gsPickMode = true;
  clearSelection();
  locatePending = null;
  document.getElementById('guidedSort').classList.remove('open');
  document.getElementById('reliveDayPhotoPanel')?.classList.remove('open');
  if (globeOpen) initGlobe(); else toggleGlobe();
}
function renderGsLocatePanel() {
  const panel = document.getElementById('gsLocatePanel');
  if (!panel) return;
  const remaining = gsLocationRemaining();
  if (!remaining.length) {
    toast('📍 All photos now have a location');
    toggleGlobe(); // close branch (below) advances gsStep to 'done' and reopens the wizard there
    return;
  }
  panel.classList.add('open');
  panel.innerHTML = `
    <div class="rdp-head">
      <div class="rdp-title">📍 ${gsStepLabel('location').replace(/\.$/, '')}</div>
      <div class="rdp-sub">${remaining.length} photo${remaining.length!==1?'s have':' has'} no location. Select the ones taken in the same place, then click the globe to drop a pin - or use a 📍 suggestion below, guessed from other geotagged photos taken around the same time.</div>
    </div>
    <div class="gsl-suggest" id="gslSuggest" style="display:none"></div>
    <div class="rdp-grid" id="gslGrid"></div>
    <div class="gsl-bar">
      <span class="gsl-bar-info" id="gslBarInfo"></span>
      <button class="dump-banner-btn dump-sort-btn" id="gslConfirmBtn" onclick="confirmLocatePick()" disabled>📍 Set Location</button>
      <button class="dump-banner-btn" onclick="toggleGlobe()">Skip / Finish →</button>
    </div>`;
  const grid = document.getElementById('gslGrid');
  remaining.forEach(f => {
    const suggestion = suggestLocationFor(f);
    const item = document.createElement('div');
    item.className = 'rdp-item' + (selectedIds.has(f.id) ? ' selected' : '');
    item.innerHTML = `
      <div class="rdp-thumb thumb-loading" data-thumb-for="${f.id}">${getEmoji(f.ext)}</div>
      ${isVid(f.ext) ? '<span class="rdp-item-video">▶️</span>' : ''}
      ${suggestion ? `<span class="rdp-item-suggest" title="A photo geotagged within ${suggestion.minutes} min of this one suggests a nearby spot">📍</span>` : ''}`;
    item.onclick = () => {
      if (selectedIds.has(f.id)) selectedIds.delete(f.id); else selectedIds.add(f.id);
      item.classList.toggle('selected', selectedIds.has(f.id));
      updateGslBar();
    };
    grid.appendChild(item);
    gsObserveThumb(item.querySelector('.rdp-thumb'));
  });
  updateGslBar();
}
// Stages the suggested zone as the pending pin (same pending state a manual
// globe click sets) so the "Set Location" button can confirm it - the globe has
// already flown to and highlighted this exact spot by the time this is
// clickable, via the preview in updateGslBar() below, so there's nothing left
// to visually confirm here, just commit to it.
// With several photos selected, each gets its OWN suggested spot (they can be minutes and
// hundreds of metres apart on a walk) rather than all being stacked on the average, and that's
// committed straight away - the globe is already framing every one of them. Photos in the
// selection with no suggestion of their own stay selected, for a pin placed by hand.
async function gsUseSuggestedLocation() {
  const s = gslSuggestionForSelection();
  if (!s) return;
  if (selectedIds.size === 1) {
    locatePending = { lat: s.lat, lng: s.lng };
    updateGslBar();
    return;
  }
  let placed = 0;
  for (const { file, s: own } of s.perFile) {
    const ids = [file.id, ...(burstCoverMap.get(file.id)?.memberIds || [])];
    ids.forEach(id => { const f = appData.files.find(f => f.id === id); if (f) { setManualLocation(f, own.lat, own.lng); placed++; } });
  }
  await saveData();
  setTimeout(() => geocodeFiles(), 500);
  const leftIds = [...selectedIds].filter(id => !s.perFile.some(x => x.file.id === id));
  toast(`📍 Placed ${placed} file${placed!==1?'s':''} at ${placed!==1?'their':'its'} suggested spot${placed!==1?'s':''}` +
    (leftIds.length ? ` · ${leftIds.length} had no suggestion - pin ${leftIds.length!==1?'them':'it'} by hand` : ''));
  gslAfterConfirm();
  if (leftIds.length) {
    leftIds.forEach(id => selectedIds.add(id));
    document.querySelectorAll('#gslGrid .rdp-item').forEach(el => {
      const id = el.querySelector('[data-thumb-for]')?.dataset.thumbFor;
      if (id) el.classList.toggle('selected', selectedIds.has(id));
    });
    updateGslBar();
  }
}
// lat,lng (rounded) of whichever suggestion is currently shown on the globe -
// lets updateGslBar() below skip re-flying the camera when the suggestion for
// the selection hasn't actually changed, so clicking around doesn't keep
// yanking the view back to the same spot.
let gslPreviewedKey = null;
function updateGslBar() {
  const info = document.getElementById('gslBarInfo');
  const btn = document.getElementById('gslConfirmBtn');
  const suggestBox = document.getElementById('gslSuggest');
  if (!info || !btn) return;
  const n = selectedIds.size;
  info.textContent = n ? `${n} selected` : 'Select photos, then click the globe to drop a pin';
  btn.disabled = !(n > 0 && locatePending);
  btn.textContent = n > 1 ? `📍 Set Location for ${n}` : '📍 Set Location';

  const s = n ? gslSuggestionForSelection() : null;
  if (suggestBox) {
    if (s) {
      suggestBox.style.display = '';
      suggestBox.innerHTML = `
        <span>📍 ${n>1
          ? `${s.perFile.length} of these ${n} photos have a suggested spot, from photos taken within ${s.minutes} min of each - the globe frames them all.`
          : `${s.totalMatches} nearby photo${s.totalMatches!==1?'s':''} taken within ${s.minutes} min suggest a spot for this photo - see it highlighted on the globe.`}</span>
        <button class="dump-banner-btn dump-sort-btn" onclick="gsUseSuggestedLocation()">${n>1 ? `Place each at its spot →` : 'Use this spot →'}</button>`;
    } else {
      suggestBox.style.display = 'none';
    }
  }

  // Preview the suggested spot on the globe the moment one's available, without
  // committing to it (locatePending is untouched here) - the whole point is
  // seeing whether the guess actually looks right before deciding whether to
  // use it or place a pin yourself instead.
  if (s) {
    const key = s.lat.toFixed(5) + ',' + s.lng.toFixed(5);
    if (key !== gslPreviewedKey) {
      gslPreviewedKey = key;
      globeCtrl?.showHighlight(s.lat, s.lng);
      // Zooms in when you're far out, slides over when the spots are off screen, and never
      // zooms back out if you're already close in on them - see focusPoints in globe.js.
      globeCtrl?.focusPoints(s.perFile.map(x => x.s));
    }
  } else if (gslPreviewedKey !== null) {
    gslPreviewedKey = null;
    globeCtrl?.hideHighlight();
  }
}

// ── Done step ────────────────────────────────────────────────────────────────
function renderGsDoneStep() {
  const body = document.getElementById('gsBody');
  const bar = document.getElementById('gsBar');
  const total = gsBatch.length;
  body.innerHTML = `<div class="gs-empty"><div style="font-size:44px">🎉</div><div class="gs-intro" style="text-align:center"><strong>All done!</strong><br>You went through ${total} photo${total!==1?'s':''}. Mark this batch as sorted, or leave it in To Sort to revisit later.</div></div>`;
  bar.innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="exitGuidedSort()">Leave in To Sort</button>
    <button class="dump-banner-btn dump-sort-btn" onclick="gsFinishMarkSorted()">✓ Mark batch as sorted</button>`;
}
async function gsFinishMarkSorted() {
  gsBatch.forEach(id => { const f = appData.files.find(f => f.id === id); if (f) f.toSort = false; });
  await saveData();
  toast('✅ Batch marked as sorted');
  exitGuidedSort();
  // First time someone finishes a full pass (trip/people/category/camera/location all
  // addressed), point them at what the wizards don't cover - never shown again after this,
  // whether or not it's dismissed via "Got it", and mutable forever via "Don't show tips".
  showOneTimeTip('rightClickEdit', '💡 Right-click any photo for more - edit it, add or remove its location, file it into folders, and more.');
}

// One-time, dismissible contextual tips - each key fires at most once ever (tracked in
// appData.tipsShown), and "Don't show tips" mutes every future one permanently
// (appData.settings.tipsMuted). Deliberately not a generic tour/coachmark system: just the
// occasional well-timed nudge toward a feature a first-time user might not find on their own,
// never blocking, never repeating, always dismissible on the spot.
function showOneTimeTip(key, message) {
  if (appData.settings?.tipsMuted) return;
  if (!appData.tipsShown) appData.tipsShown = {};
  if (appData.tipsShown[key]) return;
  appData.tipsShown[key] = true;
  saveData();
  const c = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item toast-undo';
  const span = document.createElement('span');
  span.textContent = message;
  const gotIt = document.createElement('button');
  gotIt.className = 'toast-undo-btn';
  gotIt.textContent = 'Got it';
  gotIt.onclick = () => el.remove();
  const mute = document.createElement('button');
  mute.className = 'toast-undo-btn';
  mute.style.cssText = 'background:transparent;color:var(--text3)';
  mute.textContent = "Don't show tips";
  mute.onclick = () => { if (!appData.settings) appData.settings = {}; appData.settings.tipsMuted = true; saveData(); el.remove(); };
  el.append(span, gotIt, mute);
  c.appendChild(el);
  setTimeout(() => el.remove(), 12000);
}

// ── FIRST-RUN WIZARD ─────────────────────────────────────────────────────────
// Fires once, automatically, on a genuinely fresh install (appData.files.length === 0 in
// init()) - and any time after that from the sidebar's "Getting Started" button. Unlike
// Guided Sort (which sorts an existing toSort backlog), this one drives the files IN: it
// doesn't presume a trip up front (not everyone's first import is travel photos - could just
// be this summer's phone dump), so it asks "add files" first and only asks about a trip once
// there's something to ask about. Reuses Guided Sort's chip-row + multi-select grid pattern
// (gsRenderGrid/gsAppendCards, gsBarUpdater, gsOpenNamePrompt) rather than duplicating it.
let frOpen = false;
let frStep = 'welcome'; // 'language' | 'welcome' | 'goal' | 'size' | 'addfiles' | 'tripask' | 'tripcreate' | 'people' | 'categories' | 'tourIntro' | 'tourGlobe' | 'tourEditor' | 'tourDuplicate' | 'unlock' | 'rating' | 'ratingThanksGithub' | 'ratingFeedback' | 'done'
let frBatch = []; // every file id added during this wizard session - the full set that flows through People/Categories/Done, never narrowed by the trip sub-loop below
let frTripQueue = []; // files still awaiting a trip decision, working subset of frBatch - see frGoToTripAsk/frSubmitTripCreate
let frTripAskFollowup = false; // true when frRenderTripAsk is re-asking about leftovers from a date range that didn't cover the whole queue
let frCurrentTripId = null; // most recently created trip, or null if the user said "just everyday photos"
let frTripsThisSession = []; // {id,name,icon,count} for every trip created this session - a batch can span more than one, see frSubmitTripCreate
// Goal/size answers only steer THIS session's tour order and copy tone - never persisted, since
// the "Getting Started" sidebar re-open path skips straight to addfiles and never asks either.
let frGoal = null; // null | 'organize' | 'cleanup' | 'browse'
let frGoalSub = null; // null | 'dupes' | 'edited' | 'both' - only set when frGoal === 'cleanup'
let frLibrarySize = null; // null | 'quick' | 'thousands' | 'backlog' - pacing/reassurance copy only
const FR_IMPORT_CAP = 20; // hard cap on how many of this session's files flow into the interactive walkthrough - see frAddProcessedFiles
let frDeferredIds = []; // ids pushed to appData.files (toSort:true) beyond the cap, hidden from every tagging grid until the 'unlock' step reveals them
let frTourOrder = []; // ['globe','editor','duplicate'] reordered by frGoal and pruned of demos with nothing to show, built once by frBuildTourOrder()
let frTourIndex = 0;
let frDupDemoFileId = null; // the demo-copy file's id, set once frRunTourDuplicate() creates it
let frPendingResumeStep = null; // non-null while the Globe/Editor/Find Duplicates is showing over a hidden-but-still-open wizard - see frPauseWizard/frResumeWizardIfPending
let frRatingStars = null; // 0-5, transient per rating attempt
let frExtrasShownThisSession = false; // true once the tour/unlock/rating have been shown - guards a later "Add another trip" pass from re-showing them
const FR_GITHUB_URL = 'https://github.com/Gilouloum/Trove';
const FR_STEP_PCT = { language: 0, welcome: 2, goal: 6, size: 11, addfiles: 18, tripask: 30, tripcreate: 40, people: 50, categories: 58, orientation: 64, tourIntro: 69, tourGlobe: 76, tourEditor: 83, tourDuplicate: 90, unlock: 94, rating: 96, ratingThanksGithub: 98, ratingFeedback: 98, done: 100 };

// isFirstLaunch: true for the automatic open on an empty install (starts at Welcome); false
// for the persistent "Getting Started" sidebar button, which jumps straight to Add Files -
// a returning user already knows what the app does and may not have a trip at all.
function openFirstRunWizard(isFirstLaunch) {
  frOpen = true;
  frBatch = [];
  frTripQueue = [];
  frTripAskFollowup = false;
  frCurrentTripId = null;
  frTripsThisSession = [];
  frTagScopes = [];
  frTagScopeIndex = 0;
  frGoal = null;
  frGoalSub = null;
  frLibrarySize = null;
  frDeferredIds = [];
  frTourOrder = [];
  frTourIndex = 0;
  frDupDemoFileId = null;
  frPendingResumeStep = null;
  frRatingStars = null;
  frExtrasShownThisSession = false;
  frStep = isFirstLaunch ? 'language' : 'addfiles';
  clearSelection();
  document.getElementById('sidebar')?.classList.add('wizard-dimmed');
  document.getElementById('firstRunWizard').classList.add('open');
  frRender();
}
async function frFinish(navigate) {
  appData.onboardingCompleted = true;
  const tripId = frCurrentTripId;
  await saveData();
  document.getElementById('firstRunWizard').classList.remove('open');
  document.getElementById('sidebar')?.classList.remove('wizard-dimmed');
  frOpen = false;
  clearSelection();
  if (navigate) selectFolder(tripId || 'timeline');
  else renderSidebar();
}
function frClose() { frFinish(false); }
function frSkipAll() { frFinish(false); }
function frAdvance(step) {
  frStep = step;
  clearSelection();
  frRender();
}
function frRender() {
  const fill = document.getElementById('frProgressFill');
  if (fill) fill.style.width = (FR_STEP_PCT[frStep] ?? 0) + '%';
  if (frStep === 'language') frRenderLanguage();
  else if (frStep === 'welcome') frRenderWelcome();
  else if (frStep === 'goal') frRenderGoal();
  else if (frStep === 'size') frRenderSize();
  else if (frStep === 'addfiles') frRenderAddFiles();
  else if (frStep === 'tripask') frRenderTripAsk();
  else if (frStep === 'tripcreate') frRenderTripCreate();
  else if (frStep === 'people') frRenderPeopleStep();
  else if (frStep === 'categories') frRenderCategoriesStep();
  else if (frStep === 'orientation') frRenderOrientation();
  else if (frStep === 'tourIntro') frRenderTourIntro();
  else if (frStep === 'tourGlobe' || frStep === 'tourEditor' || frStep === 'tourDuplicate') frRenderTourStepIntro();
  else if (frStep === 'unlock') frRenderUnlockStep();
  else if (frStep === 'rating') frRenderRatingStep();
  else if (frStep === 'ratingThanksGithub') frRenderRatingThanksStep();
  else if (frStep === 'ratingFeedback') frRenderRatingFeedbackStep();
  else frRenderDoneStep();
}

// Shown once, first, only on a fresh install (isFirstLaunch) - the "Getting Started" sidebar
// re-open path skips straight to addfiles and never revisits this. Picking a language here
// applies it immediately (setLanguage() re-renders #frBody/#frBar too), so every following
// step - and the rest of the app - already reflects the choice by the time Welcome shows.
function frRenderLanguage() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🌐</div>
      <div class="gs-intro" style="max-width:420px"><strong>${t('langStepTitle')}</strong><br>${t('langStepBody')}</div>
      <div class="fr-choice-row" id="frLangChoices"></div>
    </div>`;
  const row = document.getElementById('frLangChoices');
  LANGUAGES.forEach(l => {
    const btn = document.createElement('button');
    btn.className = 'fr-choice-btn' + (currentLang === l.code ? ' selected' : '');
    btn.textContent = l.native;
    btn.onclick = () => setLanguage(l.code);
    row.appendChild(btn);
  });
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frAdvance('welcome')">${t('continueArrow')}</button>`;
}

function frRenderWelcome() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🔗</div>
      <div class="gs-intro" style="max-width:440px">${t('frWelcomeBody')}</div>
    </div>`;
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="frSkipAll()">${t('frWelcomeSkip')}</button>
    <button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frAdvance('goal')">${t('frWelcomeGo')}</button>`;
}

// ── Goal / library size questions ────────────────────────────────────────────
// Branches purely steer the hands-on tour's order and a little pacing copy - nobody is ever
// fully denied a feature based on the answer, see frBuildTourOrder().
const FR_GOALS = [
  { key: 'organize', icon: '🗂️', labelKey: 'frGoalOrganize' },
  { key: 'cleanup', icon: '🧹', labelKey: 'frGoalCleanup' },
  { key: 'browse', icon: '🌍', labelKey: 'frGoalBrowse' }
];
const FR_GOAL_SUBS = [
  { key: 'dupes', labelKey: 'frGoalSubDupes' },
  { key: 'edited', labelKey: 'frGoalSubEdited' },
  { key: 'both', labelKey: 'frGoalSubBoth' }
];
function frRenderGoal() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🧭</div>
      <div class="gs-intro" style="max-width:460px"><strong>${t('frGoalTitle')}</strong><br>${t('frGoalSub')}</div>
      <div class="fr-choice-row" id="frGoalChoices"></div>
      <div id="frGoalFollowup"></div>
    </div>`;
  const row = document.getElementById('frGoalChoices');
  FR_GOALS.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'fr-choice-btn' + (frGoal === g.key ? ' selected' : '');
    btn.textContent = `${g.icon} ${t(g.labelKey)}`;
    btn.onclick = () => frPickGoal(g.key);
    row.appendChild(btn);
  });
  frRenderGoalFollowup();
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn fr-cta" ${frGoal ? '' : 'disabled'} onclick="frGoalContinue()">${t('continueArrow')}</button>`;
}
function frPickGoal(key) {
  frGoal = key;
  if (key !== 'cleanup') frGoalSub = null;
  frRenderGoal();
}
function frRenderGoalFollowup() {
  const el = document.getElementById('frGoalFollowup');
  if (!el) return;
  if (frGoal !== 'cleanup') { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="fr-goal-followup">
      <div class="gs-intro" style="max-width:420px;margin-bottom:10px"><strong>${t('frGoalFollowupTitle')}</strong></div>
      <div class="fr-choice-row" id="frGoalSubChoices"></div>
    </div>`;
  const row = document.getElementById('frGoalSubChoices');
  FR_GOAL_SUBS.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'fr-choice-btn' + (frGoalSub === s.key ? ' selected' : '');
    btn.textContent = t(s.labelKey);
    btn.onclick = () => { frGoalSub = s.key; frRenderGoalFollowup(); };
    row.appendChild(btn);
  });
}
function frGoalContinue() {
  if (!frGoal) return;
  if (frGoal === 'cleanup' && !frGoalSub) frGoalSub = 'both'; // silently defaults rather than blocking on a sub-choice nobody's forced to make
  frAdvance('size');
}
const FR_SIZES = [
  { key: 'quick', icon: '📷', labelKey: 'frSizeQuick' },
  { key: 'thousands', icon: '🗃️', labelKey: 'frSizeThousands' },
  { key: 'backlog', icon: '📦', labelKey: 'frSizeBacklog' }
];
function frRenderSize() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">📊</div>
      <div class="gs-intro" style="max-width:420px"><strong>${t('frSizeTitle')}</strong></div>
      <div class="fr-choice-row" id="frSizeChoices"></div>
    </div>`;
  const row = document.getElementById('frSizeChoices');
  FR_SIZES.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'fr-choice-btn';
    btn.textContent = `${s.icon} ${t(s.labelKey)}`;
    btn.onclick = () => frPickSize(s.key);
    row.appendChild(btn);
  });
  document.getElementById('frBar').innerHTML = `<span class="gs-bar-info"></span>`;
}
function frPickSize(key) {
  frLibrarySize = key;
  frAdvance('addfiles');
}

// ── Add files step ───────────────────────────────────────────────────────────
function frRenderAddFiles() {
  const files = frBatch.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const backlogTip = frLibrarySize === 'backlog'
    ? t('frAddFilesTipBacklog', { cap: FR_IMPORT_CAP })
    : t('frAddFilesTipDefault');
  const body = document.getElementById('frBody');
  body.innerHTML = `
    <div id="frLasso" class="lasso"></div>
    <div class="gs-intro">${t('frAddFilesIntro', { tip: backlogTip })}</div>
    <div class="fr-dropzone" id="frDropzone" onclick="frPickFiles()">
      <div class="fr-dropzone-icon">📥</div>
      <div>${t('frDropzoneText')}</div>
    </div>
    ${frDeferredIds.length ? `<div class="fr-cap-note">${t('frCapNote', { cap: FR_IMPORT_CAP, n: frDeferredIds.length })}</div>` : ''}
    <div id="frAddFilesGrid"></div>`;
  if (files.length) body.querySelector('#frAddFilesGrid').appendChild(gsRenderGrid(files));
  const dz = document.getElementById('frDropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('fr-drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('fr-drag-over'));
  dz.addEventListener('drop', e => { e.stopPropagation(); frHandleDrop(e); });
  const barInfo = frDeferredIds.length
    ? t('frBarInfoDeferred', { files: files.length, cap: FR_IMPORT_CAP, deferred: frDeferredIds.length })
    : t('frBarInfoFiles', { n: files.length });
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info">${barInfo}</span>
    <button class="dump-banner-btn" onclick="frFinish(false)">${t('frSkipForNow')}</button>
    <button class="dump-banner-btn dump-sort-btn fr-cta" ${files.length?'':'disabled'} onclick="frGoToTripAsk()">${t('continueArrow')}</button>`;
}
// Starts (or restarts) the trip sub-loop over the current frBatch - frTripQueue is a working
// copy that shrinks as frSubmitTripCreate resolves date-matched subsets, while frBatch itself
// stays untouched so People/Categories/Done still see every file added this session.
function frGoToTripAsk() {
  frTripQueue = [...frBatch];
  frTripAskFollowup = false;
  frAdvance('tripask');
}
async function frPickFiles() {
  const newFiles = await window.api.openFileDialog();
  if (!newFiles || !newFiles.length) return;
  await frAddProcessedFiles(newFiles);
}
async function frHandleDrop(e) {
  e.preventDefault();
  document.getElementById('frDropzone')?.classList.remove('fr-drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  const paths = files.map(f => { try { return window.api.getPathForFile(f); } catch (err) { return f.path || ''; } }).filter(Boolean);
  if (!paths.length) { toast(t('frToastNoPaths')); return; }
  const dirs = [], flat = [];
  for (const p of paths) { if (await window.api.isDirectory(p).catch(() => false)) dirs.push(p); else flat.push(p); }
  const newFiles = [];
  for (const dir of dirs) {
    const res = await window.api.processDroppedFolder(dir).catch(() => null);
    if (res?.files?.length) newFiles.push(...res.files);
  }
  if (flat.length) newFiles.push(...await window.api.processDroppedPaths(flat));
  await frAddProcessedFiles(newFiles);
}
async function frAddProcessedFiles(newFiles) {
  const toAdd = newFiles.filter(nf => !appData.files.find(f => f.path === nf.path));
  if (!toAdd.length) { toast(t('frToastAlreadyInLibrary')); return; }
  // Stays true through the whole wizard, same as a normal dump - the wizard doesn't have its
  // own camera/location steps (Guided Sort does), and if the user closes the app partway
  // through tagging, these files must still be sitting in To Sort afterward, not scattered
  // into the main library half-tagged with no reminder to finish camera/location later.
  // Cumulative across every pick/drop made during this addfiles visit (frBatch only resets when
  // the wizard (re)opens) - only the first FR_IMPORT_CAP files ever flow into the interactive
  // walkthrough; everything past that still lands in appData.files with toSort:true immediately,
  // just hidden from the tagging grids and revealed later at the 'unlock' step.
  const room = Math.max(0, FR_IMPORT_CAP - frBatch.length);
  const forInteractive = toAdd.slice(0, room);
  const deferred = toAdd.slice(room);
  toAdd.forEach(nf => { nf.toSort = true; appData.files.push(nf); });
  frBatch.push(...forInteractive.map(f => f.id));
  frDeferredIds.push(...deferred.map(f => f.id));
  await autoCreateCameraFolders(toAdd);
  await saveData();
  queueForIndexing(toAdd);
  toast(deferred.length
    ? t('frToastAddedDeferred', { added: forInteractive.length, deferred: deferred.length })
    : t('frToastAdded', { n: toAdd.length }));
  setTimeout(() => geocodeFiles(), 1000);
  if (frOpen && frStep === 'addfiles') frRenderAddFiles();
}

// ── "Is this a trip?" step ───────────────────────────────────────────────────
function frRenderTripAsk() {
  const files = frTripQueue.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const clusters = buildDateClusters(frTripQueue);
  const explain = frTripAskFollowup
    ? t('frTripAskFollowupText', { n: files.length })
    : t('frTripAskDefaultText', { n: files.length });
  // A batch spanning more than one distinct date range (several trips, or trips + everyday
  // photos mixed together) makes a blind yes/no ambiguous - "yes" only asks for ONE trip's
  // dates at a time, so show the actual breakdown and say so explicitly, rather than leaving
  // the user to guess what a single answer covers.
  const breakdown = clusters.length > 1 ? `
    <div class="fr-cluster-list">
      ${clusters.map(c => `<div class="fr-cluster-row"><span>${formatDateRangeShort(c.start, c.end)}</span><span>${t('frClusterRow', { n: c.fileIds.length, match: c.match ? esc(c.match.name) : '' })}</span></div>`).join('')}
    </div>
    <div class="gs-intro" style="max-width:460px">${t('frClusterBreakdownIntro', { n: clusters.length })}</div>` : '';
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🏖️</div>
      <div class="gs-intro" style="max-width:460px"><strong>${t('frTripAskTitle')}</strong><br>${explain}</div>
      ${breakdown}
      <div class="fr-choice-row">
        <button class="fr-choice-btn fr-choice-primary fr-cta" onclick="frAdvance('tripcreate')">${t('frTripYes')}</button>
        <button class="fr-choice-btn" onclick="frTripAskNo()">${t('frTripNo')}</button>
      </div>
    </div>`;
  document.getElementById('frBar').innerHTML = `<span class="gs-bar-info"></span>`;
}
// "No" resolves the *entire* current queue as non-trip in one go - there's no further
// date-splitting to offer once the answer is "none of these are a trip."
function frTripAskNo() {
  frTripQueue = [];
  frEnterTagging();
}

// ── Create trip step ─────────────────────────────────────────────────────────
let frSelectedColor = COLORS[7]; // cyan - matches the trip default used everywhere else (addVacation etc.)
function frRenderColorSwatches() {
  const row = document.getElementById('frColorSwatches');
  if (!row) return;
  row.innerHTML = COLORS.map(c => `<div class="color-swatch${c===frSelectedColor?' selected':''}" style="background:${c}" onclick="frSelectedColor='${c}';frRenderColorSwatches()"></div>`).join('');
}
// Suggests a trip name from wherever most of the current queue's photos already have a known
// country - instant if they're already geocoded, otherwise one on-demand lookup for a single
// representative GPS point (routed through the same rate-limited queue as everything else,
// see main.js's runGeocodeQueue) rather than leaving the field blank just because the
// background pass hasn't reached these files yet. Never overwrites something the user typed.
async function frSuggestTripName() {
  const files = frTripQueue.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const counts = {};
  files.forEach(f => { if (f.country) counts[f.country] = (counts[f.country] || 0) + 1; });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const withGps = files.find(f => f.gps);
  if (!withGps) return null;
  try { return (await window.api.geocode(withGps.gps.lat, withGps.gps.lng))?.country || null; }
  catch (e) { return null; }
}
function frRenderTripCreate() {
  frSelectedColor = COLORS[frTripsThisSession.length % COLORS.length]; // cycles through the palette so trips created back-to-back this session don't default to the same color
  document.getElementById('frBody').innerHTML = `
    <div class="gs-intro">${t('frTripCreateIntro')}</div>
    <div class="input-row">
      <input class="text-input" id="frTripName" type="text" placeholder="${t('frTripNamePlaceholder')}" onkeydown="if(event.key==='Enter')frSubmitTripCreate()"/>
    </div>
    <div class="modal-sub" style="margin-bottom:6px">${t('frTripDatesSub')}</div>
    <div class="input-row">
      <input class="text-input" id="frTripDateStart" type="date"/>
      <span style="align-self:center;color:var(--text3);font-size:12px">${t('frDateRangeTo')}</span>
      <input class="text-input" id="frTripDateEnd" type="date"/>
    </div>
    <div class="modal-sub" style="margin-bottom:6px">${t('frTripColorSub')}</div>
    <div class="color-row" id="frColorSwatches"></div>`;
  frRenderColorSwatches();
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="frTripAskNo()">${t('frSkipTrip')}</button>
    <button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frSubmitTripCreate()">${t('frCreateTripContinue')}</button>`;
  setTimeout(() => document.getElementById('frTripName')?.focus(), 60);
  frSuggestTripName().then(name => {
    const input = document.getElementById('frTripName');
    if (name && input && !input.value.trim() && frStep === 'tripcreate') { input.value = name; input.select(); }
  });
}
async function frSubmitTripCreate() {
  const name = document.getElementById('frTripName').value.trim();
  if (!name) { document.getElementById('frTripName').focus(); return; }
  const s = document.getElementById('frTripDateStart').value;
  const e = document.getElementById('frTripDateEnd').value;
  const dateStart = s ? new Date(s + 'T00:00:00').getTime() : null;
  const dateEnd = e ? new Date(e + 'T00:00:00').getTime() : null;
  const folder = getOrCreateTripFolder(name, dateStart, dateEnd);
  folder.color = frSelectedColor;
  frCurrentTripId = folder.id;

  // A single Add Files batch can mix more than one trip (or trip + non-trip photos) - when
  // dates were entered, only file the photos that actually fall inside them (same slack window
  // as Guided Sort's date-based trip matching, gsBuildTripMatchClusters) rather than blindly
  // filing the whole queue just because the user said "yes" once. No dates entered means no
  // signal to split on, so the whole queue is filed as before.
  let matched = frTripQueue, leftover = [];
  if (dateStart) {
    const rangeStart = dateStart - GS_TRIP_CLUSTER_SLACK_MS;
    const rangeEnd = (dateEnd || dateStart) + GS_TRIP_CLUSTER_SLACK_MS;
    matched = []; leftover = [];
    frTripQueue.forEach(id => {
      const f = appData.files.find(f => f.id === id);
      (f?.fileDate && f.fileDate >= rangeStart && f.fileDate <= rangeEnd ? matched : leftover).push(id);
    });
    // Nothing had a matching date (e.g. no EXIF at all on any of them) - fall back to filing
    // the whole queue rather than creating a trip with zero photos in it.
    if (!matched.length) { matched = frTripQueue; leftover = []; }
  }
  await assignFilesToFolderAdditive(matched, folder.id);
  frTripsThisSession.push({ id: folder.id, name: folder.name, count: matched.length });

  frTripQueue = leftover;
  if (frTripQueue.length) { frTripAskFollowup = true; frAdvance('tripask'); }
  else frEnterTagging();
}

// ── People / Categories: tag scopes ─────────────────────────────────────────
// Once trips are resolved, People/Categories used to dump the WHOLE session's batch (could be
// hundreds of photos from several trips at once) into one grid - technically fine since a photo
// can carry more than one tag, but it reads as overwhelming right when the user just finished
// making sense of the same pile for trips. Splitting it back into the same per-trip groups (plus
// one "everyday" group for whatever wasn't filed to any trip) keeps each pass small and concrete
// - "tag people in your Iceland photos" instead of "tag people in all 900 photos at once."
let frTagScopes = []; // [{label, fileIds}], built once by frBuildTagScopes()
let frTagScopeIndex = 0;
function frBuildTagScopes() {
  const usedIds = new Set();
  const scopes = frTripsThisSession.map(trip => {
    const ids = frBatch.filter(id => appData.files.find(f => f.id === id)?.folders?.includes(trip.id));
    ids.forEach(id => usedIds.add(id));
    return { label: trip.name, fileIds: ids };
  }).filter(s => s.fileIds.length);
  const everyday = frBatch.filter(id => !usedIds.has(id));
  if (everyday.length) scopes.push({ label: scopes.length ? t('frEverydayPhotos') : '', fileIds: everyday });
  return scopes.length ? scopes : [{ label: '', fileIds: [...frBatch] }]; // nothing was ever filed to a trip - one scope covering everything, same as before this split existed
}
// Entry point into People (from either trip resolution path) - builds the scopes exactly once
// per wizard pass so re-rendering a step never rebuilds (and potentially reorders) them mid-tagging.
function frEnterTagging() {
  frTagScopes = frBuildTagScopes();
  frTagScopeIndex = 0;
  frAdvance('people');
}

// ── People step ──────────────────────────────────────────────────────────────
function frRenderPeopleStep() {
  const body = document.getElementById('frBody');
  const bar = document.getElementById('frBar');
  const root = getOrCreatePeopleRoot();
  const peopleChips = getFolderChipList(root.id);
  const scope = frTagScopes[frTagScopeIndex] || { label: '', fileIds: frBatch };
  const files = scope.fileIds.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const scopeNote = frTagScopes.length > 1 ? t('frScopeNote', { label: esc(scope.label), i: frTagScopeIndex + 1, n: frTagScopes.length }) : '';
  const explain = peopleChips.length ? t('frPeopleExplainHas') : t('frPeopleExplainNone');
  body.innerHTML = `
    <div id="frLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${t('frPeopleTitle', { scopeNote })}</strong> ${explain}</div>
    <div class="gs-chip-row" id="frPeopleChips"></div>`;
  const chipRow = document.getElementById('frPeopleChips');
  peopleChips.forEach(({ folder: p, label }) => {
    const chip = document.createElement('button');
    chip.className = 'gs-chip';
    chip.textContent = label;
    chip.onclick = () => frTagSelectedToPerson(p.id, p.name);
    chipRow.appendChild(chip);
  });
  const addChip = document.createElement('button');
  // Highlighted while it's the only option in the row (nobody tagged yet) - otherwise it's a
  // small dashed chip easy to miss entirely on a first visit, which is exactly what happened.
  addChip.className = 'gs-chip gs-chip-new' + (peopleChips.length ? '' : ' fr-chip-attn');
  addChip.textContent = t('frNewPerson');
  addChip.onclick = () => gsOpenNamePrompt('person', 'firstrun');
  chipRow.appendChild(addChip);
  body.appendChild(gsRenderGrid(files));
  const isLast = frTagScopeIndex >= frTagScopes.length - 1;
  gsBarUpdater = () => {
    const n = selectedIds.size;
    bar.querySelector('.gs-bar-info').textContent = n ? t('frBarSelectedPeople', { n }) : t('frBarBatchCount', { n: files.length });
  };
  bar.innerHTML = `<span class="gs-bar-info"></span><button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frPeopleContinue()">${isLast ? t('continueArrow') : t('frNextLabel', { label: esc(frTagScopes[frTagScopeIndex+1].label) })}</button>`;
  gsBarUpdater();
}
function frPeopleContinue() {
  const scope = frTagScopes[frTagScopeIndex];
  if (scope && !scope.fileIds.some(id => appData.files.find(f => f.id === id)?.folders?.some(fid => appData.folders.find(pf => pf.id === fid)?.parentId === getOrCreatePeopleRoot().id))) {
    if (!appData.tipsShown) appData.tipsShown = {};
    if (!appData.tipsShown.frPeopleNudgeShown) {
      appData.tipsShown.frPeopleNudgeShown = true;
      saveData();
      toast(t('frToastPeopleNudge'), 5000);
    }
  }
  if (frTagScopeIndex < frTagScopes.length - 1) { frTagScopeIndex++; frRenderPeopleStep(); }
  else { frTagScopeIndex = 0; frAdvance('categories'); }
}
async function frTagSelectedToPerson(folderId, name) {
  if (!selectedIds.size) { toast(t('frToastPickPhotosPerson')); return; }
  const ids = [...selectedIds];
  await assignFilesToFolderAdditive(ids, folderId);
  clearSelection();
  frRenderPeopleStep();
}

// ── Categories step ──────────────────────────────────────────────────────────
function frRenderCategoriesStep() {
  const body = document.getElementById('frBody');
  const bar = document.getElementById('frBar');
  const root = getOrCreateCategoryRoot();
  const catChips = getFolderChipList(root.id);
  const scope = frTagScopes[frTagScopeIndex] || { label: '', fileIds: frBatch };
  const files = scope.fileIds.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const scopeNote = frTagScopes.length > 1 ? t('frScopeNote', { label: esc(scope.label), i: frTagScopeIndex + 1, n: frTagScopes.length }) : '';
  body.innerHTML = `
    <div id="frLasso" class="lasso"></div>
    <div class="gs-intro"><strong>${t('frCategoriesTitle', { scopeNote })}</strong> ${t('frCategoriesExplain')}</div>
    <div class="gs-chip-row" id="frCategoryChips"></div>`;
  const chipRow = document.getElementById('frCategoryChips');
  catChips.forEach(({ folder: c, label }) => {
    const chip = document.createElement('button');
    chip.className = 'gs-chip';
    chip.textContent = `${c.icon||'🏷️'} ${label}`;
    chip.onclick = () => frTagSelectedToCategory(c.id, c.name);
    chipRow.appendChild(chip);
  });
  const existingNames = new Set(catChips.map(c => c.folder.name.toLowerCase()));
  STARTER_CATEGORIES.filter(c => !existingNames.has(c.name.toLowerCase())).forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'gs-chip gs-chip-new';
    chip.textContent = `+ ${c.icon} ${c.name}`;
    chip.onclick = () => { const f = getOrCreateCategoryFolder(c.name); f.icon = c.icon; frTagSelectedToCategory(f.id, f.name); };
    chipRow.appendChild(chip);
  });
  const addChip = document.createElement('button');
  addChip.className = 'gs-chip gs-chip-new';
  addChip.textContent = t('frCustomEllipsis');
  addChip.onclick = () => gsOpenNamePrompt('category', 'firstrun');
  chipRow.appendChild(addChip);
  body.appendChild(gsRenderGrid(files));
  const isLast = frTagScopeIndex >= frTagScopes.length - 1;
  gsBarUpdater = () => {
    const n = selectedIds.size;
    bar.querySelector('.gs-bar-info').textContent = n ? t('frBarSelectedCategories', { n }) : t('frBarBatchCount', { n: files.length });
  };
  bar.innerHTML = `<span class="gs-bar-info"></span><button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frCategoriesContinue()">${isLast ? t('frFinishArrow') : t('frNextLabel', { label: esc(frTagScopes[frTagScopeIndex+1].label) })}</button>`;
  gsBarUpdater();
}
function frCategoriesContinue() {
  if (frTagScopeIndex < frTagScopes.length - 1) { frTagScopeIndex++; frRenderCategoriesStep(); }
  else {
    frTagScopeIndex = 0;
    if (frExtrasShownThisSession) { frAdvance('done'); return; } // a later "Add another trip" pass - never re-show the tour or re-ask for a rating
    if (!frBatch.length) { frAdvance('rating'); return; } // nothing was ever added (e.g. wizard reopened straight into tagging with an empty batch) - nothing to tour
    frTourOrder = frBuildTourOrder();
    frTourIndex = 0;
    frExtrasShownThisSession = true;
    frAdvance('orientation');
  }
}
async function frTagSelectedToCategory(folderId, name) {
  if (!selectedIds.size) { toast(t('frToastPickPhotosCategory')); return; }
  const ids = [...selectedIds];
  await assignFilesToFolderAdditive(ids, folderId);
  clearSelection();
  frRenderCategoriesStep();
}

// ── Hands-on feature tour ─────────────────────────────────────────────────────
// Everybody gets all three demos - frGoal only reorders them, it never removes one, so nobody
// is denied a flagship feature based on an answer. Each demo pauses the wizard (hides the
// overlay without closing it, frOpen stays true) and opens the REAL Globe/Editor/Find Duplicates
// screen, exactly as a user would from the toolbar - not a scripted fake. Closing that real
// screen (its own ✕/Escape/resolve action) calls frResumeWizardIfPending(), which is hooked
// into toggleGlobe()'s close branch, closePhotoEditor(), and closeDupMode().

// ── Orientation (sidebar, filter, sort, add files) ───────────────────────────
// The wizard dims and disables the sidebar/toolbar behind it (see .wizard-dimmed), so this is
// necessarily a "look, don't touch" explainer rather than a real hands-on step like the tour
// below - there's nothing live to click yet.
function frRenderOrientation() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🧭</div>
      <div class="gs-intro" style="max-width:480px"><strong>${t('frOrientationTitle')}</strong><br>${t('frOrientationSub')}</div>
      <div class="fr-orient-grid">
        <div class="fr-orient-item"><div class="fr-orient-icon">📁</div><div><div class="fr-orient-title">${t('frOrientSidebarTitle')}</div><div class="fr-orient-desc">${t('frOrientSidebarDesc')}</div></div></div>
        <div class="fr-orient-item"><div class="fr-orient-icon">🔍</div><div><div class="fr-orient-title">${t('frOrientFilterTitle')}</div><div class="fr-orient-desc">${t('frOrientFilterDesc')}</div></div></div>
        <div class="fr-orient-item"><div class="fr-orient-icon">↕️</div><div><div class="fr-orient-title">${t('frOrientSortTitle')}</div><div class="fr-orient-desc">${t('frOrientSortDesc')}</div></div></div>
        <div class="fr-orient-item"><div class="fr-orient-icon">➕</div><div><div class="fr-orient-title">${t('frOrientAddTitle')}</div><div class="fr-orient-desc">${t('frOrientAddDesc')}</div></div></div>
      </div>
      <button class="fr-choice-btn fr-choice-primary fr-cta fr-big-cta" onclick="frOrientationContinue()">${t('frGotIt')}</button>
    </div>`;
  document.getElementById('frBar').innerHTML = `<span class="gs-bar-info"></span>`;
}
function frOrientationContinue() { frAdvance('tourIntro'); }

const FR_TOUR_STEP = { globe: 'tourGlobe', editor: 'tourEditor', duplicate: 'tourDuplicate' };
function frBuildTourOrder() {
  let order = frGoal === 'cleanup' ? ['duplicate', 'editor', 'globe']
    : frGoal === 'browse' ? ['globe', 'editor', 'duplicate']
    : ['editor', 'globe', 'duplicate']; // 'organize', or no goal answered
  const hasEditable = frBatch.some(id => isEditable(appData.files.find(f => f.id === id)?.ext));
  if (!hasEditable) order = order.filter(k => k !== 'editor'); // nothing to demo the editor with - skip, don't show a dead step
  return order;
}
function frRenderTourIntro() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🎬</div>
      <div class="gs-intro" style="max-width:440px"><strong>${t('frTourIntroTitle')}</strong><br>${t('frTourIntroSub')}</div>
      <button class="fr-choice-btn fr-choice-primary fr-cta fr-big-cta" onclick="frStartTour()">${t('frStartTour')}</button>
    </div>`;
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="frSkipTour()">${t('frSkipTour')}</button>`;
}
function frStartTour() { frTourIndex = 0; frAdvanceToTourStep(); }
function frSkipTour() { frTourIndex = frTourOrder.length; frTourAllDone(); }
function frAdvanceToTourStep() {
  if (frTourIndex >= frTourOrder.length) { frTourAllDone(); return; }
  frAdvance(FR_TOUR_STEP[frTourOrder[frTourIndex]]);
}
function frTourContinue() { frTourIndex++; frAdvanceToTourStep(); }
function frTourAllDone() { frAdvance(frDeferredIds.length ? 'unlock' : 'rating'); }
function frRenderTourStepIntro() {
  const key = frTourOrder[frTourIndex];
  const dots = frTourOrder.map((k, i) => `<span class="gs-step-dot${i === frTourIndex ? ' active' : i < frTourIndex ? ' done' : ''}"></span>`).join('');
  let icon, title, body, runFn, btnLabel;
  if (key === 'globe') {
    const trip = frTripsThisSession.length ? buildTripMarkers().find(m => m.id === frCurrentTripId) : null;
    icon = '🌍'; title = t('frTourGlobeTitle');
    body = (trip ? t('frTourGlobeBodyTrip') : t('frTourGlobeBodyNoTrip')) + t('frTourGlobeBodySuffix');
    runFn = 'frRunTourGlobe'; btnLabel = t('frTourGlobeBtn');
  } else if (key === 'editor') {
    const file = frBatch.map(id => appData.files.find(f => f.id === id)).find(f => f && isEditable(f.ext));
    icon = '🎨'; title = t('frTourEditorTitle');
    body = t('frTourEditorBody', { file: esc(file?.name || t('frDefaultPhoto')) });
    runFn = 'frRunTourEditor'; btnLabel = t('frTourEditorBtn');
  } else {
    const file = frBatch.map(id => appData.files.find(f => f.id === id)).find(Boolean);
    icon = '🔁'; title = t('frTourDuplicateTitle');
    body = t('frTourDuplicateBody', { file: esc(file?.name || t('frDefaultPhoto')) });
    runFn = 'frRunTourDuplicate'; btnLabel = t('frTourDuplicateBtn');
  }
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-tour-dots">${dots}</div>
      <div class="fr-hero-icon">${icon}</div>
      <div class="gs-intro" style="max-width:460px"><strong>${title}</strong><br>${body}</div>
      <button class="fr-choice-btn fr-choice-primary fr-cta fr-big-cta" onclick="${runFn}()">${btnLabel} →</button>
    </div>`;
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="frTourContinue()">${t('frSkipThis')}</button>`;
}
// Hides the wizard overlay without ending it (frOpen stays true) so a real full-screen feature
// can show through - mirrors this codebase's existing gsOpen/vpReturnTo pause-resume precedents.
function frPauseWizard(resumeFn) {
  frPendingResumeStep = resumeFn;
  document.getElementById('firstRunWizard').classList.remove('open');
  document.getElementById('sidebar')?.classList.remove('wizard-dimmed');
}
function frResumeWizardIfPending() {
  if (!frOpen || !frPendingResumeStep) return;
  const fn = frPendingResumeStep;
  frPendingResumeStep = null;
  document.getElementById('firstRunWizard').classList.add('open');
  document.getElementById('sidebar')?.classList.add('wizard-dimmed');
  if (typeof window[fn] === 'function') window[fn]();
}
async function frRunTourGlobe() {
  const trip = frTripsThisSession.length ? buildTripMarkers().find(m => m.id === frCurrentTripId) : null;
  frPauseWizard('frTourContinue');
  if (!globeOpen) toggleGlobe();
  if (trip) {
    // Cold Cesium load is async and toggleGlobe() doesn't expose a promise - poll rather than
    // assume synchronous init (ctxSeeOnMap's fly-to is known to silently no-op on a cold load).
    for (let i = 0; i < 50 && !globeCtrl; i++) await new Promise(r => setTimeout(r, 150));
    try { globeCtrl?.flyToBounds(trip.bounds); } catch (e) {}
  }
}
function frRunTourEditor() {
  const file = frBatch.map(id => appData.files.find(f => f.id === id)).find(f => f && isEditable(f.ext));
  if (!file) { frTourContinue(); return; }
  frPauseWizard('frTourContinue');
  openPhotoEditor(file.id);
}
async function frRunTourDuplicate() {
  const file = frBatch.map(id => appData.files.find(f => f.id === id)).find(Boolean);
  if (!file) { frTourContinue(); return; }
  const res = await window.api.duplicateFile(file.path);
  if (!res?.success) { toast(t('frToastDupCopyFailed')); frTourContinue(); return; }
  res.entry.toSort = true; // same convention every other freshly-added file follows, so it's findable in To Sort if the user keeps it
  appData.files.push(res.entry);
  frDupDemoFileId = res.entry.id;
  await saveData();
  frPauseWizard('frTourContinue');
  enterDupDetection();
}

// ── Unlock step (only when files were deferred past the import cap) ─────────
function frRenderUnlockStep() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🎁</div>
      <div class="gs-intro" style="max-width:420px"><strong>${t('frUnlockTitle')}</strong><br>${t('frUnlockBody', { n: frDeferredIds.length })}</div>
      <div class="fr-choice-row">
        <button class="fr-choice-btn" onclick="frGoToSort()">${t('frUnlockTakeMe')}</button>
        <button class="fr-choice-btn fr-choice-primary fr-cta" onclick="frUnlockContinue()">${t('continueArrow')}</button>
      </div>
    </div>`;
  document.getElementById('frBar').innerHTML = `<span class="gs-bar-info"></span>`;
}
function frUnlockContinue() { frAdvance('rating'); }

// ── Rating / review step ─────────────────────────────────────────────────────
function frRenderRatingStep() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">💬</div>
      <div class="gs-intro" style="max-width:380px"><strong>${t('frRatingTitle')}</strong></div>
      <div class="fr-star-row" id="frStarRow"></div>
    </div>`;
  const row = document.getElementById('frStarRow');
  for (let n = 5; n >= 1; n--) {
    const btn = document.createElement('button');
    btn.className = 'fr-star';
    btn.textContent = '★';
    btn.title = t('frStarTitle', { n });
    btn.onclick = () => frSubmitRating(n);
    row.appendChild(btn);
  }
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="frSkipRating()">${t('frSkip')}</button>`;
}
function frSubmitRating(n) {
  frRatingStars = n;
  frAdvance(n >= 4 ? 'ratingThanksGithub' : 'ratingFeedback');
}
function frSkipRating() { frAdvance('done'); }
function frRenderRatingThanksStep() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🙌</div>
      <div class="gs-intro" style="max-width:420px"><strong>${t('frRatingThanksTitle')}</strong><br>${t('frRatingThanksBody')}</div>
      <div class="fr-choice-row">
        <button class="fr-choice-btn fr-choice-primary fr-cta" onclick="frOpenGithubStar()">${t('frStarGithub')}</button>
      </div>
    </div>`;
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frAdvance('done')">${t('continueArrow')}</button>`;
}
function frOpenGithubStar() { window.api.openExternal(FR_GITHUB_URL); }
function frRenderRatingFeedbackStep() {
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">📝</div>
      <div class="gs-intro" style="max-width:420px"><strong>${t('frFeedbackTitle')}</strong><br>${t('frFeedbackBody')}</div>
      <textarea id="frFeedbackText" class="text-input" style="width:100%;max-width:420px;min-height:90px;resize:vertical;font-family:inherit" placeholder="${t('frFeedbackPlaceholder')}"></textarea>
    </div>`;
  document.getElementById('frBar').innerHTML = `
    <span class="gs-bar-info"></span>
    <button class="dump-banner-btn" onclick="frSkipFeedback()">${t('frSkip')}</button>
    <button class="dump-banner-btn dump-sort-btn fr-cta" onclick="frSubmitFeedback()">${t('frSendFeedback')}</button>`;
}
function frSubmitFeedback() {
  const text = document.getElementById('frFeedbackText')?.value.trim();
  if (!text) { frSkipFeedback(); return; }
  if (!appData.feedbackLog) appData.feedbackLog = [];
  appData.feedbackLog.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), stars: frRatingStars, text });
  saveData();
  toast(t('frFeedbackThanksToast'));
  frAdvance('done');
}
function frSkipFeedback() { frAdvance('done'); }

// ── Done step ────────────────────────────────────────────────────────────────
function frRenderDoneStep() {
  const files = frBatch.map(id => appData.files.find(f => f.id === id)).filter(Boolean);
  const peopleRoot = getOrCreatePeopleRoot();
  const peopleTaggedCount = files.filter(f => f.folders?.some(fid => appData.folders.find(pf => pf.id === fid)?.parentId === peopleRoot.id)).length;
  let tripPhrase = '';
  if (frTripsThisSession.length === 1) {
    const trip = frTripsThisSession[0];
    const folder = appData.folders.find(f => f.id === trip.id);
    tripPhrase = t('frTripPhraseSingle', { name: esc(trip.name), yearSuffix: folder ? formatTripYearSuffix(folder) : '' });
  } else if (frTripsThisSession.length > 1) {
    tripPhrase = t('frTripPhraseMulti', { n: frTripsThisSession.length, names: frTripsThisSession.map(trip => esc(trip.name)).join(', ') });
  }
  const toured = frTourOrder.length > 0; // false only in the edge case where frBatch was empty and the tour never ran
  const unlockPhrase = frDeferredIds.length ? t('frUnlockPhrase', { n: frDeferredIds.length }) : '';
  const peoplePhrase = peopleTaggedCount ? t('frPeoplePhrase', { n: peopleTaggedCount }) : '';
  const tipsRow = toured
    ? `<button class="fr-tip-btn" onclick="frGoTo('enterDupDetection')">${t('frTipFindDuplicates')}</button>`
    : `<button class="fr-tip-btn" onclick="frGoTo('enterDupDetection')">${t('frTipFindDuplicates')}</button>
       <button class="fr-tip-btn" onclick="frGoTo('toggleGlobe')">${t('frTipExploreGlobe')}</button>`;
  const tipsList = toured
    ? `<li>${t('frTipSearch')}</li>
       <li>${t('frTipBestOf')}</li>
       <li>${t('frTipTagMore')}</li>`
    : `<li>${t('frTipToSort')}</li>
       <li>${t('frTipTagMore')}</li>
       <li>${t('frTipColors')}</li>`;
  document.getElementById('frBody').innerHTML = `
    <div class="fr-hero">
      <div class="fr-hero-icon">🎉</div>
      <div class="gs-intro" style="max-width:440px"><strong>${t('frDoneTitle')}</strong><br>${t('frDoneBody', { n: files.length, tripPhrase, peoplePhrase, unlockPhrase })}</div>
      <div class="fr-choice-row">
        <button class="fr-choice-btn" onclick="frAddAnotherTrip()">${t('frAddAnotherTrip')}</button>
        <button class="fr-choice-btn" onclick="frFinish(true)">${frTripsThisSession.length ? t('frViewTrip') : t('frBrowseLibrary')}</button>
        <button class="fr-choice-btn fr-choice-primary fr-cta" onclick="frGoToSort()">${t('frFinishToSort')}</button>
      </div>
      <div class="fr-tips">
        <div class="fr-tips-title">${t('frTipsTitle')}</div>
        <div class="fr-tips-row">${tipsRow}</div>
        <ul class="fr-tips-list">${tipsList}</ul>
      </div>
    </div>`;
  document.getElementById('frBar').innerHTML = `<span class="gs-bar-info"></span>`;
  frShowDoneConfetti();
}
// One-shot celebration burst, pure CSS/DOM, no library. Respects prefers-reduced-motion and
// removes itself once the animation finishes so it never lingers as dead markup.
function frShowDoneConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = document.getElementById('firstRunWizard');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'fr-confetti';
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'fr-confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    el.appendChild(piece);
  }
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
// Closes the wizard, then jumps straight into another feature - used by the Done step's tips
// so "Find Duplicates" etc. don't require exiting the wizard manually first.
async function frGoTo(fnName) {
  await frFinish(false);
  if (typeof window[fnName] === 'function') window[fnName]();
}
async function frGoToSort() {
  await frFinish(false);
  const el = document.querySelector('[data-folder="to-sort"]');
  selectFolder('to-sort', el);
}
function frAddAnotherTrip() {
  frBatch = [];
  frTripQueue = [];
  frTripAskFollowup = false;
  frCurrentTripId = null;
  frTripsThisSession = [];
  frTagScopes = [];
  frTagScopeIndex = 0;
  frDeferredIds = []; // fresh 20-file budget for this new batch
  // Deliberately NOT reset: frExtrasShownThisSession, frGoal/frGoalSub/frLibrarySize, frRatingStars -
  // a second "add another trip" pass never re-shows the tour or re-asks for a rating, see frCategoriesContinue().
  frAdvance('addfiles');
}

// ── SMART MATCH ──────────────────────────────────────────────────────────────
// A separate, deliberately slower companion to Guided Sort's Auto-Group step: instead of a
// grid of suggestion cards for bulk-confirming many at once, this reviews one file at a time,
// shown large, only for files main.js's smart-match-suggest is very confident about (see
// SMART_MATCH_MIN_SCORE there - much stricter than Auto-Group's already-conservative bar,
// on purpose: the whole point is the user doing almost nothing but confirming, so a wrong
// suggestion here costs more trust than a missed one). Always user-initiated from the To Sort
// banner - never a popup, never automatic - and every suggestion is toggleable, never applied
// until "Confirm & Next."
let smOpen = false;
let smQueue = []; // [{file, suggestions:[{folderId,folderName,score}]}] - only files with >=1 confident match
let smIndex = 0;
let smChecked = new Set(); // folder ids currently checked for the file on screen
let smConfirmedCount = 0;

async function enterSmartMatch() {
  const toSortFiles = appData.files.filter(f => f.toSort && isMedia(f.ext) && !f._missing && !f.isLivePhotoVideo);
  if (!toSortFiles.length) { toast('📥 Nothing in To Sort right now'); return; }
  toast('✨ Checking for confident matches…', 2000);
  await embedBatchNow(toSortFiles); // usually already embedded via the background pass - this just covers anything that isn't yet
  const results = await window.api.smartMatchSuggest(toSortFiles.map(f => f.id)).catch(() => []);
  if (!results.length) { toast('🤷 No confident matches yet - the more you sort, the smarter this gets'); return; }
  smQueue = results.map(r => ({ file: appData.files.find(f => f.id === r.id), suggestions: r.suggestions })).filter(e => e.file);
  smIndex = 0;
  smConfirmedCount = 0;
  smOpen = true;
  document.getElementById('smartMatch').classList.add('open');
  renderSmartMatchStep();
}

function renderSmartMatchStep() {
  const entry = smQueue[smIndex];
  if (!entry) { smFinish(); return; }
  const { file, suggestions } = entry;
  smChecked = new Set(file.folders || []);
  suggestions.forEach(s => smChecked.add(s.folderId)); // confident suggestions start pre-checked
  document.getElementById('smProgress').textContent = `${smIndex + 1} of ${smQueue.length}`;
  document.getElementById('smBody').innerHTML = `
    <div class="sm-stage">
      <img class="sm-img" id="smImg" alt="${esc(file.name)}"/>
      ${isVid(file.ext) ? '<div class="video-badge sm-video-badge">▶ VIDEO</div>' : ''}
    </div>
    <div class="sm-panel">
      <div class="sm-filename">${esc(file.name)}</div>
      <div class="sm-sub">✨ Suggested from how you've already sorted similar photos - tap to add or remove.</div>
      <div class="sm-folder-list" id="smFolderList"></div>
    </div>`;
  loadSmartMatchImage(file);
  renderSmFolderList();
  document.getElementById('smBar').innerHTML = `
    <span class="gs-bar-info">${suggestions.length} suggestion${suggestions.length!==1?'s':''}</span>
    <button class="dump-banner-btn" onclick="smSkip()">Skip</button>
    <button class="dump-banner-btn dump-sort-btn fr-cta" onclick="smConfirmNext()">✓ Confirm & Next →</button>`;
}
// Guards against a slow image load landing after the user has already moved to a different
// file (Next/Skip clicked before the previous photo's preview finished fetching).
async function loadSmartMatchImage(file) {
  const requestedId = file.id;
  const url = isVid(file.ext) ? await getThumb(file) : ((await getPreviewImage(file)) || await getThumb(file));
  if (!smOpen || smQueue[smIndex]?.file.id !== requestedId) return;
  const img = document.getElementById('smImg');
  if (img) img.src = url || '';
}
function renderSmFolderList() {
  const entry = smQueue[smIndex];
  const list = document.getElementById('smFolderList');
  if (!entry || !list) return;
  list.innerHTML = '';
  const byId = new Map();
  (entry.file.folders || []).forEach(id => { const f = appData.folders.find(x => x.id === id); if (f) byId.set(id, { folder: f, suggested: false }); });
  entry.suggestions.forEach(s => { const f = appData.folders.find(x => x.id === s.folderId); if (f) byId.set(s.folderId, { folder: f, suggested: true }); });
  byId.forEach(({ folder, suggested }, id) => {
    const chip = document.createElement('button');
    const checked = smChecked.has(id);
    chip.className = 'sm-folder-chip' + (checked ? ' checked' : '');
    chip.innerHTML = `${checked ? '✓ ' : ''}${esc(folderEmojiPrefix(folder))}${esc(folder.name)}${suggested ? ' <span class="sm-ai-badge">✨</span>' : ''}`;
    chip.onclick = () => { checked ? smChecked.delete(id) : smChecked.add(id); renderSmFolderList(); };
    list.appendChild(chip);
  });
}
async function smConfirmNext() {
  const entry = smQueue[smIndex];
  entry.file.folders = [...smChecked];
  await saveData();
  smConfirmedCount++;
  smAdvance();
}
function smSkip() { smAdvance(); }
function smAdvance() {
  smIndex++;
  if (smIndex >= smQueue.length) smFinish();
  else renderSmartMatchStep();
}
function smFinish() {
  document.getElementById('smartMatch').classList.remove('open');
  smOpen = false;
  toast(smConfirmedCount ? `🎉 Sorted ${smConfirmedCount} photo${smConfirmedCount !== 1 ? 's' : ''}!` : 'Done reviewing');
  renderSidebar();
  renderFiles();
}
function exitSmartMatch() {
  document.getElementById('smartMatch').classList.remove('open');
  smOpen = false;
  renderSidebar();
  renderFiles();
}

// ── PHOTO EDITOR ─────────────────────────────────────────────────────────────
// Non-destructive: the original file is never opened for writing. All adjustments
// live in file.edits and are composited live in a WebGL shader; a new file is only
// ever written on explicit Export. One shared shader does every Phase-1 adjustment
// in a single GPU pass so slider dragging stays smooth regardless of photo size.
const PE_ADJUSTMENTS = [
  { key:'exposure',   label:'Exposure' },
  { key:'contrast',   label:'Contrast' },
  { key:'highlights', label:'Highlights' },
  { key:'shadows',    label:'Shadows' },
  { key:'whites',     label:'Whites' },
  { key:'blacks',     label:'Blacks' },
  { key:'saturation', label:'Saturation' },
  { key:'vibrance',   label:'Vibrance' },
  { key:'temp',       label:'Temp' },
  { key:'tint',       label:'Tint' }
];
// Listed under Tint in the Light section and stored in the same adjustments object, but kept
// out of PE_ADJUSTMENTS on purpose: these look at neighbouring pixels or at where a pixel sits
// in the frame, which only the whole-photo pass can do. Local mask layers and PhotoMod's
// per-layer colours run the per-pixel tone math only, so they never get these sliders.
const PE_EFFECTS = [
  { key:'clarity',    label:'Clarity' },
  { key:'dehaze',     label:'Dehaze' },
  { key:'sharpness',  label:'Sharpness', min:0 },
  { key:'vignette',   label:'Vignette' },
  { key:'grain',      label:'Grain',     min:0 }
];
function peDefaultAdjustments() {
  const o = {};
  PE_ADJUSTMENTS.forEach(a => { o[a.key] = 0; });
  PE_EFFECTS.forEach(a => { o[a.key] = 0; });
  return o;
}

// ── Local (masked) adjustment layers ────────────────────────────────────────
// Each layer gets its own copy of the same 10 PE_ADJUSTMENTS keys - not curves, not HSL,
// an intentional v1 scope line (see the plan). id is stable/independent of array index so
// deleting or reordering layers never confuses which mask a saved id refers to.
function peNewLocalLayerId() { return 'ml_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
function peDefaultLocalLayer() {
  return { id: peNewLocalLayerId(), name: 'Mask', visible: true, maskType: 'brush', maskDataUrl: null, invert: false, amount: 100, adjustments: peDefaultAdjustments() };
}
// Builds live, editable layer objects - preserves _maskCanvas (an in-memory decoded-bitmap
// cache, never persisted) when the input already carries one, e.g. from peRotateLocalLayers.
function peCloneLocalLayers(layers) {
  if (!Array.isArray(layers)) return [];
  return layers.map(l => Object.assign(peDefaultLocalLayer(), {
    id: l.id || peNewLocalLayerId(),
    name: l.name || 'Mask',
    visible: l.visible !== false,
    maskDataUrl: l.maskDataUrl || null,
    invert: !!l.invert,
    amount: Number.isFinite(l.amount) ? l.amount : 100,
    adjustments: Object.assign(peDefaultAdjustments(), l.adjustments || {}),
    _maskCanvas: l._maskCanvas || null
  }));
}
// Builds the plain-data array written into file.edits.localLayers - strips _maskCanvas (a
// Canvas element, not JSON-safe) and drops any layer that was never actually painted on.
function peSerializeLocalLayers(layers) {
  return (layers || []).filter(l => l.maskDataUrl).map(l => ({
    id: l.id, name: l.name, visible: l.visible, maskType: 'brush',
    maskDataUrl: l.maskDataUrl, invert: l.invert, amount: l.amount,
    adjustments: Object.assign({}, l.adjustments)
  }));
}
// Copies any drawable (canvas or decoded <img>) into a fresh same-size offscreen canvas.
function peCopyCanvas(src, w, h) {
  const width = w || src.naturalWidth || src.width;
  const height = h || src.naturalHeight || src.height;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d').drawImage(src, 0, 0, width, height);
  return c;
}

// ── Layer stack (the Photoshop half) ────────────────────────────────────────
// Discrete bitmaps stacked ABOVE the photo - pasted images today, cutouts/text later - each
// with its own position, scale, opacity and visibility. Deliberately NOT a rasterized
// document: the photo underneath stays the untouched original plus a recipe in file.edits, so
// version linking and "Find Edited" keep working and no edit is ever destructive. Layers are
// stored bottom-first (array order == paint order); the Layers panel shows them reversed, the
// way every layer UI does. Composited onto #peLayersCanvas, a plain 2D overlay sitting on top
// of the WebGL base - see peCompositeLayers/peCompositeCanvas.
const PE_LAYER_LIMIT = 24; // guard against a runaway paste loop bloating file.edits with base64 PNGs
// Canvas' own compositing operations, under the names every editor uses for them.
const PE_BLEND_MODES = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
  ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']
];
function peNewLayerIdent() { return 'lyr_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
function peDefaultLayer() {
  return {
    id: peNewLayerIdent(), name: 'Layer', visible: true, opacity: 100, blend: 'source-over',
    x: 0, y: 0, scale: 100, rotation: 0, text: null, dataUrl: null, _bitmap: null,
    clipped: false, // true = masked by the layer beneath it (a clipping group)
    colors: null    // per-layer adjustments/curves/HSL, null until the user opens Colours on it
  };
}
// Only allocated when someone actually edits a layer's colours - a null stays null through
// serialization, so an untouched layer costs nothing in the saved document.
function pmDefaultLayerColors() {
  return { adjustments: peDefaultAdjustments(), curves: peDefaultCurves(), hsl: peDefaultHsl() };
}
function pmLayerColorsAreDefault(c) {
  if (!c) return true;
  const adjDefault = PE_ADJUSTMENTS.every(a => !c.adjustments[a.key]);
  const curveDefault = ['master', 'r', 'g', 'b'].every(ch => {
    const p = c.curves[ch];
    return p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255;
  });
  const hslDefault = PE_HSL_BANDS.every(b => { const v = c.hsl[b.key]; return !v.h && !v.s && !v.l; });
  return adjDefault && curveDefault && hslDefault;
}
// Plain-data form written into file.edits.layers - drops _bitmap (a decoded Image, not
// JSON-safe) and any layer that somehow never got pixels. A text layer keeps its text spec so
// it can be re-edited (and re-rasterised crisply) rather than being a flat bitmap forever.
function peSerializeLayers(layers) {
  return (layers || []).filter(l => l.dataUrl).map(l => ({
    id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend || 'source-over',
    x: Math.round(l.x), y: Math.round(l.y), scale: l.scale, rotation: l.rotation || 0,
    text: l.text ? Object.assign({}, l.text) : null, dataUrl: l.dataUrl,
    clipped: !!l.clipped,
    colors: pmLayerColorsAreDefault(l.colors) ? null : {
      adjustments: Object.assign({}, l.colors.adjustments),
      curves: peCloneCurves(l.colors.curves),
      hsl: peCloneHsl(l.colors.hsl)
    }
  }));
}
// On-screen size of a layer: its bitmap's natural size scaled by the layer's own scale%.
function peLayerSize(layer) {
  const bmp = layer._bitmap;
  if (!bmp) return { w: 0, h: 0 };
  const s = (layer.scale || 100) / 100;
  return { w: (bmp.naturalWidth || bmp.width) * s, h: (bmp.naturalHeight || bmp.height) * s };
}
// Rebuilds #peLayersCanvas at the photo's pixel size and decodes each stored layer PNG back
// into a bitmap. Mirrors peInitDrawLayer/peInitMaskLayers' shape, including the async decode
// pass that re-composites once every layer has actually loaded.
function peInitLayers(existingLayers) {
  const canvas = document.getElementById('peLayersCanvas');
  if (!canvas || !peSourceCanvas) return;
  canvas.width = peSourceCanvas.width;
  canvas.height = peSourceCanvas.height;
  peLayersCanvas = canvas;
  peLayersCtx = canvas.getContext('2d');
  const selCanvas = document.getElementById('peSelCanvas');
  if (selCanvas) {
    selCanvas.width = peSourceCanvas.width;
    selCanvas.height = peSourceCanvas.height;
    peSelCanvas = selCanvas;
    peSelCtx = selCanvas.getContext('2d');
  }
  const tfCanvas = document.getElementById('peTransformCanvas');
  if (tfCanvas) {
    tfCanvas.width = peSourceCanvas.width;
    tfCanvas.height = peSourceCanvas.height;
    pmTfCanvas = tfCanvas;
    pmTfCtx = tfCanvas.getContext('2d');
  }
  pmInitHealCanvas();
  peClearSelection();
  peSyncOverlayCanvasLayout();
  peLayers = (existingLayers || []).map(l => Object.assign(peDefaultLayer(), {
    id: l.id || peNewLayerIdent(),
    name: l.name || 'Layer',
    visible: l.visible !== false,
    opacity: Number.isFinite(l.opacity) ? l.opacity : 100,
    blend: l.blend || 'source-over',
    x: Number.isFinite(l.x) ? l.x : 0,
    y: Number.isFinite(l.y) ? l.y : 0,
    scale: Number.isFinite(l.scale) ? l.scale : 100,
    rotation: Number.isFinite(l.rotation) ? l.rotation : 0,
    // Merged onto the defaults, not copied flat, so a text layer saved before curve/tracking/
    // outline existed still gets sane values for them instead of NaN.
    text: l.text ? Object.assign(peDefaultText(), l.text) : null,
    clipped: !!l.clipped,
    colors: l.colors ? {
      adjustments: Object.assign(peDefaultAdjustments(), l.colors.adjustments || {}),
      curves: peCloneCurves(l.colors.curves),
      hsl: peCloneHsl(l.colors.hsl)
    } : null,
    dataUrl: l.dataUrl || null,
    _bitmap: l._bitmap || null
  }));
  if (!peLayers.some(l => l.id === peActiveLayerId)) peActiveLayerId = peLayers.length ? peLayers[peLayers.length - 1].id : null;
  const decodes = peLayers.filter(l => l.dataUrl && !l._bitmap).map(l => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { l._bitmap = img; resolve(); };
    img.onerror = () => resolve();
    img.src = l.dataUrl;
  }));
  if (decodes.length) Promise.all(decodes).then(() => { if (peOpen) { peCompositeLayers(); peRenderLayersPanel(); } });
  peCompositeLayers();
  peRenderLayersPanel();
  peResetHistory(); // this photo's stack is the new baseline - nothing before it is undoable
  peSyncToolCanvases(); // the overlay starts pointer-events:none from CSS - the current tool decides who gets the pointer
}
// A blend mode is meaningless without something underneath to blend with, and the photo lives
// on a separate WebGL canvas. So when any visible layer uses a non-Normal blend, the overlay
// stops being a transparent sheet and becomes the whole composite (photo + strokes + layers),
// covering the GL canvas exactly. Everything else keeps the cheap path, where the overlay holds
// layers alone and the photo shows through - peRender only pays the full-composite cost for
// documents that actually asked for it.
function peLayersNeedBase() {
  return (peLayers || []).some(l => l.visible && l._bitmap && l.blend && l.blend !== 'source-over');
}
// Repaints every visible layer into the overlay canvas, bottom-first.
// skipBase forces the cheap path even for a blend-mode document - used by Flatten, which wants
// the layers on their own and must not bake a copy of the photo into the merged result.
function peCompositeLayers(skipBase) {
  if (!peLayersCtx || !peLayersCanvas) return;
  const ctx = peLayersCtx;
  const needBase = !skipBase && peLayersNeedBase();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, peLayersCanvas.width, peLayersCanvas.height);
  const drawCanvas = document.getElementById('peDrawCanvas');
  if (needBase) {
    const glCanvas = document.getElementById('peCanvas');
    if (glCanvas && glCanvas.width) ctx.drawImage(glCanvas, 0, 0, peLayersCanvas.width, peLayersCanvas.height);
    if (peDrawHasContent && peDrawCanvas) ctx.drawImage(peDrawCanvas, 0, 0);
  }
  // Hidden while the overlay already contains a copy of it, so strokes don't render twice.
  if (drawCanvas) drawCanvas.style.visibility = needBase ? 'hidden' : '';
  const layers = peLayers || [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer.visible || !layer._bitmap) continue;
    if (layer.id === pmTextEditId) continue; // the in-place editor is showing this one instead
    // A clipping mask shows only where the layer beneath it has pixels, so it has to be drawn
    // into a scratch canvas, punched down to that layer's alpha, and only then composited.
    const clipBase = layer.clipped ? peClippingBaseFor(i) : null;
    const target = clipBase ? peScratchCanvasCtx() : ctx;
    if (clipBase) { target.globalAlpha = 1; target.globalCompositeOperation = 'source-over'; }
    else {
      ctx.globalAlpha = Math.max(0, Math.min(1, (layer.opacity ?? 100) / 100));
      ctx.globalCompositeOperation = layer.blend || 'source-over';
    }
    // A live Transform or Warp draws through the mesh renderer instead, so the preview on the
    // stage is the real thing rather than an approximation of it - Apply just bakes what you
    // are already looking at.
    if (pmLiveMeshLayerId() === layer.id) pmDrawLiveMesh(target, layer);
    else peDrawLayerInto(target, layer);
    if (!clipBase) continue;
    target.globalCompositeOperation = 'destination-in';
    peDrawLayerInto(target, clipBase);
    target.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.max(0, Math.min(1, (layer.opacity ?? 100) / 100));
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    ctx.drawImage(target.canvas, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
// Photoshop's rule: a clipped layer is masked by the nearest layer below it that isn't itself
// clipped, so a run of clipped layers all share one base.
function peClippingBaseFor(index) {
  const layers = peLayers || [];
  for (let j = index - 1; j >= 0; j--) {
    if (!layers[j].clipped) return layers[j].visible && layers[j]._bitmap ? layers[j] : null;
  }
  return null;
}
// One scratch canvas, reused - a clipping group can otherwise allocate a full-document canvas
// per layer per repaint, which on a 24MP document is seconds of garbage per slider nudge.
let peScratch = null;
function peScratchCanvasCtx() {
  const w = peLayersCanvas.width, h = peLayersCanvas.height;
  if (!peScratch || peScratch.canvas.width !== w || peScratch.canvas.height !== h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    peScratch = c.getContext('2d');
  }
  peScratch.globalCompositeOperation = 'source-over';
  peScratch.globalAlpha = 1;
  peScratch.clearRect(0, 0, w, h);
  return peScratch;
}
function peDrawLayerInto(ctx, layer) {
  const bmp = pmLayerDrawable(layer);
  if (!bmp) return;
  const { w, h } = peLayerSize(layer);
  if (layer.rotation) {
    ctx.save();
    ctx.translate(layer.x + w / 2, layer.y + h / 2);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(bmp, layer.x, layer.y, w, h);
  }
}
// Adds a decoded image as a new top layer, centred. A bitmap larger than the photo is
// resampled down to fit first, not just displayed smaller: layers persist as base64 PNG inside
// the library JSON, so storing a 6000px paste on a 4000px photo would bloat every future save
// of that file for pixels that can never be seen at 100%.
function peAddLayerFromImage(img, name) {
  if (!peSourceCanvas || !peLayers) return;
  if (peLayers.length >= PE_LAYER_LIMIT) { toast(`⚠️ ${PE_LAYER_LIMIT} layers is the limit for now`); return; }
  const layer = peDefaultLayer();
  layer.name = name || 'Layer';
  const bw = img.naturalWidth || img.width, bh = img.naturalHeight || img.height;
  const fit = Math.min(1, peSourceCanvas.width / bw, peSourceCanvas.height / bh);
  const bitmap = fit < 1 ? peCopyCanvas(img, Math.round(bw * fit), Math.round(bh * fit)) : img;
  layer._bitmap = bitmap;
  layer.dataUrl = (bitmap.toDataURL ? bitmap : peCopyCanvas(bitmap)).toDataURL('image/png');
  layer.scale = 100;
  const { w, h } = peLayerSize(layer);
  layer.x = Math.round((peSourceCanvas.width - w) / 2);
  layer.y = Math.round((peSourceCanvas.height - h) / 2);
  peLayers.push(layer);
  peActiveLayerId = layer.id;
  peSelectTool('move');
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('paste layer');
  peDirty = true;
  peScheduleSave();
  toast(`🧩 Added "${layer.name}" as a layer - drag it with the Move tool`);
}
function peAddLayerFromSource(src, name) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { peAddLayerFromImage(img, name); resolve(true); };
    img.onerror = () => { toast('⚠️ Could not read that image'); resolve(false); };
    img.src = src;
  });
}
// ── Layer history (undo/redo across the whole stack) ────────────────────────
// Snapshots are shallow clones of the layer list: metadata is copied, _bitmap is shared by
// reference. That's safe because every pixel-editing op here (cut, erase, re-rasterised text)
// produces a NEW canvas rather than mutating one in place, so older snapshots keep pointing at
// the pixels they were taken with. Undo therefore costs a few hundred bytes, not a full frame.
// Brush strokes and mask paint keep their own stroke-level stacks (peDrawUndo/peMaskUndo);
// Ctrl+Z routes to whichever of the three matches the tool in hand - see the editor's keydown.
const PE_HISTORY_LIMIT = 40;
let peHistory = [];
let peHistoryIndex = -1;
function peSnapshotLayers() {
  return (peLayers || []).map(l => Object.assign({}, l, { text: l.text ? Object.assign({}, l.text) : null }));
}
function peResetHistory() {
  peHistory = [{ layers: peSnapshotLayers(), activeId: peActiveLayerId }];
  peHistoryIndex = 0;
}
// Call AFTER mutating peLayers. label is only for the toast on undo.
function pePushHistory(label) {
  if (peHistoryIndex < peHistory.length - 1) peHistory = peHistory.slice(0, peHistoryIndex + 1); // a new action discards the redo tail
  peHistory.push({ layers: peSnapshotLayers(), activeId: peActiveLayerId, label });
  if (peHistory.length > PE_HISTORY_LIMIT) peHistory.shift();
  peHistoryIndex = peHistory.length - 1;
}
function peApplyHistoryEntry(entry) {
  peLayers = entry.layers.map(l => Object.assign({}, l, { text: l.text ? Object.assign({}, l.text) : null }));
  peActiveLayerId = peLayers.some(l => l.id === entry.activeId) ? entry.activeId
    : (peLayers.length ? peLayers[peLayers.length - 1].id : null);
  peCompositeLayers();
  peRenderLayersPanel();
  peRenderPanel();
  peDirty = true;
  peScheduleSave();
}
function peUndoLayers() {
  if (peHistoryIndex <= 0) { toast('Nothing left to undo'); return; }
  const undone = peHistory[peHistoryIndex].label;
  peHistoryIndex--;
  peApplyHistoryEntry(peHistory[peHistoryIndex]);
  toast(undone ? `↶ Undid ${undone}` : '↶ Undo');
}
function peRedoLayers() {
  if (peHistoryIndex >= peHistory.length - 1) { toast('Nothing to redo'); return; }
  peHistoryIndex++;
  peApplyHistoryEntry(peHistory[peHistoryIndex]);
  toast(peHistory[peHistoryIndex].label ? `↷ Redid ${peHistory[peHistoryIndex].label}` : '↷ Redo');
}
// Ctrl+Z means "undo what I was just doing", which depends on the tool in hand rather than on
// one global timeline - painting and layer edits are genuinely separate streams of work.
function peUndoForCurrentTool() {
  if (peTool === 'brush') peDrawUndo();
  else if (peTool === 'mask') peMaskUndo();
  else peUndoLayers();
}

// ── Selection (marquee / lasso) and cutting ─────────────────────────────────
// A selection is a path in image-pixel space. Cut/copy lift those pixels into a NEW layer, and
// cut/delete erase them from the layer they came from - never from the photo, which stays a
// replayable recipe over the untouched original. With no layer selected the photo is the
// source, so copy works (lift a region onto its own layer) but erase doesn't, and the panel
// says so rather than silently doing nothing.
let peSelection = null; // {type:'rect'|'lasso', points:[{x,y}], bounds:{x,y,w,h}}
let peSelDrag = null;
let peSelCanvas = null, peSelCtx = null;
let peSelAntsOffset = 0, peSelAntsTimer = null;

// Every closed outline a selection is made of. Drawn shapes have one; Auto select can have
// several (separate parts, plus holes), filled together with the even-odd rule so a hole
// punches through whatever surrounds it.
function peSelectionPaths(sel) { return sel.paths || [sel.points]; }
function peSelectionBounds(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
// Document bounds, the outer ring an inverted selection is measured against.
function peDocRect() {
  const w = peSourceCanvas?.width || 0, h = peSourceCanvas?.height || 0;
  return { x: 0, y: 0, w, h };
}
// An inverted selection is "everything except this shape", so its bounds are the whole
// document. Every consumer (lift, erase, fill) reads sel.bounds, so putting the rule here
// means none of them need to know about inversion beyond the mask canvas.
// Always recomputed from the shape's own points rather than read off sel.bounds, so toggling
// Inverse back off restores the shape's bounds instead of leaving them stuck at the document
// rect the inverted state had put there.
function peSelectionEffectiveBounds(sel) {
  if (!sel) return null;
  return sel.invert ? peDocRect() : peSelectionBounds(sel.paths ? sel.paths.flat() : sel.points);
}
function peSetSelection(sel) {
  peSelection = sel && sel.points.length > 2 && sel.bounds.w >= 2 && sel.bounds.h >= 2 ? sel : null;
  if (peSelection) peSelection.bounds = peSelectionEffectiveBounds(peSelection);
  peDrawSelectionOverlay();
  peRenderPanel();
  if (peSelection && !peSelAntsTimer) peSelAntsTimer = setInterval(() => { peSelAntsOffset = (peSelAntsOffset + 1) % 12; peDrawSelectionOverlay(); }, 90);
  if (!peSelection && peSelAntsTimer) { clearInterval(peSelAntsTimer); peSelAntsTimer = null; }
}
function peClearSelection() { peSetSelection(null); }
// Marching ants, drawn on their own overlay so they never end up baked into an export.
function peDrawSelectionOverlay() {
  if (!peSelCtx || !peSelCanvas) return;
  peSelCtx.clearRect(0, 0, peSelCanvas.width, peSelCanvas.height);
  const sel = peSelDrag?.preview || peSelection;
  if (!sel || sel.points.length < 2) return;
  const scale = peSelCanvas.width / Math.max(1, peSelCanvas.getBoundingClientRect().width || peSelCanvas.width);
  peSelCtx.save();
  peSelCtx.beginPath();
  for (const path of peSelectionPaths(sel)) {
    peSelCtx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) peSelCtx.lineTo(path[i].x, path[i].y);
    peSelCtx.closePath();
  }
  // Inverted: the marching ants run round the document edge as well, which is the only visual
  // difference between "this shape" and "everything but this shape".
  if (sel.invert) peSelCtx.rect(0, 0, peSelCanvas.width, peSelCanvas.height);
  peSelCtx.lineWidth = Math.max(1, 1.5 * scale);
  peSelCtx.setLineDash([6 * scale, 6 * scale]);
  peSelCtx.lineDashOffset = -peSelAntsOffset * scale;
  peSelCtx.strokeStyle = '#000';
  peSelCtx.stroke();
  peSelCtx.lineDashOffset = (-peSelAntsOffset + 6) * scale;
  peSelCtx.strokeStyle = '#fff';
  peSelCtx.stroke();
  peSelCtx.restore();
}
// Renders the selection path as a fill, for use as a clipping mask.
function peSelectionMaskCanvas(width, height, offsetX, offsetY) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  // Inverted: paint the whole area, then punch the shape back out. Everything downstream just
  // uses this canvas as a stencil, so it never has to special-case an inverted selection.
  if (peSelection.invert) ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = peSelection.invert ? 'destination-out' : 'source-over';
  ctx.beginPath();
  for (const path of peSelectionPaths(peSelection)) {
    ctx.moveTo(path[0].x - offsetX, path[0].y - offsetY);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x - offsetX, path[i].y - offsetY);
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = 'source-over';
  return c;
}
// The pixels a layer (or the photo) shows inside the current selection, as a standalone canvas
// cropped to the selection's bounds.
function peLiftSelectionPixels(sourceCanvas) {
  const b = peSelection.bounds;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(b.w));
  out.height = Math.max(1, Math.round(b.h));
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(peSelectionMaskCanvas(b.w, b.h, b.x, b.y), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}
// A layer's pixels rendered into full image space, so selection coordinates line up with it.
function peLayerInImageSpace(layer) {
  const c = document.createElement('canvas');
  c.width = peSourceCanvas.width;
  c.height = peSourceCanvas.height;
  const ctx = c.getContext('2d');
  const { w, h } = peLayerSize(layer);
  if (layer.rotation) {
    ctx.translate(layer.x + w / 2, layer.y + h / 2);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.drawImage(layer._bitmap, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(layer._bitmap, layer.x, layer.y, w, h);
  }
  return c;
}
function peSelectionSourceCanvas() {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  if (layer && layer._bitmap) return { canvas: peLayerInImageSpace(layer), layer };
  const glCanvas = document.getElementById('peCanvas');
  return { canvas: glCanvas && glCanvas.width ? glCanvas : null, layer: null };
}
// Copy: lift the selected pixels onto a new layer, leaving the source alone.
function peSelectionToNewLayer(alsoErase) {
  if (!peSelection || !peSourceCanvas || !peLayers) return;
  const { canvas, layer } = peSelectionSourceCanvas();
  if (!canvas) return;
  if (alsoErase && !layer) { toast('The photo itself is never cut into - select a layer first, or use Copy'); return; }
  if (peLayers.length >= PE_LAYER_LIMIT) { toast(`⚠️ ${PE_LAYER_LIMIT} layers is the limit for now`); return; }
  const lifted = peLiftSelectionPixels(canvas);
  const b = peSelection.bounds;
  const newLayer = peDefaultLayer();
  newLayer.name = alsoErase ? 'Cut out' : 'Copied';
  newLayer._bitmap = lifted;
  newLayer.dataUrl = lifted.toDataURL('image/png');
  newLayer.x = Math.round(b.x);
  newLayer.y = Math.round(b.y);
  if (alsoErase) peEraseSelectionFromLayer(layer, true);
  peLayers.push(newLayer);
  peActiveLayerId = newLayer.id;
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory(alsoErase ? 'cut to new layer' : 'copy to new layer');
  peClearSelection();
  peSelectTool('move');
  peDirty = true;
  peScheduleSave();
  toast(alsoErase ? '✂️ Cut onto its own layer' : '⧉ Copied onto its own layer');
}
// Erase: punch the selection out of a layer's pixels. Rebuilt in image space then re-cropped
// so a rotated layer erases where the user actually sees it, not in its own tilted frame.
function peEraseSelectionFromLayer(layer, skipHistory) {
  if (!peSelection) return;
  if (!layer) { toast('The photo itself is never erased - select a layer first'); return; }
  const inSpace = peLayerInImageSpace(layer);
  const ctx = inSpace.getContext('2d');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(peSelectionMaskCanvas(inSpace.width, inSpace.height, 0, 0), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  layer._bitmap = inSpace;
  layer.dataUrl = inSpace.toDataURL('image/png');
  layer.x = 0; layer.y = 0; layer.scale = 100; layer.rotation = 0; // now baked in image space
  if (!skipHistory) {
    peCompositeLayers();
    peRenderLayersPanel();
    pePushHistory('erase selection');
    peClearSelection();
    peDirty = true;
    peScheduleSave();
    toast('🧽 Erased the selected area');
  }
}
function peDeleteSelection() {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  peEraseSelectionFromLayer(layer && layer._bitmap ? layer : null);
}

// ── Smart eraser (object removal) ───────────────────────────────────────────
// Paint over something, let go, and it is filled in from its surroundings - the maths is in
// worker/inpaint-worker.js. The fill never touches the photo or the layer you were on: it lands
// on an "Object removal" layer at the top of the stack, cropped to the patch, so hiding or
// deleting that layer brings the object back. Removals made one after another merge into the
// same layer while it stays on top, instead of stacking up a layer per stroke.
const PM_HEAL_MAX_HOLE = 180000;  // hole pixels filled at full resolution (a few seconds); bigger holes are filled at a reduced scale
const PM_HEAL_MAX_CROP = 3000000; // the same cap for the surroundings sent along with the hole
let pmHealCanvas = null, pmHealCtx = null;
let pmHealSize = 40; // on-screen CSS px, same convention as peDrawSize
let pmHealBusy = false;
let pmHealDrawing = false, pmHealLast = null;
let pmHealBounds = null; // image-space box around everything painted since the last fill
let pmHealWorker = null, pmHealJobId = 0;
const pmHealPending = new Map();
let pmHealLayerId = null;

function pmInitHealCanvas() {
  const c = document.getElementById('peHealCanvas');
  if (!c || !peSourceCanvas) return;
  c.width = peSourceCanvas.width;
  c.height = peSourceCanvas.height;
  c.classList.remove('working');
  pmHealCanvas = c;
  pmHealCtx = c.getContext('2d', { willReadFrequently: true });
  // A new document (or a re-initialised one) orphans any fill still in flight for the old one.
  pmHealJobId++;
  pmHealBusy = false;
  pmHealDrawing = false;
  pmHealBounds = null;
  pmHealLayerId = null;
}
function pmSetHealSize(v) {
  pmHealSize = parseInt(v, 10) || 40;
  const val = document.getElementById('pmHealSizeVal');
  if (val) val.textContent = pmHealSize + 'px';
}
function pmHealGrowBounds(x, y, r) {
  const b = pmHealBounds || (pmHealBounds = { x0: x, y0: y, x1: x, y1: y });
  b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r);
  b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r);
}

function setupPhotoModHeal() {
  const canvas = document.getElementById('peHealCanvas');
  const cursor = document.getElementById('peBrushCursor');
  const stage = canvas?.closest('.pe-stage');
  if (!canvas || !cursor || !stage) return;
  const pointFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };
  const moveCursor = e => {
    const stageRect = stage.getBoundingClientRect();
    cursor.style.left = (e.clientX - stageRect.left) + 'px';
    cursor.style.top = (e.clientY - stageRect.top) + 'px';
    cursor.style.width = cursor.style.height = pmHealSize + 'px';
  };
  canvas.addEventListener('pointerenter', e => {
    if (peTool === 'heal') cursor.style.display = 'block';
    moveCursor(e);
  });
  canvas.addEventListener('pointerleave', () => { cursor.style.display = 'none'; });
  canvas.addEventListener('pointerdown', e => {
    if (peTool !== 'heal' || !pmHealCtx || e.button !== 0) return;
    e.preventDefault();
    if (pmHealBusy) { toast('Still filling in the last one…'); return; }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const p = pointFromEvent(e);
    const ctx = pmHealCtx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ff2d55';
    ctx.lineWidth = Math.max(1, pmHealSize * p.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01); // a plain click still marks a dot
    ctx.stroke();
    pmHealGrowBounds(p.x, p.y, ctx.lineWidth / 2 + 1);
    pmHealDrawing = true;
    pmHealLast = p;
    moveCursor(e);
  });
  canvas.addEventListener('pointermove', e => {
    moveCursor(e);
    if (!pmHealDrawing) return;
    const p = pointFromEvent(e);
    pmHealCtx.beginPath();
    pmHealCtx.moveTo(pmHealLast.x, pmHealLast.y);
    pmHealCtx.lineTo(p.x, p.y);
    pmHealCtx.stroke();
    pmHealGrowBounds(p.x, p.y, pmHealCtx.lineWidth / 2 + 1);
    pmHealLast = p;
  });
  const endStroke = e => {
    if (!pmHealDrawing) return;
    pmHealDrawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    pmRunHeal(false);
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
}

// "Remove object" on a marquee/lasso selection: the selection becomes the stroke.
function pmHealSelection() {
  if (!peSelection || !pmHealCtx || pmHealBusy) return;
  const b = peSelection.bounds;
  pmHealCtx.clearRect(0, 0, pmHealCanvas.width, pmHealCanvas.height);
  pmHealCtx.globalCompositeOperation = 'source-over';
  pmHealCtx.drawImage(peSelectionMaskCanvas(pmHealCanvas.width, pmHealCanvas.height, 0, 0), 0, 0);
  pmHealBounds = { x0: b.x - 1, y0: b.y - 1, x1: b.x + b.w + 1, y1: b.y + b.h + 1 };
  pmRunHeal(true);
}

function pmHealInWorker(payload, transfer) {
  if (!pmHealWorker) {
    pmHealWorker = new Worker('worker/inpaint-worker.js');
    pmHealWorker.onmessage = ({ data }) => {
      const job = pmHealPending.get(data.id);
      if (!job) return;
      if (data.progress != null) {
        const status = document.getElementById('pmHealStatus');
        if (status) status.textContent = `Filling in… ${Math.round(data.progress * 100)}%`;
        return;
      }
      pmHealPending.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    };
    pmHealWorker.onerror = e => {
      console.error('[inpaint-worker]', e.message || e);
      for (const job of pmHealPending.values()) job.reject(new Error(e.message || 'worker failed'));
      pmHealPending.clear();
      pmHealWorker = null; // start a fresh one next time
    };
  }
  return new Promise((resolve, reject) => {
    pmHealPending.set(payload.id, { resolve, reject });
    pmHealWorker.postMessage(payload, transfer);
  });
}

async function pmRunHeal(fromSelection) {
  const W = pmHealCanvas.width, H = pmHealCanvas.height;
  const b = pmHealBounds;
  pmHealBounds = null;
  const clearStroke = () => {
    pmHealCtx.clearRect(0, 0, W, H);
    pmHealCanvas.classList.remove('working');
  };
  if (!b || !peLayers) { clearStroke(); return; }
  const bx0 = Math.max(0, Math.floor(b.x0)), by0 = Math.max(0, Math.floor(b.y0));
  const bx1 = Math.min(W, Math.ceil(b.x1)), by1 = Math.min(H, Math.ceil(b.y1));
  if (bx1 <= bx0 || by1 <= by0) { clearStroke(); return; }
  const strokeAlpha = pmHealCtx.getImageData(bx0, by0, bx1 - bx0, by1 - by0).data;
  let holeCount = 0;
  for (let i = 3; i < strokeAlpha.length; i += 4) if (strokeAlpha[i] >= 128) holeCount++;
  if (!holeCount) { clearStroke(); return; }
  const src = peCompositeCanvas();
  if (!src) { clearStroke(); return; }

  // Only the object plus a ring of its surroundings goes to the worker: the fill can only look
  // like what is near it anyway, and the cost grows with every pixel sent.
  const grow = Math.max(2, Math.round(Math.max(W, H) / 800)); // catches the soft fringe a stroke leaves behind
  const pad = Math.round(Math.max(48, Math.max(bx1 - bx0, by1 - by0) * 1.1)) + grow;
  const cx0 = Math.max(0, bx0 - pad), cy0 = Math.max(0, by0 - pad);
  const cw = Math.min(W, bx1 + pad) - cx0, ch = Math.min(H, by1 + pad) - cy0;
  const s = Math.min(1, Math.sqrt(PM_HEAL_MAX_HOLE / holeCount), Math.sqrt(PM_HEAL_MAX_CROP / (cw * ch)));
  const sw = Math.max(1, Math.round(cw * s)), sh = Math.max(1, Math.round(ch * s));
  const kx = src.width / W, ky = src.height / H; // the composite is the photo's size, but don't bet on it
  const work = document.createElement('canvas');
  work.width = sw; work.height = sh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(src, cx0 * kx, cy0 * ky, cw * kx, ch * ky, 0, 0, sw, sh);
  const pixels = wctx.getImageData(0, 0, sw, sh).data;
  wctx.clearRect(0, 0, sw, sh);
  wctx.drawImage(pmHealCanvas, cx0, cy0, cw, ch, 0, 0, sw, sh);
  const maskRgba = wctx.getImageData(0, 0, sw, sh).data;
  const mask = new Uint8Array(sw * sh);
  for (let i = 0; i < mask.length; i++) mask[i] = maskRgba[i * 4 + 3] >= 96 ? 1 : 0;

  const job = ++pmHealJobId;
  pmHealBusy = true;
  pmHealCanvas.classList.add('working');
  peRenderPanel();
  let result = null;
  try {
    result = await pmHealInWorker({ id: job, width: sw, height: sh, pixels, mask, grow: Math.max(1, Math.round(grow * s)) },
      [pixels.buffer, mask.buffer]);
  } catch (err) {
    if (job === pmHealJobId) toast(`⚠️ Could not remove that: ${err.message}`);
  }
  if (job !== pmHealJobId || !peOpen) return; // the document changed or closed while this ran
  pmHealBusy = false;
  clearStroke();
  if (!result) { peRenderPanel(); return; }

  // Back up to document scale, keeping only the filled hole - soft by a pixel so the seam
  // doesn't show - and trimmed to it so the layer carries no empty margin.
  const filled = document.createElement('canvas');
  filled.width = sw; filled.height = sh;
  filled.getContext('2d').putImageData(new ImageData(result.pixels, sw, sh), 0, 0);
  const holeImg = new ImageData(sw, sh);
  let mx0 = sw, my0 = sh, mx1 = -1, my1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (!result.mask[y * sw + x]) continue;
    holeImg.data[(y * sw + x) * 4 + 3] = 255;
    if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y;
  }
  if (mx1 < 0) { peRenderPanel(); return; }
  const holeCanvas = document.createElement('canvas');
  holeCanvas.width = sw; holeCanvas.height = sh;
  holeCanvas.getContext('2d').putImageData(holeImg, 0, 0);
  const px0 = Math.max(0, Math.floor(mx0 / s) - 2), py0 = Math.max(0, Math.floor(my0 / s) - 2);
  const pw = Math.min(cw, Math.ceil((mx1 + 1) / s) + 2) - px0, ph = Math.min(ch, Math.ceil((my1 + 1) / s) + 2) - py0;
  const patch = document.createElement('canvas');
  patch.width = pw; patch.height = ph;
  const pctx = patch.getContext('2d');
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(filled, -px0, -py0, cw, ch);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.filter = 'blur(1px)';
  pctx.drawImage(holeCanvas, -px0, -py0, cw, ch);
  pctx.filter = 'none';
  pctx.globalCompositeOperation = 'source-over';
  const docX = cx0 + px0, docY = cy0 + py0;

  const top = peLayers[peLayers.length - 1];
  const merge = top && top.id === pmHealLayerId && top.visible && top._bitmap && !top.rotation && (top.scale || 100) === 100;
  let layer;
  if (merge) {
    // A new canvas rather than drawing into the old one: history snapshots share bitmaps by
    // reference (see peSnapshotLayers), so the previous state must keep its own pixels.
    const tw = top._bitmap.naturalWidth || top._bitmap.width, th = top._bitmap.naturalHeight || top._bitmap.height;
    const ux0 = Math.min(top.x, docX), uy0 = Math.min(top.y, docY);
    const ux1 = Math.max(top.x + tw, docX + pw), uy1 = Math.max(top.y + th, docY + ph);
    const merged = document.createElement('canvas');
    merged.width = Math.round(ux1 - ux0); merged.height = Math.round(uy1 - uy0);
    const mctx = merged.getContext('2d');
    mctx.drawImage(top._bitmap, Math.round(top.x - ux0), Math.round(top.y - uy0));
    mctx.drawImage(patch, docX - ux0, docY - uy0);
    layer = top;
    layer._bitmap = merged;
    layer.x = ux0; layer.y = uy0;
  } else {
    if (peLayers.length >= PE_LAYER_LIMIT) { toast(`⚠️ ${PE_LAYER_LIMIT} layers is the limit for now`); peRenderPanel(); return; }
    layer = peDefaultLayer();
    layer.name = 'Object removal';
    layer._bitmap = patch;
    layer.x = docX; layer.y = docY;
    peLayers.push(layer);
    pmHealLayerId = layer.id;
  }
  layer.dataUrl = layer._bitmap.toDataURL('image/png');
  peActiveLayerId = layer.id;
  if (fromSelection) peClearSelection();
  peCompositeLayers();
  peRenderLayersPanel();
  peRenderPanel();
  pePushHistory('object removal');
  peDirty = true;
  peScheduleSave();
  if (s < 1) toast('Removed. That was a big area, so the fill is a little softer than the rest of the photo', 5000);
}

// ── Auto select ─────────────────────────────────────────────────────────────
// Click something and it is selected. Two ways of deciding what "something" is:
//   Object - SlimSAM (worker/segment-worker.js) recognises the thing under the cursor as a
//            whole, however many colours it has: a person, a car, a cup.
//   Colour - a magic wand: the connected patch of similar colour, within a tolerance. No model,
//            so it is also what Object falls back to if the model cannot load.
// Either way the result is a mask, traced into outlines and handed to the ordinary selection
// machinery, so Cut, Copy, Fill, Erase, Remove object and Inverse all just work on it.
// Shift+click adds to it and Alt+click takes away, for as long as the selection on screen is
// still the one Auto select made.
const PM_SEG_SIZE = 1024;  // SAM encodes at 1024 on the long side, so sending more is wasted
const PM_WAND_MAX = 2048;  // Colour mode works on a copy at most this big
let pmAutoMode = 'object'; // 'object' | 'colour'
let pmAutoTolerance = 32;
let pmAutoBusy = false;
let pmAutoSession = null;  // { mode, mask, w, h, version, sel } - what Shift/Alt clicks refine
let pmSegWorker = null, pmSegReqId = 0;
const pmSegPending = new Map();
let pmSegDocVersion = 0;   // bumped by every edit (see peScheduleSave)
let pmSegEmbedding = null; // { version, promise } for the analysis of the picture as it is now
let pmSegBroken = false;   // the model failed to load this session - Object falls back to Colour
let pmWandCache = null;    // { version, w, h, data } - the downscaled pixels the wand floods over

function pmAutoSelectHint() {
  return pmAutoMode === 'object'
    ? 'Click an object to select the whole of it. Shift+click adds another object or a missed part, Alt+click takes a part away.'
    : 'Click a colour to select the connected area of similar colour. Shift+click adds, Alt+click takes away. Raise the tolerance to take in more shades.';
}
function pmAutoSelectOptionsHtml() {
  return `<div class="pm-btn-grid" style="margin-bottom:8px">
      <button class="pe-draw-action-btn${pmAutoMode === 'object' ? ' active' : ''}" onclick="pmSetAutoMode('object')" title="Recognises whole objects, whatever their colours">Object</button>
      <button class="pe-draw-action-btn${pmAutoMode === 'colour' ? ' active' : ''}" onclick="pmSetAutoMode('colour')" title="Selects connected areas of similar colour (magic wand)">Colour</button>
    </div>
    ${pmAutoMode === 'colour' ? `<div class="pe-slider-row">
      <div class="pe-slider-head"><span>Tolerance</span><span class="pe-slider-val" id="pmAutoTolVal">${pmAutoTolerance}</span></div>
      <input type="range" min="0" max="160" value="${pmAutoTolerance}" oninput="pmSetAutoTolerance(this.value)"/>
    </div>` : ''}
    <div class="pm-tool-hint" id="pmAutoStatus" style="margin:0 0 8px">${pmAutoBusy ? 'Working…' : ''}</div>`;
}
function pmSetAutoMode(mode) {
  if (mode === 'object' && pmSegBroken) { toast('Object selection is unavailable on this computer - using Colour'); mode = 'colour'; }
  pmAutoMode = mode;
  pmAutoSession = null;
  peRenderPanel();
  if (mode === 'object') pmSegPrewarm();
}
function pmSetAutoTolerance(v) {
  pmAutoTolerance = parseInt(v, 10) || 0;
  const val = document.getElementById('pmAutoTolVal');
  if (val) val.textContent = pmAutoTolerance;
}
function pmAutoStatus(text) {
  const el = document.getElementById('pmAutoStatus');
  if (el) el.textContent = text;
}

function pmSegCall(msg, transfer) {
  if (!pmSegWorker) {
    pmSegWorker = new Worker('worker/segment-worker.js', { type: 'module' });
    pmSegWorker.onmessage = ({ data }) => {
      const job = pmSegPending.get(data.id);
      if (!job) return;
      pmSegPending.delete(data.id);
      if (data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data);
    };
    pmSegWorker.onerror = e => {
      console.error('[segment-worker]', e.message || e);
      for (const job of pmSegPending.values()) job.reject(new Error(e.message || 'worker failed'));
      pmSegPending.clear();
      pmSegWorker = null;
      pmSegEmbedding = null;
    };
  }
  const id = ++pmSegReqId;
  return new Promise((resolve, reject) => {
    pmSegPending.set(id, { resolve, reject });
    pmSegWorker.postMessage(Object.assign({ id }, msg), transfer || []);
  });
}
// The picture only needs analysing once per version of the document; clicks reuse it.
function pmSegEnsureEmbedding() {
  if (pmSegEmbedding && pmSegEmbedding.version === pmSegDocVersion) return pmSegEmbedding.promise;
  const version = pmSegDocVersion;
  const src = peCompositeCanvas();
  if (!src) return Promise.reject(new Error('Nothing to analyse'));
  const s = Math.min(1, PM_SEG_SIZE / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const promise = pmSegCall({ type: 'embed', width: w, height: h, pixels }, [pixels.buffer]).then(() => ({ version }));
  pmSegEmbedding = { version, promise };
  promise.catch(() => { if (pmSegEmbedding?.promise === promise) pmSegEmbedding = null; });
  return promise;
}
// Picking the tool starts the analysis straight away, so the first click doesn't pay for it.
function pmSegPrewarm() {
  if (pmAutoMode !== 'object' || pmSegBroken || !peOpen || !peSourceCanvas) return;
  pmSegEnsureEmbedding().catch(err => pmSegFailed(err));
}
function pmSegFailed(err) {
  console.warn('[auto select] object mode unavailable:', err);
  if (pmSegBroken) return;
  pmSegBroken = true;
  pmAutoMode = 'colour';
  toast('Object selection could not start on this computer - switched to Colour', 5000);
  if (peTool === 'autosel') peRenderPanel();
}

async function pmAutoSelectAt(p, e) {
  if (pmAutoBusy || !peSourceCanvas) return;
  const W = peSourceCanvas.width, H = peSourceCanvas.height;
  if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
  const mode = pmAutoMode === 'object' && !pmSegBroken ? 'object' : 'colour';
  const session = pmAutoSession && pmAutoSession.sel === peSelection && pmAutoSession.mode === mode
    && pmAutoSession.version === pmSegDocVersion ? pmAutoSession : null;
  let op = e.altKey ? 'subtract' : e.shiftKey ? 'add' : 'new';
  if (!session) { if (op === 'subtract') return; op = 'new'; } // nothing of Auto select's to refine
  const canvas = document.getElementById('peSelCanvas');
  pmAutoBusy = true;
  if (canvas) canvas.style.cursor = 'progress';
  pmAutoStatus(mode === 'object' && !(pmSegEmbedding && pmSegEmbedding.version === pmSegDocVersion) ? 'Analysing the picture…' : 'Working…');
  try {
    const res = mode === 'object' ? await pmAutoObject(p, op, session, W, H) : pmAutoColour(p, op, session, W, H);
    const sel = pmMaskToSelection(res.mask, res.w, res.h, W / res.w, H / res.h);
    if (!sel) {
      pmAutoSession = null;
      if (op === 'new') toast('Nothing to select there');
      else peClearSelection();
      return;
    }
    peSetSelection(sel);
    pmAutoSession = peSelection === sel ? { mode, mask: res.mask, w: res.w, h: res.h, version: pmSegDocVersion, sel } : null;
    peRenderLayersPanel();
  } catch (err) {
    if (mode === 'object') pmSegFailed(err);
    else toast(`⚠️ Could not select that: ${err.message}`);
  } finally {
    pmAutoBusy = false;
    if (canvas) canvas.style.cursor = '';
    pmAutoStatus('');
  }
}

// Object mode. Adding runs the model on the new click alone and unions the result, because SAM
// reads several positive clicks as "these are all one object" - fine for a missed arm, wrong for
// a second person. Taking away asks for the smallest confident mask at the click (the part, not
// the whole thing it belongs to) and cuts that out.
async function pmAutoObject(p, op, session, W, H) {
  await pmSegEnsureEmbedding();
  const r = await pmSegCall({ type: 'decode', points: [{ x: p.x / W, y: p.y / H, label: 1 }], pick: op === 'subtract' ? 'part' : 'best' });
  const mask = r.mask;
  if (op !== 'new' && session.w === r.width && session.h === r.height) {
    for (let i = 0; i < mask.length; i++) mask[i] = op === 'add' ? (session.mask[i] | mask[i]) : (session.mask[i] & (mask[i] ^ 1));
  }
  return { mask, w: r.width, h: r.height };
}

// Colour mode: a 4-connected flood from the clicked pixel over everything within the tolerance
// of its colour, on a downscaled copy (a wand doesn't need 24 megapixels to find an edge).
function pmAutoColour(p, op, session, W, H) {
  if (!pmWandCache || pmWandCache.version !== pmSegDocVersion) {
    const src = peCompositeCanvas();
    if (!src) throw new Error('nothing to select from');
    const s = Math.min(1, PM_WAND_MAX / Math.max(W, H));
    const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    pmWandCache = { version: pmSegDocVersion, w, h, data: ctx.getImageData(0, 0, w, h).data };
  }
  const { w, h, data } = pmWandCache;
  const sx = Math.min(w - 1, Math.floor(p.x * w / W)), sy = Math.min(h - 1, Math.floor(p.y * h / H));
  const seed = (sy * w + sx) * 4;
  const r0 = data[seed], g0 = data[seed + 1], b0 = data[seed + 2], a0 = data[seed + 3];
  const tol = pmAutoTolerance;
  const region = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  stack[top++] = sy * w + sx;
  region[sy * w + sx] = 1;
  const similar = j => {
    const k = j * 4;
    return Math.abs(data[k] - r0) <= tol && Math.abs(data[k + 1] - g0) <= tol
      && Math.abs(data[k + 2] - b0) <= tol && Math.abs(data[k + 3] - a0) <= tol;
  };
  while (top) {
    const i = stack[--top];
    const x = i % w;
    if (x > 0 && !region[i - 1] && similar(i - 1)) { region[i - 1] = 1; stack[top++] = i - 1; }
    if (x < w - 1 && !region[i + 1] && similar(i + 1)) { region[i + 1] = 1; stack[top++] = i + 1; }
    if (i >= w && !region[i - w] && similar(i - w)) { region[i - w] = 1; stack[top++] = i - w; }
    if (i + w < w * h && !region[i + w] && similar(i + w)) { region[i + w] = 1; stack[top++] = i + w; }
  }
  if (op !== 'new' && session.w === w && session.h === h) {
    for (let i = 0; i < region.length; i++) region[i] = op === 'add' ? (session.mask[i] | region[i]) : (session.mask[i] & (region[i] ^ 1));
  }
  return { mask: region, w, h };
}

// Traces a mask's boundary into closed outlines, in document pixels. Every pixel side between
// "in" and "out" becomes one directed edge, oriented so that edges chain head-to-tail into loops.
// Where two loops touch at a corner it doesn't matter which way they are joined up: even-odd
// filling only depends on the set of edges, not how they are grouped. Then the staircase is
// straightened (Douglas-Peucker), and specks too small to mean anything are dropped.
function pmMaskToSelection(mask, w, h, kx, ky) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  // Vertices live on the pixel-corner grid of the mask's bounding box, one row/column wider.
  const gw = x1 - x0 + 2, gh = y1 - y0 + 2;
  const next1 = new Int32Array(gw * gh).fill(-1), next2 = new Int32Array(gw * gh).fill(-1);
  const vid = (x, y) => (y - y0) * gw + (x - x0);
  const addEdge = (ax, ay, bx, by) => {
    const a = vid(ax, ay), b = vid(bx, by);
    if (next1[a] < 0) next1[a] = b; else next2[a] = b;
  };
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!mask[y * w + x]) continue;
    if (!inside(x, y - 1)) addEdge(x + 1, y, x, y);
    if (!inside(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1);
    if (!inside(x - 1, y)) addEdge(x, y, x, y + 1);
    if (!inside(x + 1, y)) addEdge(x + 1, y + 1, x + 1, y);
  }
  const loops = [];
  for (let start = 0; start < gw * gh; start++) {
    while (next1[start] >= 0) {
      const loop = [];
      let v = start;
      do {
        loop.push(v);
        const n = next1[v];
        next1[v] = next2[v];
        next2[v] = -1;
        v = n;
      } while (v !== start && v >= 0);
      if (loop.length < 4) continue;
      const pts = loop.map(i => ({ x: (i % gw) + x0, y: ((i / gw) | 0) + y0 }));
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
      if (Math.abs(area) / 2 < 6) continue; // a speck or a pinhole
      const simple = pmSimplifyLoop(pts, 0.8);
      if (simple.length >= 3) loops.push(simple.map(q => ({ x: q.x * kx, y: q.y * ky })));
    }
  }
  if (!loops.length) return null;
  loops.sort((a, b) => b.length - a.length);
  return { type: 'auto', invert: false, points: loops[0], paths: loops, bounds: peSelectionBounds(loops.flat()) };
}
// Douglas-Peucker on a closed loop: split at the point farthest from the first, simplify both
// halves as open polylines, and join them back up.
function pmSimplifyLoop(pts, eps) {
  if (pts.length < 8) return pts;
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = pmSimplifyLine(pts.slice(0, far + 1), eps);
  const b = pmSimplifyLine(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
function pmSimplifyLine(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    let far = -1, fd = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs(dy * (pts[i].x - a.x) - dx * (pts[i].y - a.y)) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i0, far], [far, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── Text layers ─────────────────────────────────────────────────────────────
// Rasterised into an ordinary layer bitmap, so text inherits move/scale/rotate/opacity/blend
// for free - but the spec that produced it is kept on the layer, so editing re-rasterises
// crisply at the current size instead of scaling up a blurry bitmap.
// The font catalogue, grouped the way a font menu is. Each entry is [stack, label, probe]:
// `probe` is the one family whose presence decides whether the entry is offered at all, and the
// stack behind it is the fallback chain used to actually render. Nothing here is downloaded -
// these are the faces Windows and macOS ship with, so the list is filtered per machine by
// pmInstalledFonts() below rather than showing names that would silently fall back to Arial.
const PE_FONT_CATALOGUE = [
  ['Sans', [
    ['system-ui, -apple-system, "Segoe UI", sans-serif', 'System', null],
    ['Arial, Helvetica, sans-serif', 'Arial', 'Arial'],
    ['Helvetica, Arial, sans-serif', 'Helvetica', 'Helvetica'],
    ['"Segoe UI", system-ui, sans-serif', 'Segoe UI', 'Segoe UI'],
    ['Verdana, Geneva, sans-serif', 'Verdana', 'Verdana'],
    ['Tahoma, Geneva, sans-serif', 'Tahoma', 'Tahoma'],
    ['"Trebuchet MS", sans-serif', 'Trebuchet MS', 'Trebuchet MS'],
    ['Calibri, sans-serif', 'Calibri', 'Calibri'],
    ['"Century Gothic", sans-serif', 'Century Gothic', 'Century Gothic'],
    ['"Franklin Gothic Medium", sans-serif', 'Franklin Gothic', 'Franklin Gothic Medium'],
    ['"Gill Sans", "Gill Sans MT", sans-serif', 'Gill Sans', 'Gill Sans MT'],
    ['Futura, "Century Gothic", sans-serif', 'Futura', 'Futura'],
    ['Optima, Candara, sans-serif', 'Optima', 'Optima'],
    ['Candara, Optima, sans-serif', 'Candara', 'Candara'],
    ['Corbel, sans-serif', 'Corbel', 'Corbel'],
    ['"Lucida Grande", "Lucida Sans Unicode", sans-serif', 'Lucida Grande', 'Lucida Grande'],
    ['"Avenir Next", Avenir, sans-serif', 'Avenir Next', 'Avenir Next'],
    ['"Helvetica Neue", Helvetica, sans-serif', 'Helvetica Neue', 'Helvetica Neue'],
    ['Geneva, Verdana, sans-serif', 'Geneva', 'Geneva']
  ]],
  ['Serif', [
    ['Georgia, "Times New Roman", serif', 'Georgia', 'Georgia'],
    ['"Times New Roman", Times, serif', 'Times New Roman', 'Times New Roman'],
    ['Garamond, "EB Garamond", serif', 'Garamond', 'Garamond'],
    ['Palatino, "Palatino Linotype", "Book Antiqua", serif', 'Palatino', 'Palatino Linotype'],
    ['"Book Antiqua", Palatino, serif', 'Book Antiqua', 'Book Antiqua'],
    ['Baskerville, "Baskerville Old Face", serif', 'Baskerville', 'Baskerville Old Face'],
    ['Cambria, Georgia, serif', 'Cambria', 'Cambria'],
    ['Constantia, Georgia, serif', 'Constantia', 'Constantia'],
    ['Didot, "Bodoni MT", serif', 'Didot', 'Didot'],
    ['"Bodoni MT", Didot, serif', 'Bodoni', 'Bodoni MT'],
    ['Rockwell, "Courier New", serif', 'Rockwell', 'Rockwell'],
    ['"Perpetua", Georgia, serif', 'Perpetua', 'Perpetua'],
    ['"Goudy Old Style", Garamond, serif', 'Goudy Old Style', 'Goudy Old Style'],
    ['Cochin, Georgia, serif', 'Cochin', 'Cochin'],
    ['"American Typewriter", "Courier New", serif', 'Typewriter', 'American Typewriter']
  ]],
  ['Mono', [
    ['"Courier New", Courier, monospace', 'Courier New', 'Courier New'],
    ['Consolas, "Lucida Console", monospace', 'Consolas', 'Consolas'],
    ['Menlo, Monaco, monospace', 'Menlo', 'Menlo'],
    ['Monaco, Menlo, monospace', 'Monaco', 'Monaco'],
    ['"Lucida Console", Monaco, monospace', 'Lucida Console', 'Lucida Console'],
    ['"Cascadia Code", Consolas, monospace', 'Cascadia Code', 'Cascadia Code'],
    ['"Andale Mono", Consolas, monospace', 'Andale Mono', 'Andale Mono']
  ]],
  ['Display', [
    ['Impact, "Arial Black", sans-serif', 'Impact', 'Impact'],
    ['"Arial Black", Impact, sans-serif', 'Arial Black', 'Arial Black'],
    ['Haettenschweiler, Impact, sans-serif', 'Haettenschweiler', 'Haettenschweiler'],
    ['"Copperplate Gothic Bold", Copperplate, fantasy', 'Copperplate', 'Copperplate Gothic Bold'],
    ['Stencil, Impact, fantasy', 'Stencil', 'Stencil'],
    ['"Bauhaus 93", fantasy', 'Bauhaus 93', 'Bauhaus 93'],
    ['Broadway, fantasy', 'Broadway', 'Broadway'],
    ['Algerian, fantasy', 'Algerian', 'Algerian'],
    ['Harrington, fantasy', 'Harrington', 'Harrington'],
    ['Jokerman, fantasy', 'Jokerman', 'Jokerman'],
    ['"Matura MT Script Capitals", fantasy', 'Matura MT', 'Matura MT Script Capitals'],
    ['Playbill, fantasy', 'Playbill', 'Playbill'],
    ['Chiller, fantasy', 'Chiller', 'Chiller'],
    ['Papyrus, fantasy', 'Papyrus', 'Papyrus'],
    ['"Luminari", fantasy', 'Luminari', 'Luminari'],
    ['"Showcard Gothic", fantasy', 'Showcard Gothic', 'Showcard Gothic']
  ]],
  ['Handwriting', [
    ['"Brush Script MT", cursive', 'Brush Script', 'Brush Script MT'],
    ['"Comic Sans MS", cursive', 'Comic Sans', 'Comic Sans MS'],
    ['"Segoe Script", cursive', 'Segoe Script', 'Segoe Script'],
    ['"Segoe Print", cursive', 'Segoe Print', 'Segoe Print'],
    ['"Lucida Handwriting", cursive', 'Lucida Handwriting', 'Lucida Handwriting'],
    ['"Bradley Hand", cursive', 'Bradley Hand', 'Bradley Hand'],
    ['"Snell Roundhand", cursive', 'Snell Roundhand', 'Snell Roundhand'],
    ['"Apple Chancery", cursive', 'Apple Chancery', 'Apple Chancery'],
    ['Chalkduster, cursive', 'Chalkduster', 'Chalkduster'],
    ['"Ink Free", cursive', 'Ink Free', 'Ink Free'],
    ['"Gabriola", cursive', 'Gabriola', 'Gabriola'],
    ['"Edwardian Script ITC", cursive', 'Edwardian Script', 'Edwardian Script ITC'],
    ['"Freestyle Script", cursive', 'Freestyle Script', 'Freestyle Script'],
    ['Pristina, cursive', 'Pristina', 'Pristina'],
    ['"Vladimir Script", cursive', 'Vladimir Script', 'Vladimir Script'],
    ['"Kristen ITC", cursive', 'Kristen ITC', 'Kristen ITC']
  ]]
];
// Canvas has no "is this font installed" API, so this measures: a string rendered in the
// candidate falls back to a known generic if the family is missing, and an identical width
// against every generic means it never resolved. Computed once, on first use.
let pmFontCache = null;
function pmInstalledFonts() {
  if (pmFontCache) return pmFontCache;
  const ctx = document.createElement('canvas').getContext('2d');
  const probeText = 'mmmwwwiiilll@#WM';
  const generics = ['monospace', 'serif', 'sans-serif'];
  const baseline = {};
  generics.forEach(g => { ctx.font = `72px ${g}`; baseline[g] = ctx.measureText(probeText).width; });
  const available = family => generics.some(g => {
    ctx.font = `72px "${family}", ${g}`;
    return ctx.measureText(probeText).width !== baseline[g];
  });
  pmFontCache = PE_FONT_CATALOGUE
    .map(([group, entries]) => [group, entries.filter(([, , probe]) => !probe || available(probe))])
    .filter(([, entries]) => entries.length);
  return pmFontCache;
}
// The default a new text layer starts on - always present, whatever the machine has installed.
const PE_TEXT_FONTS = [['system-ui, -apple-system, "Segoe UI", sans-serif', 'System']];
function peDefaultText() {
  return { content: 'Your text', font: PE_TEXT_FONTS[0][0], size: 0, color: '#ffffff', bold: true, italic: false,
           curve: 0, tracking: 0, strokeWidth: 0, strokeColor: '#000000' };
}
// Text on an arc. `curve` is -100..100 rather than a radius so the control behaves the same on
// a 600px and a 6000px document: it's converted into a bend angle, and the radius that produces
// it falls out of the line's own width. Positive arcs upward (smile), negative downward.
// Each glyph is drawn individually, rotated to sit on the tangent - the same way every editor
// does warped text, and the reason a curved line has to be laid out per character rather than
// handed to one fillText call.
function peCurvedTextMetrics(ctx, line, spec) {
  const chars = [...line];
  const widths = chars.map(ch => ctx.measureText(ch).width + (spec.tracking || 0));
  const total = widths.reduce((a, b) => a + b, 0);
  const bend = (Math.abs(spec.curve) / 100) * (Math.PI * 1.35); // full sweep at ±100, short of a closed circle
  const radius = total / Math.max(bend, 0.0001);
  return { chars, widths, total, bend, radius, dir: spec.curve >= 0 ? -1 : 1 };
}
function peDrawCurvedLine(ctx, line, spec, cx, baselineY) {
  const m = peCurvedTextMetrics(ctx, line, spec);
  const { chars, widths, total, radius, dir } = m;
  // Centre of the arc: straight up from the baseline for a smile, straight down for a frown.
  const centerY = baselineY + dir * radius;
  let travelled = 0;
  for (let i = 0; i < chars.length; i++) {
    const at = travelled + widths[i] / 2;              // this glyph's midpoint along the baseline
    const theta = (at - total / 2) / radius * -dir;    // angle from the arc's apex
    ctx.save();
    ctx.translate(cx, centerY);
    ctx.rotate(theta);
    ctx.translate(0, -dir * radius);
    ctx.textAlign = 'center';
    if (spec.strokeWidth > 0) {
      ctx.lineWidth = spec.strokeWidth;
      ctx.strokeStyle = spec.strokeColor || '#000';
      ctx.lineJoin = 'round';
      ctx.strokeText(chars[i], 0, 0);
    }
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    travelled += widths[i];
  }
}
// size 0 means "pick something proportional to the photo" - a fixed default px size is tiny on
// a 6000px photo and enormous on a web-sized one.
function peTextPixelSize(spec) {
  return spec.size || Math.max(24, Math.round((peSourceCanvas?.height || 1200) * 0.08));
}
function peRasterizeText(spec) {
  const size = peTextPixelSize(spec);
  const lines = String(spec.content || ' ').split('\n');
  const font = `${spec.italic ? 'italic ' : ''}${spec.bold ? '700 ' : '400 '}${size}px ${spec.font}`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const track = spec.tracking || 0;
  const lineWidth = l => measure.measureText(l).width + track * Math.max(0, [...l].length - 1);
  const widths = lines.map(lineWidth);
  const lineHeight = Math.round(size * 1.25);
  const curved = !!spec.curve;
  // A curved line bows out of its own box, so the bitmap needs room for the sagitta - the arc's
  // bulge - on top of the usual padding, or the top of the smile gets clipped off.
  let bulge = 0;
  if (curved) {
    for (const l of lines) {
      const m = peCurvedTextMetrics(measure, l, spec);
      bulge = Math.max(bulge, Math.abs(m.radius * (1 - Math.cos(m.bend / 2))));
    }
  }
  const pad = Math.round(size * 0.25) + Math.ceil(spec.strokeWidth || 0);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(Math.max(...widths)) + pad * 2);
  c.height = Math.max(1, Math.ceil(lines.length * lineHeight + pad * 2 + bulge));
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = spec.color || '#ffffff';
  if (curved) {
    ctx.textBaseline = 'alphabetic';
    // Baseline sits below the bulge for a smile, at the top for a frown, so either bend stays
    // inside the bitmap without moving the text's apparent position.
    const top = spec.curve >= 0 ? pad + bulge : pad;
    lines.forEach((line, i) => peDrawCurvedLine(ctx, line, spec, c.width / 2, top + i * lineHeight + size * 0.8));
    return c;
  }
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    const y = pad + i * lineHeight;
    if (spec.strokeWidth > 0) {
      ctx.lineWidth = spec.strokeWidth;
      ctx.strokeStyle = spec.strokeColor || '#000';
      ctx.lineJoin = 'round';
    }
    if (!track) {
      if (spec.strokeWidth > 0) ctx.strokeText(line, pad, y);
      ctx.fillText(line, pad, y);
      return;
    }
    let x = pad;
    for (const ch of [...line]) {
      if (spec.strokeWidth > 0) ctx.strokeText(ch, x, y);
      ctx.fillText(ch, x, y);
      x += measure.measureText(ch).width + track;
    }
  });
  return c;
}
function peAddTextLayer() {
  if (!peSourceCanvas || !peLayers) return;
  if (peLayers.length >= PE_LAYER_LIMIT) { toast(`⚠️ ${PE_LAYER_LIMIT} layers is the limit for now`); return; }
  const layer = peDefaultLayer();
  layer.text = peDefaultText();
  layer.name = layer.text.content;
  const bitmap = peRasterizeText(layer.text);
  layer._bitmap = bitmap;
  layer.dataUrl = bitmap.toDataURL('image/png');
  layer.x = Math.round((peSourceCanvas.width - bitmap.width) / 2);
  layer.y = Math.round((peSourceCanvas.height - bitmap.height) / 2);
  peLayers.push(layer);
  peActiveLayerId = layer.id;
  peCompositeLayers();
  peRenderLayersPanel();
  peRenderPanel();
  pePushHistory('add text');
  peDirty = true;
  peScheduleSave();
  // Straight into typing on the picture, rather than leaving "Your text" sitting there for the
  // user to work out where to change.
  if (peIsPro()) setTimeout(() => pmOpenTextEditor(layer), 0);
}
// Re-rasterises in place, keeping the layer centred on where it already was so tweaking the
// wording doesn't make the text crawl across the photo.
function peUpdateTextLayer(prop, value, pushHistory) {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  if (!layer?.text) return;
  const numeric = { size: 1, curve: 1, tracking: 1, strokeWidth: 1 };
  layer.text[prop] = numeric[prop] ? (parseFloat(value) || 0) : value;
  const beforeW = layer._bitmap ? peLayerSize(layer).w : 0;
  const beforeH = layer._bitmap ? peLayerSize(layer).h : 0;
  const bitmap = peRasterizeText(layer.text);
  layer._bitmap = bitmap;
  layer.dataUrl = bitmap.toDataURL('image/png');
  if (prop === 'content') layer.name = String(value).split('\n')[0].slice(0, 40) || 'Text';
  const after = peLayerSize(layer);
  layer.x += (beforeW - after.w) / 2;
  layer.y += (beforeH - after.h) / 2;
  peCompositeLayers();
  peRenderLayersPanel();
  peDirty = true;
  if (pushHistory) pePushHistory('edit text');
  peScheduleSave();
}

// Rotating the photo 90° has to carry the layers with it: each bitmap is rotated the same way
// and its origin remapped into the new (swapped) image frame, using the pre-rotation source
// dimensions - so this must run before peInitGL swaps peSourceCanvas out, exactly like
// peRotateLocalLayers just below it.
async function peRotateLayers(rotationDelta) {
  const W = peSourceCanvas ? peSourceCanvas.width : 0;
  const H = peSourceCanvas ? peSourceCanvas.height : 0;
  const cw = ((rotationDelta % 360) + 360) % 360 === 90; // clockwise vs counter-clockwise
  return Promise.all((peLayers || []).map(layer => new Promise(resolve => {
    if (!layer.dataUrl) { resolve(layer); return; }
    const { w, h } = peLayerSize(layer);
    const img = new Image();
    img.onload = () => {
      const rotated = drawRotatedToCanvas(img, rotationDelta);
      resolve(Object.assign({}, layer, {
        dataUrl: rotated.toDataURL('image/png'),
        _bitmap: rotated,
        x: cw ? H - (layer.y + h) : layer.y,
        y: cw ? layer.x : W - (layer.x + w)
      }));
    };
    img.onerror = () => resolve(layer);
    img.src = layer.dataUrl;
  })));
}

// Hue centers (0..1) mirror the const-returning hslBandCenter() function in the
// fragment shader below - keep the two in sync if this list ever changes.
const PE_HSL_BANDS = [
  { key:'red',     label:'Red',     swatch:'hsl(0,80%,55%)' },
  { key:'orange',  label:'Orange',  swatch:'hsl(30,80%,55%)' },
  { key:'yellow',  label:'Yellow',  swatch:'hsl(60,80%,50%)' },
  { key:'green',   label:'Green',   swatch:'hsl(120,70%,45%)' },
  { key:'aqua',    label:'Aqua',    swatch:'hsl(180,70%,45%)' },
  { key:'blue',    label:'Blue',    swatch:'hsl(220,80%,55%)' },
  { key:'purple',  label:'Purple',  swatch:'hsl(275,70%,55%)' },
  { key:'magenta', label:'Magenta', swatch:'hsl(320,75%,55%)' }
];
function peDefaultHsl() {
  const o = {};
  PE_HSL_BANDS.forEach(b => { o[b.key] = { h:0, s:0, l:0 }; });
  return o;
}
function peCloneHsl(hsl) {
  const o = peDefaultHsl();
  if (hsl) PE_HSL_BANDS.forEach(b => { if (hsl[b.key]) o[b.key] = Object.assign({}, hsl[b.key]); });
  return o;
}
// ── Tone curve math (Master + per-channel, monotone cubic spline) ──────────────
function peDefaultCurve() { return [{ x: 0, y: 0 }, { x: 255, y: 255 }]; }
function peDefaultCurves() { return { master: peDefaultCurve(), r: peDefaultCurve(), g: peDefaultCurve(), b: peDefaultCurve() }; }
function peCloneCurves(curves) {
  const d = peDefaultCurves();
  if (!curves) return d;
  ['master', 'r', 'g', 'b'].forEach(ch => { if (Array.isArray(curves[ch]) && curves[ch].length >= 2) d[ch] = curves[ch].map(p => ({ x: p.x, y: p.y })); });
  return d;
}
// Fritsch-Carlson monotone cubic Hermite interpolation - avoids the overshoot/ringing
// a plain Catmull-Rom spline would introduce near steep control points (which shows
// up as ugly color banding/halos once this curve is baked into a LUT).
function peMonotoneCubicSample(points) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  const out = new Float64Array(256);
  if (n < 2) { for (let i = 0; i < 256; i++) out[i] = i; return out; }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const d = new Array(n - 1), m = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d[i] = dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx;
  }
  const tang = new Array(n);
  tang[0] = d[0]; tang[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) tang[i] = (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] < 0) !== (d[i] < 0)) ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { tang[i] = 0; tang[i + 1] = 0; continue; }
    const a = tang[i] / d[i], b = tang[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); tang[i] = t * a * d[i]; tang[i + 1] = t * b * d[i]; }
  }
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const x0 = xs[seg], x1 = xs[seg + 1] || x0 + 1;
    const h = x1 - x0 || 1;
    const t = Math.min(1, Math.max(0, (x - x0) / h));
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const y = h00 * ys[seg] + h10 * h * tang[seg] + h01 * ys[seg + 1] + h11 * h * tang[seg + 1];
    out[x] = Math.min(255, Math.max(0, y));
  }
  return out;
}
// One-time conversion for edits saved before the curve tool replaced Levels -
// samples the old black/white/mid gamma formula at a handful of x positions so
// existing edited photos keep their look as master-curve control points.
function peLegacyToneCurvePoints(tone) {
  const { black, white, mid } = Object.assign({ black: 0, white: 255, mid: 0.5 }, tone);
  const gamma = Math.log(0.5) / Math.log(Math.min(0.99, Math.max(0.01, mid)));
  const range = Math.max(1, white - black);
  const sample = x => {
    let v = (x - black) / range;
    v = Math.min(1, Math.max(0, v));
    v = Math.pow(v, 1 / gamma);
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  const xs = [0, 32, 64, 96, 128, 160, 192, 224, 255];
  return xs.map(x => ({ x, y: sample(x) }));
}

const PE_VERTEX_SRC = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;
// Operates directly on sRGB values (no linearize/delinearize pass) - the standard
// shortcut for this scope. Exact constants are tuned by eye, not color science.
//
// Shared between the global pass (below) and each local-mask pass (PE_MASK_FRAGMENT_SRC) so
// the two produce identical math for identical slider values - spliced into both shader
// sources by string concatenation since GLSL 1.00 (WebGL1) has no #include mechanism.
const PE_TONE_ADJUST_GLSL = `
  vec3 peToneAdjust(vec3 cIn, float exposure, float contrast, float highlights, float shadows,
                     float whites, float blacks, float saturation, float vibrance,
                     float temp, float tint) {
    vec3 c = cIn;
    c.r *= 1.0 + temp * 0.3;
    c.b *= 1.0 - temp * 0.3;
    c.g *= 1.0 - tint * 0.3;

    c *= exp2(exposure * 2.0);

    c = (c - 0.5) * (1.0 + contrast) + 0.5;

    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    float wHi = smoothstep(0.5, 1.0, luma);
    float wSh = 1.0 - smoothstep(0.0, 0.5, luma);
    float wWh = smoothstep(0.75, 1.0, luma);
    float wBl = 1.0 - smoothstep(0.0, 0.25, luma);
    c += shadows    * 0.5 * wSh * (1.0 - c);
    c -= highlights * 0.5 * wHi * c;
    c += whites * 0.5 * wWh;
    c -= blacks * 0.5 * wBl;

    float luma2 = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(luma2), c, 1.0 + saturation);

    float mx = max(c.r, max(c.g, c.b));
    float satAmt = mx - luma2;
    c = mix(vec3(luma2), c, 1.0 + vibrance * (1.0 - satAmt));

    return clamp(c, 0.0, 1.0);
  }
`;

const PE_FRAGMENT_SRC = `
  precision highp float;
  uniform sampler2D u_image;
  uniform sampler2D u_curveLUT;
  uniform float u_exposure, u_contrast, u_highlights, u_shadows,
                u_whites, u_blacks, u_saturation, u_vibrance,
                u_temp, u_tint;
  uniform float u_clarity, u_dehaze, u_sharpness, u_vignette, u_grain; // PE_EFFECTS, all -1..1 (sharpness/grain 0..1)
  uniform vec3 u_hsl[8];
  uniform bool u_bypass;
  uniform float u_straighten; // degrees, fine-angle correction on top of the 90°-step file.rotation baked into the source pixels
  uniform float u_aspect;     // source canvas width/height, needed to rotate correctly on non-square images
  uniform vec2 u_texel;       // 1 / source size in pixels - the step between neighbouring source pixels
  uniform float u_resScale;   // longest edge / 2000, so radii cover the same share of the photo at any resolution
  varying vec2 v_uv;

  ` + PE_TONE_ADJUST_GLSL + `

  float peLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // 3x3 Gaussian around uv, r source pixels apart - the "blurred copy" for unsharp masking.
  vec3 peBlurSmall(vec2 uv, float r) {
    vec2 d = u_texel * r;
    vec3 edges = texture2D(u_image, uv + vec2(d.x, 0.0)).rgb + texture2D(u_image, uv - vec2(d.x, 0.0)).rgb
               + texture2D(u_image, uv + vec2(0.0, d.y)).rgb + texture2D(u_image, uv - vec2(0.0, d.y)).rgb;
    vec3 corners = texture2D(u_image, uv + d).rgb + texture2D(u_image, uv - d).rgb
                 + texture2D(u_image, uv + vec2(d.x, -d.y)).rgb + texture2D(u_image, uv + vec2(-d.x, d.y)).rgb;
    return (texture2D(u_image, uv).rgb * 4.0 + edges * 2.0 + corners) / 16.0;
  }

  // Average brightness of the wider neighbourhood (two rings of 8 taps) - what Clarity
  // pushes each pixel away from to bring out texture and local contrast.
  float peBlurWideLuma(vec2 uv, float r) {
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 dir = vec2(cos(a), sin(a)) * u_texel;
      sum += peLuma(texture2D(u_image, uv + dir * r).rgb);
      sum += peLuma(texture2D(u_image, uv + dir * r * 0.5).rgb);
    }
    return sum / 16.0;
  }

  // Smoothed value noise, so grain reads as film texture rather than single-pixel static.
  float peHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float peNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(peHash(i), peHash(i + vec2(1.0, 0.0)), f.x),
               mix(peHash(i + vec2(0.0, 1.0)), peHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Rotates the sample point by -angle around the frame center, auto-zooming just enough
  // that the rotated source still fully covers every corner of the frame - so straightening
  // a horizon crops in instead of revealing empty/stretched corners.
  vec2 applyStraighten(vec2 uv, float angleDeg, float aspect) {
    if (angleDeg == 0.0) return uv;
    float rad = radians(angleDeg);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float cs = cos(-rad), sn = sin(-rad);
    vec2 rotated = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    float longer = max(aspect, 1.0 / aspect);
    float z = cos(rad) + sin(abs(rad)) * longer;
    rotated /= z;
    return rotated / vec2(aspect, 1.0) + 0.5;
  }

  vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5;
    float d = mx - mn;
    float h = 0.0;
    float s = 0.0;
    if (d > 0.0001) {
      s = l < 0.5 ? d / (mx + mn) : d / (2.0 - mx - mn);
      if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
      else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
      if (h < 0.0) h += 1.0;
    }
    return vec3(h, s, l);
  }
  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c * 0.5;
    vec3 rgb;
    if (h < 1.0/6.0) rgb = vec3(c, x, 0.0);
    else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
    else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
    else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
    else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
    else rgb = vec3(c, 0.0, x);
    return rgb + m;
  }
  // Order/values must mirror the PE_HSL_BANDS JS array exactly (index-for-index).
  float hslBandCenter(int i) {
    if (i == 0) return 0.0;
    if (i == 1) return 30.0/360.0;
    if (i == 2) return 60.0/360.0;
    if (i == 3) return 120.0/360.0;
    if (i == 4) return 180.0/360.0;
    if (i == 5) return 220.0/360.0;
    if (i == 6) return 275.0/360.0;
    return 320.0/360.0;
  }
  vec3 applyHsl(vec3 rgbIn) {
    vec3 hsl = rgb2hsl(rgbIn);
    float hueShift = 0.0, satShift = 0.0, lumShift = 0.0;
    for (int i = 0; i < 8; i++) {
      float dist = abs(hsl.x - hslBandCenter(i));
      dist = min(dist, 1.0 - dist);
      float w = 1.0 - smoothstep(0.0, 0.09, dist);
      vec3 band = u_hsl[i];
      hueShift += band.x * w;
      satShift += band.y * w;
      lumShift += band.z * w;
    }
    hsl.x = fract(hsl.x + hueShift * 0.06 + 1.0);
    hsl.y = clamp(hsl.y * (1.0 + satShift), 0.0, 1.0);
    hsl.z = clamp(hsl.z + lumShift * 0.3, 0.0, 1.0);
    return hsl2rgb(hsl);
  }

  void main() {
    vec2 uv = applyStraighten(v_uv, u_straighten, u_aspect);
    vec4 src = texture2D(u_image, uv);
    if (u_bypass) { gl_FragColor = src; return; }
    vec3 c = src.rgb;
    float res = max(1.0, u_resScale);

    // Detail first, on the untouched source, so it sharpens real edges rather than whatever
    // the tone sliders made of them. Both work on brightness only - sharpening each colour
    // channel separately leaves coloured fringes along edges.
    if (u_sharpness > 0.0) {
      float detail = peLuma(c) - peLuma(peBlurSmall(uv, res));
      c += detail * u_sharpness * 2.5;
    }
    if (u_clarity != 0.0) {
      float l = peLuma(c);
      float detail = l - peBlurWideLuma(uv, 14.0 * res);
      float mid = 1.0 - pow(abs(l * 2.0 - 1.0), 2.0); // midtones only, so it never clips highlights or crushes shadows
      c += detail * u_clarity * 1.6 * mid;
    }
    c = clamp(c, 0.0, 1.0);

    c = peToneAdjust(c, u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks, u_saturation, u_vibrance, u_temp, u_tint);

    // Dehaze: positive pulls the haze floor out (deeper blacks, more contrast and colour),
    // negative lays a soft milky veil over the photo.
    if (u_dehaze > 0.0) {
      float k = u_dehaze * 0.15;
      c = clamp((c - k) / (1.0 - k), 0.0, 1.0);
      c = clamp(mix(vec3(peLuma(c)), c, 1.0 + u_dehaze * 0.3), 0.0, 1.0);
    } else if (u_dehaze < 0.0) {
      c = mix(c, vec3(0.82), -u_dehaze * 0.45);
    }

    c = applyHsl(c);

    c.r = texture2D(u_curveLUT, vec2(c.r, 0.5)).r;
    c.g = texture2D(u_curveLUT, vec2(c.g, 0.5)).g;
    c.b = texture2D(u_curveLUT, vec2(c.b, 0.5)).b;

    // Finishing touches last, on top of the final look. The vignette follows the frame's own
    // shape (v_uv, not straightened uv) so it stays centred after a tilt; negative darkens the
    // edges, positive lightens them.
    if (u_vignette != 0.0) {
      float d = length((v_uv - 0.5) * 2.0) / 1.41421;
      float w = smoothstep(0.25, 1.0, d);
      if (u_vignette < 0.0) c *= 1.0 + u_vignette * 0.85 * w;
      else c = mix(c, vec3(1.0), u_vignette * 0.75 * w);
    }
    if (u_grain > 0.0) {
      float n = peNoise(gl_FragCoord.xy / (1.2 * res)) - 0.5;
      float mid = 1.0 - abs(peLuma(c) * 2.0 - 1.0) * 0.6; // grain shows most in the midtones, like film
      c += n * u_grain * 0.28 * mid;
    }

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
  }
`;

// A local-mask pass: reads the previous pass's composite (u_prev) and this layer's mask
// alpha texture (u_mask, uploaded ALPHA-only - see peUploadMaskTexture), applies the exact
// same tone math as the global pass, and blends it in only where the mask says to, scaled
// by u_amount. Deliberately smaller than PE_FRAGMENT_SRC - no curve LUT, no HSL bands - see
// the plan's scoping note: local layers get the Light-tab sliders, not curves/HSL.
const PE_MASK_FRAGMENT_SRC = `
  precision highp float;
  uniform sampler2D u_prev;
  uniform sampler2D u_mask;
  uniform float u_exposure, u_contrast, u_highlights, u_shadows,
                u_whites, u_blacks, u_saturation, u_vibrance,
                u_temp, u_tint;
  uniform float u_amount; // 0..1, this layer's overall strength fader
  uniform bool u_invert;
  varying vec2 v_uv;

  ` + PE_TONE_ADJUST_GLSL + `

  void main() {
    vec4 prev = texture2D(u_prev, v_uv);
    float m = texture2D(u_mask, v_uv).a;
    if (u_invert) m = 1.0 - m;
    vec3 adjusted = peToneAdjust(prev.rgb, u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks, u_saturation, u_vibrance, u_temp, u_tint);
    gl_FragColor = vec4(mix(prev.rgb, adjusted, m * u_amount), prev.a);
  }
`;

function peCompileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Photo editor shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ── PhotoMod ────────────────────────────────────────────────────────────────
// The full editor, as its own destination rather than a mode hidden behind "Edit Photo".
// Two things make it different from the simple editor beyond the extra tools: it starts from
// the library (pick any photo without leaving it), and it never writes. Adjustments, layers,
// masks and brush strokes stay in memory until the user presses Save or Export - closing with
// unsaved work asks first and then throws it away, which is the only behaviour that makes a
// layer stack safe to experiment in.
function peSyncModeChrome() {
  const pro = peIsPro();
  const shell = document.getElementById('photoEditor');
  shell.classList.toggle('pe-pro', pro);
  shell.classList.toggle('pe-simple', !pro);
  document.getElementById('peModeTitle').innerHTML = pro ? peIconLead('photomod') + 'PhotoMod' : peIconLead('pencil') + 'Edit Photo';
  document.getElementById('peSaveBtn').style.display = pro ? '' : 'none';
  document.getElementById('peSaveChangesBtn').style.display = pro ? 'none' : '';
  document.getElementById('peCloseBtn').title = pro ? 'Close PhotoMod (asks first if there is anything unsaved)'
    : 'Close the editor (asks first if there are edits you have not saved)';
  document.getElementById('pePickBtn').style.display = pro ? '' : 'none';
  document.getElementById('peOpenInModBtn').style.display = pro ? 'none' : '';
  // The overlay canvases are static markup reused across sessions, so their pointer-events are
  // whatever the last tool left behind - re-derive them from this session's tool before the
  // user can click on a stale one.
  peSyncToolCanvases();
  pmOpenMenu = null;
  pmRenderMenubar();
  if (!pro) document.getElementById('pmAdjustPanel').classList.remove('open');
}

async function openPhotoMod(fileId) {
  if (fileId) { await openPhotoEditor(fileId, 'pro'); return; }
  // Opening PhotoMod from the sidebar is the one moment where "blank canvas" and "a photo I
  // already have" are equally likely, so it asks rather than assuming the library.
  document.getElementById('pmStartModal').classList.add('open');
}
function pmStartFrom(what) {
  pmCloseModal('pmStartModal');
  if (what === 'canvas') pmOpenNewDocModal();
  else pmOpenPicker('open');
}

// Handing the photo across saves the simple editor's edits to file.edits first, so the pro
// editor picks up exactly the look you were looking at.
async function peOpenInPhotoMod() {
  const id = peFileId;
  if (!id) return;
  const back = popupReturn; // hand the way back to the preview on to PhotoMod, not this close
  popupReturn = null;
  await closePhotoEditor(true, true);
  popupReturn = back;
  await openPhotoEditor(id, 'pro');
}

let pmPageObserver = null;

// The same library browser serves two jobs: 'open' replaces the document, 'place' drops the
// chosen photo onto the current one as a layer. Only the verb differs, so only the mode does.
let pmPickerMode = 'open';
function pmOpenPicker(mode) {
  pmPickerMode = mode === 'place' ? 'place' : 'open';
  document.getElementById('pmSearchInput').value = '';
  document.getElementById('pmPickTitle').innerHTML = pmPickerMode === 'place' ? peIconLead('image') + 'Add Photo &amp; Place' : peIconLead('photomod') + 'PhotoMod';
  document.getElementById('photoModPick').classList.add('open');
  pmRenderList();
  setTimeout(() => document.getElementById('pmSearchInput').focus(), 60);
}
// File > Add photo & place. Needs a document open to place onto; without one it behaves as
// plain Open, which is what the user must have meant.
function pmAddPhotoAndPlace() {
  if (!peOpen) { pmOpenPicker('open'); return; }
  pmOpenPicker('place');
}

function closePhotoModPicker() {
  if (pmPageObserver) { pmPageObserver.disconnect(); pmPageObserver = null; }
  document.getElementById('photoModPick').classList.remove('open');
}

function pmRenderList() {
  const q = document.getElementById('pmSearchInput').value.trim().toLowerCase();
  const all = appData.files.filter(f => isEditable(f.ext) && !f._missing);
  const list = q ? all.filter(f => f.name.toLowerCase().includes(q)) : all;
  // Most recently shot first - the photo you want to work on is nearly always a recent one.
  list.sort((a, b) => new Date(b.fileDate || b.dateAdded || 0) - new Date(a.fileDate || a.dateAdded || 0));
  const box = document.getElementById('pmResultsList');
  if (pmPageObserver) { pmPageObserver.disconnect(); pmPageObserver = null; }
  box.innerHTML = '';
  document.getElementById('pmPickSub').textContent = list.length
    ? `${list.length} photo${list.length !== 1 ? 's' : ''} - pick one to open in the full editor.`
    : '';
  if (!list.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">${peIcon('photomod')}</div><div class="empty-title">${q ? 'No matches' : 'No photos yet'}</div><div class="empty-sub">${q ? 'Try a different search term.' : 'Add some photos to your library first.'}</div></div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'vp-grid';
  box.appendChild(grid);
  const append = files => files.forEach(f => {
    const wrap = document.createElement('div');
    wrap.innerHTML = vpCardHtml(f, false);
    const el = wrap.firstElementChild;
    el.addEventListener('click', () => pmPick(f.id));
    grid.appendChild(el);
    const thumbEl = el.querySelector('[data-thumb-for]');
    if (thumbEl) observeThumb(thumbEl);
  });
  const initial = Math.min(list.length, PAGE_SIZE);
  append(list.slice(0, initial));
  if (list.length > initial) {
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    box.appendChild(sentinel);
    let rendered = initial;
    pmPageObserver = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      const batch = list.slice(rendered, rendered + PAGE_SIZE);
      if (!batch.length) { pmPageObserver.disconnect(); return; }
      rendered += batch.length;
      append(batch);
      if (rendered >= list.length) pmPageObserver.disconnect();
    }, { rootMargin: '400px' });
    pmPageObserver.observe(sentinel);
  }
}

async function pmPick(fileId) {
  if (pmPickerMode === 'place') { closePhotoModPicker(); await pmPlacePhotoLayer(fileId); return; }
  // Swapping photos mid-session is a close and a re-open, so the unsaved-work guard below
  // still gets its say before the current one is dropped.
  if (peOpen) {
    const answer = await peConfirmDiscard();
    if (!answer) return;
    await closePhotoEditor(true, answer === 'save');
  }
  closePhotoModPicker();
  await openPhotoEditor(fileId, 'pro');
}

// Loads a library photo at editing resolution and drops it in as a layer, centred and scaled
// to fit - the same path a paste takes, so it inherits move/scale/rotate/blend for free.
async function pmPlacePhotoLayer(fileId) {
  const file = appData.files.find(f => f.id === fileId);
  if (!file || !peOpen) return;
  toast(`Loading ${file.name}…`);
  let result = null;
  try { result = await loadEditableImage(file); } catch (e) {}
  if (!result?.base64) { toast('⚠️ Could not load that photo'); return; }
  const img = new Image();
  const ok = await new Promise(resolve => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = `data:image/jpeg;base64,${result.base64}`;
  });
  if (!ok) { toast('⚠️ Could not decode that photo'); return; }
  // Honour the library's own rotation so a placed photo arrives the way up it looks everywhere
  // else in Trove, not the way its raw pixels happen to sit.
  const source = file.rotation ? drawRotatedToCanvas(img, file.rotation) : img;
  peAddLayerFromImage(source, file.name);
  peSelectTool('move');
}

// Pro mode holds everything in memory, so the one place it can lose work is the Close button.
let pmDiscardResolve = null;
// Asked before an editor with unsaved work goes away. Resolves false (keep editing), 'discard',
// 'save' (simple editor only: PhotoMod's Save writes a new file, which is its own decision), or
// true when there was nothing to lose.
function peConfirmDiscard() {
  if (!peDirty) return Promise.resolve(true);
  const pro = peIsPro();
  document.getElementById('pmDiscardText').textContent = pro
    ? "PhotoMod doesn't save as you go - your layers, masks and adjustments are only kept if you press Save (or Export them to a new file). Close now and this work is gone."
    : 'Your edits to this photo are only kept if you save them. Discard them and the photo stays exactly as it was when you opened it.';
  document.getElementById('pmDiscardSaveBtn').style.display = pro ? 'none' : '';
  document.getElementById('pmDiscardModal').classList.add('open');
  return new Promise(resolve => { pmDiscardResolve = resolve; });
}
function pmAnswerDiscard(discard) {
  document.getElementById('pmDiscardModal').classList.remove('open');
  const resolve = pmDiscardResolve;
  pmDiscardResolve = null;
  if (resolve) resolve(discard);
}

// The explicit "keep this" verb PhotoMod's no-autosave rule hinges on: commits the recipe to
// file.edits and flattens any layers, exactly as the simple editor's close path does.
// What PhotoMod writes a picture as. JPEG unless there's a reason not to: PNG keeps every pixel
// exactly, but on a photo that's 4-5x the size - which is how a 3MB photo used to come back as a
// 16MB "edit". PNG stays for what actually needs it: transparency (JPEG has none), a source
// that was lossless to begin with, and blank-canvas designs, where text and flat colour are
// exactly what JPEG smears.
const PM_LOSSLESS_EXT = /\.(png|tiff?|bmp|gif)$/i;
function pmOutputFormat(canvas, file) {
  if (!file || PM_LOSSLESS_EXT.test(file.path) || pmHasTransparency(canvas)) return { mime: 'image/png', ext: 'png' };
  return { mime: 'image/jpeg', ext: 'jpg', quality: 0.92 };
}
// A saved edit should be as detailed as the photo it came from - no better (bigger for nothing),
// no worse. The quality *number* can't carry that across: a phone camera's JPEG encoder and
// Chromium's use different tables, so the same number means different things. Bytes per pixel
// can, so the quality is binary-searched until the edit is as dense as the original was.
// The floor is 0.85, below which JPEG artefacts start to show on photos. A photo that wasn't a
// JPEG (HEIC packs about twice as much into each byte) gets a fixed 0.92 instead of a size that
// would starve JPEG.
const PE_JPEG_MIN_Q = 0.85;
async function peEncodeJpegLikeOriginal(canvas, file) {
  const encode = q => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
  const origPixels = file && file.width && file.height ? file.width * file.height
    : peRawCanvas ? peRawCanvas.width * peRawCanvas.height : 0;
  if (!file?.size || !origPixels || !/\.(jpe?g|jpe|jfif)$/i.test(file.path)) return encode(0.92);
  const target = file.size / origPixels * canvas.width * canvas.height;
  let lo = PE_JPEG_MIN_Q, hi = 1, best = null;
  for (let i = 0; i < 6; i++) {
    const q = (lo + hi) / 2;
    const blob = await encode(q);
    if (!blob) break;
    if (blob.size <= target) { best = blob; lo = q; } else hi = q;
  }
  // Even the floor came out heavier than the original: it was compressed harder than looks
  // good, so keep the floor rather than follow it down.
  return best || encode(PE_JPEG_MIN_Q);
}
function pmHasTransparency(canvas) {
  // The composite is either a 2D canvas already or the bare WebGL one, which has to be copied
  // into 2D before its pixels can be read.
  let ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    ctx = copy.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
  }
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

async function peSaveToLibrary() {
  if (!peOpen) return;
  pmCommitLiveMesh(); // an un-applied transform/warp still counts as part of the picture
  const canvas = peCompositeCanvas();
  if (!canvas) { toast('⚠️ Nothing to save yet'); return; }
  const file = appData.files.find(f => f.id === peFileId);
  const fmt = pmOutputFormat(canvas, file);
  const blob = fmt.ext === 'jpg' ? await peEncodeJpegLikeOriginal(canvas, file) : await new Promise(res => canvas.toBlob(res, fmt.mime));
  if (!blob) { toast('⚠️ Could not render the document'); return; }
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  // PhotoMod flattens on save. It is a raster document editor, so what it hands the library is
  // a finished picture, linked as a version of whatever photo it started from - never a rewrite
  // of the original, and never the recipe that the simple editor keeps.
  let res = null;
  if (file) {
    res = await window.api.bakeEditedImage(base64, file.path, fmt.ext).catch(() => null);
  } else {
    const name = (pmDocName || 'Untitled').replace(/[\\/:*?"<>|]/g, '-');
    res = await window.api.exportEditedImage(base64, `${name}.png`, '').catch(() => null);
  }
  if (!res?.success) { toast(file ? '⚠️ Could not write the flattened copy' : '⚠️ Save cancelled'); return; }
  const added = await window.api.processDroppedPaths([res.path]).catch(() => []);
  const entry = added && added[0];
  if (!entry) { toast('⚠️ Saved the file, but could not add it to the library'); peDirty = false; return; }
  if (file) {
    entry.versionParentId = file.id;
    entry.folders = [...(file.folders || [])];
    syncEditedMetadataFromOriginal(file, entry);
  }
  appData.files.push(entry);
  queueForIndexing([entry]);
  await saveData();
  peDirty = false;
  renderFiles();
  toast(`💾 Saved as ${entry.name}${file ? ' and linked to the original' : ''}`, 5000);
}

// ── Per-layer colour ────────────────────────────────────────────────────────
// A layer gets the same Light/Curve/Colour-mix controls the photo does, run through the same
// shaders - just on its own private GL context and rendered into a canvas the compositor draws
// instead of the raw bitmap. Sharing the main context isn't an option: that one is bound to
// #peCanvas at the document's size, and this pass has to run at each layer's size.
let pmColorGl = null, pmColorProgram = null, pmColorUniforms = null, pmColorGlCanvas = null;
let pmColorTex = null, pmColorLutTex = null;
function pmEnsureColorGl() {
  if (pmColorGl && !pmColorGl.isContextLost()) return true;
  pmColorGlCanvas = document.createElement('canvas');
  const gl = pmColorGlCanvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) return false;
  const vs = peCompileShader(gl, gl.VERTEX_SHADER, PE_VERTEX_SRC);
  const fs = peCompileShader(gl, gl.FRAGMENT_SHADER, PE_FRAGMENT_SRC);
  if (!vs || !fs) return false;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  pmColorUniforms = { image: gl.getUniformLocation(prog, 'u_image'), curveLUT: gl.getUniformLocation(prog, 'u_curveLUT'),
    bypass: gl.getUniformLocation(prog, 'u_bypass'), hsl: gl.getUniformLocation(prog, 'u_hsl'),
    straighten: gl.getUniformLocation(prog, 'u_straighten'), aspect: gl.getUniformLocation(prog, 'u_aspect') };
  PE_ADJUSTMENTS.forEach(a => { pmColorUniforms[a.key] = gl.getUniformLocation(prog, 'u_' + a.key); });
  pmColorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, pmColorTex);
  [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
   [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]
    .forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v));
  pmColorLutTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, pmColorLutTex);
  [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
   [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]
    .forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v));
  pmColorGl = gl; pmColorProgram = prog;
  return true;
}
// What the compositor should actually paint for this layer.
function pmLayerDrawable(layer) {
  if (!layer.colors || pmLayerColorsAreDefault(layer.colors)) return layer._bitmap;
  const sig = JSON.stringify(layer.colors) + '|' + (layer._bitmap?.width) + 'x' + (layer._bitmap?.height);
  if (layer._colorSig === sig && layer._colorCanvas) return layer._colorCanvas;
  const out = pmRenderLayerColors(layer);
  if (!out) return layer._bitmap;
  layer._colorCanvas = out;
  layer._colorSig = sig;
  return out;
}
function pmInvalidateLayerColors(layer) { if (layer) { layer._colorSig = null; layer._colorCanvas = null; } }
function pmRenderLayerColors(layer) {
  const bmp = layer._bitmap;
  if (!bmp || !pmEnsureColorGl()) return null;
  const gl = pmColorGl;
  const w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  if (w > max || h > max) return null; // too big to process; show it unadjusted rather than blank
  pmColorGlCanvas.width = w; pmColorGlCanvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(pmColorProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pmColorTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.uniform1i(pmColorUniforms.image, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, pmColorLutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, peBuildCurveLUT(layer.colors.curves));
  gl.uniform1i(pmColorUniforms.curveLUT, 1);
  gl.uniform1i(pmColorUniforms.bypass, 0);
  PE_ADJUSTMENTS.forEach(a => gl.uniform1f(pmColorUniforms[a.key], (layer.colors.adjustments[a.key] || 0) / 100));
  const hslFlat = new Float32Array(24);
  PE_HSL_BANDS.forEach((b, i) => {
    const v = layer.colors.hsl[b.key] || { h: 0, s: 0, l: 0 };
    hslFlat[i*3] = (v.h || 0) / 100; hslFlat[i*3+1] = (v.s || 0) / 100; hslFlat[i*3+2] = (v.l || 0) / 100;
  });
  gl.uniform3fv(pmColorUniforms.hsl, hslFlat);
  gl.uniform1f(pmColorUniforms.straighten, 0); // straighten is a document control, not a layer one
  gl.uniform1f(pmColorUniforms.aspect, h ? w / h : 1);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return peCopyCanvas(pmColorGlCanvas, w, h); // snapshotted, because the GL canvas is reused by the next layer
}

// Which state the Adjustments panel is currently editing: the photo, or one layer. Every
// slider, curve and swatch in that panel reads and writes through here, so the same controls
// and the same handlers serve both without a parallel set of each.
let pmColorTarget = null; // layer id, or null for the document's base photo
function pmColorTargetLayer() { return pmColorTarget ? (peLayers || []).find(l => l.id === pmColorTarget) : null; }
function pmColorState() {
  const l = pmColorTargetLayer();
  if (!l) return { adjustments: peAdjustments, curves: peCurves, hsl: peHsl };
  if (!l.colors) l.colors = pmDefaultLayerColors();
  return l.colors;
}
function pmColorRepaint() {
  const l = pmColorTargetLayer();
  if (l) { pmInvalidateLayerColors(l); peCompositeLayers(); }
  else peRender();
}
function pmColorLutRefresh() {
  if (!pmColorTargetLayer()) peUpdateToneLUT();
}

// ── Mesh rendering ──────────────────────────────────────────────────────────
// The engine behind both Warp and Free Transform's distort. Canvas 2D can only draw an image
// under an affine transform, so anything non-affine - a perspective quad, a bent mesh - has to
// be cut into small triangles, each drawn with its own affine map into a clipped path. Fine
// enough subdivision and the seams between them disappear; the clip paths are nudged outward
// by half a pixel because otherwise antialiasing leaves hairline gaps along every shared edge.
const PM_MESH_SUB = 10; // sub-quads per grid cell per axis

function pmDrawTriangle(ctx, bmp, s0, s1, s2, d0, d1, d2) {
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = p => {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
    return { x: p.x + dx / len * 0.6, y: p.y + dy / len * 0.6 };
  };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath();
  ctx.clip();
  // Affine map taking the source triangle onto the destination one.
  const denom = s0.x * (s2.y - s1.y) - s1.x * s2.y + s2.x * s1.y + (s1.x - s2.x) * s0.y;
  if (!denom) { ctx.restore(); return; }
  const m11 = -(s0.y * (d2.x - d1.x) - s1.y * d2.x + s2.y * d1.x + (s1.y - s2.y) * d0.x) / denom;
  const m12 = (s1.y * d2.y + s0.y * (d1.y - d2.y) - s2.y * d1.y + (s2.y - s1.y) * d0.y) / denom;
  const m21 = (s0.x * (d2.x - d1.x) - s1.x * d2.x + s2.x * d1.x + (s1.x - s2.x) * d0.x) / denom;
  const m22 = -(s1.x * d2.y + s0.x * (d1.y - d2.y) - s2.x * d1.y + (s2.x - s1.x) * d0.y) / denom;
  const dx = (s0.x * (s2.y * d1.x - s1.y * d2.x) + s0.y * (s1.x * d2.x - s2.x * d1.x) + (s2.x * s1.y - s1.x * s2.y) * d0.x) / denom;
  const dy = (s0.x * (s2.y * d1.y - s1.y * d2.y) + s0.y * (s1.x * d2.y - s2.x * d1.y) + (s2.x * s1.y - s1.x * s2.y) * d0.y) / denom;
  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(bmp, 0, 0);
  ctx.restore();
}

// Draws `bmp` so that its unit square maps through `sample(u,v)` into destination space.
function pmDrawSampledMesh(ctx, bmp, sample, cols, rows) {
  const bw = bmp.naturalWidth || bmp.width, bh = bmp.naturalHeight || bmp.height;
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) pts.push(sample(i / cols, j / rows));
  }
  const at = (i, j) => pts[j * (cols + 1) + i];
  const src = (i, j) => ({ x: i / cols * bw, y: j / rows * bh });
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const s00 = src(i, j), s10 = src(i + 1, j), s11 = src(i + 1, j + 1), s01 = src(i, j + 1);
      const d00 = at(i, j), d10 = at(i + 1, j), d11 = at(i + 1, j + 1), d01 = at(i, j + 1);
      pmDrawTriangle(ctx, bmp, s00, s10, s11, d00, d10, d11);
      pmDrawTriangle(ctx, bmp, s00, s11, s01, d00, d11, d01);
    }
  }
}

// Exact projective map from the unit square onto an arbitrary quad, so a distorted corner
// reads as perspective rather than the sheared-bilinear look of a naive four-point warp.
function pmHomography(q) {
  const [p0, p1, p2, p3] = q; // (0,0) (1,0) (1,1) (0,1)
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (dx3 || dy3) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (den) { g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  }
  return {
    a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y, g, h
  };
}
function pmProject(m, u, v) {
  const w = m.g * u + m.h * v + 1 || 1e-6;
  return { x: (m.a * u + m.b * v + m.c) / w, y: (m.d * u + m.e * v + m.f) / w };
}

// Catmull-Rom through the warp's control points, so pushing one handle bends its neighbourhood
// smoothly instead of creasing the mesh at the cell borders a plain bilinear patch would give.
function pmCatmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function pmSampleWarpGrid(grid, gw, gh, u, v) {
  const at = (i, j) => grid[Math.min(gh, Math.max(0, j)) * (gw + 1) + Math.min(gw, Math.max(0, i))];
  const fx = u * gw, fy = v * gh;
  const i = Math.min(gw - 1, Math.floor(fx)), j = Math.min(gh - 1, Math.floor(fy));
  const tu = fx - i, tv = fy - j;
  const col = [];
  for (let n = -1; n <= 2; n++) {
    const row = [-1, 0, 1, 2].map(m => at(i + m, j + n));
    col.push({
      x: pmCatmull(row[0].x, row[1].x, row[2].x, row[3].x, tu),
      y: pmCatmull(row[0].y, row[1].y, row[2].y, row[3].y, tu)
    });
  }
  return {
    x: pmCatmull(col[0].x, col[1].x, col[2].x, col[3].x, tv),
    y: pmCatmull(col[0].y, col[1].y, col[2].y, col[3].y, tv)
  };
}

// ── Free Transform + Warp sessions ──────────────────────────────────────────
// Both are live, cancellable sessions over one layer: the layer's own pixels are untouched
// until Apply, which is what makes Escape safe and what lets the stage show the real result
// rather than a wireframe preview.
let pmTfCanvas = null, pmTfCtx = null;
let pmTransform = null; // { layerId, quad:[4 pts], start:{...} } while Free Transform is live
let pmWarp = null;      // { layerId, gw, gh, grid:[pts], rect } while Warp is live
let pmHandleDrag = null;

function pmLiveMeshLayerId() { return pmTransform?.layerId || pmWarp?.layerId || null; }
function pmActiveLayer() { return (peLayers || []).find(l => l.id === peActiveLayerId) || null; }

// The layer's current on-canvas quad, honouring its position, scale and rotation - the starting
// shape both sessions hand the user.
function pmLayerQuad(layer) {
  const { w, h } = peLayerSize(layer);
  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (!layer.rotation) return corners.map(p => ({ x: p.x + layer.x, y: p.y + layer.y }));
  const rad = layer.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = layer.x + w / 2, cy = layer.y + h / 2;
  return corners.map(p => {
    const dx = p.x - w / 2, dy = p.y - h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

// Transform starts locked, the way it does in Photoshop: dragging a corner scales the layer as
// a whole, width and height together, so the ordinary case can't accidentally squash the
// picture. The freer modes - which is where distort, skew and perspective live - are one
// right-click away on the canvas rather than something you fall into.
// PhotoMod's icon set: plain line icons on a 24px grid, drawn in currentColor so they follow
// the rail's hover/active colours. Emoji rendered differently on every machine and never
// looked like tools; these read the way Photoshop/Figma users expect.
const PE_ICON_PATHS = {
  move:        '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  transform:   '<path d="M7 5h10M7 19h10M5 7v10M19 7v10"/><rect x="3" y="3" width="4" height="4" rx=".5" fill="currentColor"/><rect x="17" y="3" width="4" height="4" rx=".5" fill="currentColor"/><rect x="3" y="17" width="4" height="4" rx=".5" fill="currentColor"/><rect x="17" y="17" width="4" height="4" rx=".5" fill="currentColor"/>',
  warp:        '<path d="M3 6c3-2.5 6 2.5 9 0s6 2.5 9 0M3 12c3-2.5 6 2.5 9 0s6 2.5 9 0M3 18c3-2.5 6 2.5 9 0s6 2.5 9 0"/>',
  marquee:     '<rect x="3.5" y="4.5" width="17" height="15" rx="1" stroke-dasharray="3 2.5"/>',
  ellipse:     '<ellipse cx="12" cy="12" rx="9" ry="7.5" stroke-dasharray="3 2.5"/>',
  autosel:     '<path d="m3 21 11-11"/><path d="m12.5 8.5 3 3"/><path d="M18 2v4M16 4h4M21 9v3M19.5 10.5h3M10 2v2M9 3h2"/>',
  lasso:       '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><circle cx="5" cy="16" r="2"/>',
  text:        '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  pencil:      '<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  bucket:      '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  eraser:      '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7M5 11l9 9"/>',
  dropper:     '<path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  mask:        '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  heal:        '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l7.6-7.6c1-1 2.5-1 3.4 0l3.6 3.6c1 1 1 2.5 0 3.4L13 21"/><path d="M13 21H7M5 11l7 7"/><path d="M19 2v5M16.5 4.5h5"/>',
  scale:       '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  free:        '<path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  distort:     '<path d="M5 6 18 3l3 15-16 3z"/>',
  skew:        '<path d="M8 5h13l-5 14H3z"/>',
  perspective: '<path d="M8 5h8l5 14H3z"/>',
  reset:       '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  undo:        '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash:       '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy:        '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  cut:         '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  invert:      '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  check:       '<path d="M20 6 9 17l-5-5"/>',
  plus:        '<path d="M12 5v14M5 12h14"/>',
  minus:       '<path d="M5 12h14"/>',
  rotateRight: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  open:        '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  save:        '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
  export:      '<path d="M12 15V3M7 10l5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  eye:         '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:      '<path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>',
  image:       '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  photomod:    '<rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/><circle cx="12" cy="8" r="1.5"/><path d="m21 13-4-4-6 6"/>',
  canvas:      '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5"/><path d="M12 8v8M8 12h8"/>',
  layer:       '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  settings:    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  palette:     '<circle cx="13.5" cy="6.5" r="1" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.3-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z"/>',
  compare:     '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7z" fill="currentColor" fill-opacity=".35" stroke="none"/>',
  clip:        '<path d="M9 4v6a4 4 0 0 0 4 4h7"/><path d="m16 10 4 4-4 4"/>',
  faceScan:    '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="10" r="3"/><path d="M7 18a5 5 0 0 1 10 0"/>',
  close:       '<path d="M18 6 6 18M6 6l12 12"/>'
};
// Static buttons in index.html name their icon with data-icon; this puts the SVG in once at
// startup, so the markup doesn't have to repeat the path data. A button with a label gets a
// little space between icon and text.
function peApplyStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    if (el.querySelector(':scope > .pe-icon')) return;
    el.insertAdjacentHTML('afterbegin', el.textContent.trim() ? peIconLead(el.dataset.icon) : peIcon(el.dataset.icon));
  });
}
function peIconLead(name) { return peIcon(name).replace('class="pe-icon"', 'class="pe-icon pe-icon-lead"'); }
function peIcon(name) {
  return `<svg class="pe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PE_ICON_PATHS[name] || ''}</svg>`;
}

const PM_TF_MODES = [
  ['scale',       peIcon('scale'),       'Scale (locked)',   'Corners keep the proportions. Edges stretch one side.'],
  ['free',        peIcon('free'),        'Scale (free)',     'Corners stretch width and height independently.'],
  ['distort',     peIcon('distort'),     'Distort',          'Every corner moves on its own, anywhere you like.'],
  ['skew',        peIcon('skew'),        'Skew',             'Edges slide sideways; corners stay on their lines.'],
  ['perspective', peIcon('perspective'), 'Perspective',      'A corner and its neighbour move in opposite directions, as if tilting away.']
];
let pmTfMode = 'scale';
function pmSetTfMode(mode) {
  pmTfMode = mode;
  pmHideTfMenu();
  if (mode === 'warp') { peSelectTool('warp'); return; }
  if (peTool !== 'transform') peSelectTool('transform');
  else { pmDrawHandles(); peRenderPanel(); }
}

function pmBeginTransform() {
  const layer = pmActiveLayer();
  if (!layer?._bitmap) { toast('Select a layer first - Free Transform works on a layer, not the photo'); return false; }
  pmEndWarp(false);
  pmTransform = { layerId: layer.id, quad: pmLayerQuad(layer) };
  peCompositeLayers();
  pmDrawHandles();
  return true;
}
function pmBeginWarp() {
  const layer = pmActiveLayer();
  if (!layer?._bitmap) { toast('Select a layer first - Warp works on a layer, not the photo'); return false; }
  pmEndTransform(false);
  const gw = 3, gh = 3;
  const quad = pmLayerQuad(layer);
  const m = pmHomography(quad);
  const grid = [];
  for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) grid.push(pmProject(m, i / gw, j / gh));
  pmWarp = { layerId: layer.id, gw, gh, grid };
  peCompositeLayers();
  pmDrawHandles();
  return true;
}

// Paints the current session through the mesh renderer. Called from peCompositeLayers for the
// live preview, and again by the bake below with a full-document target.
function pmDrawLiveMesh(ctx, layer) {
  if (pmTransform && pmTransform.layerId === layer.id) {
    const m = pmHomography(pmTransform.quad);
    pmDrawSampledMesh(ctx, layer._bitmap, (u, v) => pmProject(m, u, v), PM_MESH_SUB * 2, PM_MESH_SUB * 2);
  } else if (pmWarp && pmWarp.layerId === layer.id) {
    const { grid, gw, gh } = pmWarp;
    pmDrawSampledMesh(ctx, layer._bitmap, (u, v) => pmSampleWarpGrid(grid, gw, gh, u, v), gw * PM_MESH_SUB, gh * PM_MESH_SUB);
  }
}

// Bakes whichever session is live into the layer's own pixels, cropped to what it now covers.
function pmBakeLiveMesh() {
  const id = pmLiveMeshLayerId();
  const layer = (peLayers || []).find(l => l.id === id);
  if (!layer?._bitmap || !peSourceCanvas) return false;
  const pts = pmTransform ? pmTransform.quad : pmWarp.grid;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  // Padding absorbs the outward nudge in pmDrawTriangle and any spline overshoot at the edges.
  const pad = 2;
  const minX = Math.floor(Math.min(...xs)) - pad, minY = Math.floor(Math.min(...ys)) - pad;
  const maxX = Math.ceil(Math.max(...xs)) + pad, maxY = Math.ceil(Math.max(...ys)) + pad;
  const w = Math.max(1, Math.min(12000, maxX - minX)), h = Math.max(1, Math.min(12000, maxY - minY));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.translate(-minX, -minY);
  pmDrawLiveMesh(ctx, layer);
  layer._bitmap = out;
  layer.dataUrl = out.toDataURL('image/png');
  layer.x = minX; layer.y = minY; layer.scale = 100; layer.rotation = 0; // the shape is in the pixels now
  return true;
}
function pmEndTransform(apply) {
  if (!pmTransform) return;
  const changed = apply && pmTransform.touched && pmBakeLiveMesh();
  pmTransform = null;
  pmHandleDrag = null;
  if (changed) { pePushHistory('free transform'); peDirty = true; }
  peCompositeLayers();
  pmDrawHandles();
  peRenderLayersPanel();
  if (changed) toast('⤢ Transform applied');
}
function pmEndWarp(apply) {
  if (!pmWarp) return;
  const changed = apply && pmWarp.touched && pmBakeLiveMesh();
  pmWarp = null;
  pmHandleDrag = null;
  if (changed) { pePushHistory('warp'); peDirty = true; }
  peCompositeLayers();
  pmDrawHandles();
  peRenderLayersPanel();
  if (changed) toast('〰 Warp applied');
}
// Used by Save/Export: an un-applied session is still what the user is looking at, so it gets
// baked rather than dropped on the way out.
function pmCommitLiveMesh() {
  if (pmTransform) pmEndTransform(true);
  if (pmWarp) pmEndWarp(true);
}
function pmApplyLiveMesh() {
  if (pmTransform) { pmEndTransform(true); peSelectTool('move'); }
  else if (pmWarp) { pmEndWarp(true); peSelectTool('move'); }
}
function pmCancelLiveMesh() {
  if (pmTransform) { pmEndTransform(false); peSelectTool('move'); }
  else if (pmWarp) { pmEndWarp(false); peSelectTool('move'); }
}
function pmResetLiveMesh() {
  if (pmTransform) { pmTransform = null; pmBeginTransform(); }
  else if (pmWarp) { pmWarp = null; pmBeginWarp(); }
  peRenderPanel();
}

// ── Handles ─────────────────────────────────────────────────────────────────
// Transform shows 4 corners (free distort), 4 edge midpoints (scale that side) and a rotate
// knob; Warp shows its whole control grid plus the mesh lines between the points.
function pmHandlePoints() {
  if (pmTransform) {
    const q = pmTransform.quad;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const corners = q.map((p, i) => ({ kind: 'corner', i, x: p.x, y: p.y }));
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b], i) => {
      const m = mid(q[a], q[b]);
      return { kind: 'edge', i, x: m.x, y: m.y };
    });
    const top = mid(q[0], q[1]);
    const centre = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
    const len = Math.hypot(top.x - centre.x, top.y - centre.y) || 1;
    const knob = { kind: 'rotate', i: 0, x: top.x + (top.x - centre.x) / len * 46, y: top.y + (top.y - centre.y) / len * 46 };
    return [...corners, ...edges, knob];
  }
  if (pmWarp) return pmWarp.grid.map((p, i) => ({ kind: 'grid', i, x: p.x, y: p.y }));
  return [];
}
function pmDrawHandles() {
  if (!pmTfCtx || !pmTfCanvas) return;
  pmTfCtx.clearRect(0, 0, pmTfCanvas.width, pmTfCanvas.height);
  if (!pmTransform && !pmWarp) return;
  // Handles are drawn in image pixels but must look the same size whatever the zoom, so every
  // measurement below is scaled by the ratio between the canvas and its rendered box.
  const scale = pmTfCanvas.width / Math.max(1, pmTfCanvas.getBoundingClientRect().width || pmTfCanvas.width);
  const ctx = pmTfCtx;
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.shadowColor = 'rgba(0,0,0,.65)';
  ctx.shadowBlur = 3 * scale;
  if (pmTransform) {
    const q = pmTransform.quad;
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (const p of q.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.stroke();
  } else {
    const { grid, gw, gh } = pmWarp;
    const steps = 12;
    ctx.beginPath();
    for (let j = 0; j <= gh; j++) for (let s = 0; s <= steps * gw; s++) {
      const p = pmSampleWarpGrid(grid, gw, gh, s / (steps * gw), j / gh);
      s ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    for (let i = 0; i <= gw; i++) for (let s = 0; s <= steps * gh; s++) {
      const p = pmSampleWarpGrid(grid, gw, gh, i / gw, s / (steps * gh));
      s ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.globalAlpha = .5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Snap guides, drawn only while a handle is actually locked onto one.
  for (const g of pmSnapGuides) {
    ctx.save();
    ctx.strokeStyle = g.kind === 'centre' ? 'rgba(255,90,160,.95)' : 'rgba(90,190,255,.95)';
    ctx.lineWidth = Math.max(1, 1.2 * scale);
    ctx.setLineDash([9 * scale, 7 * scale]);
    ctx.beginPath();
    if (g.axis === 'x') { ctx.moveTo(g.at, 0); ctx.lineTo(g.at, pmTfCanvas.height); }
    else { ctx.moveTo(0, g.at); ctx.lineTo(pmTfCanvas.width, g.at); }
    ctx.stroke();
    ctx.restore();
  }
  for (const h of pmHandlePoints()) {
    const r = (h.kind === 'rotate' ? 7 : h.kind === 'corner' ? 6 : 5) * scale;
    ctx.beginPath();
    if (h.kind === 'rotate') ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    else ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
    ctx.fillStyle = h.kind === 'corner' ? '#fff' : h.kind === 'rotate' ? '#ffd166' : 'rgba(255,255,255,.82)';
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Handle dragging, plus the eyedropper - both live on #peTransformCanvas, the topmost stage
// canvas, so neither can be confused with a paint stroke or a layer drag underneath.
function setupPhotoModHandles() {
  const canvas = document.getElementById('peTransformCanvas');
  if (!canvas) return;
  const pointFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };
  canvas.addEventListener('contextmenu', e => {
    if (!pmTransform && !pmWarp) return;
    e.preventDefault();
    pmShowTfMenu(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2) return; // the contextmenu handler above owns the right button
    pmHideTfMenu();
    const p = pointFromEvent(e);
    if (peTool === 'dropper') { e.preventDefault(); pmPickColorAt(p.x, p.y); return; }
    if (!pmTransform && !pmWarp) return;
    const hitRadius = 11 * p.scale;
    let best = null, bestDist = Infinity;
    for (const h of pmHandlePoints()) {
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d < hitRadius && d < bestDist) { best = h; bestDist = d; }
    }
    if (!best) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    pmHandleDrag = {
      handle: best,
      start: p,
      quad: pmTransform ? pmTransform.quad.map(q => ({ ...q })) : null,
      grid: pmWarp ? pmWarp.grid.map(q => ({ ...q })) : null
    };
  });
  canvas.addEventListener('pointermove', e => {
    if (!pmHandleDrag) return;
    const p = pointFromEvent(e);
    // Alt suspends snapping, for the times you want a handle just off a guide.
    pmDragHandleTo(e.altKey ? (pmSnapGuides = [], p) : pmSnapPoint(p), e.shiftKey);
    peCompositeLayers();
    pmDrawHandles();
  });
  const end = e => {
    if (!pmHandleDrag) return;
    pmHandleDrag = null;
    pmSnapGuides = [];
    peDirty = true;
    pmDrawHandles();
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// ── Snapping ────────────────────────────────────────────────────────────────
// A dragged handle pulls onto the document's centre lines and edges when it comes close, so
// centring or flushing a layer is something you land on rather than something you nudge at.
// The guide only draws while it's actually snapped, which is what makes it a suggestion rather
// than noise. Alt suspends it.
const PM_SNAP_PX = 14; // in screen pixels, converted to image pixels per drag so zoom doesn't change the feel
let pmSnapGuides = [];
function pmSnapTargets() {
  const r = peDocRect();
  return {
    x: [{ at: 0, kind: 'edge' }, { at: r.w / 2, kind: 'centre' }, { at: r.w, kind: 'edge' }],
    y: [{ at: 0, kind: 'edge' }, { at: r.h / 2, kind: 'centre' }, { at: r.h, kind: 'edge' }]
  };
}
function pmSnapPoint(p) {
  pmSnapGuides = [];
  if (!peSourceCanvas) return p;
  const tol = PM_SNAP_PX * (p.scale || 1);
  const t = pmSnapTargets();
  const out = { x: p.x, y: p.y, scale: p.scale };
  let bestX = null, bestY = null;
  for (const c of t.x) { const d = Math.abs(p.x - c.at); if (d <= tol && (!bestX || d < bestX.d)) bestX = { ...c, d }; }
  for (const c of t.y) { const d = Math.abs(p.y - c.at); if (d <= tol && (!bestY || d < bestY.d)) bestY = { ...c, d }; }
  if (bestX) { out.x = bestX.at; pmSnapGuides.push({ axis: 'x', at: bestX.at, kind: bestX.kind }); }
  if (bestY) { out.y = bestY.at; pmSnapGuides.push({ axis: 'y', at: bestY.at, kind: bestY.kind }); }
  return out;
}

// One place works out what moving a given handle means, so the drag listener above stays a
// plain "where is the pointer" loop.
function pmDragHandleTo(p, shift) {
  const { handle, start, quad, grid } = pmHandleDrag;
  if (pmTransform) pmTransform.touched = true;
  if (pmWarp) pmWarp.touched = true;
  const dx = p.x - start.x, dy = p.y - start.y;
  if (pmWarp && handle.kind === 'grid') {
    pmWarp.grid[handle.i] = { x: grid[handle.i].x + dx, y: grid[handle.i].y + dy };
    return;
  }
  if (!pmTransform) return;
  const q = pmTransform.quad;
  const centre = { x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4, y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4 };
  // Shift flips the lock: locked modes scale freely while it's held, free modes lock. That way
  // the override is always available without leaving the mode you chose.
  const locked = pmTfMode === 'scale' ? !shift : pmTfMode === 'free' ? shift : false;

  if (handle.kind === 'corner') {
    const i = handle.i, opp = (i + 2) % 4, prev = (i + 3) % 4, next = (i + 1) % 4;
    if (pmTfMode === 'distort') { q[i] = { x: quad[i].x + dx, y: quad[i].y + dy }; return; }
    if (pmTfMode === 'perspective') {
      // The dragged corner and the one sharing its short edge move opposite ways, which is the
      // gesture that reads as a plane tilting away from the viewer.
      q[i] = { x: quad[i].x + dx, y: quad[i].y + dy };
      q[prev] = { x: quad[prev].x - dx, y: quad[prev].y - dy };
      return;
    }
    // Scale modes work in the quad's own axes, so a layer that has already been rotated still
    // scales along its own edges rather than along the screen.
    const ax = { x: quad[next].x - quad[i].x, y: quad[next].y - quad[i].y };
    const ay = { x: quad[prev].x - quad[i].x, y: quad[prev].y - quad[i].y };
    const lx = Math.hypot(ax.x, ax.y) || 1, ly = Math.hypot(ay.x, ay.y) || 1;
    const ux = { x: ax.x / lx, y: ax.y / lx }, uy = { x: ay.x / ly, y: ay.y / ly };
    // How far the pointer travelled along each of those axes, as a fraction of that side.
    let fx = 1 - (dx * ux.x + dy * ux.y) / lx;
    let fy = 1 - (dx * uy.x + dy * uy.y) / ly;
    if (locked) { const f = (fx + fy) / 2; fx = f; fy = f; }
    fx = Math.max(0.02, fx); fy = Math.max(0.02, fy);
    // Anchored on the opposite corner: that stays put and the other three follow.
    const o = quad[opp];
    const bx = { x: -ux.x * lx * fx, y: -ux.y * lx * fx };   // opp -> prev edge, rescaled
    const by = { x: -uy.x * ly * fy, y: -uy.y * ly * fy };   // opp -> next edge, rescaled
    q[opp] = { x: o.x, y: o.y };
    q[prev] = { x: o.x + bx.x, y: o.y + bx.y };
    q[next] = { x: o.x + by.x, y: o.y + by.y };
    q[i] = { x: o.x + bx.x + by.x, y: o.y + bx.y + by.y };
    return;
  }
  if (handle.kind === 'edge') {
    const a = handle.i, b = (handle.i + 1) % 4;
    if (pmTfMode === 'skew') {
      // Skew slides the edge along its own direction, leaving its length and the opposite edge
      // alone - the parallelogram gesture.
      const ex = quad[b].x - quad[a].x, ey = quad[b].y - quad[a].y;
      const len = Math.hypot(ex, ey) || 1;
      const along = (dx * ex + dy * ey) / len / len;
      q[a] = { x: quad[a].x + ex * along, y: quad[a].y + ey * along };
      q[b] = { x: quad[b].x + ex * along, y: quad[b].y + ey * along };
      return;
    }
    // Otherwise the edge stretches its own side: project the drag onto the edge's normal so it
    // only moves outward/inward, keeping the box square in scale modes.
    const ex = quad[b].x - quad[a].x, ey = quad[b].y - quad[a].y;
    const len = Math.hypot(ex, ey) || 1;
    const nx = -ey / len, ny = ex / len;
    const push = pmTfMode === 'distort' ? null : (dx * nx + dy * ny);
    const mx = push === null ? dx : nx * push, my = push === null ? dy : ny * push;
    q[a] = { x: quad[a].x + mx, y: quad[a].y + my };
    q[b] = { x: quad[b].x + mx, y: quad[b].y + my };
    return;
  }
  if (handle.kind === 'rotate') {
    const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
    const a1 = Math.atan2(p.y - centre.y, p.x - centre.x);
    let da = a1 - a0;
    if (shift) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12); // 15° steps
    const cos = Math.cos(da), sin = Math.sin(da);
    for (let i = 0; i < 4; i++) {
      const vx = quad[i].x - centre.x, vy = quad[i].y - centre.y;
      q[i] = { x: centre.x + vx * cos - vy * sin, y: centre.y + vx * sin + vy * cos };
    }
  }
}

// ── In-place text editing ───────────────────────────────────────────────────
// Double-clicking a text layer on the canvas types into the picture, not into a box on the far
// side of the window. The overlay is a real textarea sitting exactly where the text sits, at
// the text's own size, colour and font, so what you type is what you see - and the layer is
// re-rasterised live as you go.
let pmTextEditId = null;
function pmTextLayerAt(x, y) {
  for (let i = (peLayers || []).length - 1; i >= 0; i--) {
    const l = peLayers[i];
    if (!l.text || !l.visible || !l._bitmap) continue;
    const { w, h } = peLayerSize(l);
    if (x >= l.x && x <= l.x + w && y >= l.y && y <= l.y + h) return l;
  }
  return null;
}
function pmOpenTextEditor(layer) {
  const box = document.getElementById('peTextEditor');
  const stage = document.querySelector('.pe-stage');
  const canvas = document.getElementById('peLayersCanvas');
  if (!box || !stage || !canvas || !layer?.text) return;
  pmTextEditId = layer.id;
  peActiveLayerId = layer.id;
  const rect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const s = rect.width / canvas.width; // image pixels -> screen pixels at the current zoom
  const { w, h } = peLayerSize(layer);
  box.style.left = (rect.left - stageRect.left + layer.x * s) + 'px';
  box.style.top = (rect.top - stageRect.top + layer.y * s) + 'px';
  box.style.width = Math.max(40, w * s) + 'px';
  box.style.height = Math.max(24, h * s) + 'px';
  box.style.boxSizing = 'border-box';
  box.style.padding = (pmTextPad(layer.text) * s * (layer.scale || 100) / 100) + 'px';
  box.style.fontFamily = layer.text.font;
  box.style.fontSize = (peTextPixelSize(layer.text) * s * (layer.scale || 100) / 100) + 'px';
  box.style.fontWeight = layer.text.bold ? '700' : '400';
  box.style.fontStyle = layer.text.italic ? 'italic' : 'normal';
  box.style.color = layer.text.color;
  box.style.transform = layer.rotation ? `rotate(${layer.rotation}deg)` : '';
  box.value = layer.text.content;
  box.classList.add('open');
  box.focus();
  box.select();
  peRenderLayersPanel();
}
function pmTextEditorInput() {
  const box = document.getElementById('peTextEditor');
  const layer = (peLayers || []).find(l => l.id === pmTextEditId);
  if (!layer) return;
  peActiveLayerId = layer.id;
  peUpdateTextLayer('content', box.value);
  // Re-rasterising recentres the layer, so the box has to follow it or the two drift apart as
  // the line grows.
  pmPositionTextEditor(layer);
}
// The padding peRasterizeText leaves around the glyphs, mirrored so the overlay lines up.
function pmTextPad(spec) {
  return Math.round(peTextPixelSize(spec) * 0.25) + Math.ceil(spec.strokeWidth || 0);
}
function pmPositionTextEditor(layer) {
  const box = document.getElementById('peTextEditor');
  const stage = document.querySelector('.pe-stage');
  const canvas = document.getElementById('peLayersCanvas');
  if (!box || !stage || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const s = rect.width / canvas.width;
  const { w, h } = peLayerSize(layer);
  box.style.left = (rect.left - stageRect.left + layer.x * s) + 'px';
  box.style.top = (rect.top - stageRect.top + layer.y * s) + 'px';
  box.style.width = Math.max(40, w * s) + 'px';
  box.style.height = Math.max(24, h * s) + 'px';
}
function pmCloseTextEditor(commit) {
  const box = document.getElementById('peTextEditor');
  if (!box || !pmTextEditId) return;
  const layer = (peLayers || []).find(l => l.id === pmTextEditId);
  pmTextEditId = null;
  box.classList.remove('open');
  box.blur();
  if (layer && commit) { peActiveLayerId = layer.id; peUpdateTextLayer('content', box.value, true); }
  peRenderPanel();
}
function setupPhotoModTextEditor() {
  const box = document.getElementById('peTextEditor');
  const layersCanvas = document.getElementById('peLayersCanvas');
  if (!box || !layersCanvas) return;
  layersCanvas.addEventListener('dblclick', e => {
    if (!peIsPro() || peTool !== 'move') return;
    const rect = layersCanvas.getBoundingClientRect();
    const s = rect.width ? layersCanvas.width / rect.width : 1;
    const layer = pmTextLayerAt((e.clientX - rect.left) * s, (e.clientY - rect.top) * s);
    if (!layer) return;
    e.preventDefault();
    pmOpenTextEditor(layer);
  });
  box.addEventListener('input', pmTextEditorInput);
  box.addEventListener('blur', () => pmCloseTextEditor(true));
  box.addEventListener('keydown', e => {
    e.stopPropagation(); // the editor's own shortcuts must not fire while typing into the picture
    if (e.key === 'Escape') { e.preventDefault(); pmCloseTextEditor(true); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pmCloseTextEditor(true); }
  });
}

// Right-clicking the transform is how you change what dragging a handle means - the modes are
// a property of the gesture, so they belong on the thing you're dragging, not in a far-off
// toolbar. Mirrors the Tool Options list, which stays in sync because both read PM_TF_MODES.
function pmShowTfMenu(clientX, clientY) {
  const menu = document.getElementById('pmTfMenu');
  if (!menu) return;
  const live = peTool === 'transform' || peTool === 'warp';
  menu.innerHTML = PM_TF_MODES.map(([key, icon, label, hint]) => `
    <div class="ctx-item${peTool === 'transform' && pmTfMode === key ? ' active' : ''}" title="${esc(hint)}" onclick="pmSetTfMode('${key}')">
      <span class="ctx-icon">${icon}</span> ${label}
    </div>`).join('')
    + `<div class="ctx-sep"></div>
    <div class="ctx-item${peTool === 'warp' ? ' active' : ''}" title="Push a mesh around to bend the layer" onclick="pmSetTfMode('warp')"><span class="ctx-icon">${peIcon('warp')}</span> Warp</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="pmHideTfMenu();pmResetLiveMesh()"><span class="ctx-icon">${peIcon('reset')}</span> Reset shape</div>
    <div class="ctx-item" onclick="pmHideTfMenu();pmApplyLiveMesh()"><span class="ctx-icon">${peIcon('check')}</span> Apply</div>
    <div class="ctx-item danger" onclick="pmHideTfMenu();pmCancelLiveMesh()"><span class="ctx-icon">${peIcon('close')}</span> Cancel</div>`;
  if (!live) return;
  menu.classList.add('open');
  // Flipped back inside the window when the click lands near an edge.
  menu.style.left = '0px'; menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(clientX, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(clientY, window.innerHeight - r.height - 8) + 'px';
}
function pmHideTfMenu() { document.getElementById('pmTfMenu')?.classList.remove('open'); }

// Eyedropper: reads the flattened composite, so it picks the colour actually on screen rather
// than whatever happens to be on the active layer.
function pmPickColorAt(x, y) {
  const canvas = peCompositeCanvas();
  if (!canvas) return;
  const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
  let data;
  try { data = canvas.getContext('2d').getImageData(px, py, 1, 1).data; } catch (e) { return; }
  const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  peSetDrawColor(hex);
  peRenderPanel();
  toast(`💧 Picked ${hex}`);
}

// ── Selection commands (the Select menu) ────────────────────────────────────
function pmSelectAll() {
  const r = peDocRect();
  if (!r.w) return;
  peSetSelection({ type: 'rect', invert: false, points: [{ x: 0, y: 0 }, { x: r.w, y: 0 }, { x: r.w, y: r.h }, { x: 0, y: r.h }], bounds: r });
}
function pmInvertSelection() {
  if (!peSelection) { pmSelectAll(); return; }
  peSelection.invert = !peSelection.invert;
  peSelection.bounds = peSelectionEffectiveBounds(peSelection);
  peDrawSelectionOverlay();
  peRenderPanel();
  toast(peSelection.invert ? '⇄ Selection inverted' : '⇄ Selection back to normal');
}
// Fills the selection on the active layer, or makes a new layer when the photo is the target -
// the photo itself is never painted into, the same rule the cut/erase verbs follow.
function pmFillSelection(color) {
  if (!peSelection || !peSourceCanvas || !peLayers) return;
  const fill = color || peDrawColor || '#ffffff';
  const b = peSelection.bounds;
  const patch = document.createElement('canvas');
  patch.width = Math.max(1, Math.round(b.w));
  patch.height = Math.max(1, Math.round(b.h));
  const pctx = patch.getContext('2d');
  pctx.fillStyle = fill;
  pctx.fillRect(0, 0, patch.width, patch.height);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(peSelectionMaskCanvas(b.w, b.h, b.x, b.y), 0, 0);
  const layer = pmActiveLayer();
  if (layer?._bitmap) {
    const inSpace = peLayerInImageSpace(layer);
    inSpace.getContext('2d').drawImage(patch, b.x, b.y);
    layer._bitmap = inSpace;
    layer.dataUrl = inSpace.toDataURL('image/png');
    layer.x = 0; layer.y = 0; layer.scale = 100; layer.rotation = 0;
  } else {
    if (peLayers.length >= PE_LAYER_LIMIT) { toast(`⚠️ ${PE_LAYER_LIMIT} layers is the limit for now`); return; }
    const nl = peDefaultLayer();
    nl.name = 'Fill';
    nl._bitmap = patch;
    nl.dataUrl = patch.toDataURL('image/png');
    nl.x = Math.round(b.x); nl.y = Math.round(b.y);
    peLayers.push(nl);
    peActiveLayerId = nl.id;
  }
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('fill selection');
  peDirty = true;
  toast('🪣 Filled the selection');
}

// ── Document commands (the Image menu) ──────────────────────────────────────
// Everything here rewrites the document's own pixels via peBaseOverride, then re-runs the
// normal init path so GL, the draw layer, the masks and the layer stack all come back sized to
// the new document. The library file is never touched - PhotoMod only writes when you Save.
let pmCanvasAnchor = 'mc';   // 9-way anchor key, r/c coded: t|m|b + l|c|r
// A document always starts on a real background rather than transparency: a transparent
// canvas looks identical to a white one on screen but exports as a see-through PNG, which is
// a surprise nobody asked for. Layers can still be erased back to transparency.
let pmNewBg = '#ffffff';
let pmCanvasBg = '#ffffff';
const PM_ANCHORS = ['tl','tc','tr','ml','mc','mr','bl','bc','br'];

function pmDocBase() {
  return peBaseOverride || peSourceCanvas;
}
// Snapshots the current document base so later size operations compose rather than each one
// re-deriving from the untouched original photo.
function pmEnsureBaseOverride() {
  // Always re-derived from peSourceCanvas rather than kept as a running original: that canvas
  // is the frame the layers, masks and paint layer are all positioned in, and peInitGL may
  // have downscaled it for the GPU - so it, not the file on disk, is what "the document" means
  // here. Adjustments stay non-destructive either way; they live in the shader, not the pixels.
  peBaseOverride = peCopyCanvas(peSourceCanvas);
  return peBaseOverride;
}
function pmAnchorOffset(anchor, oldW, oldH, newW, newH) {
  const v = anchor[0], h = anchor[1];
  const dx = h === 'l' ? 0 : h === 'r' ? newW - oldW : Math.round((newW - oldW) / 2);
  const dy = v === 't' ? 0 : v === 'b' ? newH - oldH : Math.round((newH - oldH) / 2);
  return { dx, dy };
}
// Resizes one overlay bitmap into the new document frame - used for the paint layer and each
// mask, which are plain full-document canvases.
function pmReframeCanvas(src, newW, newH, dx, dy) {
  const c = document.createElement('canvas');
  c.width = newW; c.height = newH;
  if (src) c.getContext('2d').drawImage(src, dx, dy);
  return c;
}

async function pmApplyCanvasSize() {
  const newW = Math.max(1, Math.min(12000, parseInt(document.getElementById('pmCanvasW').value, 10) || 0));
  const newH = Math.max(1, Math.min(12000, parseInt(document.getElementById('pmCanvasH').value, 10) || 0));
  if (!newW || !newH || !peSourceCanvas) return;
  pmCommitLiveMesh();
  const base = pmEnsureBaseOverride();
  const { dx, dy } = pmAnchorOffset(pmCanvasAnchor, base.width, base.height, newW, newH);
  const next = document.createElement('canvas');
  next.width = newW; next.height = newH;
  const ctx = next.getContext('2d');
  ctx.fillStyle = pmCanvasBg || '#ffffff';
  ctx.fillRect(0, 0, newW, newH);
  ctx.drawImage(base, dx, dy);
  peBaseOverride = next;
  // Carry everything that lives in document space across by the same offset.
  const drawUrl = peDrawHasContent && peDrawCanvas ? pmReframeCanvas(peDrawCanvas, newW, newH, dx, dy).toDataURL('image/png') : null;
  pmCommitActiveMaskForResize();
  const masks = (peLocalLayers || []).map(l => Object.assign({}, l, {
    maskDataUrl: l._maskCanvas ? pmReframeCanvas(l._maskCanvas, newW, newH, dx, dy).toDataURL('image/png') : l.maskDataUrl,
    _maskCanvas: null
  }));
  (peLayers || []).forEach(l => { l.x += dx; l.y += dy; });
  pmCloseModal('pmCanvasSizeModal');
  await pmRebuildDocument({ drawUrl, masks });
  peDirty = true;
  toast(`🖼 Canvas is now ${newW} × ${newH}`);
}

async function pmApplyImageSize() {
  const newW = Math.max(1, Math.min(12000, parseInt(document.getElementById('pmImageW').value, 10) || 0));
  const newH = Math.max(1, Math.min(12000, parseInt(document.getElementById('pmImageH').value, 10) || 0));
  if (!newW || !newH || !peSourceCanvas) return;
  pmCommitLiveMesh();
  const base = pmEnsureBaseOverride();
  const sx = newW / base.width, sy = newH / base.height;
  const scaled = src => {
    const c = document.createElement('canvas');
    c.width = newW; c.height = newH;
    if (src) c.getContext('2d').drawImage(src, 0, 0, newW, newH);
    return c;
  };
  peBaseOverride = scaled(base);
  const drawUrl = peDrawHasContent && peDrawCanvas ? scaled(peDrawCanvas).toDataURL('image/png') : null;
  pmCommitActiveMaskForResize();
  const masks = (peLocalLayers || []).map(l => Object.assign({}, l, {
    maskDataUrl: l._maskCanvas ? scaled(l._maskCanvas).toDataURL('image/png') : l.maskDataUrl,
    _maskCanvas: null
  }));
  // Layer positions scale with the document; their own scale% absorbs the size change so the
  // stored bitmap is left alone and nothing is resampled twice.
  (peLayers || []).forEach(l => {
    l.x *= sx; l.y *= sy;
    l.scale = (l.scale || 100) * ((sx + sy) / 2);
  });
  pmCloseModal('pmImageSizeModal');
  await pmRebuildDocument({ drawUrl, masks });
  peDirty = true;
  toast(`↔ Image is now ${newW} × ${newH}`);
}

// The active mask lives in #peMaskCanvas until it's committed back to its layer - a resize has
// to fold it in first or the in-progress paint is silently lost.
function pmCommitActiveMaskForResize() {
  if (!peEditingLayerId || !peMaskCanvas) return;
  const active = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
  if (!active) return;
  if (peMaskCanvasHasContent) {
    active._maskCanvas = peCopyCanvas(peMaskCanvas);
    active.maskDataUrl = peMaskCanvas.toDataURL('image/png');
  }
}

// Re-runs the same init path openPhotoEditor uses, against the new base. Takes the already
// re-framed paint layer and masks because peApplyRotationAndInit would otherwise reload the
// originals from file.edits at the old size.
async function pmRebuildDocument({ drawUrl, masks }) {
  const layers = peLayers;
  peInitGL(peBaseOverride);
  peInitDrawLayer(peSourceCanvas.width, peSourceCanvas.height, drawUrl);
  peInitMaskLayers(peSourceCanvas.width, peSourceCanvas.height, masks);
  peInitLayers(layers);
  peComputeHistogram(peSourceCanvas);
  peZoomFit();
  peRender();
  peRenderPanel();
}

async function pmCreateNewDocument() {
  const w = Math.max(1, Math.min(12000, parseInt(document.getElementById('pmNewW').value, 10) || 0));
  const h = Math.max(1, Math.min(12000, parseInt(document.getElementById('pmNewH').value, 10) || 0));
  if (!w || !h) return;
  pmCloseModal('pmNewDocModal');
  closePhotoModPicker();
  if (peOpen) { const answer = await peConfirmDiscard(); if (!answer) return; await closePhotoEditor(true, answer === 'save'); }
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const bctx = base.getContext('2d');
  bctx.fillStyle = pmNewBg || '#ffffff';
  bctx.fillRect(0, 0, w, h);
  await pmOpenDocument(base, `Untitled ${w}×${h}`);
}

// Opens the editor on a canvas that has no library file behind it. Everything downstream
// already tolerates a null peFileId (the lookups use optional chaining); Save routes through
// the export dialog instead of linking to an original.
async function pmOpenDocument(baseCanvas, name) {
  peOpen = true;
  peMode = 'pro';
  peFileId = null;
  pmDocName = name;
  peDirty = false;
  peBypass = false;
  peAdjustments = peDefaultAdjustments();
  peCurves = peDefaultCurves();
  peHsl = peCloneHsl(null);
  peStraighten = 0;
  peActiveTab = 'colors';
  peActiveHslBand = 'red';
  peLayers = null;
  peActiveLayerId = null;
  peTool = 'move';
  peBaseOverride = baseCanvas;
  peRawCanvas = baseCanvas;
  document.getElementById('peFileName').textContent = name;
  document.getElementById('photoEditor').classList.add('open');
  peSyncModeChrome();
  peRenderPanel();
  peRenderToolRail();
  peRenderLayersPanel();
  document.getElementById('peLoading').style.display = 'none';
  document.getElementById('peCanvas').style.display = '';
  await peApplyRotationAndInit();
}

// ── Menu bar ────────────────────────────────────────────────────────────────
// Declared as data so the keyboard shortcuts, the enabled/disabled rules and the labels can't
// drift apart from what the menus actually do. `on` runs the command; `enabled` (optional)
// decides whether it's clickable right now.
function pmMenuModel() {
  const layer = pmActiveLayer();
  const live = !!(pmTransform || pmWarp);
  const hasSel = !!peSelection;
  return [
    ['File', [
      { label: 'New canvas…', key: 'Ctrl+N', on: 'pmOpenNewDocModal()' },
      { label: 'Open photo…', key: 'Ctrl+O', on: "pmOpenPicker('open')" },
      { label: 'Add photo & place…', key: 'Ctrl+Shift+P', on: 'pmAddPhotoAndPlace()' },
      { sep: true },
      { label: 'Save to library', key: 'Ctrl+S', on: 'peSaveToLibrary()' },
      { label: 'Export…', key: 'Ctrl+E', on: 'peExport()' },
      { sep: true },
      { label: 'Close', key: 'Esc', on: 'closePhotoEditor()' }
    ]],
    ['Edit', [
      { label: 'Undo', key: 'Ctrl+Z', on: 'peUndoForCurrentTool()' },
      { label: 'Redo', key: 'Ctrl+Shift+Z', on: 'peRedoLayers()' },
      { sep: true },
      { label: 'Transform', key: 'Ctrl+T', on: "peSelectTool('transform')", enabled: !!layer },
      { label: 'Warp', key: 'W', on: "peSelectTool('warp')", enabled: !!layer },
      { label: 'Apply', key: 'Enter', on: 'pmApplyLiveMesh()', enabled: live },
      { label: 'Reset shape', on: 'pmResetLiveMesh()', enabled: live },
      { label: 'Cancel', key: 'Esc', on: 'pmCancelLiveMesh()', enabled: live },
      { sep: true },
      { label: 'Fill selection', on: 'pmFillSelection()', enabled: hasSel }
    ]],
    ['Image', [
      { label: 'Canvas size…', on: 'pmOpenCanvasSizeModal()' },
      { label: 'Image size…', on: 'pmOpenImageSizeModal()' },
      { sep: true },
      { label: 'Rotate left 90°', on: 'pmRotateDocument(-90)' },
      { label: 'Rotate right 90°', on: 'pmRotateDocument(90)' },
      { label: 'Flip horizontal', on: "pmFlipDocument('h')" },
      { label: 'Flip vertical', on: "pmFlipDocument('v')" },
      { sep: true },
      { label: 'Adjustments…', on: 'pmToggleAdjustPanel()' },
      { label: 'Reset everything', on: 'peResetAll()' }
    ]],
    ['Layer', [
      { label: 'New text layer', key: 'T', on: "peSelectTool('text')" },
      { label: 'Duplicate layer', key: 'Ctrl+J', on: 'pmDuplicateLayer()', enabled: !!layer },
      { label: 'Delete layer', key: 'Del', on: `peDeleteLayer('${layer?.id || ''}')`, enabled: !!layer },
      { sep: true },
      { label: 'Bring forward', on: `peMoveLayerOrder('${layer?.id || ''}', 1)`, enabled: !!layer },
      { label: 'Send backward', on: `peMoveLayerOrder('${layer?.id || ''}', -1)`, enabled: !!layer },
      { sep: true },
      { label: 'Flatten into one layer', on: 'pmFlattenLayers()', enabled: (peLayers || []).length > 1 }
    ]],
    ['Select', [
      { label: 'All', key: 'Ctrl+A', on: 'pmSelectAll()' },
      { label: 'Deselect', key: 'Ctrl+D', on: 'peClearSelection()', enabled: hasSel },
      { label: 'Inverse', key: 'Ctrl+Shift+I', on: 'pmInvertSelection()', enabled: hasSel },
      { sep: true },
      { label: 'Copy to new layer', key: 'Ctrl+J', on: 'peSelectionToNewLayer(false)', enabled: hasSel },
      { label: 'Cut to new layer', key: 'Ctrl+X', on: 'peSelectionToNewLayer(true)', enabled: hasSel },
      { label: 'Erase selection', key: 'Del', on: 'peDeleteSelection()', enabled: hasSel }
    ]]
  ];
}
let pmOpenMenu = null;
function pmRenderMenubar() {
  const bar = document.getElementById('pmMenubar');
  if (!bar) return;
  if (!peIsPro()) { bar.innerHTML = ''; return; }
  bar.innerHTML = pmMenuModel().map(([name, items]) => `
    <div class="pm-menu${pmOpenMenu === name ? ' open' : ''}" data-menu="${name}">
      <button class="pm-menu-btn" onclick="pmToggleMenu('${name}')">${name}</button>
      <div class="pm-menu-drop">
        ${items.map(it => it.sep ? '<div class="pm-menu-sep"></div>' : `
          <button class="pm-menu-item" ${it.enabled === false ? 'disabled' : ''}
                  onclick="pmRunMenu(event, function(){ ${it.on} })">
            <span>${esc(it.label)}</span>${it.key ? `<span class="pm-menu-key">${esc(it.key)}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>`).join('');
}
function pmToggleMenu(name) {
  pmOpenMenu = pmOpenMenu === name ? null : name;
  pmRenderMenubar();
}
function pmCloseMenus() {
  if (!pmOpenMenu) return;
  pmOpenMenu = null;
  pmRenderMenubar();
}
// Menus close before the command runs, so a command that repaints the bar (most of them do,
// via peRenderPanel) can't leave a stale dropdown hanging open over its own result.
function pmRunMenu(event, fn) {
  event.stopPropagation();
  pmCloseMenus();
  try { fn(); } catch (e) { console.error(e); }
}

// ── Layer verbs the menu adds ───────────────────────────────────────────────
function pmDuplicateLayer() {
  const layer = pmActiveLayer();
  if (!layer || !peLayers) return;
  if (peLayers.length >= PE_LAYER_LIMIT) { toast(`⚠️ ${PE_LAYER_LIMIT} layers is the limit for now`); return; }
  const copy = Object.assign({}, layer, {
    id: peNewLayerIdent(), name: layer.name + ' copy',
    x: layer.x + 12, y: layer.y + 12,
    text: layer.text ? Object.assign({}, layer.text) : null
  });
  peLayers.splice(peLayers.indexOf(layer) + 1, 0, copy);
  peActiveLayerId = copy.id;
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('duplicate layer');
  peDirty = true;
}
// Flattens the layer stack into one bitmap. The photo underneath stays where it is - the base
// is still the base, so adjustments keep working on it after the merge.
function pmFlattenLayers() {
  if (!peLayers || peLayers.length < 2 || !peSourceCanvas) return;
  pmCommitLiveMesh();
  // Copied straight off the live overlay rather than re-drawn here: that canvas already holds
  // exactly this stack with its clipping groups, per-layer colours and blend modes resolved,
  // and a second implementation of the same compositing is a second thing to keep in step.
  const blended = peLayersNeedBase();
  peCompositeLayers(true);
  const out = peCopyCanvas(peLayersCanvas, peSourceCanvas.width, peSourceCanvas.height);
  const merged = peDefaultLayer();
  merged.name = 'Flattened';
  merged._bitmap = out;
  merged.dataUrl = out.toDataURL('image/png');
  peLayers = [merged];
  peActiveLayerId = merged.id;
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('flatten');
  peDirty = true;
  toast(blended
    ? '🧱 Layers flattened into one - blend modes that mixed with the photo are now baked against transparency'
    : '🧱 Layers flattened into one', blended ? 6000 : undefined);
}

// ── Document rotate / flip ──────────────────────────────────────────────────
// Unlike the simple editor's Rotate, which bumps file.rotation on the library entry, these
// turn the document's own pixels - PhotoMod does not write to the library.
async function pmRotateDocument(delta) {
  if (!peSourceCanvas) return;
  pmCommitLiveMesh();
  const base = pmEnsureBaseOverride();
  peBaseOverride = drawRotatedToCanvas(base, delta);
  const drawUrl = peDrawHasContent && peDrawCanvas ? drawRotatedToCanvas(peDrawCanvas, delta).toDataURL('image/png') : null;
  pmCommitActiveMaskForResize();
  const masks = (peLocalLayers || []).map(l => Object.assign({}, l, {
    maskDataUrl: l._maskCanvas ? drawRotatedToCanvas(l._maskCanvas, delta).toDataURL('image/png') : l.maskDataUrl,
    _maskCanvas: null
  }));
  peLayers = await peRotateLayers(delta);
  await pmRebuildDocument({ drawUrl, masks });
  peDirty = true;
  toast(`↻ Rotated to ${peSourceCanvas.width} × ${peSourceCanvas.height}`);
}
async function pmFlipDocument(axis) {
  if (!peSourceCanvas) return;
  pmCommitLiveMesh();
  const base = pmEnsureBaseOverride();
  const flip = src => {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.translate(axis === 'h' ? c.width : 0, axis === 'v' ? c.height : 0);
    ctx.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1);
    ctx.drawImage(src, 0, 0);
    return c;
  };
  peBaseOverride = flip(base);
  const drawUrl = peDrawHasContent && peDrawCanvas ? flip(peDrawCanvas).toDataURL('image/png') : null;
  pmCommitActiveMaskForResize();
  const masks = (peLocalLayers || []).map(l => Object.assign({}, l, {
    maskDataUrl: l._maskCanvas ? flip(l._maskCanvas).toDataURL('image/png') : l.maskDataUrl,
    _maskCanvas: null
  }));
  // Layers flip as bitmaps too, and their origin mirrors across the document.
  for (const l of (peLayers || [])) {
    if (!l._bitmap) continue;
    const { w, h } = peLayerSize(l);
    l._bitmap = flip(peCopyCanvas(l._bitmap));
    l.dataUrl = l._bitmap.toDataURL('image/png');
    if (axis === 'h') l.x = peSourceCanvas.width - (l.x + w); else l.y = peSourceCanvas.height - (l.y + h);
    if (l.rotation) l.rotation = -l.rotation;
  }
  await pmRebuildDocument({ drawUrl, masks });
  peDirty = true;
  toast(axis === 'h' ? '⇋ Flipped horizontally' : '⇵ Flipped vertically');
}

// ── Dialogs ─────────────────────────────────────────────────────────────────
function pmCloseModal(id) { document.getElementById(id).classList.remove('open'); }
const PM_NEW_PRESETS = [
  ['1920 × 1080', 1920, 1080], ['1080 × 1080', 1080, 1080], ['1080 × 1350', 1080, 1350],
  ['1200 × 630', 1200, 630], ['2480 × 3508', 2480, 3508], ['3840 × 2160', 3840, 2160]
];
function pmOpenNewDocModal() {
  document.getElementById('pmNewPresets').innerHTML = PM_NEW_PRESETS.map(([label, w, h]) =>
    `<button class="pe-draw-action-btn" onclick="pmApplyNewPreset(${w},${h})">${label}</button>`).join('');
  pmSetNewBg(pmNewBg);
  document.getElementById('pmNewDocModal').classList.add('open');
}
function pmApplyNewPreset(w, h) {
  document.getElementById('pmNewW').value = w;
  document.getElementById('pmNewH').value = h;
}
function pmSetNewBg(bg) {
  pmNewBg = bg;
  document.querySelectorAll('#pmNewBgRow [data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
}
function pmSetCanvasBg(bg) {
  pmCanvasBg = bg;
  document.querySelectorAll('#pmCanvasBgRow [data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
}
function pmRenderAnchorGrid() {
  document.getElementById('pmAnchorGrid').innerHTML = PM_ANCHORS.map(a =>
    `<button class="pm-anchor-cell${a === pmCanvasAnchor ? ' active' : ''}" title="Anchor ${a}" onclick="pmSetAnchor('${a}')">${a === pmCanvasAnchor ? '◼' : '·'}</button>`).join('');
}
function pmSetAnchor(a) { pmCanvasAnchor = a; pmRenderAnchorGrid(); }
function pmOpenCanvasSizeModal() {
  if (!peSourceCanvas) return;
  document.getElementById('pmCanvasW').value = peSourceCanvas.width;
  document.getElementById('pmCanvasH').value = peSourceCanvas.height;
  pmRenderAnchorGrid();
  pmSetCanvasBg(pmCanvasBg);
  document.getElementById('pmCanvasSizeModal').classList.add('open');
}
let pmImageAspect = 1;
function pmOpenImageSizeModal() {
  if (!peSourceCanvas) return;
  pmImageAspect = peSourceCanvas.width / peSourceCanvas.height;
  document.getElementById('pmImageW').value = peSourceCanvas.width;
  document.getElementById('pmImageH').value = peSourceCanvas.height;
  document.getElementById('pmImageSizeModal').classList.add('open');
}
function pmImageSizeLink(edited) {
  if (!document.getElementById('pmImageLock').checked) return;
  const wEl = document.getElementById('pmImageW'), hEl = document.getElementById('pmImageH');
  if (edited === 'w') hEl.value = Math.max(1, Math.round((parseInt(wEl.value, 10) || 1) / pmImageAspect));
  else wEl.value = Math.max(1, Math.round((parseInt(hEl.value, 10) || 1) * pmImageAspect));
}
function pmToggleAdjustPanel(force) {
  const panel = document.getElementById('pmAdjustPanel');
  const open = force === undefined ? !panel.classList.contains('open') : force;
  panel.classList.toggle('open', open);
  if (open) pmRenderAdjustPanel();
}

async function openPhotoEditor(fileId, mode) {
  const file = appData.files.find(f => f.id === fileId);
  if (!file || !isEditable(file.ext)) return;
  peOpen = true;
  peMode = mode === 'pro' ? 'pro' : 'simple';
  peFileId = fileId;
  peDirty = false;
  peRotationAtOpen = file.rotation || 0;
  peBypass = false;
  peAdjustments = Object.assign(peDefaultAdjustments(), file.edits?.adjustments || {});
  peCurves = file.edits?.curves ? peCloneCurves(file.edits.curves)
    : file.edits?.tone ? Object.assign(peDefaultCurves(), { master: peLegacyToneCurvePoints(file.edits.tone) })
    : peDefaultCurves();
  peActiveCurveChannel = 'master';
  peHsl = peCloneHsl(file.edits?.hsl);
  peStraighten = file.edits?.straighten || 0;
  peActiveTab = 'colors';
  peActiveHslBand = 'red';
  peLayers = null; // reloaded from file.edits by peInitLayers once the source size is known
  peActiveLayerId = null;
  peTool = peIsPro() ? 'move' : 'none'; // no layers in simple mode, so no Move tool to sit in by default
  document.getElementById('peFileName').textContent = file.name;
  document.getElementById('photoEditor').classList.add('open');
  peSyncModeChrome();
  peRenderPanel();
  peRenderToolRail();
  peRenderLayersPanel();
  const loading = document.getElementById('peLoading');
  const canvas = document.getElementById('peCanvas');
  loading.style.display = '';
  canvas.style.display = 'none';
  let result = null;
  try { result = await loadEditableImage(file); } catch (e) {}
  loading.style.display = 'none';
  if (!result || !result.base64) {
    toast('⚠️ Could not load this photo for editing');
    closePhotoEditor(true); // nothing was ever loaded, so there is nothing to prompt about
    return;
  }
  canvas.style.display = '';
  await peLoadImage(result);
}

function peLoadImage(result) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // Drawing through a 2D canvas (rather than feeding the <img> straight into
      // WebGL) bakes in Chromium's automatic EXIF-orientation correction, which
      // texImage2D does not reliably apply on its own.
      const off = document.createElement('canvas');
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      off.getContext('2d').drawImage(img, 0, 0);
      peRawCanvas = off; // cached so the Rotate buttons can re-derive a new 90° step without re-decoding from disk
      peApplyRotationAndInit();
      resolve();
    };
    img.onerror = () => { toast('⚠️ Could not decode this photo'); resolve(); };
    img.src = `data:${result.mime};base64,${result.base64}`;
  });
}

// (Re)builds the WebGL source from peRawCanvas + the current file.rotation - split out
// from peLoadImage so the 90° Rotate buttons can re-derive instantly from the already-
// decoded raw canvas instead of re-reading the file from disk on every click.
// rotationDelta (+90/-90), when given, means this call is a mid-session rotate rather
// than the initial load - any drawing made this session gets rotated along with the
// image instead of silently discarded, since peInitDrawLayer below otherwise resets
// the draw layer to only whatever was already persisted in file.edits. Same idea for
// local mask layers, except rotating all of them can require decoding stored PNGs, which
// is async - see peRotateLocalLayers - so this function is async too from that path on.
async function peApplyRotationAndInit(rotationDelta) {
  const file = appData.files.find(f => f.id === peFileId);
  const source = peBaseOverride ? peBaseOverride
    : file?.rotation ? drawRotatedToCanvas(peRawCanvas, file.rotation) : peRawCanvas;
  let drawLayerUrl = file?.edits?.drawLayer || null;
  if (rotationDelta && peDrawHasContent && peDrawCanvas) {
    drawLayerUrl = drawRotatedToCanvas(peDrawCanvas, rotationDelta).toDataURL('image/png');
  }
  // peLocalLayers === null means "not yet loaded this session" (see its declaration) - use
  // the persisted value only then. Otherwise prefer the in-memory array even when rotationDelta
  // is absent, e.g. peResetAll() calls this with no delta right after clearing peLocalLayers to
  // [] - falling back to file?.edits?.localLayers there would silently reload the old masks,
  // since peCommit() hasn't run yet to clear the stale persisted value.
  let localLayersSource = peLocalLayers === null ? (file?.edits?.localLayers || null) : peLocalLayers;
  if (rotationDelta) localLayersSource = await peRotateLocalLayers(rotationDelta);
  // Same "in-memory wins once loaded" rule as the masks above, and the same reason for
  // rotating before peInitGL: peRotateLayers needs the pre-rotation source dimensions.
  let layersSource = peLayers === null ? (file?.edits?.layers || null) : peLayers;
  if (rotationDelta) layersSource = await peRotateLayers(rotationDelta);
  peInitGL(source); // may replace peSourceCanvas with a downscaled copy if this GPU can't texture it at full size - see there
  peInitDrawLayer(peSourceCanvas.width, peSourceCanvas.height, drawLayerUrl);
  peInitMaskLayers(peSourceCanvas.width, peSourceCanvas.height, localLayersSource);
  peInitLayers(layersSource);
  peComputeHistogram(peSourceCanvas);
  peZoomFit();
  peRender();
}

// Resets #peDrawCanvas to match the photo's pixel dimensions and reloads any
// previously-saved drawing for this file (setting canvas.width/height also clears it).
function peInitDrawLayer(width, height, existingDataUrl) {
  const canvas = document.getElementById('peDrawCanvas');
  canvas.width = width;
  canvas.height = height;
  peDrawCanvas = canvas;
  peDrawCtx = canvas.getContext('2d');
  peDrawUndoStack = [];
  peDrawHasContent = false;
  peSyncOverlayCanvasLayout();
  if (existingDataUrl) {
    const img = new Image();
    img.onload = () => { peDrawCtx.drawImage(img, 0, 0); peDrawHasContent = true; };
    img.src = existingDataUrl;
  }
}

// Resets #peMaskCanvas to match the photo's pixel dimensions and (re)builds peLocalLayers
// from existingLayers, decoding each layer's persisted maskDataUrl into an offscreen canvas
// cache (layer._maskCanvas) so peRender() can upload it as a GL texture without re-decoding
// every frame. No layer is loaded into #peMaskCanvas itself yet - that happens on-demand
// when the user selects one via peSelectMaskLayer, mirroring peInitDrawLayer's reset shape.
function peInitMaskLayers(width, height, existingLayers) {
  const canvas = document.getElementById('peMaskCanvas');
  canvas.width = width;
  canvas.height = height;
  peMaskCanvas = canvas;
  peMaskCtx = canvas.getContext('2d');
  peMaskUndoStack = [];
  peMaskCanvasHasContent = false;
  peEditingLayerId = null;
  peSyncOverlayCanvasLayout();
  peLocalLayers = peCloneLocalLayers(existingLayers);
  const decodes = peLocalLayers.filter(l => l.maskDataUrl && !l._maskCanvas).map(l => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { l._maskCanvas = peCopyCanvas(img, width, height); resolve(); };
    img.onerror = () => resolve();
    img.src = l.maskDataUrl;
  }));
  if (decodes.length) Promise.all(decodes).then(() => { if (peOpen) peRender(); });
  peRenderPanel();
  peSyncMaskCanvasVisibility();
}

// Rotates every local-mask layer's bitmap by rotationDelta (±90°) so masks stay aligned
// after a 90° Rotate. Unlike the source image (rebuilt fresh from peRawCanvas + the new
// cumulative file.rotation), masks have no "raw" unrotated original, so each is rotated
// incrementally from its current state - same approach already used for the draw layer just
// above. Re-encodes as PNG, not rotateDataUrl()'s hardcoded JPEG, to keep each mask's alpha
// channel (a JPEG re-encode would silently flatten it to opaque and destroy the mask shape).
async function peRotateLocalLayers(rotationDelta) {
  if (peEditingLayerId && peMaskCanvas) {
    const active = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
    if (active) active.maskDataUrl = peMaskCanvasHasContent ? peMaskCanvas.toDataURL('image/png') : null;
  }
  return Promise.all((peLocalLayers || []).map(layer => new Promise(resolve => {
    if (!layer.maskDataUrl) { resolve(Object.assign({}, layer, { _maskCanvas: null })); return; }
    const img = new Image();
    img.onload = () => {
      const rc = drawRotatedToCanvas(img, rotationDelta);
      resolve(Object.assign({}, layer, { maskDataUrl: rc.toDataURL('image/png'), _maskCanvas: rc }));
    };
    img.onerror = () => resolve(layer);
    img.src = layer.maskDataUrl;
  })));
}

// #peDrawCanvas and #peMaskCanvas are absolutely positioned so strokes/paint can happen
// independently of the WebGL pipeline, but that means CSS alone (object-fit:contain on a box
// sized to the whole stage) does NOT line their box up with #peCanvas's own rendered box -
// #peCanvas is an in-flow flex item that shrinks to its letterboxed size, so its bounding
// rect is already the tight visible-image rect, while an absolutely-positioned overlay
// filling the stage would stay oversized with its own independent letterboxing inside that.
// That mismatch is what made strokes land off toward the top-left of the actual cursor
// position: pointer coordinates were computed against the wrong (larger) rect. Instead, size
// and position both overlay canvases in JS to exactly match peCanvas's real rendered rect.
// ── Zoom & pan ──────────────────────────────────────────────────────────────
// Tracing an outline point by point is only as precise as the pixels you can see, so the stage
// zooms. The GL canvas keeps its intrinsic pixel size and is only *displayed* larger or
// smaller; every overlay is then laid out from its rendered rect by peSyncOverlayCanvasLayout,
// which means each tool's existing "rect.width -> canvas.width" maths keeps working at any
// zoom with no changes at all.
let peZoom = 1;          // 1 = fit the stage; 2 = twice that
let pePanX = 0, pePanY = 0;
const PE_ZOOM_MIN = 0.1, PE_ZOOM_MAX = 32;
function peFitScale() {
  const glCanvas = document.getElementById('peCanvas');
  const stage = glCanvas?.closest('.pe-stage');
  if (!glCanvas?.width || !stage) return 1;
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return 1;
  return Math.min(r.width / glCanvas.width, r.height / glCanvas.height);
}
// Displayed pixels per image pixel - what the zoom readout shows.
function peEffectiveScale() { return peFitScale() * peZoom; }
function peApplyZoom() {
  const glCanvas = document.getElementById('peCanvas');
  const stage = glCanvas?.closest('.pe-stage');
  if (!glCanvas?.width || !stage) return;
  const s = peEffectiveScale();
  glCanvas.style.width = (glCanvas.width * s) + 'px';
  glCanvas.style.height = (glCanvas.height * s) + 'px';
  // Keep at least a sliver on screen, so a stray pan can't lose the picture entirely.
  const r = stage.getBoundingClientRect();
  const halfW = glCanvas.width * s / 2, halfH = glCanvas.height * s / 2;
  const limX = halfW + r.width / 2 - 60, limY = halfH + r.height / 2 - 60;
  pePanX = Math.max(-limX, Math.min(limX, pePanX));
  pePanY = Math.max(-limY, Math.min(limY, pePanY));
  glCanvas.style.transform = `translate(${pePanX}px, ${pePanY}px)`;
  peSyncOverlayCanvasLayout();
  const readout = document.getElementById('peZoomLevel');
  if (readout) readout.textContent = Math.round(s * 100) + '%';
}
function peSetZoom(z, clientX, clientY) {
  const glCanvas = document.getElementById('peCanvas');
  if (!glCanvas?.width) return;
  const before = glCanvas.getBoundingClientRect();
  // Anchor on the point under the cursor (or the stage centre) so zooming feels like moving a
  // magnifier over the picture rather than the picture jumping away from you.
  const stage = glCanvas.closest('.pe-stage').getBoundingClientRect();
  const cx = Number.isFinite(clientX) ? clientX : stage.left + stage.width / 2;
  const cy = Number.isFinite(clientY) ? clientY : stage.top + stage.height / 2;
  const u = before.width ? (cx - before.left) / before.width : 0.5;
  const v = before.height ? (cy - before.top) / before.height : 0.5;
  peZoom = Math.max(PE_ZOOM_MIN, Math.min(PE_ZOOM_MAX, z));
  peApplyZoom();
  const after = glCanvas.getBoundingClientRect();
  pePanX += cx - (after.left + u * after.width);
  pePanY += cy - (after.top + v * after.height);
  peApplyZoom();
}
function peZoomBy(factor, clientX, clientY) { peSetZoom(peZoom * factor, clientX, clientY); }
function peZoomFit() { peZoom = 1; pePanX = 0; pePanY = 0; peApplyZoom(); }
function peZoomActual() {
  const fit = peFitScale();
  peSetZoom(fit ? 1 / fit : 1); // 100% = one screen pixel per image pixel
}
function setupPhotoEditorZoom() {
  const stage = document.querySelector('.pe-stage');
  if (!stage) return;
  stage.addEventListener('wheel', e => {
    if (!peOpen) return;
    e.preventDefault();
    // Around the middle of the view, not the cursor, so the picture stays put where you've
    // framed it - middle-drag (or Space-drag) below is how you move it.
    peZoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  // Pan with the middle button or with Space held - both are what people already reach for,
  // and neither collides with a tool's own drag. Capture phase, because the overlay canvases
  // above the stage would otherwise swallow the press.
  let pan = null;
  stage.addEventListener('pointerdown', e => {
    if (!peOpen) return;
    if (e.button !== 1 && !peSpaceHeld) return;
    e.preventDefault();
    e.stopPropagation();
    pan = { x: e.clientX, y: e.clientY, panX: pePanX, panY: pePanY };
    stage.classList.add('panning');
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  }, true);
  stage.addEventListener('pointermove', e => {
    if (!pan) return;
    e.stopPropagation();
    pePanX = pan.panX + (e.clientX - pan.x);
    pePanY = pan.panY + (e.clientY - pan.y);
    peApplyZoom();
  }, true);
  const endPan = e => {
    if (!pan) return;
    e.stopPropagation();
    pan = null;
    stage.classList.remove('panning');
    try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  stage.addEventListener('pointerup', endPan, true);
  stage.addEventListener('pointercancel', endPan, true);
}
let peSpaceHeld = false;

function peSyncOverlayCanvasLayout() {
  const glCanvas = document.getElementById('peCanvas');
  const stage = glCanvas?.closest('.pe-stage');
  if (!glCanvas || !stage || !glCanvas.width) return;
  const stageRect = stage.getBoundingClientRect();
  const glRect = glCanvas.getBoundingClientRect();
  ['peDrawCanvas', 'peLayersCanvas', 'peSelCanvas', 'peMaskCanvas', 'peHealCanvas', 'peTransformCanvas'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = (glRect.left - stageRect.left) + 'px';
    el.style.top = (glRect.top - stageRect.top) + 'px';
    el.style.width = glRect.width + 'px';
    el.style.height = glRect.height + 'px';
  });
}

// ── Tool rail + Layers panel (Photoshop-shaped shell) ───────────────────────
// The rail is the source of truth for what a pointer press on the stage does; the right-hand
// tab just follows it (and vice-versa, see peSwitchTab) so the two can never disagree about
// whether a drag paints, masks, or moves a layer. Pencil-vs-eraser stays on peDrawTool - the
// rail's two brush buttons set it - rather than becoming a second parallel notion of "tool".
const PE_TOOLS = [
  { key: 'move',     icon: peIcon('move'),      label: 'Move  (V)  - drag a layer' },
  { key: 'transform',icon: peIcon('transform'), label: 'Transform  (Ctrl+T)  - drag the corners to scale; right-click for distort, skew and perspective' },
  { key: 'warp',     icon: peIcon('warp'),      label: 'Warp  (W)  - push and pull a mesh over the layer to bend it' },
  { sep: true },
  { key: 'marquee',  icon: peIcon('marquee'),   label: 'Rectangular select  (M)  - then cut, copy, fill or erase' },
  { key: 'ellipse',  icon: peIcon('ellipse'),   label: 'Elliptical select  (M again)  - hold Shift for a circle' },
  { key: 'lasso',    icon: peIcon('lasso'),     label: 'Polygon lasso  (L)  - click once per corner, Enter or the first point to close' },
  { key: 'autosel',  icon: peIcon('autosel'),   label: 'Auto select  (A)  - click an object to select it; Shift+click adds, Alt+click takes away' },
  { sep: true },
  { key: 'text',     icon: peIcon('text'),      label: 'Text  (T)  - add a text layer, straight or on a curve' },
  { key: 'brush',    icon: peIcon('pencil'),    label: 'Brush  (B)  - paint on the document', group: true },
  { key: 'eraser',   icon: peIcon('eraser'),    label: 'Eraser  (E)  - rub your painting back off' },
  { key: 'heal',     icon: peIcon('heal'),      label: 'Smart eraser  (J)  - paint over an object and it disappears, filled in from its surroundings' },
  { key: 'dropper',  icon: peIcon('dropper'),   label: 'Eyedropper  (I)  - pick a colour off the canvas' },
  { sep: true },
  { key: 'mask',     icon: peIcon('mask'),      label: 'Mask brush  (K)  - paint where an adjustment applies' }
];
function peRenderToolRail() {
  const rail = document.getElementById('peToolRail');
  if (!rail) return;
  // Simple mode has no rail at all - Brush and Masks are reachable from their own tabs, and
  // everything else on this rail only exists to serve layers.
  if (!peIsPro()) { rail.innerHTML = ''; return; }
  rail.innerHTML = PE_TOOLS.map(t => {
    if (t.sep) return '<div class="pe-tool-sep"></div>';
    const active = t.key === 'eraser' ? (peTool === 'brush' && peDrawTool === 'eraser')
      : t.key === 'brush' ? (peTool === 'brush' && peDrawTool !== 'eraser')
      : peTool === t.key;
    if (t.group) {
      const label = `${pePaintToolLabel()}  (B)  - click the arrow for brush, highlighter and bucket`;
      return `<div class="pe-tool-slot">
        <button class="pe-tool-btn${active ? ' active' : ''}" title="${esc(label)}"
                onclick="peSelectTool('brush')" oncontextmenu="peShowToolFlyout(event)">${pePaintToolIcon()}</button>
        <button class="pe-tool-more" title="More paint tools" onclick="peShowToolFlyout(event)">◢</button>
      </div>`;
    }
    return `<button class="pe-tool-btn${active ? ' active' : ''}" title="${esc(t.label)}" onclick="peSelectTool('${t.key}')">${t.icon}</button>`;
  }).join('');
}
const PE_SELECT_TOOLS = ['marquee', 'ellipse', 'lasso', 'autosel'];
const PE_SIMPLE_TOOLS = ['brush', 'eraser', 'mask'];
function peSelectTool(tool) {
  // Simple mode owns only the two painting tools; a stray keyboard shortcut or a tab switch
  // asking for Move/Text/marquee here means "no active tool", not "quietly turn on a layer tool".
  if (!peIsPro() && !PE_SIMPLE_TOOLS.includes(tool)) {
    peTool = 'none';
    peSyncToolCanvases();
    return;
  }
  // PhotoMod has no tabs to keep in step - its panel simply shows the current tool's options,
  // so tool selection is just a mode change plus a repaint. peSwitchTab is simple mode's
  // business only, which is why every call to it below is guarded.
  const tabs = !peIsPro();
  // Walking away from a transform commits it. Having to find a confirm button after every
  // resize is the kind of friction that makes a tool feel like paperwork, so the shape you
  // have left on screen is taken as the one you meant. Escape (and the Cancel item) is the
  // way out, and it throws the session away - see pmCancelLiveMesh.
  if (peTool === 'transform' && tool !== 'transform') pmEndTransform(true);
  if (peTool === 'warp' && tool !== 'warp') pmEndWarp(true);
  if (peTool === 'lasso' && tool !== 'lasso') pmCancelPolygon(); // a half-drawn outline doesn't survive a tool change
  pmHideTfMenu();
  if (tool === 'text') {
    // Clicking T is the whole gesture - there's nothing to drag out, so it adds the layer and
    // hands straight back to Move, which is what you want for placing it.
    peAddTextLayer();
    peTool = 'move';
    if (tabs && (peActiveTab === 'draw' || peActiveTab === 'masks')) peSwitchTab('colors');
  } else if (tool === 'brush' || tool === 'eraser') {
    peSetDrawTool(tool === 'eraser' ? 'eraser'
      : PE_PAINT_TOOLS.some(t => t[0] === peDrawTool) ? peDrawTool : 'pencil');
    peTool = 'brush';
    if (tabs && peActiveTab !== 'draw') peSwitchTab('draw');
  } else if (tool === 'mask') {
    peTool = 'mask';
    if (tabs && peActiveTab !== 'masks') peSwitchTab('masks');
  } else if (tool === 'transform') {
    if (!(peTool === 'transform' && pmTransform) && !pmBeginTransform()) return;
    peTool = 'transform';
  } else if (tool === 'warp') {
    if (!(peTool === 'warp' && pmWarp) && !pmBeginWarp()) return;
    peTool = 'warp';
  } else if (PE_SELECT_TOOLS.includes(tool) || tool === 'dropper' || tool === 'heal') {
    peTool = tool;
    if (tool === 'autosel') pmSegPrewarm();
    if (tabs && (peActiveTab === 'draw' || peActiveTab === 'masks')) peSwitchTab('colors');
  } else {
    peTool = 'move';
    // Leaving a painting tool shouldn't yank the panel away from Direction/Colors if that's
    // where the user already was - only the paint-specific tabs need to step aside.
    if (tabs && (peActiveTab === 'draw' || peActiveTab === 'masks')) peSwitchTab('colors');
  }
  peSyncToolCanvases();
  peRenderToolRail();
  peRenderLayersPanel();
  if (peIsPro()) peRenderPanel();
}
// One place decides which overlay canvas is allowed to receive pointer events, so two tools
// can never both be live at once.
function peSyncToolCanvases() {
  const selecting = PE_SELECT_TOOLS.includes(peTool);
  const drawCanvas = document.getElementById('peDrawCanvas');
  if (drawCanvas) drawCanvas.style.pointerEvents = peTool === 'brush' ? 'auto' : 'none';
  const layersCanvas = document.getElementById('peLayersCanvas');
  if (layersCanvas) {
    layersCanvas.style.pointerEvents = peTool === 'move' ? 'auto' : 'none';
    layersCanvas.classList.toggle('move-tool', peTool === 'move');
  }
  const selCanvas = document.getElementById('peSelCanvas');
  if (selCanvas) {
    selCanvas.style.pointerEvents = selecting ? 'auto' : 'none';
    selCanvas.classList.toggle('selecting', selecting);
  }
  // Transform and Warp both work by dragging handles, which live on their own top canvas so a
  // handle grab can never be mistaken for a paint stroke or a layer drag.
  const tfCanvas = document.getElementById('peTransformCanvas');
  if (tfCanvas) {
    const handling = peTool === 'transform' || peTool === 'warp' || peTool === 'dropper';
    tfCanvas.style.pointerEvents = handling ? 'auto' : 'none';
    tfCanvas.classList.toggle('active', handling);
    tfCanvas.style.cursor = peTool === 'dropper' ? 'crosshair' : '';
  }
  const healCanvas = document.getElementById('peHealCanvas');
  if (healCanvas) healCanvas.style.pointerEvents = peTool === 'heal' ? 'auto' : 'none';
  if (peTool !== 'brush' && peTool !== 'mask' && peTool !== 'heal') {
    const cursor = document.getElementById('peBrushCursor');
    if (cursor) cursor.style.display = 'none';
  }
  peSyncMaskCanvasVisibility();
}

function peRenderLayersPanel() {
  const panel = document.getElementById('peLayersPanel');
  if (!panel) return;
  if (!peIsPro()) { panel.innerHTML = ''; return; } // the layer stack is PhotoMod's, not the quick editor's
  const layers = peLayers || [];
  const active = layers.find(l => l.id === peActiveLayerId);
  // Topmost first, the way every layer UI shows a stack that paints bottom-first. Rows are
  // drag-reorderable in place - the up/down buttons are gone, because dragging the thing you
  // are looking at is how the sidebar's own sections already work.
  const rows = [...layers].reverse().map(l => {
    const clipBase = l.clipped ? peClippingBaseFor(layers.indexOf(l)) : null;
    return `
    <div class="pe-layer-row${l.id === peActiveLayerId ? ' active' : ''}${l.clipped ? ' clipped' : ''}"
         data-layer="${l.id}" draggable="true"
         onclick="peSelectLayer('${l.id}')" oncontextmenu="pmLayerContextMenu(event,'${l.id}')">
      ${l.clipped ? `<span class="pe-layer-clip" title="${clipBase ? `Clipped to ${esc(clipBase.name)}` : 'Clipped, but there is no layer beneath to clip to'}">${peIcon('clip')}</span>` : ''}
      <span class="pe-layer-thumb">${l.dataUrl ? `<img src="${l.dataUrl}" alt=""/>` : peIcon('layer')}</span>
      <span class="pe-layer-name" title="${esc(l.name)}">${esc(l.name)}</span>
      ${l.colors && !pmLayerColorsAreDefault(l.colors) ? `<span class="pe-layer-badge" title="This layer has its own colour adjustments">${peIcon('palette')}</span>` : ''}
      <button class="pe-layer-btn" title="${l.visible ? 'Hide' : 'Show'}" onclick="event.stopPropagation();peToggleLayerVisible('${l.id}')">${peIcon(l.visible ? 'eye' : 'eyeOff')}</button>
      <button class="pe-layer-btn danger" title="Delete layer" onclick="event.stopPropagation();peDeleteLayer('${l.id}')">${peIcon('close')}</button>
    </div>`;
  }).join('');
  const activeControls = active ? `
    <div class="pe-layer-empty" style="margin-top:8px">Right-click a layer for properties, colours and clipping. Drag rows to restack.</div>` : '';
  // Selection verbs live next to the layers they act on, and say plainly what the photo does
  // and doesn't allow - "cut" on the base would mean rasterising the original, which this
  // editor never does.
  const selectionActions = peSelection ? `
    <div class="pe-tone-head" style="margin-top:14px"><span>Selection</span><span class="pe-slider-reset" onclick="peClearSelection()">deselect</span></div>
    <div class="pe-sel-actions">
      <button class="pe-draw-action-btn" onclick="peSelectionToNewLayer(false)">${peIcon('copy')} Copy to layer</button>
      <button class="pe-draw-action-btn" onclick="peSelectionToNewLayer(true)">${peIcon('cut')} Cut to layer</button>
      <button class="pe-draw-action-btn" onclick="peDeleteSelection()">${peIcon('eraser')} Erase</button>
    </div>
    <div class="pe-layer-empty" style="margin-top:6px">${active
      ? `Acts on <strong>${esc(active.name)}</strong>.`
      : 'No layer selected, so this copies from the photo. The photo itself is never cut into - it stays your untouched original.'}</div>` : '';
  panel.innerHTML = `
    <div class="pe-layers-head"><span>Layers</span><span class="pe-layer-sub">${layers.length || ''}</span></div>
    ${rows}
    <div class="pe-layer-row base${peActiveLayerId ? '' : ' active'}" onclick="peSelectBaseLayer()">
      <span class="pe-layer-thumb">${peIcon('image')}</span>
      <span class="pe-layer-name">Photo <span class="pe-layer-sub">· original</span></span>
    </div>
    ${layers.length ? activeControls : '<div class="pe-layer-empty">Paste an image with Ctrl+V, or use the T tool, to add a layer above the photo.</div>'}
    ${selectionActions}`;
  panel.querySelectorAll('.pe-layer-row[data-layer]').forEach(setupLayerRowDrag);
}

// Drag-to-restack, the same shape as the sidebar's section reordering: the row you drop on is
// the slot you take. Rows read top-down but the array paints bottom-up, so the index maths
// below flips once and only once, here.
function setupLayerRowDrag(row) {
  row.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/pe-layer', row.dataset.layer);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.querySelectorAll('.pe-layer-row').forEach(r => r.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/pe-layer')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    const from = e.dataTransfer.getData('text/pe-layer');
    const to = row.dataset.layer;
    if (!from || from === to) return;
    e.preventDefault();
    const fromIdx = peLayers.findIndex(l => l.id === from);
    const toIdx = peLayers.findIndex(l => l.id === to);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = peLayers.splice(fromIdx, 1);
    peLayers.splice(peLayers.findIndex(l => l.id === to) + (fromIdx < toIdx ? 1 : 0), 0, moved);
    peCompositeLayers();
    peRenderLayersPanel();
    pePushHistory('reorder layers');
    peDirty = true;
  });
}

// ── Layer context menu ──────────────────────────────────────────────────────
let pmLayerMenuId = null;
function pmLayerContextMenu(e, id) {
  e.preventDefault();
  e.stopPropagation();
  pmLayerMenuId = id;
  peActiveLayerId = id;
  peRenderLayersPanel();
  const layer = (peLayers || []).find(l => l.id === id);
  if (!layer) return;
  const idx = peLayers.indexOf(layer);
  const canClip = idx > 0;
  const menu = document.getElementById('pmLayerMenu');
  menu.innerHTML = `
    <div class="ctx-item" onclick="pmLayerMenuRun('pmOpenLayerProps')"><span class="ctx-icon">${peIcon('settings')}</span> Properties</div>
    <div class="ctx-item" onclick="pmLayerMenuRun('pmOpenLayerColours')"><span class="ctx-icon">${peIcon('palette')}</span> Colours</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item${canClip ? '' : ' disabled'}" title="${canClip ? 'Show this layer only where the layer beneath it has pixels' : 'Needs a layer underneath to clip to'}" onclick="${canClip ? "pmLayerMenuRun('pmToggleClipping')" : ''}">
      <span class="ctx-icon">${peIcon(layer.clipped ? 'check' : 'clip')}</span> ${layer.clipped ? 'Release clipping mask' : 'Create clipping mask'}
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="pmLayerMenuRun('pmDuplicateLayer')"><span class="ctx-icon">${peIcon('copy')}</span> Duplicate</div>
    <div class="ctx-item danger" onclick="pmLayerMenuRun('pmDeleteMenuLayer')"><span class="ctx-icon">${peIcon('trash')}</span> Delete</div>`;
  menu.classList.add('open');
  menu.style.left = '0px'; menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(e.clientX, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - r.height - 8) + 'px';
}
function pmHideLayerMenu() { document.getElementById('pmLayerMenu')?.classList.remove('open'); }
function pmLayerMenuRun(fnName) {
  pmHideLayerMenu();
  const fn = window[fnName];
  if (typeof fn === 'function') fn();
}
function pmDeleteMenuLayer() { if (pmLayerMenuId) peDeleteLayer(pmLayerMenuId); }
function pmToggleClipping() {
  const layer = (peLayers || []).find(l => l.id === pmLayerMenuId);
  if (!layer) return;
  if (peLayers.indexOf(layer) === 0) { toast('The bottom layer has nothing beneath it to clip to'); return; }
  layer.clipped = !layer.clipped;
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory(layer.clipped ? 'clipping mask' : 'release clipping mask');
  peDirty = true;
  toast(layer.clipped ? '⌐ Clipped to the layer below' : 'Clipping mask released');
}

// ── Layer properties / colours panels ───────────────────────────────────────
// Both dock at the top of the right-hand column, above Tool Options, because they belong to
// the layer you just right-clicked rather than to the tool in your hand.
let pmPropsOpen = false;
function pmOpenLayerProps() {
  pmPropsOpen = true;
  peRenderPanel();
}
function pmCloseLayerProps() { pmPropsOpen = false; peRenderPanel(); }
function pmOpenLayerColours() {
  pmColorTarget = pmLayerMenuId || peActiveLayerId;
  pmToggleAdjustPanel(true);
  peRenderPanel();
}
// Pointing the Adjustments panel back at the photo.
function pmColorTargetBase() {
  pmColorTarget = null;
  pmRenderAdjustPanel();
  peRenderPanel();
}
function pmResetLayerColours() {
  const l = pmColorTargetLayer();
  if (!l) { peResetAll(); return; }
  l.colors = pmDefaultLayerColors();
  pmInvalidateLayerColors(l);
  peCompositeLayers();
  peRenderLayersPanel();
  pmRenderAdjustPanel();
  peDirty = true;
}
function pmLayerPropsHtml() {
  const l = pmActiveLayer();
  if (!pmPropsOpen || !l) return '';
  const blendOptions = PE_BLEND_MODES.map(([v, label]) =>
    `<option value="${v}"${(l.blend || 'source-over') === v ? ' selected' : ''}>${label}</option>`).join('');
  // Size and rotation deliberately aren't here any more: the Transform tool does both, with
  // handles on the actual picture, and two ways to set the same number is one too many.
  return `
    <div class="pm-props">
      <div class="pm-props-head">
        <span>${peIconLead('settings')}${esc(l.name)}</span>
        <button class="pe-layer-btn" title="Close" onclick="pmCloseLayerProps()">${peIcon('close')}</button>
      </div>
      <div class="pe-blend-row">Blend <select onchange="peOnLayerBlend(this.value)">${blendOptions}</select></div>
      <div class="pe-slider-row">
        <div class="pe-slider-head"><span>Opacity</span><span class="pe-slider-val" id="peLayerOpacityVal">${l.opacity}%</span></div>
        <input type="range" min="0" max="100" value="${l.opacity}" id="peLayerOpacity"
               oninput="peOnLayerOpacity(this.value)" onchange="pePushHistory('adjust layer')"/>
      </div>
      <div class="pm-btn-grid" style="margin-top:8px">
        <button class="pe-draw-action-btn" onclick="peSelectTool('transform')">${peIcon('transform')} Transform</button>
        <button class="pe-draw-action-btn" onclick="pmLayerMenuId='${l.id}';pmOpenLayerColours()">${peIcon('palette')} Colours</button>
      </div>
    </div>`;
}
// Selecting the photo row means "act on the photo" - used by the selection verbs above, and it
// deliberately deselects any layer so Move/Erase can't touch one by accident.
function peSelectBaseLayer() {
  peActiveLayerId = null;
  peRenderLayersPanel();
  peRenderPanel();
}
function peSelectLayer(id) {
  peActiveLayerId = id;
  peSelectTool('move');
  peRenderLayersPanel();
}
function peToggleLayerVisible(id) {
  const layer = (peLayers || []).find(l => l.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory(layer.visible ? 'show layer' : 'hide layer');
  peDirty = true;
  peScheduleSave();
}
function peDeleteLayer(id) {
  const i = (peLayers || []).findIndex(l => l.id === id);
  if (i === -1) return;
  peLayers.splice(i, 1);
  if (peActiveLayerId === id) peActiveLayerId = peLayers.length ? peLayers[peLayers.length - 1].id : null;
  peCompositeLayers();
  peRenderLayersPanel();
  peRenderPanel();
  pePushHistory('delete layer');
  peDirty = true;
  peScheduleSave();
}
function peMoveLayerOrder(id, dir) {
  const i = (peLayers || []).findIndex(l => l.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= peLayers.length) return;
  [peLayers[i], peLayers[j]] = [peLayers[j], peLayers[i]];
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('reorder layers');
  peDirty = true;
  peScheduleSave();
}
function peOnLayerBlend(mode) {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  if (!layer) return;
  layer.blend = mode;
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('change blend mode');
  peDirty = true;
  peScheduleSave();
}
function peOnLayerRotation(val) {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  if (!layer) return;
  layer.rotation = parseInt(val, 10) || 0;
  const readout = document.getElementById('peLayerRotationVal');
  if (readout) readout.textContent = layer.rotation;
  const slider = document.getElementById('peLayerRotation');
  if (slider) slider.value = layer.rotation;
  peCompositeLayers();
  peDirty = true;
  peScheduleSave();
}
function peOnLayerOpacity(val) {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  if (!layer) return;
  layer.opacity = parseInt(val, 10) || 0;
  const readout = document.getElementById('peLayerOpacityVal');
  if (readout) readout.textContent = layer.opacity + '%';
  const slider = document.getElementById('peLayerOpacity');
  if (slider) slider.value = layer.opacity;
  peCompositeLayers();
  peDirty = true;
  peScheduleSave();
}
// Scales around the layer's centre so resizing doesn't also shove it across the photo.
function peOnLayerScale(val) {
  const layer = (peLayers || []).find(l => l.id === peActiveLayerId);
  if (!layer) return;
  const before = peLayerSize(layer);
  layer.scale = Math.max(5, parseInt(val, 10) || 100);
  const after = peLayerSize(layer);
  layer.x += (before.w - after.w) / 2;
  layer.y += (before.h - after.h) / 2;
  const readout = document.getElementById('peLayerScaleVal');
  if (readout) readout.textContent = layer.scale;
  const slider = document.getElementById('peLayerScale');
  if (slider) slider.value = layer.scale;
  peCompositeLayers();
  peDirty = true;
  peScheduleSave();
}

// Move tool: drag the topmost layer under the cursor (preferring the selected one, the way
// Photoshop's Move tool prefers the active layer). Hit-testing is by bounding box - good
// enough while every layer is a rectangular pasted bitmap.
function setupPhotoEditorLayers() {
  const canvas = document.getElementById('peLayersCanvas');
  if (!canvas) return;
  const pointFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };
  const hitLayer = p => {
    const inside = l => {
      if (!l.visible || !l._bitmap) return false;
      const { w, h } = peLayerSize(l);
      return p.x >= l.x && p.x <= l.x + w && p.y >= l.y && p.y <= l.y + h;
    };
    const active = (peLayers || []).find(l => l.id === peActiveLayerId);
    if (active && inside(active)) return active;
    for (let i = (peLayers || []).length - 1; i >= 0; i--) if (inside(peLayers[i])) return peLayers[i];
    return null;
  };
  canvas.addEventListener('pointerdown', e => {
    if (peTool !== 'move' || !peLayers?.length) return;
    const p = pointFromEvent(e);
    const layer = hitLayer(p);
    if (!layer) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (peActiveLayerId !== layer.id) { peActiveLayerId = layer.id; peRenderLayersPanel(); }
    peLayerDrag = { id: layer.id, startX: p.x, startY: p.y, originX: layer.x, originY: layer.y };
  });
  canvas.addEventListener('pointermove', e => {
    if (!peLayerDrag) return;
    const layer = (peLayers || []).find(l => l.id === peLayerDrag.id);
    if (!layer) return;
    const p = pointFromEvent(e);
    layer.x = peLayerDrag.originX + (p.x - peLayerDrag.startX);
    layer.y = peLayerDrag.originY + (p.y - peLayerDrag.startY);
    peCompositeLayers();
  });
  const endDrag = e => {
    if (!peLayerDrag) return;
    const moved = peLayerDrag.originX !== (peLayers || []).find(l => l.id === peLayerDrag.id)?.x;
    peLayerDrag = null;
    if (moved) pePushHistory('move layer');
    peDirty = true;
    peScheduleSave();
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
}

// Marquee/lasso dragging. Both produce the same shape of selection (a closed path in image
// pixels); the marquee just synthesises its four corners from the drag rectangle.
function setupPhotoEditorSelection() {
  const canvas = document.getElementById('peSelCanvas');
  if (!canvas) return;
  const pointFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };
  const rectPoints = (a, b) => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  // An ellipse is approximated as a polygon so it flows through exactly the same selection
  // machinery as the marquee and the lasso - one shape representation, no special cases in the
  // mask, lift, erase or invert paths.
  const ellipsePoints = (a, b) => {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    const steps = 72;
    return Array.from({ length: steps }, (_, i) => {
      const t = i / steps * Math.PI * 2;
      return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
    });
  };
  // Shift constrains to a square/circle, measured from the drag origin.
  const squared = (a, b) => {
    const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side };
  };
  // The lasso is point-by-point rather than freehand: click to drop each vertex, and the edge
  // follows the cursor until the next click. Tracing a precise outline by holding the mouse
  // down is the kind of thing that needs a steady hand and one unbroken gesture - clicking
  // lets you take as long as you like over each corner, and undo a vertex you got wrong.
  canvas.addEventListener('pointerdown', e => {
    if (!PE_SELECT_TOOLS.includes(peTool)) return;
    if (e.button === 2) { if (peTool === 'lasso') { e.preventDefault(); pmClosePolygon(); } return; }
    e.preventDefault();
    const p = pointFromEvent(e);
    if (peTool === 'autosel') { pmAutoSelectAt(p, e); return; }
    if (peTool === 'lasso') {
      if (!pmPolygon) { pmPolygon = { points: [p] }; pmDrawPolygonPreview(p); return; }
      // Clicking back on the first vertex closes the shape, the way every polygon tool does.
      const first = pmPolygon.points[0];
      const near = Math.hypot(p.x - first.x, p.y - first.y) < 12 * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
      if (near && pmPolygon.points.length > 2) { pmClosePolygon(); return; }
      pmPolygon.points.push(p);
      pmDrawPolygonPreview(p);
      return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    peSelDrag = { start: p, points: [p], preview: null };
  });
  canvas.addEventListener('dblclick', e => {
    if (peTool === 'lasso' && pmPolygon) { e.preventDefault(); pmClosePolygon(); }
  });
  canvas.addEventListener('pointermove', e => {
    if (peTool === 'lasso') { if (pmPolygon) pmDrawPolygonPreview(pointFromEvent(e)); return; }
    if (!peSelDrag) return;
    let p = pointFromEvent(e);
    if (e.shiftKey) p = squared(peSelDrag.start, p);
    const points = peTool === 'ellipse' ? ellipsePoints(peSelDrag.start, p) : rectPoints(peSelDrag.start, p);
    peSelDrag.preview = { type: peTool, invert: false, points, bounds: peSelectionBounds(points) };
    peDrawSelectionOverlay();
  });
  const endSelect = e => {
    if (!peSelDrag) return;
    const preview = peSelDrag.preview;
    peSelDrag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    peSetSelection(preview);
    if (peSelection) peRenderLayersPanel();
  };
  canvas.addEventListener('pointerup', endSelect);
  canvas.addEventListener('pointercancel', endSelect);
}

// ── Polygon lasso ───────────────────────────────────────────────────────────
// Held separately from peSelDrag because it spans many clicks rather than one drag, and has to
// survive the pointer leaving the canvas between them.
let pmPolygon = null;
function pmPolygonActive() { return !!pmPolygon; }
// Draws the vertices placed so far plus a rubber band out to the cursor, straight onto the
// selection overlay - the same canvas the finished marching ants will use.
function pmDrawPolygonPreview(cursor) {
  if (!peSelCtx || !peSelCanvas || !pmPolygon) return;
  const pts = pmPolygon.points;
  const scale = peSelCanvas.width / Math.max(1, peSelCanvas.getBoundingClientRect().width || peSelCanvas.width);
  const ctx = peSelCtx;
  ctx.clearRect(0, 0, peSelCanvas.width, peSelCanvas.height);
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  if (cursor) ctx.lineTo(cursor.x, cursor.y);
  ctx.setLineDash([6 * scale, 6 * scale]);
  ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.lineDashOffset = 6 * scale;
  ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.setLineDash([]);
  // Vertex dots, with the first one larger because clicking it is what closes the shape.
  pts.forEach((p, i) => {
    const r = (i === 0 ? 5 : 3.5) * scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#ffd166' : '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = Math.max(1, 1 * scale);
    ctx.stroke();
  });
  ctx.restore();
}
function pmClosePolygon() {
  if (!pmPolygon) return;
  const points = pmPolygon.points;
  pmPolygon = null;
  if (points.length < 3) { peDrawSelectionOverlay(); return; }
  peSetSelection({ type: 'lasso', invert: false, points, bounds: peSelectionBounds(points) });
  if (peSelection) peRenderLayersPanel();
}
function pmCancelPolygon() {
  if (!pmPolygon) return;
  pmPolygon = null;
  peDrawSelectionOverlay();
}
// Backspace while drawing takes back the last vertex instead of deleting a layer.
function pmUndoPolygonPoint() {
  if (!pmPolygon) return;
  pmPolygon.points.pop();
  if (!pmPolygon.points.length) { pmCancelPolygon(); return; }
  pmDrawPolygonPreview(null);
}

// Ctrl+V anywhere in the editor drops the clipboard image in as a new layer - copying from a
// browser, a screenshot tool or another editor all land here. Some apps publish only a raw
// bitmap, which doesn't always surface as a DataTransfer item, so Electron's own clipboard is
// the fallback before giving up.
function setupPhotoEditorPaste() {
  document.addEventListener('paste', async e => {
    if (!peOpen || !peLayers || !peIsPro()) return; // pasting makes a layer, and simple mode has no layer stack
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        const url = URL.createObjectURL(file);
        await peAddLayerFromSource(url, 'Pasted image');
        URL.revokeObjectURL(url);
        return;
      }
    }
    const dataUrl = await window.api.readClipboardImage?.().catch(() => null);
    if (dataUrl) {
      e.preventDefault();
      await peAddLayerFromSource(dataUrl, 'Pasted image');
    }
  });
}

// Draws directly onto #peDrawCanvas via pointer events - set up once at startup
// (the canvas element is static markup, just resized/cleared per photo by
// peInitDrawLayer) rather than re-attached every time the editor opens.
function setupPhotoEditorDraw() {
  const canvas = document.getElementById('peDrawCanvas');
  const cursor = document.getElementById('peBrushCursor');
  const stage = canvas.closest('.pe-stage');

  window.addEventListener('resize', () => { if (peOpen) peApplyZoom(); });

  const pointFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };
  const moveCursor = e => {
    const stageRect = stage.getBoundingClientRect();
    cursor.style.left = (e.clientX - stageRect.left) + 'px';
    cursor.style.top = (e.clientY - stageRect.top) + 'px';
    cursor.style.width = cursor.style.height = peDrawSize + 'px';
  };

  canvas.addEventListener('pointerenter', e => {
    if (peTool === 'brush') cursor.style.display = 'block';
    moveCursor(e);
  });
  canvas.addEventListener('pointerleave', () => { cursor.style.display = 'none'; });

  const strokeStyle = (ctx, p) => {
    ctx.globalCompositeOperation = peDrawTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = peDrawColor;
    ctx.lineWidth = Math.max(1, peDrawSize * p.scale * (peDrawTool === 'highlighter' ? 1.6 : 1));
    ctx.lineCap = peDrawTool === 'highlighter' ? 'square' : 'round';
    ctx.lineJoin = 'round';
  };
  canvas.addEventListener('pointerdown', e => {
    if (peTool !== 'brush' || !peDrawCtx) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    if (peDrawTool === 'bucket') { peBucketFillAt(p.x, p.y); moveCursor(e); return; }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    peDrawSnapshotForUndo();
    peDrawing = true;
    peDrawLastPoint = p;
    if (peDrawTool === 'highlighter') { peBeginHighlighterStroke(p); moveCursor(e); return; }
    strokeStyle(peDrawCtx, p);
    peDrawCtx.beginPath();
    peDrawCtx.moveTo(p.x, p.y);
    peDrawCtx.lineTo(p.x + 0.01, p.y + 0.01); // renders a dot on a plain click, not just drags
    peDrawCtx.stroke();
    peDrawHasContent = true;
    // In a blend-mode document the overlay holds the only visible copy of these strokes (the
    // real draw canvas is hidden underneath it), so it has to be re-flattened as they land.
    if (peLayersNeedBase()) peCompositeLayers();
    moveCursor(e);
  });

  canvas.addEventListener('pointermove', e => {
    moveCursor(e);
    if (!peDrawing) return;
    const p = pointFromEvent(e);
    if (peDrawTool === 'highlighter') { peHighlighterSegment(peDrawLastPoint, p); peDrawLastPoint = p; return; }
    peDrawCtx.beginPath();
    peDrawCtx.moveTo(peDrawLastPoint.x, peDrawLastPoint.y);
    peDrawCtx.lineTo(p.x, p.y);
    peDrawCtx.stroke();
    peDrawLastPoint = p;
    if (peLayersNeedBase()) peCompositeLayers();
  });

  const endStroke = e => {
    if (!peDrawing) return;
    peDrawing = false;
    peEndHighlighterStroke();
    peDirty = true;
    peScheduleSave();
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
}

// ── Highlighter ─────────────────────────────────────────────────────────────
// A marker lays down one even tone: crossing your own stroke shouldn't darken it, which is
// exactly what happens if you draw translucent segment onto translucent segment. So the stroke
// is built at full opacity on its own canvas, and the visible layer is rebuilt each move from
// "what was there before" plus "the whole stroke so far, at the marker's alpha". Only the
// segment's own bounding box is touched, so this stays cheap on a 20-megapixel document.
const PE_HIGHLIGHT_ALPHA = 0.34;
let peStrokeCanvas = null, peStrokeCtx = null, peStrokeBase = null;
function peBeginHighlighterStroke(p) {
  const w = peDrawCanvas.width, h = peDrawCanvas.height;
  if (!peStrokeCanvas || peStrokeCanvas.width !== w || peStrokeCanvas.height !== h) {
    peStrokeCanvas = document.createElement('canvas');
    peStrokeCanvas.width = w; peStrokeCanvas.height = h;
    peStrokeCtx = peStrokeCanvas.getContext('2d');
  }
  peStrokeCtx.clearRect(0, 0, w, h);
  peStrokeBase = peCopyCanvas(peDrawCanvas, w, h); // the layer as it stood before this stroke
  peHighlighterSegment(p, { x: p.x + 0.01, y: p.y + 0.01, scale: p.scale });
}
function peHighlighterSegment(a, b) {
  if (!peStrokeCtx || !peStrokeBase) return;
  const width = Math.max(1, peDrawSize * (b.scale || a.scale || 1) * 1.6);
  peStrokeCtx.globalCompositeOperation = 'source-over';
  peStrokeCtx.strokeStyle = peDrawColor;
  peStrokeCtx.lineWidth = width;
  peStrokeCtx.lineCap = 'square';
  peStrokeCtx.lineJoin = 'round';
  peStrokeCtx.beginPath();
  peStrokeCtx.moveTo(a.x, a.y);
  peStrokeCtx.lineTo(b.x, b.y);
  peStrokeCtx.stroke();
  const pad = width / 2 + 2;
  const x = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad));
  const y = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
  const w = Math.min(peDrawCanvas.width - x, Math.ceil(Math.abs(b.x - a.x) + pad * 2));
  const h = Math.min(peDrawCanvas.height - y, Math.ceil(Math.abs(b.y - a.y) + pad * 2));
  if (w <= 0 || h <= 0) return;
  peDrawCtx.save();
  // clearRect + source-over, never 'copy': 'copy' replaces the whole canvas rather than the
  // rectangle being drawn, so each segment would wipe every earlier one in the same stroke.
  peDrawCtx.globalCompositeOperation = 'source-over';
  peDrawCtx.globalAlpha = 1;
  peDrawCtx.clearRect(x, y, w, h);
  peDrawCtx.drawImage(peStrokeBase, x, y, w, h, x, y, w, h); // back to the pre-stroke pixels
  peDrawCtx.globalAlpha = PE_HIGHLIGHT_ALPHA;
  peDrawCtx.drawImage(peStrokeCanvas, x, y, w, h, x, y, w, h);
  peDrawCtx.restore();
  peDrawHasContent = true;
  if (peLayersNeedBase()) peCompositeLayers();
}
function peEndHighlighterStroke() {
  peStrokeBase = null;
  if (peStrokeCtx) peStrokeCtx.clearRect(0, 0, peStrokeCanvas.width, peStrokeCanvas.height);
}

// ── Paint bucket ────────────────────────────────────────────────────────────
// Floods outward from the click over pixels close enough in colour to the one clicked, judged
// against the flattened picture - what you see - rather than the paint layer, which is usually
// empty where you are clicking. The fill itself lands on the paint layer, so the photo beneath
// is never written into. A live selection confines it.
let peBucketTolerance = 28;
function peSetBucketTolerance(v) {
  peBucketTolerance = Math.max(0, Math.min(255, parseInt(v, 10) || 0));
  const out = document.getElementById('peBucketTolVal');
  if (out) out.textContent = peBucketTolerance;
}
function peBucketFillAt(px, py) {
  if (!peDrawCtx || !peDrawCanvas) return;
  const w = peDrawCanvas.width, h = peDrawCanvas.height;
  const x0 = Math.round(px), y0 = Math.round(py);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;
  const composite = peCompositeCanvas();
  if (!composite) return;
  let src;
  try { src = peCopyCanvas(composite, w, h).getContext('2d').getImageData(0, 0, w, h).data; } catch (e) { return; }
  const limit = peSelection ? peSelectionMaskCanvas(w, h, 0, 0).getContext('2d').getImageData(0, 0, w, h).data : null;
  const at = (x, y) => (y * w + x) * 4;
  const s = at(x0, y0);
  const r0 = src[s], g0 = src[s+1], b0 = src[s+2];
  const tol = peBucketTolerance * peBucketTolerance * 3;
  const matches = i => {
    if (limit && limit[i+3] < 8) return false;
    const dr = src[i] - r0, dg = src[i+1] - g0, db = src[i+2] - b0;
    return dr*dr + dg*dg + db*db <= tol;
  };
  // Scanline flood: each pass walks a run left and right, then queues the rows above and below.
  // Much cheaper than a four-way pixel stack on a photo-sized canvas.
  const seen = new Uint8Array(w * h);
  const out = new Uint8ClampedArray(w * h * 4);
  const col = peHexToRgb(peDrawColor);
  const stack = [[x0, y0]];
  let filled = 0;
  while (stack.length) {
    const [sx, sy] = stack.pop();
    if (seen[sy * w + sx] || !matches(at(sx, sy))) continue;
    let left = sx, right = sx;
    while (left > 0 && !seen[sy * w + left - 1] && matches(at(left - 1, sy))) left--;
    while (right < w - 1 && !seen[sy * w + right + 1] && matches(at(right + 1, sy))) right++;
    for (let x = left; x <= right; x++) {
      seen[sy * w + x] = 1;
      const o = at(x, sy);
      out[o] = col.r; out[o+1] = col.g; out[o+2] = col.b; out[o+3] = 255;
      filled++;
      for (const ny of [sy - 1, sy + 1]) {
        if (ny < 0 || ny >= h) continue;
        if (!seen[ny * w + x] && matches(at(x, ny))) stack.push([x, ny]);
      }
    }
  }
  if (!filled) { toast('Nothing to fill there'); return; }
  peDrawSnapshotForUndo();
  const patch = document.createElement('canvas');
  patch.width = w; patch.height = h;
  patch.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  peDrawCtx.globalCompositeOperation = 'source-over';
  peDrawCtx.globalAlpha = 1;
  peDrawCtx.drawImage(patch, 0, 0);
  peDrawHasContent = true;
  peDirty = true;
  if (peLayersNeedBase()) peCompositeLayers();
  peScheduleSave();
  toast(`🪣 Filled ${filled.toLocaleString()} pixels`);
}
function peHexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function peDrawSnapshotForUndo() {
  if (!peDrawCanvas) return;
  try {
    peDrawUndoStack.push(peDrawCanvas.toDataURL('image/png'));
    if (peDrawUndoStack.length > 15) peDrawUndoStack.shift();
  } catch (e) {}
}

function peDrawUndo() {
  if (!peDrawUndoStack.length || !peDrawCtx || !peDrawCanvas) return;
  const snap = peDrawUndoStack.pop();
  const img = new Image();
  img.onload = () => {
    peDrawCtx.clearRect(0, 0, peDrawCanvas.width, peDrawCanvas.height);
    peDrawCtx.drawImage(img, 0, 0);
    peDirty = true;
    peScheduleSave();
  };
  img.src = snap;
}

function peDrawClearAll() {
  if (!peDrawCtx || !peDrawCanvas) return;
  if (!peDrawHasContent) return;
  peDrawSnapshotForUndo();
  peDrawCtx.clearRect(0, 0, peDrawCanvas.width, peDrawCanvas.height);
  peDrawHasContent = false;
  peDirty = true;
  peScheduleSave();
  toast('🧹 Drawing cleared');
}

function peSetDrawColor(v) { peDrawColor = v; }

function peSetDrawSize(v) {
  peDrawSize = parseInt(v, 10) || 24;
  const val = document.getElementById('peDrawSizeVal');
  if (val) val.textContent = peDrawSize + 'px';
}

function peSetDrawTool(t) {
  peDrawTool = t;
  ['pencil', 'highlighter', 'bucket', 'eraser'].forEach(k =>
    document.getElementById('peToolBtn-' + k)?.classList.toggle('active', t === k));
}

// ── The paint group ─────────────────────────────────────────────────────────
// One slot on the rail, three tools behind it, the way a tool group works in any editor: the
// button runs whichever you used last, and the little corner arrow rolls the rest out.
const PE_PAINT_TOOLS = [
  ['pencil',      peIcon('pencil'),      'Brush',      'A solid stroke in the current colour.'],
  ['highlighter', peIcon('highlighter'), 'Highlighter', 'A wide translucent marker that tints instead of covering. One stroke stays an even tone however much it crosses itself.'],
  ['bucket',      peIcon('bucket'),      'Paint bucket','Click to flood the area under the cursor with the current colour.']
];
function pePaintToolIcon() { return (PE_PAINT_TOOLS.find(t => t[0] === peDrawTool) || PE_PAINT_TOOLS[0])[1]; }
function pePaintToolLabel() { return (PE_PAINT_TOOLS.find(t => t[0] === peDrawTool) || PE_PAINT_TOOLS[0])[2]; }
function peShowToolFlyout(e) {
  e.preventDefault();
  e.stopPropagation();
  const fly = document.getElementById('peToolFlyout');
  if (!fly) return;
  fly.innerHTML = PE_PAINT_TOOLS.map(([key, icon, label, hint]) => `
    <div class="ctx-item${peTool === 'brush' && peDrawTool === key ? ' active' : ''}" title="${esc(hint)}" onclick="pePickPaintTool('${key}')">
      <span class="ctx-icon">${icon}</span> ${label}
    </div>`).join('');
  fly.classList.add('open');
  const btn = e.currentTarget.closest('.pe-tool-slot') || e.currentTarget;
  const r = btn.getBoundingClientRect();
  fly.style.left = (r.right + 6) + 'px';
  fly.style.top = Math.min(r.top, window.innerHeight - fly.getBoundingClientRect().height - 8) + 'px';
}
function peHideToolFlyout() { document.getElementById('peToolFlyout')?.classList.remove('open'); }
function pePickPaintTool(key) {
  peHideToolFlyout();
  peSetDrawTool(key);
  peTool = 'brush';
  if (!peIsPro() && peActiveTab !== 'draw') peSwitchTab('draw');
  peSyncToolCanvases();
  peRenderToolRail();
  peRenderPanel();
}

// ── Local (masked) adjustments: brush mask painting ─────────────────────────────
// Paints directly onto #peMaskCanvas via pointer events - set up once at startup, same
// shape as setupPhotoEditorDraw above. Always paints in a fixed visible color with
// globalAlpha building up coverage; the mask's real data is the alpha channel (read back by
// the GL pass via gl.ALPHA - see peUploadMaskTexture), so "show mask overlay" is just
// toggling the canvas's CSS opacity/visibility, no separate encode step.
function setupPhotoEditorMask() {
  const canvas = document.getElementById('peMaskCanvas');
  const cursor = document.getElementById('peBrushCursor');
  const stage = canvas.closest('.pe-stage');

  const pointFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };
  const moveCursor = e => {
    const stageRect = stage.getBoundingClientRect();
    cursor.style.left = (e.clientX - stageRect.left) + 'px';
    cursor.style.top = (e.clientY - stageRect.top) + 'px';
    cursor.style.width = cursor.style.height = peMaskSize + 'px';
  };
  const maskActive = () => peTool === 'mask' && !!peEditingLayerId;

  canvas.addEventListener('pointerenter', e => {
    if (maskActive()) cursor.style.display = 'block';
    moveCursor(e);
  });
  canvas.addEventListener('pointerleave', () => { cursor.style.display = 'none'; });

  canvas.addEventListener('pointerdown', e => {
    if (!maskActive() || !peMaskCtx) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    peMaskSnapshotForUndo();
    peMaskDrawing = true;
    const p = pointFromEvent(e);
    peMaskLastPoint = p;
    peMaskCtx.globalCompositeOperation = peMaskTool === 'subtract' ? 'destination-out' : 'source-over';
    peMaskCtx.filter = peMaskFeather > 0 ? `blur(${(peMaskFeather * p.scale * 0.3).toFixed(1)}px)` : 'none';
    peMaskCtx.strokeStyle = '#ff2d55';
    peMaskCtx.lineWidth = Math.max(1, peMaskSize * p.scale);
    peMaskCtx.lineCap = 'round';
    peMaskCtx.lineJoin = 'round';
    peMaskCtx.beginPath();
    peMaskCtx.moveTo(p.x, p.y);
    peMaskCtx.lineTo(p.x + 0.01, p.y + 0.01); // renders a dot on a plain click, not just drags
    peMaskCtx.stroke();
    peMaskCanvasHasContent = true;
    moveCursor(e);
    peRender();
  });

  canvas.addEventListener('pointermove', e => {
    moveCursor(e);
    if (!peMaskDrawing) return;
    const p = pointFromEvent(e);
    peMaskCtx.beginPath();
    peMaskCtx.moveTo(peMaskLastPoint.x, peMaskLastPoint.y);
    peMaskCtx.lineTo(p.x, p.y);
    peMaskCtx.stroke();
    peMaskLastPoint = p;
    peRender();
  });

  const endStroke = e => {
    if (!peMaskDrawing) return;
    peMaskDrawing = false;
    peDirty = true;
    peCommitActiveMaskLayer();
    peScheduleSave();
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
}

// Writes #peMaskCanvas's current pixels back into the layer object it belongs to -
// called after every stroke/undo/fill/clear so peLocalLayers always reflects what's on
// screen, and again defensively in peCommit()/peRotateLocalLayers() before they read it.
function peCommitActiveMaskLayer() {
  const layer = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
  if (!layer || !peMaskCanvas) return;
  layer.maskDataUrl = peMaskCanvasHasContent ? peMaskCanvas.toDataURL('image/png') : null;
}

function peMaskSnapshotForUndo() {
  if (!peMaskCanvas) return;
  try {
    peMaskUndoStack.push(peMaskCanvas.toDataURL('image/png'));
    if (peMaskUndoStack.length > 15) peMaskUndoStack.shift();
  } catch (e) {}
}

function peMaskUndo() {
  if (!peMaskUndoStack.length || !peMaskCtx || !peMaskCanvas) return;
  const snap = peMaskUndoStack.pop();
  const img = new Image();
  img.onload = () => {
    peMaskCtx.clearRect(0, 0, peMaskCanvas.width, peMaskCanvas.height);
    peMaskCtx.drawImage(img, 0, 0);
    peMaskCanvasHasContent = true; // conservative: harmless even if the popped snapshot was itself empty
    peDirty = true;
    peCommitActiveMaskLayer();
    peRender();
    peScheduleSave();
  };
  img.src = snap;
}

function peMaskClearAll() {
  if (!peMaskCtx || !peMaskCanvas || !peMaskCanvasHasContent) return;
  peMaskSnapshotForUndo();
  peMaskCtx.clearRect(0, 0, peMaskCanvas.width, peMaskCanvas.height);
  peMaskCanvasHasContent = false;
  peDirty = true;
  peCommitActiveMaskLayer();
  peRender();
  peScheduleSave();
}

function peMaskFillAll() {
  if (!peMaskCtx || !peMaskCanvas) return;
  peMaskSnapshotForUndo();
  peMaskCtx.filter = 'none';
  peMaskCtx.globalCompositeOperation = 'source-over';
  peMaskCtx.fillStyle = '#ff2d55';
  peMaskCtx.fillRect(0, 0, peMaskCanvas.width, peMaskCanvas.height);
  peMaskCanvasHasContent = true;
  peDirty = true;
  peCommitActiveMaskLayer();
  peRender();
  peScheduleSave();
}

function peSetMaskSize(v) {
  peMaskSize = parseInt(v, 10) || 60;
  const val = document.getElementById('peMaskSizeVal');
  if (val) val.textContent = peMaskSize + 'px';
}

function peSetMaskFeather(v) {
  peMaskFeather = parseInt(v, 10) || 0;
  const val = document.getElementById('peMaskFeatherVal');
  if (val) val.textContent = peMaskFeather;
}

function peSetMaskTool(t) {
  peMaskTool = t;
  document.getElementById('peMaskToolBtn-add')?.classList.toggle('active', t === 'add');
  document.getElementById('peMaskToolBtn-subtract')?.classList.toggle('active', t === 'subtract');
}

// Swaps which layer's bitmap lives in the shared #peMaskCanvas, persisting the outgoing
// layer's paint into its own maskDataUrl/_maskCanvas cache first so nothing is lost.
function peSelectMaskLayer(id) {
  if (peEditingLayerId && peMaskCanvas) {
    const outgoing = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
    if (outgoing) {
      outgoing.maskDataUrl = peMaskCanvasHasContent ? peMaskCanvas.toDataURL('image/png') : null;
      outgoing._maskCanvas = peMaskCanvasHasContent ? peCopyCanvas(peMaskCanvas) : null;
    }
  }
  peEditingLayerId = id;
  peMaskUndoStack = [];
  peMaskCanvasHasContent = false;
  if (peMaskCtx && peMaskCanvas) peMaskCtx.clearRect(0, 0, peMaskCanvas.width, peMaskCanvas.height);
  const layer = (peLocalLayers || []).find(l => l.id === id);
  if (layer && layer._maskCanvas && peMaskCtx) {
    peMaskCtx.drawImage(layer._maskCanvas, 0, 0);
    peMaskCanvasHasContent = true;
  }
  // Simple mode reaches this from inside the Masks tab, so the tool is already right. PhotoMod
  // has no tabs: picking a mask is the gesture that says "I want to paint this one", and the
  // mask canvas only takes the pointer while the mask tool is live.
  if (peIsPro() && id && peTool !== 'mask') peSelectTool('mask');
  peRenderPanel();
  peSyncMaskCanvasVisibility();
  peRender();
}

function peAddMaskLayer() {
  peLocalLayers = peLocalLayers || [];
  const layer = peDefaultLocalLayer();
  layer.name = `Mask ${peLocalLayers.length + 1}`;
  peLocalLayers.push(layer);
  peSelectMaskLayer(layer.id);
  peDirty = true;
  peScheduleSave();
}

function peDeleteMaskLayer(id) {
  peLocalLayers = (peLocalLayers || []).filter(l => l.id !== id);
  if (peEditingLayerId === id) {
    peEditingLayerId = null;
    if (peMaskCtx && peMaskCanvas) peMaskCtx.clearRect(0, 0, peMaskCanvas.width, peMaskCanvas.height);
    peMaskCanvasHasContent = false;
    peMaskUndoStack = [];
  }
  peDirty = true;
  peRenderPanel();
  peSyncMaskCanvasVisibility();
  peRender();
  peScheduleSave();
}

function peToggleMaskLayerVisible(id) {
  const layer = (peLocalLayers || []).find(l => l.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  peDirty = true;
  peRenderPanel();
  peRender();
  peScheduleSave();
}

function peToggleMaskInvert() {
  const layer = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
  if (!layer) return;
  layer.invert = !layer.invert;
  peDirty = true;
  peRenderPanel();
  peRender();
  peScheduleSave();
}

// Purely a live-preview display preference, not part of file.edits - no save needed.
function peToggleMaskOverlay() {
  peMaskShowOverlay = !peMaskShowOverlay;
  peRenderPanel();
  peSyncMaskCanvasVisibility();
}

function peOnMaskAmountSlider(val) {
  const layer = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
  if (!layer) return;
  const n = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  layer.amount = n;
  peDirty = true;
  const readout = document.getElementById('peMaskAmountVal');
  const slider = document.getElementById('peMaskAmountSlider');
  if (readout) readout.textContent = n;
  if (slider) slider.value = n;
  peRender();
  peScheduleSave();
}

function peOnMaskAdjSlider(key, val) {
  const layer = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
  if (!layer) return;
  const n = parseInt(val, 10) || 0;
  layer.adjustments[key] = n;
  peDirty = true;
  const readout = document.getElementById('peMaskAdjVal-' + key);
  if (readout) readout.textContent = n;
  peRender();
  peScheduleSave();
}

function peResetMaskAdjustments() {
  const layer = (peLocalLayers || []).find(l => l.id === peEditingLayerId);
  if (!layer) return;
  layer.adjustments = peDefaultAdjustments();
  layer.amount = 100;
  peDirty = true;
  peRenderPanel();
  peRender();
  peScheduleSave();
}

// Keeps #peMaskCanvas's pointer-events (only active while painting) and visibility (the
// red-tinted overlay, only while the Masks tab is open and the user wants to see it) in sync
// with the current tab/selection/overlay-toggle state - called after anything that changes any of those.
function peSyncMaskCanvasVisibility() {
  const maskCanvas = document.getElementById('peMaskCanvas');
  if (!maskCanvas) return;
  const active = peTool === 'mask' && !!peEditingLayerId;
  maskCanvas.style.pointerEvents = active ? 'auto' : 'none';
  // #peMaskCanvas defaults to visibility:hidden in CSS, so showing it needs an explicit
  // 'visible' override here - '' would just fall through to that hidden default, unlike
  // #peDrawCanvas (no such base rule) where '' correctly means "visible".
  maskCanvas.style.visibility = (peTool === 'mask' && peMaskShowOverlay) ? 'visible' : 'hidden';
  const cursor = document.getElementById('peBrushCursor');
  if (cursor && !active) cursor.style.display = 'none';
}

// Merges the GL-adjusted image with the draw layer into one canvas - used wherever
// the final pixels are needed (cached thumbnail, Export), since the draw layer is
// a separate DOM element only composited visually (via CSS stacking) in the live editor.
// Flattens what's actually on screen - the WebGL photo, then brush strokes, then the layer
// stack on top - for the edited thumbnail and for Export. Returns the bare GL canvas when
// there's nothing stacked on it, so the common case copies nothing.
function peCompositeCanvas() {
  const glCanvas = document.getElementById('peCanvas');
  if (!peGl || !glCanvas.width) return null;
  const hasDrawing = peDrawHasContent && peDrawCanvas;
  const hasLayers = (peLayers || []).some(l => l.visible && l._bitmap) && peLayersCanvas;
  if (!hasDrawing && !hasLayers) return glCanvas;
  const out = document.createElement('canvas');
  out.width = glCanvas.width;
  out.height = glCanvas.height;
  const ctx = out.getContext('2d');
  // In blend-mode documents the overlay is already photo + strokes + layers (see
  // peCompositeLayers), so stacking the photo under it again would be wrong, not just wasteful.
  if (peLayersNeedBase()) {
    ctx.drawImage(peLayersCanvas, 0, 0);
    return out;
  }
  ctx.drawImage(glCanvas, 0, 0);
  if (hasDrawing) ctx.drawImage(peDrawCanvas, 0, 0);
  if (hasLayers) ctx.drawImage(peLayersCanvas, 0, 0);
  return out;
}

// One-time luminance histogram of the *original* decoded image, for the Tone tab's
// graph - strided rather than every pixel since a representative sample is plenty
// for a visual guide and this can be a 20+ megapixel canvas.
function peComputeHistogram(sourceCanvas) {
  try {
    const w = sourceCanvas.width, h = sourceCanvas.height;
    const targetSamples = 200000;
    const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / targetSamples)));
    const data = sourceCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    const hist = new Array(256).fill(0);
    const histR = new Array(256).fill(0), histG = new Array(256).fill(0), histB = new Array(256).fill(0);
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const idx = (y * w + x) * 4;
        const luma = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        hist[luma]++;
        histR[data[idx]]++; histG[data[idx + 1]]++; histB[data[idx + 2]]++;
      }
    }
    peHistogram = hist;
    peChannelHistograms = { r: histR, g: histG, b: histB };
  } catch (e) { peHistogram = null; peChannelHistograms = null; }
  peDrawCurve();
}

function peInitGL(sourceCanvas) {
  const canvas = document.getElementById('peCanvas');
  peSourceCanvas = sourceCanvas; // set up-front so callers have a valid canvas to size/sample even if WebGL init below bails out
  // preserveDrawingBuffer is required here: without it the browser is free to clear
  // the drawing buffer after each composite, so reading the canvas back later (for the
  // edited-thumbnail cache or Export, both of which happen well after the last render
  // call) can silently return a blank/black buffer instead of the rendered image.
  const glOpts = { preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) { toast('⚠️ WebGL is not available on this system'); return; }
  peGl = gl;

  // A photo whose longest edge is bigger than the GPU's own MAX_TEXTURE_SIZE
  // (hardware-dependent - commonly 4096 on older/integrated GPUs, up to 16384 on
  // modern ones) made texImage2D below fail silently: WebGL doesn't raise a JS
  // error for this, it just leaves the texture uninitialized, so the editor
  // showed a blank white canvas with nothing drawn and no visible error at all -
  // easy to hit with modern 40MP+ phone photos. Downscaling to fit is the same
  // tradeoff HEIC photos already accept (see EDIT_MAX_DIM in main.js); full-res
  // editing isn't possible on this hardware for a texture that large regardless.
  // A GPU process that crashed/restarted (or a software-rendering fallback) can report
  // a bogus, tiny MAX_TEXTURE_SIZE instead of throwing - treat anything under 512 as an
  // unreliable reading rather than a real hardware limit, so a bad query downscales to
  // a sane fallback size instead of collapsing the photo to a literal 1x1 canvas.
  const rawMaxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxSize = (Number.isFinite(rawMaxSize) && rawMaxSize >= 512) ? rawMaxSize : 4096;
  if (sourceCanvas.width > maxSize || sourceCanvas.height > maxSize) {
    const scale = maxSize / Math.max(sourceCanvas.width, sourceCanvas.height);
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.floor(sourceCanvas.width * scale));
    scaled.height = Math.max(1, Math.floor(sourceCanvas.height * scale));
    scaled.getContext('2d').drawImage(sourceCanvas, 0, 0, scaled.width, scaled.height);
    sourceCanvas = scaled;
    toast(`ℹ️ Downscaled to ${scaled.width}×${scaled.height} for editing - this GPU can't handle the photo's full resolution`);
  }
  peSourceCanvas = sourceCanvas; // full-res, EXIF-corrected, and now GPU-safe - used for histogram sampling and as the draw layer's pixel dimensions

  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;

  const vs = peCompileShader(gl, gl.VERTEX_SHADER, PE_VERTEX_SRC);
  const fs = peCompileShader(gl, gl.FRAGMENT_SHADER, PE_FRAGMENT_SRC);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Photo editor program link error:', gl.getProgramInfoLog(program));
    return;
  }
  peProgram = program;
  gl.useProgram(program);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  peTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, peTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

  peUniforms = {
    image: gl.getUniformLocation(program, 'u_image'),
    bypass: gl.getUniformLocation(program, 'u_bypass'),
    curveLUT: gl.getUniformLocation(program, 'u_curveLUT'),
    hsl: gl.getUniformLocation(program, 'u_hsl'),
    straighten: gl.getUniformLocation(program, 'u_straighten'),
    aspect: gl.getUniformLocation(program, 'u_aspect'),
    texel: gl.getUniformLocation(program, 'u_texel'),
    resScale: gl.getUniformLocation(program, 'u_resScale')
  };
  [...PE_ADJUSTMENTS, ...PE_EFFECTS].forEach(a => { peUniforms[a.key] = gl.getUniformLocation(program, 'u_' + a.key); });

  // Tone-curve LUT lives on a second texture unit so it doesn't disturb the main image
  // texture bound to unit 0 - built once here with the current (possibly neutral) curves,
  // then re-uploaded only when the user actually drags a curve point.
  peToneLUTTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, peToneLUTTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  peUpdateToneLUT();

  // Local-adjustment (mask) pass program - shares the same trivial full-screen-quad vertex
  // shader as the main program above. Compiled here (recreated on every peInitGL call, same
  // as peProgram just above - a rotate mid-session leaks the old program object the same way
  // the app already accepts for peProgram, not a new tradeoff introduced here) so it and its
  // uniform locations are ready before peRender() ever needs to run a local layer's pass.
  const maskFs = peCompileShader(gl, gl.FRAGMENT_SHADER, PE_MASK_FRAGMENT_SRC);
  const maskProgram = gl.createProgram();
  gl.attachShader(maskProgram, vs);
  gl.attachShader(maskProgram, maskFs);
  gl.linkProgram(maskProgram);
  if (gl.getProgramParameter(maskProgram, gl.LINK_STATUS)) {
    peMaskProgram = maskProgram;
    gl.useProgram(maskProgram);
    const maskPosLoc = gl.getAttribLocation(maskProgram, 'a_pos');
    gl.enableVertexAttribArray(maskPosLoc);
    gl.vertexAttribPointer(maskPosLoc, 2, gl.FLOAT, false, 0, 0); // posBuf is still the bound ARRAY_BUFFER from above
    peMaskUniforms = {
      prev: gl.getUniformLocation(maskProgram, 'u_prev'),
      mask: gl.getUniformLocation(maskProgram, 'u_mask'),
      amount: gl.getUniformLocation(maskProgram, 'u_amount'),
      invert: gl.getUniformLocation(maskProgram, 'u_invert')
    };
    PE_ADJUSTMENTS.forEach(a => { peMaskUniforms[a.key] = gl.getUniformLocation(maskProgram, 'u_' + a.key); });
  } else {
    console.error('Photo editor mask program link error:', gl.getProgramInfoLog(maskProgram));
    peMaskProgram = null;
  }
  gl.useProgram(program); // restore the main program as active, matching the state this function exited with before local layers existed
}

// Offscreen ping-pong render targets for local-mask passes - only ever created lazily (see
// peEnsureLocalFbo, called from peRender only when >=1 local layer is visible), so a user who
// never opens the Masks tab pays zero extra GPU memory/setup cost. Core WebGL1, no extensions.
function peCreateFboTarget(gl, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}

function peDeleteLocalFbo() {
  const gl = peGl;
  if (!gl || !peFbo) return;
  gl.deleteTexture(peFbo.tex[0]); gl.deleteTexture(peFbo.tex[1]);
  gl.deleteFramebuffer(peFbo.fb[0]); gl.deleteFramebuffer(peFbo.fb[1]);
  peFbo = null;
}

function peEnsureLocalFbo(width, height) {
  const gl = peGl;
  if (!gl) return;
  if (peFbo && peFbo.width === width && peFbo.height === height) return;
  peDeleteLocalFbo();
  const a = peCreateFboTarget(gl, width, height);
  const b = peCreateFboTarget(gl, width, height);
  peFbo = { tex: [a.tex, b.tex], fb: [a.fb, b.fb], width, height };
}

// Re-uploads a local layer's mask bitmap into one reusable GL texture, every render call -
// simple and correct (always reflects the latest brush stroke) rather than cached, which is
// fine given this only runs while >=1 mask layer is visible on a single still image (see the
// plan's perf note). Uploaded as ALPHA-only: the mask canvas is painted in a fixed visible
// color with the real mask data living in alpha, so gl.ALPHA extracts just the coverage,
// leaving the on-screen paint color free to be anything without skewing mask strength.
function peUploadMaskTexture(gl, source) {
  if (!peMaskGlTex) {
    peMaskGlTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, peMaskGlTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, peMaskGlTex);
  }
  // UNPACK_FLIP_Y_WEBGL is already true globally (set once in peInitGL for u_image and never
  // reset), so this canvas source gets the same flip as the main image - keeping u_mask and
  // u_image sampled with identical orientation at the same v_uv, matching what's on screen.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, gl.ALPHA, gl.UNSIGNED_BYTE, source);
}

// Returns whatever canvas currently holds a given local layer's mask bitmap, or null if it
// has no paint on it yet (an empty/never-painted layer is a no-op, not an error - peRender
// simply skips it). The actively-edited layer's live pixels live in the shared #peMaskCanvas
// itself; every other visible layer reads its own decoded _maskCanvas cache (see
// peInitMaskLayers/peSelectMaskLayer).
function peLayerMaskSource(layer) {
  if (!layer) return null;
  if (layer.id === peEditingLayerId) return peMaskCanvasHasContent ? peMaskCanvas : null;
  return layer._maskCanvas || null;
}

function peRender() {
  const gl = peGl;
  if (!gl || !peProgram) return;
  const canvas = document.getElementById('peCanvas');
  // Hold-to-compare bypasses local layers too, showing the true original - not just the
  // globally-bypassed-but-still-locally-adjusted image.
  const visibleLayers = peBypass ? [] : (peLocalLayers || []).filter(l => l.visible && peLayerMaskSource(l));
  if (visibleLayers.length) peEnsureLocalFbo(canvas.width, canvas.height);

  gl.bindFramebuffer(gl.FRAMEBUFFER, visibleLayers.length ? peFbo.fb[0] : null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(peProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, peTexture);
  gl.uniform1i(peUniforms.image, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, peToneLUTTex);
  gl.uniform1i(peUniforms.curveLUT, 1);
  gl.uniform1i(peUniforms.bypass, peBypass ? 1 : 0);
  [...PE_ADJUSTMENTS, ...PE_EFFECTS].forEach(a => { gl.uniform1f(peUniforms[a.key], (peAdjustments[a.key] || 0) / 100); });
  const hslFlat = new Float32Array(24);
  PE_HSL_BANDS.forEach((b, i) => {
    const v = (peHsl && peHsl[b.key]) || { h:0, s:0, l:0 };
    hslFlat[i*3] = (v.h || 0) / 100; hslFlat[i*3+1] = (v.s || 0) / 100; hslFlat[i*3+2] = (v.l || 0) / 100;
  });
  gl.uniform3fv(peUniforms.hsl, hslFlat);
  gl.uniform1f(peUniforms.straighten, peStraighten || 0);
  gl.uniform1f(peUniforms.aspect, canvas.height ? canvas.width / canvas.height : 1);
  // The canvas is always the source's own size (see peInitGL), so one canvas pixel is one source pixel.
  gl.uniform2f(peUniforms.texel, 1 / (canvas.width || 1), 1 / (canvas.height || 1));
  gl.uniform1f(peUniforms.resScale, Math.max(canvas.width, canvas.height) / 2000);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (!visibleLayers.length || !peMaskProgram) return;

  // Passes B..N: one per visible local layer, ping-ponging between the two FBO textures -
  // each reads the previous pass's composite plus this layer's own mask, and the last layer
  // writes straight to the canvas (gl.FRAMEBUFFER null), so no separate final blit is needed.
  gl.useProgram(peMaskProgram);
  let readIdx = 0;
  visibleLayers.forEach((layer, i) => {
    const isLast = i === visibleLayers.length - 1;
    const writeIdx = readIdx === 0 ? 1 : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, isLast ? null : peFbo.fb[writeIdx]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, peFbo.tex[readIdx]);
    gl.uniform1i(peMaskUniforms.prev, 0);
    gl.activeTexture(gl.TEXTURE1);
    peUploadMaskTexture(gl, peLayerMaskSource(layer));
    gl.uniform1i(peMaskUniforms.mask, 1);
    PE_ADJUSTMENTS.forEach(a => gl.uniform1f(peMaskUniforms[a.key], (layer.adjustments[a.key] || 0) / 100));
    gl.uniform1f(peMaskUniforms.amount, (Number.isFinite(layer.amount) ? layer.amount : 100) / 100);
    gl.uniform1i(peMaskUniforms.invert, layer.invert ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    readIdx = writeIdx;
  });
  gl.activeTexture(gl.TEXTURE0); // leave texture unit 0 active, matching the state this function exited with before local layers existed
  // The overlay holds a copy of the photo whenever a layer blends against it, so a change to
  // the photo has to be re-flattened into it. Only documents using a blend mode pay for this.
  if (peLayersNeedBase()) peCompositeLayers();
}

// Master curve is applied first, then each channel's own curve is applied to the
// master's output - so u_curveLUT's R/G/B texels already encode the full composed
// mapping and the fragment shader's per-channel lookup (unchanged) just works.
function peBuildCurveLUT(curves) {
  const master = peMonotoneCubicSample(curves.master);
  const rCurve = peMonotoneCubicSample(curves.r);
  const gCurve = peMonotoneCubicSample(curves.g);
  const bCurve = peMonotoneCubicSample(curves.b);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const m = Math.min(255, Math.max(0, Math.round(master[i])));
    lut[i*4]   = Math.round(rCurve[m]);
    lut[i*4+1] = Math.round(gCurve[m]);
    lut[i*4+2] = Math.round(bCurve[m]);
    lut[i*4+3] = 255;
  }
  return lut;
}

function peUpdateToneLUT() {
  if (!peGl || !peToneLUTTex || !peCurves) return;
  const lut = peBuildCurveLUT(peCurves);
  peGl.activeTexture(peGl.TEXTURE1);
  peGl.bindTexture(peGl.TEXTURE_2D, peToneLUTTex);
  peGl.texImage2D(peGl.TEXTURE_2D, 0, peGl.RGBA, 256, 1, 0, peGl.RGBA, peGl.UNSIGNED_BYTE, lut);
  peGl.activeTexture(peGl.TEXTURE0);
}

// min/max default to the -100..100 range every adjustment slider uses; the layer panel's
// opacity/scale rows pass their own.
function peSliderRow(label, val, sliderId, valId, onInput, onReset, min, max) {
  const lo = Number.isFinite(min) ? min : -100;
  const hi = Number.isFinite(max) ? max : 100;
  return `
    <div class="pe-slider-row">
      <div class="pe-slider-head">
        <span>${label}</span>
        <span><span class="pe-slider-val" id="${valId}">${val}</span> <span class="pe-slider-reset" onclick="${onReset}">reset</span></span>
      </div>
      <input type="range" min="${lo}" max="${hi}" value="${val}" id="${sliderId}" oninput="${onInput}"/>
    </div>`;
}

// The panel column is built from the same set of section builders in both modes - what differs
// is where they end up. Simple mode stacks them into its four tabs; PhotoMod shows only the
// active tool's options here and moves the tonal controls into the Adjustments panel.
function peRenderPanel() {
  const panel = document.getElementById('pePanel');
  const parts = peBuildPanelSections();
  if (peIsPro()) {
    // Layer properties sit above the tool options: they belong to the layer you picked, not to
    // whatever tool happens to be in your hand.
    panel.innerHTML = pmLayerPropsHtml() + pmToolOptionsHtml(parts);
    pmRenderMenubar();
    if (document.getElementById('pmAdjustPanel')?.classList.contains('open')) pmRenderAdjustPanel(parts);
  } else {
    panel.innerHTML = `
    <div class="pe-tabs">
      <button class="pe-tab${peActiveTab==='colors'?' active':''}" id="peTabBtn-colors" onclick="peSwitchTab('colors')">Colors</button>
      <button class="pe-tab${peActiveTab==='rotate'?' active':''}" id="peTabBtn-rotate" onclick="peSwitchTab('rotate')">Direction</button>
      <button class="pe-tab${peActiveTab==='draw'?' active':''}" id="peTabBtn-draw" onclick="peSwitchTab('draw')">Brush</button>
      <button class="pe-tab${peActiveTab==='masks'?' active':''}" id="peTabBtn-masks" onclick="peSwitchTab('masks')">Masks</button>
    </div>
    <div class="pe-tab-content" id="peTabColors" style="display:${peActiveTab==='colors'?'':'none'}">${parts.text}${parts.colors}</div>
    <div class="pe-tab-content" id="peTabRotate" style="display:${peActiveTab==='rotate'?'':'none'}">${parts.rotate}</div>
    <div class="pe-tab-content" id="peTabDraw" style="display:${peActiveTab==='draw'?'':'none'}">${parts.draw}</div>
    <div class="pe-tab-content" id="peTabMasks" style="display:${peActiveTab==='masks'?'':'none'}">${parts.masks}</div>`;
  }
  peSetupCurveDrag();
  peDrawCurve();
  peSyncMaskCanvasVisibility();
}

// PhotoMod's right column: the options for whatever tool is in hand, and nothing else. This is
// what replaced the Colors/Direction/Brush/Masks tab row - those controls didn't go away, they
// moved to where a Photoshop user looks for them (tool options here, Image > Adjustments for
// the tonal ones, Image > Canvas/Image Size for the document).
function pmToolOptionsHtml(parts) {
  const head = (icon, title, hint) =>
    `<div class="pm-tool-head"><span class="pm-tool-icon">${icon}</span>${title}</div><div class="pm-tool-hint">${hint}</div>`;
  const doc = peSourceCanvas ? `<div class="pm-doc-meta">
      <strong>${peSourceCanvas.width} × ${peSourceCanvas.height}</strong> px<br/>
      ${(peLayers || []).length} layer${(peLayers || []).length === 1 ? '' : 's'}${peSelection ? ` · selection ${peSelection.invert ? '(inverted)' : 'active'}` : ''}
    </div>` : '';
  let body = '';
  if (peTool === 'transform' || peTool === 'warp') {
    const isTf = peTool === 'transform';
    const mode = PM_TF_MODES.find(m => m[0] === pmTfMode) || PM_TF_MODES[0];
    body = head(isTf ? mode[1] : peIcon('warp'), isTf ? 'Transform' : 'Warp',
      isTf ? `${mode[3]} Drag the round knob to rotate, and hold Shift to flip the proportion lock. Right-click the canvas to change mode.`
           : 'Drag any grid point to push the picture around. The mesh bends smoothly between the points you move.')
      + (isTf ? `<div class="pm-mode-list">${PM_TF_MODES.map(([key, icon, label]) =>
            `<button class="pe-draw-action-btn${pmTfMode === key ? ' active' : ''}" onclick="pmSetTfMode('${key}')">${icon} ${label}</button>`).join('')}
          <button class="pe-draw-action-btn" onclick="pmSetTfMode('warp')">${peIcon('warp')} Warp</button>
        </div>` : '')
      + `<div class="pm-btn-grid">
          <button class="pe-draw-action-btn" onclick="pmApplyLiveMesh()">${peIcon('check')} Apply</button>
          <button class="pe-draw-action-btn" onclick="pmCancelLiveMesh()">${peIcon('close')} Cancel</button>
        </div>
        <button class="pe-draw-action-btn" style="width:100%" onclick="pmResetLiveMesh()">${peIcon('reset')} Reset shape</button>`;
  } else if (PE_SELECT_TOOLS.includes(peTool)) {
    const label = peTool === 'marquee' ? 'Rectangular select' : peTool === 'ellipse' ? 'Elliptical select'
      : peTool === 'autosel' ? 'Auto select' : 'Polygon lasso';
    body = head(peIcon(peTool), label, peTool === 'lasso'
      ? 'Click once for each corner of the outline. Click the yellow first point, double-click, or press Enter to close it. Backspace takes back the last point, Escape starts over.'
      : peTool === 'autosel' ? pmAutoSelectHint()
      : 'Drag out a shape. Hold Shift while dragging to keep it square or circular.')
      + (peTool === 'autosel' ? pmAutoSelectOptionsHtml() : '')
      + `<div class="pm-btn-grid">
          <button class="pe-draw-action-btn" onclick="pmSelectAll()">Select all</button>
          <button class="pe-draw-action-btn" ${peSelection ? '' : 'disabled'} onclick="peClearSelection()">Deselect</button>
          <button class="pe-draw-action-btn" ${peSelection ? '' : 'disabled'} onclick="pmInvertSelection()">${peIcon('invert')} Inverse</button>
          <button class="pe-draw-action-btn" ${peSelection ? '' : 'disabled'} onclick="pmFillSelection()">${peIcon('bucket')} Fill</button>
          <button class="pe-draw-action-btn" ${peSelection ? '' : 'disabled'} onclick="peSelectionToNewLayer(false)">${peIcon('copy')} Copy</button>
          <button class="pe-draw-action-btn" ${peSelection ? '' : 'disabled'} onclick="peSelectionToNewLayer(true)">${peIcon('cut')} Cut</button>
        </div>
        <button class="pe-draw-action-btn" style="width:100%" ${peSelection ? '' : 'disabled'} onclick="peDeleteSelection()">${peIcon('eraser')} Erase selection</button>
        <button class="pe-draw-action-btn" style="width:100%;margin-top:6px" ${peSelection && !pmHealBusy ? '' : 'disabled'} onclick="pmHealSelection()" title="Make whatever is inside the selection disappear, filled in from its surroundings">${peIcon('heal')} Remove object</button>
        <div class="pe-draw-color-row" style="margin-top:10px">Fill colour <input type="color" value="${peDrawColor}" oninput="peSetDrawColor(this.value)"/></div>`;
  } else if (peTool === 'brush') {
    body = head(pePaintToolIcon(), pePaintToolLabel(), 'Click the arrow on the rail to switch between brush, highlighter and bucket - or press B to cycle them.') + parts.draw;
  } else if (peTool === 'mask') {
    body = parts.masks;
  } else if (peTool === 'heal') {
    body = head(peIcon('heal'), 'Smart eraser', 'Paint over the thing you want gone - a person, a sign, a stray bin - and let go. It is filled in from what surrounds it. Cover the whole object, shadow included, with a little margin.')
      + `<div class="pe-slider-row">
          <div class="pe-slider-head"><span>Brush size</span><span class="pe-slider-val" id="pmHealSizeVal">${pmHealSize}px</span></div>
          <input type="range" min="4" max="200" value="${pmHealSize}" oninput="pmSetHealSize(this.value)"/>
        </div>
        <button class="pe-draw-action-btn" style="width:100%" ${peSelection && !pmHealBusy ? '' : 'disabled'} onclick="pmHealSelection()">${peIcon('heal')} Remove what's selected</button>
        <div class="pm-tool-hint" id="pmHealStatus" style="margin-top:10px">${pmHealBusy ? 'Filling in…' : 'The fill lands on its own "Object removal" layer, so the photo underneath is untouched: hide or delete that layer to bring the object back, or press Ctrl+Z.'}</div>`;
  } else if (peTool === 'dropper') {
    body = head(peIcon('dropper'), 'Eyedropper', 'Click anywhere on the canvas to take that colour. It becomes the brush and fill colour.')
      + `<div class="pe-draw-color-row">Current <input type="color" value="${peDrawColor}" oninput="peSetDrawColor(this.value)"/></div>`;
  } else {
    body = head(peIcon('move'), 'Move', 'Drag a layer to reposition it. Pick a layer below, or click it on the canvas.')
      + (parts.text || '<div class="pe-layer-empty">Paste an image with Ctrl+V, or press T for text, to add a layer.</div>');
  }
  return body + doc;
}

function pmRenderAdjustPanel(parts) {
  const body = document.getElementById('pmAdjustBody');
  if (!body) return;
  // A stale target - the layer was deleted while its colours were open - silently falls back
  // to the photo rather than throwing on every slider.
  if (pmColorTarget && !pmColorTargetLayer()) pmColorTarget = null;
  const layer = pmColorTargetLayer();
  const p = parts || peBuildPanelSections();
  // Who these sliders are pointed at is the first thing the panel says, because the controls
  // are identical either way and getting it wrong is silent.
  const target = `
    <div class="pm-target-row">
      <button class="pe-draw-action-btn${layer ? '' : ' active'}" onclick="pmColorTargetBase()">${peIcon('image')} Photo</button>
      ${layer ? `<button class="pe-draw-action-btn active" title="Editing this layer's own colours">${peIcon('layer')} ${esc(layer.name)}</button>` : ''}
      <button class="pe-draw-action-btn" title="${layer ? "Clear this layer's colour adjustments" : 'Reset the whole photo'}" onclick="pmResetLayerColours()">${peIcon('reset')}</button>
    </div>`;
  // Straighten belongs to the document, so it's only offered when the photo is the target.
  body.innerHTML = target + p.colors + (layer ? '' : p.rotate);
  peSetupCurveDrag();
  peDrawCurve();
}

function peBuildPanelSections() {

  // A pasted layer's colours only get the per-pixel sliders - see PE_EFFECTS for why.
  const lightKeys = pmColorTargetLayer() ? PE_ADJUSTMENTS : [...PE_ADJUSTMENTS, ...PE_EFFECTS];
  const lightHtml = lightKeys.map(a => peSliderRow(
    a.label, pmColorState().adjustments[a.key] || 0, `peSlider-${a.key}`, `peVal-${a.key}`,
    `peOnSlider('${a.key}', this.value)`, `peResetOne('${a.key}')`, a.min
  )).join('');

  const curveChips = PE_CURVE_CHANNELS.map(c => `<button class="pe-curve-chip${c.key===peActiveCurveChannel?' active':''}" style="--chip-color:${c.color}" title="${c.label}" onclick="peSelectCurveChannel('${c.key}')">${c.label}</button>`).join('');
  const toneHtml = `
    <div class="pe-tone-head"><span>Curve</span><span class="pe-slider-reset" onclick="peResetCurve()">reset</span></div>
    <div class="pe-curve-chips">${curveChips}</div>
    <canvas id="peCurveCanvas" width="252" height="220"></canvas>
    <div class="pe-tone-hint">Drag the line to bend it - it adds a point where you grab. Drag a point to reshape, double-click a point to remove it.</div>`;

  const activeBand = PE_HSL_BANDS.find(b => b.key === peActiveHslBand) || PE_HSL_BANDS[0];
  const bandVals = pmColorState().hsl[activeBand.key];
  const hslChips = PE_HSL_BANDS.map(b => `<button class="pe-hsl-swatch${b.key===peActiveHslBand?' active':''}" style="background:${b.swatch}" title="${b.label}" onclick="peSelectHslBand('${b.key}')"></button>`).join('');
  const hslSliders = [['h','Hue'],['s','Saturation'],['l','Luminance']].map(([p,label]) => peSliderRow(
    label, bandVals[p], `peHslSlider-${p}`, `peHslVal-${p}`,
    `peOnHslSlider('${p}', this.value)`, `peOnHslSlider('${p}', 0)`
  )).join('');
  const colorHtml = `
    <div class="pe-tone-head"><span>Color</span><span class="pe-slider-reset" onclick="peResetColor()">reset all</span></div>
    <div class="pe-hsl-row">${hslChips}</div>
    <div class="pe-hsl-band-label">${activeBand.label}</div>
    ${hslSliders}`;

  const file = appData.files.find(f => f.id === peFileId);
  const rotateHtml = `
    <div class="pe-tone-head"><span>Direction</span><span class="pe-slider-reset" onclick="peResetStraighten()">reset tilt</span></div>
    <div class="pe-rotate-90-row">
      <button class="pe-rotate-btn" title="Rotate left 90°" onclick="peRotate90(-90)">${peIcon('reset')} Left</button>
      <button class="pe-rotate-btn" title="Rotate right 90°" onclick="peRotate90(90)">${peIcon('rotateRight')} Right</button>
    </div>
    <div class="pe-rotate-current">Current: ${file?.rotation || 0}°</div>
    <div class="pe-slider-row" style="margin-top:18px">
      <div class="pe-slider-head">
        <span>Tilt</span>
        <span class="pe-slider-val" id="peStraightenVal">${peStraighten.toFixed(1)}°</span>
      </div>
      <input type="range" min="-45" max="45" step="0.1" value="${peStraighten}" id="peStraightenSlider" oninput="peOnStraighten(this.value)"/>
    </div>
    <div class="pe-tone-hint">Left/Right fixes a photo taken sideways or upside down; Tilt fine-tunes a crooked horizon and auto-crops in so no empty corners show. Perspective (keystone) correction is not here yet.</div>`;

  const isBucket = peDrawTool === 'bucket';
  const drawHtml = `
    <div class="pe-tone-head"><span>${isBucket ? 'Fill' : 'Draw'}</span><span class="pe-slider-reset" onclick="peDrawClearAll()">clear</span></div>
    <div class="pe-draw-hint">${isBucket
      ? 'Click an area to flood it with the current colour. Tolerance decides how different a neighbouring pixel may be and still count as the same area.'
      : peDrawTool === 'highlighter'
      ? 'A translucent marker - it tints what is underneath instead of covering it, and one stroke stays an even tone however much it crosses itself.'
      : 'Paint over small details to hide them - drag on the photo to draw.'}</div>
    <div class="pe-draw-color-row">Color <input type="color" id="peDrawColorInput" value="${peDrawColor}" oninput="peSetDrawColor(this.value)"/></div>
    ${isBucket ? `
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Tolerance</span><span class="pe-slider-val" id="peBucketTolVal">${peBucketTolerance}</span></div>
      <input type="range" min="0" max="160" value="${peBucketTolerance}" oninput="peSetBucketTolerance(this.value)"/>
    </div>` : `
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>${peDrawTool === 'highlighter' ? 'Marker width' : 'Brush size'}</span><span class="pe-slider-val" id="peDrawSizeVal">${peDrawSize}px</span></div>
      <input type="range" min="2" max="150" value="${peDrawSize}" id="peDrawSizeInput" oninput="peSetDrawSize(this.value)"/>
    </div>`}
    <div class="pe-draw-tools pe-draw-tools-wrap">
      ${PE_PAINT_TOOLS.map(([key, icon, label]) =>
        `<button class="pe-draw-tool-btn${peDrawTool===key?' active':''}" id="peToolBtn-${key}" onclick="pePickPaintTool('${key}')">${icon} ${label}</button>`).join('')}
      <button class="pe-draw-tool-btn${peDrawTool==='eraser'?' active':''}" id="peToolBtn-eraser" onclick="peSetDrawTool('eraser')">${peIcon('eraser')} Eraser</button>
    </div>
    <div class="pe-draw-actions">
      <button class="pe-draw-action-btn" onclick="peDrawUndo()">${peIcon('undo')} Undo stroke</button>
      <button class="pe-draw-action-btn" onclick="peDrawClearAll()">${peIcon('trash')} Clear drawing</button>
    </div>`;

  const localLayers = peLocalLayers || [];
  const maskLayerRows = localLayers.map(l => `
    <div class="pe-mask-layer-row${l.id===peEditingLayerId?' active':''}" onclick="peSelectMaskLayer('${l.id}')">
      <span class="pe-mask-layer-thumb">${l.maskDataUrl ? `<img src="${l.maskDataUrl}"/>` : ''}</span>
      <span class="pe-mask-layer-name">${esc(l.name)}</span>
      <input type="checkbox" title="Visible" ${l.visible?'checked':''} onclick="event.stopPropagation();peToggleMaskLayerVisible('${l.id}')"/>
      <button class="pe-mask-layer-del" title="Delete mask" onclick="event.stopPropagation();peDeleteMaskLayer('${l.id}')">${peIcon('close')}</button>
    </div>`).join('');
  const editingLayer = localLayers.find(l => l.id === peEditingLayerId);
  const maskEditorHtml = editingLayer ? `
    <div class="pe-tone-head" style="margin-top:16px"><span>Brush</span><span class="pe-slider-reset" onclick="peMaskClearAll()">clear</span></div>
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Brush size</span><span class="pe-slider-val" id="peMaskSizeVal">${peMaskSize}px</span></div>
      <input type="range" min="4" max="300" value="${peMaskSize}" id="peMaskSizeInput" oninput="peSetMaskSize(this.value)"/>
    </div>
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Feather</span><span class="pe-slider-val" id="peMaskFeatherVal">${peMaskFeather}</span></div>
      <input type="range" min="0" max="100" value="${peMaskFeather}" id="peMaskFeatherInput" oninput="peSetMaskFeather(this.value)"/>
    </div>
    <div class="pe-draw-tools">
      <button class="pe-draw-tool-btn${peMaskTool==='add'?' active':''}" id="peMaskToolBtn-add" onclick="peSetMaskTool('add')">${peIcon('plus')} Add</button>
      <button class="pe-draw-tool-btn${peMaskTool==='subtract'?' active':''}" id="peMaskToolBtn-subtract" onclick="peSetMaskTool('subtract')">${peIcon('minus')} Subtract</button>
    </div>
    <div class="pe-draw-actions">
      <button class="pe-draw-action-btn" onclick="peMaskUndo()">${peIcon('undo')} Undo stroke</button>
      <button class="pe-draw-action-btn" onclick="peMaskFillAll()">${peIcon('bucket')} Fill all</button>
    </div>
    <div class="pe-draw-actions" style="margin-top:6px">
      <button class="pe-draw-action-btn${editingLayer.invert?' active':''}" onclick="peToggleMaskInvert()">Invert ${editingLayer.invert?'on':'off'}</button>
      <button class="pe-draw-action-btn${peMaskShowOverlay?' active':''}" onclick="peToggleMaskOverlay()">Overlay ${peMaskShowOverlay?'on':'off'}</button>
    </div>
    <div class="pe-tone-head" style="margin-top:18px"><span>Local adjustments</span><span class="pe-slider-reset" onclick="peResetMaskAdjustments()">reset</span></div>
    ${peSliderRow('Amount', editingLayer.amount, 'peMaskAmountSlider', 'peMaskAmountVal', `peOnMaskAmountSlider(this.value)`, `peOnMaskAmountSlider(100)`)}
    ${PE_ADJUSTMENTS.map(a => peSliderRow(
      a.label, editingLayer.adjustments[a.key], `peMaskAdjSlider-${a.key}`, `peMaskAdjVal-${a.key}`,
      `peOnMaskAdjSlider('${a.key}', this.value)`, `peOnMaskAdjSlider('${a.key}', 0)`
    )).join('')}
    <div class="pe-tone-hint">Drag on the photo to paint this mask. Only the painted area is affected by the sliders above.</div>
  ` : `<div class="pe-tone-hint" style="margin-top:12px">Select a mask above, or add a new one, then paint on the photo to choose the area it affects.</div>`;
  const masksHtml = `
    <div class="pe-tone-head"><span>Masks</span><button class="pe-mask-add-btn" onclick="peAddMaskLayer()">+ New Mask</button></div>
    <div class="pe-mask-layer-list">${maskLayerRows || '<div class="pe-tone-hint">No masks yet - add one to edit part of the photo only.</div>'}</div>
    ${maskEditorHtml}`;

  // Light, Curve and HSL used to be three sibling tabs; they're one "Colors" tab now (every
  // tonal/colour control in one place, Lightroom-style), split into collapsible sections so
  // the column stays scannable rather than becoming one endless slider run.
  const section = (key, title, body) => `
    <button class="pe-section-head${peColorSections[key] ? '' : ' collapsed'}" onclick="peToggleColorSection('${key}')">
      <span class="pe-section-chevron">▼</span>${title}
    </button>
    <div class="pe-section-body" style="display:${peColorSections[key] ? '' : 'none'}">${body}</div>`;
  const colorsHtml = `
    ${section('light', 'Light', lightHtml)}
    ${section('curve', 'Curve', toneHtml)}
    ${section('hsl', 'Color mix', colorHtml)}`;

  // A text layer's spec is edited here rather than in the Layers panel - it needs the room, and
  // it is the "tool options" for the text tool in the same way the brush settings are.
  const textLayer = peIsPro() ? (peLayers || []).find(l => l.id === peActiveLayerId && l.text) : null;
  const textHtml = textLayer ? `
    <div class="pe-tone-head" style="margin-top:14px"><span>Text</span></div>
    <textarea class="pe-text-input" oninput="peUpdateTextLayer('content', this.value)" onchange="peUpdateTextLayer('content', this.value, true)">${esc(textLayer.text.content)}</textarea>
    <div class="pe-text-row">Font
      <select onchange="peUpdateTextLayer('font', this.value, true)">
        ${pmInstalledFonts().map(([group, entries]) => `<optgroup label="${esc(group)}">${
          entries.map(([v, label]) => `<option value="${esc(v)}" style="font-family:${esc(v)}"${textLayer.text.font === v ? ' selected' : ''}>${esc(label)}</option>`).join('')
        }</optgroup>`).join('')}
      </select>
      <input type="color" value="${textLayer.text.color}" title="Text colour" oninput="peUpdateTextLayer('color', this.value)" onchange="peUpdateTextLayer('color', this.value, true)"/>
    </div>
    <div class="pe-text-row">
      <button class="pe-draw-action-btn${textLayer.text.bold ? ' active' : ''}" onclick="peUpdateTextLayer('bold', ${!textLayer.text.bold}, true)"><strong>B</strong></button>
      <button class="pe-draw-action-btn${textLayer.text.italic ? ' active' : ''}" onclick="peUpdateTextLayer('italic', ${!textLayer.text.italic}, true)"><em>I</em></button>
    </div>
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Size</span><span class="pe-slider-val">${peTextPixelSize(textLayer.text)}px</span></div>
      <input type="range" min="10" max="${Math.max(400, Math.round((peSourceCanvas?.height || 1200) * 0.4))}" value="${peTextPixelSize(textLayer.text)}"
             oninput="peUpdateTextLayer('size', this.value)" onchange="peUpdateTextLayer('size', this.value, true)"/>
    </div>
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Curve</span><span class="pe-slider-val">${textLayer.text.curve || 0}</span><span class="pe-slider-reset" onclick="peUpdateTextLayer('curve', 0, true)">reset</span></div>
      <input type="range" min="-100" max="100" value="${textLayer.text.curve || 0}"
             oninput="peUpdateTextLayer('curve', this.value)" onchange="peUpdateTextLayer('curve', this.value, true)"/>
    </div>
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Letter spacing</span><span class="pe-slider-val">${Math.round(textLayer.text.tracking || 0)}px</span></div>
      <input type="range" min="-20" max="80" value="${Math.round(textLayer.text.tracking || 0)}"
             oninput="peUpdateTextLayer('tracking', this.value)" onchange="peUpdateTextLayer('tracking', this.value, true)"/>
    </div>
    <div class="pe-slider-row">
      <div class="pe-slider-head"><span>Outline</span><span class="pe-slider-val">${Math.round(textLayer.text.strokeWidth || 0)}px</span></div>
      <input type="range" min="0" max="40" value="${Math.round(textLayer.text.strokeWidth || 0)}"
             oninput="peUpdateTextLayer('strokeWidth', this.value)" onchange="peUpdateTextLayer('strokeWidth', this.value, true)"/>
    </div>
    <div class="pe-text-row">Outline colour
      <input type="color" value="${textLayer.text.strokeColor || '#000000'}" oninput="peUpdateTextLayer('strokeColor', this.value)" onchange="peUpdateTextLayer('strokeColor', this.value, true)"/>
    </div>` : '';

  return { light: lightHtml, colors: colorsHtml, rotate: rotateHtml, draw: drawHtml, masks: masksHtml, text: textHtml };
}

function peToggleColorSection(key) {
  peColorSections[key] = !peColorSections[key];
  peRenderPanel();
}

// Switching tab also switches tool, so the rail and the panel always agree about what a drag
// on the stage will do (peSelectTool drives it the other way round).
function peSwitchTab(tab) {
  peActiveTab = tab;
  ['colors','rotate','draw','masks'].forEach(t => {
    document.getElementById('peTabBtn-'+t)?.classList.toggle('active', t === tab);
    const content = document.getElementById('peTab'+t[0].toUpperCase()+t.slice(1));
    if (content) content.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'colors') peDrawCurve();
  // Brush/Mask are tied to their tabs, but a selection tool is a mode the user is working in -
  // glancing at Colors mid-selection shouldn't silently drop them out of the marquee.
  peTool = tab === 'draw' ? 'brush' : tab === 'masks' ? 'mask'
    : (PE_SELECT_TOOLS.includes(peTool) ? peTool : (peIsPro() ? 'move' : 'none'));
  peSyncToolCanvases();
  peRenderToolRail();
}

function peOnSlider(key, val) {
  const n = parseInt(val, 10) || 0;
  pmColorState().adjustments[key] = n;
  peDirty = true;
  const readout = document.getElementById('peVal-' + key);
  if (readout) readout.textContent = n;
  pmColorRepaint();
  peScheduleSave();
}

function peResetOne(key) {
  pmColorState().adjustments[key] = 0;
  const slider = document.getElementById('peSlider-' + key);
  const readout = document.getElementById('peVal-' + key);
  if (slider) slider.value = 0;
  if (readout) readout.textContent = 0;
  peDirty = true;
  pmColorRepaint();
  peScheduleSave();
}

function peResetAll() {
  peAdjustments = peDefaultAdjustments();
  peCurves = peDefaultCurves();
  peHsl = peDefaultHsl();
  peStraighten = 0;
  peUpdateToneLUT();
  if (peDrawHasContent && peDrawCtx && peDrawCanvas) {
    peDrawSnapshotForUndo();
    peDrawCtx.clearRect(0, 0, peDrawCanvas.width, peDrawCanvas.height);
    peDrawHasContent = false;
  }
  peLocalLayers = [];
  peEditingLayerId = null;
  peMaskUndoStack = [];
  peMaskCanvasHasContent = false;
  if (peMaskCtx && peMaskCanvas) peMaskCtx.clearRect(0, 0, peMaskCanvas.width, peMaskCanvas.height);
  peLayers = [];
  peActiveLayerId = null;
  peClearSelection();
  peCompositeLayers();
  peRenderLayersPanel();
  pePushHistory('reset all'); // undoable like any other action, rather than a one-way door
  const file = appData.files.find(f => f.id === peFileId);
  if (file?.rotation) {
    file.rotation = 0;
    delete thumbCache[file.id]; delete previewCache[file.id]; delete hiresCache[file.id];
    peApplyRotationAndInit(); // rebuild from the raw canvas at 0° - draw layer and local masks were already cleared above, nothing left to rotate along with them
  }
  peRenderPanel();
  peDirty = true;
  peRender();
  peScheduleSave();
}

// ── Rotate / Straighten ──────────────────────────────────────────────────────
// The 90° steps live on file.rotation (shared with thumbnails/grid/popup everywhere
// else in the app - see rotateFile()); the fine-angle slider is editor-only, baked
// into the GL shader itself (see u_straighten) so dragging it stays fully live.
function peRotate90(delta) {
  // In PhotoMod rotation turns the document's own pixels rather than setting file.rotation on
  // the library entry - the whole point of pro mode is that nothing reaches the library until
  // you save. Same button, mode-appropriate meaning.
  if (peIsPro()) { pmRotateDocument(delta); return; }
  const file = appData.files.find(f => f.id === peFileId);
  if (!file || !peRawCanvas) return;
  bumpRotation(file, delta);
  peDirty = true;
  peApplyRotationAndInit(delta);
  peRenderPanel(); // refreshes the "Current: X°" readout
  peScheduleSave();
}

function peOnStraighten(val) {
  peStraighten = Math.max(-45, Math.min(45, parseFloat(val) || 0));
  peDirty = true;
  const readout = document.getElementById('peStraightenVal');
  if (readout) readout.textContent = peStraighten.toFixed(1) + '°';
  peRender();
  peScheduleSave();
}

function peResetStraighten() {
  peStraighten = 0;
  const slider = document.getElementById('peStraightenSlider');
  const readout = document.getElementById('peStraightenVal');
  if (slider) slider.value = 0;
  if (readout) readout.textContent = '0.0°';
  peDirty = true;
  peRender();
  peScheduleSave();
}

// ── Tone curve (Master + per-channel, Photoshop/Lightroom-style) ───────────────
const PE_CURVE_CHANNELS = [
  { key:'master', label:'White', color:'#e8e8ee' },
  { key:'r',      label:'Red',   color:'#ef4444' },
  { key:'g',      label:'Green', color:'#22c55e' },
  { key:'b',      label:'Blue',  color:'#3b82f6' }
];
const PE_CURVE_POINT_HIT_RADIUS = 10; // px, in canvas-pixel space (canvas is 252x220, not CSS-scaled)

function peSelectCurveChannel(key) {
  peActiveCurveChannel = key;
  peRenderPanel();
}

function peDrawCurve() {
  const canvas = document.getElementById('peCurveCanvas');
  if (!canvas || !peCurves) return;
  const curves = pmColorState().curves;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const chan = PE_CURVE_CHANNELS.find(c => c.key === peActiveCurveChannel) || PE_CURVE_CHANNELS[0];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(0, 0, w, h);

  const hist = peActiveCurveChannel === 'master' ? peHistogram : peChannelHistograms?.[peActiveCurveChannel];
  if (hist) {
    const maxV = Math.max(1, ...hist);
    ctx.fillStyle = peActiveCurveChannel === 'master' ? 'rgba(255,255,255,.28)' : chan.color + '48';
    const barW = Math.max(1, w / 256);
    for (let i = 0; i < 256; i++) {
      const barH = (hist[i] / maxV) * h;
      ctx.fillRect((i / 255) * w, h - barH, barW, barH);
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const gx = (i / 4) * w, gy = (i / 4) * h;
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();

  const points = pmColorState().curves[peActiveCurveChannel];
  const sampled = peMonotoneCubicSample(points);
  ctx.strokeStyle = chan.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < 256; x++) {
    const cx = (x / 255) * w, cy = h - (sampled[x] / 255) * h;
    if (x === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  points.forEach(p => {
    const cx = (p.x / 255) * w, cy = h - (p.y / 255) * h;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#15151a';
    ctx.fill();
    ctx.strokeStyle = chan.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function peCurvePointAt(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
  return {
    px: x, py: y,
    x: Math.round(Math.min(255, Math.max(0, (x / canvas.width) * 255))),
    y: Math.round(Math.min(255, Math.max(0, 255 - (y / canvas.height) * 255)))
  };
}

function peSetupCurveDrag() {
  const canvas = document.getElementById('peCurveCanvas');
  if (!canvas) return;
  canvas.onpointerdown = e => {
    const pt = peCurvePointAt(canvas, e);
    const points = pmColorState().curves[peActiveCurveChannel];
    let hitIdx = -1, hitDist = Infinity;
    points.forEach((p, i) => {
      const cx = (p.x / 255) * canvas.width, cy = canvas.height - (p.y / 255) * canvas.height;
      const d = Math.hypot(cx - pt.px, cy - pt.py);
      if (d < PE_CURVE_POINT_HIT_RADIUS && d < hitDist) { hitDist = d; hitIdx = i; }
    });
    if (hitIdx === -1) {
      points.push({ x: pt.x, y: pt.y });
      points.sort((a, b) => a.x - b.x);
      hitIdx = points.findIndex(p => p.x === pt.x && p.y === pt.y);
    }
    peCurveDrag = hitIdx;
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = e => {
    if (peCurveDrag === null) return;
    const points = pmColorState().curves[peActiveCurveChannel];
    const pt = peCurvePointAt(canvas, e);
    const isEndpoint = peCurveDrag === 0 || peCurveDrag === points.length - 1;
    const minX = peCurveDrag > 0 ? points[peCurveDrag - 1].x + 1 : 0;
    const maxX = peCurveDrag < points.length - 1 ? points[peCurveDrag + 1].x - 1 : 255;
    points[peCurveDrag] = {
      x: isEndpoint ? points[peCurveDrag].x : Math.min(maxX, Math.max(minX, pt.x)),
      y: pt.y
    };
    peDirty = true;
    peDrawCurve();
    pmColorLutRefresh();
    pmColorRepaint();
    peScheduleSave();
  };
  canvas.onpointerup = () => { peCurveDrag = null; };
  canvas.ondblclick = e => {
    const pt = peCurvePointAt(canvas, e);
    const points = pmColorState().curves[peActiveCurveChannel];
    let hitIdx = -1, hitDist = Infinity;
    points.forEach((p, i) => {
      const cx = (p.x / 255) * canvas.width, cy = canvas.height - (p.y / 255) * canvas.height;
      const d = Math.hypot(cx - pt.px, cy - pt.py);
      if (d < PE_CURVE_POINT_HIT_RADIUS && d < hitDist) { hitDist = d; hitIdx = i; }
    });
    if (hitIdx > 0 && hitIdx < points.length - 1) {
      points.splice(hitIdx, 1);
      peDirty = true;
      peDrawCurve();
      peUpdateToneLUT();
      peRender();
      peScheduleSave();
    }
  };
}

function peResetCurve() {
  pmColorState().curves[peActiveCurveChannel] = peDefaultCurve();
  peDirty = true;
  pmColorLutRefresh();
  peDrawCurve();
  pmColorRepaint();
  peScheduleSave();
}

// ── HSL color grading ────────────────────────────────────────────────────────
function peSelectHslBand(key) {
  peActiveHslBand = key;
  peRenderPanel();
}

function peOnHslSlider(param, val) {
  const n = parseInt(val, 10) || 0;
  pmColorState().hsl[peActiveHslBand][param] = n;
  peDirty = true;
  const readout = document.getElementById('peHslVal-' + param);
  const slider = document.getElementById('peHslSlider-' + param);
  if (readout) readout.textContent = n;
  if (slider) slider.value = n;
  peRender();
  peScheduleSave();
}

function peResetColor() {
  const st = pmColorState();
  st.hsl = peDefaultHsl();
  if (!pmColorTargetLayer()) peHsl = st.hsl;
  peDirty = true;
  peRenderPanel();
  pmColorRepaint();
  peScheduleSave();
}

function peShowOriginal(hold) {
  if (!peGl) return;
  peBypass = hold;
  peRender();
  const drawCanvas = document.getElementById('peDrawCanvas');
  if (drawCanvas) drawCanvas.style.visibility = hold ? 'hidden' : '';
  if (hold) { const maskCanvas = document.getElementById('peMaskCanvas'); if (maskCanvas) maskCanvas.style.visibility = 'hidden'; }
  else peSyncMaskCanvasVisibility();
}

function peScheduleSave() {
  clearTimeout(peSaveTimer);
  pmSegDocVersion++; // every edit passes through here, so Auto select knows its analysis of the picture is stale
  // Neither editor autosaves. Everything - adjustments, masks, brush strokes and the whole layer
  // stack - stays in memory until Save changes (simple) or Save/Export (PhotoMod), so a session
  // of experimenting can always be thrown away. The simple editor used to save as you go, which
  // made its Close button keep edits the user meant to drop. peDirty is still set by the
  // callers: it's what the Close prompt reads, so a stray Escape can't lose work either.
}

async function peCommit() {
  const file = appData.files.find(f => f.id === peFileId);
  if (!file || !peAdjustments) return;
  // Snapshot whatever's currently being painted into its layer before evaluating defaults/serializing below.
  peCommitActiveMaskLayer();
  const adjDefault = [...PE_ADJUSTMENTS, ...PE_EFFECTS].every(a => !peAdjustments[a.key]);
  const curveDefault = ['master', 'r', 'g', 'b'].every(ch => {
    const pts = peCurves[ch];
    return pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 255 && pts[1].y === 255;
  });
  const hslDefault = PE_HSL_BANDS.every(b => { const v = peHsl[b.key]; return !v.h && !v.s && !v.l; });
  const drawLayer = (peDrawHasContent && peDrawCanvas) ? peDrawCanvas.toDataURL('image/png') : null;
  const localLayers = peSerializeLocalLayers(peLocalLayers); // drops any never-painted layer, not just dead weight but also correctness (see isDefault below)
  const layers = peSerializeLayers(peLayers);
  const isDefault = adjDefault && curveDefault && hslDefault && !drawLayer && !peStraighten && localLayers.length === 0 && layers.length === 0;
  delete thumbCache[file.id]; delete previewCache[file.id]; delete hiresCache[file.id];
  if (isDefault) {
    delete file.edits;
    await window.api.clearEditedThumb(file.id);
  } else {
    file.edits = {
      version: 4,
      adjustments: Object.assign({}, peAdjustments),
      curves: peCloneCurves(peCurves),
      hsl: peCloneHsl(peHsl),
      straighten: peStraighten || 0,
      drawLayer,
      localLayers,
      layers,
      updatedAt: Date.now()
    };
    await peSaveEditedThumbnail(file.id);
  }
  persistQuiet();
}

// Saves the edited look twice: a 480px thumb for the grid, and a full-size one for the viewer
// (getEditedPreview). Only the editor can render an edit, so without the second the viewer had
// nothing better to show than the thumb, stretched.
// Both are stored unturned: the editor works on the photo already turned by file.rotation, but
// everything that shows these turns them by file.rotation again (getThumb, getPreviewImage),
// the same as every other thumbnail - so a rotated edited photo used to come out turned twice.
const PE_EDITED_PREVIEW_MAX = 4000; // HIRES_MAX_DIM: it doubles as the viewer's zoomed-in render
async function peSaveEditedThumbnail(fileId) {
  let canvas = peCompositeCanvas();
  if (!canvas || !canvas.width) return;
  const file = appData.files.find(f => f.id === fileId);
  if (file?.rotation) canvas = drawRotatedToCanvas(canvas, 360 - file.rotation);
  const encode = async (maxW, maxH, quality) => {
    const scale = Math.min(1, maxW / canvas.width, maxH / canvas.height);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', quality));
    return blob ? arrayBufferToBase64(await blob.arrayBuffer()) : null;
  };
  const thumb = await encode(480, Infinity, 0.85);
  if (thumb) await window.api.saveEditedThumb(fileId, thumb);
  const full = await encode(PE_EDITED_PREVIEW_MAX, PE_EDITED_PREVIEW_MAX, 0.9);
  if (full) await window.api.saveEditedPreview(fileId, full);
}

async function peExport() {
  if (!peGl) return;
  const file = appData.files.find(f => f.id === peFileId);
  if (!file && !peIsPro()) return;
  pmCommitLiveMesh();
  const canvas = peCompositeCanvas();
  if (!canvas) return;
  // A PhotoMod document can have transparency (a new canvas, or layers over an erased area),
  // which JPEG would flatten to black - pmOutputFormat keeps PNG for that and for designs, and
  // gives a plain edited photo the same smaller JPEG the simple editor always writes.
  const fmt = peIsPro() ? pmOutputFormat(canvas, file) : { mime: 'image/jpeg', ext: 'jpg', quality: 0.92 };
  const png = fmt.ext === 'png';
  const blob = fmt.ext === 'jpg' ? await peEncodeJpegLikeOriginal(canvas, file) : await new Promise(res => canvas.toBlob(res, fmt.mime));
  if (!blob) { toast('⚠️ Export failed'); return; }
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  const dir = file ? pathDirname(file.path) : '';
  const base = file ? pathBasename(file.path).replace(/\.[^.]+$/, '') : (pmDocName || 'Untitled').replace(/[\\/:*?"<>|]/g, '-');
  let result = null;
  try { result = await window.api.exportEditedImage(base64, `${base}-edited.${png ? 'png' : 'jpg'}`, dir); } catch (e) {}
  if (!result?.success) return;
  toast(`⬇ Exported ${pathBasename(result.path)}`);
  // Exporting is the other way to finish in PhotoMod, so the work is on disk and the Close
  // guard has nothing left to warn about. (Simple mode keeps its own dirty flag: its edits are
  // a recipe on the original, which an export doesn't commit.)
  if (peIsPro()) peDirty = false;
}

// ── Baking layers on close ──────────────────────────────────────────────────
// Layers persist as base64 PNG inside the library JSON, which is fine for a session but not
// forever - a few pasted images would make every future save of that photo drag a few MB
// around. So on close they're flattened once into a real image file next to the original,
// added to the library and linked as an edited version of it (exactly what the Versions
// feature already models), and dropped from file.edits. The original itself is untouched and
// still carries only its adjustment recipe. The trade: after closing, the layers are pixels,
// not movable objects any more - the flattened copy is the thing you keep.
async function peBakeLayers() {
  const file = appData.files.find(f => f.id === peFileId);
  if (!file || !(peLayers || []).some(l => l.dataUrl && l.visible)) return false;
  const canvas = peCompositeCanvas();
  if (!canvas) return false;
  const blob = await peEncodeJpegLikeOriginal(canvas, file);
  if (!blob) return false;
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  const res = await window.api.bakeEditedImage(base64, file.path).catch(() => null);
  if (!res?.success) { toast('⚠️ Could not save the flattened copy - your layers were kept'); return false; }
  const added = await window.api.processDroppedPaths([res.path]).catch(() => []);
  const entry = added && added[0];
  if (!entry) { toast('⚠️ Saved the flattened file but could not add it to the library'); return false; }
  entry.versionParentId = file.id;          // shows up under Versions on the original
  entry.folders = [...(file.folders || [])]; // lands in the same trips/people/categories
  syncEditedMetadataFromOriginal(file, entry);
  appData.files.push(entry);
  queueForIndexing([entry]);
  const count = peLayers.filter(l => l.dataUrl).length;
  toast(`🧩 Flattened ${count} layer${count !== 1 ? 's' : ''} into ${entry.name} and linked it to the original`, 6000);
  return true;
}

// The simple editor's only way to keep its edits: neither editor saves as you go any more, so
// Close can mean "never mind" (see closePhotoEditor).
async function peSaveChangesAndClose() {
  if (!peOpen || peIsPro()) return;
  const hadChanges = peDirty;
  await closePhotoEditor(true, true);
  toast(hadChanges ? '✅ Changes saved' : '✅ Saved - no changes to keep');
}

// `force` skips the unsaved-work prompt, for callers that have already asked (pmPick) or that
// are handing the same photo straight to another editor (peOpenInPhotoMod). `save` commits the
// simple editor's edits on the way out; without it they're dropped and the photo keeps whatever
// it had when the editor opened. The prompt's own "Save changes" answer sets it too.
async function closePhotoEditor(force, save = false) {
  if (!force) {
    const answer = await peConfirmDiscard();
    if (!answer) return;
    if (answer === 'save') save = true;
  }
  clearTimeout(peSaveTimer);
  const wasPro = peIsPro();
  // In pro mode nothing is written on the way out - anything worth keeping went through Save
  // or Export already, and the prompt above is where the user said so.
  if (!wasPro && save) {
    // Bake before the final commit so the layers are gone from file.edits by the time it writes,
    // and so the original's own thumbnail regenerates without them.
    if (peOpen && await peBakeLayers()) {
      peLayers = [];
      peActiveLayerId = null;
      peCompositeLayers();
      peDirty = true;
    }
    if (peDirty) await peCommit();
    // Nothing changed, but a photo edited before full-size previews were saved gets one now,
    // so opening it and pressing Save changes is enough to make its viewer sharp.
    else if (appData.files.find(f => f.id === peFileId)?.edits) await peSaveEditedThumbnail(peFileId);
  } else if (!wasPro) {
    // Discarded: file.edits was never touched, but the 90° turn buttons (and Reset all) set
    // file.rotation as they go, since the grid and the viewer share it. Put it back.
    const file = appData.files.find(f => f.id === peFileId);
    if (file && (file.rotation || 0) !== peRotationAtOpen) {
      if (peRotationAtOpen) file.rotation = peRotationAtOpen; else delete file.rotation;
      delete previewCache[file.id]; delete hiresCache[file.id];
      refreshFileThumbs(file);
      persistQuiet();
    }
  }
  document.getElementById('photoEditor').classList.remove('open');
  // Free the GPU resources this session allocated - the image texture is the big one, easily
  // tens of MB on a large photo.
  //
  // This deliberately does NOT call WEBGL_lose_context.loseContext(), which is what it used to
  // do. #peCanvas is reused for every session, and getContext() on a canvas whose context has
  // been lost hands back that same lost context - restoration is asynchronous and there is no
  // guarantee it has happened by the time the next open calls peInitGL. The effect was that
  // only the first photo you opened in a run ever got shaders: every editor session after it
  // came up with a lost context, a null program and no draw layer. Deleting the objects by
  // hand frees the same memory and leaves the context usable.
  if (peGl && !peGl.isContextLost()) {
    peDeleteLocalFbo();
    if (peMaskGlTex) peGl.deleteTexture(peMaskGlTex);
    if (peMaskProgram) peGl.deleteProgram(peMaskProgram);
    if (peTexture) peGl.deleteTexture(peTexture);
    if (peToneLUTTex) peGl.deleteTexture(peToneLUTTex);
    if (peProgram) peGl.deleteProgram(peProgram);
  }
  peOpen = false;
  peGl = null; peProgram = null; peTexture = null; peUniforms = null; peToneLUTTex = null;
  peFileId = null; peAdjustments = null; peBypass = false; peDirty = false;
  peSourceCanvas = null; peHistogram = null; peChannelHistograms = null; peCurveDrag = null;
  peCurves = null; peActiveCurveChannel = 'master'; peHsl = null; peActiveTab = 'colors'; peActiveHslBand = 'red';
  peStraighten = 0; peRawCanvas = null;
  peDrawCanvas = null; peDrawCtx = null; peDrawUndoStack = []; peDrawHasContent = false;
  peDrawing = false; peDrawLastPoint = null;
  peLocalLayers = null; peEditingLayerId = null; peMaskCanvas = null; peMaskCtx = null;
  peMaskUndoStack = []; peMaskCanvasHasContent = false; peMaskDrawing = false; peMaskLastPoint = null;
  peMaskProgram = null; peMaskUniforms = null; peFbo = null; peMaskGlTex = null;
  peLayers = null; peActiveLayerId = null; peLayersCanvas = null; peLayersCtx = null;
  peLayerDrag = null; peTool = 'move';
  peHistory = []; peHistoryIndex = -1;
  peSelection = null; peSelDrag = null; peSelCanvas = null; peSelCtx = null;
  if (peSelAntsTimer) { clearInterval(peSelAntsTimer); peSelAntsTimer = null; }
  const cursor = document.getElementById('peBrushCursor');
  if (cursor) cursor.style.display = 'none';
  pmTransform = null; pmWarp = null; pmHandleDrag = null; pmPolygon = null; pmSnapGuides = [];
  pmColorTarget = null; pmPropsOpen = false; pmLayerMenuId = null; pmTextEditId = null; peScratch = null;
  document.getElementById('peTextEditor')?.classList.remove('open');
  pmHideLayerMenu();
  pmTfCanvas = null; pmTfCtx = null; pmTfMode = 'scale';
  pmHideTfMenu();
  peBaseOverride = null; pmDocName = null;
  pmOpenMenu = null;
  document.getElementById('pmAdjustPanel')?.classList.remove('open');
  document.getElementById('pmMenubar').innerHTML = '';
  peMode = 'simple';
  peZoom = 1; pePanX = 0; pePanY = 0; peSpaceHeld = false;
  if (!wasPro) await saveData();
  frResumeWizardIfPending();
  resumePopupReturn();
}

function editPopupPhoto() {
  if (!popupFileId) return;
  const id = popupFileId;
  stashPopupReturn();
  closePhotoPopup();
  openPhotoEditor(id);
}

// ── KEYBOARD / CLICK-OUT ──────────────────────────────────────────────────────
document.addEventListener('keydown', e=>{
  // The 360 player takes every key while it's showing, unless a dialog (Remove, Edit Props...)
  // is open over the preview.
  if(v360.open && !document.querySelector('.modal-backdrop.open')){ v360HandleKey(e); return; }
  if(document.getElementById('facesMode').classList.contains('open')){
    if(e.key==='Escape' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')){ e.preventDefault(); closeFacesMode(); }
    return;
  }
  if(document.getElementById('versionPickMode').classList.contains('open')){
    if(e.key==='Escape'){ e.preventDefault(); closeVersionPickModal(); }
    return;
  }
  // Opened from the photo popup ("card"), floating on top of it. Escape here should
  // only back out of this compare view, not also close the card underneath, so this
  // needs its own early return rather than falling into the general branch below.
  if(document.getElementById('versionCompareModal').classList.contains('open')){
    if(e.key==='Escape'){
      e.preventDefault();
      if(document.getElementById('removeOrDelete').classList.contains('open')) closeRemoveOrDelete();
      else closeVersionCompareModal();
    }
    return;
  }
  if(document.getElementById('dupMode').classList.contains('open')){
    const confirmOpen = document.getElementById('deleteConfirm').classList.contains('open');
    if(e.key==='Escape'){
      e.preventDefault();
      if(confirmOpen) cancelDeleteConfirm();
      else if(dupPhase==='compare') dupBackToResults();
      else closeDupMode();
    }
    return;
  }
  if(gsOpen){
    if(e.key==='Escape'){
      e.preventDefault();
      // One thing at a time, innermost first: a dialog, a menu, the preview, the selected
      // photos, a person or folder picked for tagging - and only then Guided Sort itself.
      // Escape with photos selected used to skip straight to closing Guided Sort.
      const nameModalOpen = document.getElementById('gsNameModal').classList.contains('open');
      if(nameModalOpen) gsCancelNamePrompt();
      else if(gsAnyMenuOpen()) gsCloseMenus();
      else if(document.getElementById('photoPopup').classList.contains('open')) closePhotoPopup();
      else if(/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) document.activeElement.blur();
      else if(selectedIds.size || gsActiveTarget){
        const stopTagging = !!gsActiveTarget;
        clearSelection();
        gsActiveTarget = null;
        if(stopTagging) renderGuidedSortStep();
        else if(typeof gsBarUpdater === 'function') gsBarUpdater();
      }
      else exitGuidedSort();
    }
    return;
  }
  if(document.getElementById('removeOrDelete').classList.contains('open')){
    if(e.key==='Escape'){ e.preventDefault(); closeRemoveOrDelete(); }
    return;
  }
  // Both of PhotoMod's own overlays sit above the editor, so they get first refusal on Escape.
  if(pmDiscardResolve){
    if(e.key==='Escape'){ e.preventDefault(); pmAnswerDiscard(false); } // Escape means "don't lose my work"
    return;
  }
  // PhotoMod's dialogs (the start chooser, New / Canvas Size / Image Size) can open over the
  // library or over the editor. Escape backs out of the dialog only, never what's underneath.
  const pmModal = ['pmStartModal','pmNewDocModal','pmCanvasSizeModal','pmImageSizeModal']
    .find(id => document.getElementById(id).classList.contains('open'));
  if(pmModal){
    if(e.key==='Escape'){ e.preventDefault(); pmCloseModal(pmModal); }
    return;
  }
  if(document.getElementById('photoModPick').classList.contains('open')){
    if(e.key==='Escape'){ e.preventDefault(); closePhotoModPicker(); }
    return;
  }
  if(peOpen){
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'range';
    if(pmOpenMenu && e.key==='Escape'){ e.preventDefault(); pmCloseMenus(); return; }
    if(e.key==='Escape'){
      e.preventDefault();
      // Back out one layer of context at a time: a half-drawn polygon, then a live transform,
      // then a selection, then the editor itself - the order every editor uses.
      if(pmPolygonActive()) pmCancelPolygon();
      else if(pmTransform || pmWarp) pmCancelLiveMesh();
      else if(peSelection) peClearSelection();
      else closePhotoEditor();
      return;
    }
    if(e.key==='Enter' && !typing){
      if(pmPolygonActive()){ e.preventDefault(); pmClosePolygon(); return; }
      if(pmTransform || pmWarp){ e.preventDefault(); pmApplyLiveMesh(); return; }
    }
    if((e.key==='Backspace'||e.key==='Delete') && pmPolygonActive() && !typing){ e.preventDefault(); pmUndoPolygonPoint(); return; }
    // Space is held-to-pan, so it must not also count as a click on whatever has focus.
    if(e.key===' ' && !typing){ e.preventDefault(); peSpaceHeld = true; document.querySelector('.pe-stage')?.classList.add('can-pan'); return; }
    if(e.metaKey||e.ctrlKey){
      const k = e.key.toLowerCase();
      // Zoom is useful in both modes, so it sits above the pro-only gate below.
      if(e.key==='+'||e.key==='='){ e.preventDefault(); peZoomBy(1.25); return; }
      if(e.key==='-'||e.key==='_'){ e.preventDefault(); peZoomBy(1/1.25); return; }
      if(k==='s' && peIsPro()){ e.preventDefault(); peSaveToLibrary(); return; }
      if(k==='z'){ e.preventDefault(); e.shiftKey ? peRedoLayers() : peUndoForCurrentTool(); return; }
      if(k==='y'){ e.preventDefault(); peRedoLayers(); return; }
      if(!peIsPro()) return; // the rest are all document/selection/layer verbs
      if(k==='n'){ e.preventDefault(); pmOpenNewDocModal(); return; }
      if(e.key==='0'){ e.preventDefault(); peZoomFit(); return; }
      if(e.key==='1'){ e.preventDefault(); peZoomActual(); return; }
      if(k==='o'){ e.preventDefault(); pmOpenPicker('open'); return; }
      if(k==='p' && e.shiftKey){ e.preventDefault(); pmAddPhotoAndPlace(); return; }
      if(k==='e'){ e.preventDefault(); peExport(); return; }
      if(k==='t'){ e.preventDefault(); peSelectTool('transform'); return; }
      if(k==='a'){ e.preventDefault(); pmSelectAll(); return; }
      if(k==='i' && e.shiftKey){ e.preventDefault(); pmInvertSelection(); return; }
      if(k==='d'){ e.preventDefault(); peClearSelection(); return; }
      // Ctrl+J is "copy the selection onto its own layer" when there is one, and Photoshop's
      // duplicate-layer when there isn't.
      if(k==='j'){ e.preventDefault(); peSelection ? peSelectionToNewLayer(false) : pmDuplicateLayer(); return; }
      if(k==='x' && peSelection){ e.preventDefault(); peSelectionToNewLayer(true); return; }
      return; // Ctrl+V is handled by the paste listener, not here
    }
    if(e.altKey||typing) return;
    // Photoshop's own single-key tool shortcuts, so the muscle memory carries over. Simple mode
    // only answers to the two it actually has; peSelectTool ignores the rest either way.
    // M cycles the two marquee shapes, the way one letter covers a tool group in Photoshop.
    const marquee = peTool === 'marquee' ? 'ellipse' : 'marquee';
    if(e.key.toLowerCase()==='b' && peTool==='brush' && peIsPro()){
      e.preventDefault();
      const i = PE_PAINT_TOOLS.findIndex(t => t[0] === peDrawTool);
      pePickPaintTool(PE_PAINT_TOOLS[(i + 1) % PE_PAINT_TOOLS.length][0]);
      return;
    }
    const toolKey = { v:'move', m:marquee, l:'lasso', t:'text', b:'brush', e:'eraser', j:'heal', a:'autosel', k:'mask', w:'warp', i:'dropper' }[e.key.toLowerCase()];
    if(toolKey && (peIsPro() || PE_SIMPLE_TOOLS.includes(toolKey))){ e.preventDefault(); peSelectTool(toolKey); return; }
    if((e.key==='Delete'||e.key==='Backspace') && peIsPro()){
      e.preventDefault();
      if(peSelection) peDeleteSelection();
      else if(peActiveLayerId) peDeleteLayer(peActiveLayerId);
    }
    return;
  }
  if(e.key==='Escape'){
    closeSortMenu();
    closeAssignModal();closeNewFolderModal();closePhotoPopup();closeEditModal();closeCoverPicker();
    cancelDeleteConfirm();closeBurstReview();
    closeSettingsModal();closeBackupsModal();closeMissingFilesModal();
    closeVersionModal();closeVersionPickModal();
    hideCtxMenu();hideFolderCtxMenu();
    if(selectedIds.size)clearSelection();
  }
  // G grabs the current frame of the video playing in the popup (see grabPopupVideoFrame).
  if(document.getElementById('photoPopup').classList.contains('open') && (e.key==='g'||e.key==='G') && !e.ctrlKey && !e.metaKey
     && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable){
    const f = appData.files.find(x => x.id === popupFileId);
    if (f && isVid(f.ext)) { e.preventDefault(); grabPopupVideoFrame(); }
  }
  // R rotates what the popup is showing (see rotatePopupFile).
  if(document.getElementById('photoPopup').classList.contains('open') && (e.key==='r'||e.key==='R') && !e.ctrlKey && !e.metaKey
     && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable){
    e.preventDefault(); rotatePopupFile();
  }
  if(document.getElementById('photoPopup').classList.contains('open') && popupClusterFiles.length > 1){
    if(e.key==='ArrowLeft'){e.preventDefault();popupPrev();}
    else if(e.key==='ArrowRight'){e.preventDefault();popupNext();}
  }
  if((e.metaKey||e.ctrlKey)&&e.key==='o'){e.preventDefault();addFiles();}
  if(e.key==='a'&&(e.metaKey||e.ctrlKey)){e.preventDefault();getVisibleFiles().forEach(f=>selectedIds.add(f.id));updateSelectionUI();}
});
document.getElementById('assignModal').addEventListener('click',e=>{if(e.target.id==='assignModal')closeAssignModal();});
document.getElementById('newFolderModal').addEventListener('click',e=>{if(e.target.id==='newFolderModal')closeNewFolderModal();});
document.getElementById('categoryQuickAddModal').addEventListener('click',e=>{if(e.target.id==='categoryQuickAddModal')closeCategoryQuickAdd();});
document.getElementById('gsNameModal').addEventListener('click',e=>{if(e.target.id==='gsNameModal')gsCancelNamePrompt();});
document.getElementById('burstReview').addEventListener('click',e=>{if(e.target.id==='burstReview')closeBurstReview();});
document.getElementById('deleteConfirm').addEventListener('click',e=>{if(e.target.id==='deleteConfirm')cancelDeleteConfirm();});
document.getElementById('removeOrDelete').addEventListener('click',e=>{if(e.target.id==='removeOrDelete')closeRemoveOrDelete();});
document.getElementById('photoPopup').addEventListener('click',e=>{if(e.target.id==='photoPopup')closePhotoPopup();});
document.getElementById('settingsModal').addEventListener('click',e=>{if(e.target.id==='settingsModal')closeSettingsModal();});
['pmNewDocModal','pmCanvasSizeModal','pmImageSizeModal','pmStartModal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',e=>{if(e.target.id===id)pmCloseModal(id);});
});
document.addEventListener('pointerdown',e=>{
  if(!e.target.closest('#pmTfMenu')) pmHideTfMenu();
  if(!e.target.closest('#pmLayerMenu')) pmHideLayerMenu();
  if(!e.target.closest('#peToolFlyout')) peHideToolFlyout();
},true);
document.addEventListener('keyup',e=>{
  if(e.key===' '){ peSpaceHeld = false; document.querySelector('.pe-stage')?.classList.remove('can-pan'); }
});
// A window that loses focus mid-pan would otherwise come back still thinking Space is down.
window.addEventListener('blur',()=>{ peSpaceHeld = false; document.querySelector('.pe-stage')?.classList.remove('can-pan'); });
// Anywhere outside an open menu closes it - including a click on the canvas, which would
// otherwise start a stroke with a dropdown still covering the stage.
document.addEventListener('pointerdown',e=>{
  if(pmOpenMenu && !e.target.closest('.pm-menu')) pmCloseMenus();
},true);
document.getElementById('backupsModal').addEventListener('click',e=>{if(e.target.id==='backupsModal')closeBackupsModal();});
document.getElementById('missingFilesModal').addEventListener('click',e=>{if(e.target.id==='missingFilesModal')closeMissingFilesModal();});
document.getElementById('versionModal').addEventListener('click',e=>{if(e.target.id==='versionModal')closeVersionModal();});
document.getElementById('versionCompareModal').addEventListener('click',e=>{if(e.target.id==='versionCompareModal')closeVersionCompareModal();});
{
  const piw = document.getElementById('photoImgWrap');
  piw.addEventListener('wheel', popupOnWheel, { passive: false });
  piw.addEventListener('mousedown', popupOnMouseDown);
  piw.addEventListener('dblclick', popupOnDblClick);
  document.addEventListener('mousemove', popupOnMouseMove);
  document.addEventListener('mouseup', popupOnMouseUp);
}
document.getElementById('editModal').addEventListener('click',e=>{if(e.target.id==='editModal')closeEditModal();});
document.getElementById('coverPicker').addEventListener('click',e=>{if(e.target.id==='coverPicker')closeCoverPicker();});
document.getElementById('nfmName').addEventListener('keydown',e=>{if(e.key==='Enter')createFolder();});

function restartForUpdate() {
  window.api.restartAndInstall();
}
window.api.onUpdateReady?.(() => {
  const btn = document.getElementById('updateBtn');
  if (btn) btn.style.display = '';
});

// Wait for the scripts after this one (viewer360.js, semanticIndex.js) - init's first await
// can resolve before they've run, and then its first render hits semanticResultGen/is360File
// undefined, throws, and the splash never goes away.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
