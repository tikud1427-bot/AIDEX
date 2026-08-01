/**
 * Entity detection for CONVERSATIONAL text.
 *
 * WHY THIS EXISTS AS A SEPARATE PATH
 * ----------------------------------
 * `files/extractors.js extractEntities` finds proper nouns by looking for
 * capital letters. That is the right heuristic for documents — reports,
 * contracts and slide decks are written in sentence case — and it is exactly
 * the wrong one for chat, where people type "my brother's name is ananya
 * prabal das" and mean every word of it.
 *
 * The production consequence was severe and silent: zero entities from a
 * lowercase turn hits the early return in `conversationIngest.js`, which
 * happens BEFORE any fact is written. So a message dense with durable facts
 * produced nothing at all, and the facts that did get captured were captured
 * only because AQUA's own reply echoed the names back in title case.
 *
 * The shared extractor is deliberately NOT loosened. Lowering its bar would
 * flood the document pipeline — where capitalisation is a genuine signal —
 * with false entities, and every uploaded file would pay for a chat problem.
 * This module wraps it instead, and is imported only by conversation ingest.
 *
 * THREE PASSES, MOST CONSERVATIVE FIRST
 * ------------------------------------
 *   A. shared    the existing extractor, unmodified. Everything it finds
 *                today it still finds, including all the typed patterns
 *                (email, url, money, phone…) that never depended on case.
 *   B. known     entities this owner ALREADY has in the world model, matched
 *                case-insensitively. Zero fabrication risk — the name was
 *                established elsewhere; we are only recognising it again.
 *                This is what makes the second mention of "aquiplex" work.
 *   C. declared  a deliberately narrow set of cues where the phrasing ITSELF
 *                asserts that a proper noun follows: "his name is X", "the
 *                co-founder of X", "works at X". Only these can introduce a
 *                NEW lowercase entity, because only these carry enough signal
 *                to be worth the false-positive risk.
 *
 * Pass C is the one that can invent things, so it is kept small on purpose.
 * "i am tired" must never yield an entity called "tired" — hence no bare
 * "i am X" cue, and hence the blocklist below.
 */
import { extractEntities } from '../../files/extractors.js';
import { SELF_KIND, SELF_LABEL } from '../identity/selfEntity.js';
import { hasSelfDeclaration } from './selfDeclaration.js';

/**
 * FIRST-PERSON SELF-DISCLOSURE (U1)
 * ---------------------------------
 * "I'm building the understanding engine" resolved to nothing, because every
 * pass above looks for a NAME and there is no name in that sentence. The
 * subject is the owner, and the owner had no way to be a subject. Measured
 * cost: a realistic 8-answer "getting to know you" conversation produced 0
 * entities and 0 facts.
 *
 * WHY THIS DOES NOT BREAK THE NEVER-FUSE INVARIANT
 * ------------------------------------------------
 * `selfEntity.js` registers the self node with NO norms, on purpose, so that
 * nothing can ever resolve into it BY NAME — otherwise learning the user is
 * called Priya would quietly fuse them with any other Priya.
 *
 * That invariant is about names. `I` / `my` is not a name; it is deixis, and
 * it means the speaker whoever they are. So resolution happens HERE, in the
 * conversation extractor, on the grammar of the sentence — never in idStore,
 * and never by registering a pronoun as an alias. A negative test pins that a
 * named person still cannot reach the self node.
 *
 * FIRST-PERSON SINGULAR ONLY
 * --------------------------
 * `we` and `our` are deliberately excluded. A group claim is not an individual
 * one: "we're building X" says the team builds X and leaves the speaker's own
 * role unstated. Attributing it to the owner anyway is exactly the quiet
 * inference that puts a wrong line on a summary card.
 *
 * The grammar itself lives in `selfDeclaration.js`, not here: conversationFacts
 * needs the identical rule and is a PURE builder pinned by a structural test
 * that it cannot reach a store. This module imports the entity extractor and
 * the self-entity constants, and selfEntity imports idStore — so importing it
 * would have put persistence back inside that pure builder. The test caught
 * exactly that, which is the reason to keep such tests. Re-exported here so
 * existing callers of this module keep working.
 */
export { isSelfDeclaration, hasSelfDeclaration } from './selfDeclaration.js';

/** Tokens that are never an entity on their own, whatever cue precedes them. */
const BLOCK = new Set((
  'a,an,the,and,or,but,my,your,his,her,its,our,their,me,him,them,us,i,you,he,she,it,we,they,' +
  'this,that,these,those,here,there,now,then,very,really,quite,so,too,also,just,still,not,no,' +
  'good,bad,great,fine,okay,ok,nice,tired,busy,happy,sad,angry,sure,right,wrong,better,worse,' +
  'is,are,was,were,be,been,being,am,do,does,did,have,has,had,will,would,can,could,should,' +
  'one,two,three,some,any,all,none,more,less,most,least,much,many,' +
  'today,tomorrow,yesterday,soon,later,always,never,sometimes,often,' +
  'brother,sister,mother,father,mom,dad,friend,wife,husband,son,daughter,cousin,uncle,aunt,' +
  'work,working,school,college,home,office,thing,things,stuff,person,people,guy,man,woman'
).split(','));

/**
 * Cues whose own wording promises a proper noun next.
 * Each entry: [type, regex with ONE capture group].
 */
