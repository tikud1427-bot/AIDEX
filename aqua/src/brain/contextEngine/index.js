/**
 * AQUA Brain — Context Engine V2 Orchestrator (Brain V1 / B4)
 *
 * The bridge between AQUA's stores and the pure scorer/assembler. It:
 *
 *   1. Runs the EXISTING PIC retrieval first (the safe floor — its facts,
 *      entities, timeline, lifecycle flags and provenance are the candidate
 *      pool, so nothing the tested lane found is lost).
 *   2. Widens the pool with world-model neighbours: entities the query is
 *      about, and facts one hop out — the "connected facts the lexical lane
 *      missed" idea, now scored rather than flat-bonused.
 *   3. Computes the per-turn SIGNAL BAG once: query tokens, active-project
 *      tokens (the workspace), active-goal tokens (goalTracker), the focus
 *      entities the query names (hop origin for relationship distance),
 *      prior-turn entities (continuity), and — when embeddings are on — real
 *      semantic scores.
 *   4. Hands both to assembleContext(), which scores on all ten dimensions
 *      and selects under budget with diversity.
 *
 * CONTRACT
 *   • SUPERSET. Returns { items, block, stats } exactly like PIC, so it is a
 *     drop-in at the chat seam. Extra data rides in stats.contextEngine.
 *   • FAIL-SAFE FLOOR. If anything past the PIC call fails, it returns the
 *     raw PIC result — the user never gets a WORSE answer than V1 gave.
 *   • OFF BY DEFAULT. AQUA_CONTEXT_V2=on selects V2 assembly; otherwise the
 *     PIC result passes straight through, byte-identical.
 *
 * Impure only at the boundary (reads stores through injected deps); the
 * scoring/selection it delegates to is pure.
 */
import { assembleContext } from './assembler.js';
import { tokensOf } from './scorer.js';
import { brainEnabled } from '../worldModel/schema.js';

const metrics = {
  calls: 0, v2Assemblies: 0, floorFallbacks: 0, errors: 0,
  candidatesSeen: 0, itemsSelected: 0, lastDurationMs: 0,
};

/** V2 assembly is opt-in on top of the read-side switch. */
export function contextV2Enabled() {
  return brainEnabled() && String(process.env.AQUA_CONTEXT_V2 ?? '').toLowerCase() === 'on';
}

/**
 * @param {object} deps - {
 *     picRetrieve(ownerId, query, opts) → { items, block, stats },  // the floor
 *     graph, evidenceStore, peekMind, formatCitation,
 *     semanticScores?: Map|null,      // pre-awaited by the caller (async boundary)
 *     activeProjectId?: string|null,
 *   }
 * @param {string} ownerId
 * @param {string} query
 * @param {object} [opts] - { limit, charBudget, priorEntityIds?, plan? }
 * @returns {{ items, block, stats }}
 */
export function assembleTurnContext(deps, ownerId, query, opts = {}) {
  const { limit = 8, charBudget = 1600 } = opts;
  metrics.calls += 1;

  // 1. The floor: the existing, tested PIC retrieval. Always computed.
  const floor = safeFloor(deps, ownerId, query, { limit, plan: opts.plan });
  if (!contextV2Enabled() || !ownerId || !query) return floor;

  const started = Date.now();
  try {
    const candidates = gatherCandidates(deps, ownerId, query, floor, opts);
    metrics.candidatesSeen += candidates.length;

    const ctx = buildSignalBag(deps, ownerId, query, candidates, opts);
    const assembled = assembleContext(candidates, ctx, { limit, charBudget });

    metrics.v2Assemblies += 1;
    metrics.itemsSelected += assembled.items.length;
    metrics.lastDurationMs = Date.now() - started;

    // Never regress below the floor: if V2 somehow selected nothing but the
    // floor had content, keep the floor. Assembling less than V1 is a bug,
    // not an improvement.
    if (!assembled.items.length && floor.items.length) {
      metrics.floorFallbacks += 1;
      return floor;
    }
    assembled.stats.contextEngine.floorItems = floor.items.length;
    return assembled;
  } catch (err) {
    metrics.errors += 1;
    metrics.floorFallbacks += 1;
    console.warn(`[BRAIN] Context Engine V2 failed (floor fallback): ${err?.message ?? err}`);
    return floor;
  }
}

function safeFloor(deps, ownerId, query, opts) {
  try {
    return deps.picRetrieve(ownerId, query, opts) ?? emptyResult();
  } catch (err) {
    console.warn(`[BRAIN] PIC floor retrieval failed: ${err?.message ?? err}`);
    return emptyResult();
  }
}

// ── Candidate gathering ──────────────────────────────────────────────────────

/**
 * Turn the PIC result + world-model neighbours into a flat candidate pool of
 * normalized objects the scorer understands. Everything the PIC found is
 * included (nothing lost); the world model adds reach.
 */
