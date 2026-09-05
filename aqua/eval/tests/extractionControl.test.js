/**
 * AQUA Eval — extraction scorer controls (deliberately broken extractors)
 * Blueprint E2 · Constitution L16 (measure, then claim)
 *
 * WHAT THIS ADDS THAT extractionBaseline.test.js DOES NOT
 * ------------------------------------------------------
 * The baseline tests prove the scorer is not accidentally HARSH: feed it
 * synthetic perfect output and it returns 1.0. That is one end of the range.
 *
 * Nothing proved the other end. A scorer wired to a stubbed adapter, or one
 * whose per-level metrics had quietly become constants, would publish the same
 * committed figures on every run and pass every test in this directory. The
 * numbers would be stable, reproducible, fingerprinted — and inert.
 *
 * So: run the WHOLE suite against extractors that are broken in known,
 * specific ways, and assert the metric that should move, moves. This is bite
 * measurement (L16) applied to the measuring device rather than to a fix.
 *
 * COMPOSITION, NOT MODIFICATION (L17)
 * -----------------------------------
 * Each control is `{ ...suite, run }`. The suite, the dataset and the adapter
 * are untouched — a control that required editing the thing it controls would
 * prove nothing about the thing that actually runs.
 *
 * TWO FINDINGS ARE PINNED HERE, AND BOTH ARE UNCOMFORTABLE
 * -------------------------------------------------------
 * They are recorded because they are true, not because they are flattering:
 *
 *   1. A do-nothing extractor scores HIGHER than the real one on
 *      `overall_strict_accuracy` — 0.20 against 0.18. Silence collects all 40
 *      negatives; the real extractor answers them and gets 4 wrong.
 *
 *   2. An extractor that recognises no subjects at all scores IDENTICALLY to
 *      the real one on `overall_strict_accuracy` — 0.18 both ways. Strictness
 *      already fails every positive on predicate, so destroying subject recall
 *      costs the headline nothing.
 *
 * Together: `overall_strict_accuracy` cannot gate a promotion decision. The
 * per-level metrics are not decoration, they are the instrument. The suite's
 * own header says precision is kept out of the average for this reason; these
 * two numbers are what that warning looks like when it is measured.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { runSuite } from '../core/runner.mjs';
import suite from '../suites/extraction-core.suite.mjs';
import { extractWithCurrentEngine } from '../adapters/currentExtractor.mjs';

/** Compose a control over the real suite. Nothing in the suite is modified. */
const control = run => ({ ...suite, run });

/** Emits nothing, ever. Perfect silence. */
const MUTE = control(() => ({
  status: 'ok', actual: { entities: [], facts: [], surfaces: [] },
}));

/** Fires on everything, including the 40 cases whose only right answer is silence. */
const FIREHOSE = control(testCase => ({
  status: 'ok', actual: { entities: [], facts: [{ statement: testCase.text }], surfaces: [] },
}));

/** The real extractor with its entity surfaces thrown away — subject-blind only. */
const SUBJECT_BLIND = control(testCase => ({
  status: 'ok', actual: { ...extractWithCurrentEngine(testCase.text), surfaces: [] },
}));

let real; let mute; let firehose; let blind;

before(async () => {
  [real, mute, firehose, blind] = (await Promise.all(
    [suite, MUTE, FIREHOSE, SUBJECT_BLIND].map(s => runSuite(s)),
  )).map(r => r.result);
});

// ── The controls are real runs ───────────────────────────────────────────────

describe('extraction controls — every control actually executed', () => {
  test('a control that errors is not a control', () => {
    // A broken extractor that THROWS produces status:'error', which the runner
    // correctly refuses to score as a wrong answer. The metrics would then be
    // computed over a partial set and every comparison below would be noise.
    for (const [name, r] of [['mute', mute], ['firehose', firehose], ['subject-blind', blind]]) {
      assert.equal(r.coverage.executed, 200, `${name} did not execute all 200 cases`);
      assert.equal(r.coverage.complete, true, `${name} run was incomplete`);
    }
  });
});

// ── Each control moves the metric it is designed to move ─────────────────────

