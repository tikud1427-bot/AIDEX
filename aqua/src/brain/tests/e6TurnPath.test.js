/**
 * E6 on the real turn path — blueprint §8's non-negotiable, finally closed.
 *
 * §8: "Do not leave the new understanding system as beautiful code + unit tests
 * + zero production consumers." It had zero for its entire life —
 * `grep runUnderstandingPipeline src/ routes/` returned its own module and its
 * own tests, nothing else.
 *
 * 🔴 WIRED, NOT PROMOTED, AND THE DIFFERENCE IS THE POINT.
 * E6 fails its own gate: negation detection reads 85% against a 95% bar on both
 * valid full shadow runs. Everything else it clears, over 200 labelled cases —
 * overall strict accuracy 0.18 → 0.495, predicate accuracy 0.00 → 0.473,
 * silence on negatives 0.90 → 0.975. Off by default makes it reachable for a
 * shadow run against real traffic without claiming it is ready.
 *
 * BITE, MEASURED (revert the named change → count failures):
 *   AQUA_E6 defaults to off        → 2 fail
 *   understandTurn refuses when off → 2 fail
 *   post-turn call is deferred      → 1 fail
 *   post-turn call is fail-open     → 1 fail
 *   the seam does not COMMIT claims → 1 fail
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Brain from '../index.js';
import { runPostTurn } from '../../routes/turnPostProcess.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const POST = readFileSync(path.join(ROOT, 'src/routes/turnPostProcess.js'), 'utf8');
const FACADE = readFileSync(path.join(ROOT, 'src/brain/index.js'), 'utf8');

const original = process.env.AQUA_E6;
afterEach(() => {
  if (original === undefined) delete process.env.AQUA_E6;
  else process.env.AQUA_E6 = original;
});

/** A post-turn deps stub: nothing real runs, and `defer` is made synchronous. */
function stubDeps(over = {}) {
  return {
    memoryAfterTurn: () => {},
    getConversation: () => [],
    observeConversationTurn: () => {},
    observeTwin: () => {},
    reflectTurn: () => {},
    consolidate: () => {},
    consolidateEnabled: () => false,
    defer: fn => fn(),
    ...over,
  };
}

describe('the flag defaults to the honest answer', () => {
  test('AQUA_E6 is off unless explicitly turned on', () => {
    delete process.env.AQUA_E6;
    assert.equal(Brain.e6Enabled(), false);
    process.env.AQUA_E6 = 'on';
    assert.equal(Brain.e6Enabled(), true);
  });

  test('it is read per call, not captured at import', () => {
    // A rollback should be a restart, not a redeploy. Capturing at module load
    // would make the flag a lie the first time someone needed it.
    delete process.env.AQUA_E6;
    assert.equal(Brain.e6Enabled(), false);
    process.env.AQUA_E6 = 'on';
    assert.equal(Brain.e6Enabled(), true, 'the flag was captured at import');
  });

  test('understandTurn returns null when off, without touching a provider', async () => {
    delete process.env.AQUA_E6;
    assert.equal(await Brain.understandTurn({ ownerId: 'u', userMessage: 'I work at Nummo.' }), null);
  });

  test('it also refuses on missing input', async () => {
    process.env.AQUA_E6 = 'on';
    assert.equal(await Brain.understandTurn({ ownerId: 'u' }), null);
    assert.equal(await Brain.understandTurn({ userMessage: 'x' }), null);
  });
});

describe('the post-turn seam exists and is shaped like its siblings', () => {
  test('runPostTurn calls understandTurn when the flag is on', async () => {
    let called = null;
    runPostTurn(
      { ownerId: 'u1', conversationId: 'c1', userMessage: 'I work at Nummo.', assistantMessage: 'ok' },
      stubDeps({ e6Enabled: () => true, understandTurn: a => { called = a; return Promise.resolve({}); } }),
    );
    // The seam starts from `Promise.resolve().then(...)`, so the call lands a
    // microtask later even with a synchronous `defer`. Asserting immediately
    // read `null` and looked exactly like an unwired seam — which is the thing
    // this test exists to detect, so it must not be able to say so falsely.
    await Promise.resolve();
    assert.ok(called, 'E6 was never reached from the turn path — §8 is still open');
    assert.equal(called.ownerId, 'u1');
    assert.equal(called.userMessage, 'I work at Nummo.');
  });

  test('it does NOT call it when the flag is off', async () => {
    let called = false;
    runPostTurn(
      { ownerId: 'u1', conversationId: 'c1', userMessage: 'hi', assistantMessage: 'ok' },
      stubDeps({ e6Enabled: () => false, understandTurn: () => { called = true; } }),
    );
    await Promise.resolve();
    assert.equal(called, false);
  });

  test('a throwing extractor does not take the turn with it', () => {
    // Every sibling in this file is fail-open for the same reason: enrichment
    // must never cost the user their reply.
    assert.doesNotThrow(() => runPostTurn(
      { ownerId: 'u1', conversationId: 'c1', userMessage: 'hi', assistantMessage: 'ok' },
      stubDeps({ e6Enabled: () => true, understandTurn: () => { throw new Error('provider down'); } }),
    ));
  });

  test('a REJECTING extractor does not surface an unhandled rejection', () => {
    // The pipeline is async, so the throw arrives as a rejected promise. A bare
    // try/catch would miss it and crash the process on the next tick.
    assert.doesNotThrow(() => runPostTurn(
      { ownerId: 'u1', conversationId: 'c1', userMessage: 'hi', assistantMessage: 'ok' },
      stubDeps({ e6Enabled: () => true, understandTurn: () => Promise.reject(new Error('timeout')) }),
    ));
    assert.match(POST, /\.catch\(\(\) => \{ \/\* fail-open/, 'the promise rejection path is unguarded');
  });

  test('the call is DEFERRED, never on the response path', () => {
    // One provider call per segment. The user must not wait on it.
    let deferred = false;
    runPostTurn(
      { ownerId: 'u1', conversationId: 'c1', userMessage: 'hi', assistantMessage: 'ok' },
      stubDeps({ defer: fn => { deferred = true; fn(); }, e6Enabled: () => true, understandTurn: () => Promise.resolve({}) }),
    );
    assert.ok(deferred);
  });
});

describe('wired is not promoted', () => {
  test('the seam extracts and returns — it does not commit claims', () => {
    // An extractor that fails its own negation gate must not be writing into
    // the world model on the way to being evaluated. Shadow first.
    assert.match(FACADE, /IT EXTRACTS AND RETURNS; IT DOES NOT COMMIT/);
    const fn = FACADE.slice(FACADE.indexOf('export async function understandTurn'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    for (const writer of ['recordClaim', 'commitPlan', 'saveFact', 'attachEvidence']) {
      assert.ok(!body.includes(writer), `understandTurn calls ${writer} — that is promotion, not wiring`);
    }
  });

  test('the default keeps production behaviour identical', async () => {
    // The whole safety argument. Flag off, nothing runs, nothing changes.
    delete process.env.AQUA_E6;
    let called = false;
    runPostTurn(
      { ownerId: 'u1', conversationId: 'c1', userMessage: 'hi', assistantMessage: 'ok' },
      stubDeps({ understandTurn: () => { called = true; } }),
    );
    await Promise.resolve();
    assert.equal(called, false);
  });
});
