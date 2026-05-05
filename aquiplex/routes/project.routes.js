// FILE: routes/project.routes.js
"use strict";

const express        = require("express");
const router         = express.Router();
const fs             = require("fs");
const path           = require("path");
const { v4: uuidv4 } = require("uuid");

const Workspace = require("../models/Workspace");
const Bundle    = require("../models/Bundle");
const svc       = require("../workspace/workspace.service");
const { createLogger }            = require("../utils/logger");
const { asyncHandler, sendError } = require("../middleware/asyncHandler");

const log = createLogger("PROJECT_ROUTE");

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
if (!fs.existsSync(PROJECTS_ROOT)) fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

const MIME_MAP = {
  ".html": "text/html; charset=utf-8",   ".htm": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",    ".js":  "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",  ".png": "image/png",
  ".jpg":  "image/jpeg",     ".jpeg": "image/jpeg",
  ".gif":  "image/gif",      ".ico": "image/x-icon",
  ".woff": "font/woff",      ".woff2": "font/woff2",  ".ttf": "font/ttf",
  ".txt":  "text/plain; charset=utf-8",  ".md": "text/plain; charset=utf-8",
};
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_MAP));
const RESERVED = new Set(["create", "generate", "edit", "list", "api", "preview", "files"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(req) {
  return (
    req.session?.userId    ||
    req.session?.user?._id ||
    req.user?._id          ||
    req.user?.id           ||
    null
  );
}

function projectRootDir(projectId) {
  const safe = path.basename(projectId);
  if (!safe || safe !== projectId) throw new Error("Invalid projectId");
  return path.join(PROJECTS_ROOT, safe);
}

/**
 * safeResolvePath — resolves a relative path inside a project dir.
 * Returns null if the resolved path escapes the project root.
 */
function safeResolvePath(projectId, relPath) {
  const projectDir = path.resolve(projectRootDir(projectId));
  // Normalise: strip leading traversal segments, collapse ..
  const normalised = path
    .normalize(relPath)
    .replace(/^(\.\.([/\\]|$))+/, "");
  const resolved = path.resolve(projectDir, normalised);
  // Must remain strictly inside projectDir
  if (resolved !== projectDir && !resolved.startsWith(projectDir + path.sep)) return null;
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
  } catch { return null; }
}

function writeMeta(projectId, data) {
  try {
    const dir = projectRootDir(projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    log.warn(`writeMeta failed: ${e.message}`);
  }
}

function mirrorFilesToRoot(projectId, files) {
  const dir = projectRootDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    try {
      if (!file?.fileName || file.content === undefined) continue;
      const safeName = path.basename(file.fileName);
      if (!safeName || !isAllowedExt(safeName)) continue;
      const destPath = path.join(dir, safeName);
      // Path traversal guard
      if (!destPath.startsWith(path.resolve(dir) + path.sep)) continue;
      fs.writeFileSync(destPath, file.content, "utf8");
      log.info(`Mirrored: ${safeName} → ${dir}`);
    } catch (e) {
      log.warn(`mirrorFilesToRoot: failed to write ${file.fileName}: ${e.message}`);
    }
  }
}

function setCacheControlNoStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post("/create", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);

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
}));

router.post("/generate", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);

  const { prompt, projectId, name } = req.body || {};
  if (!prompt)    return sendError(res, "prompt required", 400);
  if (!projectId) return sendError(res, "projectId required", 400);

  const result = await svc.generateProject(userId, projectId, prompt);

  if (Array.isArray(result.fileData) && result.fileData.length > 0) {
    mirrorFilesToRoot(result.projectId, result.fileData);
    writeMeta(result.projectId, {
      projectId: result.projectId,
      userId:    String(userId),
      name:      result.name || name || "Untitled Project",
      files:     result.fileData.map(f => f.fileName),
      updatedAt: new Date().toISOString(),
    });
  }

  res.json(result);
}));

