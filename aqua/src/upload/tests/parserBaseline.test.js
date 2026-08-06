/**
 * AQUA Parser Baseline — archive + document-pipeline characterization
 * Blueprint E1/PR-1
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * `adm-zip` was bumped to 0.6.0 and put behind zipGuard in E1/PR-3. Six code
 * paths depend on it, and before PR-1 none of them had a test that could tell
 * "the new library reads this differently" from "the fixture changed".
 *
 * These tests are CHARACTERIZATION tests, not correctness tests. They assert
 * what the code does TODAY, byte-for-byte, against fixtures that cannot move.
 * Some of what they pin is imperfect — see the "observed quirks" block below.
 * That is deliberate: a characterization suite that quietly fixes things on
 * the way past is useless as a parity oracle.
 *
 * The contract for every later PR in E1:
 *   golden.json must not change unless the PR intends to change behaviour,
 *   and then the diff is the thing the reviewer signs off on.
 *
 * Fixtures are built by scripts/build-parser-fixtures.mjs with ZERO
 * third-party dependencies — the existing parser suite builds its fixtures
 * with adm-zip and SheetJS, which is exactly why it cannot prove parity when
 * those libraries are swapped.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFixtures, manifestFor, buildTar, sha256, normalizeForGolden, SPEC_VERSION,
} from '../../../scripts/build-parser-fixtures.mjs';
import { extractArchive, parseTar } from '../archiveExtractor.js';
import { processDocument } from '../documentPipeline.js';
import { extractZip } from '../../project/fileIngester.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const bytes = name => readFileSync(path.join(FIXTURES, name));
const json = name => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

const manifest = json('manifest.json');
const golden = json('golden.json');

// ── Fixture integrity ─────────────────────────────────────────────────────────

describe('parser fixtures — integrity', () => {
  test('manifest spec version matches the builder', () => {
    assert.equal(manifest.specVersion, SPEC_VERSION);
    assert.equal(golden.specVersion, SPEC_VERSION);
  });

  test('every committed fixture matches its recorded sha256', () => {
    const names = Object.keys(manifest.files);
    assert.ok(names.length >= 10, `expected the full fixture set, found ${names.length}`);
    for (const name of names) {
      const entry = manifest.files[name];
      const onDisk = bytes(name);
      assert.equal(onDisk.length, entry.bytes, `${name} byte length drifted`);
      assert.equal(sha256(onDisk), entry.sha256, `${name} content drifted from the manifest`);
    }
  });

  test('the builder still reproduces the committed bytes exactly', () => {
    // The strongest guard available: it proves the fixtures on disk are
    // precisely what the spec produces, AND that the builder is deterministic.
    // Compressed fixtures are exempt because DEFLATE/GZIP output belongs to the
    // zlib of the running Node build, not to us — declared, not hidden.
    const rebuilt = buildFixtures();
    for (const [name, f] of rebuilt) {
      if (f.zlibDependent) continue;
      assert.deepEqual(f.bytes, bytes(name), `${name} is not reproducible from the builder`);
    }
  });

  test('manifest is a faithful description of the rebuilt set', () => {
    assert.deepEqual(manifestFor(buildFixtures()).files, manifest.files);
  });

  test('every fixture is documented', () => {
    for (const [name, entry] of Object.entries(manifest.files)) {
      assert.ok(entry.note && entry.note.length > 20, `${name} has no usable note`);
    }
  });
});

// ── archiveExtractor — the adm-zip path and its two hand-rolled siblings ──────

describe('archiveExtractor — frozen output', () => {
  test('ZIP extraction matches the golden exactly', async () => {
    const actual = normalizeForGolden(await extractArchive(bytes('project.zip'), 'zip'));
    assert.deepStrictEqual(actual, golden['archiveExtractor.zip']);
  });

  test('TAR extraction matches the golden exactly', async () => {
    const actual = normalizeForGolden(await extractArchive(bytes('project.tar'), 'tar'));
    assert.deepStrictEqual(actual, golden['archiveExtractor.tar']);
  });

  test('TAR.GZ extraction matches the golden exactly', async () => {
    const actual = normalizeForGolden(await extractArchive(bytes('project.tar.gz'), 'tar.gz'));
    assert.deepStrictEqual(actual, golden['archiveExtractor.tar.gz']);
  });

  test('all three formats agree with each other on the same logical tree', async () => {
    // Cross-format equality is the invariant the module header claims
    // ("downstream ingestion is IDENTICAL regardless of archive format").
    // Pinning it here means a swap that breaks only one format is caught.
    const zip = normalizeForGolden(await extractArchive(bytes('project.zip'), 'zip'));
    const tar = normalizeForGolden(await extractArchive(bytes('project.tar'), 'tar'));
    const tgz = normalizeForGolden(await extractArchive(bytes('project.tar.gz'), 'tar.gz'));
    assert.deepStrictEqual(tar, zip);
    assert.deepStrictEqual(tgz, zip);
  });
});

describe('archiveExtractor — security-relevant behaviour', () => {
  test('rejects a ../ traversal entry rather than writing outside the root', async () => {
    const files = await extractArchive(bytes('project.zip'), 'zip');
    assert.ok(!files.some(f => f.path.includes('..')), 'zip-slip entry survived extraction');
    assert.ok(!files.some(f => f.path.endsWith('escape.txt')), 'traversal payload was extracted');
  });

  test('applies ignore rules to node_modules and .git', async () => {
    const files = await extractArchive(bytes('project.zip'), 'zip');
    assert.ok(!files.some(f => f.path.startsWith('node_modules/')));
    assert.ok(!files.some(f => f.path.startsWith('.git/')));
  });

  test('carries nested binary documents through as base64, not mangled utf8', async () => {
    const files = await extractArchive(bytes('project.zip'), 'zip');
    const deck = files.find(f => f.path === 'docs/deck.pptx');
    assert.equal(deck.encoding, 'base64');
    assert.deepEqual(Buffer.from(deck.content, 'base64'), bytes('sample.pptx'));
  });

  test('refuses a password-protected archive with a clear message', async () => {
    await assert.rejects(
      () => extractArchive(bytes('encrypted.zip'), 'zip'),
      /password-protected/i,
    );
  });

  test('GAP CLOSED IN E1/PR-3: a high-ratio archive is refused', async () => {
    // PR-1 committed the INVERSE of this assertion under the name
    // "BASELINE GAP: no compression-ratio ceiling exists today" — the archive
    // extracted ~1000:1 without complaint, and the test said so out loud.
    // PR-3 added the ceiling. The inversion is the proof it works; a commit
    // message claiming it would not have been.
    await assert.rejects(() => extractArchive(bytes('highratio.zip'), 'zip'), err => {
      assert.equal(err.name, 'ZipGuardError');
      assert.equal(err.limit, 'ratio');
      assert.ok(err.observed > 200, `expected a bomb-scale ratio, got ${err.observed}`);
      return true;
    });
  });

  test('the ceiling is what refuses it — the same bytes stored uncompressed pass', async () => {
    // Guards against the lazy version of this fix: refusing the fixture for
    // some unrelated reason (size, entry count) would look identical from the
    // outside. Same payload, no compression, must still extract.
    const { buildZip } = await import('../../../scripts/build-parser-fixtures.mjs');
    const stored = buildZip([{ name: 'bulk/data.txt', data: Buffer.alloc(1_048_576, 0x41) }]);
    const files = await extractArchive(stored, 'zip');
    assert.equal(files.length, 1);
    assert.equal(files[0].content.length, 1_048_576);
  });

  test('rejects an unsupported format name', async () => {
    await assert.rejects(() => extractArchive(Buffer.from('x'), 'rar'), /Unsupported archive format/);
  });

  test('rejects a corrupt ZIP instead of returning partial results', async () => {
    await assert.rejects(() => extractArchive(Buffer.from('not a zip at all'), 'zip'));
  });
});

describe('parseTar — hand-rolled reader, unaffected by the adm-zip swap', () => {
  test('reads the frozen tar into named entries', () => {
    const entries = parseTar(bytes('project.tar'));
    assert.deepEqual(entries.map(e => e.name), [
      'README.md', 'src/app.js', 'src/util.js',
      'node_modules/left-pad/index.js', '.git/config',
      'docs/deck.pptx', '../escape.txt',
    ]);
  });

  test('throws on a truncated archive rather than returning what it managed to read', () => {
    // Cut mid-entry-DATA, not mid-header: a cut on a block boundary is
    // indistinguishable from a well-formed short archive and must NOT throw.
    // Built here rather than sliced from a fixture so the offset stays correct
    // if fixture content ever changes.
    const tar = buildTar([{ name: 'a.txt', data: 'x'.repeat(600) }]); // data spans 512..1112
    assert.throws(() => parseTar(tar.subarray(0, 900)), /Truncated TAR/);
  });

  test('a cut on a block boundary returns the complete entries, no throw', () => {
    // The end-of-archive zero blocks are missing here, so the loop simply runs
    // out of buffer. That is NOT corruption and must not be reported as such —
    // the throw is reserved for an entry whose declared data runs off the end.
    const tar = buildTar([{ name: 'a.txt', data: 'x'.repeat(100) }]); // data 512..612, padded to 1024
    assert.deepEqual(parseTar(tar.subarray(0, 1024)).map(e => e.name), ['a.txt']);
  });
});

// ── documentPipeline — ODT and EPUB both read through adm-zip ─────────────────

describe('documentPipeline — frozen output', () => {
  test('ODT processing matches the golden exactly', async () => {
    const actual = normalizeForGolden(await processDocument('notes.odt', bytes('sample.odt')));
    assert.deepStrictEqual(actual, golden['documentPipeline.odt']);
  });

  test('EPUB processing matches the golden exactly', async () => {
    const actual = normalizeForGolden(await processDocument('book.epub', bytes('sample.epub')));
    assert.deepStrictEqual(actual, golden['documentPipeline.epub']);
  });

  test('ODT title comes from meta.xml, not the filename', async () => {
    const doc = await processDocument('notes.odt', bytes('sample.odt'));
    assert.equal(doc.title, 'Quarterly Notes');
  });

  test('EPUB follows spine order and skips non-XHTML spine items', async () => {
    const doc = await processDocument('book.epub', bytes('sample.epub'));
    assert.equal(doc.metadata.chapters, 2, 'the cover.png spine item must not become a chapter');
    assert.ok(doc.content.indexOf('Chapter One') < doc.content.indexOf('Chapter Two'));
  });

  test('rejects an ODT with no content.xml', async () => {
    await assert.rejects(
      () => processDocument('broken.odt', bytes('sample.epub')),
      /content\.xml missing/,
    );
  });
});

// ── fileIngester.extractZip — the second, older adm-zip entry point ───────────

describe('fileIngester.extractZip — frozen output', () => {
  test('matches the golden exactly', async () => {
    const actual = normalizeForGolden(await extractZip(bytes('project.zip').toString('base64')));
    assert.deepStrictEqual(actual, golden['fileIngester.extractZip']);
  });

  test('agrees with extractArchive on the same bytes', async () => {
    // Two independent implementations of "read this ZIP" ship today. They must
    // not diverge under the E1/PR-3 swap; if they do, this fails before users
    // see two different results for the same upload.
    const viaIngester = normalizeForGolden(await extractZip(bytes('project.zip').toString('base64')));
    const viaArchive = normalizeForGolden(await extractArchive(bytes('project.zip'), 'zip'));
    assert.deepStrictEqual(viaIngester, viaArchive);
  });
});
