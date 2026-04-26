/**
 * services/intent.service.js — Aquiplex AI Site Builder
 *
 * STEP 1: Intent Detection Layer
 * - Primary: keyword matching (works with NO API)
 * - Secondary: optional AI classification
 *
 * Returns one of: calculator | portfolio | landing_page | blog | dashboard | form | unknown
 */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Keyword map — ordered by specificity (more specific first)
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_MAP = [
  {
    intent: "calculator",
    keywords: [
      "calculator", "calc", "calculate", "math", "arithmetic",
      "bmi", "tip calculator", "loan calculator", "mortgage",
      "unit converter", "currency converter", "converter",
      "percentage", "interest rate", "tax calculator",
    ],
  },
  {
    intent: "portfolio",
    keywords: [
      "portfolio", "personal site", "personal website", "about me",
      "resume", "cv", "my work", "showcase", "developer portfolio",
      "designer portfolio", "freelancer", "hire me",
    ],
  },
  {
    intent: "dashboard",
    keywords: [
      "dashboard", "admin panel", "admin dashboard", "analytics",
      "metrics", "stats", "statistics", "control panel", "management",
      "monitor", "overview panel", "data panel",
    ],
  },
  {
    intent: "blog",
    keywords: [
      "blog", "article", "post", "news", "newsletter",
      "magazine", "editorial", "writing", "journal",
    ],
  },
  {
    intent: "form",
    keywords: [
      "form", "contact form", "sign up", "signup", "registration",
      "survey", "quiz", "questionnaire", "feedback form",
      "application form", "booking form",
    ],
  },
  {
    intent: "landing_page",
    keywords: [
      "landing", "landing page", "saas", "startup", "product page",
      "marketing", "sales page", "waitlist", "coming soon",
      "app landing", "hero", "promo", "promotional",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Keyword matching (synchronous, zero-dependency)
// ─────────────────────────────────────────────────────────────────────────────

function detectByKeyword(prompt) {
  if (!prompt || typeof prompt !== "string") return "unknown";
  const lower = prompt.toLowerCase();

  for (const { intent, keywords } of INTENT_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return intent;
    }
  }

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional AI fallback (only called when keyword match returns "unknown")
// ─────────────────────────────────────────────────────────────────────────────

async function detectByAI(prompt, generateAI) {
  if (typeof generateAI !== "function") return "unknown";

  const aiPrompt = `Classify the following website request into EXACTLY ONE of these categories:
calculator | portfolio | landing_page | blog | dashboard | form | unknown

Rules:
- Return ONLY the category word, nothing else
- If unsure, return: landing_page
- Never return anything other than one of the 7 options above

Request: "${prompt}"`;

  try {
    const raw = await generateAI(
      [{ role: "user", content: aiPrompt }],
      { temperature: 0.1, maxTokens: 20 }
    );
    const result = raw.trim().toLowerCase().replace(/[^a-z_]/g, "");
    const valid = ["calculator", "portfolio", "landing_page", "blog", "dashboard", "form", "unknown"];
    return valid.includes(result) ? result : "landing_page";
  } catch {
    return "unknown";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — detectIntent(prompt, generateAI?)
// generateAI is optional; if not provided, keyword-only mode is used.
// ─────────────────────────────────────────────────────────────────────────────

async function detectIntent(prompt, generateAI = null) {
  // 1. Try keyword matching first (always works, zero latency)
  const kwResult = detectByKeyword(prompt);
  if (kwResult !== "unknown") {
    console.log(`[Intent] Keyword match: "${kwResult}" for prompt: "${prompt.slice(0, 60)}"`);
    return kwResult;
  }

  // 2. Keyword failed → try AI classification
  if (generateAI) {
    const aiResult = await detectByAI(prompt, generateAI);
    if (aiResult !== "unknown") {
      console.log(`[Intent] AI match: "${aiResult}" for prompt: "${prompt.slice(0, 60)}"`);
      return aiResult;
    }
  }

  // 3. Both failed → treat as landing_page (safest fallback)
  console.log(`[Intent] Fallback to landing_page for prompt: "${prompt.slice(0, 60)}"`);
  return "landing_page";
}

module.exports = { detectIntent, detectByKeyword };
