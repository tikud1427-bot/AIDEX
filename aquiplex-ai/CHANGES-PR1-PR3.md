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

## Increment 14 — the eval never scored the object

### THE UPLOADED TREE HAD NO NEW WORK
121 files differed byte-wise; ZERO differed after stripping CR. Pure CRLF
conversion from a Windows round-trip. No e6-inverse.json — the inverse-fix
measurement has not been run yet.

### THE FINDING
extraction-core scores four levels: detection, subject, predicate, fidelity
(polarity + modality + time). It has never scored the OBJECT.

Measured on identity-019 "I own the billing service.":
  emitted object "billing service" -> subjectHits 1 predicateHits 1 fidelityHits 1
  emitted object "the moon"        -> subjectHits 1 predicateHits 1 fidelityHits 1
Byte-identical. A system that got every object wrong graded exactly as well as
one that got them all right.

THAT IS WHY THE REGISTRY CONTRADICTION SURVIVED. `owns`, `depends_on` and
`blocks` were typed to take literals while declaring inverses, for as long as
the registry has existed, and the metric that would have exposed it did not
exist. Increment 13 found it by reading; nothing could have found it by running.

### AND THE GOLD OBJECTS HAVE A CEILING
34 of 167 gold objects are NOT verbatim in their own sentence — normalised
forms like "commuting by metro" from "I commute by metro". S4 gate ② requires
an emitted object to appear verbatim in the quote. Those 34 are unreachable by
any gate-obeying extractor, so object_accuracy cannot exceed 0.7964.
Published as a number, not a comment.

### Changed
- `eval/suites/extraction-core.suite.mjs` — objectHits per case;
  `object_accuracy` + `n_object_unmatchable` as ADDITIVE metrics.
  `correct` deliberately NOT extended: folding a fifth level in would move
  every historical number and make this run incomparable with every previous.
  Exact match after normalisation (case, leading article) and no fuzzier — a
  containment rule would score "commuting by metro" against "commute by metro"
  and measure a labelling convention instead of extraction.
- `eval/tests/extractionControl.test.js` (+4 tests)
- `.gitattributes` (NEW) — `* text=auto eol=lf`, so the next Windows round-trip
  does not produce a 121-file diff that buries a real edit.

eval:gate PASS. 17 existing metrics UNCHANGED, 2 additive. Floor scores
object_accuracy 0 — it emits no structured objects, same as predicate_accuracy.

### Bite
  stop computing object_accuracy  -> 2 fail
  drop the unmatchable ceiling    -> 1 fail
  fold the object into `correct`  -> 2 fail

### A TEST OF MINE THAT DID NOT BITE, CAUGHT AND FIXED
The "additive only" test first compared two cases built from `facts: []`, where
`emitted` is false and `correct` is false whatever the object does — so folding
the object into `correct` passed it. Rewritten around a fixture that genuinely
scores correct. Third time this pattern has appeared in this engagement.

### STILL OPEN
- negation-012 "I never learned Rust properly" -> habit_of("learning Rust"),
  negated. The third gate blocker, and a LABEL question, not an extractor one:
  the sentence is about a skill not attained, not a habit. identity-034 "I'm
  learning Rust at the moment" carries the identical (s,p,o) asserted. Owner's
  call — I will not edit ground truth to make a score move.
- `uses`(14) and `task_owner`(8): no inverse, so increment 13's derivation says
  nothing about them. Ontology decision.
- modality: 10 cases the model returns nothing for, all questions and
  hypotheticals. Prompt/spec disagreement.

State: 3099 tests · 399 suites · 3098 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS · router boot OK

## Increment 15 — a per-stall ceiling is not a bound on the run

### THE STALLED RUN
Pass 1 completed clean, 200/200. Pass 2 hit the quota at case 78 and began:
  sleeping 73s (case 78) · 9s (79) · 6s (80) · 165s (81) · …
with cooldowns of 463s and 598s reported per key. The log ends mid-run.

### THE DEFECT
MAX_STALL_WAIT_MS (15 min) bounds ONE wait. Every figure above is far under it
and passes the check. With ~120 cases left, cumulative sleep is unbounded while
each individual decision to sleep looks reasonable. G6 asks for bounded; the
aggregate never was.

FOURTH defect in this codebase with the same shape — a guard that examines the
individual case and never asks about the total. The others: purge reachability
(import-level, not call-level), case-level transport errors (run guard did not
reach the case), and ?:contract (one key over eleven rules).