const DECLARATION_CUES = [
  // "my brother's name is X" / "his name is X" / "named X" / "called X"
  ['name', /\b(?:(?:my|his|her|their|the)\s+(?:[a-z]+(?:'s)?\s+)?name\s+is|name\s+is|named|called)\s+([^.,;:!?()]{2,60})/gi],
  // "the co-founder of X" / "ceo of X" — the role phrase implies an org
  ['org',  /\b(?:co-?founder|founder|ceo|cto|coo|cfo|president|director|owner|head)\s+of\s+([^.,;:!?()]{2,60})/gi],
  // "works at X" / "employed by X"
  ['org',  /\b(?:works?|working|worked|employed|interning|interned)\s+(?:at|for|by)\s+([^.,;:!?()]{2,60})/gi],
  // "founded X" — deliberately the only bare-verb cue; "started X" and
  // "joined X" were considered and rejected as too loose ("started crying").
  ['org',  /\bfounded\s+([^.,;:!?()]{2,60})/gi],
];

/** Trailing filler that commonly rides along after a cue capture. */
const TRAILING_NOISE = /\s+(?:and|but|who|which|that|because|since|while|so|then|too|also)\b.*$/i;

/**
 * Clean one cue capture into an entity value, or null if it fails the bar.
 * Kept strict: a bad entity is worse than a missing one, because it becomes a
 * node other turns can attach facts to.
 */
function refineCapture(raw) {
  if (!raw) return null;

  let v = String(raw).trim().replace(TRAILING_NOISE, '').trim();
  // Drop a leading article — "the aquiplex team" → "aquiplex team".
  v = v.replace(/^(?:a|an|the)\s+/i, '').trim();
  if (!v) return null;

  // Proper nouns in speech are short. Beyond four tokens this is a clause.
  const tokens = v.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return null;

  // Every token must look like a word, not punctuation or a number blob.
  if (!tokens.every(t => /^[\p{L}][\p{L}\p{N}'’.-]*$/u.test(t))) return null;

  // Reject if ANY token is blocked. Requiring all-clear (rather than
  // majority) is what keeps "my brother" and "tired" out.
  if (tokens.some(t => BLOCK.has(t.toLowerCase().replace(/['’.]+$/, '')))) return null;

  const value = tokens.join(' ');
  return value.length >= 3 ? value : null;
}

/** Escape a known name for safe use inside a RegExp. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Entities for a conversational turn.
 *
 * @param {string} text                    user + assistant text for the turn
 * @param {object} opts
 * @param {Array}  opts.knownEntities      [{ value, type }] already in the world
 *                                         model for this owner (labels + aliases)
 * @param {number} opts.limit              hard cap on returned entities
 * @param {string} [opts.selfText]         the USER's message alone. Only this is
 *                                         examined for first-person disclosure —
 *                                         reading AQUA's own "I can help with…"
 *                                         as the user's self-description would
 *                                         manufacture evidence out of our own
 *                                         output. Omit to disable pass D.
 * @returns {Array<{type,value,count,source}>}
 */
export function extractConversationEntities(text, { knownEntities = [], limit = 40, selfText = null } = {}) {
  if (!text || typeof text !== 'string') return [];

  const found = new Map();          // `${type}:${lowercased}` → entity
  const add = (type, value, source) => {
    const v = String(value).trim();
    if (!v) return;
    const k = `${type}:${v.toLowerCase()}`;
    const existing = found.get(k);
    if (existing) { existing.count += 1; return; }
    found.set(k, { type, value: v, count: 1, source });
  };

  // ── Pass A — the shared document extractor, untouched ────────────────────
  for (const e of extractEntities(text, { limit })) {
    add(e.type, e.value, 'shared');
  }

  // ── Pass B — recognise what this owner already knows, ignoring case ──────
  const lower = text.toLowerCase();
  for (const known of knownEntities) {
    const name = String(known?.value ?? '').trim();
    if (name.length < 3) continue;
    const key = `${known.type ?? 'name'}:${name.toLowerCase()}`;
    if (found.has(key)) continue;
    // Word-boundary match so "ai" does not fire inside "aircraft".
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(name.toLowerCase())}(?:[^\\p{L}\\p{N}]|$)`, 'u');
    if (re.test(lower)) {
      // Emit the CANONICAL casing, not the user's lowercase rendering, so the
      // resolver merges this onto the existing node instead of forking one.
      add(known.type ?? 'name', name, 'known');
    }
  }

  // ── Pass C — declaration cues can introduce something new ────────────────
  for (const [type, re] of DECLARATION_CUES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const value = refineCapture(m[1]);
      if (!value) continue;
      // If a known entity already covers this, Pass B's canonical form wins.
      if (found.has(`${type}:${value.toLowerCase()}`)) continue;
      add(type, value, 'declared');
    }
  }

  // ── Pass D — the speaker, when they said something about themselves ──────
  // Emitted LAST so it can never displace a named entity out of the cap, and
  // marked `isSelf` so the caller routes it to the owner's existing self node
  // rather than resolving a new entity called "You".
  if (selfText && hasSelfDeclaration(selfText)) {
    found.set(`${SELF_KIND}:${SELF_LABEL.toLowerCase()}`, {
      type: SELF_KIND, value: SELF_LABEL, count: 1, source: 'self', isSelf: true,
    });
  }

  return [...found.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/**
 * Read the owner's existing entity names out of the world model, for Pass B.
 * Separated so the extractor itself stays pure and testable without a graph.
 */
export function knownEntitiesFor(G, ownerId, { limit = 500 } = {}) {
  if (!G?.nodesByType || !ownerId) return [];
  const out = [];
  try {
    for (const node of G.nodesByType(ownerId, 'entity')) {
      const label = String(node.label ?? '').trim();
      const type = node.data?.entityType ?? 'name';
      if (label.length >= 3) out.push({ value: label, type });
      for (const alias of node.data?.aliases ?? []) {
        const a = String(alias ?? '').trim();
        if (a.length >= 3) out.push({ value: a, type });
      }
      if (out.length >= limit) break;
    }
  } catch { /* fail-open: no known entities is a degraded pass, not an error */ }
  return out;
}
