# AQUIPLEX — session changes (E2 integrity · PR-2 · PR-3 · PR-1)

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

## Increment 4 — PR-1, flag registry (E4 / L13)

- `src/core/flags.js` (NEW, 175) — GATES (26) + SETTINGS (16), each recording
  how its variable is actually read. `flagReport()`, `flagBootLine()`.
- `src/core/tests/flagRegistry.test.js` (NEW, 8 tests) — completeness DERIVED
  from source, both directions. Not a hand-maintained list.
- `router.js` (+12) — `[FLAGS]` boot line, fail-open.

### CORRECTION TO THE AUDIT

The audit's "56 AQUA_* flags, 11 reported" is WRONG, and Phase 0 repeated it
as 57. That figure came from grepping `AQUA_[A-Z_]+`, which matches:
  - 8 log event labels (`type: 'AQUA_REQUEST'`, AQUA_MEMORY, AQUA_PLAN,
    AQUA_SEARCH, AQUA_COGNITION, AQUA_INTELLIGENCE, AQUA_ORCHESTRATOR,
    AQUA_VERIFICATION) in observability.js
  - 4 markdown filenames cited in comments (AQUA_INDEXED_NOT_SCAN.md,
    AQUA_PARSE_ISOLATION.md, AQUA_DEPENDENCY_SAFETY.md, AQUA_PHASE6_NOTES.md)
  - AQUA_EXTRACT_V2 — named in two headers as a future flag, read by nothing

TRUE census: 42 variables read · 26 gates · 16 settings · 11 reported before
this PR · 31 dark. Still an L13 violation, one third smaller than claimed.

Two recorded defaults were also wrong on first pass and caught by the test:
AQUA_BRAIN and AQUA_PIC are `!== 'off'` (ON by default), not `=== 'on'`.
Four gates are ON by default: AQUA_BRAIN, AQUA_EMBEDDINGS, AQUA_PARSE_WORKER,
AQUA_PIC.

Boot now prints:
  [FLAGS] 26 gates · 16 settings · 1 overridden — AQUA_DISABLE_MONGO_MIRROR=on

State: 3048 tests · 388 suites · 3047 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS · router boot OK

## Increment 5 — PR-4 (purge completeness) · PR-5 (claim shadow contract) · PR-9 (AQUA_GRAPH)

### PR-4 — PASS
- `src/account/tests/purgeCompleteness.test.js` (NEW, 4 tests)
  Purge coverage derived from a CALL graph, not a hand list. Every module
  exporting purgeOwner must be invoked, transitively, from accountPurge.js.
  First version used import REACHABILITY and did not bite — reasoningGraph
  stayed reachable via unrelated imports when its purge call was deleted.
  Replaced with call detection across three import shapes.

### PR-5 — PASS (contract + seam). PR-6 NOT DONE.
- `src/core/claims/shadowMode.js` (NEW, 105)
- `src/core/tests/claimShadowMode.test.js` (NEW, 10 tests)
- `router.js` (+8) — [CLAIMS] boot line
- `src/core/flags.js` — AQUA_CLAIMS_SHADOW registered (27 gates now)
- `src/core/tests/dbPool.test.js` — ALLOWED += shadowMode.js, with reason
- `src/core/tests/claimRepository.test.js` — exclusion += shadowMode.js, with reason

PG-ABSENT CONTRACT, taken from configureStorageFromEnv (E3/PR-5), not guessed:
  flag on + no DATABASE_URL -> mode 'off' + stated reason, printed at boot.
  Not a throw (breaks L11). Not silence (breaks L13).
  [CLAIMS] shadow=off (AQUA_CLAIMS_SHADOW=on but DATABASE_URL is not set)

PR-6 (conversationFacts -> claimRepository projection + parity report) is NOT
implemented. It needs real Postgres; pg-mem is not Postgres.

### PR-9 — PASS
- Covered by the registry (PR-1) + 3 pins in claimShadowMode.test.js.
  AQUA_GRAPH is NOT deleted. It gates POST /api/aqua/intelligence/orchestrate,
  a live authenticated route the audit missed. Registry note records this.

### Two defects found in my own work, fixed at cause
1. shadowMode read process.env[CLAIMS_SHADOW_FLAG] — a computed key, invisible
   to the flag census. The PR-1 registry test caught it. Made literal.