Also: the explicit "cooldown is N min — that is the DAILY quota" branch PRINTED
AND CONTINUED, scoring every remaining case as a transport error.

### Changed
- `scripts/e6-shadow.mjs` — MAX_PASS_STALL_MS (20 min cumulative per pass) and
  an exported `stallBudgetExceeded()`. On exceeding it, or on a single cooldown
  above MAX_STALL_WAIT_MS, the pass ABORTS and is marked invalid, so
  pickReportedPass falls back to whatever completed.
- `src/brain/tests/e6ShadowHarness.test.js` (+4 tests)

### Bite
  remove the cumulative check              -> 2 fail
  budget below a single permitted stall    -> 1 fail

### THE QUOTA IS THE REAL CONSTRAINT
Pass 1 (200 calls) ran clean; the wall came ~80 calls into pass 2. So roughly
280 calls/day are available across the four keys. `--repeat 2` on 200 cases
needs 400 and is not affordable. Affordable and still noise-measuring:
  node scripts/e6-shadow.mjs --provider groq --model openai/gpt-oss-120b \
    --repeat 2 --limit 100 --pace 1500 --json e6-inverse.json
--limit stratifies, so category balance is preserved. 200 calls total.

State: 3103 tests · 400 suites · 3102 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 16 — gemini wired into the harness

### WHAT THE 429 ACTUALLY SAID
  "tokens per day (TPD): Limit 200000, Used 198568"
  organization `org_01kvwzqg69eyvvdar00xyb4bym`

TOKENS per day, not calls. And PER ORGANISATION — all four GROQ_API_KEY_N share
one budget. My advice that a 4-key pool bought headroom was wrong: the pool
helps with per-minute limits and does nothing for TPD. ~198.5k of 200k spent.

### THE GAP
`brain/index.js:e6Transport()` dispatches to groq OR gemini, reading
AQUA_E6_PROVIDER. The harness accepted groq and openrouter only. So gemini was
a transport production can be configured to run and the eval could not measure
— a capability with no way to earn a number, which is L14 backwards. It stopped
being theoretical the moment the Groq budget ran out: no second road to any
measurement until the quota reset.

### Changed
- `scripts/e6-shadow.mjs` — PROVIDERS map now { groq, openrouter, gemini }; all
  three signatures were already identical. Error text explains TPD-vs-per-minute
  and that more keys do not buy more tokens. JSON records `provider`.
- `src/brain/tests/e6ShadowHarness.test.js` (+4 tests) — every provider
  e6Transport() can dispatch to must be selectable in the harness, derived from
  the facade source so the two lists cannot drift again.

### Bite
  remove gemini from the harness map -> 1 fail

### ⚠️ A GEMINI RUN IS NOT COMPARABLE TO A GROQ RUN
Different model, different extractor. It IS comparable to the floor — the
baseline in every report is the regex lane, not a previous E6 run — so "does E6
beat the floor" stays answerable. "Did the inverse fix help" does NOT, unless
both sides use the same model. The provider is now in the JSON so a later
reader cannot mistake one for the other.

To answer the inverse-fix question specifically, a groq run is still required
once TPD resets.

State: 3107 tests · 401 suites · 3106 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 17 — a truncated answer was being reported as a dead provider

### THE GEMINI RUN DID NOT FAIL ON TRANSPORT
Pass 1 completed 100/100. Every provider line read `success` or
`hit maxTokens=1024 cap — returning partial as successful completion`.
ZERO calls failed. The harness reported:
  ⚠️ pass 1 INVALID — 16 transport errors (16.0% of cases)
  ✗ NOTHING WAS MEASURED — all 2 pass(es) failed on transport
  Cooldowns of this length are the DAILY quota...
Only the last part was even about pass 2, and the advice pointed at a quota
that was never the constraint for pass 1.

### THE DEFECT
`pipeline.js:144` was `if (out.error) { stats.errors++; }`.
`extractionClient` had ALREADY distinguished them:
  transport:<msg> / no-transport   the call threw
  bad-json:<msg> / no-json-found / missing-claims-array
                                   the model ANSWERED, unparseably
S3 discarded the distinction one line later.

1024 output tokens is not enough for a reasoning model — gemini-2.5-flash
spends output budget thinking before emitting JSON — so a sixth of its answers
arrived truncated, failed to parse, and were filed as a provider outage.

