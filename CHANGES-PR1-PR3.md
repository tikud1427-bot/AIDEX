# AQUIPLEX — session changes (E2 integrity · PR-2 · PR-3)

Baseline at session start: 2997 tests · 375 suites · 2996 pass · 0 fail · 1 skip
Baseline at session end:   3040 tests · 385 suites · 3039 pass · 0 fail · 1 skip
flagproof 30/30 · eval:gate PASS (11 suites, all metrics unchanged) · router boot OK

Reproduce with `npm ci` (NOT `npm install` — a plain install produced a corrupt
`object-keys` package and 45 spurious file-level failures).

## Increment 1 — E2 evaluation integrity

- `eval/datasets/schema.mjs` (+32)
  `validateDataset` now refuses a class-incomplete dataset. Every category in
  CATEGORIES must have >= 1 case, or the error names the consequence (0/0
  rendered as 0.0). This is the E6 smoke defect made structural rather than
  pinned per-dataset.
- `eval/tests/extractionDataset.test.js` (+44) — 5 bite tests for that rule.
- `eval/tests/extractionControl.test.js` (NEW, 183) — three deliberately broken
  extractors (mute / firehose / subject-blind) run through the whole suite.

  MEASURED FINDINGS, PINNED:
    mute          overall_strict_accuracy 0.2000  > real 0.1800
    subject-blind overall_strict_accuracy 0.1800 == real 0.1800
  => overall_strict_accuracy cannot gate a promotion decision. The per-level
     metrics separate all four extractors; the headline separates three.

## Increment 2 — PR-2, E6 gets an output

- `src/routes/turnPostProcess.js` (+37)
  Result of `understandTurn` is BOUND (was `.then(() => ...)`, an arrow taking
  no parameter — the return value was unreachable). Block now RETURNS its
  promise, so `jobRegistry.defer`'s `await fn()` makes the SIGTERM drain
  actually wait for E6. `reportE6` added to REAL_DEPS.
- `src/core/observability.js` (+81)
  `logE6Turn`, bounded scalar `e6` counters, `_resetE6Metrics`,
  `getMetrics().e6` (visible at /provider-health).
  A failure is a DIFFERENT line, not a missing one.
- `src/brain/tests/e6TurnPath.test.js` (+204) — 9 tests.

## Increment 3 — PR-3, S6 reachable from production

- `src/brain/identity/entityStoreView.js` (NEW, 97)
  Owner-scoped READ VIEW over the existing idStore. Holds nothing, writes
  nothing. NOT a fourth identity space. `byAlias` deliberately absent —
  idStore folds aliases into `norms`, so a byAlias would mislabel exact hits
  as alias hits and corrupt stats.s6.byTier.
- `src/brain/index.js` (+25)
  `entityStoreFor` / `selfEntityIdFor` in REAL_DEPS; `understandTurn` passes
  `entityStore` + `selfEntityId`, fail-open. `selfEntityId` supplied ONLY when
  the owner actually has a self entry.
- `src/core/observability.js` (+8) — `s6.*` fields on the [E6] line, present
  only when S6 ran.
- `src/brain/tests/entityStoreView.test.js` (NEW, 10 tests)
- `src/brain/tests/e6TurnPath.test.js` (+9 tests)

OBSERVED (production seam, only `defer` overridden):
  stages=S0,S1,S2,S3,S4,S5,S6  entities=resolved
OBSERVED (production deps + stub transport):
  s6.byTier={"self-grammar":1,"exact-normalized":1}
  objectEntityId=aq:org:nummo   subjectEntityId=aq:self:owner (when self exists)

## Not done, deliberately

S7/S8/S9, claim shadow write, Postgres, flag registry, E6 promotion.
No flag added. AQUA_E6 still off by default. No baseline regenerated.

## Known open risks

- S6 tier 3 is O(entities x surfaces) per turn, up to 20k entities. Unmeasured.
- SELF_CANONICAL_ID is 'aq:self:owner' for every owner. Safe while owner
  scoping lives in the store; latent when claims get written.
- `validateRetrievalDataset` has the same class-completeness gap as
  `validateDataset` had. Not fixed — out of scope.
