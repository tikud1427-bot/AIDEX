/**
 * Brain V1 / B4 — Context Engine V2.
 *
 * The guarantees under test:
 *   TEN DIMENSIONS  every candidate is scored on all ten brief dimensions,
 *                   each bounded and independently explainable.
 *   ASSEMBLED       selection spreads the budget across what the question is
 *                   about (diversity), instead of dumping the top-N about one
 *                   entity — the brief's "do NOT dump every memory" rule.
 *   BUDGET          the char budget is a real constraint, not a suffix cut.
 *   SUPERSET        the return shape is exactly the PIC contract plus extra
 *                   observability, so the chat seam is untouched.
 *   FAIL-SAFE FLOOR any failure returns the PIC floor — never a worse answer.
 *   OFF BY DEFAULT  AQUA_CONTEXT_V2=on selects V2; otherwise pure passthrough.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-b4-'));
process.env.AQUA_DATA_DIR = TMP;

const { scoreCandidate, rankedDimensions, DIMENSION_WEIGHTS } = await import('../contextEngine/scorer.js');
const { assembleContext } = await import('../contextEngine/assembler.js');
const CE = await import('../contextEngine/index.js');
const Brain = await import('../index.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function bag(over = {}) {
  return {
    queryTokens: new Set(['aqua', 'billing']),
    semanticScores: null,
    activeProjectTokens: new Set(),
    activeGoalTokens: new Set(),
    focusEntityIds: new Set(),
    priorEntityIds: new Set(),
    maxHops: 3,
    ...over,
  };
}

function fact(id, text, over = {}) {
  return { kind: 'fact', id, text, confidence: 0.8, sourceType: 'document', entityIds: [], hops: null, timestamp: Date.now(), semanticId: id, ...over };
}

beforeEach(() => { delete process.env.AQUA_CONTEXT_V2; delete process.env.AQUA_BRAIN; });
afterEach(() => { delete process.env.AQUA_CONTEXT_V2; delete process.env.AQUA_BRAIN; });

// ── TEN DIMENSIONS ───────────────────────────────────────────────────────────

test('TEN DIMENSIONS: every brief dimension is scored, bounded, and present', () => {
  const required = ['importance', 'recency', 'relationship_distance', 'active_project',
    'active_goal', 'confidence', 'source_reliability', 'conversation_continuity',
    'semantic_similarity', 'user_focus'];
  const { dimensions } = scoreCandidate(fact('f1', 'AQUA billing runs nightly'), bag());
  for (const dim of required) {
    assert.ok(dim in dimensions, `missing ${dim}`);
    assert.ok(dimensions[dim] >= 0 && dimensions[dim] <= 1, `${dim} out of range: ${dimensions[dim]}`);
  }
  assert.equal(Object.keys(DIMENSION_WEIGHTS).length, 10, 'exactly ten weighted dimensions');
});

test('weights sum to 1, so a total score is a clean 0..1', () => {
  const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  const { score } = scoreCandidate(fact('f1', 'AQUA billing'), bag());
  assert.ok(score >= 0 && score <= 1);
});

test('user_focus rewards covering the query terms', () => {
  const onTopic = scoreCandidate(fact('f1', 'AQUA billing service invoice'), bag()).dimensions.user_focus;
  const offTopic = scoreCandidate(fact('f2', 'the weather today is mild'), bag()).dimensions.user_focus;
  assert.ok(onTopic > offTopic, `${onTopic} > ${offTopic}`);
});

test('semantic_similarity uses real vectors when present, lexical fallback when not', () => {
  const withVec = scoreCandidate(fact('f1', 'unrelated words entirely', { semanticId: 'f1' }),
    bag({ semanticScores: new Map([['f1', 0.95]]) })).dimensions.semantic_similarity;
  assert.ok(withVec > 0.9, 'vector score used directly');

  const noVec = scoreCandidate(fact('f2', 'aqua billing overlap', { semanticId: 'f2' }),
    bag({ semanticScores: null })).dimensions.semantic_similarity;
  assert.ok(noVec > 0, 'lexical fallback still contributes with embeddings off');
});

test('relationship_distance decays with hops; unknown gets a neutral floor', () => {
  const d0 = scoreCandidate(fact('f', 'x', { hops: 0 }), bag()).dimensions.relationship_distance;
  const d1 = scoreCandidate(fact('f', 'x', { hops: 1 }), bag()).dimensions.relationship_distance;
  const d2 = scoreCandidate(fact('f', 'x', { hops: 2 }), bag()).dimensions.relationship_distance;
  const dNull = scoreCandidate(fact('f', 'x', { hops: null }), bag()).dimensions.relationship_distance;
  assert.ok(d0 > d1 && d1 > d2, 'monotonic decay');
  assert.equal(d0, 1);
  assert.ok(dNull > 0 && dNull < 1, 'no path → neutral, not zero');
});

test('source_reliability: document > conversation > inferred', () => {
  const doc = scoreCandidate(fact('f', 'x', { sourceType: 'document' }), bag()).dimensions.source_reliability;
  const conv = scoreCandidate(fact('f', 'x', { sourceType: 'conversation' }), bag()).dimensions.source_reliability;
  const inf = scoreCandidate(fact('f', 'x', { sourceType: 'inferred' }), bag()).dimensions.source_reliability;
  assert.ok(doc > conv && conv > inf, `${doc} > ${conv} > ${inf}`);
});

test('active_project and active_goal fire on token touch', () => {
  const proj = scoreCandidate(fact('f', 'the billing migration is on track'),
    bag({ activeProjectTokens: new Set(['billing', 'migration']) })).dimensions.active_project;
  assert.equal(proj, 1);
  const goal = scoreCandidate(fact('f', 'ship the invoicing rewrite'),
    bag({ activeGoalTokens: new Set(['invoicing']) })).dimensions.active_goal;
  assert.equal(goal, 1);
});

test('conversation_continuity fires when an entity was already in play', () => {
  const cont = scoreCandidate(fact('f', 'x', { entityIds: ['ent:a'] }),
    bag({ priorEntityIds: new Set(['ent:a']) })).dimensions.conversation_continuity;
  assert.equal(cont, 1);
  const fresh = scoreCandidate(fact('f', 'x', { entityIds: ['ent:z'] }),
    bag({ priorEntityIds: new Set(['ent:a']) })).dimensions.conversation_continuity;
  assert.equal(fresh, 0);
});

test('scores are explainable — top contributions can be ranked', () => {
  const { dimensions } = scoreCandidate(fact('f1', 'AQUA billing invoice', { semanticId: 'f1' }),
    bag({ semanticScores: new Map([['f1', 0.9]]) }));
  const ranked = rankedDimensions(dimensions);
  assert.equal(ranked.length, 10);
  assert.ok(ranked[0].contribution >= ranked[9].contribution, 'sorted by contribution');
  assert.ok('weight' in ranked[0] && 'dim' in ranked[0]);
});

// ── ASSEMBLED, NOT DUMPED ────────────────────────────────────────────────────

test('ASSEMBLED: diversity stops one entity from starving the question', () => {
  // Five strong facts about entity A, one about entity B. A naive top-N would
  // take all five A-facts. The assembler should make room for B.
  const candidates = [
    fact('a1', 'aqua billing detail one', { entityIds: ['ent:a'], confidence: 0.9 }),
    fact('a2', 'aqua billing detail two', { entityIds: ['ent:a'], confidence: 0.9 }),
    fact('a3', 'aqua billing detail three', { entityIds: ['ent:a'], confidence: 0.9 }),
    fact('a4', 'aqua billing detail four', { entityIds: ['ent:a'], confidence: 0.9 }),
    fact('a5', 'aqua billing detail five', { entityIds: ['ent:a'], confidence: 0.9 }),
    fact('b1', 'aqua billing sibling topic', { entityIds: ['ent:b'], confidence: 0.7 }),
  ];
  const out = assembleContext(candidates, bag(), { limit: 4, perEntitySoftCap: 2, diversityPenalty: 0.4 });
  const entities = out.items.filter(i => i.kind === 'fact').map(i => i.id);
  const aCount = entities.filter(id => id.startsWith('a')).length;
  assert.ok(entities.includes('b1'), 'the second entity earns a slot');
  assert.ok(aCount <= 3, `entity A capped by diversity (${aCount} selected)`);
});

test('BUDGET: a tight char budget selects fewer, not a truncated dump', () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    fact(`f${i}`, `aqua billing fact number ${i} with enough words to cost budget`, { confidence: 0.8, entityIds: [`ent:${i}`] }));
  const tight = assembleContext(candidates, bag(), { limit: 10, charBudget: 200 });
  const loose = assembleContext(candidates, bag(), { limit: 10, charBudget: 2000 });
  assert.ok(tight.items.length < loose.items.length, 'tight budget selects fewer items');
  assert.ok(tight.block.length <= 200 + 80, 'block respects budget (+header slack)');
  assert.ok(tight.stats.contextEngine.dropReasons.budget > 0 || tight.stats.contextEngine.selected < candidates.length);
});

test('THRESHOLD: items below the floor are left out entirely', () => {
  const candidates = [
    fact('good', 'aqua billing strong match', { confidence: 0.9 }),
    fact('junk', 'completely unrelated trivia about penguins', { confidence: 0.1, sourceType: 'inferred', timestamp: 0 }),
  ];
  const out = assembleContext(candidates, bag(), { limit: 8, minScore: 0.2 });
  const ids = out.items.map(i => i.id);
  assert.ok(ids.includes('good'));
  assert.ok(!ids.includes('junk'), 'weak item excluded, not just ranked last');
});

test('an empty candidate set yields an empty, safe assembly', () => {
  const out = assembleContext([], bag(), {});
  assert.deepEqual(out.items, []);
  assert.equal(out.block, '');
});

// ── SUPERSET SHAPE ───────────────────────────────────────────────────────────

test('SUPERSET: returns the PIC contract plus contextEngine observability', () => {
  const out = assembleContext([fact('f1', 'aqua billing', { confidence: 0.9 })], bag(), {});
  for (const k of ['items', 'block', 'stats']) assert.ok(k in out, `missing ${k}`);
  for (const k of ['facts', 'entities', 'timelineEvents', 'connectedFacts', 'reusedSignals', 'durationMs']) {
    assert.ok(k in out.stats, `PIC stat ${k} missing`);
  }
  const ce = out.stats.contextEngine;
  assert.equal(ce.version, 2);
  assert.ok('candidates' in ce && 'selected' in ce && 'dropReasons' in ce);
  // Items keep the PIC fact shape.
  const it = out.items[0];
  assert.equal(it.kind, 'fact');
  assert.ok('statement' in it && 'citations' in it && 'score' in it && 'dimensions' in it);
});

// ── ORCHESTRATOR: FLOOR + SWITCHES ───────────────────────────────────────────

test('OFF BY DEFAULT: without the switch, the PIC floor passes straight through', () => {
  const floor = { items: [{ kind: 'fact', id: 'x', statement: 'floor fact', confidence: 0.9, citations: [] }], block: 'FLOOR', stats: { facts: 1 } };
  const deps = { picRetrieve: () => floor, graph: stubGraph(), evidenceStore: null, peekMind: () => null };
  const out = CE.assembleTurnContext(deps, 'o', 'aqua billing', {});
  assert.equal(out.block, 'FLOOR', 'passthrough — V2 not engaged');
  assert.equal(CE.contextV2Enabled(), false);
});

test('FAIL-SAFE FLOOR: a broken graph returns the PIC floor, never worse', () => {
  process.env.AQUA_CONTEXT_V2 = 'on';
  const floor = { items: [{ kind: 'fact', id: 'x', statement: 'floor fact', confidence: 0.9, citations: [] }], block: 'FLOOR', stats: { facts: 1 } };
  const brokenDeps = {
    picRetrieve: () => floor,
    graph: { nodesByType: () => { throw new Error('boom'); } },
    evidenceStore: null, peekMind: () => null,
  };
  const out = CE.assembleTurnContext(brokenDeps, 'o', 'aqua billing', {});
  assert.equal(out.block, 'FLOOR', 'fell back to the floor on failure');
});

test('the read-side kill switch disables V2 assembly', () => {
  process.env.AQUA_CONTEXT_V2 = 'on';
  process.env.AQUA_BRAIN = 'off';
  assert.equal(CE.contextV2Enabled(), false);
});

test('V2 never regresses below the floor when it would select nothing', () => {
  process.env.AQUA_CONTEXT_V2 = 'on';
  // Floor has an item, but the graph is empty and the floor item scores below
  // threshold — V2 must still not return fewer items than the floor had.
  const floor = { items: [{ kind: 'fact', id: 'x', statement: 'zzz', confidence: 0.05, citations: [] }], block: 'FLOOR', stats: { facts: 1 } };
  const deps = { picRetrieve: () => floor, graph: stubGraph(), evidenceStore: null, peekMind: () => null };
  const out = CE.assembleTurnContext(deps, 'o', 'nomatch', { limit: 8 });
  assert.ok(out.items.length >= 1, 'floor preserved rather than an empty assembly');
});

test('facade: assembleContext is guarded and honours the switch', () => {
  const floor = { items: [], block: '', stats: {} };
  const out = Brain.assembleContext('o', 'q', () => floor, { deps: { graph: stubGraph(), evidenceStore: null, peekMind: () => null } });
  assert.ok('items' in out && 'block' in out && 'stats' in out);
});

// ── stubs ────────────────────────────────────────────────────────────────────

function stubGraph() {
  return {
    nodesByType: () => [],
    neighbors: () => [],
    edgesOf: () => [],
    getNode: () => null,
  };
}
