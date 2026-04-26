/**
 * services/builder.service.js — Aquiplex AI Site Builder
 *
 * STEP 3: Builder Orchestrator (core brain)
 *
 * Flow:
 *   1. detectIntent(prompt)
 *   2. Try AI generation
 *   3. Validate AI output
 *   4. If invalid OR fails → fallback to template
 *   5. Return guaranteed { files: { "index.html": "...", ... } }
 *
 * This service ALWAYS returns a working result. Never throws.
 */

"use strict";

const { detectIntent }         = require("./intent.service");
const { generateWebsiteFiles } = require("./ai.service");

// ── Template map — lazy-loaded to avoid circular deps ─────────────────────────
function loadTemplate(intent) {
  const templateMap = {
    calculator:   "./templates/calculator",
    portfolio:    "./templates/portfolio",
    landing_page: "./templates/landing",
    blog:         "./templates/landing",       // landing fallback for blog
    dashboard:    "./templates/landing",       // landing fallback for dashboard
    form:         "./templates/landing",       // landing fallback for form
    unknown:      "./templates/landing",
  };

  const tplPath = templateMap[intent] || "./templates/landing";

  try {
    // Resolve relative to project root
    const resolved = require("path").join(process.cwd(), tplPath);
    return require(resolved);
  } catch (err) {
    console.error(`[Builder] Failed to load template "${tplPath}":`, err.message);
    // Ultra-last-resort: return a static minimal HTML
    return {
      generateTemplate: () => ({
        files: {
          "index.html": `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>My Site</title><link rel="stylesheet" href="style.css"/></head><body><div class="hero"><h1>Welcome</h1><p>Your site is being set up. Edit this page to get started.</p></div><script src="script.js"></script></body></html>`,
          "style.css":  `*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#0d0f14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}.hero{text-align:center;padding:40px 24px}h1{font-size:3rem;font-weight:800;margin-bottom:16px;background:linear-gradient(135deg,#6366f1,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}p{color:#64748b;font-size:1.1rem}`,
          "script.js":  `"use strict";console.log("Site ready");`,
        }
      }),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert AI output (object files map) to standard format if needed
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAIOutput(aiResult) {
  if (!aiResult || !aiResult.files) return null;

  // AI service always returns { files: { "filename": "content" } }
  // Template engine returns the same format — unified.
  return aiResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: generate(prompt, options?)
//
// options.skipAI = true → jump straight to template (for testing)
// options.generateAI    → pass the generateAI fn for intent AI fallback
//
// Always resolves. Never rejects.
// ─────────────────────────────────────────────────────────────────────────────

async function generate(prompt, options = {}) {
  const { skipAI = false, generateAI = null } = options;

  console.log(`[Builder] generate() called — prompt: "${(prompt || "").slice(0, 80)}"`);

  // ── 1. Detect intent ────────────────────────────────────────────────────────
  let intent = "unknown";
  try {
    intent = await detectIntent(prompt, generateAI);
  } catch (err) {
    console.warn("[Builder] detectIntent threw:", err.message);
    intent = "landing_page";
  }

  console.log(`[Builder] Intent: ${intent}`);

  // ── 2. Try AI generation (unless skipped) ──────────────────────────────────
  if (!skipAI) {
    try {
      const aiResult = await generateWebsiteFiles(prompt);
      const normalized = normalizeAIOutput(aiResult);

      if (normalized && normalized.files && normalized.files["index.html"]) {
        console.log("[Builder] ✅ AI generation succeeded");
        return {
          files:    normalized.files,
          source:   "ai",
          intent,
        };
      } else {
        console.warn("[Builder] AI returned empty/invalid — falling back to template");
      }
    } catch (err) {
      console.warn("[Builder] AI threw unexpectedly:", err.message, "— falling back");
    }
  }

  // ── 3. Fallback: load template ─────────────────────────────────────────────
  try {
    const tpl    = loadTemplate(intent);
    const result = tpl.generateTemplate(prompt);

    if (!result || !result.files || !result.files["index.html"]) {
      throw new Error("Template returned invalid output");
    }

    console.log(`[Builder] ✅ Template fallback used (intent: ${intent})`);
    return {
      files:  result.files,
      source: "template",
      intent,
    };

  } catch (err) {
    console.error("[Builder] Template fallback failed:", err.message);

    // ── 4. Nuclear fallback — should literally never happen ────────────────
    return {
      files: {
        "index.html": `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>My Site</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#0d0f14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.w{padding:40px 24px}h1{font-size:2.8rem;font-weight:800;background:linear-gradient(135deg,#6366f1,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:16px}p{color:#64748b}</style></head><body><div class="w"><h1>Your Site</h1><p>Site generated successfully. Start editing to customize.</p></div></body></html>`,
        "style.css":  "",
        "script.js":  `"use strict";`,
      },
      source: "nuclear_fallback",
      intent,
    };
  }
}

module.exports = { generate };
