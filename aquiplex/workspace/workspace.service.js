"use strict";

/**
 * workspace.service.js — AQUIPLEX V4.1 SELF-HEALING AI ENGINE
 *
 * V4.1 UPGRADES:
 * - Model priority reordered: groq → gemini → openrouter (free-first)
 * - LLM_MAX_TOKENS reduced: 2500 → 900 (cost-efficient)
 * - Dynamic token fn per model (groq/gemini: 1200, deepseek: 800)
 * - HTTP 402 handling: _skipModel=true, no retry, immediate model switch
 * - Gemini request body fixed: separate system + user parts, no string concat
 * - Retry logic: no retry on _skipModel, _dead, 402, or deprecation
 * - All V4 features preserved: health tracking, cooldown, fallback, parser
 *
 * FIX BATCH 2:
 * - readProjectFiles: guard against null/undefined index.files before .includes()
 * - readSingleFile: removed unsafe `|| filePath !== dir` escape hatch in path check
 * - writeSingleFile: same path check fix
 * - getProjectList: require userId match (no more leaking projects with missing userId)
 * - saveProjectFiles: normalise dir with trailing sep for reliable startsWith check
 */

const fs        = require("fs").promises;
const fsSync    = require("fs");
const path      = require("path");
const mongoose  = require("mongoose");
const Workspace = require("../models/Workspace");
const Bundle    = require("../models/Bundle");

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SESSIONS       = 10;
const MAX_RECENT_OUTPUTS = 20;
const MAX_INSIGHTS       = 4;
const PROJECTS_DIR       = path.join(__dirname, "../data/projects");

const LLM_TIMEOUT_MS      = 35_000;
const LLM_MAX_RETRIES     = 2;
const LLM_RETRY_BASE_MS   = 800;
const LLM_MAX_TOKENS      = 900;   // V4.1: reduced from 2500
const MODEL_FAIL_LIMIT    = 2;
const MODEL_COOL_TTL_MS   = 60_000;
const MODEL_DEAD_TTL_MS   = 24 * 60 * 60 * 1000;
const OUTPUT_MIN_LENGTH   = 100;
const FILE_DELIMITER_REGEX = /={3}\s*FILE:\s*(.+?)\s*={3}/;

const ALLOWED_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".cjs",
  ".ts", ".json", ".svg", ".md", ".txt",
  ".png", ".jpg", ".jpeg", ".gif", ".ico",
  ".woff", ".woff2", ".ttf",
]);

const DEPRECATION_SIGNALS = [
  "decommissioned",
  "no longer supported",
  "not supported",
  "model not found",
  "model_not_found",
];

// Ensure projects dir exists on startup
(async () => {
  try { await fs.mkdir(PROJECTS_DIR, { recursive: true }); } catch {}
})();

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
// UNIFIED MODEL REGISTRY — priority: groq → gemini → openrouter
// ─────────────────────────────────────────────────────────────────────────────

