# AQUA — an eval for the forensics `edited_number` rule

**Status:** the prerequisite FINDING-2 named. A seam extraction with **zero
behaviour change**, plus a dataset and a gated baseline.

---

## Why this before the fix

FINDING-2 measured **90 alert-severity "doctored figure" findings from 20
ordinary ledger rows** and declined to repair it:

> *`differentSubjects` would almost certainly fix it — and that is exactly why
> it should not be reached for casually. Applying a gate validated against the
> CONTRADICTION evals to a FORENSICS rule assumes the two mean the same thing
> by the same test.*

This stops it being an assumption.

## The baseline

```
precision   33.3%     16 false positives against 8 true
recall     100.0%     every genuine alteration caught
f1          50.0%

false_fire_per_item_table   100%    ← every ordinary ledger pair fires
false_fire_restatement        0%
false_fire_different_shape    0%
```

**Purely an over-firing problem** — unlike the contradiction detector, which
was broken in both directions. A fix here has one job and one thing it must not
break.

## Precision matters more here than anywhere else in this project

A false contradiction is noise in a graph. A false `edited_number` **accuses a
document of being tampered with**, at `severity: 'alert'`, in the surface a
user reads when they are already suspicious.

So the set is weighted 21 ordinary to 8 edited, and the two metrics are never
averaged. Scored explicitly:

| rule | precision | recall |
|---|--:|--:|
| perfect | 1.00 | 1.00 |
| fires on everything | 0.28 | **1.00** |
| fires on nothing | **0.00** | 0.00 |

That last row guards the divide-by-zero that would make total silence look
flawless — the same trap EVAL-1 caught.

## "Edited" is not "disagrees"

`contradiction-core.v1` asks whether two statements can both be true.
This asks whether they are the **same claim with one figure changed**.

A test enforces the distinction: every pair labelled `edited` must have an
identical number-masked shape. Conflating the two would make this dataset
quietly measure the wrong rule.

Identical restatements are labelled **ordinary** — the same figure twice is
corroboration, not tampering.

## A seam, not a copy

`_looksEditedForTests` is the engine's own predicate, extracted verbatim. A
duplicate in the harness would drift the first time either side changed, and
the baseline would measure a rule nobody ships — the reasoning EVAL-1
established and the reason its numbers can be trusted.

The **file gate stays out** of the predicate: provenance is policy, and
FINDING-2's false positives all passed it legitimately. The text is where the
error is.

Anchored on **real dataset cases**, not invented ones. EVAL-1's seam test used
a hand-written pair that returned `null` and was simply wrong; an invented
fixture gets to be wrong in a way a real case does not.

## Bite

| mutation | failures |
|---|---|
| average precision and recall into one score | 1 |
| precision 1.0 when nothing fires | 1 |
| let identical statements count as edited | 1 |
| let different shapes group together | 2 |
| *(reverted)* | **0 — 19/19** |

## Results

```
npm test    2398 / 239 suites / 0 fail / 1 skipped-with-a-reason
eval:gate   exit 0 — the forensics suite is gated from this commit
```

## What is now unblocked

Fixing FINDING-2. The target is precise: **raise precision from 33.3% while
holding recall at 1.0**, with `false_fire_per_item_table` at 100% being the
whole of the damage.

Fourth time this project has built an eval before a repair — EVAL-1 → FIX-1/2,
EVAL-2 → FIX-5, and now this. It has stopped being a rule and become the way
the work is done.
