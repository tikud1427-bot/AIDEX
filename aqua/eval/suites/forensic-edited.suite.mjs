/**
 * AQUA Eval — the forensics `edited_number` rule
 * Blueprint: the prerequisite FINDING-2 named
 *
 * FINDING-2 measured 90 alert-severity "doctored figure" findings from 20
 * ordinary ledger rows, and declined to fix it:
 *
 *   *"`differentSubjects` would almost certainly fix it — and that is exactly
 *   why it should not be reached for casually. Applying a gate validated
 *   against the CONTRADICTION evals to a FORENSICS rule assumes the two mean
 *   the same thing by the same test."*
 *
 * This is the test that stops it being an assumption.
 *
 * PRECISION MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS PROJECT
 * -------------------------------------------------------------
 * A false contradiction is noise in a graph. A false `edited_number` **accuses
 * a document of being tampered with**, at `severity: 'alert'`, in the surface
 * a user reads when they are already suspicious.
 *
 * So the set is weighted toward ordinary pairs (21 to 8) and precision and
 * recall are reported separately — never averaged. A single accuracy figure
 * over an unbalanced set would flatter a rule that flags everything, which is
 * the behaviour under investigation.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _looksEditedForTests } from '../../src/files/forensicEngine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = JSON.parse(readFileSync(path.join(HERE, '../datasets/forensic-edited.v1.json'), 'utf8'));

export default {
  id: 'forensic-edited',
  title: 'forensics — does `edited_number` only fire on edited numbers',
  about: [
    'Runs the textual half of the edited_number rule over 29 labelled pairs: 8 genuine',
    'alterations and 21 ordinary pairs, 16 of them the per-item-table shape FINDING-2 measured',
    'firing 90 times on 20 rows. Precision and recall reported separately — this rule accuses a',
    'document of tampering, so a false positive is louder than a missed one.',
  ].join('\n'),

  cases: DS.cases,

  async run(testCase) {
    return { status: 'ok', actual: { fired: _looksEditedForTests(testCase.a, testCase.b) } };
  },

  score(testCase, actual) {
    const shouldFire = testCase.label === 'edited';
    return { correct: actual.fired === shouldFire, cat: testCase.cat, shouldFire, fired: actual.fired };
  },

  metrics(scored) {
    const ratio = (a, b) => (b ? a / b : 0);
    const tp = scored.filter(s => s.shouldFire && s.fired).length;
    const fp = scored.filter(s => !s.shouldFire && s.fired).length;
    const fn = scored.filter(s => s.shouldFire && !s.fired).length;

    const byCat = {};
    for (const s of scored.filter(x => !x.shouldFire)) {
      byCat[s.cat] ??= { n: 0, fired: 0 };
      byCat[s.cat].n++;
      if (s.fired) byCat[s.cat].fired++;
    }

    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    return {
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      true_positives: tp,
      false_positives: fp,
      false_negatives: fn,
      ...Object.fromEntries(Object.entries(byCat).sort()
        .map(([cat, v]) => [`false_fire_${cat.replace(/-/g, '_')}`, ratio(v.fired, v.n)])),
      edited_pairs: scored.filter(s => s.shouldFire).length,
      ordinary_pairs: scored.filter(s => !s.shouldFire).length,
    };
  },
};
