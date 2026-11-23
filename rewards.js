// ── XP, LEVELS, BADGES, SOUND ────────────────────────────────────────────────
// One XP and level system for the whole app, so useful work (picking a trip's best shots,
// clearing duplicates, naming people) feels like progress. Everything lives in appData.rewards,
// in the library file on this computer; nothing is sent anywhere, and there are no streaks to
// lose: XP only ever goes up from real work (and back down only when that work is undone).
//
// An action builds a receipt (rewardsBegin/rewardsClaim/rewardsAdd), commits it, and keeps it
// if it can be undone, so undo gives back exactly what was granted. rewardsClaim makes each
// photo, person or trip pay out once, so undoing and redoing, or picking a group again, can't
// farm XP.
//
// Loaded before renderer.js, like flick.js; reads renderer.js's globals only when called.

// Tuned so the first level-up comes within a minute of flicking through a trip, and going
// through a whole 400-photo trip (liking and binning as you go) reaches the second rank.
const REWARD_XP = { seen: 1, like: 3, bin: 2, dup: 10, personNew: 25, personMore: 5, tripDone: 150, locate: 4 };
const REWARD_COUNTER = { seen: 'seen', like: 'likes', bin: 'binned', dup: 'dups', personNew: 'people', tripDone: 'trips', locate: 'located' };
// Level L starts at 25 * (L-1) * L XP: 50, 150, 300, 500... each level a little longer than the last.
function rewardsXpForLevel(level) { return 25 * (level - 1) * level; }
function rewardsLevelOf(xp) { let l = 1; while (rewardsXpForLevel(l + 1) <= xp) l++; return l; }
// Line icons for ranks and badges, drawn in the current text colour (emoji read as stock art).
const RW_ICON_PATHS = {
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  sailboat: '<path d="M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z"/><path d="M21 14 10 2 3 14h18Z"/><path d="M10 2v16"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  heartFilled: '<path fill="currentColor" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M4 22V3"/><path d="M4 4h13l-3 4.5 3 4.5H4"/>',
  suitcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  volumeOn: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  volumeOff: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
};
function rwIcon(name) {
  return `<svg class="rw-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RW_ICON_PATHS[name] || ''}</svg>`;
}
// Emblems: a medallion in the accent colour with a hand-drawn glyph. Ranks get a fancier frame
// the higher they are; badges share a shield. Glyphs sit on a 24px grid, centred in the 48px medallion.
const RW_FRAMES = {
  tourist: '<circle cx="24" cy="24" r="22"/>',
  wanderer: '<circle cx="24" cy="24" r="22"/><circle cx="24" cy="24" r="19" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="2 3"/>',
  voyager: '<path d="M24 2l19 11v22L24 46 5 35V13z"/>',
  globetrotter: '<path d="M24 2l19 11v22L24 46 5 35V13z"/><path d="M24 7l14.5 8.4v17.2L24 41 9.5 32.6V15.4z" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>',
  legend: '<path d="M24 1l5.2 6.6 8.3-1.7 1.7 8.3L47 24l-7.8 9.8-1.7 8.4-8.3-1.7L24 47l-5.2-6.5-8.3 1.7-1.7-8.4L1 24l7.8-9.8 1.7-8.3 8.3 1.7z"/>',
  badge: '<path d="M24 2c6 3.5 12 4 19 4v16c0 12-8 19-19 24C13 41 5 34 5 22V6c7 0 13-.5 19-4z"/>'
};
const RW_GLYPHS = {
  tourist: '<path d="M12 3l3.2 9L12 21l-3.2-9z"/><circle cx="12" cy="12" r="1.2" fill="#fff"/>',
  wanderer: '<path d="M7 20c-3-4 2-6 5-8s2-6-1-8"/><circle cx="7" cy="20" r="1.5" fill="#fff"/><path d="M13 4h5"/>',
  voyager: '<path d="M12 3v13M12 5l6 10h-6M12 8l-5 7h5M4 19h16"/>',
  globetrotter: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.5" ry="8"/><path d="M4 12h16M2 17c5 3 15-3 20-9"/>',
  legend: '<path d="M2 20l7-12 4 6 2.5-3.5L22 20zM9 8V3.5l4 1.5-4 1.5"/>',
  firstLike: '<path d="M12 20S4 14.5 4 9a4.2 4.2 0 0 1 8-1.8A4.2 4.2 0 0 1 20 9c0 5.5-8 11-8 11z"/>',
  bigHeart: '<path fill="#fff" d="M12 20S4 14.5 4 9a4.2 4.2 0 0 1 8-1.8A4.2 4.2 0 0 1 20 9c0 5.5-8 11-8 11z"/>',
  sharpEye: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.8" fill="#fff"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  marathon: '<path d="M6 21V4M6 5h12l-3 3.5L18 12H6"/><path d="M3 21h6"/>',
  firstTrip: '<rect x="3" y="8" width="18" height="12" rx="2.5"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M3 13h18M12 12v3"/>',
  explorer: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/><path d="M11.5 10.5l3 3M14.5 10.5l-3 3" transform="translate(-0.5 0)"/>',
  tidyUp: '<path d="M5 8h14l-1.6 12H6.6zM3.5 8h17M9 4h6l1 4M10 12v5M14 12v5"/>',
  firstSweep: '<path d="M19 3L11 12M8 12l5 5c-2 3-6 4-9 3 1-3 1-6 4-8z"/><path d="M6 15l3 3"/>',
  cleanSweep: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  familiarFaces: '<circle cx="8.5" cy="9" r="3"/><path d="M3 20c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6"/><circle cx="16.5" cy="8" r="2.5"/><path d="M15.5 14c3 0 5.5 2 5.5 5"/>'
};
function rwEmblem(name) {
  const frame = RW_FRAMES[name] || RW_FRAMES.badge;
  const glyph = RW_GLYPHS[name] || '';
  return `<svg class="rw-ico rw-emb" viewBox="0 0 48 48" aria-hidden="true"><g fill="var(--accent)">${frame}</g><path d="M24 4a20 20 0 0 1 20 20H4A20 20 0 0 1 24 4z" fill="#fff" fill-opacity=".12"/><g transform="translate(12 12)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
}
const REWARD_RANKS = [
  { key: 'tourist', from: 1, icon: 'tourist' },
  { key: 'wanderer', from: 5, icon: 'wanderer' },
  { key: 'voyager', from: 10, icon: 'voyager' },
  { key: 'globetrotter', from: 15, icon: 'globetrotter' },
  { key: 'legend', from: 20, icon: 'legend' },
];
function rewardsRankOf(level) { return REWARD_RANKS.filter(r => level >= r.from).pop(); }
// count() reads the live library for badges about it rather than about actions (Liked).
const REWARD_BADGES = [
  { id: 'firstLike', icon: 'firstLike', counter: 'likes', at: 1 },
  { id: 'sharpEye', icon: 'sharpEye', counter: 'seen', at: 500 },
  { id: 'marathon', icon: 'marathon', counter: 'seen', at: 5000 },
  { id: 'firstTrip', icon: 'firstTrip', counter: 'trips', at: 1 },
  { id: 'explorer', icon: 'explorer', counter: 'trips', at: 5 },
  { id: 'tidyUp', icon: 'tidyUp', counter: 'binned', at: 100 },
  { id: 'firstSweep', icon: 'firstSweep', counter: 'dups', at: 1 },
  { id: 'cleanSweep', icon: 'cleanSweep', counter: 'dups', at: 100 },
  { id: 'familiarFaces', icon: 'familiarFaces', counter: 'people', at: 5 },
  { id: 'bigHeart', icon: 'bigHeart', count: () => appData.files.filter(f => f.bestOf).length, at: 50 },
];

// ── WORLD EXPLORED ───────────────────────────────────────────────────────────
// How much of the world the library has been to: the share of the world's countries that appear in
// the photos' places. Worked out from each file's countryCode (the geocoder fills it in from the
// file's GPS) every time the Journey opens, so there is nothing to store, nothing to undo and no way
// to cheat it. The denominator is one fixed, neutral list, the 195 countries the UN recognizes (its
// 193 members plus the Vatican and Palestine), so two people's numbers can be compared. Anything
// else the geocoder returns (Taiwan, Kosovo, Hong Kong, Puerto Rico...) is shown as "other places"
// and left out of the percentage rather than taking a side.
const WORLD_COUNTRIES = new Set(('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ '
  + 'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ '
  + 'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW '
  + 'SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW PS').split(' '));
const WORLD_GOALS = [1, 5, 10, 25, 50, 100, 150, WORLD_COUNTRIES.size]; // the "next goal" line under the bar

function worldExplored() {
  const seen = new Set();
  for (const f of appData.files) {
    const code = String(f.countryCode || '').toUpperCase();
    if (f.country && /^[A-Z]{2}$/.test(code) && code !== 'XX') seen.add(code); // 'XX' = the geocoder found no country
  }
  const counted = [...seen].filter(c => WORLD_COUNTRIES.has(c));
  const other = [...seen].filter(c => !WORLD_COUNTRIES.has(c));
  const total = WORLD_COUNTRIES.size;
  return { counted, other, total, ratio: counted.length / total };
}
// Country names come from the browser's own region names in the interface language, so they need no
// translation table (and a country's name in Nominatim's local-language answer is never shown).
let worldNames = null, worldNamesLocale = '';
function worldCountryName(code) {
  const loc = uiLocale();
  if (!worldNames || worldNamesLocale !== loc) {
    try { worldNames = new Intl.DisplayNames([loc], { type: 'region' }); } catch (e) { worldNames = null; }
    worldNamesLocale = loc;
  }
  try { return worldNames?.of(code) || code; } catch (e) { return code; }
}
const worldPercentText = ratio => ratio.toLocaleString(uiLocale(), { style: 'percent', maximumFractionDigits: 1 });
const worldSortedNames = codes => codes.map(worldCountryName).sort((a, b) => a.localeCompare(b, uiLocale()));

function worldCardHtml() {
  const w = worldExplored(), n = w.counted.length;
  const goal = WORLD_GOALS.find(g => g > n);
  const next = !n ? esc(t('rwWorldNone')) : goal ? esc(t('rwWorldNext', { more: goal - n, goal })) : esc(t('rwWorldAll'));
  const chips = worldSortedNames(w.counted).map(name => `<span class="jr-chip">${esc(name)}</span>`).join('');
  const other = w.other.length ? `<div class="jr-sub" style="margin-top:8px">${esc(t('rwWorldOther', { names: worldSortedNames(w.other).join(', ') }))}</div>` : '';
  return `<div class="jr-world">
    <div class="jr-world-top">
      <div class="jr-world-pct">${esc(worldPercentText(w.ratio))}</div>
      <div class="jr-world-text"><b>${esc(t('rwWorldTitle'))}</b><span>${esc(t('rwWorldOf', { n, total: w.total }))}</span></div>
      <button class="jr-world-copy" onclick="copyWorldStats()" title="${esc(t('rwWorldCopyTitle'))}">${esc(t('rwWorldCopy'))}</button>
    </div>
    <div class="jr-bar"><span style="width:${(w.ratio * 100).toFixed(2)}%"></span></div>
    <div class="jr-sub">${next}</div>
    ${n ? `<details class="jr-world-list"><summary>${esc(t('rwWorldList', { n }))}</summary><div class="jr-chips">${chips}</div></details>` : ''}
    ${other}
    <div class="jr-sub jr-world-how">${esc(t('rwWorldHow', { total: w.total }))}</div>
  </div>`;
}
// One sentence with the numbers in it, on the clipboard, to paste to a friend and compare.
async function copyWorldStats() {
  const w = worldExplored();
  const text = t('rwWorldShare', { n: w.counted.length, total: w.total, pct: worldPercentText(w.ratio) });
  try { await navigator.clipboard.writeText(text); toast(t('rwWorldCopied')); }
  catch (e) { toast(text, 6000); } // no clipboard access: show the sentence instead so it can still be copied by hand
}

function rewardsState() {
  if (!appData.rewards) appData.rewards = {};
  const r = appData.rewards;
  r.xp = r.xp || 0;
  r.counts = r.counts || {};
  r.badges = r.badges || {};
  r.claimed = r.claimed || {};
  return r;
}
function rewardsCount(badge) { return badge.count ? badge.count() : (rewardsState().counts[badge.counter] || 0); }

// ── RECEIPTS ─────────────────────────────────────────────────────────────────
function rewardsBegin() { return { xp: 0, counts: {}, claims: [] }; }
// True (and remembered) the first time `id` is claimed in `set`; false ever after.
function rewardsClaim(receipt, set, id) {
  const claimed = rewardsState().claimed;
  const s = claimed[set] || (claimed[set] = {});
  if (s[id]) return false;
  s[id] = 1;
  receipt.claims.push([set, id]);
  return true;
}
function rewardsAdd(receipt, kind, n = 1) {
  receipt.xp += (REWARD_XP[kind] || 0) * n;
  const c = REWARD_COUNTER[kind];
  if (c) receipt.counts[c] = (receipt.counts[c] || 0) + n;
}

// Applies a receipt: XP, counters, then whatever it unlocked. opts.sound picks the sound for an
// ordinary gain ('pop', 'tick' or none); a level-up or badge brings its own.
function rewardsCommit(receipt, opts = {}) {
  const r = rewardsState();
  if (!receipt.xp && !Object.keys(receipt.counts).length) { if (opts.sound) sfxPlay(opts.sound); return receipt; }
  const levelBefore = rewardsLevelOf(r.xp);
  r.xp += receipt.xp;
  for (const [k, n] of Object.entries(receipt.counts)) r.counts[k] = (r.counts[k] || 0) + n;
  const levelAfter = rewardsLevelOf(r.xp);
  const badges = rewardsCheckBadges(true);
  persistQuiet();
  rewardsRenderChip();
  if (receipt.xp && !opts.quiet) rewardsFloat(`+${receipt.xp} XP`);
  if (opts.finale) rewardsFinale(opts.finale);
  if (levelAfter > levelBefore) rewardsLevelUp(levelAfter, rewardsRankOf(levelAfter) !== rewardsRankOf(levelBefore), !!opts.finale);
  else if (!opts.finale && !badges.length && opts.sound) sfxPlay(opts.sound);
  badges.forEach(b => rewardsCard(b.icon, t('rwBadgeUnlocked'), t('rwBadge_' + b.id), t('rwBadgeHow_' + b.id), 'chime'));
  return receipt;
}

// Gives back what a receipt granted, for undo. Badges stay: they were earned at the time.
function rewardsRevoke(receipt) {
  if (!receipt) return;
  const r = rewardsState();
  r.xp = Math.max(0, r.xp - receipt.xp);
  for (const [k, n] of Object.entries(receipt.counts)) r.counts[k] = Math.max(0, (r.counts[k] || 0) - n);
  for (const [set, id] of receipt.claims) delete r.claimed[set]?.[id];
  persistQuiet();
  rewardsRenderChip();
}

// One-step awards for actions that can't be undone in place (a delete, naming a person).
function rewardsGain(kind, n = 1, opts = { sound: 'pop' }) {
  const receipt = rewardsBegin();
  rewardsAdd(receipt, kind, n);
  return rewardsCommit(receipt, opts);
}

// Newly reached badges, stamped with today's date. quietly=true leaves the showing to the caller.
function rewardsCheckBadges(quietly) {
  const r = rewardsState();
  const fresh = REWARD_BADGES.filter(b => !r.badges[b.id] && rewardsCount(b) >= b.at);
  fresh.forEach(b => { r.badges[b.id] = Date.now(); });
  if (fresh.length && !quietly) {
    persistQuiet();
    fresh.forEach(b => rewardsCard(b.icon, t('rwBadgeUnlocked'), t('rwBadge_' + b.id), t('rwBadgeHow_' + b.id), 'chime'));
  }
  return fresh;
}

// ── ON SCREEN ────────────────────────────────────────────────────────────────
function rewardsRenderChip() {
  const el = document.getElementById('journeyChip');
  if (!el || !appData) return;
  const { xp } = rewardsState();
  const level = rewardsLevelOf(xp), rank = rewardsRankOf(level);
  const from = rewardsXpForLevel(level), to = rewardsXpForLevel(level + 1);
  el.innerHTML = `<span class="jc-icon">${rwEmblem(rank.icon)}</span><span class="jc-text"><span class="jc-rank">${esc(t('rwRank_' + rank.key))}</span><span class="jc-level">${esc(t('rwLevelN', { n: level }))}</span></span>
    <span class="jc-bar"><span style="width:${Math.round((xp - from) / (to - from) * 100)}%"></span></span>`;
  el.title = t('rwChipTitle', { xp, next: to - xp });
  const mute = document.getElementById('soundToggle');
  if (mute) { const on = appData.settings?.sounds !== false; mute.innerHTML = rwIcon(on ? 'volumeOn' : 'volumeOff'); mute.title = on ? t('rwMute') : t('rwUnmute'); }
}

function rewardsFloat(text) {
  const el = document.createElement('div');
  el.className = 'rw-float';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// Cards for a level-up or a badge, one after another, each gone by itself after a few seconds.
const rewardsCardQueue = [];
let rewardsCardShowing = false;
function rewardsCard(icon, kicker, title, sub, sound) {
  rewardsCardQueue.push({ icon, kicker, title, sub, sound });
  if (!rewardsCardShowing) rewardsNextCard();
}
function rewardsNextCard() {
  const next = rewardsCardQueue.shift();
  if (!next) { rewardsCardShowing = false; return; }
  rewardsCardShowing = true;
  const el = document.createElement('div');
  el.className = 'rw-card';
  el.innerHTML = `<div class="rw-card-icon">${rwEmblem(next.icon)}</div><div><div class="rw-card-kicker">${esc(next.kicker)}</div><div class="rw-card-title">${esc(next.title)}</div>${next.sub ? `<div class="rw-card-sub">${esc(next.sub)}</div>` : ''}</div>`;
  const done = () => { if (!el.isConnected) return; el.remove(); rewardsNextCard(); };
  el.onclick = done;
  document.body.appendChild(el);
  if (next.sound) sfxPlay(next.sound);
  setTimeout(done, 3800);
}

// alongFinale: the end-of-trip finale already brought the confetti and the music.
function rewardsLevelUp(level, newRank, alongFinale) {
  const rank = rewardsRankOf(level);
  if (!alongFinale) celebrationConfetti(document.body);
  rewardsCard(rank.icon, newRank ? t('rwNewRank') : t('rwLevelUp'), newRank ? t('rwRank_' + rank.key) : t('rwLevelN', { n: level }),
    newRank ? t('rwRankSub_' + rank.key) : t('rwLevelUpSub', { rank: t('rwRank_' + rank.key) }), alongFinale ? null : newRank ? 'fanfare' : 'levelUp');
}

// The big moment when a whole trip has been flicked through: the heart takes a bow, two bursts
// of confetti, a fanfare, and any level or badge it brought follows as cards.
function rewardsFinale({ host, tripName }) {
  host = host || document.body;
  host.classList.add('rw-finale');
  setTimeout(() => host.classList.remove('rw-finale'), 2600);
  celebrationConfetti(host);
  setTimeout(() => celebrationConfetti(host), 650);
  sfxPlay('fanfare');
  const { xp } = rewardsState();
  rewardsCard('bigHeart', t('rwTripDoneKicker'), tripName, t('rwTripDoneSub', { xp: REWARD_XP.tripDone, level: rewardsLevelOf(xp) }));
}

// ── JOURNEY PANEL ────────────────────────────────────────────────────────────
function openJourney() {
  const { xp, counts, badges } = rewardsState();
  const level = rewardsLevelOf(xp), rank = rewardsRankOf(level);
  const from = rewardsXpForLevel(level), to = rewardsXpForLevel(level + 1);
  const nextRank = REWARD_RANKS.find(r => r.from > level);
  const ways = [['seen', 'rwWaySeen'], ['like', 'rwWayLike'], ['bin', 'rwWayBin'], ['dup', 'rwWayDup'], ['personNew', 'rwWayPerson'], ['tripDone', 'rwWayTrip']]
    .map(([k, label]) => `<div class="jr-way"><span>${esc(t(label))}</span><strong>+${REWARD_XP[k]}</strong></div>`).join('');
  const badgeHtml = REWARD_BADGES.map(b => {
    const got = badges[b.id], n = Math.min(rewardsCount(b), b.at);
    return `<div class="jr-badge${got ? ' got' : ''}" title="${esc(t('rwBadgeHow_' + b.id))}">
      <div class="jr-badge-icon">${rwEmblem(b.icon)}</div><div class="jr-badge-name">${esc(t('rwBadge_' + b.id))}</div>
      <div class="jr-badge-sub">${got ? esc(fmtDate(got)) : `${n} / ${b.at}`}</div></div>`;
  }).join('');
  document.getElementById('journeyBody').innerHTML = `
    <div class="jr-head"><div class="jr-rank-icon">${rwEmblem(rank.icon)}</div><div style="flex:1">
      <div class="jr-rank">${esc(t('rwRank_' + rank.key))} · ${esc(t('rwLevelN', { n: level }))}</div>
      <div class="jr-bar"><span style="width:${Math.round((xp - from) / (to - from) * 100)}%"></span></div>
      <div class="jr-sub">${esc(t('rwToNext', { xp, next: to - xp, level: level + 1 }))}${nextRank ? ' · ' + esc(t('rwNextRank', { rank: t('rwRank_' + nextRank.key), level: nextRank.from })) : ''}</div>
    </div></div>
    ${worldCardHtml()}
    <div class="modal-sub" style="margin:16px 0 6px">${esc(t('rwWaysTitle'))}</div><div class="jr-ways">${ways}</div>
    <div class="modal-sub" style="margin:16px 0 6px">${esc(t('rwBadgesTitle', { n: Object.keys(badges).length, total: REWARD_BADGES.length }))}</div>
    <div class="jr-badges">${badgeHtml}</div>
    <div class="jr-sub" style="margin-top:12px">${esc(t('rwStats', { seen: counts.seen || 0, likes: counts.likes || 0, binned: counts.binned || 0, dups: counts.dups || 0, trips: counts.trips || 0 }))}</div>`;
  document.getElementById('journeyModal').classList.add('open');
}
function closeJourney() { document.getElementById('journeyModal').classList.remove('open'); }

function toggleSounds() {
  appData.settings.sounds = appData.settings.sounds === false;
  persistQuiet();
  rewardsRenderChip();
  if (appData.settings.sounds) sfxPlay('pop');
}

// ── SOUND ────────────────────────────────────────────────────────────────────
// Synthesized with Web Audio (no audio files, nothing to license): short, soft and low. Never
// while Trove isn't the window in front, and never when switched off (Settings, or the speaker
// next to the level in the sidebar).
let sfxCtx = null;
const SFX_VOLUME = 0.22;
function sfxPlay(name) {
  if (!name || appData?.settings?.sounds === false || document.hidden || !document.hasFocus()) return;
  try {
    sfxCtx = sfxCtx || new AudioContext();
    if (sfxCtx.state === 'suspended') sfxCtx.resume();
    const now = sfxCtx.currentTime + 0.01;
    const master = sfxCtx.createGain();
    master.gain.value = SFX_VOLUME;
    master.connect(sfxCtx.destination);
    const note = (freq, start, dur, { type = 'sine', peak = 0.5, slideTo } = {}) => {
      const o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, now + start);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now + start + dur);
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(peak, now + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      o.connect(g); g.connect(master);
      o.start(now + start); o.stop(now + start + dur + 0.05);
    };
    if (name === 'pop') note(620, 0, 0.09, { slideTo: 330, peak: 0.6 });
    else if (name === 'tick') note(380, 0, 0.05, { type: 'triangle', peak: 0.35 });
    else if (name === 'chime') { note(1318.5, 0, 0.7, { peak: 0.35 }); note(1975.5, 0.09, 0.8, { peak: 0.25 }); }
    else if (name === 'levelUp') [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.085, 0.45, { peak: 0.4 }));
    // Guided Sort's locate mission: a radar lock-on when a photo is placed
    else if (name === 'lock') { note(1760, 0, 0.05, { type: 'square', peak: 0.16 }); note(2349.3, 0.07, 0.05, { type: 'square', peak: 0.16 }); note(2793.8, 0.14, 0.16, { peak: 0.3 }); }
    else if (name === 'fanfare') {
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.1, 0.35, { peak: 0.4 }));
      [523.3, 659.3, 784, 1046.5].forEach(f => note(f, 0.45, 1.3, { peak: 0.22 }));
      note(1568, 0.45, 1.3, { peak: 0.12 });
    }
  } catch (e) { /* no audio device: stay silent */ }
}
