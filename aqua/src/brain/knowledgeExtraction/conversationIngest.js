/**
 * AQUA Brain — Conversation Ingest (Brain V1 / B3)
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `pic/core.js:onKnowledgeIngested` has exactly one caller: fileEngine. Every
 * document an owner uploads flows into the reasoning graph with full
 * provenance; every conversation — the highest-volume input AQUA has —
 * contributes nothing to it. The Mind observes conversations (mind.graph),
 * but everything it learns is anchored to the user (SELF → X edges) and
 * carries no evidence. So "Priya owns the billing service", said in chat,
 * is invisible to the graph the reasoning layers actually traverse, and can
 * never corroborate or contradict the same claim from a document.
 *
 * B3 gives conversations the SAME standing as files:
 *
 *   • A conversation turn becomes a `conversation` source node (registered
 *     as a new node CLASS via B1 — deliberate, not auto).
 *   • Entities named in the turn are resolved (reusing entityResolver, the
 *     exact machinery files use, so "Priya" from chat and "Priya" from a doc
 *     resolve to ONE entity) and linked to the conversation with a
 *     provenance-bearing `mentions` edge.
 *   • Relationships stated in the turn are typed by the same predicate
 *     engine B1 added, and stored as grounded edges between third-party
 *     entities — not just user→X.
 *
 * The evidence is the message itself: a synthetic UKO-shaped source id
 * (`conv:<conversationId>:<turn>`) and an evidence record whose snippet is
 * the sentence. That keeps the reasoning contract intact — every edge still
 * has provenance — while being honest that the source is conversational, not
 * a document (extractionMethod: 'heuristic', sourceType: 'conversation').
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 *   • It does not re-implement extraction. extractEntities / extractFacts /
 *     resolveEntities / the B1 predicate typing are reused wholesale.
 *   • It does not touch the Mind. mindObserve still runs; this is additive.
 *   • It does not write conversation FACTS into evidenceStore as if they were
 *     document facts — conversational claims are lower-trust and live only as
 *     graph edges with conversational provenance, so a query can always tell
 *     a stated-in-chat claim from a document-grounded one.
 *
 * Fail-open, off by default (AQUA_BRAIN_INGEST), bounded per turn.
 */
import { extractEntities } from '../../files/extractors.js';
import { resolveEntities } from '../../reasoning/entityResolver.js';
import { buildRelationships } from '../../reasoning/relationshipEngine.js';
import { registerNodeType } from '../../reasoning/typeRegistry.js';
import { brainEnabled } from '../worldModel/schema.js';

// `conversation` is a new node CLASS (a source, like `file`). Registered
// idempotently at the point of use rather than only at import: the registry
// is process-local and rebuildable, so an import-time-only registration is a
// hidden ordering dependency — anything that re-seeds the registry would
// silently drop it. registerNodeType is a cheap Map write.
function ensureConversationNodeType() {
  registerNodeType('conversation', { description: 'a conversation turn as a knowledge source', source: 'brain-b3' });
}
ensureConversationNodeType();

/** Ingest is opt-in separately from the read-side kill switch. */
function ingestEnabled() {
  return brainEnabled() && String(process.env.AQUA_BRAIN_INGEST ?? '').toLowerCase() === 'on';
}

// Per-turn bounds — a runaway message must never balloon the graph.
const MAX_ENTITIES_PER_TURN = 20;
const MAX_FACTS_PER_TURN    = 15;
const MIN_TEXT_LENGTH       = 12;   // below this there is nothing worth resolving

const metrics = {
  turns: 0, skipped: 0, errors: 0,
  entitiesLinked: 0, relationshipsAdded: 0, conversationsSeen: 0,
  lastDurationMs: 0,
};

/**
 * The synthetic source id for a conversation turn. Shaped like a UKO id so
 * every provenance-bearing edge has a well-formed sourceFile, and stable so
 * re-ingesting the same turn is idempotent (upsert/merge, never duplicate).
 */
function turnSourceId(conversationId, turn) {
  return `conv:${conversationId}:${turn}`;
}

