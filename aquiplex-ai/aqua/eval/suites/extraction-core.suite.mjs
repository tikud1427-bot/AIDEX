/**
 * AQUA Eval — extraction quality, graded
 * Blueprint E2/PR-3
 *
 * The first answer this project has ever had to **"is it right?"**
 *
 * FOUR LEVELS, BECAUSE ONE NUMBER WOULD BE USELESS
 * ------------------------------------------------
 * The dataset labels full claims — subject, predicate, object, polarity,
 * modality, time. The current extractor emits verbatim sentences plus an
 * entity list. Scored as a single pass/fail it reports near zero, and a
 * near-zero baseline says nothing about WHERE the gap is while making any
 * replacement look miraculous.
 *
 * So it is graded, and the shape of the drop-off is the finding:
 *
 *   detection   a sentence carrying a claim produced SOMETHING
 *   subject     the claim's subject was recognised as an entity
 *   predicate   the relation was captured
 *   fidelity    polarity + modality + time were captured
 *
 * PRECISION IS SCORED SEPARATELY, ON THE NEGATIVES
 * ------------------------------------------------
 * 40 cases carry no claims. An extractor that fires on everything gets perfect
 * detection recall and is worthless. This project has shipped that failure
 * twice, so silence on a negative is scored as its own metric rather than
 * folded into an average that hides it.
 *
 * WHAT "CORRECT" MEANS FOR THE RUNNER
 * -----------------------------------
 * `correct` is the STRICTEST level — a positive case is correct only if
 * detection, subject, predicate and fidelity all hold; a negative is correct
 * if nothing was emitted. Overall accuracy will therefore read very low, and
 * that is the honest headline. The per-level metrics are where the diagnosis
 * lives.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractWithCurrentEngine, surfacesOf } from '../adapters/currentExtractor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../datasets/extraction-core.v1.json'), 'utf8'));

/** Did the extractor recognise this claim's subject as an entity? */
function subjectFound(claim, surfaces) {
  if (claim.s === 'SELF') return surfaces.has('__self__');
  return surfaces.has(claim.s.toLowerCase());
}

/**
 * Compare objects the way the claim substrate would: trimmed, case-folded.
 *
 * 🔴 UNWRAPS THE CLAIM SHAPE, BECAUSE THE FIRST VERSION DID NOT AND SCORED ZERO.
 *
 * A contract-validated object is `{ entity: 'billing service' }` or
 * `{ literal: 'commuting by metro' }` — never a bare string. `e6Extractor`
 * passes it through untouched. Stringifying that gives `[object Object]`, which
 * matches no gold object ever, so the metric's first real run reported
 * `object_accuracy: 0` against a 78/92 ceiling and looked like a devastating
 * extractor finding. It was a devastating finding about the metric.
 *
 * The control that should have caught it fed `object: 'billing service'` — a
 * plain string, the shape the suite wanted rather than the shape the adapter
 * produces. A fixture that does not match reality tests the fixture.
 *
 * The floor lane emits bare strings, so both shapes have to work.
 */
const normObject = (v) => {
  const raw = (v && typeof v === 'object')
    ? (v.entity ?? v.literal ?? v.quantity ?? v.time ?? '')
    : v;
  return String(raw ?? '').trim().toLowerCase().replace(/^the\s+/, '');
};

