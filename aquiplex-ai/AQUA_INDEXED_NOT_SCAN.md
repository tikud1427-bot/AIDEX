# AQUA — closing the last declared measurement gap

**Closes the item FLAKE-1 declared and did not convert.** Plus a pin that
FIX-5 quietly invalidated.

---

## The assertion that could never fail

FLAKE-1 found two tests named for an algorithmic property they did not measure,
converted one, and **declared the other rather than silently skipping it**:

```js
assert.ok(queryMs < 200, `query ${queryMs}ms fast (adjacency-indexed, not a scan)`);
```

Two things wrong with it:

- `Date.now()` has millisecond resolution and an indexed lookup is
  sub-millisecond, so this read **`0 < 200`** — it could not fail.
- A full **scan** of the same 2,000-edge graph would also have finished well
  inside 200 ms. The assertion could not detect the regression its own message
  named.

## Counted, not timed

Same instrument as FIX-4's comparison counter, for the same reason. `edgesOf`
now reports how many edges a lookup **inspected**:

| | edges inspected |
|---|---|
| indexed | the node's **degree** |
| scan | the graph's **total edges** |

Over an order of magnitude apart, exactly and load-independently.

**It catches a real scan.** Replacing `g.adj.get(nodeId)` with a filter over
`g.edges.values()` — a genuine index-to-scan regression — fails the test. The
old assertion passed that same mutation.

## 🔴 FIX-5 invalidated a pin without anyone noticing

The FI-2 superlinearity pin started failing one run in four. Not a flake in the
usual sense — **FIX-5 made that pass ~4× faster**, and at 60–130 ms the timing
ratio stopped being an instrument:

```
n=300, isolated:   2.80×   3.31×   1.86×     ← straddles the 2.4× pin
n=600, isolated:   3.42×   6.39×   5.17×     ← still clearly superlinear
```

So the finding stands — something in the pass is still superlinear — but it was
being measured in a regime where the numbers no longer mean anything. `n` is
raised to 600, where three samples agree. Stable 3/3 alone and across two full
batteries.

**This is the third time a lower bound on a timing ratio has needed
attention.** It is the fragile direction by nature: contention inflates the
small sample and pushes the ratio toward the threshold. The stage FIX-5 fixed
is now pinned *exactly* by a comparison counter; this assertion covers the rest
of the pass, where no counter exists yet, and should be replaced by one when
the next superlinear stage is identified. Written into the test.

## Bite

| mutation | failures |
|---|---|
| replace the index with a scan | 1 |
| *(the old `queryMs < 200` against the same mutation)* | **0** |

## Results

```
npm test    2373 / 236 suites / 0 fail / 1 skipped-with-a-reason
            stable across two consecutive batteries
eval:gate   exit 0 · flagproof 30/30
```

One counter increment in `edgesOf` is the whole production change.
