# AQUA — fixing the contradiction detector

**Closes FINDING-1.** The eval EVAL-1 built is what made this measurable, and
it earned its keep twice over.

---

## The numbers

```
                 before     after
precision         21.4%     100.0%     22 false positives → 0
recall            40.0%      73.3%     9 missed → 4
f1                27.9%      84.6%

false_fire_per_item_table   95.5%  →  0.0%
```

**Both moved together**, which was the stated requirement. Buying precision by
dropping recall would have been a different bug, not a fix.

### Confirmed on data it was never tuned against

```
300 facts → 73,500 contradiction edges  →  0
600 facts → 297,000                     →  0
```

That is FINDING-1's original graph, untouched by any of the tuning.

## What was missing: the idea of a subject

The predicate compared digits and word overlap. It had no notion that two
statements must be **about the same thing** to disagree.

Five gates, each earning its place in the bite table:

| gate | catches |
|---|---|
| **series index** | `Item 0 … 1000` vs `Item 1 … 1001` |
| **qualifier** | `Bangalore office` vs `Delhi office`, `2024 audit` vs `2025 audit` |
| **revision** | `was 1 August` vs `moved to 15 September` — history, not conflict |
| **month** | `signed on 12 January` vs `3 March` |
| **categorical / relation tail** | `confirmed`/`cancelled`, `reports to Priya`/`to Karan` |

## 🔴 Four times my own gate was too greedy — every one caught by the battery, not my dataset

| over-reach | cost |
|---|---|
| `"on 12"` and `"is 88400"` read as series labels | three genuine detections |
| `OpenAI raised` vs `OpenAI Inc. raised` | suppressed a real $10M/$99M conflict |
| `by 30 percent` vs `by 12 percent` | a **unit** is not a subject |
| `Acme Corporation raised` vs `Acme Holdings raised` | a name before a **verb** is the subject itself |

That is EVAL-1's own stated limitation made concrete. I tuned four rounds
against 53 cases; every one of these came from the 2,300-test battery instead.
**A dataset you tune against stops being a test of the thing you tuned.**

## 🔴 A test with no data isolation, mistaken for an order dependency

`contradictionFinding.test.js` passed under the full battery and failed 4-of-5
alone — which reads exactly like an order dependency and is not one.

The evidence store is a module-level singleton that loads the **real data
directory** at import. After a few manual runs the owner held **78 facts
instead of 6**, and the assertion saw **600** contradiction pairs.

FINDING-1's version had the same gap and passed only because the store happened
to be clean. It now purges its owners before seeding, and is stable 3/3 alone
and in the battery.

Worth carrying: *"passes together, fails alone"* is not always ordering — it can
be a test whose result depends on the machine's history.

## 🔴 A dead rule, found the same way as `autoLogged`

A spelled-number rule (`fourteen months` vs `six months`) bit **nothing** —
even across the full battery. The bare `is` relation-tail rule already covers
it. Removed rather than kept as decoration.

## Bite, measured

Every mutation verified as applied; zero-bite results chased to a conclusion
rather than accepted.

| mutation | failures |
|---|---|
| remove the subject gate | 5 |
| remove the revision gate | 1 |
| treat function words as series labels | 1 |
| let a verb be the modified noun | 1 *(full battery)* |
| drop the spelled-number rule | **0 → it was dead, and is gone** |

## What is still not fixed

**Recall is 73.3%, not 100%.** Four genuine contradictions are still missed,
including `Rahul joined in March 2025` vs `August 2025` where the shared year
masks the differing month. Recorded in the baseline note rather than rounded up
to "fixed".

FINDING-1's five inverting assertions are now **closed**, each flipping exactly
as designed.

## Results

```
npm test    2358 / 232 suites / 0 fail / 1 skipped-with-a-reason
eval:gate   exit 0 — the contradiction suite is gated, and the baseline moved deliberately
```
