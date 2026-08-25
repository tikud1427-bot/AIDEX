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
export function evaluatePromotion(metrics, baseline) {
  const precision = 1 - (metrics.false_positives ?? 0) / Math.max(1, metrics.negatives ?? 40);
  const recall = metrics.detection_recall ?? 0;
  const negation = metrics.detection_negation ?? 0;

  const checks = [
    ['precision', precision, PROMOTION_GATE.precision],
    ['recall', recall, PROMOTION_GATE.recall],
    ['negation', negation, PROMOTION_GATE.negation],
  ].map(([name, got, need]) => ({ name, got, need, pass: got >= need }));

  // Beating the gate is necessary but not sufficient: a new extractor that
  // met every threshold while scoring BELOW the committed baseline on some
  // dimension would be a regression wearing a passing grade.
  const regressions = [];
  for (const k of ['detection_recall', 'subject_recall', 'predicate_accuracy',
    'fidelity_accuracy', 'silence_on_negatives']) {
    const before = baseline?.[k] ?? 0, after = metrics?.[k] ?? 0;
    if (after < before - 1e-9) regressions.push({ metric: k, before, after });
  }

  return {
    checks,
    regressions,
    gatePassed: checks.every(c => c.pass),
    promote: checks.every(c => c.pass) && regressions.length === 0,
  };
}

const pct = n => `${(n * 100).toFixed(1)}%`;
const arrow = (a, b) => (b > a ? '▲' : b < a ? '▼' : '=');

async function main() {
  const dataset = JSON.parse(readFileSync(path.join(ROOT, 'eval/datasets/extraction-core.v1.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(path.join(ROOT, 'eval/baselines/extraction-core.v1.json'), 'utf8')).metrics;

  const limit = Number(flag('--limit', dataset.cases.length));
  const cases = dataset.cases.slice(0, limit);
  const modelPin = flag('--model', null);

  /** The transport. One segment per call — never several, see PR-5's header. */
  const callModel = async ({ system, user, temperature, model }) => {
    const res = await generateOpenRouter(system, [{ role: 'user', content: user }],
      undefined, 1024, { model: model ?? modelPin ?? undefined, temperature });
    return { text: res.text, model: res.model ?? null };
  };

  // Fail before spending anything, rather than after 200 calls.
  try {
    const probe = buildExtractionPrompt('I work at Nummo.');
    await callModel({ system: probe.system, user: probe.user, temperature: 0, model: modelPin });
  } catch (err) {
    console.error(`\n✗ No usable provider: ${err?.message ?? err}`);
    console.error('  This script needs the same key the app uses. Nothing was measured —');
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

  const verdict = evaluatePromotion(mE6, baseline);
  console.log('\nPROMOTION GATE');
  for (const c of verdict.checks) {
    console.log(`  ${c.name.padEnd(10)} ${pct(c.got).padStart(7)} need ≥ ${pct(c.need)}  ${c.pass ? 'PASS' : 'FAIL'}`);
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
