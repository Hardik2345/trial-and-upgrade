const crypto = require("crypto");
const env = require("../config/env");
const { safeCompare } = require("../utils/crypto");

function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

function verifyShopifyWebhook(req, res, next) {
  if (!env.shopifyWebhookSecret) return res.status(500).json({ error: "Webhook secret is not configured" });
  const hmac = req.get("x-shopify-hmac-sha256") || "";
  const digest = crypto.createHmac("sha256", env.shopifyWebhookSecret).update(req.rawBody || "").digest("base64");
  if (!safeCompare(hmac, digest)) return res.status(401).json({ error: "Invalid webhook signature" });
  return next();
}

module.exports = { rawBodySaver, verifyShopifyWebhook };
