/**
 * AQUA Brain — Facade (Brain V1 / B2)
 *
 * The ONLY module anything outside `src/brain/` should import. Callers get
 * one connected world; which subsystem actually held a given fact is an
 * implementation detail they never have to know.
 *
 * DEPENDENCY DIRECTION
 * --------------------
 * Brain sits ON TOP. It imports reasoning/, mind/ and files/ — never the
 * reverse. Nothing below this layer may import brain/, or the upward
 * dependency that the earlier architecture audit flagged comes straight
 * back. (That is also why B1's type registry lives in reasoning/ and not
 * here: reasoningGraph consumes it.)
 *
 * CONTRACTS
 * ---------
 *   READ-ONLY   The Brain never mutates reasoningGraph or the Mind. It
 *               projects. The one thing it writes is its own annotation
 *               sidecar, which by construction holds no knowledge.
 *   FAIL-OPEN   Every public method catches. The world model is an
 *               enrichment; a failure here must never sink a chat turn or an
 *               ingest. Errors return an empty result, which is always safe.
 *   KILL SWITCH AQUA_BRAIN=off short-circuits every method to empty.
 *   OBSERVABLE  [BRAIN] prefixed logs, brainMetrics() for counts + latency.
 *
 * B2 has no callers yet by design — the retrieval seam is B4's job. Landing
 * the model first keeps that change to a swap-in rather than a rewrite.
 */
import * as graph from '../reasoning/reasoningGraph.js';
import * as evidenceStore from '../files/evidenceStore.js';
import { peekMind } from '../mind/mindStore.js';
import * as annotations from './worldModel/annotationStore.js';
import * as P from './worldModel/projection.js';
import { ingestConversationTurn, ingestMetrics, ingestEnabled } from './knowledgeExtraction/conversationIngest.js';
import { assembleTurnContext, contextEngineMetrics, contextV2Enabled } from './contextEngine/index.js';
import { reflectWorldModel, reflectionV2Metrics, reflectV2Enabled, forgetOwner as forgetReflectionOwner } from './reflectionV2/index.js';
import { observeTwinTurn, twinView, twinMetrics, twinV2Enabled } from './digitalTwin/index.js';
import { buildUnifiedTimeline } from './timelineV2/timelineView.js';
import { buildChains, LIFECYCLE_STAGES } from './timelineV2/chainBuilder.js';
import { getMind } from '../mind/mindStore.js';
import { observeSignals } from '../mind/beliefEngine.js';
import { detectCrossFileContradictions } from '../reasoning/relationshipEngine.js';
import { resolveEntities } from '../reasoning/entityResolver.js';
import { transition } from '../pic/knowledgeLifecycle.js';
import { brainEnabled } from './worldModel/schema.js';
import { purgeOwner as purgeIds } from './identity/idStore.js';

/** Real dependency set. Tests inject their own via the `deps` option. */
const REAL_DEPS = { graph, peekMind, evidenceStore, annotations, getMind, observeSignals };

const metrics = {
  calls: 0, errors: 0, disabled: 0,
  lastDurationMs: 0, avgDurationMs: 0,
};

function track(ms) {
  metrics.lastDurationMs = ms;
  // EWMA, same smoothing the PIC uses for its latency figures.
  metrics.avgDurationMs = metrics.avgDurationMs ? Math.round((metrics.avgDurationMs * 0.8 + ms * 0.2) * 100) / 100 : ms;
}

/**
 * Fail-open wrapper. One place to enforce the kill switch, catch, time and
 * count — so no individual method can forget to.
 */
function guard(label, fallback, fn) {
  if (!brainEnabled()) { metrics.disabled += 1; return fallback; }
  const t0 = Date.now();
  try {
    metrics.calls += 1;
    return fn();
  } catch (err) {
    metrics.errors += 1;
    console.warn(`[BRAIN] ${label} failed (fail-open): ${err?.message ?? err}`);
    return fallback;
  } finally {
    track(Date.now() - t0);
  }
}

// ── World model reads ────────────────────────────────────────────────────────

/** @returns {Array} entities across both graphs, most important first. */
export function listEntities(ownerId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('listEntities', [], () => P.projectEntities(deps, ownerId, rest));
}

/** @returns {object|null} one unified entity by id (`ent:…` or `mind:…`). */
export function getEntity(ownerId, entityId, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  return guard('getEntity', null, () => P.projectEntity(deps, ownerId, entityId));
}

/** @returns {Array} entities matching a name or alias. */
export function findEntities(ownerId, query, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('findEntities', [], () => P.findEntities(deps, ownerId, query, rest));
}

/**
 * Everything AQUA knows about one thing, assembled: the entity plus its
 * relationships, grounded observations and events — from both graphs.
 *
 * This is the call B4's Context Engine will build on, and the reason the
 * projection exposes a shared index: four lookups, one join.
 */
