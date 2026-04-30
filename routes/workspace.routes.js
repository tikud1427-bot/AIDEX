/**
 * workspace.routes.js — AQUIPLEX Production (v6)
 *
 * FIXES v6:
 * - [FIX-CRITICAL] mirrorSingleFile after /edit-file: result.updatedFiles is string[]
 *   (file names only). Must read content from svc after edit, not from result.updatedFiles.
 *   Old code tried f.fileName / f.content on a string — mirror was NEVER called.
 * - [FIX-PREVIEW] After save-file: mirror now verified working.
 * - [FIX-PREVIEW] After edit-file: read each updated file's content from svc then mirror.
 */

"use strict";

const express   = require("express");
const router    = express.Router();
const mongoose  = require("mongoose");
const fs        = require("fs");
const path      = require("path");
const Workspace = require("../models/Workspace");
const Bundle    = require("../models/Bundle");
const svc       = require("../services/workspace.service");

// ── Mount Project Engine ──────────────────────────────────────────────────────
const projectRoutes = require("./project.routes");
router.use("/project", projectRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Mirror root — MUST match PROJECTS_ROOT in project.routes.js
// ─────────────────────────────────────────────────────────────────────────────
const PROJECTS_ROOT = path.join(process.cwd(), "projects");

const ALLOWED_MIRROR_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".cjs",
  ".ts", ".json", ".svg", ".md", ".txt",
  ".png", ".jpg", ".jpeg", ".gif", ".ico",
  ".woff", ".woff2", ".ttf",
]);

