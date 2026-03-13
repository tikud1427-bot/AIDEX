const mongoose = require("mongoose");

const ToolSchema = new mongoose.Schema({
  name: String,
  description: String,
  link: String,
  category: String,
  rating: {
    type: Number,
    default: 0
  },
  ratingsCount: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model("Tool", ToolSchema);
