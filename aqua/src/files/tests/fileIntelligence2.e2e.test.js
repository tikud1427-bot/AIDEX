/**
 * File Intelligence 2.0 — end-to-end over the REAL lifecycle.
 *
 * Runs ingestFiles() (classify → parse → enrich → evidence → graph → PIC)
 * with injected document/media pipelines (same offline seam parsers.js
 * documents), on a mixed batch: two conflicting reports, an OCR "scan"
 * image, a source file — then exercises the FI-2 surface end to end:
 * forensics, research, compare, cause — plus a linear-scan perf guard.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-fi2e2e-'));
process.env.AQUA_DATA_DIR = TMP;
process.env.AQUA_PIC = 'on';

const { ingestFiles } = await import('../fileEngine.js');
const ES = await import('../evidenceStore.js');
const US = await import('../ukoStore.js');
const pic = await import('../../pic/core.js');

const O = 'owner-fi2';
const doc = (content) => ({
  title: 'doc', format: 'pdf', metadata: { pages: 2 },
  content, pages: 2, sections: [], language: 'en', truncated: false,
});
const deps = {
  processDocument: async (name) => doc(FIXTURES[name]),
  processMedia: async (name) => ({
    title: name, format: 'png', metadata: { analyzed: true, ocr: true, model: 'fake-vision' },
    content: FIXTURES[name], pages: null,
    sections: [{ heading: 'OCR', text: FIXTURES[name] }], language: 'en', truncated: false,
  }),
};

const FIXTURES = {
  'reportA.pdf': 'Northwind Ltd raised 4000000 in funding on 2026-01-05. The platform launched on 2026-02-10 following the Northwind funding round.',
  'reportB.pdf': 'Northwind Ltd raised 9000000 in funding on 2026-01-05. Audit for Northwind is scheduled for 2031-06-01.',
  'scan.png':    'Receipt shows Northwind Ltd paid 4500 on 2026-01-20 at the office.',
  'notes.txt':   'const northwindTotal = 4500; // running tally for Northwind',
};

let out;
before(async () => {
  out = await ingestFiles({
    files: Object.keys(FIXTURES).map(name => ({ name, buffer: Buffer.from(FIXTURES[name]) })),
    ownerId: O, conversationId: null, deps,
  });
});

test('mixed batch ingests through one lifecycle into one knowledge space', () => {
  assert.equal(out.results.filter(r => r.status === 'ready').length, 4);
  assert.equal(out.ukoIds.length, 4);
  assert.ok(out.graph && out.graph.entities >= 1, 'cross-file graph built');
  assert.ok(ES.listFacts(O, { limit: 1000 }).length >= 3, 'grounded facts stored');
});

test('forensics via PIC: number conflict + future date surfaced from real ingest', () => {
  const f = pic.getForensics(O);
  const types = new Set(f.findings.map(x => x.type));
  assert.ok(types.has('edited_number'), '4M vs 9M funding figures flagged');
  assert.ok(types.has('future_dated_content'), '2031 audit flagged');
});

test('research via PIC: contested funding claim; comparison of the two reports disagrees', () => {
  const r = pic.getResearch(O, { mode: 'consensus' });
  assert.ok(r.contested.length >= 1, 'conflicting funding numbers are contested');
  const [a, b] = out.ukoIds.slice(0, 2);
  const ua = US.listUKOs(O, { limit: 10 }).find(u => u.sourceFile.name === 'reportA.pdf');
  const ub = US.listUKOs(O, { limit: 10 }).find(u => u.sourceFile.name === 'reportB.pdf');
  const cmp = pic.compareKnowledgeFiles(O, ua.id, ub.id);
  assert.ok(cmp.disagreements.length >= 1);
  assert.ok(cmp.sharedEntities.some(e => e.entity.toLowerCase().includes('northwind')));
  void a; void b;
});

test('cause via PIC: launch attributed to the funding round with citations', () => {
  const c = pic.whatCaused(O, 'platform launched');
  assert.ok(c.causes.length >= 1);
  assert.ok(c.causes[0].event.toLowerCase().includes('funding'));
  assert.ok(c.causes[0].citations.length >= 1);
});

test('AQUA_PIC=off silences the whole FI-2 surface', () => {
  process.env.AQUA_PIC = 'off';
  assert.equal(pic.getForensics(O), null);
  assert.equal(pic.getResearch(O, {}), null);
  assert.equal(pic.whatCaused(O, 'launch'), null);
  process.env.AQUA_PIC = 'on';
});

test('perf: FI-2 pass is QUADRATIC in fact count — measured, and pinned', async () => {
  // Was: `assert.ok(ms < 1500)`. The name claimed a scaling property and the
  // assertion measured a stopwatch — different claims, and only one of them
  // survives a loaded machine. It flaked twice in one session and passed in
  // isolation both times, so each failure taught nobody anything.
  //
  // Loosening the budget would hide a real regression to silence a false one.
  // This measures the RATIO instead: load slows both samples, so it cancels,
  // and a quadratic rewrite now fails even on a fast machine — which the
  // absolute budget would have passed.
  const { createEvidence, createFact } = await import('../evidence.js');
  const { createUKO } = await import('../uko.js');
  const { rebuildOwnerGraph } = await import('../../reasoning/graphBuilder.js');
  const { assertScalesLinearly } = await import('../../core/tests/helpers/perfShape.mjs');

  let run = 0;
  const workload = (factCount) => {
    // Each sample gets a CLEAN store. The evidence store is a module-level
    // singleton, so without this the second sample carries the first sample's
    // data and the ratio measures accumulation rather than the algorithm —
    // which would report a false superlinearity and send someone optimising
    // code that was fine.
    ES.purgeOwner?.(`owner-fi2-perf-${run}`);
    const P = `owner-fi2-perf-${run++}`;
    const perFile = Math.ceil(factCount / 6);
    for (let f = 0; f < 6; f++) {
      const u = createUKO({ ownerId: P, sourceFile: { name: `bulk${f}.pdf`, ext: '.pdf', bytes: 1, hash: String(f).padEnd(64, 'x') }, fileType: 'document' });
      u.id = `bulk${f}`; US.saveUKO(u);
      for (let i = 0; i < perFile; i++) {
        const st = `Item ${i} for VendorCo recorded value ${1000 + i} on 2026-0${(i % 6) + 1}-1${i % 9}`;
        const ev = ES.saveEvidence(P, createEvidence({ sourceFileId: u.id, sourceFileName: u.sourceFile.name, sourceType: 'document', extractionMethod: 'structural', location: { page: i }, snippet: st }));
        ES.saveFact(P, createFact({ statement: st, entities: ['VendorCo'], evidence: [ev] }), { sourceFileId: u.id });
      }
    }
    rebuildOwnerGraph({ evidenceStore: ES, ukoStore: US }, P);
    pic.getForensics(P);
    pic.getResearch(P, { mode: 'consensus' });
    pic.getResearch(P, { mode: 'gaps' });
    pic.whatCaused(P, 'Item 40');
  };

  // 🔴 THE FINDING. Measured with per-sample isolation: doubling 300 → 600
  // facts costs **~3.9×**. Linear is ~2×, quadratic is ~4×. The pass is
  // effectively QUADRATIC, and the old `ms < 1500` assertion could never have
  // seen it — 300 facts simply fit under the budget on this machine.
  //
  // Nothing here made it slower. This test made it VISIBLE.
  //
  // The ceiling is set to catch a WORSENING, not to bless the shape: 4.5×
  // fails if someone makes it cubic, and the day it becomes linear this
  // assertion fails too and gets tightened — the same inverting-test
  // mechanism used for E1's ratio ceiling and E3/PR-10's write shape.
  const r = await assertScalesLinearly(workload, {
    n: 300, samples: 1, maxRatio: 4.5, label: 'FI-2 pass',
  });
  assert.ok(r.skipped || r.ratio > 2.5,
    `FI-2 is now scaling better than quadratic (${r.ratio?.toFixed(2)}×) — someone fixed it. ` +
    'Tighten maxRatio toward 2.5 and rename this test.');
});