2. flagRegistry.test.js deleted all 27 env vars globally to check defaults.
   node runs test files concurrently; testCoverage.test.js spawns the runner as
   a subprocess, inherited the mutated env, and reported 26 test files missing.
   flagReport/flagBootLine now take an env parameter. No global mutation.

State: 3062 tests · 391 suites · 3061 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS · router boot OK

## Increment 6 — PR-6, the claim shadow projector (E5)

### BLOCKER REMOVED, NOT DECLARED
The previous report said PR-6 was blocked on DATABASE_URL. archive.ubuntu.com
is in the container allowlist: `apt-get install postgresql` works.
Real PostgreSQL 16.15 on 127.0.0.1:5433, 6 migrations applied, claim suites
89/90 against it. PR-6 was then built and proven against a real database.

### Changed
- `src/core/claims/shadowProjector.js` (NEW, 150) — composition over the
  existing backfillOwner. Never throws. Reports parity per turn.
- `src/core/claims/claimRepository.js` (+30) — purgeOwner (see gap below)
- `src/brain/knowledgeExtraction/conversationIngest.js` (+6) — returns factIds
  (already collected as writtenFactIds; only the return shape changed)
- `src/routes/turnPostProcess.js` (+35) — gated shadow projection seam
- `src/account/accountPurge.js` (+6) — claims purge step
- `src/core/tests/shadowProjector.test.js` (NEW, 8 tests)
- `src/core/tests/claimRepository.test.js` — the "nothing CALLS the repository
  yet" pin fired on PR-6, which is what it was for. Rewritten as a DECLARED
  caller list (same shape as dbPool ALLOWED), not deleted.

### PURGE GATE FAILED FIRST — a real gap, found by running it
PR-6 wrote owner-scoped Postgres rows with no erasure path. Worse: PR-4's
completeness pin could not see it, because that pin scans for modules
EXPORTING purgeOwner and claims never had one. A deleted user's claims would
have survived while every purge test stayed green.
Fixed by following the convention: claimRepository now exports purgeOwner, so
PR-4's pin covers it for free. Verified: purge 1 claim + 1 evidence link, other
owner untouched. No-PG returns skipped='postgres not configured' rather than an
erasure failure for a database the deployment never had.

### Acceptance gates, measured on real rows
  idempotency   replay: facts=1 claims=0 duplicates=1
  owner isolation  2 owners, CROSS_OWNER_LEAK=0
  evidence      claims with no evidence = 0
  actor         claims with no actor = 0
  provenance    extractor=backfill@v1, extractor_version present, 100%
  predicate     unresolved:1 — honest, never guessed
  purge         1 -> 0, other owner untouched

### A silent disagreement, caught
The parity report said extractor='conversationFacts'; the row said
extractor='backfill@v1'. Both true — the observing lane and the projecting code
are different things. Now reports both: source= and projector=.

### PRE-EXISTING DEFECT FOUND BY REMOVING THE BLOCKER
`src/core/tests/pgBlobAdapter.test.js:203` does
`await import('./storageAdapter.test.js')` INSIDE a test(). Importing a test
file at runtime registers its describe/test blocks as children of the running
test, which node cancels when the parent finishes. The suite has therefore
NEVER passed — it only runs when DATABASE_URL is set, which had never happened.
Confirmed against the pristine pre-session tree: same failure. NOT caused by
this session. NOT fixed here — separate concern, deserves its own increment.

State (no PG, the default deployment):
  3070 tests · 392 suites · 3069 pass · 0 fail · 1 skip
State (with real Postgres):
  3072 tests · 395 suites · 3071 pass · 1 fail (the pre-existing defect above)
flagproof 30/30 · eval:gate PASS · router boot OK in both configurations

## Increment 7 — pgBlobAdapter test repair (E3)

### Changed
- `src/core/tests/helpers/adapterContract.mjs` (NEW) — the shared storage
  contract, MOVED out of storageAdapter.test.js into a helper that registers
  nothing on import.
- `src/core/tests/storageAdapter.test.js` — imports the helper; behaviour
  identical (22/22).
- `src/core/tests/pgBlobAdapter.test.js` — calls the contract at module scope,
  gated by the same `skip`.

### TWO DEFECTS, THE SECOND LARGER THAN THE FIRST
1. CRASH: `await import('./storageAdapter.test.js')` inside a running test()
   re-registered the json-file suite as children of that test; node cancelled
   them. The suite had NEVER passed — it only runs with DATABASE_URL set, and
   no live Postgres existed until this session.
