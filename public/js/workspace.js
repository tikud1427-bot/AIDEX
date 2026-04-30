/**
 * workspace.js — Aquiplex Editor Frontend [v5]
 *
 * CHANGELOG v5:
 * - [FIX] Debounced live preview: editor input → refreshPreview() with 300ms debounce.
 *         Prevents iframe thrashing on every keystroke.
 * - [FIX] Single addEventListener("load") init block — no duplicate listeners.
 * - [FIX] Preview indicator: "Updating preview…" shown during debounce window.
 * - [FIX] refreshPreview() uses correct /preview/ route with cache-busting ?t=.
 * - [FIX] loadFile() + saveFile() + applyEdit() all guard CURRENT_PROJECT_ID.
 * - [FIX] Mobile tab switching: switchTab() correctly shows/hides panes.
 * - [FIX] saveCurrentFile() / focusAiEdit() exposed globally for command palette.
 */

/* ================= GLOBAL STATE ================= */
const STATE = {
  activeFile: null,
  files:      {},
  activeTab:  "editor",
  busy:       false,      // true during AI edit — blocks concurrent calls
};

// Injected by EJS: <script>window.PROJECT_ID = "<%= openProjectId %>";</script>
const CURRENT_PROJECT_ID = window.PROJECT_ID || null;


/* ================= TAB SYSTEM (mobile) ================= */
function switchTab(tab) {
  STATE.activeTab = tab;

  document.querySelectorAll(".mobile-view").forEach(el => {
    el.classList.remove("active");
  });

  if (tab === "editor") {
    document.getElementById("editorPane")?.classList.add("active");
  }

  if (tab === "preview") {
    document.getElementById("previewPane")?.classList.add("active");
    // Refresh preview whenever user manually switches to preview tab
    refreshPreview();
  }

  if (tab === "files") {
    toggleSidebar(true);
  }
}


/* ================= SIDEBAR ================= */
function toggleSidebar(forceOpen = false) {
  const sb = document.getElementById("sidebar");
  if (!sb) return;
  if (forceOpen) sb.classList.add("open");
  else sb.classList.toggle("open");
}


/* ================= PREVIEW ================= */

/**
 * refreshPreview — reloads iframe from the /preview/ static-serving route.
 * Cache-busted with ?t=Date.now() to guarantee fresh content.
 */
function refreshPreview() {
  const iframe = document.getElementById("previewFrame");
  if (!iframe || !CURRENT_PROJECT_ID) return;

  const base = `/workspace/project/${encodeURIComponent(CURRENT_PROJECT_ID)}/preview/index.html`;
  iframe.src  = base + "?t=" + Date.now();
}

/**
 * _setPreviewStatus — show/hide a lightweight "Updating preview…" label.
 * Requires a <div id="previewStatus"> near the iframe in the template.
 * Silently skips if the element isn't present.
 */
function _setPreviewStatus(active) {
  const el = document.getElementById("previewStatus");
  if (!el) return;
  el.textContent = active ? "Updating preview…" : "";
  el.style.display = active ? "block" : "none";
}

/**
 * _makeDebounced — returns a debounced wrapper for fn.
 * Prevents calling fn more than once per `delay` ms burst.
 */
function _makeDebounced(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Debounced preview refresh — 300ms after last keystroke.
// Preview status is shown during the debounce window.
let _previewDebounceTimer = null;

function _schedulePreviewRefresh() {
  _setPreviewStatus(true);
  clearTimeout(_previewDebounceTimer);
  _previewDebounceTimer = setTimeout(() => {
    _setPreviewStatus(false);
    refreshPreview();
  }, 300);
}


/* ================= LOAD FILE ================= */
async function loadFile(name) {
  if (!CURRENT_PROJECT_ID) {
    toast("No project loaded", "error");
    return;
  }

  try {
    STATE.activeFile = name;

    const res = await fetch(
      `/workspace/file/${CURRENT_PROJECT_ID}/${encodeURIComponent(name)}`
    );

    if (!res.ok) throw new Error("Failed to load file");

    const data = await res.json();
    const content = data.file?.content ?? "";

    STATE.files[name] = content;

    const editor = document.getElementById("editor");
    const label  = document.getElementById("currentFile");

    if (editor) editor.value = content;
    if (label)  label.innerText = name;

    // Switch to editor tab on mobile
    if (window.innerWidth < 768) {
      switchTab("editor");
    }

  } catch (err) {
    toast(err.message || "Load failed", "error");
  }
}


/* ================= SAVE FILE ================= */
async function saveFile() {
  if (!STATE.activeFile || !CURRENT_PROJECT_ID) return;

  const content = document.getElementById("editor")?.value ?? "";

  try {
    const res = await fetch("/workspace/save-file", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        projectId: CURRENT_PROJECT_ID,
        fileName:  STATE.activeFile,
        content,
      }),
    });

    if (!res.ok) throw new Error("Save failed");

    toast("Saved ✓", "success");

    // Refresh preview immediately after save (content is now mirrored)
    refreshPreview();

  } catch (err) {
    toast(err.message || "Save error", "error");
  }
}

