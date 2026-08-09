/**
 * AQUA Eval — retrieval quality
 * Blueprint E2/PR-5
 *
 * WHAT IS MEASURED, AND WHY EACH ONE
 * ----------------------------------
 *   recall@k        did the right fact come back at all, within k?
 *   MRR             how far down was it?
 *   nDCG@k          graded — relevant (2) beats acceptable (1) beats noise (0)
 *   top1_kind       is the top hit the KIND of thing asked for? A "where"
 *                   question answered with a churn number is wrong even when
 *                   the fact is about the right person
 *   noise_rate      lines returned for queries that should return NOTHING
 *   unknown_honesty the share of unanswerable queries answered with silence
 *
 * NOISE AND HONESTY ARE NOT FOLDED INTO AN AVERAGE
 * ------------------------------------------------
 * An engine that returns everything scores perfect recall. Averaging silence
 * into a single figure hides exactly the failure this dataset was built from:
 * seven of nine noise lines in the rollout harness came from one query that
 * merely contained the word "you". They are reported separately, always.
 *
 * ONE WORLD, SEEDED ONCE
 * ----------------------
 * The corpus is built into a real world model before the first query and left
 * alone. Re-seeding per query would measure a cold store 200 times and would
 * not resemble any real owner.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { seedWorld, retrieveWithCurrentEngine } from '../adapters/currentRetrieval.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../datasets/retrieval-core.v1.json'), 'utf8'));
const OWNER = 'user:eval-retrieval';
const K = 8;

/** Which kind of answer each corpus fact can serve. Derived once, from the corpus. */
const KIND_OF = new Map(DS.corpus.map(f => {
  const t = f.statement.toLowerCase();
  let kind = 'thing';
  if (/\b(in|at|to|based|office|moved)\b/.test(t) && /\b(bangalore|guwahati|delhi|pune|office)\b/.test(t)) kind = 'place';
  else if (/\b(20\d\d|january|march|june|july|september|november|monday|thursday|friday|q2|quarter|months)\b/.test(t)) kind = 'time';
  else if (f.entities.some(e => /^(Priya|Dev|Chhanda|Rahul|Sam|Karan|Meera|Neha|Farah)$/.test(e))) kind = 'person';
  else if (f.entities.some(e => /^(Nummo|Aquiplex|Intercom|Groq)$/.test(e))) kind = 'org';
  else if (/\b(i run|i lead|head of|manages|co-founded)\b/.test(t)) kind = 'role';
  return [f.id, kind];
}));

let seeded = false;

export default {
  id: 'retrieval-core',
  title: 'retrieval quality — current engine vs relevance labels',
  about: [
    'Seeds a 60-fact world with the same node and edge shapes conversationIngest writes,',
    'then asks 200 labelled queries through pic/core retrieveKnowledge — the exact facade',
    'the chat spine calls. Reports recall@8, MRR, nDCG@8, top-1 answer KIND, and — kept',
    'deliberately separate from every average — the noise rate and unknown-honesty on the',
    '32 queries whose only correct answer is silence.',
  ].join('\n'),

  cases: DS.queries,

  async run(testCase) {
    if (!seeded) { await seedWorld(OWNER, DS.corpus); seeded = true; }
    const r = await retrieveWithCurrentEngine(OWNER, testCase.q, { limit: K });
    return { status: 'ok', actual: { ranked: r.ranked } };
  },

  score(testCase, actual) {
    const ranked = actual.ranked.slice(0, K);
    const rel = new Set(testCase.relevant);
    const acc = new Set(testCase.acceptable);
    const expectsSilence = rel.size === 0;

    if (expectsSilence) {
      return {
        correct: ranked.length === 0,
        cat: testCase.cat, silence: true,
        returned: ranked.length,
      };
    }

    const firstHit = ranked.findIndex(id => rel.has(id));
    const gains = ranked.map(id => (rel.has(id) ? 2 : acc.has(id) ? 1 : 0));
    const dcg = gains.reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
    const ideal = [...Array(rel.size).fill(2), ...Array(acc.size).fill(1)]
      .slice(0, K)
      .reduce((s, g, i) => s + g / Math.log2(i + 2), 0);

    const top = ranked[0] ?? null;
    return {
      correct: firstHit === 0,                    // strictest: the answer is FIRST
      cat: testCase.cat,
      silence: false,
      hit: firstHit >= 0,
      rr: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
      ndcg: ideal > 0 ? dcg / ideal : 0,
      recalled: ranked.filter(id => rel.has(id)).length,
      relevantTotal: rel.size,
      kindOk: top ? KIND_OF.get(top) === testCase.kind : false,
      returned: ranked.length,
    };
  },

  metrics(scored) {
    const answerable = scored.filter(s => !s.silence);
    const silent = scored.filter(s => s.silence);
    const ratio = (a, b) => (b ? a / b : 0);

    const byCat = {};
    for (const s of answerable) {
      byCat[s.cat] ??= { n: 0, hit: 0 };
      byCat[s.cat].n++;
      if (s.hit) byCat[s.cat].hit++;
    }

    return {
      // answerable queries
      [`recall_at_${K}`]: ratio(answerable.filter(s => s.hit).length, answerable.length),
      mrr: ratio(answerable.reduce((n, s) => n + s.rr, 0), answerable.length),
      [`ndcg_at_${K}`]: ratio(answerable.reduce((n, s) => n + s.ndcg, 0), answerable.length),
      top1_correct: ratio(answerable.filter(s => s.correct).length, answerable.length),
      top1_kind: ratio(answerable.filter(s => s.kindOk).length, answerable.length),

      // silence — reported separately so it can never hide inside an average
      unknown_honesty: ratio(silent.filter(s => s.correct).length, silent.length),
      noise_lines: silent.reduce((n, s) => n + s.returned, 0),
      noisy_queries: silent.filter(s => s.returned > 0).length,

      // per-category recall — where the failures actually are
      ...Object.fromEntries(Object.entries(byCat).sort()
        .map(([cat, v]) => [`recall_${cat}`, ratio(v.hit, v.n)])),

      answerable_queries: answerable.length,
      silence_queries: silent.length,
    };
  },
};