describe('extraction controls — a broken extractor scores worse where it is broken', () => {
  test('MUTE destroys detection — and the real extractor is measurably above it', () => {
    assert.equal(mute.metrics.detection_recall, 0);
    assert.ok(real.metrics.detection_recall > mute.metrics.detection_recall,
      'a do-nothing extractor matched the real one on detection — the adapter is a stub');
    assert.equal(mute.metrics.subject_recall, 0);
    assert.equal(mute.metrics.fidelity_accuracy, 0);
  });

  test('FIREHOSE destroys precision — every negative becomes a false positive', () => {
    assert.equal(firehose.metrics.silence_on_negatives, 0);
    assert.equal(firehose.metrics.false_positives, real.metrics.negatives);
    assert.ok(real.metrics.silence_on_negatives > firehose.metrics.silence_on_negatives);
  });

  test('FIREHOSE gets PERFECT detection recall — which is exactly why recall cannot stand alone', () => {
    // An extractor that fires on every sentence has flawless recall and is
    // worthless. This project has shipped that failure twice.
    assert.equal(firehose.metrics.detection_recall, 1);
    assert.ok(firehose.metrics.detection_recall > real.metrics.detection_recall);
  });

  test('SUBJECT-BLIND moves subject_recall and NOTHING ELSE', () => {
    // Isolation is the point: if breaking one level moved several metrics, the
    // levels would be entangled and the drop-off shape would be uninterpretable.
    assert.equal(blind.metrics.subject_recall, 0);
    assert.ok(real.metrics.subject_recall > 0);
    for (const key of ['detection_recall', 'fidelity_accuracy', 'silence_on_negatives', 'false_positives']) {
      assert.equal(blind.metrics[key], real.metrics[key], `${key} moved when only subjects were removed`);
    }
  });

  test('every control is strictly worse than the real extractor somewhere', () => {
    // The weakest claim that still has teeth, and the one that fails first if
    // the adapter is ever stubbed: three deliberately damaged extractors must
    // not all produce the real extractor's numbers.
    const worseSomewhere = r => ['detection_recall', 'subject_recall',
      'fidelity_accuracy', 'silence_on_negatives'].some(k => r.metrics[k] < real.metrics[k]);
    for (const [name, r] of [['mute', mute], ['firehose', firehose], ['subject-blind', blind]]) {
      assert.equal(worseSomewhere(r), true, `${name} matched the real extractor on every level`);
    }
  });

  test('neither RECALL control wins both detection and precision — the axes are in tension', () => {
    // MUTE and FIREHOSE are the two that trade on these axes, in opposite
    // directions. If either won both, the two metrics would not be measuring
    // different things and folding precision into an average would be harmless.
    //
    // SUBJECT-BLIND is deliberately excluded: it damages a third level and is
    // by construction identical to the real extractor on both of these — which
    // is asserted directly in the isolation test above, not assumed here.
    for (const [name, r] of [['mute', mute], ['firehose', firehose]]) {
      const bothAtLeast = r.metrics.detection_recall >= real.metrics.detection_recall
        && r.metrics.silence_on_negatives >= real.metrics.silence_on_negatives;
      assert.equal(bothAtLeast, false, `${name} matched or beat the real extractor on both axes`);
    }
  });
});

// ── The two uncomfortable findings, pinned ───────────────────────────────────

describe('extraction controls — overall_strict_accuracy cannot gate a decision', () => {
  test('FINDING: doing nothing scores HIGHER on the headline than the real extractor', () => {
    // 0.20 vs 0.18. Silence banks all 40 negatives. Pinned so that if someone
    // ever proposes gating E6 promotion on this single figure, the counter-
    // example is already in the battery with a number attached.
    assert.ok(mute.metrics.overall_strict_accuracy > real.metrics.overall_strict_accuracy,
      'the headline no longer rewards silence — re-read this test before deleting it');
    assert.equal(mute.metrics.silence_on_negatives, 1);
    assert.equal(mute.metrics.detection_recall, 0);
  });

  test('FINDING: recognising no subjects at all costs the headline nothing', () => {
    // Strictness requires all four levels; predicate is already 0 for every
    // positive, so subject recall is free to collapse without moving it.
    assert.equal(blind.metrics.overall_strict_accuracy, real.metrics.overall_strict_accuracy);
    assert.ok(real.metrics.subject_recall - blind.metrics.subject_recall > 0.5,
      'subject_recall barely moved — it may not be measuring subjects');
  });

  test('the per-level metrics separate all four controls; the headline does not', () => {
    const runs = [real, mute, firehose, blind];
    const headline = new Set(runs.map(r => r.metrics.overall_strict_accuracy));
    const levels = new Set(runs.map(r => [
      r.metrics.detection_recall, r.metrics.subject_recall,
      r.metrics.fidelity_accuracy, r.metrics.silence_on_negatives,
    ].join('|')));

    assert.ok(headline.size < 4, 'the headline now distinguishes all four — the findings above are stale');
    assert.equal(levels.size, 4, 'two different extractors produced identical per-level metrics');
  });
});

// ── The fifth level: what the claim is ABOUT ─────────────────────────────────

