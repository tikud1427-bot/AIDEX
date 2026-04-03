const mongoose = require("mongoose");

const BundleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  title: String,
  steps: Array,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Bundle", BundleSchema);