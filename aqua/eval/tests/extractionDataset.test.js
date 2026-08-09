/**
 * AQUA Eval — extraction dataset integrity
 * Blueprint E2/PR-2
 *
 * The dataset is the measuring stick. If it drifts, every number downstream
 * drifts with it silently — a metric that improved because three hard cases
 * were quietly deleted is worse than no metric.
 *
 * So the dataset is pinned the way the parser fixtures were in E1/PR-1: the
 * shape is asserted, the category counts are asserted, and the categories that
 * exist to be HARD are asserted to still be hard.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateDataset, census, validateClaim, DatasetError,
  PREDICATES, POLARITIES, MODALITIES, CATEGORIES,
} from '../datasets/schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../datasets/extraction-core.v1.json'), 'utf8'));
const claims = DS.cases.flatMap(c => c.claims);

// ── Shape ────────────────────────────────────────────────────────────────────

describe('extraction dataset — shape', () => {
  test('validates against its own schema', () => {
    assert.equal(validateDataset(DS), true);
  });

  test('is exactly 200 cases, as the blueprint specifies', () => {
    assert.equal(DS.cases.length, 200);
  });

  test('the category census is pinned', () => {
    // Pinned so a rebalance is a decision someone makes and a reviewer sees,
    // not a drift that quietly changes what every downstream number means.
    assert.deepEqual(census(DS), {
      identity: 40, people: 20, negation: 20, modality: 25,
      temporal: 25, decision: 15, task: 15, negative: 40,
    });
  });

  test('every case id is unique and well formed', () => {
    const ids = DS.cases.map(c => c.id);
    assert.equal(new Set(ids).size, 200);
    for (const id of ids) assert.match(id, /^[a-z]+-\d{3}$/);
  });

  test('no sentence appears twice', () => {
    const texts = DS.cases.map(c => c.text.trim().toLowerCase());
    assert.equal(new Set(texts).size, 200, 'a duplicated sentence double-counts in every metric');
  });
});

// ── The categories that exist to be hard ─────────────────────────────────────

describe('extraction dataset — the hard categories are actually hard', () => {
  test('negatives carry no claims — this is what makes precision measurable', () => {
    const negatives = DS.cases.filter(c => c.cat === 'negative');
    assert.equal(negatives.length, 40);
    assert.equal(negatives.every(c => c.claims.length === 0), true);
    // 20% of the dataset. An extractor that fires on everything gets perfect
    // recall and is useless; this project has shipped that failure twice.
    assert.ok(negatives.length / DS.cases.length >= 0.15);
  });

  test('negation is represented in enough volume to score', () => {
    const negated = claims.filter(c => c.polarity === 'negated');
    assert.ok(negated.length >= 20, `only ${negated.length} negated claims — too few to be a metric`);
  });

  test('every non-fact modality is represented', () => {
    const seen = new Set(claims.map(c => c.modality));
    for (const m of MODALITIES) {
      assert.ok(seen.has(m), `modality "${m}" is absent — it cannot be measured`);
    }
    for (const m of ['intent', 'hypothetical', 'question', 'quote']) {
      assert.ok(claims.filter(c => c.modality === m).length >= 5, `too few ${m} claims`);
    }
  });

  test('relative time is represented, not just absolute dates', () => {
    // The current engine handles absolute dates only. Relative expressions are
    // the half it cannot do, so they have to be here or the gap is invisible.
    const timed = claims.filter(c => c.time);
    const relative = timed.filter(c => c.time.kind === 'relative');
    assert.ok(timed.length >= 30, `only ${timed.length} timed claims`);
    assert.ok(relative.length >= 15, `only ${relative.length} relative-time claims`);
  });

  test('decisions and tasks are present — both absent from the engine today', () => {
    assert.ok(claims.filter(c => ['decided', 'rejected'].includes(c.p)).length >= 15);
    assert.ok(claims.filter(c => ['task_owner', 'has_status', 'blocks'].includes(c.p)).length >= 15);
  });

  test('first-person and third-person subjects are both well represented', () => {
    const self = claims.filter(c => c.s === 'SELF').length;
    assert.ok(self >= 60, 'too few first-person claims');
    assert.ok(claims.length - self >= 50, 'too few third-person claims');
  });
});

// ── Vocabulary ───────────────────────────────────────────────────────────────

describe('extraction dataset — controlled vocabulary', () => {
  test('every predicate used is in the registry', () => {
    for (const c of claims) assert.ok(PREDICATES.includes(c.p), `unregistered predicate ${c.p}`);
  });

  test('no predicate is used only once — a one-off is unscoreable', () => {
    const counts = {};
    for (const c of claims) counts[c.p] = (counts[c.p] ?? 0) + 1;
    const singletons = Object.entries(counts).filter(([, n]) => n === 1).map(([p]) => p);
    assert.deepEqual(singletons, [], 'predicates with one example cannot produce a meaningful per-predicate score');
  });

  test('polarity and modality only take known values', () => {
    for (const c of claims) {
      assert.ok(POLARITIES.includes(c.polarity));
      assert.ok(MODALITIES.includes(c.modality));
    }
  });

  test('every category in the registry is used', () => {
    const used = new Set(DS.cases.map(c => c.cat));
    for (const cat of CATEGORIES) assert.ok(used.has(cat), `category "${cat}" declared but unused`);
  });
});

// ── Honesty ──────────────────────────────────────────────────────────────────

describe('extraction dataset — states its own limitations', () => {
  test('it says out loud that it is synthetic', () => {
    const text = DS.limitations.join(' ').toLowerCase();
    assert.match(text, /synthetic/);
    assert.match(text, /not sampled from real transcripts/);
  });

  test('it names CORRECTIONS-LIVE as its replacement', () => {
    // A synthetic benchmark defended past its usefulness is how a project
    // measures itself into a corner. The successor is named in the file.
    assert.match(DS.limitations.join(' '), /CORRECTIONS-LIVE/);
  });

  test('it admits single-annotator and single-sentence scope', () => {
    const text = DS.limitations.join(' ').toLowerCase();
    assert.match(text, /one annotator/);
    assert.match(text, /coreference/);
  });
});

// ── The validator bites ──────────────────────────────────────────────────────

describe('extraction dataset — the validator refuses bad labels', () => {
  test('a subject that is not in the sentence is refused', () => {
    assert.throws(() => validateClaim('x-001',
      { s: 'Zebedee', p: 'works_at', o: 'Aquiplex', polarity: 'asserted', modality: 'fact' },
      'Priya works at Aquiplex.'), DatasetError);
  });

  test('SELF without a first-person marker is refused', () => {
    // This caught four of my own mislabels while the dataset was being written.
    assert.throws(() => validateClaim('x-002',
      { s: 'SELF', p: 'uses', o: 'Redis', polarity: 'asserted', modality: 'fact' },
      'The README says the project uses Redis.'), /first-person/);
  });

  test('an unregistered predicate is refused', () => {
    assert.throws(() => validateClaim('x-003',
      { s: 'SELF', p: 'vibes_with', o: 'Redis', polarity: 'asserted', modality: 'fact' },
      'I vibes_with Redis'), /unknown predicate/);
  });

  test('a negative case carrying claims is refused', () => {
    assert.throws(() => validateDataset({
      ...DS,
      cases: [{ id: 'negative-999', cat: 'negative', text: 'hello there', claims: [
        { s: 'SELF', p: 'uses', o: 'x', polarity: 'asserted', modality: 'fact' }] }],
    }), /must carry no claims/);
  });

  test('a dated claim with no expression is refused', () => {
    assert.throws(() => validateClaim('x-004',
      { s: 'SELF', p: 'uses', o: 'Go', polarity: 'asserted', modality: 'fact', time: { kind: 'relative' } },
      'I use Go'), /must record the expression/);
  });
});