export function describeEntity(ownerId, entityId, opts = {}) {
  const { deps = REAL_DEPS, relationships = 20, observations = 15, events = 15 } = opts;
  return guard('describeEntity', null, () => {
    const index = P.buildWorldIndex(deps, ownerId);
    const entity = P.projectEntity(deps, ownerId, entityId, index);
    if (!entity) return null;
    return {
      entity,
      relationships: P.projectRelationships(deps, ownerId, entity.id, { limit: relationships, index }),
      observations: P.projectObservations(deps, ownerId, entity.id, { limit: observations, index }),
      events: P.projectEvents(deps, ownerId, entity.id, { limit: events, index }),
    };
  });
}

export function getRelationships(ownerId, entityId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('getRelationships', [], () => P.projectRelationships(deps, ownerId, entityId, rest));
}

export function getObservations(ownerId, entityId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('getObservations', [], () => P.projectObservations(deps, ownerId, entityId, rest));
}

export function getEvents(ownerId, entityId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('getEvents', [], () => P.projectEvents(deps, ownerId, entityId, rest));
}

// ── Timeline V2 (B7) ─────────────────────────────────────────────────────────

/**
 * The unified timeline — every event from the reasoning graph, the Mind's own
 * timeline and conversation ingest, ordered, with each event linked to the
 * projects, people, goals, documents and conversations it touches, plus the
 * lifecycle chains detected across them (idea → build → ship → outcome).
 *
 * Read-only. Linking leans on B2's federated entity types: the file side types
 * every proper noun `name`, so without the federation there would be no way to
 * say which of an event's entities is a person and which is a project.
 */
export function getTimeline(ownerId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('getTimeline', { events: [], chains: [], stats: {} },
    () => buildUnifiedTimeline(deps, ownerId, rest));
}

/**
 * The lifecycle chains alone — the "what is the story of X" view. A chain is
 * temporal + stage-ordered evidence of a progression, never a claim that one
 * stage caused the next.
 */
export function getChains(ownerId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('getChains', [], () => buildUnifiedTimeline(deps, ownerId, rest).chains);
}

export { LIFECYCLE_STAGES, buildChains };

// ── Digital Twin (B6) ────────────────────────────────────────────────────────

/**
 * Observe a turn for the six inferred patterns the Mind does not yet cover
 * (writing style, coding style, working hours, learning preference, product
 * philosophy, engineering philosophy).
 *
 * Signals go through the Mind's ONE belief writer, so the new patterns get
 * confidence math, evidence windows, contradiction handling, versioning and
 * decay identically to the existing seven dimensions — no mindSchema change.
 * Fail-open; gated by AQUA_TWIN_V2 (off by default).
 */
export function observeTwin(args = {}, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  return guard('observeTwin', { ok: false }, () =>
    observeTwinTurn({ getMind: deps.getMind, observeSignals: deps.observeSignals }, args));
}

/**
 * What AQUA has inferred about the user — every inference carrying the three
 * things the brief requires: confidence, supporting evidence, last verified
 * (plus the confidence trend). Only patterns past the anti-fabrication bar are
 * reported unless `includeTentative` is set.
 */
export function getTwin(ownerId, opts = {}) {
  const { deps = REAL_DEPS, ...rest } = opts;
  return guard('getTwin', { inferences: [], tentative: 0, patternsCovered: 0 },
    () => twinView({ peekMind: deps.peekMind }, ownerId, rest));
}

export function twinV2Active() { return twinV2Enabled(); }

// ── Reflection Engine V2 (B5) ────────────────────────────────────────────────

/**
 * Build resolved entities from an owner's facts — the same mention→resolve
 * pipeline graphBuilder uses, packaged so the obsolescence detector can reuse
 * the graph's OWN contradiction judgement rather than a divergent one.
 */
function buildEntitiesForOwner(deps, ownerId, facts) {
  const ES = deps.evidenceStore;
  const mentions = [];
  for (const fact of facts) {
    const evidence = ES.evidenceForFact(ownerId, fact.id) ?? [];
    const fileId = evidence[0]?.sourceFileId ?? null;
    for (const raw of fact.entities ?? []) {
      mentions.push({ value: raw, type: guessMentionType(raw), fileId, factId: fact.id, evidenceId: evidence[0]?.id ?? null });
    }
  }
  return resolveEntities(mentions).entities;
}

function guessMentionType(raw) {
  return /@/.test(String(raw)) ? 'email' : 'name';
}

/**
 * Reflect on the world model — compute a STRUCTURED delta of what changed
 * (entities, relationships, obsoleted facts, revised assumptions) since the
 * last reflection, and apply it via reversible lifecycle transitions.
 *
 * Runs on the Mind's existing reflection cadence (chat post-turn), takes the
 * Mind's already-computed report to fold in goal/belief changes, and never
 * recomputes what another subsystem owns. Fail-open; application gated by
 * AQUA_REFLECT_V2 (off → the delta is still computed as a dry-run for
 * observability, nothing is written).
 */