The split decides three things downstream: whether a pass is valid, whether
consecutive failures abort the run, and (since increment 10) whether a case is
scored at all. A truncated answer must still be SCORED — the model replied and
the reply was unusable, which is an extraction failure the system owns. Only an
unanswered call is unmeasured.

### Changed
- `src/brain/understanding/pipeline.js` — stats.errors (transport) vs
  stats.malformed (answered, unparseable).
- `scripts/e6-shadow.mjs` — caseErrored uses transport errors only; a MALFORMED
  block in the report; `--max-tokens` exposed (default UNCHANGED at 1024,
  because raising it changes what is measured and needs its own run).
- `src/brain/tests/pipeline.test.js` (+5 tests)

### Bite
  collapse the split back to one counter -> 3 fail

### WHAT THIS MEANS FOR THE RUN THAT "FAILED"
Under the fix, pass 1 has 0 transport errors and is VALID. It would have
reported 100 scored cases with 16 malformed answers named as such. The run
produced a usable measurement and threw it away.

State: 3112 tests · 402 suites · 3111 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 18 — the inverse fix worked; the object metric was measuring itself

### THE INVERSE FIX: CONFIRMED (groq, 100 cases, 2 valid passes, 0 errors)
  discardedByGate BEFORE:  ?:contract:object-kind-mismatch 23 · object-not-in-quote 18
  discardedByGate AFTER:   object-not-in-quote 2
Every object-kind mismatch is gone. Twenty-three to zero.

  detection_negation   85.0%  ->  92.3%   (12/13)
  detection_recall     78.1%  ->  87.5%
  subject_recall       66.5%  ->  72.8%
  detection_identity   80.0%  ->  92.3%
  overall_strict       48.0%  ->  46.0%   (different slice, not comparable)
negation-008 and negation-014 now extract. Exactly the two the derivation
predicted. negation-012 remains the sole miss, and it is a LABEL question.

### BUT PRECISION DROPPED, AND THE CAUSE IS THE SAME FIX
  precision  100.0%  ->  83.3%   FAIL (need 85%)
  false_positives 0 -> 2 on 12 negatives (negative-009, negative-012)
The broken contract rule had been acting as an ACCIDENTAL PRECISION FILTER:
claims it wrongly rejected included ones that would have fired on negatives.
Precision was being bought by a bug.
⚠️ n=12 negatives at --limit 100. Measured noise on silence_on_negatives is
83.3%–100.0%, range 16.7% — TWO cases. Precision is not measurable to an 85%
gate at this sample size. Needs the full 40 negatives before it means anything.

### GEMINI IS THE WEAKER EXTRACTOR HERE
  negation      92.3% groq  vs  69.2% gemini
  fidelity      70.7%       vs  59.8%
  modality      69.2%       vs  61.5%
  subject       72.8%       vs  60.9%
  object-not-in-quote discards: 2 vs 12 — gemini paraphrases objects.
Only 1 valid pass (per-minute rate limits, not the daily quota). Directional,
not conclusive, but the gap is wide and one-sided.

### 🔴 MY OWN METRIC WAS BROKEN, AND ITS CONTROL PASSED ANYWAY
Both runs reported object_accuracy: 0 against a 78/92 ceiling.
CAUSE: `e6Extractor.toFact` passes the contract object through untouched, and a
validated object is `{ entity: 'billing service' }` — never a bare string.
`normObject` stringified it to `[object Object]`, which matches nothing.
The control I wrote to prove the metric works fed `object: 'billing service'` —
the shape the SUITE wants, not the shape the ADAPTER produces. A fixture that
does not match reality tests the fixture.

FOURTH time this pattern has caught me in this engagement: empty facts arrays,
a shared segment behind a cache, cases built from `facts: []`, and now a
hand-written object shape. The common factor is a fixture invented to satisfy
the assertion rather than taken from the code under test.

### Changed
- `eval/suites/extraction-core.suite.mjs` — normObject unwraps
  {entity|literal|quantity|time} and still accepts the floor's bare strings.
- `eval/tests/extractionControl.test.js` — fixtures use the REAL adapter shape;
  +1 test asserting BOTH shapes score.

### Bite
  revert the unwrap -> 3 fail

object_accuracy is still UNMEASURED against real output — the number in both
JSONs is the defect, not a result. It needs one more run.

State: 3113 tests · 402 suites · 3112 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate PASS

## Increment 19 — E8 STARTED. The Context Engine's whole deficit was one line.

