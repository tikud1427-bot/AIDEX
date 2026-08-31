/**
 * The E6 shadow harness — the five defects the first real run exposed.
 *
 * That run reported `subject_recall 0%`, `silence_on_negatives 0%`,
 * `negation 0% FAIL` and a verdict of DO NOT PROMOTE. Four of those five
 * numbers were harness defects, not extraction defects, and every one of them
 * was invisible to the existing tests — reverting each fix left the whole
 * `e6Shadow.test.js` suite green. That is what this file is for.
 *
 * BITE, MEASURED (revert the named change → count failures):
 *   `__self__` sentinel in the E6 adapter    → 3 fail
 *   stratified `--limit`                     → 4 fail
 *   0/0 reports null, not 0.0                → 3 fail
 *   partial runs refuse baseline comparison  → 2 fail
 *   discards keyed by gate AND reason        → 2 fail
 *   noise floor on the regression check      → 2 fail
 *   unmeasured noise returns null, not false → 3 fail
 *
 * ONE THING HERE IS NOT PINNED AND SAYS SO. `--repeat` clears the extraction
 * cache between passes; without that, repeats replay pass 1 and report a spread
 * of 0.000 — a confident wrong answer to the exact question --repeat asks.
 * Proving it needs a provider, which this environment does not have, so it is
 * declared rather than claimed. A pin whose stated bite is zero is worse than
 * no pin.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stratify, evaluatePromotion, spread, isRealRegression,
  MAX_PASS_ERROR_RATE, ABORT_AFTER_CONSECUTIVE_ERRORS, MAX_STALL_WAIT_MS } from '../../../scripts/e6-shadow.mjs';
import suite from '../../../eval/suites/extraction-core.suite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../../../eval/datasets/extraction-core.v1.json'), 'utf8'));

// ── 1. The sentinel ──────────────────────────────────────────────────────────

describe('E6 adapter — the self sentinel the suite actually checks', () => {
  test('a self-claim contributes __self__, not just first-person surfaces', async () => {
    // `extraction-core.suite.mjs` scores a self-subject with exactly
    // `surfaces.has('__self__')`. The adapter emitted 'I', 'me', 'my', 'we',
    // 'our' and never the sentinel, so all 20 SELF claims in the first shadow
    // slice missed — subject_recall 0.00 against the regex lane's 0.55 on the
    // same cases, while detection ran at 0.90.
    const { extractE6 } = await import('../../../eval/adapters/e6Extractor.mjs');
    const { __clearExtractionCache } = await import('../understanding/extractionClient.js');
    __clearExtractionCache();
    // The exact fixture shape e6Shadow.test.js already proves the validator
    // admits. Inventing a second one here risks failing on contract grounds and
    // reading as a sentinel bug — which is how the first attempt failed.
    const worksAt = {
      subject: 'self', predicate: 'works_at', object: { entity: 'Nummo' },
      polarity: 'asserted', modality: 'fact', timePrecision: 'none',
      statementText: 'I work at Nummo', confidenceExtraction: 0.9,
    };
    const r = await extractE6('I work at Nummo.', {
      callModel: async () => ({ text: JSON.stringify({ claims: [worksAt] }), model: 'test/model' }),
    });
    assert.ok(r.surfaces.includes('__self__'),
      `surfaces were [${r.surfaces.join(', ')}] — the suite checks for __self__ and nothing else`);
  });

  test('the suite scores that surface set as a subject hit', () => {
    // End-to-end through the real scorer, so the two halves cannot drift apart
    // again with each looking correct alone.
    const selfCase = DS.cases.find(c => c.claims?.some(cl => cl.s === 'SELF'));
    assert.ok(selfCase, 'dataset has no SELF-subject case');
    const scored = suite.score(selfCase, {
      facts: selfCase.claims.map(() => ({ subject: 'self', predicate: 'x' })),
      surfaces: ['__self__'],
    });
    assert.equal(scored.subjectHits, selfCase.claims.length);
  });

  test('a NAMED subject is lowered to match the suite lookup', async () => {
    // The suite does `surfaces.has(claim.s.toLowerCase())` and the regex lane
    // lowers everything it adds. This adapter added the model's raw casing, so
    // "Priya" never matched "priya" — 49 of 167 labelled claims (29%) have a
    // capitalised named subject and could not score however well the model read
    // them. Found only after the `__self__` fix stopped masking it.
    const { extractE6 } = await import('../../../eval/adapters/e6Extractor.mjs');
    const { __clearExtractionCache } = await import('../understanding/extractionClient.js');
    __clearExtractionCache();
    // The proven `worksAt` shape with ONLY the subject changed. A fixture that
    // also varies the predicate gets rejected by the contract gate and reads as
    // a casing bug — which is exactly how the first attempt at this test failed.
    const claim = {
      subject: 'Priya', predicate: 'works_at', object: { entity: 'Nummo' },
      polarity: 'asserted', modality: 'fact', timePrecision: 'none',
      statementText: 'Priya works at Nummo', confidenceExtraction: 0.9,
    };
    const r = await extractE6('Priya works at Nummo.', {
      callModel: async () => ({ text: JSON.stringify({ claims: [claim] }), model: 'test/model' }),
    });
    assert.equal(r.facts.length, 1, `claim was discarded: ${JSON.stringify(r.stats.byGate)}`);
    assert.ok(r.surfaces.includes('priya'),
      `surfaces were [${r.surfaces.join(', ')}] — the suite lowercases the label before lookup`);
    assert.ok(!r.surfaces.includes('Priya'), 'raw casing must not survive; it can never match');
  });

  test('the suite scores a lowered named subject as a hit', () => {
    const named = DS.cases.find(c => c.claims?.some(cl => cl.s !== 'SELF' && cl.s !== cl.s.toLowerCase()));
    assert.ok(named, 'dataset has no capitalised named subject');
    const subj = named.claims.find(cl => cl.s !== 'SELF').s;
    const hit = suite.score(named, {
      facts: named.claims.map(() => ({ subject: subj, predicate: 'x' })),
      surfaces: [subj.toLowerCase(), '__self__'],
    });
    const miss = suite.score(named, {
      facts: named.claims.map(() => ({ subject: subj, predicate: 'x' })),
      surfaces: [subj, '__self__'],
    });
    assert.ok(hit.subjectHits > miss.subjectHits,
      'lowering must matter — if it does not, this pin proves nothing');
  });

  test('the first-person forms are NOT sufficient on their own', () => {
    // Pins the exact failure, so restoring the old expansion fails here.
    const selfCase = DS.cases.find(c => c.claims?.some(cl => cl.s === 'SELF'));
    const scored = suite.score(selfCase, {
      facts: selfCase.claims.map(() => ({ subject: 'self', predicate: 'x' })),
      surfaces: ['self', 'I', 'me', 'my', 'we', 'our'],
    });
    assert.equal(scored.subjectHits, 0, 'surface forms alone should not score — the suite wants the sentinel');
  });
});

// ── 2. Stratified sampling ───────────────────────────────────────────────────

describe('--limit samples the dataset rather than slicing its front', () => {
  test('a small limit still reaches negatives', () => {
    // `extraction-core.v1` is grouped by category: cases 0-19 are all
    // `identity` and the first negative is at index 160. A prefix of 20
    // contained no negatives at all, which is where three of the five reported
    // "failures" came from.
    const picked = stratify(DS.cases, 20);
    assert.equal(picked.length, 20);
    assert.ok(picked.some(c => !(c.claims?.length)), 'a 20-case sample reached no negative case');
  });

  test('every category is represented before any is doubled', () => {
    const cats = new Set(DS.cases.map(c => c.cat));
    const picked = stratify(DS.cases, cats.size);
    assert.equal(new Set(picked.map(c => c.cat)).size, cats.size);
  });

  test('it is deterministic — the same limit picks the same cases', () => {
    // Two runs at the same budget must be comparable to each other. An RNG
    // here would make every partial run its own incomparable population.
    const a = stratify(DS.cases, 37).map(c => c.id);
    const b = stratify(DS.cases, 37).map(c => c.id);
    assert.deepEqual(a, b);
  });

  test('a limit at or above the dataset returns everything, in order', () => {
    assert.deepEqual(stratify(DS.cases, DS.cases.length), DS.cases);
    assert.deepEqual(stratify(DS.cases, 10_000), DS.cases);
  });
});

// ── 3 & 4. Zero denominators and comparability ───────────────────────────────

const partial = {
  detection_recall: 0.9, false_positives: 0, negatives: 0,
  positives: 20, labelled_claims: 20, n_cases_negation: 0, detection_negation: 0,
};
const full = {
  detection_recall: 0.9, false_positives: 1, negatives: 40,
  positives: 160, labelled_claims: 160, n_cases_negation: 20, detection_negation: 0.96,
};

describe('a metric with no cases is unmeasured, not zero', () => {
  test('negation reports null when no negation case was sent', () => {
    const v = evaluatePromotion(partial, {}, { comparable: false });
    const neg = v.checks.find(c => c.name === 'negation');
    assert.equal(neg.got, null);
    assert.equal(neg.measured, false);
  });

  test('precision reports null when there were no negatives to be wrong about', () => {
    // The old formula divided by `Math.max(1, negatives)`, so zero negatives
    // silently produced a perfect 100% — a PASS nobody had earned.
    const v = evaluatePromotion(partial, {}, { comparable: false });
    assert.equal(v.checks.find(c => c.name === 'precision').got, null);
  });

  test('an unmeasured check still blocks promotion', () => {
    // Not measured is not passed. The point is to stop it looking like a
    // catastrophic score, not to wave it through.
    assert.equal(evaluatePromotion(partial, {}, { comparable: false }).promote, false);
  });

  test('a measured negation score is graded normally', () => {
    const v = evaluatePromotion(full, {}, { comparable: true });
    const neg = v.checks.find(c => c.name === 'negation');
    assert.equal(neg.measured, true);
    assert.ok(neg.pass);
  });
});

describe('a partial run is never compared to a full-set baseline', () => {
  test('regressions are not computed for a partial run', () => {
    // The first run listed `silence_on_negatives 0.9 → 0` as a regression,
    // comparing 200 cases with 40 negatives against 20 cases with none. Two
    // populations, not a change.
    const v = evaluatePromotion(partial, { silence_on_negatives: 0.9, subject_recall: 0.55 }, { comparable: false });
    assert.deepEqual(v.regressions, []);
    assert.equal(v.comparable, false);
  });

  test('a full run still catches a real regression', () => {
    const v = evaluatePromotion(full, { subject_recall: 0.9 }, { comparable: true });
    assert.ok(v.regressions.some(r => r.metric === 'subject_recall'));
    assert.equal(v.promote, false);
  });
});

// ── 5. Discard attribution ───────────────────────────────────────────────────

describe('discards name their reason, not just a stage number', () => {
  test('the pipeline keys byGate with the reason attached', () => {
    // The first run reported `discardedByGate: {"2": 2}`. Gate 2 covers both
    // `object-missing` (the model omitted a field) and `object-not-in-quote`
    // (it invented content) — opposite defects in one bucket, and the bucket
    // was the only record kept.
    const src = readFileSync(path.join(HERE, '../understanding/pipeline.js'), 'utf8');
    assert.match(src, /byGate\[key\]/, 'pipeline no longer uses a composite discard key');
    assert.match(src, /\$\{v\.gate \?\? '\?'\}:\$\{v\.reason \?\? 'unknown'\}/,
      'the discard key must carry both the gate and the reason');
  });

  test('the suite publishes per-category case counts', () => {
    // The denominators the 0/0 check above depends on. Without these the
    // promotion gate cannot tell a scored zero from an unasked question.
    const m = suite.metrics(DS.cases.map(c => suite.score(c, { facts: [], surfaces: [] })));
    assert.ok(Number.isInteger(m.n_cases_negation), 'n_cases_negation is missing');
    assert.ok(m.n_cases_negation > 0);
  });
});

// ── Run-to-run noise ─────────────────────────────────────────────────────────

describe('the provider is not reproducible, and the harness measures it', () => {
  test('spread reports mean, extremes and range', () => {
    const sp = spread([0.52, 0.68, 0.60]);
    assert.equal(sp.n, 3);
    assert.equal(sp.min, 0.52);
    assert.equal(sp.max, 0.68);
    assert.ok(Math.abs(sp.range - 0.16) < 1e-9);
  });

  test('a drop smaller than the noise is NOT a regression', () => {
    // The case that produced this. Run 2 blocked promotion on
    // `fidelity_accuracy 64.7% → 64.1%` — 0.6 points — while two identical
    // runs of the same pinned model at temperature 0 differed by 16 points on
    // `detection_modality`. Only the eval adapter's surface casing changed
    // between those runs, and `surfaces` feeds `subjectHits` alone, so nothing
    // else moving was attributable to the change.
    assert.equal(isRealRegression(0.647, 0.641, 0.16), false);
  });

  test('a drop larger than the noise still is one', () => {
    assert.equal(isRealRegression(0.90, 0.70, 0.02), true);
  });

  test('with no noise estimate the answer is null, not false', () => {
    // Unmeasured must not read as cleared. A single pass cannot support the
    // claim either way, and returning false would silently wave drops through.
    assert.equal(isRealRegression(0.647, 0.641, null), null);
  });

  test('the noise floor removes a phantom regression from the verdict', () => {
    const metrics = {
      detection_recall: 0.838, fidelity_accuracy: 0.641, positives: 160,
      negatives: 40, n_cases_negation: 20, detection_negation: 0.85, false_positives: 1,
    };
    const noisy = evaluatePromotion(metrics, { fidelity_accuracy: 0.647 },
      { comparable: true, noise: { fidelity_accuracy: { range: 0.16 } } });
    assert.deepEqual(noisy.regressions, []);
  });

  test('an unverified drop still blocks, and is labelled unverified', () => {
    const metrics = {
      detection_recall: 0.838, fidelity_accuracy: 0.641, positives: 160,
      negatives: 40, n_cases_negation: 20, detection_negation: 0.96, false_positives: 1,
    };
    const v = evaluatePromotion(metrics, { fidelity_accuracy: 0.647 }, { comparable: true });
    assert.equal(v.regressions.length, 1);
    assert.equal(v.regressions[0].verified, false);
    assert.equal(v.promote, false, 'unverified is not cleared');
  });
});

// ── A dead transport is not a measurement ────────────────────────────────────

describe('a pass the provider did not answer is not data', () => {
  /**
   * WHAT HAPPENED. `--repeat 3` over 200 cases is 525 calls, and all four Groq
   * free keys rate-limited during pass 2 (cooldowns 186s–657s). Pass 2 finished
   * blind; pass 3 made ZERO successful calls. The harness reported the LAST
   * pass unconditionally, so it published pass 3:
   *
   *   detection_recall      0.0%      silence_on_negatives  100.0%
   *   subject_recall        0.0%      overall_strict         20.0%
   *
   * Empty extractions score 0% detection and perfect silence, which is exactly
   * the shape `e6-shadow.mjs`'s own header calls "indistinguishable from a
   * catastrophically bad extractor". `e6Stats.errors` was being counted the
   * whole time and never read.
   */
  test('the error-rate ceiling is tight enough to catch a dead pass', () => {
    // 175 errors over 200 cases is 87.5%; a couple of stragglers is ~1%.
    assert.ok(MAX_PASS_ERROR_RATE > 0 && MAX_PASS_ERROR_RATE <= 0.05,
      `${MAX_PASS_ERROR_RATE} is not a ceiling that separates flaky from gone`);
    assert.ok(175 / 200 > MAX_PASS_ERROR_RATE, 'the observed dead pass must be rejected');
    assert.ok(2 / 200 <= MAX_PASS_ERROR_RATE, 'two stragglers must not reject a pass');
  });

  test('the abort trips well before a whole pass is wasted', () => {
    assert.ok(ABORT_AFTER_CONSECUTIVE_ERRORS >= 5, 'too twitchy — one flaky key would abort');
    assert.ok(ABORT_AFTER_CONSECUTIVE_ERRORS <= 25, 'too slow — pass 3 burned 200 dead cases');
  });

  test('the script refuses to publish when no pass was valid', () => {
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /NOTHING WAS MEASURED/,
      'a run with no valid pass must exit non-zero, not print zeros as results');
    assert.match(src, /const good = passes\.filter\(p => p\.valid\)/);
    assert.match(src, /const reported = good\[good\.length - 1\]/,
      'the reported pass must come from the VALID set, not from all passes');
  });

  test('noise is computed over valid passes only', () => {
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /spread\(good\.map\(p => p\.metrics\[k\]\)\)/,
      'a dead pass in the spread makes every range meaningless');
  });

  test('counts are not rendered as percentages', () => {
    // The first noise table led with `false_positives 0.0% – 300.0%` — three
    // false positives printed as 300%, sorted to the top because it looked
    // like the largest range in the run.
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /IS_COUNT/);
    assert.match(src, /IS_COUNT\.test\(k\)/, 'the noise table must branch on count-vs-rate');
  });
});

