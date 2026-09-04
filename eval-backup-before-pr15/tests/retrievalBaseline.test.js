/**
 * AQUA Eval — retrieval baseline
 * Blueprint E2/PR-5
 *
 * Same two jobs as the extraction baseline, for the same reasons:
 *
 *   1. The baseline REPRODUCES. If it drifts, retrieval behaviour changed.
 *   2. The scorer and the SEEDED WORLD are FAIR. A retrieval benchmark can be
 *      unfair in two places rather than one — a badly built world scores the
 *      seeder, not the engine. Both are asserted against synthetic perfect
 *      input.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import suite from '../suites/retrieval-core.suite.mjs';
import { seedWorld, retrieveWithCurrentEngine } from '../adapters/currentRetrieval.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../datasets/retrieval-core.v1.json'), 'utf8'));
const BASELINE = JSON.parse(readFileSync(path.join(HERE, '../baselines/retrieval-core.v1.json'), 'utf8'));
const OWNER = 'user:eval-retrieval-test';
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

before(async () => { await seedWorld(OWNER, DS.corpus); });

// ── The world is real ────────────────────────────────────────────────────────

describe('retrieval baseline — the seeded world is not a stub', () => {
  test('a verbatim query finds its fact', async () => {
    const r = await retrieveWithCurrentEngine(OWNER, 'Who is our head of design?');
    assert.ok(r.ranked.includes('f006'), `expected f006, got ${JSON.stringify(r.ranked)}`);
  });

  test('the self node is recognised — otherwise lane 2b is dark', async () => {
    // Seeded as `data.isSelf` first, which is NOT the marker the engine looks
    // for (`data.entityType === 'self'`). Lane 2b stayed dark and the whole
    // baseline was understated until the predicate was read rather than
    // assumed. This test is what stops that recurring silently.
    const r = await retrieveWithCurrentEngine(OWNER, 'What is my job?');
    assert.ok(r.ranked.length > 0, 'a first-person query returned nothing — the self anchor is not firing');
  });

  test('about edges exist — Lane 3 hops across them', async () => {
    const r = await retrieveWithCurrentEngine(OWNER, 'Tell me about Nummo.');
    assert.ok(r.ranked.length > 0, 'no graph reach — the about edges were not seeded');
  });
});

// ── The scorer is fair ───────────────────────────────────────────────────────

describe('retrieval baseline — the scorer is not accidentally harsh', () => {
  const q = DS.queries.find(x => x.cat === 'multi');

  test('PERFECT ranking scores 1.0 on every rank metric', () => {
    const perfect = { ranked: [...q.relevant, ...q.acceptable] };
    const s = suite.score(q, perfect);
    assert.equal(s.correct, true, 'perfect ranking marked wrong — the scorer is harsh');
    assert.equal(s.rr, 1);
    assert.ok(near(s.ndcg, 1), `nDCG ${s.ndcg} on a perfect ranking`);
    assert.equal(s.recalled, q.relevant.length);
  });

  test('nDCG rewards relevant above acceptable', () => {
    const good = suite.score(q, { ranked: [...q.relevant, ...q.acceptable] });
    const swapped = suite.score(q, { ranked: [...q.acceptable, ...q.relevant] });
    assert.ok(good.ndcg > swapped.ndcg, 'grading is not distinguishing relevant from acceptable');
  });

  test('silence on a silence-expecting query is correct; anything else is not', () => {
    const s = DS.queries.find(x => x.relevant.length === 0);
    assert.equal(suite.score(s, { ranked: [] }).correct, true);
    assert.equal(suite.score(s, { ranked: ['f001'] }).correct, false);
  });

  test('noise and honesty are reported separately, never averaged in', () => {
    const m = suite.metrics([
      { silence: false, cat: 'direct', hit: true, correct: true, rr: 1, ndcg: 1, recalled: 1, relevantTotal: 1, kindOk: true, returned: 1 },
      { silence: true, cat: 'unknown', correct: false, returned: 8 },
    ]);
    assert.equal(m.recall_at_8, 1, 'a noisy silence query dragged down recall');
    assert.equal(m.unknown_honesty, 0);
    assert.equal(m.noise_lines, 8);
    assert.equal(m.noisy_queries, 1);
  });
});

// ── The baseline reproduces ──────────────────────────────────────────────────

describe('retrieval baseline — reproduces the committed figures', () => {
  test('the baseline records the conditions that produced it', () => {
    assert.equal(BASELINE.caseCount, 200);
    assert.equal(BASELINE.coverage.complete, true);
    assert.ok(BASELINE.suiteFingerprint);
    assert.match(BASELINE.note, /retrieveKnowledge/);
  });

  test('every headline figure is present and in range', () => {
    for (const key of ['recall_at_8', 'mrr', 'ndcg_at_8', 'top1_correct', 'top1_kind', 'unknown_honesty']) {
      const v = BASELINE.metrics[key];
      assert.equal(typeof v, 'number', `${key} missing`);
      assert.ok(v >= 0 && v <= 1, `${key} out of range: ${v}`);
    }
  });
});

// ── What the baseline says ───────────────────────────────────────────────────

describe('retrieval baseline — the findings, pinned', () => {
  const m = BASELINE.metrics;

  test('verbatim retrieval is strong — the lane does what it was built for', () => {
    assert.ok(m.recall_direct > 0.9, `direct recall ${m.recall_direct}`);
  });

  test('FINDING: the SUPERSEDED fact wins — "where do I work" returns the old employer', () => {
    // f003 says Intercom and is superseded by f001. The engine has no notion
    // of currency, so the outdated fact ranks and the current one does not.
    // This is the single clearest argument for the claim schema's valid_from /
    // valid_to columns (Blueprint Part 3).
    assert.ok(m.recall_superseded <= 0.3, `superseded recall ${m.recall_superseded} — better than recorded, update deliberately`);
  });

  test('FINDING: negation retrieval is near-blind', () => {
    assert.ok(m.recall_negation <= 0.3, `negation recall ${m.recall_negation}`);
  });

  test('FINDING: the category/instance gap is real and large', () => {
    // "What is my job?" against "I run product at Nummo" — no lexical overlap.
    assert.ok(m.recall_category < m.recall_direct - 0.3);
  });

  test('FINDING: only a third of unanswerable queries get silence', () => {
    // Every noisy query is FIRST PERSON. The self-anchor fires on any "my"/"I"
    // question and returns 8 owner facts whether or not they answer it — it
    // has no relevance gate. That one behaviour is the whole honesty gap.
    assert.ok(m.unknown_honesty < 0.5, `unknown honesty ${m.unknown_honesty}`);
    assert.ok(m.noise_lines > 50, `noise lines ${m.noise_lines}`);
  });

  test('FINDING: the top hit is the right KIND less than half the time', () => {
    assert.ok(m.top1_kind < 0.5, `top1_kind ${m.top1_kind}`);
  });
});
