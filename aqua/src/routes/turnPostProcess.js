/**
 * AQUA — Post-Turn Processing (Phase 2, step 1)
 *
 * WHAT THIS IS
 * ------------
 * The understanding side-effects that run after a chat turn has been
 * answered: Mind post-turn, world-model ingest, Digital Twin observation,
 * and cadence-gated Reflection V2.
 *
 * WHY IT IS ITS OWN FILE
 * ----------------------
 * This block existed TWICE in chat.js — once in POST /chat (§9b–9d) and
 * again, byte for byte, in POST /chat/stream. Two copies meant every new
 * understanding stage had to be wired twice and could silently drift, and it
 * is the structural reason a unified pipeline was hard to build. The audit
 * called it W6.
 *
 * THIS CHANGE IS A NO-OP
 * ----------------------
 * Deliberately. The audit's R5 mitigation was to extract the shared helper
 * FIRST, ship it alone, verify it, and only then change behaviour — because
 * the streaming endpoint is the riskiest thing in the codebase to touch and
 * "refactor plus behaviour change" is unreviewable when it breaks.
 *
 * So: same calls, same order, same try/catch boundaries, same setImmediate
 * deferral, same fail-open semantics. Nothing observable changes.
 *
 * IT ALSO RETIRES P0-5
 * --------------------
 * Phase 0 shipped four flags that activate code reached only through these
 * seams — and the seams themselves had no test coverage at all. `flagproof`
 * covered the modules; nothing covered the wiring. Extracting the block into
 * an injectable unit is what makes that wiring testable.
 *
 * ORDERING IS LOAD-BEARING
 * ------------------------
 * Ingest runs before reflection, in separate ticks, so reflection reflects on
 * the turn just absorbed rather than the one before it. Both are deferred so
 * neither adds a millisecond to the response the user is waiting on.
 */
import { defer } from '../core/jobs/jobRegistry.js';
import * as Brain from '../brain/index.js';
import { memoryAfterTurn } from '../memory/engine.js';
import { getConversation } from '../memory/conversationStore.js';
import { REFLECT_EVERY_TURNS } from '../mind/reflectionEngine.js';
import { consolidate, consolidateEnabled, CONSOLIDATE_EVERY_TURNS } from '../pic/core.js';
import { peekMind } from '../mind/mindStore.js';

/** Real wiring. Overridable so the seam is testable without a live turn. */
const REAL_DEPS = Object.freeze({
  memoryAfterTurn,
  getConversation,
  observeConversationTurn: Brain.observeConversationTurn,
  observeTwin: Brain.observeTwin,
  reflectTurn: Brain.reflectTurn,
  // E4/PR-1 — was a bare `setImmediate`. Measured: on SIGTERM, 3 of 3
  // outstanding post-turn jobs were lost and NOTHING KNEW they existed. Same
  // deferral and same fail-open; the registry simply makes the work visible
  // to the shutdown drain. The injectable seam was already here, which is why
  // this is a one-line change rather than new plumbing.
  defer: fn => defer('post-turn', fn),
  reflectEvery: REFLECT_EVERY_TURNS,
  consolidate,
  consolidateEnabled,
  consolidateEvery: CONSOLIDATE_EVERY_TURNS,
  // The OWNER's turn count, not the conversation's. Reflection keys off
  // conversation length, which is fine for reflection but wrong here:
  // consolidation operates across an owner's whole corpus, and most
  // conversations are short enough that a conversation-scoped counter would
  // almost never reach the interval. `mind.turnCount` is already persisted,
  // already owner-scoped, and already exists to drive exactly this kind of
  // cadence — reusing it beats introducing a second clock.
  ownerTurnCount: (ownerId) => peekMind(ownerId)?.turnCount ?? 0,
});

/**
 * Owner → turn count at last consolidation.
 *
 * Deliberately in memory. Consolidation is idempotent (measured: a second
 * pass over the same corpus merges 0 and changes nothing), so a watermark lost
 * to a redeploy costs one redundant pass, never correctness. Persisting it
 * would mean a schema change to picStore for no behavioural gain.
 *
 * A watermark rather than `turnCount % every === 0`: modulo silently skips the
 * cadence whenever a turn is missed, and turns ARE missed here — this runs
 * fail-open behind a flag, off a counter another subsystem increments.
 */
