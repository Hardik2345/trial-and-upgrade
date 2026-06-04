const mongoose = require("mongoose");

const SmsDeliveryLogSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", index: true },
    provider: { type: String, default: "ALOT", index: true },
    channel: { type: String, default: "otp", index: true },
    phone: { type: String, default: "", index: true },
    senderId: { type: String, default: "" },
    route: { type: String, default: "" },
    dltTemplateId: { type: String, default: "" },
    peid: { type: String, default: "" },
    jobId: { type: String, default: "", index: true },
    messageId: { type: String, default: "", index: true },
    submitStatus: { type: String, default: "pending", index: true },
    deliveryStatus: { type: String, default: "unknown", index: true },
    statusText: { type: String, default: "" },
    errorCode: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
    deliveredAt: Date,
    lastProviderUpdateAt: Date,
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
    providerCallback: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

SmsDeliveryLogSchema.index({ tenantStoreId: 1, createdAt: -1 });

module.exports = mongoose.model("SmsDeliveryLog", SmsDeliveryLogSchema);