export default {
  id: 'extraction-core',
  title: 'extraction quality — current engine vs claim labels',
  about: [
    'Drives the production conversation-extraction lane (extractConversationEntities →',
    'resolveEntities → buildConversationFacts) over 200 labelled sentences and grades it at',
    'four levels: detection, subject, predicate, fidelity. Precision is measured separately',
    'on 40 negative cases. This is the baseline E6 has to beat; the shape of the drop-off',
    'across the four levels is the diagnosis, not the single accuracy figure.',
  ].join('\n'),

  cases: DS.cases,

  async run(testCase) {
    const result = extractWithCurrentEngine(testCase.text);
    return { status: 'ok', actual: { ...result, surfaces: [...surfacesOf(result)] } };
  },

  score(testCase, actual) {
    const emitted = actual.facts.length > 0;
    const surfaces = new Set(actual.surfaces);

    // ── negatives: the only right answer is silence ─────────────────────────
    if (testCase.cat === 'negative') {
      return { correct: !emitted, kind: 'negative', emitted, cat: testCase.cat };
    }

    // ── positives: four levels ──────────────────────────────────────────────
    const claims = testCase.claims;
    const subjectHits = claims.filter(c => subjectFound(c, surfaces)).length;

    // The lane emits a verbatim statement and an entity list. There is no
    // predicate field and no polarity/modality/time field anywhere in the
    // output, so these are structurally unreachable rather than merely wrong.
    // Computed from the output shape rather than hardcoded, so the day E6
    // starts emitting them this begins scoring without a code change.
    const predicateHits = claims.filter(c =>
      actual.facts.some(f => typeof f.predicate === 'string' && f.predicate === c.p)).length;
    const fidelityHits = claims.filter(c =>
      actual.facts.some(f =>
        f.polarity === c.polarity &&
        f.modality === c.modality &&
        (c.time ? Boolean(f.time || f.validFrom || f.validTo) : true))).length;

    // ── the fifth level: WHAT THE CLAIM IS ABOUT ────────────────────────────
    //
    // 🔴 THE OBJECT WAS NEVER SCORED, AND THAT IS WHY A REGISTRY CONTRADICTION
    // SURVIVED AS LONG AS THE REGISTRY.
    //
    // Measured, not assumed: for `identity-019` — "I own the billing service."
    // — an emitted object of `"billing service"` and an emitted object of
    // `"the moon"` produced byte-identical scores. Every one of the four levels
    // above is blind to it. A system that got every object wrong graded exactly
    // as well as one that got them all right, so the only signal that would
    // have exposed `owns`/`depends_on`/`blocks` taking the wrong object kind
    // did not exist.
    //
    // ADDITIVE ONLY. `correct` is deliberately NOT extended — folding a new
    // level into the headline would move every historical number and make this
    // run incomparable to every previous one. It is published beside them.
    //
    // EXACT MATCH AFTER NORMALISATION, and no fuzzier. A containment or token
    // rule would score `"commuting by metro"` against `"commute by metro"` and
    // the number would then be measuring a labelling convention. The honest
    // ceiling is published instead — see `n_object_unmatchable` below.
    const objectHits = claims.filter(c =>
      actual.facts.some(f => normObject(f.object) === normObject(c.o))).length;

    return {
      correct: emitted && subjectHits === claims.length
               && predicateHits === claims.length && fidelityHits === claims.length,
      kind: 'positive',
      cat: testCase.cat,
      emitted,
      claims: claims.length,
      subjectHits,
      predicateHits,
      fidelityHits,
      objectHits,
      // Gold objects that no gate-obeying extractor can equal: S4 gate ② forces
      // an emitted object to appear verbatim in the quote, and 34 of the 167
      // gold objects are normalised forms absent from their own sentence
      // ("commuting by metro" from "I commute by metro"). Counted per case so
      // the ceiling on `object_accuracy` is computed, never estimated.
      objectUnmatchable: claims.filter(c =>
        c.o && !String(testCase.text).toLowerCase().includes(String(c.o).toLowerCase())).length,
    };
  },

  metrics(scored) {
    const pos = scored.filter(s => s.kind === 'positive');
    const neg = scored.filter(s => s.kind === 'negative');
    const claims = pos.reduce((n, s) => n + s.claims, 0);
    const ratio = (a, b) => (b ? a / b : 0);

    const byCat = {};
    for (const s of pos) {
      byCat[s.cat] ??= { n: 0, detected: 0 };
      byCat[s.cat].n++;
      if (s.emitted) byCat[s.cat].detected++;
    }

    return {
      // headline — strictest, all four levels
      overall_strict_accuracy: ratio(scored.filter(s => s.correct).length, scored.length),

      // the four levels
      detection_recall: ratio(pos.filter(s => s.emitted).length, pos.length),
      subject_recall: ratio(pos.reduce((n, s) => n + s.subjectHits, 0), claims),
      predicate_accuracy: ratio(pos.reduce((n, s) => n + s.predicateHits, 0), claims),
      fidelity_accuracy: ratio(pos.reduce((n, s) => n + s.fidelityHits, 0), claims),
      // Additive (E2). Read it with the ceiling beside it: `n_object_unmatchable`
      // gold objects cannot be produced by an extractor obeying S4 gate ②, so
      // the best achievable score is (labelled_claims - n_object_unmatchable)
      // / labelled_claims, not 1.0.
      object_accuracy: ratio(pos.reduce((n, s) => n + s.objectHits, 0), claims),
      n_object_unmatchable: pos.reduce((n, s) => n + (s.objectUnmatchable ?? 0), 0),

      // precision, kept separate so it cannot hide inside an average
      silence_on_negatives: ratio(neg.filter(s => !s.emitted).length, neg.length),
      false_positives: neg.filter(s => s.emitted).length,

      // per-category detection — where the misses actually are
      ...Object.fromEntries(Object.entries(byCat).sort()
        .map(([cat, v]) => [`detection_${cat}`, ratio(v.detected, v.n)])),

      // ── Denominators, so a 0/0 is distinguishable from a measured 0.0 ──
      //
      // `ratio()` returns 0 when the denominator is 0, which is right for a
      // metric but wrong for a DECISION. The E6 promotion gate read
      // `detection_negation: 0` on a slice containing no negation cases and
      // returned DO NOT PROMOTE. Publishing the counts alongside the rates
      // lets a caller tell "scored zero" from "was never asked".
      ...Object.fromEntries(Object.entries(byCat).sort()
        .map(([cat, v]) => [`n_cases_${cat}`, v.n])),

      positives: pos.length,
      negatives: neg.length,
      labelled_claims: claims,
    };
  },
};
