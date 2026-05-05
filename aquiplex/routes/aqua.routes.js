// FILE: routes/aqua.routes.js
"use strict";

const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs");

const { handleAquaRequest, detectIntent, buildProjectContext } =
  require("../core/aqua.orchestrator");

const svc = require("../workspace/workspace.service");
const { createLogger }            = require("../utils/logger");
const { asyncHandler, sendError } = require("../middleware/asyncHandler");
const { validateAquaExecute }     = require("../utils/validate");

const log = createLogger("AQUA_ROUTE");

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

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

async function mirrorUpdatedFiles(userId, projectId, fileNames) {
  if (!projectId || !fileNames?.length) return;
  const dir = path.join(PROJECTS_ROOT, path.basename(projectId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const fname of fileNames) {
    try {
      const content  = await svc.readSingleFile(projectId, fname);
      const safeName = path.basename(fname);
      const destPath = path.join(dir, safeName);
      // Path traversal guard
      if (!destPath.startsWith(dir + path.sep) && destPath !== dir) continue;
      fs.writeFileSync(destPath, content, "utf8");
      log.info(`Mirrored ${safeName} → preview`);
    } catch (e) {
      log.warn(`Mirror failed for ${fname}: ${e.message}`);
    }
  }
}

function mirrorGeneratedFiles(projectId, fileData) {
  if (!projectId || !Array.isArray(fileData)) return;
  const dir = path.join(PROJECTS_ROOT, path.basename(projectId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const item of fileData) {
    try {
      const safeName = path.basename(item.fileName);
      const destPath = path.join(dir, safeName);
      // Path traversal guard
      if (!destPath.startsWith(dir + path.sep) && destPath !== dir) continue;

      if (item.content) {
        fs.writeFileSync(destPath, item.content, "utf8");
        log.info(`Generated + mirrored ${safeName}`);
      } else {
        const diskPath = path.join(
          svc.PROJECTS_DIR || path.join(process.cwd(), "data", "projects"),
          String(projectId).replace(/[^a-zA-Z0-9_-]/g, ""),
          safeName
        );
        if (fs.existsSync(diskPath)) {
          fs.copyFileSync(diskPath, destPath);
          log.info(`Copied (disk→preview) ${safeName}`);
        }
      }
    } catch (e) {
      log.warn(`Generate mirror failed for ${item.fileName}: ${e.message}`);
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post("/execute", asyncHandler(async (req, res) => {
  const userId = uid(req);
  if (!userId) return sendError(res, "Unauthorized", 401);

  const { message, projectId, fileName, sessionHistory } = req.body || {};
  const validation = validateAquaExecute({ message, projectId, fileName });
  if (!validation.valid) return sendError(res, validation.error, 400);

  let projectFiles = [];
  if (projectId) {
    try {
      const pf = await svc.getProjectFiles(userId, projectId);
      projectFiles = (pf.files || []).map(f => (typeof f === "string" ? f : f.fileName));
    } catch { /* non-fatal */ }
  }

  let workspaceMemory = {};
  try {
    const wsState   = await svc.getWorkspaceState(userId);
    workspaceMemory = wsState?.workspace?.workspaceMemory || {};
  } catch { /* non-fatal */ }

  // handleAquaRequest expects a single payload object (orchestrator v5 signature)
  const result = await handleAquaRequest({
    userId,
    projectId,
    input:          message.trim(),
    mode:           "chat",
    projectFiles,
    memory:         workspaceMemory,
    sessionHistory: Array.isArray(sessionHistory) ? sessionHistory : [],
  });

  let previewRefresh = false;

  if (result.action === "generated" && result.files?.length) {
    mirrorGeneratedFiles(result.projectId, result.files);
    previewRefresh = true;
  }

  if ((result.action === "edited" || result.action === "multi_edited") && result.updatedFiles?.length) {
    setImmediate(() => mirrorUpdatedFiles(userId, result.projectId, result.updatedFiles));
    previewRefresh = true;
  }

  if (result.projectId) {
    setImmediate(() =>
      svc.updateWorkspaceMemory(userId, {
        lastProjectId:   result.projectId,
        lastUserMessage: message.slice(0, 120),
      }).catch(() => {})
    );
  }

  const replyText = result.message || result.reply || "";

  return res.json({
    success:       true,
    reply:         replyText,
    intent:        result.intent,
    action:        result.action,
    message:       replyText,
    projectId:     result.projectId    || projectId || null,
    updatedFiles:  result.updatedFiles || [],
    files:         result.files        || [],
    previewUrl:    result.previewUrl   || null,
    previewRefresh,
    errors:        result.errors       || [],
    skipped:       result.skipped      || [],
    rolledBack:    result.rolledBack   || false,
  });
}));

router.get("/context/:projectId", asyncHandler(async (req, res) => {
  const userId        = uid(req);
  const { projectId } = req.params;
  if (!userId)    return sendError(res, "Unauthorized", 401);
  if (!projectId) return sendError(res, "projectId required", 400);

  const { summary, fileNames, fileContents } = await buildProjectContext(
    userId, projectId, req.query.file || null,
  );

  let workspaceMemory = {};
  try {
    const wsState   = await svc.getWorkspaceState(userId);
    workspaceMemory = wsState?.workspace?.workspaceMemory || {};
  } catch { /* non-fatal */ }

  return res.json({
    success: true,
    data:    { projectId, fileNames, fileContents, contextSummary: summary, workspaceMemory },
  });
}));

router.post("/intent-check", asyncHandler(async (req, res) => {
  const { message, projectId, fileName, projectFiles } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return sendError(res, "message required", 400);
  }

  const result = detectIntent(message, {
    projectId, fileName,
    projectFiles: Array.isArray(projectFiles) ? projectFiles : [],
  });

  return res.json({ success: true, data: result });
}));

// /generate-v2 — removed (generateProjectV2 not available)
// Use POST /api/aqua/execute with a "generate_project" intent instead.

// /safe-edit — removed (safeEditFiles not directly importable here)
// Use POST /api/aqua/execute with an "edit_file" / "multi_edit" intent instead.

module.exports = router;