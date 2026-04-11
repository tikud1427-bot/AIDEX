const mongoose = require("mongoose");

const BundleSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  title: String,
  steps: Array,

  // 🔥 ADD THIS
  progress: [
    {
      step: Number,
      status: {
        type: String,
        default: "pending" // pending | in-progress | completed
      }
    }
  ]

}, { timestamps: true });

module.exports = mongoose.model("Bundle", BundleSchema);