### E8 NEEDS NO PROVIDER — it was never blocked on infrastructure
context-core runs entirely locally against retrieval-core (the floor it wraps).
Measured, 200 cases, both complete:

  metric                floor    CE-V2    delta
  recall_at_8           0.756    0.679    WORSE
  mrr                   0.687    0.645    WORSE
  ndcg_at_8             0.671    0.615    WORSE
  recall_superseded     0.600    0.300    WORSE (halved)
  recall_temporal       0.680    0.560    WORSE
  recall_selfword       0.750    0.625    WORSE
  recall_negation       0.800    0.700    WORSE
  ... 11 of 12 worse. Better on 1: noise_lines 16 -> 13 (lower is better).

Confirms with numbers that AQUA_CONTEXT_V2=off (increment 13) was right.

### THE CAUSE: ONE CONSTANT, TWO SCALES
`assembler.js:95` tested the DIVERSITY-PENALISED score against `minScore` —
a constant calibrated against RAW scores, and already applied for admission
twenty lines earlier (`scored.filter(c => c.score >= cfg.minScore)`).
A second, unintended admission gate wearing the label `reason: 'diversity'`,
which is why it read as deliberate.

EXPERIMENT (remove the line):
  recall_at_8       0.679 -> 0.756   EXACTLY the floor
  recall_superseded 0.300 -> 0.600   EXACTLY the floor
  recall_temporal   0.560 -> 0.680   EXACTLY the floor
Three metrics return to the floor value precisely. That line was all of it.

### Changed
- `src/brain/contextEngine/assembler.js` — the penalty now ORDERS only; it no
  longer re-decides admission. Smallest change that stops one constant meaning
  two things.

### ⚠️ eval:gate is BLOCKED, DELIBERATELY LEFT SO
  9 metrics improved · noise_lines REGRESSED 13 -> 18 (+5)
Regenerating the baseline is one line and I have not done it. The gate is
asking whether 5 lines of prompt noise are worth that recall — an owner
decision (L20), and silently updating a baseline is the exact move this
engagement has argued against throughout.

### THE CE STILL SHOULD NOT SHIP
Fixed, it MATCHES the floor on recall and costs MORE noise (18 vs 16). It has
no measured reason to exist. AQUA_CONTEXT_V2 stays off. The next E8 question is
not "promote it" but "what is it for" — the answer has to be a metric it beats
the floor on, and there currently is none.

State: 3113 tests · 402 suites · 3112 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate BLOCKED (context-core, by design)

## Increment 20 — E8 answered: the Context Engine has no purpose it can reach

The tarball contained no new work — only e6-inverse.json and e6-gemini.json,
both already analysed. So E8 continued.

### THE QUESTION MY OWN FIX RAISED
Increment 19 fixed the double-threshold bug: recall returned to the floor and
noise went 13 -> 18. But the buggy gate WAS the mechanism producing the CE's
only advantage. So: can it deliver floor recall AND less noise?

### KNOB 1 — a separate penalised-score threshold. IT IS A CLIFF, NOT A DIAL.
  T=0.00  recall8=0.756  mrr=0.670  sup=0.600  temp=0.680  noise=18
  T=0.02  identical
  T=0.04  identical
  T=0.06  identical
  T=0.08  identical
  T=0.10  identical
  T=0.12  recall8=0.679  mrr=0.645  sup=0.300  temp=0.560  noise=13
  FLOOR   recall8=0.756  mrr=0.687  sup=0.600  temp=0.680  noise=16

Arithmetic, not coincidence: admission passes raw >= minScore (0.12) and the
penalty is x0.6, so penalised scores cluster at >= 0.072. The only band the
gate can reach is raw [0.12, 0.20). Nothing sits between. There is no
intermediate setting.

### KNOB 2 — the char budget. IT NEVER BINDS.
  budget=1600 / 1400 / 1200 / 1000 / 800  ->  ALL identical, noise=18
`limit: 8` binds first on this corpus. The budget is inert.

### THE ANSWER
Fixed, the Context Engine:
  · matches the floor on recall_at_8, recall_superseded, recall_temporal
  · is BELOW the floor on mrr (0.670 vs 0.687) and no knob moves it
  · costs MORE prompt noise than the floor (18 vs 16)
  · has two configuration knobs that are inert on this corpus
It cannot be tuned into beating the thing it wraps. AQUA_CONTEXT_V2 stays off.

