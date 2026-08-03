/**
 * GET /brain/changes — the revision feed, over HTTP.
 *
 * The rest of the Brain API answers "what does AQUA know". This answers "what
 * did AQUA change its mind about", which is the thing a bigger context window
 * cannot do: a transcript gives recall, not a position that can be revised.
 *
 * Tested at the ROUTE, not just at the store, deliberately. This phase exists
 * because a subsystem computed a structured delta on every cadence turn and
 * then dropped it — `turnPostProcess` calls `reflectTurn(ownerId)` and discards
 * the return value. Shipping a reader with no reader-level test would be the
 * same mistake one layer up.
 *
 * Proven to bite: removing the endpoint fails all 7 — there is nothing to test.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.AQUA_DISABLE_MONGO_MIRROR = '1';
delete process.env.AQUA_BRAIN;

const { ledger, _resetPicStoreForTests } = await import('../../pic/picStore.js');
const { default: brainRoute } = await import('../brain.js');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const u = req.headers['x-test-user'];
  if (u) req.aquaUserId = String(u);
  next();
});
app.use('/brain', brainRoute);

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const get = async (p, user) => {
  const res = await fetch(base + p, { headers: user ? { 'x-test-user': user } : {} });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
};

const seed = (owner, entries) => {
  for (const e of entries) ledger(owner, e.op ?? 'reflection', e);
};

test('an owner with no reflections gets 200 and an honest empty feed', async () => {
  // Never a 404. "AQUA has not revised anything yet" is a true answer about a
  // real account, not a missing resource.
  //
  // Ingest is turned ON for this case on purpose. With it off, the envelope
  // correctly returns the INGEST hint instead — that explanation dominates,
  // because a world model nothing feeds cannot revise anything. The
  // changes-specific hint is for the case that actually needs it: the pipeline
  // is working and nothing has changed yet.
  _resetPicStoreForTests();
  const prev = process.env.AQUA_BRAIN_INGEST;
  process.env.AQUA_BRAIN_INGEST = 'on';
  try {
    const r = await get('/brain/changes', 'nobody');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.changes, []);
    // Emptiness is reported as a HINT, not a boolean. It must not be the
    // generic "no data yet" one, which would send someone off to debug an
    // ingest pipeline that is working fine.
    assert.match(r.body.hint, /No revisions yet/);
  } finally {
    if (prev === undefined) delete process.env.AQUA_BRAIN_INGEST;
    else process.env.AQUA_BRAIN_INGEST = prev;
  }
});

test('a recorded revision comes back with its summary and counts', async () => {
  _resetPicStoreForTests();
  seed('user:alice', [
    { summary: '2 entities changed', entities: 2, relationships: 0, obsoleted: 0, revised: 0, applied: true },
  ]);
  const r = await get('/brain/changes', 'alice');
  assert.equal(r.status, 200);
  assert.equal(r.body.changes.length, 1);
  assert.equal(r.body.changes[0].summary, '2 entities changed');
  assert.equal(r.body.changes[0].entities, 2);
  assert.equal(r.body.changes[0].applied, true);
});

test('newest first — this reads as a feed, not a log file', async () => {
  _resetPicStoreForTests();
  seed('user:alice', [{ summary: 'first' }, { summary: 'second' }, { summary: 'third' }]);
  const r = await get('/brain/changes', 'alice');
  assert.deepEqual(r.body.changes.map(c => c.summary), ['third', 'second', 'first']);
});

test('non-reflection ledger entries are NOT revisions', async () => {
  // Consolidation and fact-ingest write to the same ring. They are legitimate
  // entries that simply are not AQUA changing its mind, and a feed that showed
  // them would be reporting its own filing system as understanding.
  _resetPicStoreForTests();
  seed('user:alice', [
    { op: 'conversation-facts-written', facts: 3 },
    { summary: 'a real revision' },
    { op: 'consolidation', merged: 12 },
  ]);
  const r = await get('/brain/changes', 'alice');
  assert.equal(r.body.changes.length, 1);
  assert.equal(r.body.changes[0].summary, 'a real revision');
});

test('owners are isolated', async () => {
  _resetPicStoreForTests();
  seed('user:alice', [{ summary: "alice's revision" }]);
  seed('user:bob', [{ summary: "bob's revision" }]);
  const a = await get('/brain/changes', 'alice');
  const b = await get('/brain/changes', 'bob');
  assert.equal(a.body.changes[0].summary, "alice's revision");
  assert.equal(b.body.changes[0].summary, "bob's revision");
  assert.equal(a.body.changes.length, 1);
});

test('limit is clamped, never passed through', async () => {
  _resetPicStoreForTests();
  seed('user:alice', Array.from({ length: 40 }, (_, i) => ({ summary: `rev ${i}` })));
  assert.equal((await get('/brain/changes?limit=5', 'alice')).body.changes.length, 5);
  assert.equal((await get('/brain/changes?limit=99999', 'alice')).body.changes.length, 40);
  assert.equal((await get('/brain/changes?limit=junk', 'alice')).body.changes.length, 20);
});

test('an unapplied revision is still real history', async () => {
  // With AQUA_REFLECT_V2 off the delta is still COMPUTED (dry-run). Those are
  // things AQUA noticed and did not act on — dropping them would hide the
  // observability the dry-run mode exists to provide.
  _resetPicStoreForTests();
  seed('user:alice', [{ summary: 'noticed but not applied', applied: false }]);
  const r = await get('/brain/changes', 'alice');
  assert.equal(r.body.changes.length, 1);
  assert.equal(r.body.changes[0].applied, false);
});
