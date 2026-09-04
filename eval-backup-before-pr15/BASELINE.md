# Extraction baseline — the current engine

**Blueprint:** E2/PR-3 · measured on `extraction-core.v1` (200 cases, 167 claims)
**Configuration:** all understanding flags **ON** — a baseline measures what the
code can do, not what a `.env` currently permits

---

## The number

```
overall_strict_accuracy   15.0%     all four levels must hold

detection_recall          61.3%     a claim-bearing sentence produced something
subject_recall            41.3%     the claim's subject was recognised as an entity
predicate_accuracy         0.0%     ← structural
fidelity_accuracy          0.0%     ← structural  (polarity · modality · time)

silence_on_negatives      75.0%     10 false positives out of 40
```

## Why the two zeros are the headline

They are not bad luck. The conversation lane emits a **verbatim statement plus
an entity list** — there is no predicate field and no polarity, modality or
time field anywhere in its output. These cannot be non-zero until the schema
changes.

That is the clearest one-line statement of what E5 (claim schema) and E6
(understanding pipeline) are for, and it is now a measurement rather than an
opinion.

The scorer computes both from the output shape rather than hardcoding zero, so
the day E6 emits predicates they start scoring with no change here. A test
pins that.

## Detection by category — where the misses are

| category | detection | reading |
|---|--:|---|
| identity | **85.0%** | first-person disclosure is the lane's strength |
| modality | 68.0% | captures the sentence, loses the mood entirely |
| people | 55.0% | third-person subjects are missed about half the time |
| decision | 53.3% | |
| task | 53.3% | |
| negation | 45.0% | **and every one that IS captured is stored positively** |
| temporal | **44.0%** | weakest — the category the engine handles least |

## Two findings, pinned as tests

**A request containing a proper noun still produces a fact.** `"Explain how
OAuth works to me."` emits one, because OAuth reads as an entity and the lane
has no notion of a request. Same failure class as `"I need to check the logs"`
— fixed once at the self-declaration gate, still live on the general path. Six
of the ten false positives are this shape.

**The speaker is recognised only when the sentence declares them.** `"I run
product at Nummo."` yields a self entity; `"I moved to Bangalore last month."`
does not. Self recognition rides the self-declaration grammar rather than the
pronoun, so first-person subjects are missed on most sentence shapes — the
direct cause of subject_recall sitting at 41%.

## The adapter, and the trap it avoids

The baseline is only as honest as the adapter. This one replicates
`conversationIngest.js` step for step — extract → lift the self mention →
resolve → build facts — rather than calling the pieces in a plausible order.

**Three probes written against this lane returned zero facts for every
sentence** before the adapter was right: a wrong argument shape, then a wrong
field name, then a missing resolver step. Any of them would have published a
0% baseline and made every future replacement look miraculous. The extractor
was working each time.

A test now asserts the adapter extracts something real, so that cannot recur
silently.

## The scorer is tested for fairness, not just correctness

A scorer that is accidentally harsh publishes a baseline that is too low, and
then E6 looks like a triumph for reasons that have nothing to do with E6.

So the suite feeds the scorer **synthetic perfect output** and asserts it
scores 100% at every level. The zeros in the published baseline therefore come
from the extractor, not the grader.

**Bite, measured:** loosen `correct` to ignore predicate+fidelity → 1 fail ·
fake precision as perfect → 2 · drive the engine in its dark config → 2 ·
break the adapter (the 0%-baseline trap) → 3.

## What E6 has to beat

| metric | today | E6 target (Blueprint Part 11) |
|---|--:|--:|
| detection_recall | 61.3% | ≥ 70% (recall) |
| predicate_accuracy | 0.0% | ≥ 85% (precision) |
| fidelity — negation | 0.0% | ≥ 95% |
| silence_on_negatives | 75.0% | should not regress |

`silence_on_negatives` is the one to watch during E6: an LLM extractor that
fires on requests would trade a real gain in recall for a worse false-positive
rate, and a single averaged accuracy figure would hide it.

## Regenerating

```bash
npm run eval -- extraction-core
npm run eval -- extraction-core --json eval/baselines/extraction-core.v1.json
```

The committed baseline is asserted to reproduce. If it drifts, extraction
behaviour changed — that is either a regression or an improvement, and either
way it gets named in the PR that moves it.

---

# Retrieval baseline — the current engine

**Blueprint:** E2/PR-5 · measured on `retrieval-core.v1` (60 facts, 200 queries)
**Path:** `pic/core.js retrieveKnowledge()` — the exact facade the chat spine calls
**Configuration:** all understanding flags **ON**

---

## The numbers

```
recall@8          63.7%
MRR               56.7%
nDCG@8            55.5%
top1_correct      53.0%
top1_kind         42.9%     the top hit is the KIND of thing asked for

unknown_honesty   34.4%     ← only a third of unanswerable queries get silence
noise_lines        131      ← across 21 of 32 silence-expecting queries
```

## Recall by category — where retrieval actually fails

| category | recall@8 | reading |
|---|--:|---|
| direct | **96.4%** | verbatim retrieval does exactly what it was built for |
| multi | 67.9% | |
| temporal | 56.0% | |
| selfword | 50.0% | |
| category | **40.6%** | the category/instance gap — *"what is my job"* vs *"I run product at Nummo"* |
| negation | **20.0%** | near-blind |
| superseded | **20.0%** | **the outdated fact wins** |

## Three findings, pinned as tests

**1. The superseded fact wins.** `f003` says Intercom and is superseded by
`f001`. The engine has no notion of currency, so *"where do I work"* returns
the old employer and the current one does not rank. This is the single
clearest argument for `valid_from` / `valid_to` in the claim schema
(Blueprint Part 3).

**2. Every noisy query is first-person.** All 131 noise lines come from
questions like *"what is my dog's name"*, *"which car do I drive"*, *"what is
my blood type"* — eight owner facts returned each time. The self-anchor
(lane 2b) fires on any first-person question and **has no relevance gate**.
That one behaviour is the entire honesty gap.

**3. The top hit is the right kind less than half the time.** A *"where"*
question answered with a churn number is wrong even when the fact concerns the
right person. Shape-aware ranking exists but does not reach far enough.

## The adapter can lie in two places, not one

A retrieval benchmark has a **world** and a **query path**, and a badly built
world scores the seeder rather than the engine.

The world is seeded with the same node and edge shapes `conversationIngest`
writes — fact node, `asserts` edge, and an **`about` edge per entity**. Those
edges are what Lane 3 hops across; without them the facts sit in the store off
every graph path that reaches them.

**One real miss, caught by reading the code rather than assuming it:** the self
node was first seeded as `data.isSelf`, but the engine looks for
`data.entityType === 'self'`. Lane 2b stayed dark and the whole baseline was
understated until the predicate was read. A test now asserts a first-person
query returns something.

**Bite:** unmark the self node → 1 fail · stop seeding `about` edges → 1 ·
fake unknown-honesty as perfect → 1 · flatten the nDCG grades → 1.

## Caveat that travels with every number here

**60 facts is a small corpus.** Lexical precision degrades as a corpus grows,
so these are an **upper bound** on the same engine at 5,000 facts.
RETRIEVE-SCALE (Blueprint Part 11) remains unbuilt, and every retrieval figure
this project has ever quoted carries this caveat.

## What E7 has to beat

| metric | today | E7 target |
|---|--:|--:|
| recall@10 | 63.7% | ≥ 85% |
| nDCG@10 | 55.5% | ≥ 75% |
| top1_kind | 42.9% | ≥ 90% |
| unknown_honesty | 34.4% | ≥ 90% |
| noise_lines | 131 | ≤ current |
