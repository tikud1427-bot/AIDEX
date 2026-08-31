#!/usr/bin/env node
/**
 * E6/PR-11 — the shadow run.
 *
 * Runs BOTH extractors over the same 200 labelled cases in
 * `extraction-core.v1`, scores them with the SAME suite, and prints the
 * comparison against the committed baseline and the blueprint's promotion
 * gate:
 *
 *   precision ≥ 0.85 · recall ≥ 0.70 · negation ≥ 0.95
 *
 * "Run alongside regex, write to a separate table, compare, do not read. Flip
 * readers only when eval says it is better." Nothing here writes anything.
 *
 * WHY YOU HAVE TO RUN IT
 * ----------------------
 * Real provider calls. The analysis sandbox has no key and its egress blocks
 * every provider, so these numbers cannot be produced there. Everything that
 * does not need a provider — every stage's logic, and the comparison
 * arithmetic below — is already under test and runs anywhere.
 *
 * USAGE
 *
 *   cd aqua
 *   node scripts/e6-shadow.mjs                      # all 200 cases
 *   node scripts/e6-shadow.mjs --limit 20           # a cheap smoke run first
 *   node scripts/e6-shadow.mjs --model <model-id>   # pin, strongly advised
 *   node scripts/e6-shadow.mjs --provider groq      # groq or openrouter (default)
 *   node scripts/e6-shadow.mjs --json out.json      # machine record
 *
 * COST. One provider call per admitted segment, cached by content hash within
 * the run. `gate-core` measured the candidate gate admitting 176 of 200, so
 * budget for roughly that many calls on a full pass. Start with --limit.
 *
 * ⚠️ IT REFUSES TO PUBLISH AN UNATTRIBUTABLE RUN
 * -----------------------------------------------
 * If the transport does not report which model answered, the comparison is
 * printed but marked NOT PUBLISHABLE and the exit code is non-zero. A
 * difference in these numbers could be the new prompt or could be a different
 * model, and nothing in the output would distinguish them —
 * `getCandidateModels` rotates for OpenRouter, so that is a live possibility
 * rather than a theoretical one. PR-5b added the pin and the model echo
 * precisely so this check can pass; if it fails, pass --model.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import suite from '../eval/suites/extraction-core.suite.mjs';
import { extractWithCurrentEngine, surfacesOf } from '../eval/adapters/currentExtractor.mjs';
import { extractE6 } from '../eval/adapters/e6Extractor.mjs';
import { generateOpenRouter } from '../src/providers/openrouter.js';
import { generateGroq } from '../src/providers/groq.js';
import { buildExtractionPrompt } from '../src/brain/understanding/extractionPrompt.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};

/** The blueprint's exit criteria for E6. Not negotiable, and not invented here. */
export const PROMOTION_GATE = Object.freeze({
  precision: 0.85,
  recall: 0.70,
  negation: 0.95,
});

/**
 * Decide promotion from measured metrics.
 *
 * Exported and pure so the arithmetic is tested without a provider — the
 * numbers need a key, the DECISION about them does not, and a promotion rule
 * that only runs on the day you want to promote has never been exercised.
 */
