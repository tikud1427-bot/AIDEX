/**
 * workspace.service.js
 * Manages workspace execution state, syncing with the Bundle execution engine.
 * Drop in: services/workspace.service.js
 */

"use strict";

const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Bundle    = require("../models/Bundle");

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateWorkspace(userId) {
  let ws = await Workspace.findOne({ userId });
  if (!ws) ws = await new Workspace({ userId }).save();
  return ws;
}

function sanitizeBundleForClient(bundle) {
  if (!bundle) return null;
  const obj = typeof bundle.toObject === "function" ? bundle.toObject({ virtuals: true }) : bundle;

  // Serialize Map → plain object
  if (obj.memory instanceof Map) {
    obj.memory = Object.fromEntries(obj.memory);
  } else if (obj.memory && typeof obj.memory === "object" && !(obj.memory instanceof Object.getPrototypeOf(Map))) {
    // already plain
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/state
// Returns full workspace snapshot including all bundles' live state.
// ─────────────────────────────────────────────────────────────────────────────

async function getWorkspaceState(userId) {
  const ws = await getOrCreateWorkspace(userId);

  // Fetch all user bundles sorted newest first
  const allBundles = await Bundle.find({ userId }).sort({ updatedAt: -1 }).lean();

  // Serialize workspace memory
  const wsMemory = ws.workspaceMemory instanceof Map
    ? Object.fromEntries(ws.workspaceMemory)
    : ws.workspaceMemory || {};

  // Enrich bundles with sanitized fields
  const bundles = allBundles.map((b) => ({
    ...b,
    memory: b.memory instanceof Map ? Object.fromEntries(b.memory) : (b.memory || {}),
    completionPercent: b.steps?.length
      ? Math.round(
          ((b.progress || []).filter((p) => p.status === "completed").length / b.steps.length) * 100
        )
      : 0,
  }));

  // Active bundle IDs as strings for fast lookup
  const activeBundleIds = (ws.activeBundles || []).map((id) => id.toString());

  return {
    workspace: {
      _id:              ws._id,
      tools:            ws.tools,
      activeBundleIds,
      pinnedBundleIds:  (ws.pinnedBundles || []).map((id) => id.toString()),
      executionSessions: ws.executionSessions || [],
      recentOutputs:    ws.recentOutputs     || [],
      workspaceMemory:  wsMemory,
      lastOpenBundleId: ws.lastOpenBundleId,
    },
    bundles,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/run/:bundleId
// Open (or resume) a bundle execution session.
// ─────────────────────────────────────────────────────────────────────────────

async function runBundle(userId, bundleId) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const [ws, bundle] = await Promise.all([
    getOrCreateWorkspace(userId),
    Bundle.findOne({ _id: bundleId, userId }),
  ]);

  if (!bundle) throw new Error("Bundle not found");
  if (bundle.status === "completed") throw new Error("Bundle already completed");

  // Activate
  bundle.status = "active";
  ws.openSession(bundleId, bundle.steps?.length || 0);
  ws.lastOpenBundleId = bundleId;

  await Promise.all([bundle.save(), ws.save()]);

  return { success: true, bundle: sanitizeBundleForClient(bundle) };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/step/:bundleId/:step
// Mark a step completed and sync workspace.
// ─────────────────────────────────────────────────────────────────────────────

async function completeStep(userId, bundleId, stepIndex, outputData = {}) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const [ws, bundle] = await Promise.all([
    getOrCreateWorkspace(userId),
    Bundle.findOne({ _id: bundleId, userId }),
  ]);

  if (!bundle) throw new Error("Bundle not found");

  const idx = Number(stepIndex);
  if (isNaN(idx) || idx < 0 || idx >= bundle.steps.length) throw new Error("Invalid step index");

  // Update bundle
  bundle.markStepCompleted(idx, {
    title:         outputData.title    || bundle.steps[idx]?.title || `Step ${idx + 1}`,
    content:       outputData.content  || "",
    keyInsights:   outputData.keyInsights   || [],
    nextStepHints: outputData.nextStepHints || [],
    tokensUsed:    outputData.tokensUsed    || 0,
    durationMs:    outputData.durationMs    || 0,
  });

  // Merge any new memory entries from the step
  if (outputData.memoryEntries && typeof outputData.memoryEntries === "object") {
    bundle.mergeMemory(outputData.memoryEntries);
    ws.mergeWorkspaceMemory(outputData.memoryEntries);
  }

  // Push to workspace recent outputs
  ws.pushRecentOutput({
    bundleId,
    bundleTitle: bundle.title,
    stepIndex:   idx,
    stepTitle:   bundle.steps[idx]?.title || `Step ${idx + 1}`,
    content:     outputData.content || "",
  });

  // Sync session state
  if (bundle.status === "completed") {
    ws.closeSession(bundleId, "completed");
  } else {
    ws.updateSession(bundleId, { currentStep: bundle.currentStep, status: "running" });
  }

  await Promise.all([bundle.save(), ws.save()]);

  return { success: true, bundle: sanitizeBundleForClient(bundle) };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/pause/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

async function pauseBundle(userId, bundleId) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const [ws, bundle] = await Promise.all([
    getOrCreateWorkspace(userId),
    Bundle.findOne({ _id: bundleId, userId }),
  ]);

  if (!bundle) throw new Error("Bundle not found");

  bundle.status = "paused";
  ws.updateSession(bundleId, { status: "paused" });

  await Promise.all([bundle.save(), ws.save()]);

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/resume/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

async function resumeBundle(userId, bundleId) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const [ws, bundle] = await Promise.all([
    getOrCreateWorkspace(userId),
    Bundle.findOne({ _id: bundleId, userId }),
  ]);

  if (!bundle) throw new Error("Bundle not found");
  if (bundle.status === "completed") throw new Error("Bundle already completed");

  bundle.status = "active";
  ws.openSession(bundleId, bundle.steps?.length || 0);
  ws.lastOpenBundleId = bundleId;

  await Promise.all([bundle.save(), ws.save()]);

  return { success: true, bundle: sanitizeBundleForClient(bundle) };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/pin/:bundleId
// ─────────────────────────────────────────────────────────────────────────────

async function pinBundle(userId, bundleId) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const ws = await getOrCreateWorkspace(userId);
  const already = ws.pinnedBundles.some((id) => id.toString() === bundleId);
  if (!already) ws.pinnedBundles.push(bundleId);
  await ws.save();
  return { success: true, pinned: true };
}

async function unpinBundle(userId, bundleId) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const ws = await getOrCreateWorkspace(userId);
  ws.pinnedBundles = ws.pinnedBundles.filter((id) => id.toString() !== bundleId);
  await ws.save();
  return { success: true, pinned: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspace/bundle/:bundleId
// Fetch a single bundle's full live state for the workspace panel.
// ─────────────────────────────────────────────────────────────────────────────

async function getBundleState(userId, bundleId) {
  if (!mongoose.Types.ObjectId.isValid(bundleId)) throw new Error("Invalid bundle ID");

  const bundle = await Bundle.findOne({ _id: bundleId, userId });
  if (!bundle) throw new Error("Bundle not found");

  return { success: true, bundle: sanitizeBundleForClient(bundle) };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspace/memory
// Merge new entries into workspace global memory.
// ─────────────────────────────────────────────────────────────────────────────

async function updateWorkspaceMemory(userId, entries = {}) {
  const ws = await getOrCreateWorkspace(userId);
  ws.mergeWorkspaceMemory(entries);
  await ws.save();
  return { success: true };
}

module.exports = {
  getWorkspaceState,
  runBundle,
  completeStep,
  pauseBundle,
  resumeBundle,
  pinBundle,
  unpinBundle,
  getBundleState,
  updateWorkspaceMemory,
};
