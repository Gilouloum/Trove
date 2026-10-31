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
// Loaded before renderer.js, like photobook.js; reads renderer.js's globals only when called.

// The proposal (2026-10-31), tuned so a first duel pays at once, the first level-up comes after
// about ten duels, and one fully picked 400-photo trip reaches the second rank.
const REWARD_XP = { duel: 5, single: 2, kept: 3, dup: 10, personNew: 25, personMore: 5, bookDone: 150 };
const REWARD_COUNTER = { duel: 'duels', single: 'singles', kept: 'kept', dup: 'dups', personNew: 'people', bookDone: 'books' };
// Level L starts at 25 * (L-1) * L XP: 50, 150, 300, 500... each level a little longer than the last.
function rewardsXpForLevel(level) { return 25 * (level - 1) * level; }
function rewardsLevelOf(xp) { let l = 1; while (rewardsXpForLevel(l + 1) <= xp) l++; return l; }
const REWARD_RANKS = [
  { key: 'tourist', from: 1, icon: '🎒' },
  { key: 'wanderer', from: 5, icon: '🥾' },
  { key: 'voyager', from: 10, icon: '⛵' },
  { key: 'globetrotter', from: 15, icon: '🌍' },
  { key: 'legend', from: 20, icon: '🏔️' },
];
function rewardsRankOf(level) { return REWARD_RANKS.filter(r => level >= r.from).pop(); }
// count() reads the live library for badges about it rather than about actions (Liked).
const REWARD_BADGES = [
  { id: 'firstPick', icon: '⚔️', counter: 'duels', at: 1 },
  { id: 'sharpEye', icon: '🎯', counter: 'duels', at: 100 },
  { id: 'picky', icon: '🧐', counter: 'duels', at: 1000 },
  { id: 'firstBook', icon: '📖', counter: 'books', at: 1 },
  { id: 'bookshelf', icon: '📚', counter: 'books', at: 5 },
  { id: 'curator', icon: '🖼️', counter: 'kept', at: 250 },
  { id: 'firstSweep', icon: '🧹', counter: 'dups', at: 1 },
  { id: 'cleanSweep', icon: '✨', counter: 'dups', at: 100 },
  { id: 'familiarFaces', icon: '👋', counter: 'people', at: 5 },
  { id: 'bigHeart', icon: '❤️', count: () => appData.files.filter(f => f.bestOf).length, at: 50 },
];

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
  el.innerHTML = `<span class="jc-icon">${rank.icon}</span><span class="jc-text"><span class="jc-rank">${esc(t('rwRank_' + rank.key))}</span><span class="jc-level">${esc(t('rwLevelN', { n: level }))}</span></span>
    <span class="jc-bar"><span style="width:${Math.round((xp - from) / (to - from) * 100)}%"></span></span>`;
  el.title = t('rwChipTitle', { xp, next: to - xp });
  const mute = document.getElementById('soundToggle');
  if (mute) { const on = appData.settings?.sounds !== false; mute.textContent = on ? '🔊' : '🔇'; mute.title = on ? t('rwMute') : t('rwUnmute'); }
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
  el.innerHTML = `<div class="rw-card-icon">${next.icon}</div><div><div class="rw-card-kicker">${esc(next.kicker)}</div><div class="rw-card-title">${esc(next.title)}</div>${next.sub ? `<div class="rw-card-sub">${esc(next.sub)}</div>` : ''}</div>`;
  const done = () => { if (!el.isConnected) return; el.remove(); rewardsNextCard(); };
  el.onclick = done;
  document.body.appendChild(el);
  if (next.sound) sfxPlay(next.sound);
  setTimeout(done, 3800);
}

// alongFinale: the photobook finale already brought the confetti and the music.
function rewardsLevelUp(level, newRank, alongFinale) {
  const rank = rewardsRankOf(level);
  if (!alongFinale) photobookConfetti(document.body);
  rewardsCard(rank.icon, newRank ? t('rwNewRank') : t('rwLevelUp'), newRank ? t('rwRank_' + rank.key) : t('rwLevelN', { n: level }),
    newRank ? t('rwRankSub_' + rank.key) : t('rwLevelUpSub', { rank: t('rwRank_' + rank.key) }), alongFinale ? null : newRank ? 'fanfare' : 'levelUp');
}