const lastConsolidatedAt = new Map();

/** Test seam — the watermark is process-local state, so it needs a reset. */
export function _resetConsolidationWatermark() { lastConsolidatedAt.clear(); }

/**
 * Run every post-turn understanding side-effect.
 *
 * Never throws. Never awaits. The caller has already sent, or is about to
 * send, the user's answer — nothing here may affect it.
 *
 * @param {object} args
 * @param {string} args.ownerId           resolved memory owner
 * @param {string} args.conversationId
 * @param {string} args.userMessage       the USER's message only
 * @param {string} args.assistantMessage  the final answer
 * @param {string} [args.taskType]
 * @param {string} [args.workspaceId]
 * @param {object} [deps]                 injected for tests
 */
export function runPostTurn({
  ownerId, conversationId, userMessage, assistantMessage,
  taskType = null, workspaceId = null,
} = {}, deps = REAL_DEPS) {
  const d = deps === REAL_DEPS ? REAL_DEPS : { ...REAL_DEPS, ...deps };

  // Mind post-turn — predictions rebuild + async reflection when due.
  // Synchronous in the original, so synchronous here.
  try {
    d.memoryAfterTurn(ownerId, { taskType, workspaceId });
  } catch { /* fail-open */ }

  // Brain world-model ingest (B3) — conversations earn the same graph
  // standing as files. Fail-open + off by default (AQUA_BRAIN_INGEST), so
  // this is inert until turned on. Deferred to the next tick so it never
  // adds a millisecond to the response the user is waiting on.
  d.defer(() => {
    try {
      d.observeConversationTurn({
        ownerId,
        conversationId,
        turn: d.getConversation(conversationId).length,
        userMessage,
        assistantMessage,
      });
    } catch { /* fail-open: world-model enrichment must never affect the turn */ }
    try {
      // Digital Twin (B6) — the six inferred patterns the Mind does not yet
      // cover. Signals route through the Mind's ONE belief writer, so they
      // decay/contradict/version like every existing dimension. Reads the
      // USER's message only: inferring the user's style from AQUA's own
      // output would be a closed loop that manufactures its own evidence.
      d.observeTwin({ ownerId, userMessage, conversationId });
    } catch { /* fail-open */ }
  });

  // Brain Reflection V2 (B5) — on the Mind's reflection cadence, compute a
  // STRUCTURED world-model delta (entities/relationships/obsoleted facts) and
  // apply it via reversible lifecycle transitions. Deferred, fail-open, off
  // by default (AQUA_REFLECT_V2). Runs after the ingest above so it reflects
  // on the turn just absorbed.
  d.defer(() => {
    try {
      if ((d.getConversation(conversationId).length % d.reflectEvery) === 0) {
        d.reflectTurn(ownerId);
      }
    } catch { /* fail-open: reflection must never affect the turn */ }
  });

  // PIC consolidation (audit M6) — knowledge was accumulating and never
  // maturing: duplicates unmerged, corroborated claims never promoted to
  // trusted, stale claims never marked. Everything needed already existed;
  // the only trigger was a human curling POST /intelligence/maintain.
  //
  // Its own tick, after reflection, so a heavier pass (~90ms at 2k facts)
  // cannot delay the lighter stages above. Deferred, fail-open, off by default
  // (AQUA_CONSOLIDATE).
  d.defer(() => {
    try {
      if (!d.consolidateEnabled()) return;
      const turns = d.ownerTurnCount(ownerId);
      if (!turns) return;
      const last = lastConsolidatedAt.get(ownerId) ?? 0;
      if (turns - last < d.consolidateEvery) return;
      lastConsolidatedAt.set(ownerId, turns);
      d.consolidate(ownerId);
    } catch { /* fail-open: maintenance must never affect the turn */ }
  });
}

export const _internals = { REAL_DEPS };