router.post("/edit", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);

  const { projectId, fileName, instruction } = req.body || {};
  if (!projectId || !fileName || !instruction) {
    return sendError(res, "projectId, fileName, and instruction required", 400);
  }

  const result = await svc.editProjectFile(userId, projectId, fileName, instruction);

  if (Array.isArray(result.updatedFiles)) {
    for (const updatedFileName of result.updatedFiles) {
      try {
        const content  = await svc.readSingleFile(projectId, updatedFileName);
        const dir      = projectRootDir(projectId);
        const safeName = path.basename(updatedFileName);
        if (safeName && isAllowedExt(safeName)) {
          const destPath = path.join(dir, safeName);
          // Path traversal guard
          if (!destPath.startsWith(path.resolve(dir) + path.sep)) continue;
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(destPath, content, "utf8");
        }
      } catch (e) {
        log.warn(`post-edit mirror failed: ${e.message}`);
      }
    }
  }

  res.json(result);
}));

router.get("/list", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);
  res.json(await svc.getProjectList(userId));
}));

router.get("/api/:id", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);
  const result = await svc.getProjectFiles(userId, req.params.id);
  res.json({ success: true, ...result });
}));

router.use("/:id/preview", setCacheControlNoStore, async (req, res) => {
  try {
    const { id }  = req.params;
    const relPath = (req.path && req.path !== "/") ? req.path.slice(1) : "index.html";
    const target  = relPath || "index.html";
    const ext     = path.extname(target).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext) && ext !== "") return res.status(403).send("File type not allowed.");

    const absPath = safeResolvePath(id, target);
    if (!absPath) return res.status(400).send("Invalid file path.");

    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      res.setHeader("Content-Type", mimeType);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      return res.sendFile(absPath);
    }

    let content;
    try {
      content = await svc.readSingleFile(id, path.basename(target));
    } catch {
      return res.status(404).send("File not found.");
    }

    try {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, content, "utf8");
    } catch { /* non-fatal */ }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    return res.send(content);
  } catch (err) {
    log.error(`GET /:id/preview/* error: ${err.message}`);
    res.status(500).send("Error serving preview file.");
  }
});

router.get("/:id/files", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);
  const result = await svc.getProjectFiles(userId, req.params.id);
  res.json({ success: true, files: result.files, projectId: req.params.id });
}));

router.get("/:id", async (req, res, next) => {
  if (RESERVED.has(req.params.id)) return next();
  try {
    const userId = uid(req);
    if (!userId) return res.redirect("/login");

    let projectName = null;
    const meta = readMeta(req.params.id);

    if (meta) {
      if (meta.userId && meta.userId !== String(userId)) {
        return res.status(403).render("error", { message: "You do not have access to this project.", status: 403 });
      }
      projectName = meta.name;
    } else {
      try {
        const svcResult = await svc.getProjectFiles(userId, req.params.id);
        projectName     = svcResult.name || "Project";
      } catch {
        return res.status(404).render("error", { message: "Project not found.", status: 404 });
      }
    }

    let ws = await Workspace.findOne({ userId }).populate("tools").lean();
    if (!ws) {
      ws = await new Workspace({ userId }).save();
      ws = ws.toObject ? ws.toObject() : ws;
    }
    if (ws.workspaceMemory instanceof Map) ws.workspaceMemory = Object.fromEntries(ws.workspaceMemory);

    const bundles = await Bundle.find({ userId }).sort({ updatedAt: -1 }).lean();
    return res.render("workspace", {
      workspace: ws, bundles, page: "workspace",
      openProjectId: req.params.id, openProjectName: projectName,
    });
  } catch (err) {
    log.error(`GET /:id render error: ${err.message}`);
    res.status(500).send("Failed to load workspace for this project.");
  }
});

router.delete("/:id", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);

  const meta = readMeta(req.params.id);
  if (meta?.userId && meta.userId !== String(userId)) return sendError(res, "Access denied", 403);

  try {
    const rootDir = projectRootDir(req.params.id);
    if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true });
  } catch (e) {
    log.warn(`DELETE: failed to remove mirror dir: ${e.message}`);
  }

  await svc.deleteProjectById(userId, req.params.id);
  res.json({ success: true });
}));

module.exports = router;