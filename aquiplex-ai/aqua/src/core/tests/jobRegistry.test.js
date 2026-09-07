/**
 * AQUA — the deferred job registry
 * Blueprint E4/PR-1
 *
 * Post-turn understanding work runs behind a bare `setImmediate`. Measured on
 * SIGTERM: **3 of 3 outstanding jobs lost, and nothing knew they existed.**
 * Every deploy discarded the understanding side-effects of whatever turns were
 * in flight — the user got their answer, so from their side it worked.
 *
 * Two assertions carry this suite:
 *
 *   the drain    outstanding work survives a shutdown
 *   fail-open    a job that throws still never reaches the caller
 *
 * The second matters as much as the first. `runPostTurn` already promises that
 * every subsystem failing at once never surfaces, and there is a test for it.
 * A registry that let a rejection escape would break that promise while
 * claiming to improve reliability.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _internals } from '../../routes/turnPostProcess.js';

import {
  defer, drainJobs, drainLine, outstanding, jobStats, _resetForTests,
} from '../jobs/jobRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

beforeEach(() => _resetForTests());

// ── The loss this closes ─────────────────────────────────────────────────────

describe('job registry — deferred work survives a shutdown', () => {
  test('THE MEASURED CASE: three jobs outstanding, three drained', async () => {
    // The exact scenario that lost 3 of 3 before this existed.
    let done = 0;
    for (let i = 0; i < 3; i++) defer('post-turn', async () => { await sleep(60); done++; });

    assert.equal(outstanding().total, 3, 'the registry did not see the work');
    const r = await drainJobs(5_000);
    assert.equal(r.drained, 3);
    assert.equal(r.timedOut, false);
    assert.equal(done, 3, 'work was lost despite draining');
  });

  test('draining with nothing outstanding is free and honest', async () => {
    const r = await drainJobs(5_000);
    assert.equal(r.drained, 0);
    assert.equal(r.timedOut, false);
    assert.match(drainLine(r), /nothing outstanding/);
  });

  test('work is deferred, not run inline — a turn never waits on it', async () => {
    // The property the bare setImmediate had, and the reason it existed.
    let ran = false;
    defer('post-turn', () => { ran = true; });
    assert.equal(ran, false, 'the job ran synchronously and delayed the turn');
    await drainJobs(1_000);
    assert.equal(ran, true);
  });
});

// ── The ceiling ──────────────────────────────────────────────────────────────

describe('job registry — the drain gives up rather than hanging', () => {
  test('a slow job times out and the remainder is REPORTED, not hidden', async () => {
    // A deploy window is finite — the platform sends SIGKILL on its own
    // schedule regardless — so a drain that waited indefinitely would be
    // killed mid-write and lose MORE than it saved.
    defer('slow', async () => { await sleep(400); });
    const r = await drainJobs(80);
    assert.equal(r.timedOut, true);
    assert.deepEqual(r.outstanding, { slow: 1 });
    assert.match(drainLine(r), /gave up/);
    assert.match(drainLine(r), /will be LOST/);
    await sleep(400);   // let it finish so it does not leak into the next test
  });

  test('"drained" and "gave up" are different words in the log', () => {
    // A deploy log that conflates them teaches people to ignore it.
    const clean = drainLine({ drained: 4, timedOut: false, durationMs: 12, outstanding: {} });
    const gaveUp = drainLine({ drained: 1, timedOut: true, durationMs: 5000, outstanding: { ingest: 3 } });
    assert.match(clean, /drained 4 job\(s\)/);
    assert.ok(!/gave up/.test(clean));
    assert.match(gaveUp, /ingest×3/);
  });

  test('a timeout is counted as loss, so it is measurable over time', async () => {
    defer('slow', async () => { await sleep(300); });
    await drainJobs(50);
    assert.ok(jobStats().lost >= 1, 'lost work was not counted');
    await sleep(350);
  });
});

// ── Fail-open ────────────────────────────────────────────────────────────────

describe('job registry — a failing job never reaches the caller', () => {
  test('a throwing job is swallowed and COUNTED', async () => {
    // Swallowed exactly as the bare setImmediate did. The count is the
    // improvement: a failure that is invisible cannot be investigated, and
    // this path has been silently swallowing them since it was written.
    defer('post-turn', () => { throw new Error('ingest exploded'); });
    await drainJobs(1_000);
    assert.equal(jobStats().failed, 1);
    assert.equal(jobStats().completed, 0);
  });

  test('an async rejection is swallowed too — no unhandled rejection', async () => {
    // An unhandled rejection kills the process. The registry awaits inside its
    // own try, so a rejected job cannot become one.
    defer('post-turn', async () => { throw new Error('async boom'); });
    await drainJobs(1_000);
    assert.equal(jobStats().failed, 1);
  });

  test('one failing job does not stop the others', async () => {
    let ok = 0;
    defer('a', () => { throw new Error('nope'); });
    defer('b', async () => { await sleep(20); ok++; });
    defer('c', async () => { await sleep(20); ok++; });
    const r = await drainJobs(2_000);
    assert.equal(ok, 2);
    assert.equal(r.timedOut, false);
    assert.equal(jobStats().failed, 1);
    assert.equal(jobStats().completed, 2);
  });
});

// ── Bookkeeping ──────────────────────────────────────────────────────────────

describe('job registry — what is outstanding is answerable', () => {
  test('jobs are grouped by name, so the drain report is readable', async () => {
    defer('ingest', async () => sleep(60));
    defer('ingest', async () => sleep(60));
    defer('twin', async () => sleep(60));
    assert.deepEqual(outstanding(), { total: 3, byName: { ingest: 2, twin: 1 } });
    await drainJobs(2_000);
  });

  test('a completed job leaves no residue', async () => {
    defer('post-turn', async () => sleep(10));
    await drainJobs(1_000);
    assert.deepEqual(outstanding(), { total: 0, byName: {} });
  });

  test('outstanding() is cheap and never throws', () => {
    assert.doesNotThrow(() => outstanding());
    assert.equal(outstanding().total, 0);
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────

describe('job registry — wiring', () => {
  test('the post-turn block defers THROUGH the registry, WITH an owner', async () => {
    // WAS a grep for the literal `defer('post-turn', fn)`. E4/PR-4 added the
    // ownerId argument and the grep broke while the behaviour it described was
    // intact — a test that fails on a refactor and passes on a defect is
    // measuring the source. Replaced with the behaviour: the real REAL_DEPS
    // seam must route through the registry AND carry the owner, because
    // without the owner the per-owner chain never engages and two turns from
    // one person race on their stores again.
    _resetForTests();
    const before = jobStats();
    await _internals.REAL_DEPS.defer(async () => {}, 'owner-under-test');
    assert.equal(jobStats().completed, before.completed + 1,
      'the post-turn seam no longer routes through the registry');

    // The owner argument has to REACH the registry, not merely be accepted.
    let released;
    const gate = new Promise(r => { released = r; });
    const order = [];
    const first = _internals.REAL_DEPS.defer(async () => { await gate; order.push('first'); }, 'o1');
    const second = _internals.REAL_DEPS.defer(async () => { order.push('second'); }, 'o1');
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(order, [], 'the second job ran before the first — the owner never reached the chain');
    released();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'second']);

    const src = fs.readFileSync(path.join(ROOT, 'src/routes/turnPostProcess.js'), 'utf8');
    assert.ok(!/defer:\s*setImmediate\b/.test(src),
      'the post-turn block still defers through a bare setImmediate — the work is invisible again');
  });

  test('the SIGTERM drain awaits jobs alongside the writers', () => {
    // Alongside, not after: a deploy will not wait three times.
    const src = fs.readFileSync(path.join(ROOT, 'src/core/atomicStore.js'), 'utf8');
    assert.match(src, /drainJobs\(/);
    assert.match(src, /allSettled/);
    const drain = src.slice(src.indexOf('allSettled'), src.indexOf('allSettled') + 400);
    for (const part of ['drainMirror', 'flushStorage', 'drainJobs']) {
      assert.ok(drain.includes(part), `${part} is not in the same drain`);
    }
  });

  test('this PR adds no queue, no persistence and no retry', () => {
    // Deliberate scope. A queue implies ordering and backpressure policy; an
    // outbox is E4/PR-3; a retry policy needs a failure taxonomy to be
    // anything other than "try twice and hope". Adding them here would be two
    // risky things at once — the ordering rule E3 followed.
    const src = fs.readFileSync(path.join(ROOT, 'src/core/jobs/jobRegistry.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    for (const absent of ['retry', 'INSERT INTO', 'setTimeout(() => defer']) {
      assert.ok(!src.includes(absent), `jobRegistry.js has grown ${absent} — that is a later PR`);
    }
  });
});

// ── Per-owner serial ordering (E4/PR-4) ──────────────────────────────────────

/**
 * 🔴 TWO TURNS FROM ONE PERSON RAN AT THE SAME TIME, AGAINST ONE STORE.
 *
 * `setImmediate` fires whatever is queued in whatever order it lands. Send two
 * messages quickly and both post-turn blocks execute concurrently against a
 * single owner's stores — `observeConversationTurn` reads entities, adds to
 * them, writes back, and so does the other. Read-modify-write, interleaved.
 * The loser's entities are gone and nothing reports it, because both jobs
 * "succeeded".
 *
 * Serialising everything would be the easy fix and the wrong one: one slow turn
 * would stall every other user behind it. The guarantee is per owner.
 *
 * BITE, MEASURED (revert the named property → count failures):
 *   the per-owner chain            → 2 fail
 *   different owners stay parallel → 1 fail
 *   a failed job does not block its successors → 1 fail
 *   the owner map is cleaned up    → 1 fail
 */