export function evaluatePromotion(metrics, baseline, { comparable = true } = {}) {
  // 🔴 0/0 IS NOT 0.0, AND THE GATE USED TO FAIL ON IT.
  //
  // The first shadow run reported `negation 0% — FAIL` and returned DO NOT
  // PROMOTE. No negation case had been sent: `--limit 20` took a prefix of a
  // category-ordered dataset and the first negative is at index 160. The
  // aggregator divided zero by zero, got 0, and the gate read it as a
  // catastrophic score. The regex control scored the identical 0.0 on the same
  // slice, which is what proved it was arithmetic rather than extraction.
  //
  // An unmeasured metric now reports `null` and is SKIPPED, not failed. It also
  // blocks promotion — untested is not passed — but it is reported as
  // "not measured" so nobody re-diagnoses a working extractor.
  const negatives = metrics.negatives ?? 0;
  const measured = {
    precision: negatives > 0 ? 1 - (metrics.false_positives ?? 0) / negatives : null,
    // `positives` is the TRUE denominator of detection_recall
    // (pos.filter(emitted).length / pos.length), so it is the right thing to
    // ask whether anything was measured.
    recall: (metrics.positives ?? 0) > 0 ? (metrics.detection_recall ?? 0) : null,
    // `n_cases_negation` is published by the suite precisely so this can tell
    // "the extractor scored zero" from "no negation case was sent".
    negation: (metrics.n_cases_negation ?? 0) > 0 ? (metrics.detection_negation ?? 0) : null,
  };

  const checks = [
    ['precision', measured.precision, PROMOTION_GATE.precision],
    ['recall', measured.recall, PROMOTION_GATE.recall],
    ['negation', measured.negation, PROMOTION_GATE.negation],
  ].map(([name, got, need]) => (got == null
    ? { name, got: null, need, pass: false, measured: false }
    : { name, got, need, pass: got >= need, measured: true }));

  // Beating the gate is necessary but not sufficient: a new extractor that
  // met every threshold while scoring BELOW the committed baseline on some
  // dimension would be a regression wearing a passing grade.
  //
  // ⚠️ ONLY WHEN THE TWO NUMBERS DESCRIBE THE SAME CASES. The first run listed
  // `silence_on_negatives 0.9 → 0` as a regression, comparing a 200-case
  // baseline with 40 negatives against a 20-case slice with none. That is not
  // a regression, it is two different populations. On a partial run the
  // comparison is refused outright rather than reported wrongly.
  const regressions = [];
  if (comparable) {
    for (const k of ['detection_recall', 'subject_recall', 'predicate_accuracy',
      'fidelity_accuracy', 'silence_on_negatives']) {
      const before = baseline?.[k] ?? 0, after = metrics?.[k] ?? 0;
      if (after < before - 1e-9) regressions.push({ metric: k, before, after });
    }
  }

  return {
    comparable,
    checks,
    regressions,
    gatePassed: checks.every(c => c.pass),
    // A partial run can never promote, however good it looks. The baseline it
    // would be promoted against describes cases it did not run.
    promote: comparable && checks.every(c => c.pass) && regressions.length === 0,
  };
}

/**
 * Round-robin over categories, order-stable within each.
 *
 * A prefix slice of a grouped dataset is not a sample of it. This keeps the
 * per-category proportions as even as the budget allows and is fully
 * deterministic, so `--limit 40` twice is the same forty cases.
 */
