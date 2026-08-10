/**
 * AQUA Storage — the adapter seam
 * Blueprint E3/PR-3
 *
 * `atomicStore.js` has carried this line in its header since Phase 3b:
 *
 *   "all six stores now persist through ONE interface, so a Postgres/Mongo
 *    adapter is a change here, not in six places."
 *
 * That claim was true and unexercised. This module makes it real: every byte
 * that leaves or enters a store now passes through an adapter, and there is
 * exactly one implementation.
 *
 * THIS PR CHANGES NO BEHAVIOUR
 * ----------------------------
 * The JSON adapter is the same filesystem code that was inline, moved. The
 * public API of `atomicStore` is untouched, all 19 consumers are untouched,
 * and the proof is the existing battery passing unchanged — which is why this
 * PR ships alone rather than alongside a second implementation.
 *
 * `setAdapter` exists for tests and for E3/PR-5's dual-write. It is NOT an
 * env-driven switch: swapping the substrate of every store on a string in a
 * `.env` is precisely the kind of change that should be a deliberate code path
 * with its own flag and its own drift job.
 */
import { createJsonFileAdapter } from './jsonFileAdapter.js';
import { createDualWriteAdapter } from './dualWriteAdapter.js';

const REQUIRED = ['id', 'existsSync', 'readSync', 'write', 'writeSync', 'copySync'];

/**
 * Every adapter must declare whether `writeSync` is durable on return.
 *
 * The file adapter is (temp-then-rename completes). The Postgres adapter is
 * not — Node has no synchronous Postgres client, so it writes behind a cache.
 * That is a real difference in guarantee, and an interface that let it go
 * undeclared would hide it until the first SIGTERM lost a store.
 */
const REQUIRED_FLAGS = ['syncDurable'];

let adapter = createJsonFileAdapter();

/** Throws unless the object implements the whole interface. */
export function assertAdapter(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError('storage adapter must be an object');
  }
  for (const flag of REQUIRED_FLAGS) {
    if (typeof candidate[flag] !== 'boolean') {
      throw new TypeError(`storage adapter must declare ${flag} as a boolean — a durability guarantee cannot be implicit`);
    }
  }
  for (const member of REQUIRED) {
    if (member === 'id') {
      if (typeof candidate.id !== 'string' || !candidate.id) {
        throw new TypeError('storage adapter needs a non-empty string id — it goes in the boot line');
      }
      continue;
    }
    if (typeof candidate[member] !== 'function') {
      throw new TypeError(`storage adapter is missing ${member}()`);
    }
  }
  return true;
}

export function getAdapter() { return adapter; }

export function setAdapter(next) {
  assertAdapter(next);
  const previous = adapter;
  adapter = next;
  return previous;
}

export function resetAdapter() { adapter = createJsonFileAdapter(); }

export const ADAPTER_MEMBERS = Object.freeze([...REQUIRED]);
export const ADAPTER_FLAGS = Object.freeze([...REQUIRED_FLAGS]);


// ── E3/PR-5 — shadow mode ────────────────────────────────────────────────────
//
// `AQUA_STORE_PG=shadow` turns on dual-write: JSON stays authoritative and
// serves every read, Postgres receives a copy of every write. Off by default.
//
// This is a code path with its own flag rather than a silent env switch on the
// adapter itself, because swapping the substrate of every store is not the
// kind of change that should be one string away from happening by accident.

export const storeModeFromEnv = () =>
  String(process.env.AQUA_STORE_PG ?? 'off').toLowerCase() === 'shadow' ? 'shadow' : 'off';

let mode = 'off';

/**
 * Install the adapter the environment asks for. Called once at boot.
 * Fails OPEN: if the Postgres side cannot be constructed, JSON keeps working
 * and the reason is printed. A migration step that can break startup is a
 * migration step nobody will enable.
 */
export async function configureStorageFromEnv() {
  mode = storeModeFromEnv();
  if (mode !== 'shadow') { resetAdapter(); return { mode: 'off', adapter: getAdapter().id }; }

  try {
    const { isConfigured } = await import('../db/pool.js');
    if (!isConfigured()) {
      mode = 'off';
      return { mode: 'off', adapter: getAdapter().id, reason: 'AQUA_STORE_PG=shadow but DATABASE_URL is not set' };
    }
    const { createPgBlobAdapter } = await import('./pgBlobAdapter.js');
    setAdapter(createDualWriteAdapter(createJsonFileAdapter(), createPgBlobAdapter()));
    return { mode: 'shadow', adapter: getAdapter().id };
  } catch (err) {
    mode = 'off';
    resetAdapter();
    return { mode: 'off', adapter: getAdapter().id, reason: `shadow mode unavailable: ${err.message}` };
  }
}

export const storeMode = () => mode;

/**
 * Await any deferred writes. The SIGTERM drain calls this because the Postgres
 * adapter reports `syncDurable: false` — its writeSync has only reached memory
 * when it returns.
 */
export async function flushStorage(timeoutMs = 5_000) {
  const a = getAdapter();
  if (typeof a.flush !== 'function') return 0;
  return Promise.race([
    a.flush(),
    new Promise(resolve => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]).catch(() => 0);
}

/** One boot line, always — L13, no dark stages. */
export function storageBootLine(result) {
  const r = result ?? { mode, adapter: getAdapter().id };
  if (r.mode !== 'shadow') {
    return `[STORE] backend=json-file shadow=off${r.reason ? ` (${r.reason})` : ''}`;
  }
  return `[STORE] backend=json-file shadow=postgres (JSON remains authoritative; no read comes from Postgres)`;
}