/**
 * 🔴 THE CONTROL THAT DID NOT EXIST.
 *
 * The battery above proves the suite can tell a mute extractor from a firehose
 * and a subject-blind one from the real thing. It could not tell an extractor
 * that names the wrong THING, because the object was never compared.
 *
 * Measured on `identity-019` — "I own the billing service." — an emitted object
 * of `"billing service"` and one of `"the moon"` produced byte-identical
 * scores across all four levels. That blindness is why a registry contradiction
 * (`owns`, `depends_on`, `blocks` typed to take literals while declaring
 * inverses) survived for as long as the registry did: nothing measured the part
 * of the claim it corrupted.
 *
 * BITE, MEASURED (revert the named property → count failures):
 *   object_accuracy computed at all       → 3 fail
 *   the unmatchable ceiling published     → 2 fail
 *   `correct` left additive-only          → 1 fail
 */
describe('extraction controls — the object is scored', () => {
  const CASE = 'identity-019';
  const one = (over = {}) => {
    const tc = suite.cases.find(c => c.id === CASE);
    return suite.score(tc, {
      facts: [{
        statement: tc.text, subject: 'SELF', predicate: 'owns',
        // ⚠️ THE REAL ADAPTER SHAPE. `e6Extractor.toFact` passes the contract's
        // object straight through, and a validated object is `{ entity: … }` or
        // `{ literal: … }` — never a bare string. This fixture used a string,
        // which is what the SUITE wanted rather than what the ADAPTER produces,
        // so the metric shipped stringifying `[object Object]` and its first
        // real run reported object_accuracy 0 against a 78/92 ceiling.
        polarity: 'asserted', modality: 'fact', object: { entity: 'billing service' }, ...over,
      }],
      surfaces: ['__self__'],   // subjectFound() maps gold `SELF` to this sentinel
    });
  };

  test('THE ORIGINAL BLINDNESS: a wrong object used to score identically', () => {
    const right = one();
    const wrong = one({ object: { entity: 'the moon' } });
    assert.equal(right.objectHits, 1);
    assert.equal(wrong.objectHits, 0, 'the object is still not compared');
    // Everything the suite scored BEFORE remains identical between the two —
    // which is the blindness, stated as an assertion rather than a memory.
    for (const k of ['subjectHits', 'predicateHits', 'fidelityHits', 'correct']) {
      assert.equal(right[k], wrong[k], `${k} unexpectedly distinguishes the object`);
    }
  });

  test('BOTH object shapes score — the wrapped one and the bare one', () => {
    // E6 emits `{ entity: … }`; the regex floor emits a bare string. A metric
    // that only understood one of them would report the other as total failure,
    // which is exactly what happened on the first real run.
    assert.equal(one({ object: { entity: 'billing service' } }).objectHits, 1);
    assert.equal(one({ object: { literal: 'billing service' } }).objectHits, 1);
    assert.equal(one({ object: 'billing service' }).objectHits, 1, 'the floor lane shape stopped matching');
  });

  test('matching is EXACT after normalisation, not fuzzy', () => {
    // A containment or token rule would score "commuting by metro" against
    // "commute by metro" and the metric would measure a labelling convention.
    assert.equal(one({ object: { entity: 'Billing Service' } }).objectHits, 1, 'case should not matter');
    assert.equal(one({ object: { entity: 'the billing service' } }).objectHits, 1, 'a leading article should not matter');
    assert.equal(one({ object: { entity: 'billing' } }).objectHits, 0, 'a prefix is not a match');
  });

  test('the CEILING is published, so the number is read honestly', () => {
    // 34 gold objects are normalised forms absent from their own sentence, and
    // S4 gate ② forces an emitted object to be verbatim in the quote. Those
    // claims are unreachable, so 1.0 is not the target and the report must say
    // so in a number rather than a comment.
    const m = suite.metrics(suite.cases.map(c => suite.score(c, { facts: [], surfaces: [] })));
    assert.equal(m.n_object_unmatchable, 34);
    assert.ok(m.n_object_unmatchable > 0 && m.n_object_unmatchable < m.labelled_claims);
  });

  test('ADDITIVE ONLY — the headline is untouched', () => {
    // ⚠️ THIS TEST DID NOT BITE ON ITS FIRST WRITING. It compared two cases
    // built from `facts: []`, where `emitted` is false and `correct` is false
    // whatever the object does — so folding the object into `correct` passed.
    // A test that survives the defect it guards is not a test (L16).
    //
    // The fixture below is a claim that satisfies all four original levels, so
    // `correct` is genuinely TRUE. Only then does spoiling the object have
    // anywhere to show up.
    const right = one();
    assert.equal(right.correct, true,
      'the fixture no longer scores correct — this test cannot detect the fold');
    assert.equal(one({ object: { entity: 'the moon' } }).correct, true,
      '`correct` now depends on the object — every historical run is incomparable');
  });
});
