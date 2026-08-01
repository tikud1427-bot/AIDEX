/**
 * First-person self-disclosure — the grammar test, and nothing else.
 *
 * WHY ITS OWN MODULE
 * ------------------
 * Two callers need the identical rule: `conversationEntities` decides whether
 * to emit the speaker as an entity for the turn, and `conversationFacts`
 * decides, sentence by sentence, whether a given sentence is about them. Two
 * copies of a regex like this drift apart inside a sprint.
 *
 * It lives here rather than in conversationEntities because conversationFacts
 * is a PURE builder, pinned by a structural test that it cannot reach a store.
 * conversationEntities imports the entity extractor and the self-entity
 * constants, and selfEntity imports idStore — so importing it would have put
 * persistence back inside the pure builder's dependency graph. That test
 * caught exactly this, which is the reason to keep such tests.
 *
 * This file therefore has ZERO imports, and must keep having zero.
 *
 * WHAT COUNTS AS DISCLOSURE
 * -------------------------
 * A statement the speaker makes ABOUT THEMSELVES. Not an opinion, not a hedge,
 * not a request, not a question. "I'm building the understanding engine" is
 * disclosure; "I think that's right", "I don't know" and "I want you to
 * rewrite this" are not, and treating them as facts fills the world model with
 * the texture of conversation instead of its content.
 *
 * FIRST-PERSON SINGULAR ONLY
 * --------------------------
 * `we` and `our` are deliberately excluded. A group claim is not an individual
 * one: "we're building X" says the team builds X and leaves the speaker's own
 * role unstated. Attributing it to the owner anyway is exactly the quiet
 * inference that puts a wrong line on a summary card.
 */

const SELF_DECLARATION = new RegExp(
  String.raw`\b(?:` +
    String.raw`i(?:'m| am|'ve| have| was| had)\b` +
    String.raw`|i (?:work|working|build|building|lead|leading|run|running|manage|managing|own|owned|founded|start(?:ed)?|join(?:ed)?|stud(?:y|ied)|live|lived|use|used|prefer|like|love|need|want|focus|care|ship|shipped|write|writing|wrote|code|coding|design|teach|learn)\w*\b` +
    String.raw`|my\b` +
  String.raw`)`,
  'i',
);

const NOT_SELF_DECLARATION = new RegExp(
  String.raw`\b(?:` +
    String.raw`i (?:think|thought|guess|wonder|wondered|mean|meant|see|saw|understand|understood|agree|disagree|assume|suppose|believe|feel|hope|wish|doubt|bet|reckon|notice|noticed)\b` +
    String.raw`|i (?:don'?t|do not|didn'?t|can'?t|cannot|won'?t|couldn'?t) (?:know|understand|see|get)\b` +
    String.raw`|i'?m not sure\b` +
    String.raw`|(?:want|need|'?d like|would like) you to\b` +
  String.raw`)`,
  'i',
);

/**
 * Is this ONE sentence a first-person statement about the speaker?
 * Questions are excluded — "what should I work on next?" discloses nothing.
 */
export function isSelfDeclaration(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (s.endsWith('?')) return false;
  if (NOT_SELF_DECLARATION.test(s)) return false;
  return SELF_DECLARATION.test(s);
}

/**
 * Does any sentence in this text disclose something? Sentence-scoped so one
 * hedge cannot suppress a genuine disclosure sitting beside it.
 */
export function hasSelfDeclaration(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .some(isSelfDeclaration);
}