function mirrorSingleFile(projectId, fileName, content) {
  try {
    const safe = path.basename(projectId);
    if (!safe || safe !== projectId) return;

    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_MIRROR_EXTENSIONS.has(ext)) return;

    const dir      = path.join(PROJECTS_ROOT, safe);
    const safeName = path.basename(fileName);
    if (!safeName) return;

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safeName), content, "utf8");
    console.log(`[WS ROUTE] Mirrored ${safeName} → ${dir}`);
  } catch (e) {
    console.warn("[WS ROUTE] mirrorSingleFile failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function handleErr(res, err, fallbackStatus = 500) {
  console.error("[WS ROUTE]", err.message || err);
  const msg    = err.message || "Internal server error";
  const status =
    msg.includes("not found")    ? 404 :
    msg.includes("Invalid")      ? 400 :
    msg.includes("Unauthorized") ? 401 :
    msg.includes("already")      ? 409 :
    fallbackStatus;
  res.status(status).json({ error: msg, success: false });
}

function uid(req) {
  return (
    req.session?.userId          ||
    req.session?.user?._id       ||
    req.user?._id                ||
    req.user?.id                 ||
    null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace  — Render workspace page
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.redirect("/login");

    let ws = await Workspace.findOne({ userId }).populate("tools").lean();
    if (!ws) {
      ws = await new Workspace({ userId }).save();
      ws = ws.toObject ? ws.toObject() : ws;
    }

    if (ws.workspaceMemory instanceof Map) {
      ws.workspaceMemory = Object.fromEntries(ws.workspaceMemory);
    }

    const bundles = await Bundle.find({ userId }).sort({ updatedAt: -1 }).lean();

    res.render("workspace", {
      workspace:       ws,
      bundles,
      page:            "workspace",
      openProjectId:   null,
      openProjectName: null,
    });
  } catch (err) {
    console.error("[WS] render:", err);
    res.status(500).send("Workspace unavailable");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/state
// ─────────────────────────────────────────────────────────────────────────────

router.get("/state", async (req, res) => {
  try {
    const data = await svc.getWorkspaceState(uid(req));
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/bundle/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

router.get("/bundle/:bundleId", async (req, res) => {
  try {
    const data = await svc.getBundleState(uid(req), req.params.bundleId);
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/run/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/run/:bundleId", async (req, res) => {
  try {
    const data = await svc.runBundle(uid(req), req.params.bundleId);
    res.json(data);
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/step/:bundleId/:step
// ─────────────────────────────────────────────────────────────────────────────

router.post("/step/:bundleId/:step", async (req, res) => {
  try {
    const payload = req.body || {};
    const data = await svc.completeStep(
      uid(req),
      req.params.bundleId,
      req.params.step,
      payload
    );
    res.json(data);
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/pause/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/pause/:bundleId", async (req, res) => {
  try {
    res.json(await svc.pauseBundle(uid(req), req.params.bundleId));
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/resume/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/resume/:bundleId", async (req, res) => {
  try {
    res.json(await svc.resumeBundle(uid(req), req.params.bundleId));
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/pin/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/pin/:bundleId", async (req, res) => {
  try {
    res.json(await svc.pinBundle(uid(req), req.params.bundleId));
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/unpin/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/unpin/:bundleId", async (req, res) => {
  try {
    res.json(await svc.unpinBundle(uid(req), req.params.bundleId));
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/memory
// ─────────────────────────────────────────────────────────────────────────────

router.post("/memory", async (req, res) => {
  try {
    res.json(await svc.updateWorkspaceMemory(uid(req), req.body || {}));
  } catch (err) {
    handleErr(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /workspace/tools/:id
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/tools/:id", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized", success: false });

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid tool ID", success: false });
    }

    const ws = await Workspace.findOne({ userId });
    if (!ws) return res.status(404).json({ error: "Workspace not found", success: false });

    if (typeof ws.removeTool === "function") {
      ws.removeTool(req.params.id);
    } else {
      ws.tools = (ws.tools || []).filter(t => {
        const tid = t.toolId || t._id || t;
        return tid && tid.toString() !== req.params.id;
      });
    }

    await ws.save();
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/add/:toolId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/add/:toolId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.toolId)) {
      return res.status(400).json({ error: "Invalid tool ID", success: false });
    }

    const userId = uid(req);
    let ws = await Workspace.findOne({ userId });
    if (!ws) ws = new Workspace({ userId });

    const toolIdStr = req.params.toolId;
    const exists    = (ws.tools || []).some(t => {
      const tid = t.toolId || t._id || t;
      return tid && tid.toString() === toolIdStr;
    });

    if (!exists) {
      ws.tools.push({ toolId: new mongoose.Types.ObjectId(toolIdStr) });
      await ws.save();
    }

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/remove/:toolId
// ─────────────────────────────────────────────────────────────────────────────

router.post("/remove/:toolId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.toolId)) {
      return res.status(400).json({ error: "Invalid tool ID", success: false });
    }

    const ws = await Workspace.findOne({ userId: uid(req) });
    if (ws) {
      if (typeof ws.removeTool === "function") {
        ws.removeTool(req.params.toolId);
      } else {
        ws.tools = (ws.tools || []).filter(t => {
          const tid = t.toolId || t._id || t;
          return tid && tid.toString() !== req.params.toolId;
        });
      }
      await ws.save();
    }

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/projects
// ─────────────────────────────────────────────────────────────────────────────

router.get("/projects", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized", success: false });
    const result = await svc.getProjectList(userId);
    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/files/:projectId
// ─────────────────────────────────────────────────────────────────────────────

router.get("/files/:projectId", async (req, res) => {
  try {
    const userId     = uid(req);
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ success: false, error: "projectId required" });
    const result = await svc.getProjectFiles(userId, projectId);
    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/file/:projectId/:filename
// ─────────────────────────────────────────────────────────────────────────────

router.get("/file/:projectId/:filename", async (req, res) => {
  try {
    const userId             = uid(req);
    const { projectId, filename } = req.params;
    if (!projectId || !filename) {
      return res.status(400).json({ success: false, error: "projectId and filename required" });
    }
    const result = await svc.getProjectFile(userId, projectId, decodeURIComponent(filename));
    res.json({
      success:   true,
      file:      { content: result.content, fileName: result.fileName },
      projectId,
    });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/save-file
// ─────────────────────────────────────────────────────────────────────────────

router.post("/save-file", async (req, res) => {
  try {
    const userId = uid(req);
    const { projectId, fileName, content } = req.body || {};
    if (!projectId || !fileName) {
      return res.status(400).json({ success: false, error: "projectId and fileName required" });
    }
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: "content is required" });
    }
    const result = await svc.saveProjectFile(userId, projectId, fileName, content);

    // Mirror to PROJECTS_ROOT so iframe preview reflects saved content immediately
    mirrorSingleFile(projectId, fileName, content);

    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/edit-file
//
// [FIX-CRITICAL v6]
// editProjectFile() returns { success, projectId, filename, updatedFiles }
// where updatedFiles is string[] — file NAMES only, not objects.
// Old code: for (const f of result.updatedFiles) { f.fileName, f.content }
//   → f is a string → f.fileName is undefined → mirror NEVER ran.
//
// Fix: after edit succeeds, read each updated file's content from svc,
// then mirror. Best-effort — never blocks the response.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/edit-file", async (req, res) => {
  try {
    const userId = uid(req);
    const { projectId, fileName, instruction } = req.body || {};
    if (!projectId || !fileName || !instruction) {
      return res.status(400).json({ success: false, error: "projectId, fileName, and instruction required" });
    }
    const result = await svc.editProjectFile(userId, projectId, fileName, instruction);

    // [FIX] updatedFiles is string[] — read content for each and mirror
    if (Array.isArray(result.updatedFiles) && result.updatedFiles.length > 0) {
      // Fire-and-forget mirror (non-blocking, best-effort)
      setImmediate(async () => {
        for (const updatedFileName of result.updatedFiles) {
          try {
            const content = await svc.readSingleFile(projectId, updatedFileName);
            mirrorSingleFile(projectId, updatedFileName, content);
          } catch (mirrorErr) {
            console.warn(`[WS ROUTE] Mirror read failed for ${updatedFileName}:`, mirrorErr.message);
          }
        }
      });
    }

    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
