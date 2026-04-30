/**
 * project.routes.js — Aquiplex AI Website Execution Engine [v7]
 *
 * FIXES v7:
 * - [FIX-CRITICAL] POST /generate: svc.generateProject(userId, prompt, projectId, name)
 *   → correct order: svc.generateProject(userId, projectId, prompt)
 *   Old call had prompt and projectId swapped → projectId was used as the prompt text.
 * - [FIX] POST /generate: result.files is string[] from generateProject — mirrorFilesToRoot
 *   needs { fileName, content } objects. Now reads fileData from result (already returned).
 * - [FIX] Preview route preserved as router.use() (Node v24 / path-to-regexp v8 safe).
 * - All other logic preserved from v6.
 *
 * Mounted at: /workspace/project (via workspace.routes.js)
 */

"use strict";

const express        = require("express");
const router         = express.Router();
const fs             = require("fs");
const path           = require("path");
const { v4: uuidv4 } = require("uuid");

const Workspace = require("../models/Workspace");
const Bundle    = require("../models/Bundle");
const svc       = require("../services/workspace.service");

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

if (!fs.existsSync(PROJECTS_ROOT)) {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME map
// ─────────────────────────────────────────────────────────────────────────────

const MIME_MAP = {
  ".html":  "text/html; charset=utf-8",
  ".htm":   "text/html; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".js":    "application/javascript; charset=utf-8",
  ".mjs":   "application/javascript; charset=utf-8",
  ".json":  "application/json; charset=utf-8",
  ".svg":   "image/svg+xml",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".gif":   "image/gif",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".txt":   "text/plain; charset=utf-8",
  ".md":    "text/plain; charset=utf-8",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_MAP));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function uid(req) {
  return (
    req.session?.userId    ||
    req.session?.user?._id ||
    req.user?._id          ||
    req.user?.id           ||
    null
  );
}

function handleErr(res, err, status = 500) {
  console.error("[PROJECT ENGINE]", err?.message || err);
  res.status(status).json({ success: false, error: err?.message || "Internal error" });
}

function projectRootDir(projectId) {
  const safe = path.basename(projectId);
  if (!safe || safe !== projectId) throw new Error("Invalid projectId");
  return path.join(PROJECTS_ROOT, safe);
}

function safeResolvePath(projectId, relPath) {
  const projectDir = projectRootDir(projectId);
  const normalised = path.normalize(relPath).replace(/^(\.\.([/\\]|$))+/, "");
  const resolved   = path.join(projectDir, normalised);
  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
    return null;
  }
  return resolved;
}

