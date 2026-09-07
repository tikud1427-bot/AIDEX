const mongoose = require("mongoose");

const nativeOAuthCodeSchema = new mongoose.Schema(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    versionKey: false,
    timestamps: false,
  },
);

// MongoDB removes expired handoff records automatically. The application also
// checks expiresAt during redemption so expiry does not depend on the TTL
// monitor running at the exact moment of a request.
nativeOAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.NativeOAuthCode ||
  mongoose.model("NativeOAuthCode", nativeOAuthCodeSchema);