describe('jobs for one owner run in order; owners do not block each other', () => {
  beforeEach(() => _resetForTests());

  /** Resolves after `ms`, recording start and end so overlap is observable. */
  const slice = (log, tag, ms) => async () => {
    log.push(`${tag}:start`);
    await new Promise(r => setTimeout(r, ms));
    log.push(`${tag}:end`);
  };

  test('THE RACE: same owner, two jobs — the second waits for the first', async () => {
    const log = [];
    const a = defer('post-turn', slice(log, 'a', 30), { ownerId: 'u1' });
    const b = defer('post-turn', slice(log, 'b', 1), { ownerId: 'u1' });
    await Promise.all([a, b]);
    // Without the chain this is a:start, b:start, b:end, a:end — b finishes
    // first and its write is overwritten by a's stale read.
    assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  test('DIFFERENT owners still overlap — this is not a global lock', async () => {
    const log = [];
    const a = defer('post-turn', slice(log, 'a', 30), { ownerId: 'u1' });
    const b = defer('post-turn', slice(log, 'b', 1), { ownerId: 'u2' });
    await Promise.all([a, b]);
    assert.equal(log[0], 'a:start');
    assert.ok(log.indexOf('b:end') < log.indexOf('a:end'),
      'a short job for another owner queued behind a long one — this is a global lock');
  });

  test('a FAILING job does not strand the rest of that owner\'s queue', async () => {
    // NOTE: this passes with `.then(run)` too — `run` swallows its own errors
    // so the chain never rejects. Measured, not assumed: the bite for the
    // two-argument form failed zero tests. What this DOES pin is that a failing
    // job leaves the queue moving, whatever mechanism keeps it moving.
    const log = [];
    const a = defer('post-turn', async () => { throw new Error('boom'); }, { ownerId: 'u1' });
    const b = defer('post-turn', slice(log, 'b', 1), { ownerId: 'u1' });
    await Promise.all([a, b]);
    assert.deepEqual(log, ['b:start', 'b:end']);
    assert.equal(jobStats().failed, 1, 'the failure was not counted');
  });

  test('the owner map is EMPTY once the work drains (G6)', async () => {
    // A Map keyed by every owner who has ever spoken is a leak with a slow fuse.
    await Promise.all([
      defer('post-turn', slice([], 'a', 1), { ownerId: 'u1' }),
      defer('post-turn', slice([], 'b', 1), { ownerId: 'u2' }),
    ]);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(jobStats().serialOwners, 0, 'the per-owner map retained finished owners');
  });

  test('a job arriving mid-chain becomes the new tail, not a parallel branch', async () => {
    // The cleanup checks identity for this reason: deleting the entry while a
    // successor is queued would let the next arrival run alongside it.
    const log = [];
    const a = defer('post-turn', slice(log, 'a', 20), { ownerId: 'u1' });
    await new Promise(r => setTimeout(r, 5));       // a is mid-flight
    const b = defer('post-turn', slice(log, 'b', 1), { ownerId: 'u1' });
    await Promise.all([a, b]);
    assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  test('NO ownerId keeps the old concurrent behaviour — callers opt in', async () => {
    const log = [];
    await Promise.all([
      defer('post-turn', slice(log, 'a', 30)),
      defer('post-turn', slice(log, 'b', 1)),
    ]);
    assert.deepEqual(log, ['a:start', 'b:start', 'b:end', 'a:end']);
  });
});