function isAllowedExt(filename) {
  return ALLOWED_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function readMeta(projectId) {
  try {
    const metaPath = path.join(projectRootDir(projectId), "meta.json");
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function writeMeta(projectId, data) {
  try {
    const dir = projectRootDir(projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn("[PROJECT ENGINE] writeMeta failed:", e.message);
  }
}

/**
 * mirrorFilesToRoot — write { fileName, content }[] to PROJECTS_ROOT.
 * [FIX v7] Now accepts array of objects { fileName, content }.
 * generateProject returns result.fileData which has the full objects.
 */
function mirrorFilesToRoot(projectId, files) {
  const dir = projectRootDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const file of files) {
    try {
      if (!file || !file.fileName || file.content === undefined) continue;
      const safeName = path.basename(file.fileName);
      if (!safeName || !isAllowedExt(safeName)) continue;
      fs.writeFileSync(path.join(dir, safeName), file.content, "utf8");
      console.log(`[PROJECT ENGINE] Mirrored: ${safeName} → ${dir}`);
    } catch (e) {
      console.warn(
        `[PROJECT ENGINE] mirrorFilesToRoot: failed to write ${file.fileName}:`,
        e.message
      );
    }
  }
}

function setCacheControlNoStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma",            "no-cache");
  res.setHeader("Expires",           "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
}

// Reserved segments — never matched by /:id param routes
const RESERVED = new Set(["create", "generate", "edit", "list", "api", "preview", "files"]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/project/create
// ─────────────────────────────────────────────────────────────────────────────

router.post("/create", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { name } = req.body || {};
    const projectId = uuidv4();

    await svc.createProject(userId, name, projectId);

    writeMeta(projectId, {
      projectId,
      userId:    String(userId),
      name:      name || "Untitled Project",
      files:     [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, projectId, name: name || "Untitled Project" });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/project/generate
//
// [FIX-CRITICAL v7]
// Old (BROKEN): svc.generateProject(userId, prompt, projectId, name)
//   → projectId was passed as 2nd arg but function expects projectId as 2nd arg,
//     prompt as 3rd. Call had them SWAPPED: prompt was used as projectId.
//
// Fixed: svc.generateProject(userId, projectId, prompt)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/generate", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { prompt, projectId, name } = req.body || {};
    if (!prompt)     return res.status(400).json({ success: false, error: "prompt required" });
    if (!projectId)  return res.status(400).json({ success: false, error: "projectId required" });

    // [FIX] Correct arg order: (userId, projectId, prompt)
    const result = await svc.generateProject(userId, projectId, prompt);

    // [FIX] result.fileData has { fileName, content }[] — use it for mirror
    if (Array.isArray(result.fileData) && result.fileData.length > 0) {
      mirrorFilesToRoot(result.projectId, result.fileData);
      writeMeta(result.projectId, {
        projectId:  result.projectId,
        userId:     String(userId),
        name:       result.name || name || "Untitled Project",
        files:      result.fileData.map(f => f.fileName),
        updatedAt:  new Date().toISOString(),
      });
    }

    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/project/edit
// ─────────────────────────────────────────────────────────────────────────────

router.post("/edit", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { projectId, fileName, instruction } = req.body || {};
    if (!projectId || !fileName || !instruction) {
      return res.status(400).json({ success: false, error: "projectId, fileName, and instruction required" });
    }

    const result = await svc.editProjectFile(userId, projectId, fileName, instruction);

    // result.updatedFiles is string[] — read & mirror each file
    if (Array.isArray(result.updatedFiles)) {
      for (const updatedFileName of result.updatedFiles) {
        try {
          const content = await svc.readSingleFile(projectId, updatedFileName);
          const dir      = projectRootDir(projectId);
          const safeName = path.basename(updatedFileName);
          if (safeName && isAllowedExt(safeName)) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, safeName), content, "utf8");
          }
        } catch (e) {
          console.warn("[PROJECT ENGINE] post-edit mirror failed:", e.message);
        }
      }
    }

    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/project/list
// ─────────────────────────────────────────────────────────────────────────────

router.get("/list", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const result = await svc.getProjectList(userId);
    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/project/api/:id
// ─────────────────────────────────────────────────────────────────────────────

router.get("/api/:id", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const result = await svc.getProjectFiles(userId, req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview static file server — /workspace/project/:id/preview/<any/path>
//
// router.use() with prefix — Node v24 / path-to-regexp v8 safe.
// No unnamed wildcards. req.path gives the remainder after the mount prefix.
// ─────────────────────────────────────────────────────────────────────────────

router.use("/:id/preview", setCacheControlNoStore, async (req, res) => {
  try {
    const { id }  = req.params;
    const relPath = (req.path && req.path !== "/") ? req.path.slice(1) : "index.html";
    const target  = relPath || "index.html";

    const ext = path.extname(target).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && ext !== "") {
      return res.status(403).send("File type not allowed.");
    }

    const absPath = safeResolvePath(id, target);
    if (!absPath) return res.status(400).send("Invalid file path.");

    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    // Primary: serve from PROJECTS_ROOT mirror
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      res.setHeader("Content-Type",   mimeType);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      return res.sendFile(absPath);
    }

    // Fallback: read from service data dir
    const fileName = path.basename(target);
    let content;

    try {
      content = await svc.readSingleFile(id, fileName);
    } catch {
      return res.status(404).send("File not found.");
    }

    // Mirror for subsequent requests
    try {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, content, "utf8");
    } catch { /* non-fatal */ }

    res.setHeader("Content-Type",   mimeType);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    return res.send(content);

  } catch (err) {
    console.error("[PROJECT ENGINE] GET /:id/preview/* error:", err.message);
    res.status(500).send("Error serving preview file.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/project/:id/files
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id/files", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const result = await svc.getProjectFiles(userId, req.params.id);
    res.json({ success: true, files: result.files, projectId: req.params.id });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/project/:id  — Render workspace SPA
// MUST be defined AFTER all /:id/xxx routes.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res, next) => {
  if (RESERVED.has(req.params.id)) return next();

  try {
    const userId = uid(req);
    if (!userId) return res.redirect("/login");

    let projectName = null;

    const meta = readMeta(req.params.id);
    if (meta) {
      if (meta.userId && meta.userId !== String(userId)) {
        return res.status(403).render("error", {
          message: "You do not have access to this project.",
          status:  403,
        });
      }
      projectName = meta.name;
    } else {
      try {
        const svcResult = await svc.getProjectFiles(userId, req.params.id);
        projectName     = svcResult.name || "Project";
      } catch {
        return res.status(404).render("error", {
          message: "Project not found.",
          status:  404,
        });
      }
    }

    let ws = await Workspace.findOne({ userId }).populate("tools").lean();
    if (!ws) {
      ws = await new Workspace({ userId }).save();
      ws = ws.toObject ? ws.toObject() : ws;
    }
    if (ws.workspaceMemory instanceof Map) {
      ws.workspaceMemory = Object.fromEntries(ws.workspaceMemory);
    }
    const bundles = await Bundle.find({ userId }).sort({ updatedAt: -1 }).lean();

    return res.render("workspace", {
      workspace:       ws,
      bundles,
      page:            "workspace",
      openProjectId:   req.params.id,
      openProjectName: projectName,
    });
  } catch (err) {
    console.error("[PROJECT ENGINE] GET /:id render error:", err);
    res.status(500).send("Failed to load workspace for this project.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /workspace/project/:id
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const meta = readMeta(req.params.id);
    if (meta && meta.userId && meta.userId !== String(userId)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }

    try {
      const rootDir = projectRootDir(req.params.id);
      if (fs.existsSync(rootDir)) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("[PROJECT ENGINE] DELETE: failed to remove mirror dir:", e.message);
    }

    await svc.deleteProjectById(userId, req.params.id);

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
