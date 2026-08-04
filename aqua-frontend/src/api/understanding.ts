import { apiClient } from './client';

/**
 * UUS — the Understanding read model.
 *
 * One client for three screens: the first-run gate, the world-model card, and
 * (in U6) the dashboard. They read the same endpoint on purpose — a card and a
 * dashboard disagreeing about how well AQUA knows you is the failure the
 * server-side score exists to prevent.
 */

export interface UnderstandingItem {
  /** What PATCH /understanding/item takes. Every line is correctable. */
  ref: string;
  text: string;
  confidence: number;
}

export interface CardSection {
  id: string;
  label: string;
  items: UnderstandingItem[];
  confidence: number;
  confidenceLabel: string;
}

export interface WorldModelCard {
  headline: string;
  sections: CardSection[];
  score: number;
  confidence: string;
  sources: { kind: string; count: number }[];
  /** Someone answered two questions and stopped. A real outcome, not an error. */
  isThin: boolean;
}

export interface UnderstandingProject { id: string; label: string; ref: string }
export interface KnowledgeSource { kind: string; label: string; count: number }
export interface UnknownArea { id: string; dimension: string; prompt: string; weight: number }

/** The dashboard read model. Same endpoint the card reads — one score, one truth. */
export interface UnderstandingModel {
  score: number;
  confidence: string;
  isNew: boolean;
  sections: CardSection[];
  projects: UnderstandingProject[];
  goals: { ref: string; id: string; title: string; status: string; confidence: number }[];
  unknowns: UnknownArea[];
  sources: KnowledgeSource[];
  updatedAt: number | null;
}

export async function fetchUnderstanding(): Promise<UnderstandingModel> {
  const { data } = await apiClient.get<{ success: boolean } & UnderstandingModel>('/understanding');
  return data;
}

/**
 * "Correct my understanding" — one call for every kind of item.
 *
 * The UI never CONSTRUCTS a ref; it echoes back the one it was given. So a
 * change to how something is stored cannot break a screen, and the person
 * clicking "not quite" never has to know whether they are editing a belief, a
 * goal or a graph node. That is the whole point.
 */
export async function correctItem(
  ref: string,
  opts: { value?: string; action?: 'correct' | 'remove' | 'keep' } = {},
): Promise<void> {
  await apiClient.patch('/understanding/item', {
    ref,
    value: opts.value ?? null,
    action: opts.action ?? 'correct',
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   WHAT CHANGED — the revisions AQUA made to its own understanding.
   ────────────────────────────────────────────────────────────────────────────
   The other two screens answer "what does AQUA know about me". This answers
   "what did it change its mind about", which is the half a bigger context
   window cannot do: a transcript gives an assistant recall, not a position
   that can be revised.

   Read-only. There is deliberately no "not quite" here — a revision is a
   record of something that happened, not a claim to be corrected. The
   underlying belief IS correctable, on the sections above.
   ──────────────────────────────────────────────────────────────────────────── */

export interface UnderstandingChange {
  at: number;
  summary: string | null;
  entities: number;
  relationships: number;
  obsoleted: number;
  revised: number;
  /** Whether AQUA acted on the revision or merely noticed it. With
   *  AQUA_REFLECT_V2 off the delta is still computed as a dry-run, so an
   *  unapplied entry is real history rather than a failure. */
  applied: boolean;
}

export async function fetchChanges(limit = 8): Promise<UnderstandingChange[]> {
  const { data } = await apiClient.get<{ success: boolean; changes?: UnderstandingChange[] }>(
    '/brain/changes', { params: { limit } },
  );
  return data.changes ?? [];
}

export interface IntroState {
  ownerId: string | null;
  hasIntro: boolean;
  score: number;
  shouldOffer: boolean;
}

/** What the first-run gate asks at boot. Cheap; nothing here is stored state. */
export async function fetchIntroState(conversationId?: string | null): Promise<IntroState> {
  const { data } = await apiClient.get<{ success: boolean } & IntroState>(
    '/understanding/intro/state',
    { params: conversationId ? { conversationId } : undefined },
  );
  return { ownerId: data.ownerId, hasIntro: data.hasIntro, score: data.score, shouldOffer: data.shouldOffer };
}

/** Mark the intro done and get the assembled card back. */
export async function completeIntro(conversationId: string | null): Promise<WorldModelCard> {
  const { data } = await apiClient.post<{ success: boolean; card: WorldModelCard }>(
    '/understanding/intro/complete',
    { conversationId },
  );
  return data.card;
}
