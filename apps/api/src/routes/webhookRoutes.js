const express = require("express");
const TenantStore = require("../models/TenantStore");
const CustomerTag = require("../models/CustomerTag");
const { verifyShopifyWebhook } = require("../middleware/webhook");

const router = express.Router();

router.post("/shopify/customers-update", verifyShopifyWebhook, async (req, res, next) => {
  try {
    const domain = req.get("x-shopify-shop-domain");
    const store = await TenantStore.findOne({ shopifyDomain: domain });
    if (!store) return res.status(404).json({ error: "Store not found" });
    const body = req.body;
    await CustomerTag.findOneAndUpdate(
      { tenantStoreId: store._id, shopifyCustomerId: String(body.id) },
      {
        tenantStoreId: store._id,
        shopifyCustomerId: String(body.id),
        shopifyCustomerGid: `gid://shopify/Customer/${body.id}`,
        phone: body.phone || body.default_address?.phone || "",
        tags: typeof body.tags === "string" ? body.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : body.tags || [],
        lastSyncedAt: new Date()
      },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
