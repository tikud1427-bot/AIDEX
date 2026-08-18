# AQUA — measuring a shape instead of a stopwatch

**Status:** test-suite hygiene · closes the flake class carried since E3/PR-1

---

## Why this, now

The battery is the foundation of every claim made in this project. A known
flake erodes that quietly: a failure nobody trusts is a failure nobody reads.

The flake I recorded as "artifacts quota, order-dependent" no longer
reproduces — 3/3 clean in isolation. So rather than chase one instance, I
characterised the class.

**18 tests assert a wall-clock budget.** Two of them are named for an
algorithmic property they do not measure:

```
'perf: forensics + research + cause stay LINEAR — 300 facts under 1.5s'
   → assert.ok(ms < 1500)

'query fast (adjacency-INDEXED, NOT A SCAN)'
   → assert.ok(queryMs < 200)
```

"Stays linear" and "took under 1500 ms" are different claims. The first is a
property of the algorithm; the second is a property of the machine on the day.
Under the parallel battery those numbers move with unrelated load — which is
the flake, seen twice in one session, passing in isolation both times so each
failure taught nobody anything.

**Loosening the budget would be the obvious fix and the wrong one:** it hides a
real regression to silence a false one.

## The fix — measure the ratio

Run at N and 2N and compare. Load slows both samples, so it largely cancels;
what survives is the shape.

```
linear      2N costs ~2× N
quadratic   2N costs ~4× N
```

A ceiling between them separates the two robustly — and unlike a stopwatch, it
**fails when someone makes the algorithm quadratic on a fast machine**, which
an absolute budget passes happily.

Below a noise floor it **skips with a reason** rather than asserting: at
single-digit milliseconds the ratio is dominated by timer resolution and GC,
and judging that would create the very flake this removes.

## 🔴 What converting the first test found

```
FI-2 pass: doubling 300 → 600 facts costs 3.96×
```

**The pass is effectively quadratic**, and the old `ms < 1500` assertion could
never have seen it — 300 facts simply fit under the budget on this machine.

Checked before believing it: the stores are module-level singletons, so I first
suspected the second sample was paying for the first. It was not — the ratio
held at ~3.9 with per-sample isolation.

**Nothing here made it slower. This made it visible.**

Pinned the way E1's ratio ceiling and E3/PR-10's write shape were pinned: the
ceiling is set to catch a **worsening** (4.5×), and the assertion **inverts**
if someone makes it linear, so the fix is noticed rather than absorbed.

## 🔴 A fixture that was too quiet

The helper's own "quadratic is rejected" test failed three times running with
*Missing expected rejection*. The helper was right: the synthetic workload
finished in ~2 ms, below the noise floor, so it correctly **declined to judge**.

A test for a noise-floor guard has to be loud enough to clear it. The fixture
was resized; the guard was never wrong.

## Declared, not silently skipped

The second mismatch — `queryMs < 200` for an indexed lookup — is **not
converted here**. Its budget is so generous that a full scan of 2,000 nodes
would likely pass it too, so it does not test what its message claims. But it
is not flaking, and converting it needs two graph sizes built to compare.

Recorded rather than quietly left: it is the next candidate if this pattern
proves out.

## Bite, measured

Every mutation verified as applied first. The helper's ceiling is tested
against **synthetic linear and quadratic work**, because measuring bite on the
real FI-2 test proved nothing — its ratio sits mid-band and never touches the
throw.

| mutation | failures |
|---|---|
| never reject a bad ratio | 1 |
| skip the warm-up (flatters the ratio) | 1 |
| assert on sub-noise measurements | 1 |
| *(reverted)* | **0 — 6/6, stable across three runs** |

## Results

```
npm test    2336 / 226 suites / 0 fail / 1 skipped-with-a-reason
eval:gate   exit 0 · flagproof 30/30
```
