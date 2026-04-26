/**
 * services/ai.service.js — Aquiplex AI Site Builder
 *
 * STEP 4: AI Generation Service
 *
 * Wraps the existing multi-provider AI waterfall in project.routes.js
 * with STRICT output validation, retry (max 2), sanitization.
 * Returns null on any failure so the builder fallback triggers.
 *
 * Expected output format:
 * {
 *   "files": {
 *     "index.html": "...",
 *     "style.css": "...",
 *     "script.js": "..."
 *   }
 * }
 */

"use strict";

const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — tells AI exactly what JSON structure to return
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert web developer. Generate complete, production-quality websites.

CRITICAL RULES (if you break any of these, the output is invalid and will be discarded):
1. Respond ONLY with a valid JSON object. NO prose, NO markdown, NO explanation before or after.
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
5. Make the site visually stunning — real gradients, animations, professional typography
6. ALL CSS in style.css (linked from index.html). ALL JS in script.js (linked from index.html)
7. index.html must link: <link rel="stylesheet" href="style.css">
8. index.html must link: <script src="script.js"></script> (only if JS needed)
9. NO external CDN dependencies — use Google Fonts via @import in CSS only
10. Content must be realistic, detailed and filled-in — NO placeholder text like "Lorem ipsum"
11. The JSON keys in "files" must be EXACTLY the filename strings (e.g. "index.html")
12. Escape all double quotes inside file content as \\\\"`;

// ─────────────────────────────────────────────────────────────────────────────
// JSON extraction — handles fences, leading/trailing prose
// ─────────────────────────────────────────────────────────────────────────────

function extractJSON(raw) {
  if (!raw || typeof raw !== "string") return null;

  // Strip common code fences
  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Find outermost { ... }
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
  if (Array.isArray(parsed.files)) return false; // old array format — reject

  const files = parsed.files;
  const keys  = Object.keys(files);

  if (keys.length === 0) return false;
  if (!files["index.html"] || typeof files["index.html"] !== "string") return false;
  if (files["index.html"].trim().length < 50) return false; // sanity check

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitize — normalize file content strings
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeOutput(parsed) {
  const result = { files: {} };

  for (const [filename, content] of Object.entries(parsed.files)) {
    if (typeof content !== "string") continue;
    // Normalize newlines, trim
    result.files[filename] = content.replace(/\\r\\n/g, "\\n").trim();
  }

  // Ensure index.html always exists
  if (!result.files["index.html"]) return null;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Single AI provider call helper
// ─────────────────────────────────────────────────────────────────────────────

async function callProvider(provider, systemPrompt, userPrompt) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt   },
  ];

  if (provider === "groq") {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: "llama-3.1-70b-versatile", messages, temperature: 0.4, max_tokens: 8192 },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 45000,
      }
    );
    return res.data?.choices?.[0]?.message?.content || null;
  }

  if (provider === "openrouter") {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "mistralai/mixtral-8x7b-instruct", messages, temperature: 0.4, max_tokens: 8192 },
      {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 50000,
      }
    );
    return res.data?.choices?.[0]?.message?.content || null;
  }

  if (provider === "gemini") {
    const key = process.env.Gemini_API_Key;
    if (!key) return null;
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        contents: [{ role: "user", parts: [{ text: systemPrompt + "\\n\\n" + userPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
      },
      { timeout: 40000 }
    );
    return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: generateWebsiteFiles(prompt)
// Returns { files: { "index.html": "...", ... } } or null
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS = ["groq", "openrouter", "gemini"];
const MAX_RETRIES = 2;

async function generateWebsiteFiles(prompt) {
  const userPrompt = `Build this website: ${prompt}

IMPORTANT: Respond with ONLY the JSON object. No text before or after the JSON. No markdown code fences.`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const provider = PROVIDERS[attempt % PROVIDERS.length];

    try {
      console.log(`[AI Service] Attempt ${attempt + 1}/${MAX_RETRIES + 1} via ${provider}`);

      const raw    = await callProvider(provider, SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw);

      if (!parsed) {
        console.warn(`[AI Service] Attempt ${attempt + 1}: Could not extract JSON from ${provider} response`);
        continue;
      }

      if (!isValidOutput(parsed)) {
        console.warn(`[AI Service] Attempt ${attempt + 1}: Invalid output structure from ${provider}`);
        continue;
      }

      const sanitized = sanitizeOutput(parsed);
      if (!sanitized) {
        console.warn(`[AI Service] Attempt ${attempt + 1}: Sanitization failed`);
        continue;
      }

      console.log(`[AI Service] ✅ Success via ${provider} on attempt ${attempt + 1}`);
      return sanitized;

    } catch (err) {
      console.warn(`[AI Service] Attempt ${attempt + 1} (${provider}) threw: ${err.message}`);
    }
  }

  // All attempts exhausted
  console.warn("[AI Service] All attempts failed — returning null for fallback");
  return null;
}

module.exports = { generateWebsiteFiles };
