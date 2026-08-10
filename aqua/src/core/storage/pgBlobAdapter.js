/**
 * AQUA Storage — Postgres blob adapter
 * Blueprint E3/PR-4 · UNUSED
 *
 * Nothing installs this. `getAdapter()` still returns the JSON adapter, and a
 * test asserts no production module imports this file. It exists to be graded
 * against the same contract the JSON adapter passes, and to surface — now,
 * cheaply — the one thing that makes the substrate swap harder than it looks.
 *
 * ⚠ THE FINDING: POSTGRES HAS NO SYNCHRONOUS CLIENT
 * -------------------------------------------------
 * The seam requires `readSync`, `writeSync`, `existsSync` and `copySync`,
 * because that is what `atomicStore` has always offered and what the shutdown
 * hooks depend on. There is no synchronous Postgres driver in Node and there
 * cannot sensibly be one.
 *
 * So this adapter is **hydrate-once, serve-from-cache, write-behind**:
 *
 *   hydrate()    async, once, at boot — loads every store blob into memory
 *   readSync     serves the cache
 *   writeSync    updates the cache and ENQUEUES a database write
 *   write        updates the cache and awaits the database write
 *   flush()      awaits every queued write — must be called on SIGTERM
 *
 * That matches how the engine already behaves (every store is fully in memory
 * and flushed on a debounce), so it is not a new risk. But it IS a different
 * durability guarantee from the file adapter, and pretending otherwise would
 * be the kind of quiet equivalence E3/PR-3 nearly shipped with temp paths.
 *
 * It is therefore declared, not buried:
 *
 *   jsonFileAdapter.syncDurable === true    writeSync has hit the disk on return
 *   pgBlobAdapter.syncDurable  === false    writeSync has hit MEMORY on return
 *
 * E3/PR-5's dual-write must call `flush()` in the SIGTERM drain. A test in
 * that PR will assert it; this comment is the reason it exists.
 */
import path from 'node:path';
import crypto from 'node:crypto';

import { getPool, isConfigured } from '../db/pool.js';

export const TABLE = 'aqua_store_blobs';

const checksum = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);

/** A store path becomes its basename. See 0002_store_blobs.sql for why. */
export const storeKeyFor = key => path.basename(String(key));

export function createPgBlobAdapter() {
  /** @type {Map<string, string>} storeKey → serialised store */
  const cache = new Map();
  /** In-flight writes, so flush() can await them. */
  const pending = new Set();
  /** Write-behind failures, surfaced by flush(). */
  const failures = [];
  let hydrated = false;

  /**
   * Track a write without ever creating an UNHANDLED rejection.
   *
   * A write-behind promise is not awaited by its caller — that is the whole
   * point — so a rejection propagating out of it is unhandled, and Node kills
   * the process on an unhandled rejection. Exactly the failure mode
   * `pool.on('error')` guards in E3/PR-1, reached by a different road.
   *
   * So the error is recorded and logged here, and RE-REPORTED by flush(). The
   * failure is loud and it is surfaced at a point where someone is waiting for
   * an answer — without taking the process down in between.
   */
  const enqueue = (promise) => {
    const tracked = promise.catch(err => {
      failures.push(err);
      console.error(`[DB] store write failed: ${err.message}`);
    });
    pending.add(tracked);
    tracked.finally(() => pending.delete(tracked));
    return tracked;
  };

  async function upsert(storeKey, data) {
    const pool = await getPool();
    if (!pool) throw new Error('pgBlobAdapter: DATABASE_URL is not configured');
    await pool.query(
      `INSERT INTO ${TABLE} (store_key, data, bytes, checksum, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (store_key) DO UPDATE
         SET data = EXCLUDED.data, bytes = EXCLUDED.bytes,
             checksum = EXCLUDED.checksum, updated_at = now()`,
      [storeKey, data, Buffer.byteLength(data, 'utf8'), checksum(data)]);
  }

  return {
    id: 'pg-blob',

    // Declared, not discovered later. See the header.
    syncDurable: false,

    /** Load every blob into memory. Must run before any sync read. */
    async hydrate() {
      if (!isConfigured()) throw new Error('pgBlobAdapter: DATABASE_URL is not configured');
      const pool = await getPool();
      const { rows } = await pool.query(`SELECT store_key, data FROM ${TABLE}`);
      cache.clear();
      for (const r of rows) cache.set(r.store_key, r.data);
      hydrated = true;
      return cache.size;
    },

    isHydrated() { return hydrated; },

    existsSync(key) { return cache.has(storeKeyFor(key)); },

    readSync(key) {
      const v = cache.get(storeKeyFor(key));
      return v === undefined ? null : v;
    },

    async write(key, data) {
      const storeKey = storeKeyFor(key);
      cache.set(storeKey, data);
      await enqueue(upsert(storeKey, data));
    },

    /**
     * Synchronous only in the sense the caller needs: the value is readable
     * immediately. Durability is deferred — see syncDurable.
     */
    writeSync(key, data) {
      const storeKey = storeKeyFor(key);
      cache.set(storeKey, data);
      enqueue(upsert(storeKey, data));
    },

    copySync(from, to) {
      const value = cache.get(storeKeyFor(from));
      if (value === undefined) throw new Error(`pgBlobAdapter: nothing to copy from ${from}`);
      this.writeSync(to, value);
    },

    /** Await every queued write. MUST be called on SIGTERM. */
    async flush() {
      const inFlight = [...pending];
      await Promise.all(inFlight);          // already caught by enqueue()
      if (failures.length) {
        const n = failures.length;
        const first = failures[0]?.message ?? 'unknown';
        failures.length = 0;
        throw new Error(`pgBlobAdapter: ${n} store write(s) failed — first: ${first}`);
      }
      return inFlight.length;
    },

    /** Tests only — how many write-behind failures are waiting to be reported. */
    _failureCount() { return failures.length; },

    /** Tests only. */
    _cache: cache,
  };
}
