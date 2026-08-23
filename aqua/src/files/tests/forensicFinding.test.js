/**
 * AQUA — `edited_number` fires on ordinary ledger rows
 * Blueprint: FINDING-1's bug, in a second engine
 *
 * FIX-6 left this open: *"identify the remaining superlinear FI-2 stage."*
 * Profiling at 600 → 1200 facts with all three stores purged:
 *
 *   rebuildGraph   77ms →  136ms   1.77×   ← linear since FIX-5
 *   getForensics  216ms →  992ms   4.60×   ← THE STAGE (4.43×, 2.92× on reruns)
 *   consensus       2ms →    8ms   4.70×   (2ms absolute — noise)
 *   gaps            1ms →    3ms   2.25×
 *
 * `edgesInspected` stayed 0 throughout, so it is not the graph. It is
 * `forensicEngine`'s `edited_number` rule.
 *
 * THE SAME BUG AS FINDING-1, IN A DIFFERENT ENGINE
 * ------------------------------------------------
 * The rule masks digits out of a statement and groups by the result:
 *
 *   "Item 0 for VendorCo recorded value 1000 on 2026-01-10"
 *      → "Item # for VendorCo recorded value # on #-#-#"
 *
 * **Every row of a ledger masks to the same key.** So one group holds all N
 * facts, the inner double loop is O(N²) — and every pair is emitted as
 * `severity: 'alert'`, explained to the user as *"the signature of a doctored
 * figure."*
 *
 * Measured: **20 ledger rows across two files produce 90 alerts.** The
 * truthful answer is zero. `Item 3 … 1003` and `Item 4 … 1004` are two
 * different line items, not a tampered one.
 *
 * This is precisely the failure FINDING-1 measured in the contradiction
 * detector — same shape, same cause, same per-item-table trigger. FIX-1's
 * subject gate fixed it there and was never applied here, because nobody knew
 * this rule existed.
 *
 * WHY IT IS NOT FIXED HERE
 * ------------------------
 * `differentSubjects` would almost certainly fix it, and that is exactly why
 * it should not be reached for casually: applying a gate validated against the
 * CONTRADICTION evals to a FORENSICS rule is assuming the two mean the same
 * thing by the same test.
 *
 * There is no forensics eval. FINDING-1's reasoning holds unchanged — a repair
 * that cannot be measured is a guess, and this rule has a severity of `alert`,
 * so a wrong guess is louder than most.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import * as ES from '../evidenceStore.js';
import * as US from '../ukoStore.js';
import * as G from '../../reasoning/reasoningGraph.js';
import * as pic from '../../pic/core.js';
import { createEvidence, createFact } from '../evidence.js';
import { createUKO } from '../uko.js';
import { rebuildOwnerGraph } from '../../reasoning/graphBuilder.js';

/** A per-item ledger split across files — an invoice, a price list, a export. */
function seedLedger(owner, { files = 2, rows = 10 } = {}) {
  ES.purgeOwner?.(owner); US.purgeOwner?.(owner); G.purgeOwner?.(owner);
  for (let f = 0; f < files; f++) {
    const id = `ledger${f}`;
    const u = createUKO({
      ownerId: owner,
      sourceFile: { name: `${id}.pdf`, ext: '.pdf', bytes: 1, hash: String(f).padEnd(64, 'x') },
      fileType: 'document',
    });
    u.id = id;
    US.saveUKO(u);
    for (let i = 0; i < rows; i++) {
      const st = `Item ${i} for VendorCo recorded value ${1000 + i} on 2026-0${(i % 6) + 1}-1${i % 9}`;
      const ev = ES.saveEvidence(owner, createEvidence({
        sourceFileId: id, sourceFileName: `${id}.pdf`, sourceType: 'document',
        extractionMethod: 'structural', location: { page: i }, snippet: st,
      }));
      ES.saveFact(owner, createFact({ statement: st, entities: ['VendorCo'], evidence: [ev] }),
        { sourceFileId: id });
    }
  }
  rebuildOwnerGraph({ evidenceStore: ES, ukoStore: US }, owner);
}

