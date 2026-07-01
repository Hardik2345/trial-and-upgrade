const mongoose = require("mongoose");

const RewardSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    value: { type: Number, default: 0 },
    weight: { type: Number, default: 1 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const CampaignSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    mechanicType: { type: String, default: "spin_the_wheel" },
    playEventLabel: { type: String, default: "Spun Wheel" },
    otpLength: { type: Number, default: 6 },
    otpTtlMinutes: { type: Number, default: 10 },
    rewards: { type: [RewardSchema], default: [] },
    eligibilityTags: { type: [String], default: [] },
    postPlayTags: { type: [String], default: ["played"] },
    flitsCredit: {
      enabled: { type: Boolean, default: true },
      value: { type: Number, default: 399 },
      commentText: { type: String, default: "Rewarding the user in wallet" }
    },
    customCredit: {
      marketplaceAutoCreditEnabled: { type: Boolean, default: false },
      marketplaceOnlyCredit: { type: Boolean, default: false }
    },
    enabled: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

CampaignSchema.index({ tenantStoreId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model("Campaign", CampaignSchema);
