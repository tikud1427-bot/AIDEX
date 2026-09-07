# AQUIPLEX — Repository Hygiene

**Blueprint reference:** Epic E1 (Platform Safety) · PR-7 — **the last PR of Epic 1**
**Tree:** platform (repo root)
**Changes behaviour:** no — nothing deleted was reachable from any entry point

---

## Why a script, not a tarball

Every other PR in this epic shipped as an archive, because an archive can add
and replace files. This one **removes** them, and an archive cannot do that.
So the deletion is a script — and because a deletion is the one change that
silently undoes itself, it ships with a test that keeps it done.

## The script refuses to trust its own list

`PR7-cleanup.sh` re-runs the reference check on the machine where the deletion
happens, not the machine where the list was written, and **refuses** to remove
anything still imported. `--dry-run` reports without touching anything.

That gate earned its place immediately: **two items on the original audit's
delete list were wrong.**

## 🔴 Two corrections to my own audit

**1. `evaluation/` is not cruft — it is AQEval.** A deliberate benchmark
evaluation framework with provider adapters (aquiplex, anthropic, mock),
configs and dashboards, built to measure AQUA on MMLU, HumanEval, GPQA and
others. The audit listed it as "exists at repo root and is not wired". It is
not unwired clutter; it measures something **different** from what E2 will
measure — benchmark capability versus understanding quality. Both are needed.
**KEPT, and E2 should start by reading it.**

**2. `aqua/src/files/evidenceValidator.js` is not dead.** The audit called it
dead code. It has no *production* caller — but `evidenceQCandRetrieval.test.js`
imports it, and deleting it breaks a suite. **KEPT**, with a test that asserts
the importing suite still imports it, so a future cleanup cannot repeat this.

## What went — and why the first one mattered

**Root `src/` — the dangerous one.** A copy of the aqua provider layer whose
`router.js` had **drifted** from the live file, 484 lines against 490. Two
provider routers in one repo, one of them wrong, neither obviously
authoritative. That is the shape of an incident, not clutter. It also carried a
1,363-line fossil of `chat.js` against the live 1,454.

`projectRetriever (1).js` was the same defect in miniature: 468 lines against
the live 491.

The rest: three byte-identical duplicate modules, six orphaned root-level tests
that **no npm script runs**, six `.diff` files, two `.patch` files, eleven
applied PR archives, four FUSE stubs, five migration stubs, the superseded
`apply.sh`, and `how HEAD~1:package.json` — a `git show` redirect that became a
filename.

**40 items removed. Idempotent: a second run removes 0.**

## A self-referential dead cluster

The gate initially held back `callGraph.js` and `contextCompressor.js` as
"still imported". The only importers were `symbolGraph (1).js` and
`projectRetriever (1).js` — **both on the same delete list**.

A file that is itself scheduled for deletion is not a live reference, and
counting it as one would have kept the whole cluster forever. The gate now
ignores doomed importers. That is a correctness fix to the check, not a
workaround around it.

## `.gitignore`

Archives, patches, diffs and FUSE stubs are now ignored, so the residue cannot
silently return. The hygiene test **deliberately does not police downloaded PR
archives** — a test that failed whenever a tarball was downloaded would fail
during every future apply, and a guard nobody can keep green gets deleted.

## Results

```
platform    61 / 0 fail    (from 50)
account     12 / 0 fail
engine    1872 / 103 suites / 0 fail    — untouched, 0 vulnerabilities, router boots
```

## One defect in my own script

`*.migrated-to-datadir` never matched `.aqua-history.json.migrated-to-datadir`
— a bare `*` glob does not match a leading dot. I predicted this while writing
the script and then failed to act on it; the hygiene test caught it.

## Applying

```bash
bash apply-pr.sh ~/Downloads/PR7-repo-hygiene.tar.gz   # adds the test + .gitignore
bash PR7-cleanup.sh --dry-run                          # review
bash PR7-cleanup.sh                                    # delete
```

The script is safe to run from anywhere inside the repo and safe to run twice.
