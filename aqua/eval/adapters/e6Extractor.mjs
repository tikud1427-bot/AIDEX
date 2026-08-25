/**
 * AQUA Eval — adapter for the E6 extraction pipeline (Blueprint E6/PR-11).
 *
 * Runs a segment through every stage built in PR-1 … PR-7 and returns the
 * SAME `{ facts, surfaces }` shape `currentExtractor.mjs` returns, so
 * `extraction-core.v1` can score both without a second scorer.
 *
 * It runs NOTHING itself: `runUnderstandingPipeline` (S0 → S5) does the work,
 * and this maps its output into the `{ facts, surfaces }` shape the suite
 * scores. Keeping the composition in `src/` is what makes the shadow numbers
 * describe the code that would actually ship.
 *
 * WHY IT REUSES THE EXISTING SUITE RATHER THAN BRINGING ITS OWN
 * -------------------------------------------------------------
 * `extraction-core.suite.mjs` already computes `predicateHits` and
 * `fidelityHits` from the OUTPUT SHAPE, with a comment saying it does so "so
 * the day E6 starts emitting them this begins scoring without a code change".
 * A second scorer written for the new extractor would be a scorer written by
 * the person hoping it wins, and the committed baseline — predicate 0.0%,
 * fidelity 0.0% — would no longer be comparable to anything.
 *
 * So: same 200 cases, same four levels, same arithmetic. Only the extractor
 * changes.
 *
 * ⚠️ IT CANNOT RUN WITHOUT A PROVIDER, AND SAYS SO RATHER THAN SCORING ZERO.
 * A pipeline with no transport emits no claims, which the suite would score as
 * detection 0.0% — a number indistinguishable from a catastrophically bad
 * extractor. `extractE6` therefore returns `available: false` and the harness
 * refuses to publish, instead of reporting the absence of a key as a result.
 */
import { runUnderstandingPipeline } from '../../src/brain/understanding/pipeline.js';

/** A fixed anchor so a re-run on a different day produces identical output. */
export const EVAL_ASSERTED_AT = '2026-08-24T10:00:00.000Z';

/**
 * Map one validated claim to the fact shape `extraction-core` scores.
 *
 * The suite reads `f.predicate`, `f.polarity`, `f.modality` and
 * `f.time || f.validFrom || f.validTo`, and matches subjects against
 * `surfaces`. Anything not in that list is invisible to scoring, so this is
 * deliberately narrow — a fact object carrying extra fields would invite the
 * belief that they were measured.
 */
function toFact(claim) {
  return {
    statement: claim.statementText ?? claim.statement_text ?? '',
    predicate: claim.predicate,
    polarity: claim.polarity ?? 'asserted',
    modality: claim.modality ?? 'fact',
    validFrom: claim.validFrom ?? null,
    validTo: claim.validTo ?? null,
    time: claim.timePrecision && claim.timePrecision !== 'none' ? claim.timePrecision : null,
    subject: claim.subject,
    object: claim.object,
  };
}

/**
 * Run the E6 pipeline over one text.
 *
 * @param {string} text
 * @param {object} opts
 * @param {Function} opts.callModel  the transport. REQUIRED — see the header.
 * @param {string} [opts.modelPin]
 * @param {string} [opts.sourceTier] defaults to `chat`, which is what a
 *   conversational eval corpus actually is. Claiming `explicit` would raise
 *   every confidence ceiling and flatter the run.
 * @returns {Promise<{available:boolean, facts:object[], surfaces:string[], stats:object}>}
 */
export async function extractE6(text, opts = {}) {
  if (typeof opts.callModel !== 'function') {
    return { available: false, facts: [], surfaces: [], stats: { reason: 'no-transport' } };
  }

  // DELEGATES to the production pipeline. It used to compose the stages here,
  // which meant the shadow run measured an arrangement that existed only in
  // the eval harness — L12's failure in the place it would be least visible,
  // because the numbers would look real while describing something never
  // shipped. Two compositions would also have drifted the first time a stage
  // changed, and the eval would have kept reporting on the old one.
  const run = await runUnderstandingPipeline(text, {
    ...opts,
    assertedAt: opts.assertedAt ?? EVAL_ASSERTED_AT,
    sourceTier: opts.sourceTier ?? 'chat',
  });

  const facts = [];
  const surfaces = new Set();
  for (const claim of run.claims) {
    facts.push(toFact(claim));

    // The suite matches labelled subjects against SURFACE FORMS. `self` is the
    // pipeline's internal token for the speaker and appears in no corpus, so
    // it expands to the first-person forms the labels use — otherwise every
    // self-claim scores a subject miss for a reason unrelated to extraction
    // quality. This is an eval-shape concern, which is why it lives here and
    // not in the pipeline.
    if (claim.subject === 'self') { for (const t of ['self', 'I', 'me', 'my', 'we', 'our']) surfaces.add(t); }
    else surfaces.add(claim.subject);
    if (claim.objectKind === 'entity' && claim.object?.entity) surfaces.add(claim.object.entity);
  }

  return { available: true, facts, surfaces: [...surfaces], stats: run.stats };
}