/** Alias used by command palette */
function saveCurrentFile() { saveFile(); }


/* ================= AI EDIT ================= */
async function applyEdit() {
  if (!STATE.activeFile || !CURRENT_PROJECT_ID) {
    toast("No file selected", "error");
    return;
  }

  const btn   = document.getElementById("aiEditBtn");
  const input = document.getElementById("aiEditInput");

  const prompt = input?.value?.trim();
  if (!prompt) return;

  STATE.busy    = true;
  btn.disabled  = true;
  btn.innerText = "Applying…";

  try {
    const res = await fetch("/workspace/edit-file", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        projectId:   CURRENT_PROJECT_ID,
        fileName:    STATE.activeFile,
        instruction: prompt,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) throw new Error(data.error || "Edit failed");

    if (!data.updatedFiles || data.updatedFiles.length === 0) {
      throw new Error("No changes applied");
    }

    await loadFile(STATE.activeFile);
    refreshPreview();

    if (input) input.value = "";

    toast("Edit applied ✓", "success");

  } catch (err) {
    toast(err.message || "Edit error", "error");
  } finally {
    STATE.busy    = false;
    btn.disabled  = false;
    btn.innerText = "Edit";
  }
}

/** Alias used by command palette */
function focusAiEdit() {
  const input = document.getElementById("aiEditInput");
  if (input) input.focus();
}

/** Open preview in a new tab */
function openPreviewInTab() {
  if (!CURRENT_PROJECT_ID) return;
  const url = `/workspace/project/${encodeURIComponent(CURRENT_PROJECT_ID)}/preview/index.html`;
  window.open(url, "_blank");
}


/* ================= LOAD FILE LIST ================= */
async function loadFileList() {
  if (!CURRENT_PROJECT_ID) return;

  try {
    const res = await fetch(`/workspace/files/${CURRENT_PROJECT_ID}`);
    if (!res.ok) throw new Error("Failed to load files");

    const data = await res.json();

    const list = document.getElementById("fileList");
    if (!list) return;

    list.innerHTML = "";

    (data.files || []).forEach(file => {
      const item      = document.createElement("div");
      item.className  = "file-item";
      item.innerText  = file;
      item.onclick    = () => loadFile(file);
      list.appendChild(item);
    });

    // Auto-load first file
    if (data.files?.length) {
      loadFile(data.files[0]);
    }

  } catch (err) {
    toast(err.message || "File list error", "error");
  }
}


/* ================= TOAST ================= */
function toast(msg, type = "info") {
  const root = document.getElementById("aq-toast-root") || _createToastRoot();

  const el      = document.createElement("div");
  el.className  = "aq-toast " + type;
  el.innerText  = msg;

  root.appendChild(el);

  setTimeout(() => {
    el.classList.add("fadeout");
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

function _createToastRoot() {
  const div = document.createElement("div");
  div.id    = "aq-toast-root";
  document.body.appendChild(div);
  return div;
}


/* ================= INIT ================= */
window.addEventListener("load", () => {
  if (!CURRENT_PROJECT_ID) {
    toast("No project loaded", "error");
    return;
  }

  // Initial render
  refreshPreview();
  loadFileList();

  if (window.innerWidth < 768) {
    switchTab("editor");
  }

  // ── Live preview: debounced on editor input ─────────────────────────────
  // Uses "input" event (fires on every character change).
  // _schedulePreviewRefresh debounces 300ms + shows status indicator.
  // This is the ONLY place this listener is attached — no duplicates.
  const editor = document.getElementById("editor");
  if (editor) {
    editor.addEventListener("input", _schedulePreviewRefresh);
  }

  // ── Keyboard shortcut: Ctrl/Cmd + S → save ────────────────────────────
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveFile();
    }
  });
});
