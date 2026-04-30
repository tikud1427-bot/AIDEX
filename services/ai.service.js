/**
 * services/ai.service.js — Aquiplex AI Site Builder [v3]
 *
 * Standalone AI generation service (used by routes that don't go through workspace.service.js).
 *
 * UPGRADES v3:
 * - FREE MODEL STACK ONLY — no paid models
 * - OpenRouter: deepseek/deepseek-chat (primary), mistralai/mixtral-8x7b-instruct (creative)
 * - Groq: llama-3.3-70b-versatile (secondary), mixtral-8x7b-32768 (fallback)
 * - Priority order: deepseek → llama-3.3-70b → mixtral (both providers)
 * - Smart waterfall: tries each model in priority order
 * - Per-provider timeout via AbortController
 * - Exponential backoff retry (up to MAX_RETRIES per provider)
 * - Strict JSON validation + sanitization
 * - Returns null on failure — caller handles fallback
 */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS      = 45_000;
const MAX_RETRIES     = 2;
const RETRY_BASE_MS   = 600; // 600 → 1200 → 2400 ms

// ─────────────────────────────────────────────────────────────────────────────
// Provider definitions
// ─────────────────────────────────────────────────────────────────────────────

function buildProviders() {
  const providers = [];

  // ── OpenRouter (primary) ───────────────────────────────────────────────────
  // Priority: deepseek (structure/coding) → mixtral (creative/UI)
  if (process.env.OPENROUTER_API_KEY) {
    const orHeaders = {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type":  "application/json",
      "HTTP-Referer":  process.env.OPENROUTER_REFERER || "https://aquiplex.com",
      "X-Title":       "Aquiplex",
    };

    providers.push(
      {
        id:      "openrouter:deepseek-chat",
        url:     "https://openrouter.ai/api/v1/chat/completions",
        headers: orHeaders,
        body:    (msgs) => ({ model: "deepseek/deepseek-chat", messages: msgs, temperature: 0.3, max_tokens: 8192 }),
      },
      {
        id:      "openrouter:mixtral-8x7b",
        url:     "https://openrouter.ai/api/v1/chat/completions",
        headers: orHeaders,
        body:    (msgs) => ({ model: "mistralai/mixtral-8x7b-instruct", messages: msgs, temperature: 0.4, max_tokens: 8192 }),
      }
    );
  }

  // ── Groq (secondary) ──────────────────────────────────────────────────────
  // Priority: llama-3.3-70b (general/reliable) → mixtral (fallback)
  if (process.env.GROQ_API_KEY) {
    const groqHeaders = {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type":  "application/json",
    };

    providers.push(
      {
        id:      "groq:llama-3.3-70b",
        url:     "https://api.groq.com/openai/v1/chat/completions",
        headers: groqHeaders,
        body:    (msgs) => ({ model: "llama-3.3-70b-versatile", messages: msgs, temperature: 0.4, max_tokens: 8000 }),
      },
      {
        id:      "groq:mixtral-8x7b",
        url:     "https://api.groq.com/openai/v1/chat/completions",
        headers: groqHeaders,
        body:    (msgs) => ({ model: "mixtral-8x7b-32768", messages: msgs, temperature: 0.4, max_tokens: 8000 }),
      }
    );
  }

  // ── Gemini (last resort) ───────────────────────────────────────────────────
  if (process.env.Gemini_API_Key || process.env.GEMINI_API_KEY) {
    providers.push({
      id:       "gemini:flash",
      url:      null, // handled specially
      headers:  null,
      body:     null,
      isGemini: true,
    });
  }

  return providers;
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert web developer. Generate complete, production-quality websites.

CRITICAL RULES — if you break any, the output is discarded:
1. Respond ONLY with a valid JSON object. NO prose, NO markdown, NO code fences.
2. The JSON must match EXACTLY this schema:
   {
     "files": {
       "index.html": "full HTML here",
       "style.css": "full CSS here",
       "script.js": "full JS here"
     }
   }
3. Always include at minimum: index.html and style.css
4. Use modern HTML5, CSS3 (flexbox/grid), vanilla JS only
5. Make it visually stunning — real gradients, animations, professional typography
6. ALL CSS in style.css (linked from index.html). ALL JS in script.js (linked from index.html)
7. index.html must link: <link rel="stylesheet" href="style.css">
8. index.html must link: <script src="script.js"></script> (only if JS needed)
9. NO external CDN dependencies — Google Fonts via @import in CSS only
10. Content must be realistic, detailed — NO placeholder text like "Lorem ipsum"
11. JSON keys in "files" must be EXACTLY the filename strings (e.g. "index.html")
12. Escape all double quotes inside file content as \\"`;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, init, timeoutMs = TIMEOUT_MS) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Call a single provider with retries
// Returns raw string content or null
// ─────────────────────────────────────────────────────────────────────────────

async function callProviderWithRetry(provider, messages) {
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const text = await _callProvider(provider, messages);
      if (text) return text;
    } catch (err) {
      lastErr = err;
      const reason = err.name === "AbortError" ? "timeout" : err.message;
      console.warn(`[AI Service] ${provider.id} attempt ${attempt} failed: ${reason}`);
      if (attempt <= MAX_RETRIES && err.name !== "AbortError") {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }
  }

  console.warn(`[AI Service] ${provider.id} exhausted after ${MAX_RETRIES + 1} attempts. Last: ${lastErr?.message}`);
  return null;
}

