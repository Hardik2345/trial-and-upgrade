const mongoose = require("mongoose");

const TenantStoreSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    shopifyDomain: { type: String, required: true, trim: true },
    shopifyAccessToken: { type: String, default: "" },
    smsConfig: {
      user: String,
      password: String,
      senderId: String,
      route: String,
      dltTemplateId: String,
      peid: String
    },
    flitsConfig: {
      customActionUrl: String,
      apiKey: String
    },
    enabled: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("TenantStore", TenantStoreSchema);