E8's next question is not "promote" or "tune" — it is whether the Context
Engine should exist. That is an owner decision, and it now has evidence
instead of a code reading behind it.

### eval:gate STILL BLOCKED, STILL DELIBERATE
context-core: 9 metrics improved, noise_lines 13 -> 18. The baseline currently
enshrines the BUGGY behaviour, so it should be updated — but that is a PR with
a written reason, not a silent regeneration, and the reason is now the whole of
increments 19-20.

State: 3113 tests · 402 suites · 3112 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate BLOCKED (context-core, by design)

## Increment 21 — env-doctor: the linter I offered twice and never built

Third tarball with no new work — e6-inverse.json and e6-gemini.json again, both
already analysed. So rather than repeat the blocked list, the outstanding item
I had promised and not delivered.

### THE DEFECT IT EXISTS FOR
`AQUA_E6_SHADOW=on` sat in production for months. Nothing reads it — the real
gate is `AQUA_E6` — so the understanding pipeline had NEVER run while the
deployment claimed it was on, and every observation about E6 was about a stage
that was switched off. The name was invented in a conversation and typed into
an env file.

THE FLAG REGISTRY CANNOT CATCH THIS. It compares the REGISTRY to the SOURCE, in
both directions. A key set in .env and read by nothing is absent from both.
The gap is between the deployment and the registry, and only something that
reads the env file can stand in it.

### Changed
- `scripts/env-doctor.mjs` (NEW, 175) — `npm run env:doctor [path]`
- `src/core/tests/envDoctor.test.js` (NEW, 12 tests)
- `package.json` — env:doctor script

### WHAT IT REFUSES
  · an AQUA_* key no source file reads         (the AQUA_E6_SHADOW case)
  · a gate set to a value its read site never matches — AQUA_E6=true is OFF
    because the read is `=== 'on'`, judged per-gate so inverted ones like
    AQUA_BRAIN (`!== 'off'`) are handled correctly too
  · the same key assigned twice, naming which line is dead

### WHAT IT REFUSES TO DO
Validate credentials. A previous session declared a set of live Gemini API keys
invalid by pattern-matching their `AQ.` prefix and was WRONG — Google had begun
issuing keys in that format. Shape is not validity. The linter checks only what
it can actually check.

### AGAINST A REPRODUCTION OF THE REAL DEPLOYMENT
  ✗ line 9  AQUA_E6_SHADOW  no source file reads this — it does nothing
  ✗ line 10 AQUA_E6         set to "true" but resolves to off — read is === 'on'
  ⚠ line 8  AQUA_SELF_ENTITY assigned again — line 5 is dead, this one wins
  exit 1
All three faults that were actually present, found in one pass.

### Bite
  stop reporting unregistered keys       -> 2 fail
  stop reporting unreachable gate values -> 3 fail
  stop reporting duplicates              -> 2 fail

State: 3125 tests · 403 suites · 3124 pass · 0 fail · 1 skip
       flagproof 30/30 · eval:gate BLOCKED (context-core, by design, unchanged)

## Increment 22 — the prompt forbids two of the five modalities it declares

Fourth identical tarball. Rather than repeat the blocked list, the largest
remaining extraction deficit after negation: modality.

### THE CONTRADICTION, IN ONE FILE
  extractionPrompt.js:57   MODALITIES = ['fact','intent','hypothetical','question','quote']
  extractionPrompt.js:141  "4. A conditional or a question asserts nothing. Return []."

`hypothetical` and `question` are declared valid and made unproducible thirteen
lines later. The contract ACCEPTS them; the prompt ORDERS the model never to
emit them. Every one of the 10 "model returned [] — no gate involved" modality
misses is the prompt working exactly as written.

### THE MEASURED COST
  13 of 167 gold claims are hypothetical|question = 7.8% of the corpus
  ALL 13 sit in the `modality` category, which has 25 cases
  => detection_modality CEILING under rule 4 = 12/25 = 0.480

Observed runs: 0.52 · 0.60 · 0.69 — ALL ABOVE THE CEILING.
That is only possible when the model DISOBEYS rule 4. The metric has been
rewarding instruction-violation, and the "modality REGRESSED 72% -> 52%"
finding from increment 11 may be nothing more than the model obeying its
instructions more consistently.

### Changed
- `src/brain/tests/extractionPrompt.test.js` (+2 tests) — the invariant "every
  declared modality is producible" is stated and marked `todo` with the reason;
  the arithmetic ceiling is pinned unconditionally so the decision cannot be
  made by forgetting.

