# AQUA Parse Isolation

**Blueprint reference:** Epic E1 (Platform Safety) · PR-4
**Status:** landed
**Changes behaviour:** yes — untrusted-byte parsing now runs in a bounded worker

---

## Why

E1/PR-3 bounded ZIP expansion. It did nothing for the parsers we do not
control: `pdf-parse`, `mammoth` and SheetJS each allocate on shapes we cannot
predict, and none can be bounded from the outside. Nor can a ceiling stop CPU
exhaustion — a pathological regex inside a parser hangs the event loop with
memory flat.

That matters more here than in most systems: the process parsing an upload is
the same single process holding **every user's state** in memory behind a
500 ms debounced writer. An OOM kill discards up to 500 ms of unflushed writes
across all owners.

## ⚠ The finding that changed this design

The blueprint said "worker with a hard memory cap". Node's cap is not hard for
the memory that matters. Probed directly, with `maxOldGenerationSizeMb: 32`:

```
Array of strings (V8 heap)     → ERR_WORKER_OUT_OF_MEMORY, capped     ✅
Buffer.alloc (external memory) → escaped, allocated 320 MB unimpeded  ❌
```

`resourceLimits` bounds the **V8 heap only**. `Buffer` and `ArrayBuffer` memory
is external and is not counted — and Buffers are exactly what pdf-parse,
adm-zip and SheetJS allocate while decompressing. A worker with only the heap
cap guards the *less likely* failure and misses the more likely one.

This was found by writing the test, not by reading the docs. The first version
of `hog.mjs` allocated Buffers in an unbounded loop and OOM-killed the entire
test run — which is precisely how the gap surfaced.

## What ships

Three bounds, applied together, because no one of them is sufficient:

| Bound | Covers | Enforced by | Precision |
|---|---|---|---|
| `MAX_HEAP_MB` 256 | V8 heap growth | Node `resourceLimits` | hard, exact |
| `TIMEOUT_MS` 30 s | hangs, CPU exhaustion | `worker.terminate()` | hard, exact |
| `MAX_RSS_GROWTH_MB` 512 | **external / Buffer memory** | parent-side watchdog, 200 ms poll | best-effort |

**The watchdog is honestly imperfect and the docs say so rather than implying
otherwise.** RSS is process-wide, so under concurrent parses growth is not
attributable to one worker; the threshold is generous enough that only a
genuine bomb trips it. And a single instantaneous multi-GB allocation can still
complete between two polls — the defence for *that* case is PR-3's zipGuard,
which checks declared sizes **before** inflation. Layered, not redundant.

## The fallback policy — the load-bearing decision

Fail-open is this codebase's default habit, and it is wrong here in one
specific case. The two failures are split by cause:

```
worker could not START            → run inline, log loudly
  (spawn error, missing module)     the input is not implicated; refusing every
                                    upload because the thread pool is unhappy
                                    trades a real outage for a hypothetical attack

worker hit a CEILING              → REJECT the input, never retry inline
  (heap / deadline / RSS)           retrying a memory bomb inline is exactly the
                                    crash the worker exists to prevent, run on purpose
```

Getting that split backwards would make this PR decorative. Both halves are
asserted, and the "never retried inline" assertion is the one with the most
bite in the suite.

## Design: wrapper, not invasion

`parseDocument`, `extractArchive` and `extractZip` are **untouched** and still
pure. Every existing test still calls them directly, at the same speed, and
`golden.json` cannot move. Production call sites switch to the `*Bounded`
variants in `src/upload/boundedParse.js`, which run the identical function
inside the worker.

Same shape as `zipGuard`: one doorway, and the thing behind it unchanged.

**One-shot, not pooled.** A pool would amortise startup and would also carry
parser state between two users' documents — a bug class this codebase cannot
detect. If pooling is ever needed, pool per **owner**, never globally.

## Cost — measured

```
bare worker spawn                34 ms
+ parser module graph           ~215 ms   (pdf-parse + mammoth + SheetJS in a fresh isolate)
─────────────────────────────────────
total per bounded parse         ~250 ms
```

Acceptable on an upload path, which already pays network, storage and indexing.
It is **not** on the chat turn hot path. If it ever needs reducing, the lever is
lazy per-format imports inside `documentParser.js`, not a pool.

## Wired

```
src/upload/documentPipeline.js   parseDocument      → parseDocumentBounded
src/routes/project.js            extractZip         → extractZipBounded
src/files/parsers.js             extractArchive     → extractArchiveBounded  (default dep only;
                                                      injected fakes untouched)
```

## Known gap — E1/PR-4b

`src/project/fileIngester.js` parses **every document inside a workspace
upload** in a loop and is still inline. A one-shot worker costs ~250 ms, so
bounding it here would add 250 ms × N files — a real regression on a 50-file
repo. It needs a reusable session with respawn-on-death, which is its own PR.

Recorded as a test — `KNOWN GAP: the workspace ingest loop is still unbounded
(E1/PR-4b)` — so it inverts when PR-4b lands rather than being forgotten. Same
mechanism PR-1 used for the missing ratio ceiling that PR-3 closed.

Files reaching that loop have already passed zipGuard's ceilings, so the
exposure is narrower than the direct-upload path this PR closes. It is not zero.

## Kill switch

`AQUA_PARSE_WORKER=off` runs everything inline, as before this PR. It exists
because a worker failure mode nobody predicted should not mean "uploads are
down". It is on unless explicitly set to `off`.

## Bite, measured

| Mutation | Failures |
|---|---|
| remove the RSS watchdog | 1 |
| retry inline on a limit breach (*the* bug) | 2 |
| drop `asBuffer()` in the worker | 5 |
| drop the error `.limit` carry-across | 1 |
| *(reverted)* | **0 — 17/17 pass** |

## Two defects in my own work, caught during the PR

1. **The heap cap does not bound Buffers** — above. Found because the test
   OOM-killed the run.
2. **A partial `str_replace`, twice.** `routes/project.js` ended up calling
   `extractZipBounded` while still importing `extractZip`, and
   `documentPipeline.js` called `parseDocumentBounded` without importing it —
   because the real import was a *combined* one
   (`{ parseDocument, isDocumentExt as isCoreDocumentExt }`) that my anchor did
   not match, and I printed "wired" without asserting. A missing import fails
   only at **call** time, so `import()` succeeded and grep looked right; five
   tests caught it. Every replacement in this PR now asserts, and verification
   is by execution rather than by grep.

## Results

```
npm test    1799 / 97 suites / 0 fail    (from 1782 / 92)
golden      byte-identical
flagproof   30/30 · fixtures 10 verified · router boots · 0 vulnerabilities
```

## Applying

No dependency change; no `npm ci` needed.

```bash
bash apply-pr.sh ~/Downloads/PR4-parse-isolation.tar.gz
```
