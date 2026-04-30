"use strict";

/**
 * services/ai.service.js — Aquiplex AI Site Builder [v4.1]
 *
 * V4.1 UPGRADES:
 * - Model priority: groq → gemini → openrouter (free-first)
 * - Dynamic token limits per model (cost-efficient)
 * - HTTP 402 credit-limit handling (_skipModel, no retry)
 * - Correct Gemini request format (separate system + user parts)
 * - No retry on 402, deprecation, or _skipModel errors
 */

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS     = 45_000;
const MAX_RETRIES    = 2;
const RETRY_BASE_MS  = 600;
const FAIL_LIMIT     = 2;
const DEAD_TTL_MS    = 24 * 60 * 60 * 1000;
const COOL_TTL_MS    = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic token limits — cost-optimized per provider
// ─────────────────────────────────────────────────────────────────────────────

function getDynamicTokens(modelId) {
  if (modelId.includes("groq"))     return 1200;
  if (modelId.includes("gemini"))   return 1200;
  if (modelId.includes("deepseek")) return 800;
  return 600;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATION SIGNALS — any match → mark dead for 24h
// ─────────────────────────────────────────────────────────────────────────────

const DEPRECATION_SIGNALS = [
  "decommissioned",
  "no longer supported",
  "not supported",
  "model not found",
  "model_not_found",
];

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED MODEL REGISTRY — priority: groq → gemini → openrouter
// ─────────────────────────────────────────────────────────────────────────────

function buildModelRegistry() {
  const models = [];

  // 1st: Groq — free, fast
  if (process.env.GROQ_API_KEY) {
    const groqHeaders = {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type":  "application/json",
    };
    models.push({
      id:      "groq:llama-3.1-8b-instant",
      url:     "https://api.groq.com/openai/v1/chat/completions",
      headers: groqHeaders,
      buildBody: (msgs) => ({
        model:       "llama-3.1-8b-instant",
        messages:    msgs,
        temperature: 0.4,
        max_tokens:  getDynamicTokens("groq"),
      }),
    });
  }

  // 2nd: Gemini — free tier
  const geminiKey = process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    models.push({
      id:       "gemini:gemini-1.5-flash",
      isGemini: true,
      apiKey:   geminiKey,
    });
  }

  // 3rd: OpenRouter deepseek — paid fallback
  if (process.env.OPENROUTER_API_KEY) {
    const orHeaders = {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type":  "application/json",
      "HTTP-Referer":  process.env.OPENROUTER_REFERER || "https://aquiplex.com",
      "X-Title":       "Aquiplex",
    };
    models.push({
      id:      "openrouter:deepseek-chat",
      url:     "https://openrouter.ai/api/v1/chat/completions",
      headers: orHeaders,
      buildBody: (msgs) => ({
        model:       "deepseek/deepseek-chat",
        messages:    msgs,
        temperature: 0.3,
        max_tokens:  getDynamicTokens("deepseek"),
      }),
    });
  }

  return models;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL HEALTH SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const _modelHealth = new Map();

function _getModelHealth(modelId) {
  if (!_modelHealth.has(modelId)) {
    _modelHealth.set(modelId, { failures: 0, disabledUntil: 0 });
  }
  return _modelHealth.get(modelId);
}

function _isModelHealthy(modelId) {
  return _getModelHealth(modelId).disabledUntil <= Date.now();
}

function _markModelDead(modelId, reason = "deprecation") {
  const h = _getModelHealth(modelId);
  h.failures      = 99;
  h.disabledUntil = Date.now() + DEAD_TTL_MS;
  console.error(`[AI Service] ☠ Model marked DEAD (24h): ${modelId} | reason: ${reason}`);
}

function _recordModelFailure(modelId) {
  const h = _getModelHealth(modelId);
  h.failures += 1;
  if (h.failures >= FAIL_LIMIT) {
    h.disabledUntil = Date.now() + COOL_TTL_MS * h.failures;
    console.error(`[AI Service] Model in cooldown: ${modelId} | failures: ${h.failures}`);
  }
}

function _recordModelSuccess(modelId) {
  const h = _getModelHealth(modelId);
  h.failures      = 0;
  h.disabledUntil = 0;
}

function _isDeprecationError(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return DEPRECATION_SIGNALS.some(sig => lower.includes(sig));
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
// INTERACTIVE PROMPT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function isInteractivePrompt(prompt) {
  if (!prompt) return false;
  const keywords = [
    "timer", "calculator", "game", "todo", "clock", "quiz", "tracker", "pomodoro",
  ];
  const lower = prompt.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

const INTERACTIVE_SYSTEM_ADDENDUM = `

CRITICAL FUNCTIONALITY REQUIREMENTS:
- ALL buttons MUST work
- ALL event listeners MUST be implemented
- Timers must run in real time using setInterval or requestAnimationFrame
- Calculators must perform correct arithmetic operations
- Do NOT generate placeholder logic
- Do NOT leave incomplete functions
- Every feature must be fully functional`;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _fetchWithTimeout(url, init, timeoutMs = TIMEOUT_MS) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw model callers
// ─────────────────────────────────────────────────────────────────────────────

async function _callOpenRouterOrGroq(model, messages) {
  const res = await _fetchWithTimeout(model.url, {
    method:  "POST",
    headers: model.headers,
    body:    JSON.stringify(model.buildBody(messages)),
  });

  // HTTP 402 — credit limit, skip immediately, no retry
  if (res.status === 402) {
    const errText = await res.text().catch(() => "HTTP 402");
    const err = new Error(`CREDIT_LIMIT: ${errText.slice(0, 200)}`);
    err._skipModel = true;
    throw err;
  }

  const rawText = await res.text().catch(() => `HTTP ${res.status}`);

  if (_isDeprecationError(rawText)) {
    const err = new Error(`Deprecation detected: ${rawText.slice(0, 120)}`);
    err._dead = true;
    throw err;
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const err = new Error(`Fatal HTTP ${res.status}: ${rawText.slice(0, 100)}`);
    err._fatal = true;
    throw err;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 100)}`);
  }

  let data;
  try { data = JSON.parse(rawText); }
  catch { throw new Error("Non-JSON response body"); }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string" || content.trim().length < 20) {
    throw new Error("Empty or unusable response content");
  }

  if (_isDeprecationError(content)) {
    const err = new Error(`Deprecation in content: ${content.slice(0, 120)}`);
    err._dead = true;
    throw err;
  }

  return content;
}

async function _callGemini(model, messages) {
  const key = model.apiKey || process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API key not configured");

  // Extract system and user content separately — do NOT concatenate
  const systemMsg = messages.find(m => m.role === "system");
  const userMsg   = messages.find(m => m.role === "user");
  const systemPrompt = systemMsg?.content || "";
  const userPrompt   = userMsg?.content   || "";

  const res = await _fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: systemPrompt },
              { text: userPrompt },
            ],
          },
        ],
        generationConfig: {
          temperature:      0.4,
          maxOutputTokens:  getDynamicTokens("gemini"),
        },
      }),
    }
  );

  // HTTP 402 — quota exceeded
  if (res.status === 402) {
    const errText = await res.text().catch(() => "HTTP 402");
    const err = new Error(`CREDIT_LIMIT: ${errText.slice(0, 200)}`);
    err._skipModel = true;
    throw err;
  }

  if (!res.ok) {
    const rawText = await res.text().catch(() => `HTTP ${res.status}`);
    if (_isDeprecationError(rawText)) {
      const err = new Error(`Gemini deprecation: ${rawText.slice(0, 120)}`);
      err._dead = true;
      throw err;
    }
    throw new Error(`Gemini HTTP ${res.status}`);
  }

  let data;
  try { data = await res.json(); }
  catch { throw new Error("Gemini non-JSON response"); }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content || content.trim().length < 20) throw new Error("Gemini empty response");
  return content;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model dispatch + retry
// ─────────────────────────────────────────────────────────────────────────────

async function _callModel(model, messages) {
  if (model.isGemini) return _callGemini(model, messages);
  return _callOpenRouterOrGroq(model, messages);
}

async function _callModelWithRetry(model, messages) {
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await _callModel(model, messages);
    } catch (err) {
      lastErr = err;

      // No retry: dead/deprecation, fatal auth, credit limit, or explicit skip
      if (err._dead)      throw err;
      if (err._fatal)     throw err;
      if (err._skipModel) throw err;

      const reason = err.name === "AbortError" ? "timeout" : err.message;
      console.warn(`[AI Service] ${model.id} attempt ${attempt} failed: ${reason}`);

      if (attempt <= MAX_RETRIES) {
        await _sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }
  }

  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON extraction
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
// Validate + sanitize
// ─────────────────────────────────────────────────────────────────────────────

function isValidOutput(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (!parsed.files || typeof parsed.files !== "object") return false;
  if (Array.isArray(parsed.files)) return false;
  if (Object.keys(parsed.files).length === 0) return false;
  if (!parsed.files["index.html"] || typeof parsed.files["index.html"] !== "string") return false;
  if (parsed.files["index.html"].trim().length < 50) return false;
  return true;
}

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
// Safe fallback — NEVER null
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_FALLBACK = {
  files: {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aquiplex — Generation Unavailable</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="card">
    <div class="icon">⚡</div>
    <h1>Generation Unavailable</h1>
    <p>All AI models are temporarily unavailable. Please retry in a moment.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
  <script src="script.js"></script>
</body>
</html>`,
    "style.css": `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#0f0f13;color:#e2e8f0;display:flex;align-items:center;
justify-content:center;min-height:100vh;padding:24px}
.card{background:#1a1a24;border:1px solid #2d2d3d;border-radius:16px;
padding:40px 36px;max-width:480px;width:100%;text-align:center}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:22px;font-weight:700;color:#f8fafc;margin-bottom:12px}
p{font-size:14px;color:#94a3b8;margin-bottom:28px;line-height:1.6}
button{background:#6366f1;color:#fff;border:none;padding:10px 24px;
border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{opacity:.85}`,
    "script.js": '"use strict";\nconsole.log("[Aquiplex] Fallback page active.");',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TWO-PASS INTERACTIVE GENERATION
// Pass 1: UI skeleton (HTML + CSS, no JS)
// Pass 2: Logic layer (script.js only, referencing real IDs from Pass 1)
// ─────────────────────────────────────────────────────────────────────────────

function _getInteractiveTokens(modelId) {
  if (modelId.includes("groq"))     return 3000;
  if (modelId.includes("gemini"))   return 3000;
  if (modelId.includes("deepseek")) return 2500;
  return 2000;
}

async function _callModelRaw(model, messages, tokenOverride) {
  if (model.isGemini) {
    const geminiKey = model.apiKey || process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("Gemini API key not configured");
    const systemMsg = messages.find(m => m.role === "system");
    const userMsg   = messages.find(m => m.role === "user");
    const res = await _fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: systemMsg?.content || "" },
            { text: userMsg?.content   || "" },
          ]}],
          generationConfig: { temperature: 0.2, maxOutputTokens: tokenOverride || _getInteractiveTokens("gemini") },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content || content.trim().length < 20) throw new Error("Gemini empty response");
    return content;
  }

  const bodyBase = model.buildBody(messages);
  const body     = { ...bodyBase, temperature: 0.2, max_tokens: tokenOverride || _getInteractiveTokens(model.id) };
  const res = await _fetchWithTimeout(model.url, {
    method:  "POST",
    headers: model.headers,
    body:    JSON.stringify(body),
  });
  if (res.status === 402) { const e = new Error("CREDIT_LIMIT"); e._skipModel = true; throw e; }
  const rawText = await res.text().catch(() => `HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 100)}`);
  let data;
  try { data = JSON.parse(rawText); } catch { throw new Error("Non-JSON response"); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content || content.trim().length < 20) throw new Error("Empty response content");
  return content;
}

