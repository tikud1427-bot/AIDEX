/**
 * Groq llama-3.1-8b-instant / llama-3.3-70b-versatile decommission (2026-08-16)
 *
 * Groq's own recommended replacements are openai/gpt-oss-20b (for the 8b
 * model) and openai/gpt-oss-120b (for the 70b model). This suite pins the
 * LEGACY engine (services/ai.client.js) side of that migration so a future
 * edit cannot quietly reintroduce either dead model as a built-in default:
 *
 *   1. MODEL_TINY / MODEL_DEFAULT / MODEL_STRONG resolve to the gpt-oss
 *      replacements when no environment override is set.
 *   2. GROQ_TINY_MODEL / GROQ_DEFAULT_MODEL / GROQ_STRONG_MODEL overrides
 *      still work — the migration must not have removed operator control.
 *   3. No source file that selects a Groq model contains a live (non-comment)
 *      string-literal reference to either decommissioned model ID.
 *
 * The MODERN engine's registry-level guarantees (registry excludes the dead
 * models entirely, candidate fallback never reaches them, streaming shares
 * the same candidate source) are covered in
 * aqua/src/providers/tests/modelRegistry.test.js — this file does not
 * duplicate those.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT_PATH = path.join(ROOT, 'services', 'ai.client.js');
const OVERRIDE_VARS = ['GROQ_TINY_MODEL', 'GROQ_DEFAULT_MODEL', 'GROQ_STRONG_MODEL'];

/**
 * services/ai.client.js reads process.env at module-load time, so exercising
 * different env states requires a genuinely fresh module instance each time
 * (require() alone would return the cached first load).
 */
function loadClientWithEnv(envOverrides = {}) {
  const saved = {};
  for (const k of OVERRIDE_VARS) {
    saved[k] = process.env[k];
    if (Object.prototype.hasOwnProperty.call(envOverrides, k)) {
      process.env[k] = envOverrides[k];
    } else {
      delete process.env[k];
    }
  }
  delete require.cache[require.resolve(CLIENT_PATH)];
  const mod = require(CLIENT_PATH);
  return {
    mod,
    restore() {
      for (const k of OVERRIDE_VARS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      delete require.cache[require.resolve(CLIENT_PATH)];
    },
  };
}

describe('legacy engine (services/ai.client.js) — Groq default models', () => {
  test('built-in defaults are the gpt-oss replacements', () => {
    const { mod, restore } = loadClientWithEnv();
    try {
      assert.equal(mod.MODEL_TINY, 'openai/gpt-oss-20b');
      assert.equal(mod.MODEL_DEFAULT, 'openai/gpt-oss-120b');
      assert.equal(mod.MODEL_STRONG, 'openai/gpt-oss-120b');
    } finally {
      restore();
    }
  });

  test('built-in defaults never resolve to a decommissioned Llama model', () => {
    const { mod, restore } = loadClientWithEnv();
    try {
      for (const dead of ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']) {
        assert.notEqual(mod.MODEL_TINY, dead);
        assert.notEqual(mod.MODEL_DEFAULT, dead);
        assert.notEqual(mod.MODEL_STRONG, dead);
      }
    } finally {
      restore();
    }
  });

  test('FAST_MODEL / SMART_MODEL back-compat exports track the new defaults', () => {
    const { mod, restore } = loadClientWithEnv();
    try {
      assert.equal(mod.FAST_MODEL, 'openai/gpt-oss-120b');
      assert.equal(mod.SMART_MODEL, 'openai/gpt-oss-120b');
    } finally {
      restore();
    }
  });

  test('GROQ_TINY_MODEL / GROQ_DEFAULT_MODEL / GROQ_STRONG_MODEL env overrides still work', () => {
    const { mod, restore } = loadClientWithEnv({
      GROQ_TINY_MODEL: 'operator-tiny-override',
      GROQ_DEFAULT_MODEL: 'operator-default-override',
      GROQ_STRONG_MODEL: 'operator-strong-override',
    });
    try {
      assert.equal(mod.MODEL_TINY, 'operator-tiny-override');
      assert.equal(mod.MODEL_DEFAULT, 'operator-default-override');
      assert.equal(mod.MODEL_STRONG, 'operator-strong-override');
    } finally {
      restore();
    }
  });
});

describe('Groq migration — no live reference to a decommissioned model remains', () => {
  const DEAD_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
  // Every file that is allowed to select a Groq model. OpenRouter model IDs
  // (e.g. meta-llama/llama-3.3-70b-instruct:free in services/ai.client.js)
  // are a different provider's catalog entirely and are deliberately out of
  // scope here — see the file's own comments for why they're preserved.
  const GROQ_SELECTING_FILES = [
    ['aqua', 'src', 'providers', 'modelRegistry.js'],
    ['aqua', 'src', 'providers', 'groq.js'],
    ['aqua', 'src', 'identity', 'data', 'models.json'],
    ['services', 'ai.client.js'],
  ];

  for (const rel of GROQ_SELECTING_FILES) {
    test(`${rel.join('/')} has no live (non-comment) reference to a decommissioned model`, () => {
      const filePath = path.join(ROOT, ...rel);
      const src = fs.readFileSync(filePath, 'utf8');
      for (const rawLine of src.split('\n')) {
        const line = rawLine.trim();
        const isComment = line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line === '';
        if (isComment) continue;
        for (const dead of DEAD_MODELS) {
          assert.ok(
            !line.includes(dead),
            `${rel.join('/')} has a live reference to decommissioned model "${dead}": "${line}"`,
          );
        }
      }
    });
  }
});