Nothing in the extractor was changed. Which side is wrong is a design decision
(L20) and either choice alters what the extractor produces:
  · rule 4 right  -> the 13 labels are wrong, drop hypothetical|question from
                     MODALITIES, and detection_modality's denominator changes
  · schema right  -> rule 4 goes, and the model extracts these with the modality
                     that says what they are

### STANDING STATE
  E6   negation 92.3% (12/13) after the inverse fix; needs the full 200-case run
       + the negation-012 label call. modality now has a named cause.
  E7   not blocked — needs one local command with the Gemini keys
  E8   answered: the CE cannot be tuned into beating its floor; stays off
  gate BLOCKED on context-core noise_lines 13 -> 18, awaiting a written reason

State: 3126 tests · 405 suites · 3125 pass · 0 fail · 1 skip · 1 todo
       flagproof 30/30 · eval:gate BLOCKED (context-core, by design)

## Increment 23 — blueprint gap analysis, and E1/PR-7 closed

Fifth identical tarball. Probed all 99 blueprint PRs against the source.

### VERIFIED STATE (52-ish of 99)
  E1  Platform Safety   6/7   E7  Retrieval V3      1/9
  E2  Evaluation        6/6   E8  Context V3        4/7
  E3  Storage          11/11  E9  Reflection V3     0/8
  E4  Jobs              2/7   E10 Unification       1/10
  E5  Claims            8/10  E11 API               1/6
  E6  Understanding    11/12  E12 Observability     2/6
Critical path E2 -> E3 -> E5 -> E6 is 36 of 39.

### 🔴 MY FIRST PROBE WAS WRONG, THE SAME WAY THE FLAG COUNT WAS
I scanned `aqua/src`, `scripts`, `eval`, `router.js` — and not the root
`index.js`, where the platform layer lives. E1-6 came back "no" and is in fact
COMPLETE: `safeEqual` (timingSafeEqual), `authLimiter` on /admin, explicit
`sameSite: "lax"`, and CSRF are all present, with E1/PR-6 comments in place.
Two of the three items I offered as "unblocked, ready to build" were already
built. Re-probed across the whole repo before touching anything.

### E1/PR-7 — DONE
Deleted, after confirming ZERO importers for each:
  brain-tests-backup-before-pr15/      understanding-backup-before-pr13/
  eval-backup-before-pr15/             understanding-backup-before-pr14/
  scripts-backup-before-pr15/          understanding-backup-before-pr16/
  e6Extractor-before-pr16.mjs          src/brain/understanding/pipeline.before-pr17.js
118 files, 1.3 MB. Inventoried in the Phase 0 audit; survived 22 increments
because nothing ever failed on account of them — which is what made them
expensive. A grep for a symbol returned the live definition and three stale
ones with no way to tell them apart from the path.

- `src/core/tests/repoHygiene.test.js` (NEW, 4 tests) — no *backup* /
  *before-pr* paths, no .orig/.bak/.old/.save/.copy, the walk's own
  denominator asserted, and a check that pipeline.js SURVIVED (the deleted
  file sat directly beside it).

### Bite
  recreate a snapshot directory -> 1 fail
  add a .bak file              -> 1 fail

State: 3130 tests · 406 suites · 3129 pass · 0 fail · 1 skip · 1 todo
       flagproof 30/30 · router boots · eval:gate BLOCKED (context-core, by design)

## Increment 24 — E4/PR-4: per-owner serial ordering

### THE RACE
`jobRegistry.defer` fired every job through `setImmediate` — whatever is queued,
in whatever order it lands. Two messages sent quickly ran BOTH post-turn blocks
concurrently against ONE owner's stores. `observeConversationTurn` is
read-modify-write: read entities, add, write back. Twice, interleaved. The
loser's entities are gone and nothing reports it, because both jobs "succeeded".

Serialising everything would be the easy fix and the wrong one — one slow turn
would stall every other user behind it. The guarantee is PER OWNER: same owner
in order, different owners in parallel.

### Changed
- `src/core/jobs/jobRegistry.js` — `defer(name, fn, { ownerId })`. An ownerId
  queues behind that owner's previous job via a tail-promise chain; no ownerId
  keeps the old concurrent behaviour, so every existing caller is unaffected
  until it opts in. `jobStats().serialOwners` exposes the map size.
  BOUNDED (G6): the entry is deleted when the chain drains, identity-checked so
  a job queued mid-flight becomes the new tail rather than a parallel branch.