// ── A rate limit is a pause, not a death ─────────────────────────────────────

describe('the harness waits out a cooldown instead of scoring silence', () => {
  /**
   * The abort added for the dead-transport case fired on the WRONG cause. A
   * `--repeat 3 --limit 60` run stopped all three passes after 33 calls while
   * the provider was reporting cooldowns of 106s, 151s, 580s and 830s — every
   * one a known, finite wait. Correct verdict, wrong reason, and a run lost to
   * a pause it could have slept through.
   */
  test('the provider exposes when a key frees, so the wait is knowable', async () => {
    const { msUntilAnyKeyFree } = await import('../../providers/groq.js');
    assert.equal(typeof msUntilAnyKeyFree, 'function');
    // No keys configured in this environment — null, not a crash and not 0,
    // because "none exist" and "one is free now" are different answers.
    assert.equal(msUntilAnyKeyFree(), null);
  });

  test('the harness consults it before counting a transport error', () => {
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /msUntilAnyKeyFree\(\)/);
    assert.match(src, /await sleep\(wait \+ 1000\)/, 'a waitable stall must sleep and retry the same case');
  });

  test('the stall ceiling separates a per-minute limit from a daily one', () => {
    // Observed cooldowns ran to 830s. A daily quota reports far longer, and
    // sleeping through that is worse than stopping and saying so.
    assert.ok(MAX_STALL_WAIT_MS > 830_000, 'the longest observed cooldown must be waitable');
    assert.ok(MAX_STALL_WAIT_MS <= 30 * 60 * 1000, 'sleeping this long hides a daily-quota problem');
  });

  test('calls are paced by default', () => {
    // 175 back-to-back calls cooled every key. A default of 0 would put the
    // burden on remembering a flag.
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    const m = src.match(/flag\('--pace', (\d+)\)/);
    assert.ok(m, '--pace is not wired');
    assert.ok(Number(m[1]) > 0, 'pacing must be on by default');
  });

  test('the failure advice does not recommend the command that just failed', () => {
    // It previously printed "Use --repeat 3 --limit 60" — verbatim what the
    // user had just run and watched fail.
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    const advice = src.slice(src.indexOf('NOTHING WAS MEASURED'), src.indexOf('NOTHING WAS MEASURED') + 700);
    assert.ok(!/--limit 60/.test(advice), 'still recommending the failed command');
    assert.match(advice, /DAILY quota/, 'the advice must name the actual constraint');
  });
});

