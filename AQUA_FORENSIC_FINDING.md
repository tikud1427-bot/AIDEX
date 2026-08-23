# AQUA — `edited_number` fires on ordinary ledger rows

**Status:** a measured finding. **No production code changed**, and the reason
is the same one FINDING-1 gave.

---

## The open question, answered

FIX-6 left: *"identify the remaining superlinear FI-2 stage."* Profiled at
600 → 1200 facts, all three stores purged per sample:

```
rebuildGraph    77ms →  136ms   1.77×   ← linear since FIX-5
getForensics   216ms →  992ms   4.60×   ← THE STAGE
consensus        2ms →    8ms   4.70×   (2ms absolute — noise)
gaps             1ms →    3ms   2.25×
```

Reruns of `getForensics`: **4.43×**, **2.92×**. `edgesInspected` stayed **0**
throughout, so it is not the graph — it is `forensicEngine`'s `edited_number`
rule.

## The same bug as FINDING-1, in a different engine

The rule masks digits out of a statement and groups by the result:

```
"Item 0 for VendorCo recorded value 1000 on 2026-01-10"
   → "Item # for VendorCo recorded value # on #-#-#"
```

**Every row of a ledger masks to the same key.** One group holds all N facts,
the inner double loop is O(N²), and every pair is emitted.

```
20 ledger rows across 2 files → 90 `edited_number` findings
                                 (truthful answer: 0)
```

Each one is `severity: 'alert'`, explained to the user as *"the signature of a
doctored figure."* `Item 3 … 1003` and `Item 4 … 1004` are two different line
items.

## Why this is worse than the contradiction version

A false contradiction is noise in a graph. A false `edited_number` **accuses a
document of being tampered with**, at alert severity, in the surface a user
reads when they are already suspicious.

FIX-1's subject gate fixed exactly this shape in the contradiction detector. It
was never applied here, because nobody knew this rule existed.

## Why it is not fixed here

`differentSubjects` would almost certainly fix it — **and that is exactly why
it should not be reached for casually.** Applying a gate validated against the
*contradiction* evals to a *forensics* rule assumes the two mean the same thing
by the same test.

There is no forensics eval. FINDING-1's reasoning holds unchanged: a repair
that cannot be measured is a guess, and this rule's severity is `alert`, so a
wrong guess is louder than most.

## Narrowed, not overstated

- **Within one file it is silent** — the trigger is cross-file, same as
  FINDING-1.
- **A real edited number is still caught.** The same sentence with one figure
  changed across two files fires exactly once. A test asserts it, so this
  cannot be read as *"delete the rule"* — it is misaimed, not useless, and a
  fix must not buy precision by losing this.

## What ships

Six inverting assertions, the same mechanism as E1's ratio ceiling, E3/PR-10's
write shape and FINDING-1's five. Each fails when someone improves this, so the
fix is noticed rather than absorbed.

## The honest next step

A **forensics eval**, in the shape of `contradiction-core.v1`: labelled pairs
of genuine tampering and ordinary per-item variation. That is what makes
applying the subject gate here a measurement instead of a guess — and it is the
third time this project has needed an eval before a repair, which by now is
less a rule than a habit.

## Results

```
npm test    2379 / 237 suites / 0 fail / 1 skipped-with-a-reason
eval:gate   exit 0 · flagproof 30/30
```
