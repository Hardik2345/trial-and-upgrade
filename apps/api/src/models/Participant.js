const mongoose = require("mongoose");

const ParticipantSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phoneHash: { type: String, required: true },
    phoneMasked: { type: String, required: true },
    phoneDisplay: { type: String, default: "" },
    shopifyCustomerId: String,
    shopifyCustomerGid: String,
    eligibilityCustomerId: String,
    eligibilityCustomerGid: String,
    creditCustomerId: String,
    creditCustomerGid: String,
    creditCustomerEmail: { type: String, lowercase: true, trim: true },
    phoneCollision: { type: Boolean, default: false },
    customerSource: { type: String, enum: ["existing", "marketplace"], default: "existing" },
    reward: {
      key: String,
      label: String,
      value: Number,
      metadata: mongoose.Schema.Types.Mixed
    },
    alreadyRedeemed: { type: Boolean, default: false },
    startedAt: Date,
    otpSentAt: Date,
    otpVerifiedAt: Date,
    playedAt: Date
  },
  { timestamps: true }
);

ParticipantSchema.index({ tenantStoreId: 1, campaignId: 1, phoneHash: 1 }, { unique: true });

module.exports = mongoose.model("Participant", ParticipantSchema);
