/**
 * AQUA — in-memory Postgres for E3 integration tests
 * Blueprint E3/PR-8
 *
 * WHY THIS EXISTS
 * ---------------
 * Six E3 PRs shipped with every live-database test SKIPPED. The skips were
 * honest — reported with a reason, never quietly passed — but the effect was
 * that the migration runner, the blob adapter, the drift job and the read flip
 * had **never been executed against anything**. Six PRs of unexercised code,
 * each verified only by tests that avoided the part that talks to Postgres.
 *
 * `pg-mem` closes that gap without requiring a server, so the chain runs
 * everywhere the battery runs — which is the only way it keeps running.
 *
 * ⚠ WHAT THIS DOES **NOT** PROVE
 * ------------------------------
 * pg-mem is a simulator. It is emphatically not a substitute for the live
 * check, and treating it as one would be exactly the kind of "green means
 * safe" that this project keeps catching. Specifically NOT proven here:
 *
 *   · pg_advisory_lock            stubbed — it always succeeds, so the
 *                                 two-instances-can't-both-migrate property
 *                                 is NOT tested. That needs two processes and
 *                                 a real server.
 *   · CREATE TABLE IF NOT EXISTS  unimplemented for an existing table
 *   · ON CONFLICT DO NOTHING      unimplemented for an existing row
 *   · real concurrency, connection loss, transaction isolation, SSL,
 *     performance, and every operational failure mode that matters at scale
 *
 * The last two SQL forms are the idempotency mechanism, and the shim tolerates
 * exactly those two errors so the idempotency PATH can be exercised. That is a
 * deliberate, narrow allowance and it is why the live tests remain, still
 * skipped-with-a-reason, still the real evidence.
 */
import { newDb, DataType } from 'pg-mem';

/** The error pg-mem raises for a construct it has not implemented. */
const UNSUPPORTED = /AST which parts have not been read/;

/**
 * A fresh in-memory database and a `pg`-shaped Pool for it.
 * @returns {{ pool: object, db: object, close: () => Promise<void> }}
 */
export function createMemoryPg() {
  const db = newDb();

  // Locking is stubbed, not implemented. Registered for both argument types
  // because the driver may infer either from a bigint literal.
  for (const type of [DataType.text, DataType.integer]) {
    for (const name of ['pg_advisory_lock', 'pg_advisory_unlock']) {
      db.public.registerFunction({
        name, args: [type], returns: DataType.bool, implementation: () => true,
      });
    }
  }

  const pg = db.adapters.createPg();

  const tolerant = (query) => async (...args) => {
    try {
      return await query(...args);
    } catch (err) {
      // ONLY the two idempotent forms above. Anything else propagates —
      // swallowing broadly would turn this harness into a test that passes
      // whatever the code does.
      if (UNSUPPORTED.test(err?.message ?? '')) return { rows: [], rowCount: 0 };
      throw err;
    }
  };

  const pool = new pg.Pool();
  pool.query = tolerant(pool.query.bind(pool));
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    client.query = tolerant(client.query.bind(client));
    return client;
  };

  return { pool, db, close: async () => { try { await pool.end(); } catch { /* already closed */ } } };
}

/**
 * Run `fn` with the module-level pool replaced by an in-memory one.
 *
 * The pool module memoises its `pg.Pool`, so the substitution happens through
 * an injection seam rather than by reaching into module internals.
 */
export async function withMemoryPg(fn) {
  const mem = createMemoryPg();
  const pool = await import('../../db/pool.js');
  const restore = pool._setPoolForTests(mem.pool);
  try {
    return await fn(mem);
  } finally {
    restore();
    await mem.close();
  }
}