function buildModelRegistry() {
  const models = [];

  // 1st: Groq — free, fast, primary
  if (process.env.GROQ_API_KEY) {
    const headers = {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type":  "application/json",
    };
    models.push({
      id:        "groq:llama-3.1-8b-instant",
      url:       "https://api.groq.com/openai/v1/chat/completions",
      headers,
      modelName: "llama-3.1-8b-instant",
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

  // 3rd: OpenRouter deepseek — paid fallback only
  if (process.env.OPENROUTER_API_KEY) {
    const headers = {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type":  "application/json",
      "HTTP-Referer":  process.env.OPENROUTER_REFERER || "https://aquiplex.com",
      "X-Title":       "Aquiplex",
    };
    models.push({
      id:        "openrouter:deepseek-chat",
      url:       "https://openrouter.ai/api/v1/chat/completions",
      headers,
      modelName: "deepseek/deepseek-chat",
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

function _markModelDead(modelId, reason) {
  const h = _getModelHealth(modelId);
  h.failures      = 99;
  h.disabledUntil = Date.now() + MODEL_DEAD_TTL_MS;
  console.error(`[AI ENGINE] ☠ Model DEAD (24h): ${modelId} | ${reason}`);
}

function _recordModelFailure(modelId) {
  const h = _getModelHealth(modelId);
  h.failures += 1;
  if (h.failures >= MODEL_FAIL_LIMIT) {
    h.disabledUntil = Date.now() + MODEL_COOL_TTL_MS * h.failures;
    console.error(`[AI ERROR] Model in cooldown: ${modelId} | failures: ${h.failures}`);
  }
}

function _recordModelSuccess(modelId) {
  const h = _getModelHealth(modelId);
  h.failures      = 0;
  h.disabledUntil = 0;
  console.log(`[AI ENGINE] ✅ Model healthy: ${modelId}`);
}

function _isDeprecationError(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return DEPRECATION_SIGNALS.some(sig => lower.includes(sig));
}

// ─────────────────────────────────────────────────────────────────────────────
// APP-TYPE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const APP_TYPE_KEYWORDS = {
  game: [
    "game","snake","tetris","breakout","chess","puzzle","platformer","shooter",
    "rpg","quiz game","trivia","arcade","pong","flappy","dungeon","maze","slots",
    "card game","board game","memory game","2d game","3d game","canvas game",
  ],
  dashboard: [
    "dashboard","admin panel","analytics","metrics","stats","statistics",
    "control panel","management","monitor","overview panel","data panel","kpi",
    "reporting","charts dashboard","business intelligence",
  ],
  tool: [
    "calculator","converter","editor","formatter","generator","validator",
    "timer","clock","stopwatch","password generator","color picker","regex tester",
    "markdown editor","json formatter","base64","encoder","decoder","diff tool",
    "unit converter","currency converter","bmi","loan calculator","budget tool",
  ],
  saas: [
    "saas","landing page","startup","product page","marketing","sales page",
    "waitlist","coming soon","app landing","hero section","pricing page",
    "feature page","sign up page","testimonials",
  ],
  portfolio: [
    "portfolio","personal site","about me","resume","cv","my work","showcase",
    "developer portfolio","designer portfolio","freelancer","hire me",
  ],
  blog: [
    "blog","article","post","news","newsletter","magazine","editorial","writing","journal",
  ],
  ecommerce: [
    "shop","store","ecommerce","e-commerce","product listing","cart","checkout",
    "marketplace","buy","sell","inventory","catalogue",
  ],
  form: [
    "contact form","survey","quiz","questionnaire","feedback form",
    "application form","booking form","registration form","sign up form",
  ],
};

function detectAppType(prompt) {
  if (!prompt) return "static";
  const lower = prompt.toLowerCase();
  for (const [type, keywords] of Object.entries(APP_TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return type;
    }
  }
  return "static";
}

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

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPromptForType(appType) {
  const base = `You are an expert full-stack web developer. Generate complete, production-quality, self-contained web projects.

CRITICAL OUTPUT FORMAT RULES:
1. Output ONLY the file contents — no explanations, no preamble, no markdown code fences.
2. Separate each file with this EXACT delimiter on its own line:
   === FILE: relative/path/to/file.ext ===
3. Start with === FILE: ... === immediately (no leading text).
4. Generate ALL necessary files: HTML, CSS, JS, and any assets as inline data URIs.
5. Every file must be complete — no placeholders, no TODO comments, no truncation.
6. CSS and JS should be in separate files unless the project is a single-page tool.
7. Use modern ES6+ JavaScript. No jQuery unless specifically requested.
8. All projects must work when opened directly in a browser (no build step required).
9. Use localStorage for any persistence needs.
10. Make the UI polished, professional, and responsive (mobile-first).`;

  const typeInstructions = {
    game: `
GAME REQUIREMENTS:
- Use HTML5 Canvas for rendering when appropriate.
- Implement complete game loop: init, update, render, collision detection.
- Include score tracking, lives/health, game over screen, restart capability.
- Add keyboard and touch controls.
- Sound effects via Web Audio API (generated tones, not audio files).
- Smooth 60fps animation via requestAnimationFrame.
- Include a start screen and instructions.`,

    dashboard: `
DASHBOARD REQUIREMENTS:
- Use Chart.js (loaded via CDN: https://cdn.jsdelivr.net/npm/chart.js) for charts.
- Include multiple chart types: line, bar, pie/doughnut at minimum.
- Generate realistic mock data with time series.
- Responsive grid layout using CSS Grid.
- Dark/light mode toggle.
- KPI stat cards with trend indicators.
- Sidebar navigation with multiple views.`,

    tool: `
TOOL REQUIREMENTS:
- Fully functional — every button and input must work.
- Keyboard shortcuts for power users.
- Clear, minimal, professional UI.
- Input validation with helpful error messages.
- Copy-to-clipboard functionality where applicable.
- History/undo feature where relevant.
- Offline-capable (no external API calls unless mocking).`,

    saas: `
SAAS LANDING PAGE REQUIREMENTS:
- Hero section with compelling headline and CTA button.
- Features section with icon cards (use Unicode/emoji for icons).
- Pricing section with 3 tiers (Basic, Pro, Enterprise).
- Testimonials section.
- FAQ section with accordion.
- Footer with newsletter signup.
- Smooth scroll navigation.
- CSS animations on scroll (Intersection Observer).
- Fully responsive.`,

    portfolio: `
PORTFOLIO REQUIREMENTS:
- Hero with name, role, and animated tagline.
- Skills section with visual progress bars or tags.
- Projects grid with hover effects and project details.
- About section with professional bio.
- Contact form (client-side validation, simulated submit).
- Smooth animations throughout.
- Custom CSS variables for easy theming.`,

    blog: `
BLOG REQUIREMENTS:
- Realistic blog post cards with author, date, category, read time.
- Featured post hero section.
- Category filter tabs.
- Search bar (client-side filtering).
- Individual post view with rich typography.
- Sidebar with recent posts, tags, categories.
- Dark/light mode toggle.`,

    ecommerce: `
ECOMMERCE REQUIREMENTS:
- Product grid with filters (category, price range, rating).
- Product cards with hover quick-view.
- Shopping cart with item count badge, add/remove, quantity update.
- Cart sidebar or modal.
- Product detail page.
- Search functionality.
- localStorage cart persistence.`,

    form: `
FORM REQUIREMENTS:
- All fields with proper HTML5 validation.
- Real-time field validation with visual feedback (green/red borders).
- Error messages per field.
- Progress indicator for multi-step forms.
- Accessible (labels, ARIA attributes, tab order).
- Success confirmation screen after submit.
- Nice loading state on submit button.`,

    static: `
STATIC SITE REQUIREMENTS:
- Clean, modern design with clear visual hierarchy.
- Responsive layout.
- Smooth CSS transitions and hover effects.
- Good typography: use system fonts or a single Google Font loaded via CSS @import.
- At least 3 distinct sections.`,
  };

  return base + (typeInstructions[appType] || typeInstructions.static);
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
// LLM HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function _fetchWithTimeout(url, init, timeoutMs = LLM_TIMEOUT_MS) {
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

function _isUsable(text) {
  return typeof text === "string" && text.trim().length > OUTPUT_MIN_LENGTH;
}

function _validateRawOutput(text, context = "generation") {
  if (!text || typeof text !== "string") {
    throw new Error(`AI output is null or non-string [${context}]`);
  }
  if (text.trim().length < OUTPUT_MIN_LENGTH) {
    throw new Error(
      `AI output too short (${text.trim().length} chars, min ${OUTPUT_MIN_LENGTH}) [${context}]`
    );
  }
  if (!FILE_DELIMITER_REGEX.test(text)) {
    throw new Error(
      `AI output missing required "=== FILE:" delimiter [${context}]. ` +
      `Raw preview: ${text.slice(0, 120).replace(/\n/g, "↵")}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL CALLERS
// ─────────────────────────────────────────────────────────────────────────────

async function _callOpenRouterOrGroq(model, messages) {
  const body = JSON.stringify({
    model:      model.modelName,
    messages,
    max_tokens: getDynamicTokens(model.id),
  });

  const res = await _fetchWithTimeout(model.url, {
    method:  "POST",
    headers: model.headers,
    body,
  });

  // HTTP 402 — credit limit: skip model immediately, no retry
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

  if (res.status === 400) {
    const err      = new Error(`HTTP 400: ${rawText.slice(0, 200)}`);
    err._skipModel = true;
    throw err;
  }

  if (res.status === 401 || res.status === 403) {
    const err      = new Error(`Auth error HTTP ${res.status} — ${rawText.slice(0, 100)}`);
    err._skipModel = true;
    throw err;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
  }

  let data;
  try { data = JSON.parse(rawText); }
  catch { throw new Error("Non-JSON response body"); }

  const content = data?.choices?.[0]?.message?.content;
  if (!_isUsable(content)) throw new Error("Empty or unusable response content");

  if (_isDeprecationError(content)) {
    const err = new Error(`Deprecation in response content: ${content.slice(0, 120)}`);
    err._dead = true;
    throw err;
  }

  return content;
}

async function _callGemini(model, messages) {
  const key = model.apiKey;
  if (!key) throw new Error("Gemini API key not configured");

  // Separate system and user prompts — do NOT concatenate into one string
  const systemMsg    = messages.find(m => m.role === "system");
  const userMsg      = messages.find(m => m.role === "user");
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
          temperature:     0.4,
          maxOutputTokens: getDynamicTokens("gemini"),
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
    throw new Error(`Gemini HTTP ${res.status}: ${rawText.slice(0, 100)}`);
  }

  let data;
  try { data = await res.json(); }
  catch { throw new Error("Gemini non-JSON response"); }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!_isUsable(content)) throw new Error("Gemini empty response");
  return content;
}

async function _callModel(model, messages) {
  if (model.isGemini) return _callGemini(model, messages);
  return _callOpenRouterOrGroq(model, messages);
}

/**
 * Retry wrapper — no retry on _skipModel, _dead, or 402.
 * Immediate throw → triggers model rotation in caller.
 */
async function _withModelRetry(model, messages, label) {
  let lastErr;
  for (let attempt = 1; attempt <= LLM_MAX_RETRIES + 1; attempt++) {
    try {
      return await _callModel(model, messages);
    } catch (err) {
      lastErr = err;
      // No retry: credit limit, deprecation, auth/skip
      if (err._dead || err._skipModel) throw err;
      const reason = err.name === "AbortError" ? "timeout" : err.message;
      console.warn(`[AI ERROR] ${label} | Attempt ${attempt} | ${reason}`);
      if (attempt <= LLM_MAX_RETRIES) {
        await _sleep(LLM_RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// NUCLEAR FALLBACK PAGE — used when ALL models fail in generate mode
// ─────────────────────────────────────────────────────────────────────────────

function _buildFallbackOutput(prompt, lastError) {
  const safePrompt = String(prompt || "your request")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 120);
  const safeError  = String(lastError?.message || "All AI models are currently unavailable")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 200);

  return `=== FILE: index.html ===
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Generation Unavailable — Aquiplex</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="card">
    <div class="icon">⚡</div>
    <h1>Generation Unavailable</h1>
    <p class="subtitle">Could not generate: <strong>${safePrompt}</strong></p>
    <div class="detail">${safeError}</div>
    <div class="actions">
      <button class="btn-primary" onclick="location.reload()">Retry</button>
      <button class="btn-secondary" onclick="history.back()">Go Back</button>
    </div>
  </div>
  <script src="script.js"></script>
</body>
</html>

=== FILE: style.css ===
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f0f13; color: #e2e8f0;
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 24px;
}
.card {
  background: #1a1a24; border: 1px solid #2d2d3d; border-radius: 16px;
  padding: 40px 36px; max-width: 520px; width: 100%; text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,.4);
}
.icon { font-size: 48px; margin-bottom: 16px; }
h1 { font-size: 22px; font-weight: 700; color: #f8fafc; margin-bottom: 8px; }
.subtitle { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
.detail {
  background: #111118; border: 1px solid #2d2d3d; border-radius: 8px;
  padding: 12px 16px; font-size: 12px; color: #64748b; font-family: monospace;
  text-align: left; margin-bottom: 28px; word-break: break-word;
}
.actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
button {
  padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600;
  cursor: pointer; border: none; transition: opacity .15s;
}
button:hover { opacity: .85; }
.btn-primary   { background: #6366f1; color: #fff; }
.btn-secondary { background: #1e1e2e; color: #94a3b8; border: 1px solid #2d2d3d; }

=== FILE: script.js ===
"use strict";
console.log("[Aquiplex] Fallback page loaded — all AI models failed.");`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO-PASS INTERACTIVE GENERATION
// Produces delimiter-formatted output compatible with parseMultiFileOutput
// ─────────────────────────────────────────────────────────────────────────────

function _getInteractiveToks(modelId) {
  if (modelId.includes("groq"))     return 3000;
  if (modelId.includes("gemini"))   return 3000;
  if (modelId.includes("deepseek")) return 2500;
  return 2000;
}

async function _callModelRawWS(model, messages, maxToks) {
  if (model.isGemini) {
    const key = model.apiKey || process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini key missing");
    const sys  = messages.find(m => m.role === "system");
    const user = messages.find(m => m.role === "user");
    const res  = await _fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: sys?.content  || "" },
            { text: user?.content || "" },
          ]}],
          generationConfig: { temperature: 0.2, maxOutputTokens: maxToks || _getInteractiveToks("gemini") },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data    = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!_isUsable(content)) throw new Error("Gemini empty response");
    return content;
  }

  const res = await _fetchWithTimeout(model.url, {
    method:  "POST",
    headers: model.headers,
    body:    JSON.stringify({
      model:      model.modelName,
      messages,
      max_tokens: maxToks || _getInteractiveToks(model.id),
      temperature: 0.2,
    }),
  });
  if (res.status === 402) { const e = new Error("CREDIT_LIMIT"); e._skipModel = true; throw e; }
  const rawText = await res.text().catch(() => `HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 100)}`);
  let data;
  try { data = JSON.parse(rawText); } catch { throw new Error("Non-JSON response"); }
  const content = data?.choices?.[0]?.message?.content;
  if (!_isUsable(content)) throw new Error("Empty response content");
  return content;
}

async function _runModelPoolWS(models, messages, label, maxToks) {
  for (const model of models) {
    if (!_isModelHealthy(model.id)) continue;
    try {
      const result = await _callModelRawWS(model, messages, maxToks);
      _recordModelSuccess(model.id);
      return result;
    } catch (err) {
      console.warn(`[AI ENGINE][${label}] ${model.id} failed: ${err.message}`);
      if (err._dead)           _markModelDead(model.id, err.message);
      else if (err._skipModel) _recordModelFailure(model.id);
      else                     _recordModelFailure(model.id);
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

  const pass1System = `You are an expert web developer. Generate ONLY index.html and style.css — NO JavaScript.

OUTPUT FORMAT — use EXACTLY these delimiters:
=== FILE: index.html ===
(full HTML here)

=== FILE: style.css ===
(full CSS here)

RULES:
- Add unique IDs to ALL interactive elements (buttons, inputs, displays).
- Clean semantic HTML5, modern CSS3.
- Link: <link rel="stylesheet" href="style.css">
- Include: <script src="script.js"></script> at end of body.
- NO inline JavaScript. NO onclick attributes.
- Start output immediately with the first delimiter, no preamble.`;

  const pass1User = `Build the UI structure (HTML + CSS only, NO JS) for: ${prompt}`;

  const pass1Messages = [
    { role: "system", content: pass1System },
    { role: "user",   content: pass1User },
  ];

  console.log("[AI ENGINE][Interactive] Pass 1 — UI skeleton");
  const raw1 = await _runModelPoolWS(pass1Models, pass1Messages, "Pass1-UI", null);

  // Extract HTML from delimiter output
  const htmlMatch = raw1.match(/={3}\s*FILE:\s*index\.html\s*={3}\s*([\s\S]*?)(?:={3}\s*FILE:|$)/i);
  const cssMatch  = raw1.match(/={3}\s*FILE:\s*style\.css\s*={3}\s*([\s\S]*?)(?:={3}\s*FILE:|$)/i);
  if (!htmlMatch?.[1]?.trim()) throw new Error("Pass 1 returned no index.html");

  const htmlContent = htmlMatch[1].trim();
  const cssContent  = cssMatch?.[1]?.trim() || "/* Generated */";

  // Pass 2: prefer deepseek/gemini for stronger logic
  const pass2Models = [
    ...allModels.filter(m => m.id.includes("deepseek")),
    ...allModels.filter(m => m.id.includes("gemini")),
    ...allModels.filter(m => !m.id.includes("deepseek") && !m.id.includes("gemini")),
  ];

  const pass2System = `You are an expert JavaScript developer. Generate ONLY raw JavaScript code for script.js.

STRICT RULES:
- Return ONLY JavaScript code — no markdown fences, no explanations, no file delimiters.
- DO NOT change any HTML IDs or structure.
- Use document.getElementById / querySelector to reference elements.
- Add working event listeners for ALL interactive elements.
- Timers MUST use setInterval or requestAnimationFrame and run in real time.
- Calculators MUST perform correct arithmetic and update the display element.
- Every button MUST have a working event listener.
- No empty functions, no placeholder logic, no TODO comments.`;

  const pass2User = `Given this HTML:

${htmlContent}

Generate ONLY the complete, working script.js for: ${prompt}

Return ONLY JavaScript code.`;

  const pass2Messages = [
    { role: "system", content: pass2System },
    { role: "user",   content: pass2User },
  ];

  console.log("[AI ENGINE][Interactive] Pass 2 — Logic generation");
  const rawJS = await _runModelPoolWS(pass2Models, pass2Messages, "Pass2-Logic", _getInteractiveToks("deepseek"));

  const cleanedJS = rawJS
    .replace(/^```(?:javascript|js)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Return in delimiter format — compatible with parseMultiFileOutput
  const output =
    `=== FILE: index.html ===\n${htmlContent}\n\n` +
    `=== FILE: style.css ===\n${cssContent}\n\n` +
    `=== FILE: script.js ===\n${cleanedJS}`;

  console.log("[AI ENGINE][Interactive] ✅ Two-pass generation complete");
  return { rawOutput: output, source: "ai_two_pass", intent: "tool" };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED AI GENERATION ENGINE — MODEL-FIRST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateProjectUnified({ prompt, mode, editMode, previousFiles, targetFile, appType })
 *
 * - generate mode: NEVER throws. Returns nuclear fallback on full failure.
 * - edit mode: THROWS on failure. File is never touched.
 */
async function generateProjectUnified({
  prompt,
  mode          = "generate",
  editMode      = false,
  previousFiles = null,
  targetFile    = null,
  appType       = null,
}) {
  const isEdit = editMode || mode === "edit";

  // Two-pass path for interactive prompts (generate mode only)
  if (!isEdit && isInteractivePrompt(prompt)) {
    try {
      console.log("[AI ENGINE] Interactive prompt detected — using two-pass generation");
      const result = await generateInteractiveProject(prompt);
      if (result?.rawOutput && FILE_DELIMITER_REGEX.test(result.rawOutput)) return result;
    } catch (err) {
      console.warn(`[AI ENGINE] Two-pass failed, falling back to single-pass: ${err.message}`);
    }
  }

  const intent    = appType || detectAppType(prompt);
  const isInteractive = isInteractivePrompt(prompt);
  const sysPrompt = buildSystemPromptForType(intent) + (isInteractive ? INTERACTIVE_SYSTEM_ADDENDUM : "");
  const context   = isEdit ? `edit:${targetFile}` : "generate";

  let userMessage;
  if (isEdit && targetFile && previousFiles) {
    const fileContent = previousFiles[targetFile] || "";
    userMessage =
      `Edit this file:\n\n${fileContent}\n\n` +
      `Instruction: ${prompt}\n\n` +
      `Return ONLY:\n=== FILE: ${targetFile} ===\n[updated content here]`;
  } else {
    userMessage =
      `Build this web project: ${prompt}\n\n` +
      `STRICT FORMAT — start immediately with the delimiter, no preamble:\n` +
      `=== FILE: index.html ===\n(full HTML)\n\n` +
      `=== FILE: style.css ===\n(full CSS)\n\n` +
      `=== FILE: script.js ===\n(full JS)\n\n` +
      `IMPORTANT: All JavaScript must include:\n` +
      `- proper event listeners (addEventListener)\n` +
      `- real state updates\n` +
      `- working functions (no empty handlers)\n` +
      `- DOM updates that reflect user actions\n\n` +
      `FINAL CHECK BEFORE OUTPUT: Simulate the app mentally:\n` +
      `- If it's a timer → verify it counts every second\n` +
      `- If it's a calculator → verify calculations work correctly\n` +
      `- If any feature is broken → fix it before output`;
  }

  const messages = [
    { role: "system", content: sysPrompt },
    { role: "user",   content: userMessage },
  ];

  let MODELS = buildModelRegistry();

  // Interactive prompts: prioritize deepseek → qwen → groq for better JS logic
  if (isInteractive) {
    MODELS = [
      ...MODELS.filter(m => m.id.includes("deepseek")),
      ...MODELS.filter(m => m.id.includes("qwen")),
      ...MODELS.filter(m => m.id.includes("groq")),
      ...MODELS.filter(m => !m.id.includes("deepseek") && !m.id.includes("qwen") && !m.id.includes("groq")),
    ];
    // Apply lower temperature for deterministic logic output
    MODELS = MODELS.map(m => {
      if (!m.isGemini && m.buildBody) {
        return {
          ...m,
          buildBody: (msgs) => ({ ...m.buildBody(msgs), temperature: 0.2 }),
        };
      }
      return m;
    });
  }

  if (MODELS.length === 0) {
    const err = new Error("No API keys configured. Set GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.");
    console.error(`[AI ERROR] No models configured`);
    if (isEdit) throw err;
    return {
      rawOutput: _buildFallbackOutput(prompt, err),
      source:    "nuclear_fallback",
      intent,
    };
  }

  let lastError = null;

  for (const model of MODELS) {
    if (!_isModelHealthy(model.id)) {
      console.warn(`[AI ENGINE] Skipping unhealthy model: ${model.id}`);
      continue;
    }

    const label = model.id;
    console.log(`[AI ENGINE] Trying model: ${label}`);

    try {
      const text = await _withModelRetry(model, messages, label);

      _validateRawOutput(text, context);

      _recordModelSuccess(model.id);
      console.log(`[AI ENGINE] ✅ Success | ${label} | ${text.length} chars`);
      return { rawOutput: text, source: "ai", intent };

    } catch (err) {
      lastError = err;

      if (err._dead) {
        _markModelDead(model.id, err.message);
      } else if (err._skipModel) {
        console.warn(`[AI ERROR] ${label} | Model skipped (credit/auth): ${err.message}`);
        _recordModelFailure(model.id);
      } else {
        console.warn(`[AI ERROR] ${label} | ${err.message}`);
        _recordModelFailure(model.id);
      }

      console.log(`[AI ENGINE] Rotating to next model...`);
    }
  }

  console.error(`[AI ERROR] ALL MODELS FAILED | Last: ${lastError?.message}`);

  if (isEdit) {
    throw new Error(
      `AI edit failed — all models exhausted. File was NOT modified. ` +
      `Last error: ${lastError?.message || "unknown"}`
    );
  }

  return {
    rawOutput: _buildFallbackOutput(prompt, lastError),
    source:    "nuclear_fallback",
    intent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — strict, never returns empty array, always guarantees index.html
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeFileName(name) {
  if (!name || typeof name !== "string") return "";
  const cleaned = name
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\0/g, "")
    .replace(/\.\.\//g, "")
    .trim();
  if (!cleaned) return "";
  const ext = path.extname(cleaned).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    console.warn(`[PROJECT ENGINE] Rejected file with disallowed extension: ${cleaned}`);
    return "";
  }
  return cleaned;
}

function inferLanguage(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    ".html": "html", ".htm": "html",
    ".css":  "css",
    ".js":   "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts":   "typescript",
    ".json": "json",
    ".md":   "markdown",
    ".svg":  "xml",
    ".txt":  "plaintext",
  };
  return map[ext] || "plaintext";
}

function _fallbackFile(reason = "", content = null) {
  const safeReason = String(reason).replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 200);
  return {
    fileName: "index.html",
    content: content || `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Aquiplex</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px;background:#0f0f13;color:#e2e8f0;">
  <h1 style="margin-bottom:16px;">⚠️ Output Error</h1>
  <p style="color:#94a3b8;margin-bottom:24px;">${safeReason || "The AI returned an unrecognisable response."}</p>
  <button onclick="location.reload()"
    style="background:#6366f1;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;">
    Retry
  </button>
</body>
</html>`,
    language: "html",
  };
}

function parseMultiFileOutput(raw) {
  if (!raw || typeof raw !== "string") {
    console.warn("[PROJECT ENGINE] Parser received empty/null output — using fallback");
    return [_fallbackFile("LLM returned no output")];
  }

  let cleaned = raw
    .replace(/^```[\w]*\n?/gm, "")
    .replace(/^```\s*$/gm, "")
    .trim();

  cleaned = cleaned
    .replace(/={2,}\s*FILE\s*:\s*/gi, "=== FILE: ")
    .replace(/\s*={2,}\s*$/gm, " ===");

  const delimiterRe = /^={3}\s*FILE:\s*(.+?)\s*={3}\s*$/gm;
  const matches     = [];
  let   m;
  while ((m = delimiterRe.exec(cleaned)) !== null) {
    matches.push({ fileName: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }

  if (matches.length === 0) {
    const trimmed = cleaned.trim();
    if (trimmed.toLowerCase().includes("<!doctype") || trimmed.toLowerCase().includes("<html")) {
      console.warn("[PROJECT ENGINE] No FILE delimiters — raw HTML detected, wrapping as index.html");
      return [{ fileName: "index.html", content: trimmed, language: "html" }];
    }
    console.warn("[PROJECT ENGINE] No FILE delimiters and no HTML — using fallback");
    return [_fallbackFile("LLM output had no recognisable file delimiters", trimmed.slice(0, 500))];
  }

  const files = [];
  for (let i = 0; i < matches.length; i++) {
    const cur     = matches[i];
    const next    = matches[i + 1];
    let   content = next ? cleaned.slice(cur.end, next.start) : cleaned.slice(cur.end);
    content       = content.trim();

    if (!content) {
      console.warn(`[PROJECT ENGINE] Skipping empty file block: ${cur.fileName}`);
      continue;
    }

    const safeFileName = sanitizeFileName(cur.fileName);
    if (!safeFileName) {
      console.warn(`[PROJECT ENGINE] Skipping file with rejected name: ${cur.fileName}`);
      continue;
    }

    files.push({ fileName: safeFileName, content, language: inferLanguage(safeFileName) });
  }

  if (files.length === 0) {
    console.warn("[PROJECT ENGINE] All parsed file blocks empty/rejected — using fallback");
    return [_fallbackFile("All file blocks were empty or had disallowed extensions")];
  }

  const hasIndex = files.some(f => f.fileName === "index.html");
  if (!hasIndex) {
    const htmlFile = files.find(f => f.fileName.endsWith(".html"));
    if (htmlFile) {
      console.warn(`[PROJECT ENGINE] Renaming ${htmlFile.fileName} → index.html`);
      htmlFile.fileName = "index.html";
      htmlFile.language = "html";
    } else {
      console.warn("[PROJECT ENGINE] No HTML file found — injecting minimal index.html");
      files.unshift({
        fileName: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Generated Project</title>
  ${files.find(f => f.fileName === "style.css") ? '<link rel="stylesheet" href="style.css">' : ""}
</head>
<body>
  ${files.find(f => f.fileName === "script.js") ? '<script src="script.js"></script>' : ""}
</body>
</html>`,
        language: "html",
      });
    }
  }

  if (!files.some(f => f.fileName === "style.css")) {
    files.push({ fileName: "style.css", content: "/* Generated stylesheet */\n", language: "css" });
  }
  if (!files.some(f => f.fileName === "script.js")) {
    files.push({ fileName: "script.js", content: '"use strict";\n// Generated script\n', language: "javascript" });
  }

  console.log(`[PROJECT ENGINE] Parsed ${files.length} file(s): ${files.map(f => f.fileName).join(", ")}`);
  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE SYSTEM HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function projectDir(projectId) {
  const safe = String(projectId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid projectId");
  return path.join(PROJECTS_DIR, safe);
}

/**
 * Returns the resolved project directory with a trailing separator.
 * Used for reliable startsWith path-traversal checks.
 */
function _projectDirWithSep(projectId) {
  return projectDir(projectId) + path.sep;
}

async function _atomicWrite(filePath, content) {
  const dir     = path.dirname(filePath);
  const tmpPath = path.join(dir, `.tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function saveProjectFiles(projectId, files, meta = {}) {
  const dir    = projectDir(projectId);
  const dirSep = dir + path.sep;        // FIX: use explicit trailing sep for traversal check
  await fs.mkdir(dir, { recursive: true });

  let existingIndex = {};
  try {
    const raw     = await fs.readFile(path.join(dir, "_index.json"), "utf8");
    existingIndex = JSON.parse(raw);
  } catch {}

  const writeResults = await Promise.allSettled(
    files.map(async file => {
      const filePath = path.resolve(dir, file.fileName); // FIX: resolve so subdirs normalise correctly
      // FIX: startsWith(dirSep) handles both flat and subdir files safely
      if (!filePath.startsWith(dirSep)) {
        throw new Error(`Path traversal rejected: ${file.fileName}`);
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await _atomicWrite(filePath, file.content);
      return file.fileName;
    })
  );

  const written  = [];
  const failures = [];
  for (const r of writeResults) {
    if (r.status === "fulfilled") written.push(r.value);
    else failures.push(r.reason?.message);
  }

  if (failures.length > 0) {
    console.error(`[PROJECT ENGINE] Write failures: ${failures.join("; ")}`);
  }

  if (written.length === 0) {
    throw new Error("All file writes failed — project not saved");
  }

  const index = {
    ...existingIndex,
    ...meta,
    projectId:  String(projectId),
    files:      written,
    updatedAt:  new Date().toISOString(),
    createdAt:  existingIndex.createdAt || new Date().toISOString(),
  };

  await _atomicWrite(path.join(dir, "_index.json"), JSON.stringify(index, null, 2));
  console.log(`[PROJECT ENGINE] Saved project ${projectId} — ${written.length} file(s)`);
  return index;
}

async function readProjectFiles(projectId) {
  const dir = projectDir(projectId);
  try {
    const indexRaw = await fs.readFile(path.join(dir, "_index.json"), "utf8");
    const index    = JSON.parse(indexRaw);
    const files    = [];

    // FIX: guard against null/undefined index.files before iterating
    const indexFiles = Array.isArray(index.files) ? index.files : [];

    for (const fileName of indexFiles) {
      try {
        const content = await fs.readFile(path.join(dir, fileName), "utf8");
        files.push({ fileName, content, language: inferLanguage(fileName) });
      } catch (readErr) {
        console.warn(`[PROJECT ENGINE] Missing file skipped: ${fileName} (${readErr.message})`);
      }
    }

    // FIX: guard against null/undefined before .includes()
    if (!indexFiles.includes("index.html")) {
      try {
        const content = await fs.readFile(path.join(dir, "index.html"), "utf8");
        files.unshift({ fileName: "index.html", content, language: "html" });
        index.files = ["index.html", ...indexFiles];
        console.warn(`[PROJECT ENGINE] index.html recovered from disk`);
      } catch {}
    }

    return { index, files };
  } catch (err) {
    console.warn(`[PROJECT ENGINE] Could not read index for project ${projectId}: ${err.message}`);
    return { index: null, files: [] };
  }
}

async function readSingleFile(projectId, fileName) {
  const safeFile = sanitizeFileName(fileName);
  if (!safeFile) throw new Error("Invalid file name");
  const dir      = projectDir(projectId);
  const filePath = path.resolve(dir, safeFile);   // FIX: resolve for correct normalisation
  // FIX: removed unsafe `|| filePath !== dir` escape hatch — only allow files inside dir
  if (!filePath.startsWith(dir + path.sep)) {
    throw new Error("Forbidden path");
  }
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(`File not found: ${safeFile}`);
  }
}

async function writeSingleFile(projectId, fileName, content) {
  const safeFile = sanitizeFileName(fileName);
  if (!safeFile) throw new Error("Invalid file name");
  const dir      = projectDir(projectId);
  const filePath = path.resolve(dir, safeFile);   // FIX: resolve for correct normalisation
  // FIX: removed unsafe `|| filePath !== dir` escape hatch
  if (!filePath.startsWith(dir + path.sep)) {
    throw new Error("Forbidden path");
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await _atomicWrite(filePath, content);

  const indexPath = path.join(dir, "_index.json");
  try {
    const indexRaw = await fs.readFile(indexPath, "utf8");
    const index    = JSON.parse(indexRaw);
    if (!Array.isArray(index.files)) index.files = [];
    if (!index.files.includes(safeFile)) index.files.push(safeFile);
    index.updatedAt = new Date().toISOString();
    await _atomicWrite(indexPath, JSON.stringify(index, null, 2));
  } catch {
    const fallbackIndex = {
      projectId: String(projectId),
      files:     [safeFile],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await _atomicWrite(indexPath, JSON.stringify(fallbackIndex, null, 2));
  }

  console.log(`[PROJECT ENGINE] Wrote file: ${safeFile} → project ${projectId}`);
}

async function deleteProject(projectId) {
  await fs.rm(projectDir(projectId), { recursive: true, force: true });
}

async function listProjects() {
  try {
    const entries  = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const projects = [];

    await Promise.all(
      entries.map(async entry => {
        if (!entry.isDirectory()) return;
        try {
          const indexRaw = await fs.readFile(
            path.join(PROJECTS_DIR, entry.name, "_index.json"), "utf8"
          );
          const index = JSON.parse(indexRaw);
          projects.push({
            projectId: index.projectId  || entry.name,
            name:      index.name       || "Untitled Project",
            userId:    index.userId     || null,
            files:     Array.isArray(index.files) ? index.files : [],
            fileCount: Array.isArray(index.files) ? index.files.length : 0,
            createdAt: index.createdAt  || null,
            updatedAt: index.updatedAt  || null,
          });
        } catch {}
      })
    );

    projects.sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });

    return projects;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT SERVICES
// ─────────────────────────────────────────────────────────────────────────────

async function createProject(userId, name, projectId = null) {
  if (!userId) throw new Error("Unauthorized");
  const id  = projectId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });
  const index = {
    projectId: id,
    name:      (name || "Untitled Project").slice(0, 120),
    userId:    String(userId),
    files:     [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await _atomicWrite(path.join(dir, "_index.json"), JSON.stringify(index, null, 2));
  console.log(`[PROJECT ENGINE] Created project ${id} for user ${userId}`);
  return { success: true, projectId: id, name: index.name };
}

async function generateProject(userId, projectId, prompt) {
  if (!userId)               throw new Error("Unauthorized");
  if (!projectId || !prompt) throw new Error("projectId and prompt are required");

  console.log(`[AI ENGINE] generateProject start | project: ${projectId} | prompt: ${String(prompt).slice(0, 80)}`);

  const appType = detectAppType(prompt);

  const { rawOutput, source, intent } = await generateProjectUnified({
    prompt,
    mode:    "generate",
    appType,
  });

  const files = parseMultiFileOutput(rawOutput);

  let existingMeta = {};
  try {
    const raw    = await fs.readFile(path.join(projectDir(projectId), "_index.json"), "utf8");
    existingMeta = JSON.parse(raw);
  } catch {}

  const meta = {
    name:   (existingMeta.name || String(prompt).slice(0, 80) || "Generated Project"),
    userId: existingMeta.userId || String(userId),
    prompt: String(prompt).slice(0, 500),
    source,
    intent,
  };

  const index = await saveProjectFiles(projectId, files, meta);

  console.log(
    `[AI ENGINE] generateProject complete | project: ${projectId} | ` +
    `source: ${source} | files: ${files.map(f => f.fileName).join(", ")}`
  );

  return {
    success:   true,
    projectId,
    appType:   intent,
    name:      index.name,
    files:     files.map(f => f.fileName),
    fileData:  files,
    source,
  };
}

async function editProjectFile(userId, projectId, filename, command) {
  if (!userId)   throw new Error("Unauthorized");
  if (!filename) throw new Error("filename is required");
  if (!command)  throw new Error("edit command is required");

  const safeFilename = sanitizeFileName(filename);
  if (!safeFilename) throw new Error(`Invalid or disallowed filename: ${filename}`);

  console.log(`[AI ENGINE] editProjectFile start | project: ${projectId} | file: ${safeFilename}`);

  const { files: existingFiles } = await readProjectFiles(projectId);
  if (!existingFiles.length) throw new Error("Project not found or has no files");

  const targetExists = existingFiles.some(f => f.fileName === safeFilename);
  if (!targetExists) throw new Error(`File not found in project: ${safeFilename}`);

  const previousFiles = {};
  existingFiles.forEach(f => { previousFiles[f.fileName] = f.content; });

  const { rawOutput } = await generateProjectUnified({
    prompt:        command,
    mode:          "edit",
    editMode:      true,
    previousFiles,
    targetFile:    safeFilename,
  });

  const parsed = parseMultiFileOutput(rawOutput);

  if (!parsed.length) {
    throw new Error("AI returned no file content for edit — file was NOT modified");
  }

  const editedFile = parsed.find(f => f.fileName === safeFilename) || parsed[0];
  if (!editedFile || !editedFile.content || editedFile.content.trim().length < 10) {
    throw new Error(`AI returned empty content for ${safeFilename} — file was NOT modified`);
  }

  const writtenFiles = [];
  for (const file of parsed) {
    const targetName = (file.fileName === safeFilename || parsed.length === 1)
      ? safeFilename
      : sanitizeFileName(file.fileName);
    if (!targetName) continue;
    await writeSingleFile(projectId, targetName, file.content);
    writtenFiles.push(targetName);
  }

  if (writtenFiles.length === 0) {
    throw new Error("No files were written during edit — all targets were invalid");
  }

  console.log(`[AI ENGINE] editProjectFile complete | project: ${projectId} | updated: ${writtenFiles.join(", ")}`);

  return {
    success:      true,
    projectId,
    filename:     safeFilename,
    updatedFiles: writtenFiles,
  };
}

async function getProjectList(userId) {
  if (!userId) throw new Error("Unauthorized");
  const all      = await listProjects();
  const strUserId = String(userId);
  // FIX: require explicit userId match — never leak projects with missing/null userId
  const projects = all
    .filter(p => p.userId && p.userId === strUserId)
    .map(p => ({
      projectId: p.projectId,
      name:      p.name,
      fileCount: p.fileCount,
      files:     p.files,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  return { success: true, projects };
}

async function getProjectFiles(userId, projectId) {
  if (!projectId) throw new Error("projectId is required");
  const { index, files } = await readProjectFiles(projectId);
  if (!index) throw new Error("Project not found");

  const sorted = [
    ...files.filter(f => f.fileName === "index.html"),
    ...files.filter(f => f.fileName !== "index.html"),
  ];

  return {
    success:   true,
    projectId,
    name:      index.name || "Untitled Project",
    files:     sorted.map(f => f.fileName),
    fileData:  sorted,
    updatedAt: index.updatedAt || null,
  };
}

async function getProjectFile(userId, projectId, fileName) {
  if (!projectId || !fileName) throw new Error("projectId and fileName are required");
  const content = await readSingleFile(projectId, fileName);
  return { success: true, projectId, fileName, content };
}

async function saveProjectFile(userId, projectId, fileName, content) {
  if (!projectId || !fileName) throw new Error("projectId and fileName are required");
  if (content === undefined || content === null) throw new Error("content is required");
  const safeFile = sanitizeFileName(fileName);
  if (!safeFile) throw new Error(`Invalid or disallowed filename: ${fileName}`);
  await writeSingleFile(projectId, safeFile, content);
  return { success: true, projectId, fileName: safeFile };
}

async function deleteProjectById(userId, projectId) {
  if (!userId)    throw new Error("Unauthorized");
  if (!projectId) throw new Error("projectId is required");
  await deleteProject(projectId);
  console.log(`[PROJECT ENGINE] Deleted project ${projectId}`);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUNDLE STEP FALLBACK TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

const INSIGHT_TEMPLATES = [
  (t) => `${t} requires iterative validation to ensure quality output.`,
  (t) => `Key success metric for ${t}: measurable, time-bound deliverable.`,
  (t) => `${t} should be reviewed against initial goals before proceeding.`,
  (t) => `Automating ${t} reduces friction and improves consistency.`,
  (t) => `Cross-functional alignment on ${t} accelerates downstream execution.`,
  (t) => `Document all decisions made during ${t} for audit trail.`,
  (t) => `Risk surface in ${t} is minimized by parallel validation tracks.`,
  (t) => `${t} completion unlocks the critical path to the next milestone.`,
];

const OUTPUT_TEMPLATES = [
  (step, goal) =>
    `## ${step.title || "Step Output"}\n\n` +
    `**Execution Summary:**\n` +
    `This step focused on "${step.description || step.title}". ` +
    `Key deliverables have been identified and structured for downstream use.\n\n` +
    `**Goal Alignment:** ${goal || "No goal specified"}\n\n` +
    `**Next Action:** Review outputs and validate against acceptance criteria.`,

  (step, goal) =>
    `# ${step.title || "Step Complete"}\n\n` +
    `**Summary:** Completed analysis for "${step.description || step.title}".\n\n` +
    `**Key Outputs:**\n` +
    `- Primary deliverable drafted and ready for review\n` +
    `- Dependencies identified and documented\n` +
    `- Risk factors assessed\n\n` +
    `**Goal:** ${goal || "Not specified"}`,

  (step) =>
    `### ${step.title || "Progress Update"}\n\n` +
    `Completed: ${step.description || step.title}\n\n` +
    `This step has been executed according to the defined workflow. ` +
    `All outputs are available for the next phase of execution.`,
];

function generateInsights(title, idx) {
  return INSIGHT_TEMPLATES
    .slice(idx % INSIGHT_TEMPLATES.length)
    .concat(INSIGHT_TEMPLATES.slice(0, idx % INSIGHT_TEMPLATES.length))
    .slice(0, MAX_INSIGHTS)
    .map(fn => fn(title));
}

function generateNextHints(step, steps, idx) {
  const next = steps[idx + 1];
  if (!next) return ["Review all completed steps", "Finalize deliverables", "Archive project artifacts"];
  return [
    `Prepare inputs for: ${next.title || `Step ${idx + 2}`}`,
    `Verify completion criteria for current step`,
    `Align on dependencies before proceeding`,
  ];
}

function generateStepOutput(step, bundle, idx) {
  const templateFn = OUTPUT_TEMPLATES[idx % OUTPUT_TEMPLATES.length];
  const content    = templateFn(step, bundle?.goal || bundle?.title || "");

  return {
    stepIndex:       idx,
    stepTitle:       step.title || `Step ${idx + 1}`,
    content,
    keyInsights:     generateInsights(step.title || `Step ${idx + 1}`, idx),
    nextStepHints:   generateNextHints(step, Array.isArray(bundle?.steps) ? bundle.steps : [], idx),
    confidenceScore: 0.85,
    tokensUsed:      Math.floor(content.length / 4),
    durationMs:      null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateWorkspace(userId) {
  if (!userId) throw new Error("Unauthorized");
  let ws = await Workspace.findOne({ userId });
  if (!ws) ws = await new Workspace({ userId }).save();
  return ws;
}

function buildProgressArray(steps, existingProgress = []) {
  return steps.map((_, idx) => {
    const existing = existingProgress.find(p => p && p.step === idx);
    return existing || { step: idx, status: "pending", completedAt: null };
  });
}

function validateBundleId(bundleId) {
  if (!bundleId || !mongoose.Types.ObjectId.isValid(bundleId)) {
    throw new Error("Invalid bundleId");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SANITIZERS — strip internal fields before sending to client
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeBundleForClient(bundle) {
  if (!bundle) return null;
  const obj = bundle.toObject ? bundle.toObject() : { ...bundle };
  return obj;
}

function sanitizeWorkspaceForClient(ws) {
  if (!ws) return null;
  const obj = ws.toObject ? ws.toObject() : { ...ws };
  if (obj.workspaceMemory instanceof Map) {
    obj.workspaceMemory = Object.fromEntries(obj.workspaceMemory);
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE STATE
// ─────────────────────────────────────────────────────────────────────────────

async function getWorkspaceState(userId) {
  if (!userId) throw new Error("Unauthorized");
  const ws = await getOrCreateWorkspace(userId);

  const recentBundleIds = (ws.sessions || [])
    .filter(s => s && s.bundleId)
    .slice(-MAX_SESSIONS)
    .map(s => s.bundleId);

  const [recentBundles, allBundles] = await Promise.all([
    Bundle.find({ _id: { $in: recentBundleIds }, userId }).lean(),
    Bundle.find({ userId }).sort({ updatedAt: -1 }).limit(20).lean(),
  ]);

  const mem = ws.workspaceMemory instanceof Map
    ? Object.fromEntries(ws.workspaceMemory)
    : ws.workspaceMemory || {};

  return {
    success:      true,
    workspace:    sanitizeWorkspaceForClient(ws),
    recentBundles,
    allBundles,
    workspaceMemory: mem,
  };
}

async function getBundleState(userId, bundleId) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");
  const bundle = await Bundle.findOne({ _id: bundleId, userId });
  if (!bundle) throw new Error("Bundle not found");
  return { success: true, bundle: sanitizeBundleForClient(bundle) };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUNDLE EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

async function runBundle(userId, bundleId) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");

  const [ws, bundle] = await Promise.all([
    getOrCreateWorkspace(userId),
    Bundle.findOne({ _id: bundleId, userId }),
  ]);

  if (!bundle) throw new Error("Bundle not found");
  if (bundle.status === "completed") {
    return { success: true, bundle: sanitizeBundleForClient(bundle), alreadyComplete: true };
  }

  const steps = Array.isArray(bundle.steps) ? bundle.steps : [];
  if (steps.length === 0) throw new Error("Bundle has no steps");

  bundle.progress = buildProgressArray(steps, bundle.progress || []);
  bundle.status      = "active";
  bundle.currentStep = bundle.progress.findIndex(p => p && p.status !== "completed");
  if (bundle.currentStep === -1) bundle.currentStep = 0;

  if (typeof ws.openSession === "function") ws.openSession(bundleId, steps.length);
  ws.lastOpenBundleId = bundle._id;

  await Promise.all([bundle.save(), ws.save()]);

  return {
    success:   true,
    bundle:    sanitizeBundleForClient(bundle),
    workspace: sanitizeWorkspaceForClient(ws),
  };
}

async function completeStep(userId, bundleId, stepParam, payload = {}) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");

  const idx = parseInt(stepParam, 10);
  if (isNaN(idx) || idx < 0) throw new Error("Invalid step index");

  const [ws, bundle] = await Promise.all([
    getOrCreateWorkspace(userId),
    Bundle.findOne({ _id: bundleId, userId }),
  ]);

  if (!bundle) throw new Error("Bundle not found");
  if (bundle.status === "paused") throw new Error("Bundle is paused — resume before completing steps");

  const steps = Array.isArray(bundle.steps) ? bundle.steps : [];
  if (idx >= steps.length) throw new Error(`Step ${idx} out of range (bundle has ${steps.length} steps)`);

  if (!Array.isArray(bundle.progress) || bundle.progress.length !== steps.length) {
    bundle.progress = buildProgressArray(steps, bundle.progress || []);
  }

  let outputEntry;

  const useAI = payload.useAI === true || payload.aiGenerate === true;
  if (useAI) {
    try {
      const stepPrompt =
        `Project: ${bundle.title || "Untitled"}\n` +
        `Goal: ${bundle.goal || "No goal specified"}\n` +
        `Step: ${steps[idx]?.title || `Step ${idx + 1}`}\n` +
        `Description: ${steps[idx]?.description || "No description"}\n\n` +
        `Provide a detailed, actionable output for this step.`;

      const aiRes     = await generateProjectUnified({ prompt: stepPrompt, mode: "generate" });
      const rawOutput = aiRes.rawOutput;

      outputEntry = {
        stepIndex:       idx,
        stepTitle:       steps[idx]?.title || `Step ${idx + 1}`,
        content:         rawOutput,
        keyInsights:     generateInsights(steps[idx]?.title || `Step ${idx + 1}`, idx),
        nextStepHints:   generateNextHints(steps[idx], steps, idx),
        confidenceScore: 0.95,
        tokensUsed:      rawOutput.length / 4 | 0,
        durationMs:      null,
        projectId:       bundleId,
        files:           [],
        createdAt:       new Date(),
      };
    } catch (llmErr) {
      console.error("[AI ERROR] completeStep | AI generation error:", llmErr.message);
      const fallback = generateStepOutput(steps[idx] || {}, bundle, idx);
      outputEntry = {
        ...fallback,
        content:   `⚠️ Code generation failed: ${llmErr.message}\n\n${fallback.content}`,
        createdAt: new Date(),
      };
    }
  } else {
    const autoOutput = generateStepOutput(steps[idx] || {}, bundle, idx);
    outputEntry = {
      stepIndex:       idx,
      stepTitle:       payload.title            || autoOutput.stepTitle,
      content:         payload.content          || autoOutput.content,
      keyInsights:     payload.keyInsights      || autoOutput.keyInsights,
      nextStepHints:   payload.nextStepHints    || autoOutput.nextStepHints,
      confidenceScore: payload.confidenceScore !== undefined ? payload.confidenceScore : autoOutput.confidenceScore,
      tokensUsed:      payload.tokensUsed       || autoOutput.tokensUsed,
      durationMs:      payload.durationMs       || autoOutput.durationMs,
      createdAt:       new Date(),
    };
  }

  const progEntry = bundle.progress.find((p) => p && p.step === idx);
  if (progEntry) { progEntry.status = "completed"; progEntry.completedAt = new Date(); }
  else           bundle.progress.push({ step: idx, status: "completed", completedAt: new Date() });

  bundle.outputs = (bundle.outputs || []).filter((o) => o && o.stepIndex !== idx);
  bundle.outputs.push(outputEntry);

  const memEntries = payload.memoryEntries || {};
  if (bundle.memory instanceof Map) {
    for (const [k, v] of Object.entries(memEntries)) { if (k && v) bundle.memory.set(k.trim(), String(v).trim()); }
  } else {
    if (!bundle.memory || typeof bundle.memory !== "object") bundle.memory = {};
    for (const [k, v] of Object.entries(memEntries)) { if (k && v) bundle.memory[k.trim()] = String(v).trim(); }
  }

  const nextPending = bundle.progress.findIndex((p, i) => i > idx && p && p.status !== "completed");
  if (nextPending !== -1) { bundle.currentStep = nextPending; bundle.status = "active"; }
  else {
    const allDone      = bundle.progress.every((p) => p && p.status === "completed");
    bundle.status      = allDone ? "completed" : "active";
    bundle.currentStep = allDone ? steps.length - 1 : bundle.currentStep;
  }

  if (typeof ws.pushRecentOutput === "function") {
    ws.pushRecentOutput({
      bundleId, bundleTitle: bundle.title || "Untitled",
      stepIndex: idx, stepTitle: outputEntry.stepTitle, content: outputEntry.content || "",
    });
  }
  if (typeof ws.mergeWorkspaceMemory === "function") ws.mergeWorkspaceMemory(memEntries);

  if (bundle.status === "completed") {
    if (typeof ws.closeSession  === "function") ws.closeSession(bundleId, "completed");
  } else {
    if (typeof ws.updateSession === "function") ws.updateSession(bundleId, { currentStep: bundle.currentStep, status: "running" });
  }

  await Promise.all([bundle.save(), ws.save()]);

  return {
    success:   true,
    bundle:    sanitizeBundleForClient(bundle),
    workspace: sanitizeWorkspaceForClient(ws),
    output:    outputEntry,
  };
}

async function pauseBundle(userId, bundleId) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");
  const [ws, bundle] = await Promise.all([getOrCreateWorkspace(userId), Bundle.findOne({ _id: bundleId, userId })]);
  if (!bundle) throw new Error("Bundle not found");
  if (bundle.status === "completed") throw new Error("Cannot pause a completed bundle");
  if (bundle.status === "paused") return { success: true, bundle: sanitizeBundleForClient(bundle) };
  bundle.status = "paused";
  if (typeof ws.updateSession === "function") ws.updateSession(bundleId, { status: "paused" });
  await Promise.all([bundle.save(), ws.save()]);
  return { success: true, bundle: sanitizeBundleForClient(bundle), workspace: sanitizeWorkspaceForClient(ws) };
}

async function resumeBundle(userId, bundleId) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");
  const [ws, bundle] = await Promise.all([getOrCreateWorkspace(userId), Bundle.findOne({ _id: bundleId, userId })]);
  if (!bundle) throw new Error("Bundle not found");
  if (bundle.status === "completed") throw new Error("Bundle already completed");
  const steps    = Array.isArray(bundle.steps) ? bundle.steps : [];
  const progress = Array.isArray(bundle.progress) ? bundle.progress : buildProgressArray(steps, []);
  bundle.progress    = progress;
  const resumeFrom   = progress.findIndex((p) => p && p.status !== "completed");
  bundle.currentStep = resumeFrom !== -1 ? resumeFrom : 0;
  bundle.status      = "active";
  if (typeof ws.openSession === "function") ws.openSession(bundleId, steps.length);
  ws.lastOpenBundleId = bundle._id;
  await Promise.all([bundle.save(), ws.save()]);
  return { success: true, bundle: sanitizeBundleForClient(bundle), workspace: sanitizeWorkspaceForClient(ws) };
}

async function pinBundle(userId, bundleId) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");
  const ws = await getOrCreateWorkspace(userId);
  if (!Array.isArray(ws.pinnedBundles)) ws.pinnedBundles = [];
  const already = ws.pinnedBundles.some((id) => id && id.toString() === bundleId.toString());
  if (!already) { ws.pinnedBundles.push(new mongoose.Types.ObjectId(bundleId)); await ws.save(); }
  return { success: true, pinned: true, pinnedBundleIds: ws.pinnedBundles.map((id) => id.toString()) };
}

async function unpinBundle(userId, bundleId) {
  validateBundleId(bundleId);
  if (!userId) throw new Error("Unauthorized");
  const ws = await getOrCreateWorkspace(userId);
  if (!Array.isArray(ws.pinnedBundles)) ws.pinnedBundles = [];
  ws.pinnedBundles = ws.pinnedBundles.filter((id) => id && id.toString() !== bundleId.toString());
  await ws.save();
  return { success: true, pinned: false, pinnedBundleIds: ws.pinnedBundles.map((id) => id.toString()) };
}

async function updateWorkspaceMemory(userId, entries = {}) {
  if (!userId) throw new Error("Unauthorized");
  if (!entries || typeof entries !== "object") return { success: true };
  const ws = await getOrCreateWorkspace(userId);
  if (typeof ws.mergeWorkspaceMemory === "function") {
    ws.mergeWorkspaceMemory(entries);
  } else {
    for (const [k, v] of Object.entries(entries)) {
      if (k && v && ws.workspaceMemory instanceof Map) ws.workspaceMemory.set(k.trim(), String(v).trim());
    }
  }
  await ws.save();
  const mem = ws.workspaceMemory instanceof Map ? Object.fromEntries(ws.workspaceMemory) : ws.workspaceMemory || {};
  return { success: true, workspaceMemory: mem };
}

async function autoProgressNext(userId, bundleId) {
  try {
    const bundle = await Bundle.findOne({ _id: bundleId, userId });
    if (!bundle || bundle.status !== "active") return null;
    const steps = Array.isArray(bundle.steps) ? bundle.steps : [];
    const next  = (Array.isArray(bundle.progress) ? bundle.progress : []).findIndex(
      (p) => p && p.status !== "completed"
    );
    if (next === -1 || next >= steps.length) return null;
    return await completeStep(userId, bundleId, next, {});
  } catch (err) {
    console.error("[AI ERROR] autoProgressNext |", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  generateProjectUnified,
  getWorkspaceState,
  getBundleState,
  runBundle,
  completeStep,
  pauseBundle,
  resumeBundle,
  pinBundle,
  unpinBundle,
  updateWorkspaceMemory,
  autoProgressNext,
  createProject,
  generateProject,
  editProjectFile,
  getProjectList,
  getProjectFiles,
  getProjectFile,
  saveProjectFile,
  deleteProjectById,
  detectAppType,
  parseMultiFileOutput,
  readSingleFile,
  writeSingleFile,
  saveProjectFiles,
  projectDir,
  PROJECTS_DIR,
};