function gatherCandidates(deps, ownerId, query, floor, opts) {
  const { graph: G, evidenceStore: ES, formatCitation } = deps;
  const byId = new Map();

  // (a) PIC facts — carry their provenance, lifecycle flags, citations.
  for (const it of floor.items ?? []) {
    if (it.kind === 'fact') {
      const key = `fact:${it.id}`;
      byId.set(key, normFact(it.id, it.statement, {
        confidence: it.confidence, citations: it.citations,
        trusted: it.trusted, disputed: it.disputed, stale: it.stale,
        via: it.via, sourceType: 'document',
        entityIds: [], timestamp: null, semanticId: it.id,
      }));
    } else if (it.kind === 'entity') {
      byId.set(`entity:${it.nodeId}`, normEntity(it.nodeId, it.entity, {
        entityType: it.entityType, aliases: it.aliases, files: it.files,
      }));
    } else if (it.kind === 'event') {
      byId.set(`event:${it.statement}`, normEvent(it.statement, it.statement, { timestamp: it.timestamp, certainty: it.certainty }));
    }
  }

  // (b) World-model reach: entities the query names, and facts one hop out.
  //     Scored on distance, not given a flat bonus.
  const focusEntities = findFocusEntities(G, ownerId, query);
  for (const ent of focusEntities) {
    const ekey = `entity:${ent.id}`;
    if (!byId.has(ekey)) {
      byId.set(ekey, normEntity(ent.id, ent.label, {
        entityType: ent.data?.entityType, aliases: ent.data?.aliases ?? [],
        files: G.neighbors(ownerId, ent.id, { type: 'file', edgeType: 'mentions' }).map(({ node }) => node.label),
        hops: 0,
      }));
    } else {
      byId.get(ekey).hops = 0;
    }
    // one hop: facts about this entity
    if (ES) {
      for (const { node } of G.neighbors(ownerId, ent.id, { type: 'fact', edgeType: 'about' })) {
        const factId = node.id.replace(/^fact:/, '');
        const key = `fact:${factId}`;
        if (byId.has(key)) { byId.get(key).hops = Math.min(byId.get(key).hops ?? 9, 1); byId.get(key).entityIds.push(ent.id); continue; }
        const fact = ES.getFact(ownerId, factId);
        if (!fact) continue;
        const evidence = ES.evidenceForFact(ownerId, factId);
        byId.set(key, normFact(factId, fact.statement, {
          confidence: fact.confidence,
          citations: formatCitation ? evidence.map(formatCitation) : [],
          via: `graph: about ${ent.label}`, sourceType: sourceTypeOf(node),
          entityIds: [ent.id], hops: 1, timestamp: fact.createdAt ?? null, semanticId: factId,
        }));
      }
    }
  }

  return [...byId.values()];
}

/** Entities whose label/alias overlaps the query tokens — the hop origins. */
function findFocusEntities(G, ownerId, query) {
  const qTokens = tokensOf(query);
  if (!qTokens.size) return [];
  const out = [];
  for (const n of G.nodesByType(ownerId, 'entity')) {
    const names = [n.label, ...(n.data?.aliases ?? [])].map(v => String(v).toLowerCase());
    if (names.some(name => [...qTokens].some(t => name.includes(t)))) out.push(n);
  }
  // Prefer the better-corroborated entities as hop origins; cap the fan-out.
  out.sort((a, b) => (b.sourceFiles?.length ?? 0) - (a.sourceFiles?.length ?? 0));
  return out.slice(0, 4);
}

// ── Signal bag ───────────────────────────────────────────────────────────────

function buildSignalBag(deps, ownerId, query, candidates, opts) {
  const { peekMind } = deps;
  const mind = peekMind?.(ownerId) ?? null;

  const activeProjectTokens = new Set();
  if (deps.activeProjectId) for (const t of tokensOf(deps.activeProjectId)) activeProjectTokens.add(t);

  const activeGoalTokens = new Set();
  for (const g of activeGoalTitles(mind)) for (const t of tokensOf(g)) activeGoalTokens.add(t);

  // Focus entities = the query's hop origins (hops===0 in the pool).
  const focusEntityIds = new Set(candidates.filter(c => c.hops === 0 && c.kind === 'entity').map(c => c.id));

  return {
    queryTokens: tokensOf(query),
    semanticScores: deps.semanticScores ?? null,
    activeProjectTokens,
    activeGoalTokens,
    focusEntityIds,
    priorEntityIds: opts.priorEntityIds ?? new Set(),
    maxHops: 3,
  };
}

/** Active goal titles from the Mind, defensively (shape varies, never throw). */
function activeGoalTitles(mind) {
  if (!mind?.goals) return [];
  try {
    return Object.values(mind.goals)
      .filter(g => g && (g.status === 'active' || g.status === 'blocked'))
      .map(g => g.title)
      .filter(Boolean)
      .slice(0, 8);
  } catch { return []; }
}

// ── Normalizers ──────────────────────────────────────────────────────────────

function normFact(id, text, extra = {}) {
  return {
    kind: 'fact', id, text,
    confidence: extra.confidence ?? 0.5,
    citations: extra.citations ?? [],
    trusted: !!extra.trusted, disputed: !!extra.disputed, stale: !!extra.stale,
    via: extra.via ?? 'lexical',
    sourceType: extra.sourceType ?? 'document',
    entityIds: extra.entityIds ?? [],
    hops: extra.hops ?? null,
    timestamp: extra.timestamp ?? null,
    semanticId: extra.semanticId ?? id,
    epistemic: 'observed',
  };
}

function normEntity(id, text, extra = {}) {
  return {
    kind: 'entity', id, text,
    entityType: extra.entityType ?? null,
    aliases: extra.aliases ?? [],
    files: extra.files ?? [],
    confidence: 0.7,
    sourceType: 'document',
    entityIds: [id],
    hops: extra.hops ?? null,
    timestamp: null,
    epistemic: 'derived',
  };
}

function normEvent(id, text, extra = {}) {
  return {
    kind: 'event', id, text,
    timestamp: extra.timestamp ?? null,
    certainty: extra.certainty ?? null,
    confidence: 0.5,
    sourceType: 'derived',
    entityIds: [],
    hops: null,
    epistemic: 'derived',
  };
}

function sourceTypeOf(node) {
  if (node?.data?.fromConversation) return 'conversation';
  return 'document';
}

function emptyResult() {
  return { items: [], block: '', stats: { facts: 0, entities: 0, timelineEvents: 0, connectedFacts: 0, reusedSignals: 0, durationMs: 0 } };
}

export function contextEngineMetrics() {
  return { ...metrics, enabled: contextV2Enabled() };
}