2. THE SUITE NEVER RAN THE CONTRACT. It asserted
   `typeof runAdapterContract === 'function'` while its comment promised "the
   same nine assertions the JSON adapter satisfies". Nine assertions were never
   executed against Postgres. Fixing only the import would have turned a loud
   failure into a quiet green that still proved nothing.

### A REAL ADAPTER DIVERGENCE, FOUND BY RUNNING THE CONTRACT
'concurrent writes to one key all settle, last value wins':
  json-file  serialises; last value wins.
  pg-blob    REFUSES. Its optimistic-version guard fires on the instance's own
             in-flight writes. Reproduced hydrated AND unhydrated, so it is the
             adapter, not the invocation.

Declared as `todo` with the reason attached — assertion unchanged, still
executed, reported under `# todo 1`. NOT fixed (an E3 decision about what
optimistic concurrency means for a write-behind cache; does not belong bolted
onto a test repair). NOT loosened (that would let "it works" mean two different
things, which is what a shared contract exists to prevent).

### Bite
  reintroduce the runtime import  -> cancelledByParent, reproduced exactly
  remove the todo declaration     -> 1 fail, the divergence resurfaces

State (no PG):            3070 · 393 suites · 3069 pass · 0 fail · 1 skip · 0 todo
State (real Postgres):    3081 · 393 suites · 3079 pass · 0 fail · 1 skip · 1 todo
flagproof 30/30 · eval:gate PASS

## Remaining blockers — MEASURED, not assumed
  api.groq.com                       403 x-deny-reason=host_not_allowed
  api.openai.com                     403 x-deny-reason=host_not_allowed
  generativelanguage.googleapis.com  403 x-deny-reason=host_not_allowed
  provider keys in env: 0

This is a container egress allowlist, not a missing service. E6 promotion and
all of E7 need one of those hosts allowlisted AND a key.

## Increment 8 — E6 shadow: real data analysed, pass-selection made testable

### YOUR RUNS (e6-full.json, e6-full-2.json), both 175 calls / 0 errors
                             base    run1    run2   spread
  detection_negation        0.500   0.850   0.850   0.000   <- STABLE, fails gate
  silence_on_negatives      0.900   0.975   0.975   0.000
  detection_temporal        0.640   0.960   0.960   0.000
  detection_decision        0.533   0.867   0.867   0.000
  predicate_accuracy        0.000   0.491   0.473   0.018
  detection_recall          0.719   0.825   0.838   0.013
  fidelity_accuracy         0.647   0.665   0.641   0.024
  detection_identity        0.850   0.900   0.850   0.050   <- noisy
  overall_strict_accuracy   0.180   0.385   0.495   0.110   <- noisy
  detection_modality        0.720   0.520   0.680   0.160   <- noisy, REGRESSED
  subject_recall            0.557   0.437   0.689   0.251   <- noisiest

VERDICT: DO NOT PROMOTE — correct, and for the right reason.
  negation 0.85 vs 0.95 gate, IDENTICAL across both runs. Not noise.

BOTH REPORTED "REGRESSIONS" ARE NOISE:
  run1 flagged subject_recall 0.557 -> 0.437. run2 got 0.689 (an improvement).
       The spread (0.251) is twice the claimed regression (0.120).
  run2 flagged fidelity 0.6467 -> 0.6407, a 0.006 move inside a 0.024 spread.
Single-pass runs leave noiseRange unmeasured, so isRealRegression() returns
null and the drop is reported unverified. The machinery is right; the runs
were single-pass. Use --repeat 3.

e6-noise.json IS NOT DATA: 218 errors / 525 calls. Produced by an older script
before MAX_PASS_ERROR_RATE existed. Delete it or it will be read as a result.

### Changed
- `scripts/e6-shadow.mjs` — extracted `passIsValid()` and `pickReportedPass()`
  from main(). Behaviour identical; call sites rewritten to use them.
- `src/brain/tests/e6ShadowHarness.test.js` (+8 tests) — pass selection graded
  by BEHAVIOUR. The previous coverage was `assert.match(src, /perCase\.push\(\{/)`
  — a test that a string exists in the file. One such grep pinned the literal
  expression `good[good.length - 1]` and broke on the extraction while the
  behaviour was unchanged; replaced with the direct assertion.

### Bite
  report last pass regardless of validity -> 4 fail
  drop the error-rate check               -> 5 fail
  average the passes instead of picking   -> 2 fail