// ── A score you cannot explain ───────────────────────────────────────────────

describe('the run records what happened per case, not just the totals', () => {
  /**
   * `detection_negation` read exactly 85.0% on both valid full runs — 17 of 20,
   * the same three cases missing, while every other metric moved by up to 16
   * points. Two explanations were checkable offline and both came back
   * negative:
   *
   *   · prompt rule 2 covers negation explicitly — "Never drop a negation.
   *     'Dev is not on the team' is polarity 'negated', not an omission."
   *   · every labelled negation predicate IS in the registry (31 registered,
   *     zero unregistered across all seven categories)
   *
   * What remained was whether the model returned [] or a gate rejected the
   * claim — and `discardedByGate` is summed across all 200 cases, so it cannot
   * attribute a discard to a case. One number, two suspects, no way to separate
   * them. Three sessions of "negation is 85%" with no path to why.
   */
  test('per-case records are captured and written to the JSON', () => {
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /perCase\.push\(\{/, 'no per-case record is captured');
    assert.match(src, /perCase: reported\.perCase/, 'the record never reaches the JSON');
  });

  test('each record can separate "model returned []" from "a gate dropped it"', () => {
    // The whole point. Without both fields the two causes stay indistinguishable.
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /e6Emitted: e6\.facts\.length/);
    assert.match(src, /e6DiscardedBy: e6\.stats\.byGate/);
  });

  test('records come from the REPORTED pass, not an arbitrary one', () => {
    // Same rule the metrics follow. Records from a discarded pass would
    // describe a run whose numbers were thrown away.
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /perCase: reported\.perCase/);
    assert.ok(!/perCase: passes\[/.test(src), 'records must not be taken from all passes');
  });

  test('the console names the cases that emitted nothing', () => {
    const src = readFileSync(path.join(HERE, '../../../scripts/e6-shadow.mjs'), 'utf8');
    assert.match(src, /EMITTED NOTHING/);
    assert.match(src, /model returned \[\] — no gate involved/,
      'a miss with no gate entry must say so explicitly rather than showing an empty list');
  });
});