/**
 * A minimal evidenceStore-shaped adapter over ONE turn's text. buildRelationships
 * and entity resolution both expect an evidenceStore that can hand back the
 * evidence behind a fact; conversation facts never touch the real store, so
 * this satisfies the interface in-memory. The evidence id embeds the turn so
 * provenance points back at the exact message.
 */
function turnEvidenceStore(sourceId, facts) {
  const evId = `${sourceId}#ev`;
  const evidence = [{ id: evId, sourceFileId: sourceId, sourceFileName: sourceId, extractionMethod: 'heuristic', confidence: 0.6, snippet: '' }];
  return {
    evidenceForFact: (_o, factId) => (facts.some(f => f.id === factId) ? evidence : []),
    getFact: (_o, factId) => facts.find(f => f.id === factId) ?? null,
    listFacts: () => facts,
  };
}

/**
 * Ingest one conversation turn into the world model.
 *
 * @param {object} deps - { graph } (reasoningGraph), injected for tests
 * @param {object} args - { ownerId, conversationId, turn, userMessage, assistantMessage }
 * @returns {{ ok, entities, relationships, skipped? }}
 */
export function ingestConversationTurn(deps, {
  ownerId, conversationId, turn = 0, userMessage = '', assistantMessage = '',
} = {}) {
  if (!ingestEnabled()) { metrics.skipped += 1; return { ok: false, skipped: 'disabled' }; }
  if (!ownerId || !conversationId) { metrics.skipped += 1; return { ok: false, skipped: 'missing-owner' }; }

  const { graph: G } = deps;

  // The owner's self node, if enabled. Created lazily on first ingest so that
  // user-anchored knowledge has somewhere to attach in the next increment.
  // Fail-open and idempotent; nothing downstream depends on it yet.
  try { deps.ensureSelfEntity?.(deps, ownerId); } catch { /* fail-open */ }
  const started = Date.now();
  try {
    ensureConversationNodeType();
    // Both sides of the turn are knowledge: the user states things, and the
    // assistant's grounded answer states things too. Join them for extraction
    // but keep the source id per-turn.
    const text = `${userMessage}\n${assistantMessage}`.trim();
    if (text.length < MIN_TEXT_LENGTH) { metrics.skipped += 1; return { ok: false, skipped: 'too-short' }; }

    const sourceId = turnSourceId(conversationId, turn);

    // 1. Source node for the turn. Merge-safe: same id re-ingests cleanly.
    G.upsertNode(ownerId, {
      id: `conv:${conversationId}`,
      type: 'conversation',
      label: `Conversation ${conversationId}`,
      kind: 'observed',
      data: { conversationId },
      sourceFiles: [sourceId],
    }, { fileId: sourceId });

    // 2. Extract + resolve entities from the turn (reused file machinery).
    const rawEntities = extractEntities(text, { limit: MAX_ENTITIES_PER_TURN });
    if (!rawEntities.length) {
      metrics.turns += 1; metrics.conversationsSeen += 1;
      return { ok: true, entities: 0, relationships: 0 };
    }

    const mentions = rawEntities.map(e => ({
      value: e.value, type: e.type, fileId: sourceId, fileName: sourceId,
      factId: null, evidenceId: `${sourceId}#ev`,
    }));
    const { entities } = resolveEntities(mentions);

    // 3. Entity nodes + `mentions` edges from the conversation (provenance =
    //    the turn). Same node shape/id scheme as graphBuilder, so a
    //    conversation entity and a file entity with the same resolved id ARE
    //    the same node — corroboration across sources falls out for free.
    let entitiesLinked = 0;
    const entityNodeByName = new Map();
    for (const e of entities) {
      G.upsertNode(ownerId, {
        id: e.id, type: 'entity', label: e.canonical, kind: 'derived',
        data: { entityType: e.type, aliases: e.aliases, resolutionConfidence: e.confidence, fromConversation: true },
        sourceFiles: [sourceId],
      }, { fileId: sourceId });
      for (const name of [e.canonical, ...e.aliases]) entityNodeByName.set(String(name).toLowerCase(), e.id);
      G.addEdge(ownerId, {
        from: `conv:${conversationId}`, to: e.id, type: 'mentions',
        kind: 'observed', confidence: 0.6,
        evidence: [`${sourceId}#ev`], sourceFiles: [sourceId],
        reason: `mentioned in conversation ${conversationId}`,
      }, { fileId: sourceId });
      entitiesLinked += 1;
    }

    // 3b. Tell PIC the resolver merged surface forms here.
    //
    //     PIC's document path (onKnowledgeIngested) needs ukoIds and reads
    //     evidenceStore; a turn has neither, and faking a UKO would push
    //     conversational claims through a path that treats them as document
    //     objects. onEntitiesResolved records only the merge revision.
    //
    //     Fail-open and fire-and-forget: PIC's bookkeeping must never be able
    //     to cost the caller a turn.
    if (entities.length) {
      try {
        deps.pic?.onEntitiesResolved?.({
          ownerId, entities, source: conversationId, traceId: sourceId,
        });
      } catch { /* fail-open */ }
    }

    // 4. Relationships. extractFacts() is a DOCUMENT heuristic — it requires a
    //    numeric token (funding figures, dates) and would drop almost every
    //    conversational sentence. So build relationship input directly: each
    //    sentence naming ≥2 resolved entities becomes a fact carrying those
    //    entities, and the SAME B1 predicate engine types it. Conversational
    //    claims stay graph-only and lower-confidence — never written to
    //    evidenceStore as if they were document facts.
    const canonicalByNorm = new Map();
    for (const e of entities) for (const name of [e.canonical, ...e.aliases]) canonicalByNorm.set(String(name).toLowerCase(), e.canonical);

    const facts = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (let i = 0; i < sentences.length && facts.length < MAX_FACTS_PER_TURN; i++) {
      const sentence = sentences[i].trim();
      if (sentence.length < MIN_TEXT_LENGTH) continue;
      const lower = sentence.toLowerCase();
      const named = [...new Set(
        [...canonicalByNorm.keys()].filter(n => lower.includes(n)).map(n => canonicalByNorm.get(n)),
      )];
      if (named.length >= 2) {
        facts.push({
          id: `${sourceId}:fact:${i}`,
          statement: sentence,
          entities: named,
          confidence: 0.6,
          evidence: [`${sourceId}#ev`],
        });
      }
    }

    let relationshipsAdded = 0;
    if (facts.length) {
      const es = turnEvidenceStore(sourceId, facts);
      const relationships = buildRelationships(entities, facts, es, ownerId);
      for (const rel of relationships) {
        G.addEdge(ownerId, {
          from: rel.from, to: rel.to, type: rel.type, kind: 'derived',
          // Conversational relationships are capped below document-grade: a
          // thing stated in chat is weaker evidence than a thing extracted
          // from a document with a citation.
          confidence: Math.min(rel.confidence, 0.7),
          evidence: rel.evidence, sourceFiles: rel.sourceFiles,
          reason: `${rel.reason} (conversation)`, id: rel.id,
        }, { fileId: sourceId });
        relationshipsAdded += 1;
      }
    }

    metrics.turns += 1;
    metrics.conversationsSeen += 1;
    metrics.entitiesLinked += entitiesLinked;
    metrics.relationshipsAdded += relationshipsAdded;
    metrics.lastDurationMs = Date.now() - started;

    if (entitiesLinked || relationshipsAdded) {
      console.log(`[BRAIN] Conversation ingested owner=${ownerId} conv=${conversationId} turn=${turn} entities=${entitiesLinked} relationships=${relationshipsAdded} in ${metrics.lastDurationMs}ms`);
    }
    return { ok: true, entities: entitiesLinked, relationships: relationshipsAdded };
  } catch (err) {
    metrics.errors += 1;
    console.warn(`[BRAIN] ingestConversationTurn failed (fail-open): ${err?.message ?? err}`);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export function ingestMetrics() {
  return { ...metrics, enabled: ingestEnabled() };
}

export { ingestEnabled };