State: 3078 tests · 394 suites · 3077 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS · router boot OK

## Increment 9 — e6-shadow could not read the keys it demanded

scripts/e6-shadow.mjs never called dotenv. Only index.js does. So on a
correctly configured machine the script printed:

  ✗ No usable provider: No Groq keys configured
    Provider: groq. This script needs the same key the app uses.

— accurate and useless. The app loads .env; the script had no way to.

### Changed
- `scripts/e6-shadow.mjs` (+22) — loads the root .env BEFORE any provider
  import, same semantics as index.js and evaluation/runners/aqua-standalone.mjs
  (which solved this first): shell exports are never overridden, dotenv is
  resolved from the engine's own dependency tree, absent .env is silent.
- `src/brain/tests/e6ShadowHarness.test.js` (+3 tests)

Verified by hand: with GROQ_API_KEY_1 in ../.env the script logs
`[GROQ] model=openai/gpt-oss-120b key=...real` and proceeds to transport.
Shell export confirmed to win over the file.

### Bite
  remove the dotenv block -> the suite fails to load entirely (1 fail)

State: 3081 tests · 395 suites · 3080 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

### Windows note
PowerShell's line continuation is a backtick, not a backslash. Run on one line:
  node --env-file=..\.env scripts/e6-shadow.mjs --provider groq --model openai/gpt-oss-120b --repeat 3 --pace 1200 --json e6-percase.json
With this increment, --env-file is no longer required.

## Increment 10 — an unanswered case was scored as an extraction miss

### THE RUN FROM 3-PASS e6-percase
  reported: pass 3 of 3 · 4 transport errors · negation 70.0% (gate 95%)
  noise over 3 valid passes: detection_negation 70.0% – 85.0%  range 15.0%

ALL FOUR transport errors landed in pass 3. pickReportedPass takes the last
VALID pass, and 4/200 sits EXACTLY on the 2% validity bar — so the published
numbers came from the only pass with errors in it. Passes 1 and 2 were clean
and both read 85%.

### THE DEFECT
`suite.score(c, { facts: e6.facts })` ran whether or not the call errored.
e6.facts is empty because nothing was ASKED, and an empty answer graded
identically to a wrong one. The script's own header already refuses this at
the RUN level — "a run with no transport emits no claims and would score 0.0%
detection, which is indistinguishable from a catastrophically bad extractor" —
and the same sentence is true of one case. The guard never reached case level.

On a 20-case category one unanswered case is FIVE percentage points.

### Changed
- `scripts/e6-shadow.mjs` — errored cases excluded from the scored set
  (denominator shrinks honestly rather than the numerator being punished),
  collected in `unmeasured`, printed as an UNMEASURED block, carried in JSON.
  EMITTED NOTHING no longer lists transport errors as extraction failures.
- `src/brain/tests/e6ShadowHarness.test.js` (+4 tests)

### Bite
  score errored cases again              -> 1 fail
  blame the transport on the extractor   -> 1 fail

### THE GATE IS NOT MEASURABLE AT n=20
negation gate 95% of 20 cases = 19/20, so ONE case may miss.
Observed run-to-run spread on that category = 15% = 3 cases.
The noise is three times the entire error budget. Even a perfect extractor
would fail this gate on some runs. Pinned as a test.

Also unstable at n=15..25: detection_task range 13.3%, detection_modality 8.0%,
detection_temporal 8.0%, detection_decision 6.7%.

### STILL TRUE AFTER THE FIX
E6 beats the floor decisively on the stable metrics:
  predicate_accuracy    0.0% -> 44.3%   (the floor cannot produce predicates)
  overall_strict       18.0% -> 48.0%
  silence_on_negatives 90.0% -> 100.0%
  detection_temporal   64.0% -> 100.0%
  subject_recall       55.7% ->  66.5%
detection_modality REGRESSED 72.0% -> 52.0% and is the largest single loss:
12 of the 35 empty-emission cases are modality.

State: 3085 tests · 396 suites · 3084 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 11 — the per-case data, and naming the contract discards

### WHAT e6-percase.json PROVES
The 70% negation was an ARTIFACT, and increment 10's fix is confirmed by data
collected before it existed.

perCase, reported pass 3, negation category (20 cases):
  emitted a claim ......... 14  -> 14/20 = 70.0% as published
  transport ERROR ..........  3  negation-015, -016, -017
  genuine miss .............  3  negation-008, -012, -014