- `src/routes/turnPostProcess.js` — all 4 deferred blocks pass ownerId.
- `src/core/tests/jobRegistry.test.js` (+6 tests) — the concurrency test the
  blueprint asks for.

### Bite
  remove the per-owner chain            -> 3 fail
  make it a GLOBAL lock (ignore ownerId) -> 2 fail
  never clean the owner map              -> 1 fail
  chain through success only             -> 0 fail   <-- DID NOT BITE

### A CLAIM OF MINE THE BITE DISPROVED
I wrote that `.then(run, run)` was load-bearing because "chaining through only
the success path would strand every later job". `.then(run)` failed ZERO tests:
`run` catches everything itself, so `previous` can never reject and the
rejection handler is unreachable. The two-argument form stays as insurance
against someone moving the try/catch out of `run` later — but the comment now
says "unreachable today" instead of claiming it is doing work.

### AN EXISTING GREP TEST, REPLACED WITH BEHAVIOUR
`the post-turn block defers THROUGH the registry` pinned the literal
`defer('post-turn', fn)` and broke on the new argument while the behaviour was
intact. Rewritten to drive the real REAL_DEPS seam and assert that the owner
REACHES the chain — two jobs for one owner must serialise through it.

### BLUEPRINT RE-PROBE (whole repo, root + aqua)
  E1-6 YES · E1-7 YES (closed last increment) · E4-1 YES · E4-4 YES · E4-5 YES
  E4-2 worker process        no
  E4-3 job table + DLQ       no
  E4-6 reflection as jobs    no
  E4-7 DLQ runbook           no
E4 is now 3/7. E1 is 7/7 — COMPLETE.

State: 3136 tests · 407 suites · 3135 pass · 0 fail · 1 skip · 1 todo
       flagproof 30/30 · router boots · eval:gate BLOCKED (context-core, by design)

## Increment 25 — E4/PR-2 + PR-3: the durable job queue

The in-memory registry drains on SIGTERM and loses everything to any other
death — OOM, SIGKILL, a lost node. This is where a job outlives its process.

### Changed
- `src/core/db/migrations/0007_jobs.sql` (NEW) — aqua_jobs with idempotency_key
  UNIQUE per owner, priority, run_after, attempts/max_attempts, state
  (queued|running|done|dead), last_error, partial indexes for the claim query
  and the DLQ.
- `src/core/jobs/jobQueue.js` (NEW, 200) — enqueue/claim/complete/fail/
  reapStale/queueStats/deadLetters/purgeOwner + exported pure `backoffMs`.
- `scripts/worker.mjs` (NEW, 130) — `npm run worker`, graceful SIGTERM,
  `--kinds` / `--poll` / `--reap`.
- `src/core/tests/jobQueue.test.js` (NEW, 16 tests)
- `src/account/accountPurge.js`, `src/core/tests/dbPool.test.js` — see below.

### PER-OWNER ORDERING IS ENFORCED IN SQL, NOT BY AGREEMENT
PR-4 gave the in-memory path a per-owner chain, which works because one process
holds one Map. N workers have no shared memory, so the claim query carries it:
  AND NOT EXISTS (SELECT 1 FROM aqua_jobs r
                   WHERE r.owner_id = j.owner_id AND r.state = 'running')
with FOR UPDATE SKIP LOCKED so the loser of a race takes a DIFFERENT owner's
job instead of blocking. Verified against real Postgres: two jobs for one owner
-> second claim returns null; two owners -> both claimed at once.

### NOTHING IS DELETED (L5)
done and dead rows are kept. A dead job is the only record that work was asked
for and never happened. reapStale() reclaims jobs stranded by a vanished
worker — without it one crash wedges ONE owner permanently behind the very
predicate that guarantees their ordering.

### HANDLERS ARE DELIBERATELY EMPTY
E4/PR-5 and PR-6 move ingest, reflection and consolidation onto the runner.
Wiring a handler in the same commit that introduces the runner would put
production work on an unproven queue and give the first failure two candidate
causes. An unknown kind DEAD-LETTERS rather than burning its attempt budget.

### 🔴 MY OWN PINS CAUGHT A REAL GAP
The battery failed on two structural tests I wrote in earlier increments:
  · purgeCompleteness — jobQueue exports purgeOwner and account deletion never
    called it. I had built a new owner-scoped store and not wired G4.
  · dbPool ALLOWED — a new pool consumer, undeclared.
