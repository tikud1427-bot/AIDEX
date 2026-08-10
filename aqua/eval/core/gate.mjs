/**
 * AQUA Eval — the regression gate
 * Blueprint E2/PR-6 · Constitution L14
 *
 * The last piece of Epic 2. Until now the baselines were numbers in a file
 * that nobody was obliged to look at. This makes them a merge condition.
 *
 * THE NOISE BAND IS ZERO, AND THAT WAS MEASURED
 * ---------------------------------------------
 * The blueprint says noise bands come from three consecutive runs. They were
 * run: the comparable body is BYTE-IDENTICAL across three, and Ananya's Node
 * 20 reproduced the same figures as Node 22 to the fourth decimal. There is no
 * model call and no clock in either suite, so the band is genuinely 0 rather
 * than merely small.
 *
 * `EPSILON` therefore exists only to absorb IEEE-754 drift, not real
 * variation. Setting a generous band "to be safe" would hide exactly the small
 * regressions this gate exists to catch — a 2% drop in negation fidelity is
 * the kind of thing that never gets noticed once it is inside a tolerance.
 *
 * DIRECTION MATTERS, AND GETTING IT WRONG IS THE OBVIOUS TRAP
 * ----------------------------------------------------------
 * Most metrics are higher-is-better. `noise_lines`, `noisy_queries` and
 * `false_positives` are LOWER-is-better. A gate that treated everything as
 * higher-is-better would wave through a doubling of noise as an improvement —
 * the precise failure the datasets were built to expose.
 */

/** Absorbs float representation drift. NOT a tolerance for real change. */
export const EPSILON = 1e-9;

/** Metrics where a larger number is worse. Everything else is higher-is-better. */
export const LOWER_IS_BETTER = new Set([
  'noise_lines', 'noisy_queries', 'false_positives',
]);

/** Metrics that are counts of the dataset, not quality. Compared for equality. */
export const STRUCTURAL = new Set([
  'positives', 'negatives', 'labelled_claims',
  'answerable_queries', 'silence_queries',
]);

/**
 * Suites that must NEVER be gated, whatever baseline files exist on disk.
 *
 * `selftest` grades the harness itself and is DELIBERATELY incomplete — it
 * carries a skip and a throw so every runner path is exercised. E2/PR-6
 * excluded it by relying on the ABSENCE of a baseline file, which held right
 * up until someone ran `--update`: that regenerated a baseline for every
 * suite, and the gate then blocked forever on a suite designed to be
 * incomplete.
 *
 * Excluding it by NAME rather than by the absence of a file is the fix. An
 * invariant that depends on a file not existing is not an invariant.
 */
export const NOT_GATED = new Set(['selftest']);

export const VERDICT = Object.freeze({
  PASS: 'pass', IMPROVED: 'improved', REGRESSED: 'regressed',
  MISSING: 'missing', NEW: 'new', STRUCTURAL_CHANGE: 'structural-change',
});

/**
 * Compare one suite's fresh result against its committed baseline.
 *
 * @param {object} baseline  the committed `{ suiteFingerprint, coverage, metrics }`
 * @param {object} report    a fresh `{ manifest, result }`
 * @returns {{ ok: boolean, blocking: string[], rows: object[] }}
 */
export function compareToBaseline(baseline, report) {
  const rows = [];
  const blocking = [];
  const metrics = report.result.metrics ?? {};

  // ── Refusals: conditions under which a comparison is meaningless ──────────
  //
  // These are not "failures" in the metric sense — they mean the two sides are
  // not comparable at all, and reporting a metric delta would be inventing a
  // result. The gate refuses rather than guesses.
  if (!report.result.coverage.complete) {
    blocking.push(
      `INCOMPLETE RUN (${report.result.coverage.skipped} skipped, ` +
      `${report.result.coverage.errored} errored) — a partial run's numbers are not comparable`);
  }
  if (baseline.suiteFingerprint && report.manifest.suiteFingerprint !== baseline.suiteFingerprint) {
    blocking.push(
      `DATASET CHANGED (baseline ${baseline.suiteFingerprint}, run ${report.manifest.suiteFingerprint}) — ` +
      'two runs over different data are not comparable. Regenerate the baseline in a PR that says why.');
  }

  // ── Per-metric comparison ────────────────────────────────────────────────
  const seen = new Set();
  for (const [name, was] of Object.entries(baseline.metrics ?? {})) {
    seen.add(name);
    if (!(name in metrics)) {
      rows.push({ name, was, now: null, verdict: VERDICT.MISSING });
      blocking.push(`METRIC REMOVED: ${name} — a measurement disappeared, which is not an improvement`);
      continue;
    }
    const now = metrics[name];
    const delta = now - was;

    if (STRUCTURAL.has(name)) {
      const same = Math.abs(delta) < EPSILON;
      rows.push({ name, was, now, delta, verdict: same ? VERDICT.PASS : VERDICT.STRUCTURAL_CHANGE });
      if (!same) {
        blocking.push(`DATASET SHAPE CHANGED: ${name} ${was} → ${now} — every other metric now means something different`);
      }
      continue;
    }

    const worse = LOWER_IS_BETTER.has(name) ? delta > EPSILON : delta < -EPSILON;
    const better = LOWER_IS_BETTER.has(name) ? delta < -EPSILON : delta > EPSILON;
    const verdict = worse ? VERDICT.REGRESSED : better ? VERDICT.IMPROVED : VERDICT.PASS;
    rows.push({ name, was, now, delta, verdict });
    if (worse) blocking.push(`REGRESSED: ${name} ${fmt(was)} → ${fmt(now)} (${fmt(delta, true)})`);
  }

  // A new metric is reported, never blocking — adding a measurement is good.
  for (const [name, now] of Object.entries(metrics)) {
    if (!seen.has(name)) rows.push({ name, was: null, now, verdict: VERDICT.NEW });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: blocking.length === 0, blocking, rows };
}

const fmt = (n, signed = false) => {
  if (n === null || n === undefined) return '—';
  const s = Math.abs(n) < 1 && n !== 0 ? n.toFixed(4) : String(n);
  return signed && n > 0 ? `+${s}` : s;
};

/** Human-readable gate report. */
export function gateReport(suiteId, { ok, blocking, rows }) {
  const lines = [`── gate: ${suiteId} ──`];
  const interesting = rows.filter(r => r.verdict !== VERDICT.PASS);
  if (!interesting.length) {
    lines.push(`   ${rows.length} metrics, all unchanged`);
  } else {
    for (const r of interesting) {
      const mark = { improved: '↑', regressed: '↓', missing: '✗', new: '+', 'structural-change': '!' }[r.verdict];
      lines.push(`   ${mark} ${r.name.padEnd(26)} ${fmt(r.was)} → ${fmt(r.now)}`);
    }
    const unchanged = rows.length - interesting.length;
    if (unchanged) lines.push(`   · ${unchanged} unchanged`);
  }
  for (const b of blocking) lines.push(`   ✗ ${b}`);
  lines.push(`   ${ok ? 'PASS' : 'BLOCKED'}`);
  return lines.join('\n');
}