export function reflectTurn(ownerId, opts = {}) {
  const { deps = REAL_DEPS, mindReport = null, apply = undefined } = opts;
  const reflectDeps = {
    graph: deps.graph,
    evidenceStore: deps.evidenceStore,
    detectContradictions: detectCrossFileContradictions,
    buildEntitiesForOwner: (d, oid, facts) => buildEntitiesForOwner({ evidenceStore: deps.evidenceStore }, oid, facts),
    transition,
    annotate: (oid, eid, patch) => deps.annotations.annotate(oid, eid, patch),
  };
  return guard('reflectTurn', { delta: null, applied: false },
    () => reflectWorldModel(reflectDeps, ownerId, { mindReport, apply }));
}

export function reflectV2Active() { return reflectV2Enabled(); }

// ── Context Engine V2 (B4) ───────────────────────────────────────────────────

/**
 * Assemble the optimal context for a turn — the ten-dimension scorer +
 * budgeted, diversity-aware selection. Returns the SAME { items, block, stats }
 * shape the PIC lane returns (superset — extra data in stats.contextEngine),
 * so it drops into the existing chat seam with no downstream change.
 *
 * The caller supplies the PIC retrieval fn as the floor and, when embeddings
 * are on, the pre-awaited semantic scores (the async boundary stays in chat,
 * not here). Fail-safe: any failure returns the PIC floor unchanged — the
 * user never gets a worse answer than V1 produced. Off unless
 * AQUA_CONTEXT_V2=on, in which case this is a pure passthrough of the floor.
 */
export function assembleContext(ownerId, query, floorRetrieve, opts = {}) {
  const { deps = REAL_DEPS, semanticScores = null, activeProjectId = null, priorEntityIds = null, limit = 8, charBudget = 1600, plan = null } = opts;
  const engineDeps = {
    picRetrieve: floorRetrieve,
    graph: deps.graph,
    evidenceStore: deps.evidenceStore,
    peekMind: deps.peekMind,
    formatCitation: opts.formatCitation ?? null,
    semanticScores,
    activeProjectId,
  };
  return guard('assembleContext',
    { items: [], block: '', stats: {} },
    () => assembleTurnContext(engineDeps, ownerId, query, { limit, charBudget, priorEntityIds: priorEntityIds ?? undefined, plan }));
}

export function contextV2Active() { return contextV2Enabled(); }

// ── Conversation ingest (B3) ─────────────────────────────────────────────────

/**
 * Feed one conversation turn into the world model — the seam that finally
 * gives conversations the same standing as files. Fail-open and gated behind
 * AQUA_BRAIN_INGEST (separately from the read-side switch), so it is inert
 * until deliberately turned on. The graph module is the only real dependency.
 *
 * Called from chat.js §9b, right after the turn is persisted.
 */
export function observeConversationTurn(args = {}, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  return guard('observeConversationTurn', { ok: false }, () =>
    ingestConversationTurn({ graph: deps.graph }, args));
}

// ── Annotations ──────────────────────────────────────────────────────────────

/**
 * Attach curated context to an entity — description, extra aliases, tags, or
 * an explicit importance/confidence override.
 *
 * This is the ONLY write the Brain makes, and it deliberately cannot hold
 * knowledge: delete `.aqua-brain.json` and every entity, relationship, fact
 * and event survives untouched in the subsystems that own them.
 */
export function annotateEntity(ownerId, entityId, patch = {}, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  return guard('annotateEntity', null, () => deps.annotations.annotate(ownerId, entityId, patch));
}

export function removeAnnotation(ownerId, entityId, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  return guard('removeAnnotation', false, () => deps.annotations.removeAnnotation(ownerId, entityId));
}

// ── Lifecycle + observability ────────────────────────────────────────────────

/** Account deletion hook. Only annotations are ours to purge. */
export function purgeOwner(ownerId, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  const out = { annotations: 0, canonicalIds: 0 };
  try {
    forgetReflectionOwner(ownerId);   // drop reflection snapshot state too
    const ann = deps.annotations.purgeOwner(ownerId);
    out.annotations = typeof ann === 'number' ? ann : (ann?.annotations ?? 0);
  } catch (err) {
    console.warn(`[BRAIN] purgeOwner (annotations) failed: ${err?.message ?? err}`);
  }
  try {
    out.canonicalIds = purgeIds(ownerId) ?? 0;
  } catch (err) {
    console.warn(`[BRAIN] purgeOwner (ids) failed: ${err?.message ?? err}`);
  }
  return out;
}
 

/** Where the owner's world came from — file side, chat side, or both. */
export function worldStats(ownerId, opts = {}) {
  const { deps = REAL_DEPS } = opts;
  return guard('worldStats', { entities: 0, fileOnly: 0, mindOnly: 0, federated: 0 },
    () => P.worldStats(deps, ownerId));
}

export function brainMetrics() {
  return { ...metrics, enabled: brainEnabled(), annotations: annotations.annotationStats(), ingest: ingestMetrics(), contextEngine: contextEngineMetrics(), reflectionV2: reflectionV2Metrics(), twin: twinMetrics() };
}

export { brainEnabled, ingestEnabled, contextV2Enabled, reflectV2Enabled, twinV2Enabled };
