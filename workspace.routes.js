/**
 * workspace.routes.js
 * Mount in index.js:  const workspaceRoutes = require("./workspace.routes");
 *                     app.use("/workspace", requireLogin, workspaceRoutes);
 *
 * Also update the GET /workspace page route (see bottom of this file for
 * the replacement snippet to paste into index.js).
 */

"use strict";

const express  = require("express");
const router   = express.Router();
const mongoose = require("mongoose");
const Workspace = require("./models/Workspace");
const Bundle    = require("./models/Bundle");
const svc       = require("./services/workspace.service");

// ─── GET /workspace/state ───────────────────────────────────────────────────
router.get("/state", async (req, res) => {
  try {
    const data = await svc.getWorkspaceState(req.session.userId);
    res.json(data);
  } catch (err) {
    console.error("[WS] getWorkspaceState:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /workspace/bundle/:bundleId ────────────────────────────────────────
router.get("/bundle/:bundleId", async (req, res) => {
  try {
    const data = await svc.getBundleState(req.session.userId, req.params.bundleId);
    res.json(data);
  } catch (err) {
    res.status(err.message === "Bundle not found" ? 404 : 500).json({ error: err.message });
  }
});

// ─── POST /workspace/run/:bundleId ──────────────────────────────────────────
router.post("/run/:bundleId", async (req, res) => {
  try {
    const data = await svc.runBundle(req.session.userId, req.params.bundleId);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/step/:bundleId/:step ───────────────────────────────────
router.post("/step/:bundleId/:step", async (req, res) => {
  try {
    const data = await svc.completeStep(
      req.session.userId,
      req.params.bundleId,
      req.params.step,
      req.body || {}
    );
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/pause/:bundleId ────────────────────────────────────────
router.post("/pause/:bundleId", async (req, res) => {
  try {
    res.json(await svc.pauseBundle(req.session.userId, req.params.bundleId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/resume/:bundleId ───────────────────────────────────────
router.post("/resume/:bundleId", async (req, res) => {
  try {
    res.json(await svc.resumeBundle(req.session.userId, req.params.bundleId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/pin/:bundleId ──────────────────────────────────────────
router.post("/pin/:bundleId", async (req, res) => {
  try {
    res.json(await svc.pinBundle(req.session.userId, req.params.bundleId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/unpin/:bundleId ────────────────────────────────────────
router.post("/unpin/:bundleId", async (req, res) => {
  try {
    res.json(await svc.unpinBundle(req.session.userId, req.params.bundleId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/memory ─────────────────────────────────────────────────
router.post("/memory", async (req, res) => {
  try {
    res.json(await svc.updateWorkspaceMemory(req.session.userId, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /workspace/add/:toolId  (existing — keep for backward compat) ─────
router.post("/add/:toolId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.toolId))
      return res.status(400).json({ error: "Invalid tool ID" });

    let ws = await Workspace.findOne({ userId: req.session.userId });
    if (!ws) ws = new Workspace({ userId: req.session.userId });

    const toolIdStr = req.params.toolId;
    if (!ws.tools.map((t) => t.toString()).includes(toolIdStr)) {
      ws.tools.push(req.params.toolId);
      await ws.save();
    }
    res.sendStatus(200);
  } catch (err) {
    res.status(500).json({ error: "Error adding tool" });
  }
});

// ─── POST /workspace/remove/:toolId  (existing — keep for backward compat) ──
router.post("/remove/:toolId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.toolId))
      return res.status(400).json({ error: "Invalid tool ID" });
    const toolId = new mongoose.Types.ObjectId(req.params.toolId);
    await Workspace.updateOne({ userId: req.session.userId }, { $pull: { tools: toolId } });
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send("Error removing tool");
  }
});

module.exports = router;

/*
 * ════════════════════════════════════════════════════════════════════
 * PASTE THIS BLOCK INTO index.js  (replace the existing /workspace GET
 * and the four individual /workspace/* POST routes)
 * ════════════════════════════════════════════════════════════════════
 *
 * // ── After your other require() calls: ──────────────────────────────
 * const workspaceRoutes = require("./workspace.routes");
 *
 * // ── Replace existing workspace GET + tool add/remove routes with: ──
 * app.get("/workspace", requireLogin, async (req, res) => {
 *   try {
 *     const Workspace = require("./models/Workspace");
 *     const Bundle    = require("./models/Bundle");
 *     let ws = await Workspace.findOne({ userId: req.session.userId })
 *               .populate("tools").lean();
 *     if (!ws) {
 *       ws = await new Workspace({ userId: req.session.userId }).save();
 *       ws = ws.toObject();
 *     }
 *     const bundles = await Bundle.find({ userId: req.session.userId })
 *                       .sort({ updatedAt: -1 }).lean();
 *     res.render("workspace", { workspace: ws, bundles });
 *   } catch (err) {
 *     console.error(err);
 *     res.status(500).send("Error loading workspace");
 *   }
 * });
 *
 * app.use("/workspace", requireLogin, workspaceRoutes);
 *
 * // Keep /bundle/remove/:id as-is (not touched by this service).
 * ════════════════════════════════════════════════════════════════════
 */
