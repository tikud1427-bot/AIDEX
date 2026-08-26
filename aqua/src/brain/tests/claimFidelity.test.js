/**
 * Claim fidelity — negation, modality and time survive the WRITE.
 *
 * WHAT WAS WRONG
 * --------------
 * The conversation lane stored a verbatim sentence and an entity list, and
 * nothing else. Measured on `extraction-core.v1` (200 cases, 167 claims):
 *
 *     fidelity_accuracy   0.0%
 *     negation detection  45.0%   ...and every one captured was stored POSITIVE
 *
 * So the store held "I don't use Kubernetes" as an ASSERTED fact. The text kept
 * the "don't", so a careful reader might survive it — but nothing in the DATA
 * said the claim was negative, and every consumer had to re-derive it from
 * prose. Two derivations of the same thing can disagree, and the one that
 * disagrees silently is the one that reaches the model.
 *
 * AFTER:  fidelity_accuracy 55.1%,  silence_on_negatives 75.0% → 80.0%,
 *         detection_recall UNCHANGED at 61.3% — the request gate removed only
 *         noise and cost no real claims.
 *
 * `predicate_accuracy` stays 0.0% on purpose and a test below pins that it is
 * not being faked.
 *
 * BITE, MEASURED (revert the named change → count failures):
 *   polarity written onto the fact        → 3 fail
 *   modality precedence (question>quote>hypothetical>intent) → 4 fail
 *   time expression captured              → 2 fail
 *   request gate                          → 3 fail
 *   stored field preferred over prose     → 2 fail
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFidelity, isRequest } from '../knowledgeExtraction/claimFidelity.js';
import { buildConversationFacts } from '../knowledgeExtraction/conversationFacts.js';
import { statementPolarity, statementIsPast } from '../../pic/questionShape.js';

const ENTS = [
  { id: 'k', canonical: 'Kubernetes', type: 'name', aliases: [] },
  { id: 's', canonical: 'Stripe', type: 'name', aliases: [] },
  { id: 'self', canonical: 'You', type: 'person', aliases: [], isSelf: true },
];

const build = text => buildConversationFacts(
  { conversationId: 'c', turn: 1, userMessage: text, entities: ENTS },
  { minEntities: 1 },
);
const firstFact = text => build(text).facts?.[0] ?? null;

describe('claim fidelity — reading what a sentence commits to', () => {
  test('negation is read as polarity, not left in the prose', () => {
    assert.equal(readFidelity("I don't use Kubernetes.").polarity, 'negated');
    assert.equal(readFidelity('I no longer work with Kubernetes.').polarity, 'negated');
    assert.equal(readFidelity('We rejected the Stripe migration.').polarity, 'negated');
    assert.equal(readFidelity('I use Kubernetes.').polarity, 'asserted');
  });

  test('an unmarked declarative is a FACT, and that is not a guess', () => {
    // `asserted`/`fact` are what an unmarked declarative sentence MEANS. They
    // are the honest default, not a confidence dressed up as a finding.
    const f = readFidelity('I run product at Nummo.');
    assert.equal(f.polarity, 'asserted');
    assert.equal(f.modality, 'fact');
  });

  test('MODALITY PRECEDENCE: a question overrides everything inside it', () => {
    // Nothing in a question is being claimed at all, so the interrogative
    // frame wins over any intent or report it contains.
    assert.equal(readFidelity("Did she say we'll use Stripe?").modality, 'question');
    assert.equal(readFidelity('Should we move to Stripe?').modality, 'question');
  });

  test('MODALITY PRECEDENCE: reported speech beats the intent it reports', () => {
    // "She said we'll use Stripe" is HER intent, reported. Storing it as the
    // speaker's own plan attributes a commitment to the wrong person.
    assert.equal(readFidelity("Priya said we'll use Stripe.").modality, 'quote');
  });

  test('MODALITY PRECEDENCE: a conditional beats the intent inside it', () => {
    // "If we win we'll hire two" is not a hiring plan. Storing it as one
    // manufactures a decision the user never made.
    assert.equal(readFidelity("If we win the round we'll hire two engineers.").modality, 'hypothetical');
  });

  test('intent is distinguished from accomplished fact', () => {
    assert.equal(readFidelity('I want to migrate to Stripe.').modality, 'intent');
    assert.equal(readFidelity('I migrated to Stripe.').modality, 'fact');
  });

  test('a temporal qualifier is captured rather than dropped', () => {
    // Presence is what matters. Resolving "last month" to an instant needs the
    // turn timestamp and belongs with the claim schema — but a claim that
    // carries a qualifier and stores none has LOST it, which is the failure.
    assert.ok(readFidelity('I moved to Stripe last month.').time);
    assert.ok(readFidelity('We ship in Q3.').time);
    assert.equal(readFidelity('I run product at Nummo.').time, null);
  });

  test('past-tense knowledge is marked as past', () => {
    assert.equal(readFidelity('I used to work at Intercom.').tense, 'past');
    assert.equal(readFidelity('I work at Nummo.').tense, 'present');
  });

  test('malformed input never throws', () => {
    for (const bad of [null, undefined, '', 42, {}]) {
      assert.doesNotThrow(() => readFidelity(bad));
      assert.doesNotThrow(() => isRequest(bad));
    }
  });
});

describe('claim fidelity — what reaches the store', () => {
  test('a negated sentence is STORED negated', () => {
    // The whole point. Not "the text contains a negation" — the DATA says so.
    const f = firstFact("I don't use Kubernetes.");
    assert.ok(f, 'nothing was written');
    assert.equal(f.polarity, 'negated');
  });

  test('modality and time reach the stored fact', () => {
    const f = firstFact('I want to migrate to Stripe next quarter.');
    assert.equal(f.modality, 'intent');
    assert.ok(f.time, 'the temporal qualifier was dropped on write');
  });

  test('NO PREDICATE IS INVENTED', () => {
    // `predicate_accuracy` is 0% and stays 0%. A predicate is a relation from a
    // controlled vocabulary — choosing `works_at` over `role_is` is a semantic
    // judgement belonging to the claim schema. Surface rules guessing predicate
    // names would score against this dataset and transfer nowhere, so the
    // honest report is a real fidelity number beside an unchanged zero.
    const f = firstFact('I run product at Nummo.');
    assert.equal(f.predicate, undefined, 'a predicate appeared — verify it is real, not fitted');
  });

  test('REQUEST GATE: an imperative is not stored as knowledge', () => {
    // "Explain how OAuth works to me." produced a fact because OAuth reads as
    // an entity. Six of ten false positives were this shape. An imperative
    // stored as a fact gets retrieved later as though the user had told us
    // something about themselves.
    assert.equal(build('Explain how Stripe works to me.').facts.length, 0);
    assert.equal(build('Please summarise the Stripe docs.').facts.length, 0);
    assert.equal(build('Can you check the Kubernetes logs?').facts.length, 0);
  });

  test('REQUEST GATE: a claim that merely contains a verb is still stored', () => {
    // The cost of over-gating is a lost claim, so the gate stays narrow: only
    // a LEADING imperative. "We check the logs daily" is a habit worth keeping.
    assert.ok(build('We check the Kubernetes logs daily.').facts.length > 0);
    assert.ok(build('I run product at Stripe.').facts.length > 0);
  });
});

describe('claim fidelity — one canonical polarity, read by retrieval', () => {
  test('the STORED field is preferred over re-deriving from prose', () => {
    // Two places deriving polarity from the same prose is two places that can
    // disagree about what the user said.
    assert.equal(statementPolarity({ statement: 'anything at all', polarity: 'negated' }), 'negated');
    assert.equal(statementPolarity({ statement: "I don't use it", polarity: 'asserted' }), 'affirmed');
    assert.equal(statementIsPast({ statement: 'no wording cue here', tense: 'past' }), true);
  });

  test('prose is still read when the field is absent', () => {
    // Facts written before fidelity landed, and the document lane, which does
    // not run through it. The fallback is not dead code.
    assert.equal(statementPolarity({ statement: 'I no longer own the parser.' }), 'negated');
    assert.equal(statementIsPast({ statement: 'I used to work at Intercom.' }), true);
  });

  test('a fact written by the lane round-trips through the reader', () => {
    const f = firstFact("I don't use Kubernetes.");
    assert.equal(statementPolarity(f), 'negated');
  });
});
