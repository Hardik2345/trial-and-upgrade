const mongoose = require("mongoose");

const OtpChallengeSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    challengeId: { type: String, required: true, unique: true },
    phoneHash: { type: String, required: true, index: true },
    otpHash: { type: String, required: true },
    name: String,
    email: String,
    phoneMasked: String,
    phoneDisplay: String,
    shopifyCustomerId: String,
    shopifyCustomerGid: String,
    eligibilityCustomerId: String,
    eligibilityCustomerGid: String,
    creditCustomerId: String,
    creditCustomerGid: String,
    creditCustomerEmail: String,
    phoneCollision: { type: Boolean, default: false },
    customerSource: { type: String, enum: ["existing", "marketplace"], default: "existing" },
    alreadyRedeemed: { type: Boolean, default: false },
    verifiedAt: Date,
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true }
);

module.exports = mongoose.model("OtpChallenge", OtpChallengeSchema);