export function stratify(cases, limit) {
  if (!Number.isFinite(limit) || limit >= cases.length) return cases;
  const buckets = new Map();
  for (const c of cases) {
    const k = c.cat ?? 'uncategorised';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  const queues = [...buckets.values()];
  const out = [];
  for (let round = 0; out.length < limit; round++) {
    let took = false;
    for (const q of queues) {
      if (round >= q.length) continue;
      out.push(q[round]);
      took = true;
      if (out.length >= limit) break;
    }
    if (!took) break;
  }
  // Restore dataset order so output reads naturally and is reproducible.
  const chosen = new Set(out.map(c => c.id));
  return cases.filter(c => chosen.has(c.id));
}

const pct = n => `${(n * 100).toFixed(1)}%`;
const arrow = (a, b) => (b > a ? '▲' : b < a ? '▼' : '=');

async function main() {
  const dataset = JSON.parse(readFileSync(path.join(ROOT, 'eval/datasets/extraction-core.v1.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(path.join(ROOT, 'eval/baselines/extraction-core.v1.json'), 'utf8')).metrics;

  const limit = Number(flag('--limit', dataset.cases.length));

  /**
   * 🔴 `--limit` TOOK A PREFIX OF A CATEGORY-ORDERED DATASET.
   *
   * `extraction-core.v1` is grouped by category: cases 0-19 are all `identity`
   * and the first NEGATIVE case is at index 160. So `--limit 20` measured
   * twenty identity sentences, zero negatives, and nothing from decision,
   * modality, people, task or temporal — then printed those numbers beside a
   * baseline computed over all 200.
   *
   * The first shadow run failed the promotion gate on `negation 0%` when no
   * negation case had been sent, and listed `silence_on_negatives 0.9 → 0` as a
   * regression when the denominator was zero. Both came from here.
   *
   * Round-robin across categories instead. Deterministic — no RNG, so two runs
   * of the same --limit send the same cases and their numbers are comparable —
   * and it takes from every category before taking a second from any, so a
   * small budget still touches negatives.
   */
  const cases = stratify(dataset.cases, limit);
  const modelPin = flag('--model', null);

  /**
   * The transport. One segment per call — never several, see PR-5's header.
   *
   * ⚠️ PROVIDER IS SELECTABLE, AND OPENROUTER IS NO LONGER THE OBVIOUS CHOICE.
   *
   * This script was hardwired to OpenRouter, whose registry entry
   * `openai/gpt-oss-120b:free` is now deprecated — OpenRouter itself answers the
   * 404 with "the paid version is available now — use openai/gpt-oss-120b".
   *
   * The registry ALREADY lists that exact slug under groq (modelRegistry.js:90).
   * So the same model this run wants is reachable on a provider the project is
   * already configured for, without a paid OpenRouter route.
   *
   * There is a measurement reason to prefer it, not just a billing one. Free
   * OpenRouter routes are rate-limited (commonly ~50/day) and the roster rotates
   * weekly; a full pass is ~176 calls. A run that half-completes, or that gets
   * silently rerouted to whatever is free that week, measures the model rather
   * than E6 — which is the exact ambiguity the NOT PUBLISHABLE guard below
   * exists to catch. Both signatures are identical, so this is a binding
   * choice, not a rewrite.
   */
  const providerName = String(flag('--provider', 'openrouter')).toLowerCase();
  const generate = providerName === 'groq' ? generateGroq : generateOpenRouter;
  if (!['groq', 'openrouter'].includes(providerName)) {
    console.error(`\n✗ Unknown --provider "${providerName}" — expected groq or openrouter.\n`);
    process.exit(1);
  }

  const callModel = async ({ system, user, temperature, model }) => {
    const res = await generate(system, [{ role: 'user', content: user }],
      undefined, 1024, { model: model ?? modelPin ?? undefined, temperature });
    return { text: res.text, model: res.model ?? null };
  };

  // Fail before spending anything, rather than after 200 calls.
  try {
    const probe = buildExtractionPrompt('I work at Nummo.');
    await callModel({ system: probe.system, user: probe.user, temperature: 0, model: modelPin });
  } catch (err) {
    console.error(`\n✗ No usable provider: ${err?.message ?? err}`);
    console.error(`  Provider: ${providerName}. This script needs the same key the app uses.`);
    console.error('  If a model 404s as deprecated, the registry entry is stale — list the');
    console.error('  live ones first, then pin one:');
    console.error('    curl -s https://openrouter.ai/api/v1/models | jq -r \'.data[]|select(.pricing.prompt=="0")|.id\'');
    console.error('  Or use the provider the registry already has this model on:');
    console.error('    node scripts/e6-shadow.mjs --provider groq --model openai/gpt-oss-120b --limit 20');
    console.error('  Nothing was measured —');
    console.error('  a run with no transport emits no claims and would score 0.0% detection,');
    console.error('  which is indistinguishable from a catastrophically bad extractor.\n');
    process.exit(1);
  }

  const scoredCurrent = [], scoredE6 = [];
  const e6Stats = { called: 0, cached: 0, errors: 0, models: new Set(), discardedByGate: {} };

  for (const [i, c] of cases.entries()) {
    const cur = extractWithCurrentEngine(c.text);
    scoredCurrent.push(suite.score(c, { facts: cur.facts ?? [], surfaces: surfacesOf(cur) }));

    const e6 = await extractE6(c.text, { callModel, modelPin });
    scoredE6.push(suite.score(c, { facts: e6.facts, surfaces: e6.surfaces }));

    e6Stats.called += e6.stats.called ?? 0;
    e6Stats.cached += e6.stats.cached ?? 0;
    e6Stats.errors += e6.stats.errors ?? 0;
    for (const m of e6.stats.models ?? []) e6Stats.models.add(m);
    for (const [g, n] of Object.entries(e6.stats.byGate ?? {})) {
      e6Stats.discardedByGate[g] = (e6Stats.discardedByGate[g] ?? 0) + n;
    }
    if ((i + 1) % 20 === 0) process.stderr.write(`  … ${i + 1}/${cases.length}\n`);
  }

  const mCur = suite.metrics(scoredCurrent);
  const mE6 = suite.metrics(scoredE6);

  console.log(`\nE6 SHADOW RUN · ${cases.length} cases · ${e6Stats.called} calls, ${e6Stats.cached} cache hits`);
  console.log(`models seen: ${[...e6Stats.models].join(', ') || '(none reported)'}\n`);
  console.log('metric                     baseline    current       E6');
  for (const k of ['detection_recall', 'subject_recall', 'predicate_accuracy',
    'fidelity_accuracy', 'silence_on_negatives', 'overall_strict_accuracy',
    'detection_negation', 'detection_temporal', 'detection_modality']) {
    const b = baseline[k] ?? 0, c = mCur[k] ?? 0, e = mE6[k] ?? 0;
    console.log(`${k.padEnd(26)} ${pct(b).padStart(7)}  ${pct(c).padStart(8)}  ${pct(e).padStart(8)} ${arrow(c, e)}`);
  }

  // A partial run is not comparable to a full-set baseline, and the script now
  // says so rather than printing a difference between two populations.
  const fullRun = cases.length === dataset.cases.length;
  const verdict = evaluatePromotion(mE6, baseline, { comparable: fullRun });
  if (!fullRun) {
    console.log(`\n⚠️  PARTIAL RUN — ${cases.length} of ${dataset.cases.length} cases.`);
    console.log('   Baseline comparison and promotion are DISABLED: the committed baseline');
    console.log('   describes all 200 cases and this run did not send them. The current-vs-E6');
    console.log('   columns above are still valid — both lanes saw exactly these cases.');
  }
  console.log('\nPROMOTION GATE');
  for (const c of verdict.checks) {
    // An unmeasured check prints NOT MEASURED, never 0.0% FAIL. It still
    // blocks promotion — untested is not passed — but it no longer looks like
    // a catastrophic score and send someone diagnosing a working extractor.
    const got = c.measured === false ? '    n/a' : pct(c.got).padStart(7);
    const status = c.measured === false ? 'NOT MEASURED (no cases in this run)' : (c.pass ? 'PASS' : 'FAIL');
    console.log(`  ${c.name.padEnd(10)} ${got} need ≥ ${pct(c.need)}  ${status}`);
  }
  if (verdict.regressions.length) {
    console.log('\n  REGRESSIONS vs the committed baseline:');
    for (const r of verdict.regressions) console.log(`    ${r.metric}: ${pct(r.before)} → ${pct(r.after)}`);
  }

  const attributable = e6Stats.models.size > 0;
  if (!attributable) {
    console.log('\n⚠️  NOT PUBLISHABLE — no model id was reported for any call.');
    console.log('    A difference in these numbers could be the prompt or a different model,');
    console.log('    and nothing here distinguishes them. Re-run with --model <id>.');
  }

  console.log(`\nVERDICT: ${verdict.promote && attributable ? 'PROMOTE' : 'DO NOT PROMOTE'}`);
  if (verdict.gatePassed && verdict.regressions.length) {
    console.log('  (the gate passed but a committed metric went backwards — that is a regression wearing a passing grade)');
  }
  console.log();

  const out = flag('--json');
  if (out) {
    const p = path.resolve(process.cwd(), out);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({
      cases: cases.length, baseline, current: mCur, e6: mE6, verdict,
      attributable, models: [...e6Stats.models], stats: { ...e6Stats, models: [...e6Stats.models] },
    }, null, 2));
    console.log(`→ ${p}\n`);
  }

  process.exit(verdict.promote && attributable ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('e6-shadow.mjs')) {
  main().catch(err => { console.error(err); process.exit(1); });
}
