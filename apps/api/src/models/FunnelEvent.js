const mongoose = require("mongoose");

const FunnelEventSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    participantId: { type: mongoose.Schema.Types.ObjectId, ref: "Participant" },
    eventType: {
      type: String,
      enum: ["entered", "otp_sent", "otp_verified", "played", "reward_credited", "discount_used"],
      required: true,
      index: true
    },
    name: { type: String, default: "" },
    mobile: { type: String, default: "" },
    phoneHash: { type: String, default: "" },
    email: { type: String, default: "" },
    rewardLabel: String,
    occurredAt: { type: Date, default: Date.now, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

FunnelEventSchema.index({ tenantStoreId: 1, campaignId: 1, eventType: 1, occurredAt: -1 });

module.exports = mongoose.model("FunnelEvent", FunnelEventSchema);