const editedNumber = (owner) =>
  (pic.getForensics(owner)?.findings ?? []).filter(f => f.type === 'edited_number');

describe('forensics — edited_number fires on ordinary ledger rows', () => {
  const OWNER = 'owner-forensic-finding';
  before(() => seedLedger(OWNER, { files: 2, rows: 10 }));

  test('OPEN: 20 unrelated ledger rows produce dozens of tampering alerts', () => {
    // The truthful answer is ZERO. "Item 3 … 1003" and "Item 4 … 1004" are two
    // different line items, and the user is told each pair is "the signature
    // of a doctored figure."
    const found = editedNumber(OWNER);
    assert.ok(found.length > 10,
      `${found.length} edited_number findings — someone fixed this, invert the test and close the finding`);
  });

  test('OPEN: they are severity ALERT, not a quiet hint', () => {
    // Why this is worse than the contradiction version: a false contradiction
    // is noise in a graph, a false `edited_number` accuses a document of being
    // tampered with.
    const [first] = editedNumber(OWNER);
    assert.equal(first.severity, 'alert');
    assert.match(first.explanation, /doctored figure/);
  });

  test('the pairs really are different ITEMS, not one altered value', () => {
    // Narrowing the claim rather than asserting it. Both statements name a
    // different Item index, so both are true at once.
    const [first] = editedNumber(OWNER);
    const [a, b] = first.statements;
    const idx = s => s.match(/^Item (\d+)/)?.[1];
    assert.notEqual(idx(a), idx(b), 'the pair really is the same item — re-read this finding');
  });

  test('OPEN: the finding count grows QUADRATICALLY with rows', () => {
    // Every row masks to the same key, so one group holds all N facts and the
    // inner loop is O(N²). This is the cost half, and it is why `getForensics`
    // was the last superlinear stage in the FI-2 pass.
    const small = 'owner-forensic-scale-6';
    const large = 'owner-forensic-scale-12';
    seedLedger(small, { files: 2, rows: 6 });
    const a = editedNumber(small).length;
    seedLedger(large, { files: 2, rows: 12 });
    const b = editedNumber(large).length;
    assert.ok(a > 0, 'nothing fired at the smaller size — the fixture stopped reproducing');
    assert.ok(b / a > 3,
      `findings grew ${(b / a).toFixed(1)}× when rows doubled — sub-quadratic now, close the finding`);
  });

  test('within ONE file it is silent — the trigger is cross-file, as in FINDING-1', () => {
    // The same narrowing that kept FINDING-1 honest.
    const solo = 'owner-forensic-onefile';
    seedLedger(solo, { files: 1, rows: 12 });
    assert.equal(editedNumber(solo).length, 0);
  });

  test('a REAL edited number is still caught — the rule is misaimed, not useless', () => {
    // Stated so the finding cannot be read as "delete this rule". The same
    // sentence with one figure changed, across two files, is exactly what it
    // is for.
    const owner = 'owner-forensic-genuine';
    ES.purgeOwner?.(owner); US.purgeOwner?.(owner); G.purgeOwner?.(owner);
    for (const [id, amount] of [['a.pdf', '4200000'], ['b.pdf', '9100000']]) {
      const u = createUKO({
        ownerId: owner,
        sourceFile: { name: id, ext: '.pdf', bytes: 1, hash: id.padEnd(64, 'x') },
        fileType: 'document',
      });
      u.id = id;
      US.saveUKO(u);
      const st = `Total contract value for VendorCo is ${amount} as agreed`;
      const ev = ES.saveEvidence(owner, createEvidence({
        sourceFileId: id, sourceFileName: id, sourceType: 'document',
        extractionMethod: 'structural', location: { page: 1 }, snippet: st,
      }));
      ES.saveFact(owner, createFact({ statement: st, entities: ['VendorCo'], evidence: [ev] }),
        { sourceFileId: id });
    }
    rebuildOwnerGraph({ evidenceStore: ES, ukoStore: US }, owner);
    assert.equal(editedNumber(owner).length, 1,
      'the genuine case stopped firing — a fix must not buy precision by losing this');
  });
});
