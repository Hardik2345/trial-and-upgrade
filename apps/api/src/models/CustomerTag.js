const mongoose = require("mongoose");

const CustomerTagSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    shopifyCustomerId: { type: String, required: true },
    shopifyCustomerGid: String,
    phone: String,
    tags: { type: [String], default: [] },
    lastSyncedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

CustomerTagSchema.index({ tenantStoreId: 1, shopifyCustomerId: 1 }, { unique: true });

module.exports = mongoose.model("CustomerTag", CustomerTagSchema);