// The big moment when a trip's photobook is done: the book takes a bow, two bursts of confetti,
// a fanfare, and any level or badge it brought follows as cards.
function rewardsFinale({ host, tripName }) {
  host = host || document.body;
  host.classList.add('rw-finale');
  setTimeout(() => host.classList.remove('rw-finale'), 2600);
  photobookConfetti(host);
  setTimeout(() => photobookConfetti(host), 650);
  sfxPlay('fanfare');
  const { xp } = rewardsState();
  rewardsCard('📖', t('rwBookDoneKicker'), tripName, t('rwBookDoneSub', { xp: REWARD_XP.bookDone, level: rewardsLevelOf(xp) }));
}

// ── JOURNEY PANEL ────────────────────────────────────────────────────────────
function openJourney() {
  const { xp, counts, badges } = rewardsState();
  const level = rewardsLevelOf(xp), rank = rewardsRankOf(level);
  const from = rewardsXpForLevel(level), to = rewardsXpForLevel(level + 1);
  const nextRank = REWARD_RANKS.find(r => r.from > level);
  const ways = [['duel', 'rwWayDuel'], ['single', 'rwWaySingle'], ['kept', 'rwWayKept'], ['dup', 'rwWayDup'], ['personNew', 'rwWayPerson'], ['bookDone', 'rwWayBook']]
    .map(([k, label]) => `<div class="jr-way"><span>${esc(t(label))}</span><strong>+${REWARD_XP[k]}</strong></div>`).join('');
  const badgeHtml = REWARD_BADGES.map(b => {
    const got = badges[b.id], n = Math.min(rewardsCount(b), b.at);
    return `<div class="jr-badge${got ? ' got' : ''}" title="${esc(t('rwBadgeHow_' + b.id))}">
      <div class="jr-badge-icon">${b.icon}</div><div class="jr-badge-name">${esc(t('rwBadge_' + b.id))}</div>
      <div class="jr-badge-sub">${got ? esc(fmtDate(got)) : `${n} / ${b.at}`}</div></div>`;
  }).join('');
  document.getElementById('journeyBody').innerHTML = `
    <div class="jr-head"><div class="jr-rank-icon">${rank.icon}</div><div style="flex:1">
      <div class="jr-rank">${esc(t('rwRank_' + rank.key))} · ${esc(t('rwLevelN', { n: level }))}</div>
      <div class="jr-bar"><span style="width:${Math.round((xp - from) / (to - from) * 100)}%"></span></div>
      <div class="jr-sub">${esc(t('rwToNext', { xp, next: to - xp, level: level + 1 }))}${nextRank ? ' · ' + esc(t('rwNextRank', { rank: t('rwRank_' + nextRank.key), level: nextRank.from })) : ''}</div>
    </div></div>
    <div class="modal-sub" style="margin:16px 0 6px">${esc(t('rwWaysTitle'))}</div><div class="jr-ways">${ways}</div>
    <div class="modal-sub" style="margin:16px 0 6px">${esc(t('rwBadgesTitle', { n: Object.keys(badges).length, total: REWARD_BADGES.length }))}</div>
    <div class="jr-badges">${badgeHtml}</div>
    <div class="jr-sub" style="margin-top:12px">${esc(t('rwStats', { duels: counts.duels || 0, kept: counts.kept || 0, dups: counts.dups || 0, books: counts.books || 0 }))}</div>`;
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
    else if (name === 'fanfare') {
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.1, 0.35, { peak: 0.4 }));
      [523.3, 659.3, 784, 1046.5].forEach(f => note(f, 0.45, 1.3, { peak: 0.22 }));
      note(1568, 0.45, 1.3, { peak: 0.12 });
    }
  } catch (e) { /* no audio device: stay silent */ }
}