Both fixed: accountPurge now purges jobs; the allow-list gained jobQueue with
its reason. This is the third time a pin from an earlier increment has caught
the increment adding it.

### A TEST-ISOLATION DEFECT, CAUGHT AND FIXED
The first version called `claim('w1')` unfiltered and assumed the table held
only its own rows. It failed the moment a manual probe left rows behind, and
would fail against any real deployment. Every claim is now filtered to the
file's own `kind` — a shared queue is shared.

### Bite (against real Postgres)
  per-owner claim exclusion removed -> 1 fail
  dead-letter never triggers        -> 2 fail
  backoff not capped                -> 1 fail
  purgeOwner is a no-op             -> 8 fail

### Gates
  no PG   : 3141 tests · 3140 pass · 0 fail · 1 skip · 1 todo
  with PG : 3162 tests · 3161 pass · 0 fail · 1 skip · 2 todo
  flagproof 30/30 · router boots · eval:gate BLOCKED (context-core, by design)

## Increment 26 — E4/PR-6: reflection and consolidation move onto the queue

### Changed
- `src/routes/turnPostProcess.js` — `runOrEnqueue(kind, ownerId, work, discriminator)`,
  gated on AQUA_JOBS_DURABLE (default off). Reflection and consolidation route
  through it; every other deferred block is untouched. Idempotency key is
  `kind:discriminator` — the turn number for consolidation, so the same tick
  enqueued twice is one row (G2).
- `src/core/flags.js` — AQUA_JOBS_DURABLE registered (28 gates now).

### THE FALLBACK RUNS THE WORK. IT DOES NOT DROP IT.
A deployment with the flag on and no worker running, or no DATABASE_URL, would
otherwise quietly stop reflecting while the flag said the opposite — the
AQUA_E6_SHADOW failure with a different name. `runOrEnqueue` is best-effort:
if it cannot be scheduled, it runs inline, exactly as before the flag existed.
The queue is an optimisation over inline work, never a replacement that can
silently fail.

### 🔴 A REAL BUG, CAUGHT BY THE EXISTING TEST SUITE IMMEDIATELY
`runOrEnqueue` is async. The reflection/consolidation blocks were a plain
`try { work() } catch {}`, sufficient while the call was synchronous. Making
it async meant a throwing job REJECTED AFTER the try had exited — an
unhandledRejection instead of a swallowed failure. Same shape as the E6 seam
fixed earlier in this engagement. Fixed with the same pattern:
`Promise.resolve().then(...).catch(...)`.

### FIVE EXISTING TESTS BROKE ON TIMING, NOT LOGIC
`consolidationCadence.test.js` called `turn()` and asserted synchronously,
correct while consolidation was synchronous. Once it routed through an async
call, the assertion ran before the microtask landed and every count read as
"never fired". All 12 tests in the file converted to async + `await flush()`.
Same fix applied to 4 tests in `turnPostProcess.test.js` (order-sensitive
assertions) and 2 that needed `doesNotReject` instead of `doesNotThrow`.

### 🔴 A CLAIM OF MINE THE BITE DISPROVED, CORRECTED IN THE COMMENT
I added `runOrEnqueue: (k,o,w) => work()` to the test fixture with a comment
claiming its ABSENCE would throw and be silently swallowed by the fail-open
catch. Bite: deleted the line, re-ran — 12/12 still passed. Reason:
`runPostTurn` merges deps with REAL_DEPS (`{...REAL_DEPS, ...deps}`), so an
omitted key falls back to the real function, which already runs inline when
AQUA_JOBS_DURABLE is off. My comment asserted something I never ran. Corrected
to state what the bite actually showed, kept the explicit line so the fixture
does not rely on the merge to define its own behaviour.

### VERIFIED AGAINST REAL POSTGRES
AQUA_JOBS_DURABLE=on, real turn, real queue: 5 jobs landed in aqua_jobs
(queued state), not just claimed-and-dropped inline. Flag off (production
default): confirmed still synchronous fallback via the full battery.

### Gates
  no PG   : 3140 tests · 3140 pass · 0 fail · 1 skip · 1 todo
  with PG : 3161 tests · 3161 pass · 0 fail · 1 skip · 2 todo
  flagproof 30/30 · router boots · eval:gate BLOCKED (context-core, unchanged, by design)

### E4 now 6/7 — only PR-7 (DLQ alerting + runbook) remains.
