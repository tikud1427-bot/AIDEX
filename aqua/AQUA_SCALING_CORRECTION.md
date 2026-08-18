# AQUA — correcting a measurement, and nearly deleting a real finding

**Status:** a harness fix and an honest correction. No production code changed.

---

## What I set out to do

FIX-2 left one target: *"the FI-2 pass is still 3.81× quadratic — the
contradiction edges were only one cause, so profiling the rest is bounded."*

## What the profile said

Every stage, measured separately at 300 → 600 facts:

```
rebuildGraph    760ms →  843ms    1.11×
getForensics     97ms →  203ms    2.08×
consensus         4ms →    3ms    0.74×
gaps             22ms →    4ms    0.19×
whatCaused        1ms →    1ms    0.69×
seeding          26ms →   15ms    0.57×
```

**Nothing quadratic.** So where was 3.81× coming from?

## The suspicion, and one measurement that agreed with it

The FI-2 test's workload writes into module-level singleton stores. Each sample
leaves its owner's data behind, so the 2n sample runs against a store holding
everything before it. A single better-isolated reading:

```
accumulating store   4.11×
isolated per sample  1.90×
```

That looked conclusive. I wrote the correction, retitled the test *"scales
LINEARLY"*, and started documenting FLAKE-1's finding as an artefact.

## 🔴 It was not an artefact. I nearly deleted a real result.

The isolation was incomplete — `purgeOwner` cleared the **evidence** store and
left the UKO store and the reasoning graph. With all three purged, four
consecutive runs:

```
3.12×   3.31×   3.73×   3.09×
```

**Superlinear, close to FLAKE-1's original 3.96×.** The 1.90× was the outlier.

Two things are true and worth keeping apart:

| | |
|---|---|
| the **finding** stands | the pass is superlinear, ~3.2× |
| the **harness** was wrong | it purged one store of three, inflating the earlier figure |

**The lesson is the retraction, not the finding.** One reading is not a
measurement, and I was one commit away from deleting a real result because a
single number disagreed with it — after spending several PRs insisting that
zero-bite results be chased rather than accepted.

FINDING-1 is unaffected either way: its 73,500 contradiction edges were counted
**directly**, never inferred from a ratio.

## What actually ships

**A `reset` seam on the scaling helper**, with the failure written into its
header. `work(n)` and `work(2n)` must start from the same state, or the ratio
measures accumulation instead of the algorithm — and the helper now says so
where the next caller will read it.

**The FI-2 pin, corrected.** It purges all three stores, asserts the measured
shape (>2.4×, ceiling 4.5×), and inverts when someone makes it linear. Stable
3/3.

## What is still not known

**Which stage is superlinear.** The per-stage profile above was taken with the
same incomplete isolation, so those numbers are suspect too — the honest answer
is that I have a reliable ratio for the *whole pass* and no trustworthy
breakdown yet.

Recorded as the open question rather than guessed at. Re-profiling with full
isolation per stage is the next concrete step, and it is now cheap because the
`reset` seam exists.

## Results

```
npm test    2358 / 232 suites / 0 fail / 1 skipped-with-a-reason
eval:gate   exit 0
```
