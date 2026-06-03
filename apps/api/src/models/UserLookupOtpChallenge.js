const mongoose = require("mongoose");

const UserLookupOtpChallengeSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    challengeId: { type: String, required: true, unique: true },
    phoneHash: { type: String, required: true, index: true },
    otpHash: { type: String, required: true },
    phoneDisplay: { type: String, required: true },
    shopifyCustomerId: String,
    shopifyCustomerGid: String,
    verifiedAt: Date,
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserLookupOtpChallenge", UserLookupOtpChallengeSchema, "user_lookup_otp_challenges");
