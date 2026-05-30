const mongoose = require("mongoose");

const RefreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: Date,
    replacedByTokenId: { type: mongoose.Schema.Types.ObjectId, ref: "RefreshToken" },
    ip: String,
    userAgent: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("RefreshToken", RefreshTokenSchema);
