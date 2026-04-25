const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────────
// Sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

const ExecutionSessionSchema = new mongoose.Schema({
  bundleId:    { type: mongoose.Schema.Types.ObjectId, ref: "Bundle", required: true },
  startedAt:   { type: Date, default: Date.now },
  lastActiveAt:{ type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["running", "paused", "completed", "failed"],
    default: "running",
  },
  currentStep: { type: Number, default: 0 },
  totalSteps:  { type: Number, default: 0 },
}, { _id: true });

const RecentOutputSchema = new mongoose.Schema({
  bundleId:  { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
  bundleTitle: { type: String, default: "" },
  stepIndex: { type: Number, default: 0 },
  stepTitle: { type: String, default: "" },
  preview:   { type: String, default: "" },   // First 300 chars of content
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

// ─────────────────────────────────────────────────────────────────────────────
// Core Workspace Schema
// ─────────────────────────────────────────────────────────────────────────────

const WorkspaceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // ── Tool management ───────────────────────────────────────────────────────
    tools: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tool" }],

    // ── Bundle execution management ───────────────────────────────────────────
    // Currently active bundle IDs (being executed right now)
    activeBundles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Bundle" }],

    // Pinned / bookmarked bundles
    pinnedBundles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Bundle" }],

    // ── Execution sessions ────────────────────────────────────────────────────
    // Tracks live execution sessions (max 10 kept)
    executionSessions: { type: [ExecutionSessionSchema], default: [] },

    // ── Recent outputs ────────────────────────────────────────────────────────
    // Rolling log of the last 20 step outputs across all bundles
    recentOutputs: { type: [RecentOutputSchema], default: [] },

    // ── Global workspace memory ───────────────────────────────────────────────
    // Cross-bundle persistent key-value layer
    // e.g. { "preferred_stack": "Node + React", "industry": "SaaS" }
    workspaceMemory: {
      type: Map,
      of: String,
      default: {},
    },

    // ── UI preferences ────────────────────────────────────────────────────────
    lastOpenBundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle", default: null },
    activeTab:        { type: String, enum: ["bundles", "tools", "outputs", "memory"], default: "bundles" },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Instance helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open or refresh an execution session for a bundle.
 */
WorkspaceSchema.methods.openSession = function (bundleId, totalSteps) {
  const existing = this.executionSessions.find(
    (s) => s.bundleId.toString() === bundleId.toString()
  );
  if (existing) {
    existing.lastActiveAt = new Date();
    existing.status       = "running";
    existing.totalSteps   = totalSteps || existing.totalSteps;
  } else {
    this.executionSessions.push({ bundleId, status: "running", totalSteps: totalSteps || 0 });
    // Cap at 10 sessions
    if (this.executionSessions.length > 10) {
      this.executionSessions = this.executionSessions.slice(-10);
    }
  }

  // Ensure bundleId in activeBundles
  const already = this.activeBundles.some((id) => id.toString() === bundleId.toString());
  if (!already) this.activeBundles.push(bundleId);
};

/**
 * Update session state for a bundle.
 */
WorkspaceSchema.methods.updateSession = function (bundleId, patch = {}) {
  const session = this.executionSessions.find(
    (s) => s.bundleId.toString() === bundleId.toString()
  );
  if (!session) return;
  if (patch.status      !== undefined) session.status      = patch.status;
  if (patch.currentStep !== undefined) session.currentStep = patch.currentStep;
  session.lastActiveAt = new Date();
};

/**
 * Close an execution session (completed / paused).
 */
WorkspaceSchema.methods.closeSession = function (bundleId, status = "completed") {
  this.updateSession(bundleId, { status });
  if (status === "completed") {
    this.activeBundles = this.activeBundles.filter(
      (id) => id.toString() !== bundleId.toString()
    );
  }
};

/**
 * Push a step output preview into recentOutputs (max 20).
 */
WorkspaceSchema.methods.pushRecentOutput = function (entry) {
  this.recentOutputs.unshift({
    bundleId:    entry.bundleId,
    bundleTitle: entry.bundleTitle || "",
    stepIndex:   entry.stepIndex,
    stepTitle:   entry.stepTitle || "",
    preview:     (entry.content || "").substring(0, 300),
    createdAt:   new Date(),
  });
  if (this.recentOutputs.length > 20) {
    this.recentOutputs = this.recentOutputs.slice(0, 20);
  }
};

/**
 * Merge entries into global workspace memory.
 */
WorkspaceSchema.methods.mergeWorkspaceMemory = function (newEntries = {}) {
  for (const [k, v] of Object.entries(newEntries)) {
    if (k && v) this.workspaceMemory.set(k.trim(), String(v).trim());
  }
};

module.exports = mongoose.model("Workspace", WorkspaceSchema);