async function _runModelPool(models, messages, label, tokenOverride) {
  for (const model of models) {
    if (!_isModelHealthy(model.id)) continue;
    try {
      const result = await _callModelRaw(model, messages, tokenOverride);
      _recordModelSuccess(model.id);
      return result;
    } catch (err) {
      console.warn(`[AI Service][${label}] ${model.id} failed: ${err.message}`);
      if (err._dead)      _markModelDead(model.id, err.message);
      else if (err._skipModel) _recordModelFailure(model.id);
      else                _recordModelFailure(model.id);
    }
  }
  throw new Error(`[${label}] All models failed`);
}

async function generateInteractiveProject(prompt) {
  const allModels = buildModelRegistry();
  if (allModels.length === 0) throw new Error("No models configured");

  // Pass 1: prefer groq (fast) for UI skeleton
  const pass1Models = [
    ...allModels.filter(m => m.id.includes("groq")),
    ...allModels.filter(m => !m.id.includes("groq")),
  ];

  const pass1System = `You are an expert web developer. Generate ONLY index.html and style.css — NO JavaScript whatsoever.

RULES:
1. Respond ONLY with valid JSON. No prose, no markdown, no code fences.
2. Schema: { "files": { "index.html": "...", "style.css": "..." } }
3. Add unique IDs to ALL interactive elements (buttons, inputs, displays).
4. Clean semantic HTML5, modern CSS3.
5. Link stylesheet: <link rel="stylesheet" href="style.css">
6. Add placeholder: <script src="script.js"></script> at end of body.
7. NO inline JavaScript. NO onclick attributes.
8. Escape all double quotes inside file content as \\"`;

  const pass1User = `Build the UI structure (HTML + CSS only, NO JS) for: ${prompt}

Return ONLY the JSON object.`;

  const pass1Messages = [
    { role: "system", content: pass1System },
    { role: "user",   content: pass1User },
  ];

  console.log("[AI Service][Interactive] Pass 1 — UI skeleton");
  const raw1 = await _runModelPool(pass1Models, pass1Messages, "Pass1-UI", null);
  const parsed1 = extractJSON(raw1);
  if (!parsed1?.files?.["index.html"]) throw new Error("Pass 1 returned no index.html");
  const uiSkeleton = parsed1.files;

  // Pass 2: prefer deepseek/gemini (stronger logic) for script.js
  const pass2Models = [
    ...allModels.filter(m => m.id.includes("deepseek")),
    ...allModels.filter(m => m.id.includes("gemini")),
    ...allModels.filter(m => !m.id.includes("deepseek") && !m.id.includes("gemini")),
  ];

  const pass2System = `You are an expert JavaScript developer. Generate ONLY a script.js file.

STRICT RULES:
1. Return ONLY raw JavaScript code — no JSON wrapper, no markdown, no explanations.
2. DO NOT change any HTML IDs or structure.
3. Use document.getElementById / querySelector to reference elements.
4. Add complete event listeners for ALL interactive elements.
5. Implement full state management and DOM updates.
6. Timers MUST use setInterval or requestAnimationFrame and run in real time.
7. Calculators MUST perform correct arithmetic and update the display.
8. Every button MUST have a working event listener.
9. No empty functions, no placeholder logic.`;

  const pass2User = `Given this HTML:

${uiSkeleton["index.html"]}

Generate ONLY script.js with complete, working functionality for: ${prompt}

Return ONLY the JavaScript code.`;

  const pass2Messages = [
    { role: "system", content: pass2System },
    { role: "user",   content: pass2User },
  ];

  console.log("[AI Service][Interactive] Pass 2 — Logic generation");
  const scriptJS = await _runModelPool(pass2Models, pass2Messages, "Pass2-Logic", _getInteractiveTokens("deepseek"));

  // Strip any accidental markdown fences
  const cleanedJS = scriptJS
    .replace(/^```(?:javascript|js)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  console.log("[AI Service][Interactive] ✅ Two-pass generation complete");
  return {
    files: {
      "index.html": uiSkeleton["index.html"],
      "style.css":  uiSkeleton["style.css"] || "/* Generated */",
      "script.js":  cleanedJS,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: generateWebsiteFiles(prompt)
// GUARANTEES: NEVER returns null
// ─────────────────────────────────────────────────────────────────────────────

async function generateWebsiteFiles(prompt) {
  // Two-pass path for interactive prompts
  if (isInteractivePrompt(prompt)) {
    try {
      console.log("[AI Service] Interactive prompt detected — using two-pass generation");
      const result = await generateInteractiveProject(prompt);
      if (result?.files?.["index.html"]) return sanitizeOutput(result) || result;
    } catch (err) {
      console.warn(`[AI Service] Two-pass failed, falling back to single-pass: ${err.message}`);
    }
  }

  const isInteractive = isInteractivePrompt(prompt);
  const systemContent = isInteractive
    ? SYSTEM_PROMPT + INTERACTIVE_SYSTEM_ADDENDUM
    : SYSTEM_PROMPT;

  const selfValidation = isInteractive
    ? `\n\nFINAL CHECK BEFORE OUTPUT: Simulate the app mentally:\n- If it's a timer → verify it counts every second\n- If it's a calculator → verify calculations work correctly\n- If any feature is broken → fix it before output\n\nIMPORTANT: All JavaScript must include: proper event listeners (addEventListener), real state updates, working functions (no empty handlers), DOM updates that reflect user actions.`
    : "";

  const userPrompt = `Build this website: ${prompt}${selfValidation}\n\nIMPORTANT: Respond with ONLY the JSON object. No text before or after the JSON. No markdown code fences.`;

  const messages = [
    { role: "system", content: systemContent },
    { role: "user",   content: userPrompt },
  ];

  let models = buildModelRegistry();

  // Interactive: prioritize deepseek → qwen → groq for stronger JS logic
  if (isInteractive) {
    models = [
      ...models.filter(m => m.id.includes("deepseek")),
      ...models.filter(m => m.id.includes("qwen")),
      ...models.filter(m => m.id.includes("groq")),
      ...models.filter(m => !m.id.includes("deepseek") && !m.id.includes("qwen") && !m.id.includes("groq")),
    ];
    // Lower temperature for deterministic, correct logic
    models = models.map(m => {
      if (!m.isGemini && m.buildBody) {
        const origBuildBody = m.buildBody;
        return {
          ...m,
          buildBody: (msgs) => ({ ...origBuildBody(msgs), temperature: 0.2 }),
        };
      }
      return m;
    });
  }

  if (models.length === 0) {
    console.error("[AI Service] No API keys configured — returning safe fallback");
    return SAFE_FALLBACK;
  }

  for (const model of models) {
    if (!_isModelHealthy(model.id)) {
      console.warn(`[AI Service] Skipping unhealthy model: ${model.id}`);
      continue;
    }

    console.log(`[AI Service] Trying model: ${model.id}`);

    try {
      const raw = await _callModelWithRetry(model, messages);

      const parsed = extractJSON(raw);
      if (!parsed) {
        console.warn(`[AI Service] ${model.id}: Could not extract JSON`);
        _recordModelFailure(model.id);
        continue;
      }

      if (!isValidOutput(parsed)) {
        console.warn(`[AI Service] ${model.id}: Invalid output structure`);
        _recordModelFailure(model.id);
        continue;
      }

      const sanitized = sanitizeOutput(parsed);
      if (!sanitized) {
        console.warn(`[AI Service] ${model.id}: Sanitization failed`);
        _recordModelFailure(model.id);
        continue;
      }

      _recordModelSuccess(model.id);
      console.log(`[AI Service] ✅ Success via ${model.id}`);
      return sanitized;

    } catch (err) {
      if (err._dead) {
        _markModelDead(model.id, err.message);
      } else if (err._skipModel) {
        console.warn(`[AI Service] ${model.id}: Skipped — ${err.message}`);
        _recordModelFailure(model.id);
      } else if (err._fatal) {
        console.warn(`[AI Service] ${model.id}: Fatal — ${err.message}`);
        _recordModelFailure(model.id);
      } else {
        console.warn(`[AI Service] ${model.id}: Failed — ${err.message}`);
        _recordModelFailure(model.id);
      }
    }
  }

  console.error("[AI Service] All models failed — returning safe fallback (ZERO-FAIL guarantee)");
  return SAFE_FALLBACK;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

const generateCode = generateWebsiteFiles;

module.exports = { generateWebsiteFiles, generateCode };