async function _callProvider(provider, messages) {
  // ── Gemini special path ──
  if (provider.isGemini) {
    return await _callGemini(messages);
  }

  const res = await fetchWithTimeout(provider.url, {
    method:  "POST",
    headers: provider.headers,
    body:    JSON.stringify(provider.body(messages)),
  });

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    const err  = new Error(`Auth/bad-request HTTP ${res.status}: ${text.slice(0, 100)}`);
    err._fatal = true; // don't retry auth errors
    throw err;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  let data;
  try { data = await res.json(); }
  catch { throw new Error("Non-JSON response"); }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string" || content.trim().length < 20) {
    throw new Error("Empty or unusable response content");
  }
  return content;
}

async function _callGemini(messages) {
  const key = process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
  if (!key) return null;

  const combinedText = messages.map(m => m.content).join("\n\n");

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contents:         [{ role: "user", parts: [{ text: combinedText }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);

  let data;
  try { data = await res.json(); }
  catch { throw new Error("Gemini non-JSON response"); }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON extraction — handles fences, leading/trailing prose
// ─────────────────────────────────────────────────────────────────────────────

function extractJSON(raw) {
  if (!raw || typeof raw !== "string") return null;

  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end   = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate parsed output
// ─────────────────────────────────────────────────────────────────────────────

function isValidOutput(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (!parsed.files || typeof parsed.files !== "object") return false;
  if (Array.isArray(parsed.files)) return false;

  const files = parsed.files;
  if (Object.keys(files).length === 0) return false;
  if (!files["index.html"] || typeof files["index.html"] !== "string") return false;
  if (files["index.html"].trim().length < 50) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitize
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeOutput(parsed) {
  const result = { files: {} };

  for (const [filename, content] of Object.entries(parsed.files)) {
    if (typeof content !== "string") continue;
    result.files[filename] = content.replace(/\r\n/g, "\n").trim();
  }

  if (!result.files["index.html"]) return null;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: generateWebsiteFiles(prompt)
// Returns { files: { "index.html": "...", ... } } or null
// ─────────────────────────────────────────────────────────────────────────────

async function generateWebsiteFiles(prompt) {
  const userPrompt = `Build this website: ${prompt}

IMPORTANT: Respond with ONLY the JSON object. No text before or after the JSON. No markdown code fences.`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: userPrompt },
  ];

  const providers = buildProviders();

  if (providers.length === 0) {
    console.error("[AI Service] No API keys configured");
    return null;
  }

  for (const provider of providers) {
    console.log(`[AI Service] Trying provider: ${provider.id}`);

    try {
      const raw = await callProviderWithRetry(provider, messages);
      if (!raw) continue;

      const parsed = extractJSON(raw);
      if (!parsed) {
        console.warn(`[AI Service] ${provider.id}: Could not extract JSON`);
        continue;
      }

      if (!isValidOutput(parsed)) {
        console.warn(`[AI Service] ${provider.id}: Invalid output structure`);
        continue;
      }

      const sanitized = sanitizeOutput(parsed);
      if (!sanitized) {
        console.warn(`[AI Service] ${provider.id}: Sanitization failed`);
        continue;
      }

      console.log(`[AI Service] ✅ Success via ${provider.id}`);
      return sanitized;

    } catch (err) {
      if (err._fatal) {
        console.warn(`[AI Service] ${provider.id}: Fatal error (auth/bad-request) — ${err.message}`);
      } else {
        console.warn(`[AI Service] ${provider.id}: Error — ${err.message}`);
      }
    }
  }

  console.warn("[AI Service] All providers failed — returning null");
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateCode(prompt) — alias for generateWebsiteFiles, returns null on failure
// ─────────────────────────────────────────────────────────────────────────────

const generateCode = generateWebsiteFiles;

module.exports = { generateWebsiteFiles, generateCode };
