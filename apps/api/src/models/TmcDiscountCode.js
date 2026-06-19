const mongoose = require("mongoose");

const TmcDiscountCodeSchema = new mongoose.Schema(
  {
    brand: { type: String, required: true, default: "the-man-company" },
    shop: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ["product", "cart"] },
    productIdNumeric: { type: String, default: "" },
    productGid: { type: String, default: "" },
    dtype: { type: String, required: true, enum: ["percent", "fixed"] },
    percent: { type: Number, default: null },
    price: { type: Number, default: null },
    prefix: { type: String, default: "", trim: true },
    orderDiscountCombination: { type: Boolean, default: false },
    durationMinutes: { type: Number, required: true },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    expired: { type: Boolean, default: false, index: true },
    expiredAt: { type: Date, default: null },
    deletedFromShopify: { type: Boolean, default: false, index: true },
    deletedFromShopifyAt: { type: Date, default: null },
    lastCleanupCheckedAt: { type: Date, default: null },
    lastCleanupError: { type: String, default: "" },
    shopifyDiscountId: { type: String, required: true, trim: true },
    shopifyDiscountCodeNodeId: { type: String, required: true, trim: true },
    shopifyResponseMeta: {
      status: { type: String, default: "" },
      asyncUsageCount: { type: Number, default: null }
    }
  },
  {
    timestamps: true,
    collection: "TMC_DISCOUNT_CODES"
  }
);

module.exports = mongoose.model("TmcDiscountCode", TmcDiscountCodeSchema);
