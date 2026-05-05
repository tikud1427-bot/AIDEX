"use strict";

const express = require("express");
const router  = express.Router();

// POST /api/aqua/execute  ← frontend expects this exact path
router.use("/aqua",      require("./aqua.routes"));

// POST /api/projects/generate, GET /api/projects/:id/preview, etc.
router.use("/projects",  require("./project.routes"));

// GET/POST /api/workspace/...
router.use("/workspace", require("./workspace.routes"));

module.exports = router;