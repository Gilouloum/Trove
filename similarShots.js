// ── SIMILAR-SHOT GROUPING ──────────────────────────────────────────────────────
// Groups near-identical shots of the same moment (the "ten photos of the same view" problem)
// so the photobook duels can compare them two at a time. Wider than bursts (renderer.js's
// BURST_GAP_MS, frames under 2s apart), much narrower than "same topic" clustering (main.js's
// suggest-groups): two shots belong together only if they were taken close in time AND look
// nearly the same. Either signal alone is wrong too often - a 2s gap can still be a different
// subject, and a similar-looking view of the same lake from the next day is a different shot.
//
// Runs in main.js (where the CLIP embeddings live) and in scripts/preview-similar-shots.js,
// which renders the groups for a real library so the thresholds can be judged by eye.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SimilarShots = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Calibrated on a real library (~2,000 trip photos, consecutive pairs, CLIP image-vs-image
  // cosine): pairs under 2s apart have a median similarity of 0.95, under 30s 0.87, under 10min
  // 0.77, over 10min 0.67. So the further apart two shots are, the more alike they must look,
  // and past MAX_GAP_MS they are never the same moment however alike they look (same view,
  // different hour).
  const STEPS = [
    { maxGapMs: 30 * 1000, minSim: 0.88 },
    { maxGapMs: 2 * 60 * 1000, minSim: 0.91 },
    { maxGapMs: 10 * 60 * 1000, minSim: 0.93 },
  ];
  const MAX_GAP_MS = STEPS[STEPS.length - 1].maxGapMs;
  // A group can drift: A looks like B, B like C, but A and C are different views (a slow pan,
  // walking along a coastline). A newcomer must also be reasonably close to the group as a whole.
  const MIN_GROUP_AVG_SIM = 0.86;

  function minSimForGap(gapMs, strictness) {
    for (const s of STEPS) if (gapMs <= s.maxGapMs) return s.minSim + strictness;
    return Infinity;
  }

  // items: [{ id, t }] with t a capture time in ms, in any order.
  // sim(idA, idB): cosine similarity, or null when either side has no embedding yet.
  // strictness: shifts every similarity bar up (positive, tighter groups) or down (looser).
  // Returns every item exactly once, as groups in capture order; a lone shot is a group of one.
  function groupSimilarShots(items, sim, { strictness = 0 } = {}) {
    const sorted = items.filter(it => it && it.t).slice().sort((a, b) => a.t - b.t);
    const groups = [];
    let open = []; // groups whose last shot is still within MAX_GAP_MS of the current one
    for (const it of sorted) {
      open = open.filter(g => it.t - g[g.length - 1].t <= MAX_GAP_MS);
      let best = null, bestScore = -Infinity;
      for (const g of open) {
        let passes = false, sum = 0, n = 0;
        for (const m of g) {
          const s = sim(m.id, it.id);
          if (s == null) continue;
          sum += s; n++;
          if (s >= minSimForGap(it.t - m.t, strictness)) passes = true;
        }
        if (!passes || !n) continue;
        const avg = sum / n;
        if (avg < MIN_GROUP_AVG_SIM + strictness) continue;
        if (avg > bestScore) { bestScore = avg; best = g; }
      }
      if (best) best.push(it);
      else { const g = [it]; groups.push(g); open.push(g); }
    }
    return groups.map(g => g.map(it => it.id));
  }

  return { groupSimilarShots, MAX_GAP_MS };
});
