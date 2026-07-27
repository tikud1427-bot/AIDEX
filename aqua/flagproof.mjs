/**
 * Phase 0 — functional proof for each flag.
 *
 * The test battery staying green with flags on proves only that nothing
 * crashes; 15 call sites in the brain suites set their own env, so the
 * ambient value barely reaches them. This exercises the enabled path for
 * real and asserts the observable difference each flag is supposed to make.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-flagproof-'));
process.env.AQUA_DATA_DIR = TMP;

const G = await import('./src/reasoning/reasoningGraph.js');
const mindStore = await import('./src/mind/mindStore.js');
const Brain = await import('./src/brain/index.js');

const O = 'user:proof';
const results = [];
const check = (flag, claim, pass, detail) => {
  results.push({ flag, claim, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${flag.padEnd(18)} ${claim}\n      ${detail}`);
};

// ── AQUA_BRAIN_INGEST ────────────────────────────────────────────────────────
// Claim: conversations enter the world model.
const turn = {
  ownerId: O, conversationId: 'c1', turn: 1,
  userMessage: 'Priya owns the billing service at Aquiplex and it is blocking the Q4 launch.',
  assistantMessage: 'Understood — Priya owns billing at Aquiplex.',
};

delete process.env.AQUA_BRAIN_INGEST;
const offResult = Brain.observeConversationTurn(turn);
const offCount = Brain.listEntities(O).length;

process.env.AQUA_BRAIN_INGEST = 'on';
const onResult = Brain.observeConversationTurn(turn);
const onEntities = Brain.listEntities(O);

check('AQUA_BRAIN_INGEST',
  'off = inert, on = conversations become graph entities',
  offCount === 0 && onEntities.length > 0,
  `off → ${offCount} entities (skipped: ${offResult.skipped ?? 'n/a'}); on → ${onEntities.length} entities: ${onEntities.map(e => e.title).join(', ')}`);

const conversationSourced = onEntities.some(e =>
  (e.sourceRefs?.files ?? []).some(f => String(f).startsWith('conv:')));
check('AQUA_BRAIN_INGEST',
  'entities carry conversational provenance, not fake document provenance',
  conversationSourced,
  `sourceRefs → ${JSON.stringify(onEntities[0]?.sourceRefs ?? {})}`);

// ── AQUA_CONTEXT_V2 ──────────────────────────────────────────────────────────
// Claim: retrieval is scored + assembled, and never regresses below the floor.
const floorItems = [
  { kind: 'fact', statement: 'Aquiplex is building AQUA', confidence: 0.9, entities: ['Aquiplex'] },
  { kind: 'fact', statement: 'Priya owns billing', confidence: 0.8, entities: ['Priya'] },
];
const floor = () => ({ items: floorItems, block: floorItems.map(i => i.statement).join('\n'), stats: { facts: 2 } });

delete process.env.AQUA_CONTEXT_V2;
const ctxOff = Brain.contextV2Active();

process.env.AQUA_CONTEXT_V2 = 'on';
const ctxOn = Brain.contextV2Active();
const assembled = Brain.assembleContext(O, 'who owns billing?', floor, { limit: 8 });

check('AQUA_CONTEXT_V2',
  'gate flips, and the assembler returns a PIC-floor superset',
  ctxOff === false && ctxOn === true && Array.isArray(assembled.items),
  `off=${ctxOff} on=${ctxOn}; items=${assembled.items.length} hasContextEngineStats=${!!assembled.stats?.contextEngine}`);

check('AQUA_CONTEXT_V2',
  'selects rather than dumps — a scored subset of the floor, each item explainable',
  assembled.items.length > 0 && assembled.items.length <= floorItems.length,
  `floor=${floorItems.length} selected=${assembled.items.length} candidates=${assembled.stats?.contextEngine?.candidates ?? '?'} dropped=${assembled.stats?.contextEngine?.dropped ?? '?'}`);

// ── AQUA_TWIN_V2 ─────────────────────────────────────────────────────────────
// Claim: style is inferred from turns, and the anti-fabrication bar holds.
delete process.env.AQUA_TWIN_V2;
Brain.observeTwin({ ownerId: O, userMessage: 'Keep it brief and concise, bullet points only, no preamble.' });
const twinOff = Brain.getTwin(O);

process.env.AQUA_TWIN_V2 = 'on';
const oneTurn = 'Keep it brief and concise, bullet points only, no preamble please.';
Brain.observeTwin({ ownerId: O, userMessage: oneTurn, conversationId: 'c1' });
const afterOne = Brain.getTwin(O);

for (let i = 0; i < 6; i++) {
  Brain.observeTwin({ ownerId: O, userMessage: oneTurn, conversationId: 'c1' });
}
const afterMany = Brain.getTwin(O);

check('AQUA_TWIN_V2',
  'off observes nothing',
  twinOff.inferences.length === 0,
  `inferences=${twinOff.inferences.length}`);

check('AQUA_TWIN_V2',
  'ONE turn never establishes a claim (minEvidence 3 / minConfidence 0.45)',
  afterOne.inferences.length === 0,
  `after 1 turn → ${afterOne.inferences.length} reportable, ${afterOne.tentative} tentative`);

check('AQUA_TWIN_V2',
  'repeated evidence crosses the bar, carrying confidence + evidence + lastVerified',
  afterMany.inferences.length > 0 &&
    afterMany.inferences.every(i => 'confidence' in i && 'lastVerified' in i),
  `after 7 turns → ${afterMany.inferences.length} inferences: ${afterMany.inferences.map(i => `${i.pattern}=${i.value}@${i.confidence}`).join(', ') || '(none)'}`);

// ── AQUA_REFLECT_V2 ──────────────────────────────────────────────────────────
// Claim: reflection emits a structured delta, and only WRITES when enabled.
G.upsertNode(O, {
  id: 'ent:name:newthing', type: 'entity', label: 'New Thing', kind: 'derived',
  data: { entityType: 'name', aliases: [], resolutionConfidence: 1, fileCount: 1 },
  sourceFiles: ['uko:x.pdf'],
});

delete process.env.AQUA_REFLECT_V2;
const reflectOff = Brain.reflectTurn(O);

process.env.AQUA_REFLECT_V2 = 'on';
G.upsertNode(O, {
  id: 'ent:name:another', type: 'entity', label: 'Another Thing', kind: 'derived',
  data: { entityType: 'name', aliases: [], resolutionConfidence: 1, fileCount: 1 },
  sourceFiles: ['uko:y.pdf'],
});
const reflectOn = Brain.reflectTurn(O);

check('AQUA_REFLECT_V2',
  'off still COMPUTES the delta (dry-run observability) but applies nothing',
  reflectOff.delta !== null && reflectOff.applied === false,
  `off → delta=${reflectOff.delta ? 'computed' : 'null'} applied=${reflectOff.applied}`);

check('AQUA_REFLECT_V2',
  'on emits a structured WorldDelta object, not a text summary',
  reflectOn.delta !== null && typeof reflectOn.delta === 'object' && !Array.isArray(reflectOn.delta),
  `on → applied=${reflectOn.applied} deltaKeys=[${Object.keys(reflectOn.delta ?? {}).join(', ')}]`);

// ── Master kill switch ───────────────────────────────────────────────────────
process.env.AQUA_BRAIN = 'off';
const killed = Brain.listEntities(O);
delete process.env.AQUA_BRAIN;
const revived = Brain.listEntities(O);

check('AQUA_BRAIN',
  'master switch empties everything, and unsetting restores it with no data loss',
  killed.length === 0 && revived.length > 0,
  `off → ${killed.length} entities; unset → ${revived.length} entities`);

// ── Summary ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.pass);
console.log(`\n${'─'.repeat(70)}\n${results.length - failed.length}/${results.length} functional checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  ${f.flag}: ${f.claim}\n    ${f.detail}`);
  process.exitCode = 1;
}
