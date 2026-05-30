const mongoose = require("mongoose");

const RewardCreditJobSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, ref: "Participant", required: true, index: true },
    status: { type: String, enum: ["pending", "processing", "sent", "failed", "dead"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    nextRunAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    lockedBy: String,
    sentAt: Date,
    processedAt: Date,
    lastError: String,
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

RewardCreditJobSchema.index({ status: 1, nextRunAt: 1, lockedAt: 1 });

module.exports = mongoose.model("RewardCreditJob", RewardCreditJobSchema);
