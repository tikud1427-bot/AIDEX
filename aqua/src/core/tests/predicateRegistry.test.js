/**
 * AQUA — the predicate registry
 * Blueprint E5/PR-2
 *
 * The vocabulary of claims: controlled, so `predicate_accuracy` can be
 * non-zero at all; open, because this project has fixed the closed-allowlist
 * pathology FOUR times (classifier task verbs, goal outcome verbs,
 * self-declaration verbs, TECH_TERMS) and a fifth is not interesting.
 *
 * The design is `reasoning/typeRegistry.js`, reused rather than reinvented —
 * a second vocabulary system with different rules is how "two of everything"
 * starts.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PREDICATE_CLASS, isRegistered, getPredicate, allPredicates, predicateNames,
  registerPredicate, ensurePredicate, inverseOf, objectKindOf,
  autoRegistered, _resetForTests,
} from '../claims/predicateRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

afterEach(() => {
  delete process.env.AQUA_CLAIM_STRICT_PREDICATES;
  _resetForTests();
});

// ── The seed set ─────────────────────────────────────────────────────────────

describe('predicate registry — the seed', () => {
  test('every predicate the eval dataset uses is registered', async () => {
    // If these diverged, the registry and the extraction baseline would be
    // measuring different vocabularies and `predicate_accuracy` would be
    // meaningless the moment E5/PR-3 starts writing claims.
    const { PREDICATES } = await import('../../../eval/datasets/schema.mjs');
    const missing = PREDICATES.filter(p => !isRegistered(p));
    assert.deepEqual(missing, [], 'the registry does not cover the eval dataset');
  });

  test('the predicates absent from the engine today are present here', () => {
    // decisions and tasks are named in the vision and unimplemented — the
    // extraction baseline scores them 53% on detection and 0% on predicate.
    for (const p of ['decided', 'rejected', 'plans_to', 'task_owner', 'has_status']) {
      assert.ok(isRegistered(p), `${p} is missing — E6 would have nowhere to put it`);
    }
  });

  test('every predicate has a class from the known set', () => {
    const classes = Object.values(PREDICATE_CLASS);
    for (const p of allPredicates()) {
      assert.ok(classes.includes(p.class), `${p.name} has class "${p.class}"`);
    }
  });

  test('every predicate declares which object column it expects', () => {
    // The claims table enforces exactly-one-object. This says WHICH one, so a
    // mis-shaped claim fails at write time rather than as a constraint
    // violation nobody can interpret.
    for (const p of allPredicates()) {
      assert.ok(['entity', 'literal', 'quantity', 'time'].includes(p.objectKind), p.name);
    }
  });

  test('names are sorted and unique', () => {
    const names = predicateNames();
    assert.deepEqual(names, [...names].sort());
    assert.equal(new Set(names).size, names.length);
  });
});

// ── Inverses ─────────────────────────────────────────────────────────────────

describe('predicate registry — inverses round-trip', () => {
  test('EVERY declared inverse exists and points back', () => {
    // `manages` ⇄ `reports_to`. A one-way inverse is worse than none: the
    // traversal works in one direction and silently returns nothing in the
    // other, which reads as missing data rather than a broken vocabulary.
    const broken = [];
    for (const p of allPredicates()) {
      if (!p.inverse) continue;
      const inv = getPredicate(p.inverse);
      if (!inv) { broken.push(`${p.name} → ${p.inverse} (missing)`); continue; }
      if (inv.inverse !== p.name) broken.push(`${p.name} → ${p.inverse} → ${inv.inverse}`);
    }
    assert.deepEqual(broken, []);
  });

  test('a symmetric predicate is its own inverse', () => {
    assert.equal(inverseOf('knows'), 'knows');
    assert.equal(getPredicate('knows').symmetric, true);
  });

  test('inverseOf is null for a predicate without one, not undefined', () => {
    assert.equal(inverseOf('habit_of'), null);
    assert.equal(inverseOf('no_such_predicate'), null);
  });

  test('an inverse pair agrees on object kind where both take entities', () => {
    // reports_to/manages both point at entities. A pair that disagreed would
    // make the reverse traversal produce a claim the schema refuses.
    for (const [a, b] of [['reports_to', 'manages'], ['member_of', 'has_member']]) {
      assert.equal(objectKindOf(a), objectKindOf(b), `${a}/${b} disagree`);
    }
  });
});

// ── Open, but noisily ────────────────────────────────────────────────────────

describe('predicate registry — open, and loud about it', () => {
  test('an unseen predicate is admitted', () => {
    // Closed allowlists have been the wrong answer four times in this project.
    assert.equal(isRegistered('mentors'), false);
    const p = ensurePredicate('mentors');
    assert.equal(p.name, 'mentors');
    assert.equal(p.source, 'auto');
    assert.ok(isRegistered('mentors'));
  });

  test('it is logged ONCE, not on every use', () => {
    // Silent admission would let works_at, work_at and worksat accumulate with
    // nobody noticing, and the vocabulary would stop meaning anything. Logging
    // every use would flood, and a flooding log gets filtered out.
    //
    // The once-ness comes from ensurePredicate's EARLY RETURN, not from a
    // separate Set. The first version of this module carried an `autoLogged`
    // Set copied from typeRegistry — where it is needed, because that module's
    // ensure() does not return early. Measuring bite proved it guarded nothing
    // here: mutating it changed no test because the line was already
    // unreachable. The Set is gone; this test now pins the property that
    // actually produces the behaviour.
    const seen = [];
    const original = console.log;
    console.log = (...a) => seen.push(a.join(' '));
    try {
      ensurePredicate('coaches');
      ensurePredicate('coaches');
      ensurePredicate('coaches');
    } finally { console.log = original; }
    assert.equal(seen.filter(l => l.includes('coaches')).length, 1);
  });

  test('auto-registered names are reportable — the drift list', () => {
    ensurePredicate('advises');
    ensurePredicate('sponsors');
    assert.deepEqual(autoRegistered(), ['advises', 'sponsors']);
  });

  test('a MALFORMED predicate always throws, strict mode or not', () => {
    // Not a vocabulary question. A predicate that cannot be a column value is
    // corruption, and admitting it would put unqueryable rows in the table.
    for (const bad of ['Works_At', 'works-at', '1works', 'a', '', 'x'.repeat(60), 'works at']) {
      assert.throws(() => ensurePredicate(bad), /malformed|must match/, `accepted "${bad}"`);
    }
  });
});

// ── Strict mode ──────────────────────────────────────────────────────────────

describe('predicate registry — strict mode', () => {
  test('AQUA_CLAIM_STRICT_PREDICATES=1 turns admission into a throw', () => {
    // For the eval harness and CI: a run that silently invented vocabulary
    // would report a predicate accuracy that means nothing.
    process.env.AQUA_CLAIM_STRICT_PREDICATES = '1';
    assert.throws(() => ensurePredicate('freeform'), /AQUA_CLAIM_STRICT_PREDICATES/);
    assert.equal(isRegistered('freeform'), false, 'the predicate was registered despite strict mode');
  });

  test('strict mode still allows KNOWN predicates', () => {
    process.env.AQUA_CLAIM_STRICT_PREDICATES = '1';
    assert.doesNotThrow(() => ensurePredicate('works_at'));
  });

  test('only the exact value "1" enables it', () => {
    for (const v of ['0', 'true', 'yes', 'on', '']) {
      process.env.AQUA_CLAIM_STRICT_PREDICATES = v;
      _resetForTests();
      assert.doesNotThrow(() => ensurePredicate('loose_one'), `"${v}" enabled strict mode`);
    }
  });

  test('the flag is read per call, so a test can set it without a reload', () => {
    _resetForTests();
    assert.doesNotThrow(() => ensurePredicate('before_strict'));
    process.env.AQUA_CLAIM_STRICT_PREDICATES = '1';
    assert.throws(() => ensurePredicate('after_strict'));
  });
});

// ── Explicit registration ────────────────────────────────────────────────────

describe('predicate registry — explicit registration', () => {
  test('a deliberate addition carries its metadata', () => {
    const p = registerPredicate('mentors', {
      class: PREDICATE_CLASS.RELATION, objectKind: 'entity', inverse: 'mentored_by',
    });
    assert.equal(p.class, PREDICATE_CLASS.RELATION);
    assert.equal(p.source, 'explicit');
    assert.equal(inverseOf('mentors'), 'mentored_by');
  });

  test('an unknown class or object kind is refused', () => {
    assert.throws(() => registerPredicate('x_pred', { class: 'vibes' }), /unknown class/);
    assert.throws(() => registerPredicate('y_pred', { objectKind: 'blob' }), /unknown objectKind/);
  });

  test('a malformed name is refused with the rule in the message', () => {
    assert.throws(() => registerPredicate('Bad-Name'), /lower snake_case/);
  });

  test('entries are frozen — a consumer cannot mutate the vocabulary in place', () => {
    const p = getPredicate('works_at');
    assert.throws(() => { p.class = 'hacked'; }, TypeError);
  });
});

// ── Inertness ────────────────────────────────────────────────────────────────

describe('predicate registry — nothing uses it yet', () => {
  test('only the claim repository imports it', () => {
    // E5/PR-2 asserted nothing imported it; E5/PR-3's repository must, to
    // resolve objectKind before a write. Red battery first, then a deliberate
    // entry — the guard working exactly as intended.
    const ALLOWED = ['src/core/claims/claimRepository.js', 'src/core/claims/backfill.js',
      'src/core/claims/projection.js'];
    const offenders = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === 'tests' || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(m?js|cjs)$/.test(name)) continue;
        if (full.endsWith(path.join('claims', 'predicateRegistry.js'))) continue;
        if (/predicateRegistry/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    const undeclared = offenders.filter(f => !ALLOWED.includes(f.split(path.sep).join('/')));
    assert.deepEqual(undeclared, [], 'a new module uses the registry — make that deliberate');
  });

  test('it reuses the typeRegistry design rather than inventing a second one', () => {
    // Same four properties: seeded, auto-register-with-log, classed,
    // strict-mode pin. Divergence here would mean two vocabulary systems with
    // different rules, which is exactly the "two of everything" the audit
    // criticised.
    const src = fs.readFileSync(path.join(ROOT, 'src/core/claims/predicateRegistry.js'), 'utf8');
    for (const property of ['strictMode', 'PREDICATE_CLASS', 'source: \'seed\'']) {
      assert.ok(src.includes(property), `missing the ${property} property from typeRegistry`);
    }
  });
});