ALL THREE transport errors in the reported pass landed in negation — the ONE
category the promotion gate is judged on. Excluding them: 14/17 = 82.4%.
Both clean passes read 85% (17/20), missing the SAME three cases.

So detection_negation is STABLE at 3 misses. The "15% run-to-run noise" I
reported last turn was three timeouts, not extractor variance. I called it
stable on two agreeing runs, then called it noisy on three — both from
insufficient data. The 3 misses are:
  negation-008  "The billing service doesn't depend on search."  ?:contract
  negation-012  "I never learned Rust properly."                 model returned []
  negation-014  "I don't own the parser now."                    ?:contract

The gate needs 19/20. Three stable misses. E6 genuinely fails, for 3 reasons.

### TAXONOMY OF THE 35 EMPTY CASES (pass 3)
   3  transport errors      (negation) — not extraction failures
  10  ?:contract            model answered, contract rejected
   5  2:object-not-in-quote S2
   1  1:quote-not-verbatim  S1 (decision-009, 2 discards)
  18  model returned []     no gate involved
Ten of those 18 are MODALITY — the biggest single bucket in the run, with no
gate attribution at all. modality regressed 72% -> 52%. The sentences are
questions and hypotheticals ("What if we moved to Bangalore?", "Should I make
Dev the tech lead?"); the model declines to extract from non-assertions while
the dataset labels them modality=hypothetical|question.

### Changed
- `src/brain/understanding/pipeline.js` — S3 contract discards now key on the
  RULE: `?:contract:object-kind-mismatch` instead of `?:contract`. The reason
  was already in `r.reason` and was being replaced with a question mark.
  Bounded on the rule (fixed list), not the reason (interpolates the predicate).
- `src/brain/tests/pipeline.test.js` (+5 tests)

### Bite
  collapse back to '?:contract'      -> 3 fail
  key on the full reason (unbounded) -> 1 fail
  remove the cache clear in run()    -> 1 fail

### A TEST BUG I CAUGHT MID-WRITE
Two runs inside ONE test reused the same segment text, and extractionClient
memoises on the segment hash — so run two replayed run one's response and the
test "proved" two different defects produce the same key, the exact conclusion
it exists to disprove. The file already had beforeEach(clearCache); per-test is
not per-call. Same trap as the E6 wiring test earlier in this engagement.

State: 3090 tests · 397 suites · 3089 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 12 — the object-kind mismatch, and what e6-named.json proved

### THE INFRASTRUCTURE FIXES ALL FIRED
  pass 3 INVALID — 5 transport errors (2.5%) — excluded, pass 2 reported
  UNMEASURED — negative-035, excluded from every metric (negatives 40 -> 39)
  ?:contract  ->  ?:contract:object-kind-mismatch
  detection_negation 85.0%, stable, matching every clean pass ever run

### ONE RULE, NOT ELEVEN
discardedByGate over 525 calls:
  ?:contract:object-kind-mismatch  23     <- every contract rejection
  2:object-not-in-quote            18
  1:quote-not-verbatim              1
Twenty-three of twenty-three. The "?" hid a single defect, not a distribution.

### THE REGISTRY IS WRONG, NOT THE MODEL
  identity-006  uses        wants literal   object "Postgres"
  identity-019  owns        wants literal   object "billing service"
  identity-025  uses        wants literal   objects "Node", "React"
  negation-008  depends_on  wants literal   object "search"
  negation-014  owns        wants literal   object "parser"
  modality-012  owns        wants literal   object "billing"
  task-003      blocks      wants literal   object "Priya"      <- a PERSON
  task-008      task_owner  wants literal   object "deploy checklist"
  temporal-006  uses        wants literal   object "Python"

Implicated: uses×4 owns×3 depends_on×1 has_status×1 blocks×1 task_owner×1
TWO OF THE THREE negation cases blocking the gate are here (008, 014).
The third, negation-012 "I never learned Rust properly", is the model
returning nothing against gold `habit_of → "learning Rust"`.

### Changed
- `src/brain/understanding/pipeline.js` — an object-kind mismatch is now a
  PROPOSAL, not a silent discard, carrying the predicate and the kind actually
  observed. Same doctrine as the rule directly above it: "unknown predicate ->
  propose, don't force". Proposals are tagged kind:'predicate' (grow the
  vocabulary) vs kind:'object-shape' (correct a term already in it).
