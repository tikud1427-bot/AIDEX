"use strict";

/**
 * memory/memory.service.js — AQUIPLEX Memory Service
 *
 * Provides user memory retrieval and extraction for the orchestrator.
 * All functions are safe — never throw, always return usable defaults.
 *
 * To wire a real DB: replace stub bodies with your persistence logic.
 */

const { createLogger } = require("../utils/logger");
const log = createLogger("MEMORY_SVC");

// ── In-process fallback store (lost on restart — replace with DB) ─────────────
const _store = new Map(); // userId → string

// ── getUserMemory ─────────────────────────────────────────────────────────────

/**
 * getUserMemory(userId, currentMessage) → string
 * Returns a condensed memory string to inject into system prompt.
 * Empty string = no memory (safe default).
 *
 * @param {string} userId
 * @param {string} currentMessage  — used for semantic retrieval if implemented
 * @returns {Promise<string>}
 */
async function getUserMemory(userId, currentMessage) {
  if (!userId) return "";
  try {
    return _store.get(String(userId)) || "";
  } catch (e) {
    log.warn(`getUserMemory failed: ${e.message}`);
    return "";
  }
}

// ── extractMemory ─────────────────────────────────────────────────────────────

/**
 * extractMemory(userId, message, aiCallFn)
 * Async fire-and-forget — extracts facts from message and persists them.
 *
 * @param {string}   userId
 * @param {string}   message
 * @param {Function} aiCallFn  — async (messages) → string  (provided by orchestrator)
 * @returns {Promise<void>}
 */
async function extractMemory(userId, message, aiCallFn) {
  if (!userId || !message || typeof aiCallFn !== "function") return;
  try {
    const messages = [
      {
        role:    "system",
        content: "Extract key facts about the user from this message as a short bullet list. If nothing notable, return empty string.",
      },
      { role: "user", content: message },
    ];
    const extracted = await aiCallFn(messages);
    if (extracted && extracted.trim()) {
      const prev    = _store.get(String(userId)) || "";
      const updated = [prev, extracted.trim()].filter(Boolean).join("\n").slice(-2000);
      _store.set(String(userId), updated);
      log.info(`Memory updated for user ${userId}`);
    }
  } catch (e) {
    log.warn(`extractMemory failed: ${e.message}`);
  }
}

// ── clearMemory ───────────────────────────────────────────────────────────────

/**
 * clearMemory(userId) → void
 */
async function clearMemory(userId) {
  if (!userId) return;
  _store.delete(String(userId));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { getUserMemory, extractMemory, clearMemory };
