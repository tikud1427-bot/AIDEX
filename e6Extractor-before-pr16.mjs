/**
 * AQUA Eval — adapter for the E6 extraction pipeline (Blueprint E6/PR-11).
 *
 * Runs a segment through every stage built in PR-1 … PR-7 and returns the
 * SAME `{ facts, surfaces }` shape `currentExtractor.mjs` returns, so
 * `extraction-core.v1` can score both without a second scorer.
 *
 *   segmentMessage      PR-1  exact char ranges
 *   gateSegment         PR-2  is this worth extracting
 *   extractSegment      PR-5  cached, bounded, pinned-if-the-transport-allows
 *   parseExtractionResponse PR-4  shape gate
 *   validateAgainstSegment  PR-6  the seven S4 gates
 *   applyTemporal       PR-7  valid_from/valid_to + precision
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
import { segmentMessage } from '../../src/brain/understanding/segmentation.js';
import { gateSegment } from '../../src/brain/understanding/candidateGate.js';
import { extractSegment } from '../../src/brain/understanding/extractionClient.js';
import { validateAgainstSegment, OUTCOME } from '../../src/brain/understanding/claimValidator.js';
import { applyTemporal } from '../../src/brain/understanding/temporalNormaliser.js';

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

  const segments = segmentMessage(text);
  const facts = [];
  const surfaces = new Set();
  const stats = {
    segments: segments.length, gated: 0, called: 0, cached: 0,
    parsed: 0, admitted: 0, proposed: 0, discarded: 0,
    byGate: {}, models: new Set(), errors: 0,
  };

  for (const seg of segments) {
    const gate = gateSegment(seg.text);
    if (!gate.admit) continue;
    stats.gated++;

    const out = await extractSegment(seg.text, opts);
    if (out.cached) stats.cached++; else stats.called++;
    if (out.error) { stats.errors++; continue; }
    if (out.model) stats.models.add(out.model);
    stats.parsed += out.claims.length;

    // 🔴 THE PROPOSAL QUEUE WOULD NEVER FILL WITHOUT THIS, and the shadow run
    // is what surfaced it. Two stages disagree about unknown predicates:
    //
    //   PR-4 contract  unregistered → REJECT, the claim is dropped
    //   PR-6 gate ③    unregistered → PROPOSE, queued with a usage count
    //
    // The contract runs first, so gate ③'s propose path is unreachable through
    // the pipeline and S3's "unknown predicate → propose, don't force" never
    // happens. The contract is not wrong to refuse — it is the shape gate and
    // an unregistered predicate is not a storable claim — but refusing is not
    // the same as forgetting, and dropping the signal loses the one piece of
    // evidence that the vocabulary is too small.
    //
    // The contract preserves both the reason and the raw claim, so the
    // pipeline can route them. Fixed HERE rather than in either shipped
    // module: changing the contract to emit proposals would widen its remit
    // from shape to policy, and that is a decision with its own blast radius.
    for (const r of out.rejected ?? []) {
      if (String(r.reason ?? '').startsWith('unregistered-predicate')) stats.proposed++;
      else { stats.discarded++; stats.byGate.contract = (stats.byGate.contract ?? 0) + 1; }
    }

    for (const raw of out.claims) {
      const v = validateAgainstSegment(raw, seg.text, {
        sourceTier: opts.sourceTier ?? 'chat',
        modelConfidence: raw.confidenceExtraction ?? raw.confidence_extraction ?? 0.5,
      });
      if (v.outcome === OUTCOME.PROPOSE) { stats.proposed++; continue; }
      if (v.outcome !== OUTCOME.ADMIT) {
        stats.discarded++;
        stats.byGate[v.gate] = (stats.byGate[v.gate] ?? 0) + 1;
        continue;
      }
      stats.admitted++;

      const dated = applyTemporal(v.claim, opts.assertedAt ?? EVAL_ASSERTED_AT);
      facts.push(toFact(dated));

      // The suite matches a labelled subject against SURFACE FORMS. `self` is
      // the pipeline's internal token for the speaker and appears in no
      // corpus, so it is expanded to the first-person forms the labels use —
      // otherwise every self-claim scores a subject miss for a reason that has
      // nothing to do with extraction quality.
      if (dated.subject === 'self') { for (const s of ['self', 'I', 'me', 'my', 'we', 'our']) surfaces.add(s); }
      else surfaces.add(dated.subject);
      if (dated.objectKind === 'entity' && dated.object?.entity) surfaces.add(dated.object.entity);
    }
  }

  return {
    available: true,
    facts,
    surfaces: [...surfaces],
    stats: { ...stats, models: [...stats.models] },
  };
}