- `src/brain/tests/pipeline.test.js` — 2 tests RE-TARGETED (the behaviour they
  described changed by design), +1 new. 25 pass.

METRICS UNCHANGED. A proposal is not emitted as a fact, so detection does not
move. The gate still fails, for the same reason, now in a form somebody can act
on: the next run reports "uses was handed an entity N times".

### Bite
  mismatch back to a discard        -> 2 fail
  proposal drops the observed kind  -> 1 fail
  the two proposal kinds collapse   -> 2 fail

### THE DECISION I DID NOT MAKE
Whether `uses`, `owns`, `depends_on`, `blocks`, `task_owner` should take
entities is an ONTOLOGY change with downstream effects on S6 resolution and
claim storage. It is the owner's call (L3, L20), and it is worth roughly 2 of
the 3 gate-blocking negation misses. `has_status -> "blocked"` should stay
literal — there the model is wrong.

State: 3091 tests · 397 suites · 3090 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 13 — the registry contradicted itself, and had for as long as it existed

### THE FULL DATASET SAYS MY LAST RECOMMENDATION WAS TOO SIMPLE
I said "flip uses, owns, depends_on, blocks, task_owner to entity". Auditing
all 167 gold claims against the 17 literal-typed predicates shows three groups:

  CLEAN ENTITY   uses(14/14 named technologies) blocks(3/3) depends_on(2/2)
  CLEAN LITERAL  habit_of(17) has_status(11) plans_to(9) role_is(7)
                 deadline_for(6) has_property(3) dislikes(2) related_to(3)
  GENUINELY MIXED decided(13) owns(11) rejected(6) prefers(4) builds(6)
                 task_owner(8)
    decided -> "Postgres" AND "drop the mobile app"; both legitimate.
    No single objectKind is correct for these six. Flipping them moves the
    failures rather than removing them. That is a design finding, not a fix.

### BUT ONE SUBSET IS NOT A JUDGEMENT CALL AT ALL
"A owns B" is the same fact as "B owned_by A". So `owns`'s OBJECT and
`owned_by`'s SUBJECT are the same thing, and every subject is an entity.
A predicate declaring an inverse CANNOT take a literal object.

Violations, 5 of 15 inverse-bearing predicates:
  owns(literal) — while owned_by(entity) sat TWO LINES BELOW IT
  depends_on(literal) / depended_on_by(literal)
  blocks(literal) / blocked_by(literal)

All five corrected to entity. This resolves owns, depends_on and blocks
WITHOUT touching the ontology question, and leaves uses and task_owner
(no inverse) open — the derivation says nothing about them.

### A PRIOR SESSION FOUND THIS AND ROUTED AROUND IT
`relationshipResolver.test.js:105` is titled "S7 — the registry defect is
handled, not papered over". It asserted `objectKind === 'literal'` with the
comment "the defect still exists", built an S7 guard to canonicalise around
it, and ended: "INVERT THIS TEST if owns is ever corrected to entity-object".
Inverted, as instructed.

### AND THE EXISTING CONSISTENCY TEST COULD NEVER HAVE CAUGHT THE OTHER FOUR
It compared the two halves of a pair to EACH OTHER. depends_on ↔
depended_on_by and blocks ↔ blocked_by were both literal — consistent, and
consistently wrong. Agreement is not correctness.

### Changed
- `src/core/claims/predicateRegistry.js` — 5 objectKind corrections + the
  derivation recorded where the entries are.
- `src/core/tests/predicateRegistry.test.js` (+4 tests) — the inverse rule
  enforced structurally, so a sixth cannot be added by hand.
- `src/brain/tests/relationshipResolver.test.js` — the defect test INVERTED per
  its own instruction; the known-offenders allow-list emptied.
- `src/brain/tests/pipeline.test.js` — fixtures flipped: the mismatch to
  provoke is now a literal where an entity belongs.

### Bite
  any one of the five back to 'literal'  -> 1 fail
  a one-way inverse declaration          -> 2 fail

### NOT MEASURED — this changes extraction acceptance
uses(14) and owns(11) are heavily used in the dataset. Accepting entity objects
where they were refused should raise detection, but predicate_accuracy and
subject_recall can move in both directions. RE-RUN BEFORE BELIEVING ANYTHING:
  node scripts/e6-shadow.mjs --provider groq --model openai/gpt-oss-120b \
    --repeat 3 --pace 1500 --json e6-inverse.json

State: 3095 tests · 398 suites · 3094 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS · router boot OK
