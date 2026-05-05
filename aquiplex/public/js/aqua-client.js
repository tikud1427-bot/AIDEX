/**
 * aqua-client.js — Frontend bridge for POST /aqua/execute
 *
 * Drop into your HTML workspace template or bundle with your JS.
 * Works standalone — no framework required.
 *
 * Usage:
 *   const aqua = new AquaClient({ baseUrl: "/api" });
 *
 *   aqua.send("change the button to red", {
 *     projectId: "abc-123",
 *     fileName:  "style.css",
 *     onPreviewRefresh: () => document.getElementById("preview-iframe").src += "",
 *     onMessage:        (msg)  => appendToChatUI(msg),
 *     onError:          (err)  => showError(err),
 *   });
 */

class AquaClient {
  constructor({ baseUrl = "/api" } = {}) {
    this.baseUrl        = baseUrl;
    this.sessionHistory = [];
  }

  /**
   * send(message, options)
   *
   * @param {string} message
   * @param {object} opts
   *   projectId       : string?   — active project
   *   fileName        : string?   — currently open file
   *   onMessage       : fn(text)  — called with AI response text
   *   onPreviewRefresh: fn()      — called when preview iframe should reload
   *   onIntent        : fn(intent)— called with detected intent string
   *   onFiles         : fn(files) — called with generated files array
   *   onError         : fn(err)   — called on error
   */
  async send(message, opts = {}) {
    const { projectId, fileName, onMessage, onPreviewRefresh, onIntent, onFiles, onError } = opts;

    // Append to session history (for context threading)
    this.sessionHistory.push({ role: "user", content: message });

    // Keep last 10 turns
    if (this.sessionHistory.length > 20) {
      this.sessionHistory = this.sessionHistory.slice(-20);
    }

    let data;
    try {
      const res = await fetch(`${this.baseUrl}/aqua/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message,
          projectId:      projectId || null,
          fileName:       fileName  || null,
          sessionHistory: this.sessionHistory.slice(0, -1), // exclude current message
        }),
      });

      data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      if (typeof onError === "function") onError(err.message || "Request failed");
      return null;
    }

    // Append assistant reply to session history
    this.sessionHistory.push({ role: "assistant", content: data.message || "" });

    // Fire callbacks
    if (typeof onIntent   === "function" && data.intent)         onIntent(data.intent);
    if (typeof onMessage  === "function" && data.message)        onMessage(data.message);
    if (typeof onFiles    === "function" && data.files?.length)  onFiles(data.files);

    if (data.previewRefresh && typeof onPreviewRefresh === "function") {
      // Small delay to let mirror finish
      setTimeout(onPreviewRefresh, 600);
    }

    return data;
  }

  /**
   * checkIntent(message, context) — lightweight: does not execute, just classifies
   */
  async checkIntent(message, context = {}) {
    try {
      const res  = await fetch(`${this.baseUrl}/aqua/intent-check`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message, ...context }),
      });
      return await res.json();
    } catch {
      return { intent: "chat", confidence: 0, targetFiles: [] };
    }
  }

  /**
   * loadContext(projectId, fileName?) — load project state for the editor
   */
  async loadContext(projectId, fileName = null) {
    try {
      const url = `${this.baseUrl}/aqua/context/${projectId}${fileName ? `?file=${encodeURIComponent(fileName)}` : ""}`;
      const res = await fetch(url);
      return await res.json();
    } catch {
      return null;
    }
  }

  /** clearHistory() — reset conversation memory */
  clearHistory() {
    this.sessionHistory = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-wire: if this page has a standard AQUIPLEX workspace layout,
// bind AQUA client to the chat input automatically.
// Remove this block if you prefer manual wiring.
// ─────────────────────────────────────────────────────────────────────────────

(function autoWire() {
  if (typeof document === "undefined") return; // SSR safety

  document.addEventListener("DOMContentLoaded", () => {
    const chatInput   = document.getElementById("aqua-chat-input");
    const sendBtn     = document.getElementById("aqua-send-btn");
    const chatLog     = document.getElementById("aqua-chat-log");
    const previewIframe = document.getElementById("preview-iframe");

    if (!chatInput || !sendBtn) return; // not on workspace page

    const aqua = new AquaClient({ baseUrl: "/api" });

    function getProjectId() {
      return document.body.dataset.projectId ||
             document.getElementById("project-id-input")?.value ||
             null;
    }

    function getFileName() {
      return document.querySelector(".file-tab.active")?.dataset?.filename ||
             document.getElementById("active-file-name")?.textContent?.trim() ||
             null;
    }

    function appendMessage(role, text) {
      if (!chatLog) return;
      const el = document.createElement("div");
      el.className = `aqua-msg aqua-msg--${role}`;
      el.textContent = text;
      chatLog.appendChild(el);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function showIntentBadge(intent) {
      const badge = document.getElementById("aqua-intent-badge");
      if (!badge) return;
      badge.textContent = intent.replace(/_/g, " ");
      badge.dataset.intent = intent;
    }

    async function onSend() {
      const msg = chatInput.value.trim();
      if (!msg) return;

      chatInput.value = "";
      appendMessage("user", msg);

      // Optimistic intent display
      const ic = await aqua.checkIntent(msg, {
        projectId:    getProjectId(),
        projectFiles: [], // optionally populate from DOM
      });
      showIntentBadge(ic.intent);

      const result = await aqua.send(msg, {
        projectId:  getProjectId(),
        fileName:   getFileName(),

        onMessage: (text) => appendMessage("assistant", text),

        onPreviewRefresh: () => {
          if (previewIframe) {
            const src = previewIframe.src;
            previewIframe.src = "";
            previewIframe.src = src;
          }
        },

        onError: (err) => appendMessage("error", `⚠️ ${err}`),
      });

      // If a new project was generated, update project ID in DOM
      if (result?.projectId && !getProjectId()) {
        if (document.body.dataset) document.body.dataset.projectId = result.projectId;
      }
    }

    sendBtn.addEventListener("click", onSend);
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
    });

    console.log("[AQUA] Client auto-wired ✅");
  });
})();
