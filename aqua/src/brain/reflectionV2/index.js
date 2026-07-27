/**
 * AQUA Brain — Reflection Engine V2: Orchestrator (Brain V1 / B5)
 *
 * Ties the pure reflector (what changed) to the applier (act on it), and owns
 * the one piece of state a diff needs: the previous graph snapshot per owner,
 * so each reflection compares against the last.
 *
 * CADENCE
 * -------
 * Runs on the SAME trigger the Mind's reflection already uses — every N turns,
 * via chat's post-turn hook — so B5 adds no new schedule and no new timer. It
 * receives the Mind's structured reflection report (already computed that
 * turn) and folds its goal/belief slices into the WorldDelta rather than
 * recomputing them. Composition, not duplication.
 *
 * CONTRACT
 *   • STRUCTURED. Emits a WorldDelta object and (optionally) applies it via
 *     reversible lifecycle transitions. Never a text summary as the artifact.
 *   • FAIL-OPEN. Every path catches; a reflection failure never affects the
 *     turn or the Mind's own reflection.
 *   • OFF BY DEFAULT. AQUA_REFLECT_V2=on enables application; even off, the
 *     delta can be COMPUTED for observability without writing (dry-run).
 *   • BOUNDED. One snapshot per owner (structural fingerprint, not a copy),
 *     evicted with a simple LRU cap so long-lived processes don't grow.
 *
 * Impure only at the store boundary (reads graph, writes lifecycle); the diff
 * it delegates to is pure.
 */
import { snapshotGraph, diffSnapshots, detectObsolescence, computeWorldDelta } from './deltaReflector.js';
import { applyWorldDelta } from './deltaApplier.js';
import { brainEnabled } from '../worldModel/schema.js';

/** owner → last snapshot. LRU-capped. */
const snapshots = new Map();
const MAX_SNAPSHOTS = 1000;
/** owner → last reflection timestamp, for the obsolescence `since` window. */
const lastReflectionAt = new Map();

const metrics = {
  reflections: 0, applied: 0, dryRuns: 0, errors: 0,
  entitiesChanged: 0, relationshipsChanged: 0, obsoleted: 0,
  lastDurationMs: 0,
};

/** Application is opt-in on top of the read-side switch. */
export function reflectV2Enabled() {
  return brainEnabled() && String(process.env.AQUA_REFLECT_V2 ?? '').toLowerCase() === 'on';
}

function rememberSnapshot(ownerId, snap) {
  snapshots.set(ownerId, snap);
  if (snapshots.size > MAX_SNAPSHOTS) {
    // Evict oldest insertion (Map preserves order).
    const oldest = snapshots.keys().next().value;
    snapshots.delete(oldest);
  }
}

/**
 * Reflect on the world model for one owner.
 *
 * @param {object} deps - {
 *     graph, evidenceStore,
 *     detectContradictions, buildEntitiesForOwner,   // for obsolescence
 *     transition, annotate,                          // for application
 *   }
 * @param {string} ownerId
 * @param {object} [opts] - { mindReport, apply? }
 * @returns {{ delta, applied, report? }}
 */
export function reflectWorldModel(deps, ownerId, opts = {}) {
  if (!ownerId) return { delta: null, applied: false };
  const started = Date.now();
  try {
    metrics.reflections += 1;

    // 1. Snapshot now, diff against the previous snapshot for this owner.
    const before = snapshots.get(ownerId) ?? { nodes: new Map(), edges: new Map(), takenAt: 0 };
    const after = snapshotGraph(deps, ownerId);
    const diff = diffSnapshots(before, after);

    // 2. Obsolescence over facts that arrived since the last reflection.
    const since = lastReflectionAt.get(ownerId) ?? 0;
    const obsolescence = detectObsolescence(deps, ownerId, { since });

    // 3. Assemble the structured delta (folding in the Mind's report slices).
    const delta = computeWorldDelta({ diff, obsolescence, mindReport: opts.mindReport ?? null });

    // 4. Apply — or dry-run for observability when application is disabled.
    const wantApply = opts.apply ?? reflectV2Enabled();
    let report = null;
    if (wantApply && delta.worldModelUpdated) {
      report = applyWorldDelta(deps, ownerId, delta);
      metrics.applied += 1;
    } else if (delta.worldModelUpdated) {
      metrics.dryRuns += 1;
    }

    // 5. Roll state forward.
    rememberSnapshot(ownerId, after);
    lastReflectionAt.set(ownerId, after.takenAt);

    metrics.entitiesChanged += delta.entitiesChanged.length;
    metrics.relationshipsChanged += delta.relationshipsChanged.length;
    metrics.obsoleted += delta.obsoleted.length;
    metrics.lastDurationMs = Date.now() - started;

    if (delta.worldModelUpdated) {
      console.log(`[BRAIN] Reflection V2 owner=${ownerId} ${delta.summary}${report ? ` — applied: archived=${report.archived.length} annotated=${report.annotated.length}` : ' (dry-run)'}`);
    }

    return { delta, applied: !!report, report };
  } catch (err) {
    metrics.errors += 1;
    console.warn(`[BRAIN] Reflection V2 failed (fail-open): ${err?.message ?? err}`);
    return { delta: null, applied: false, error: err?.message ?? String(err) };
  }
}

/** Drop an owner's snapshot state (account deletion / tests). */
export function forgetOwner(ownerId) {
  snapshots.delete(ownerId);
  lastReflectionAt.delete(ownerId);
}

export function reflectionV2Metrics() {
  return { ...metrics, enabled: reflectV2Enabled(), trackedOwners: snapshots.size };
}

export function _resetReflectionV2ForTests() {
  snapshots.clear();
  lastReflectionAt.clear();
}
