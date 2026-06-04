const express = require("express");
const TenantStore = require("../models/TenantStore");
const CustomerTag = require("../models/CustomerTag");
const SmsDeliveryLog = require("../models/SmsDeliveryLog");
const { verifyShopifyWebhook } = require("../middleware/webhook");

const router = express.Router();

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeStatus(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized) return "unknown";
  if (["delivered", "delivery", "success"].includes(normalized)) return "delivered";
  if (["submitted", "submit", "accepted"].includes(normalized)) return "submitted";
  if (["failed", "failure", "undelivered", "reject", "rejected", "expired"].includes(normalized)) return "failed";
  return normalized;
}

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

router.post("/sms/alot/status", async (req, res, next) => {
  try {
    const body = req.body || {};
    const jobId = String(firstDefined(body.JobId, body.jobId, body.jobid, body.JobID)).trim();
    const messageId = String(firstDefined(body.MessageId, body.messageId, body.messageid, body.MessageID, body.SmsId, body.smsid)).trim();
    const phone = String(firstDefined(body.Number, body.number, body.Mobile, body.mobile, body.Phone, body.phone)).trim();
    const rawStatus = String(firstDefined(body.Status, body.status, body.DeliveryStatus, body.deliveryStatus, body.State, body.state)).trim();
    const statusText = String(firstDefined(body.Remark, body.remark, body.Description, body.description, body.ErrorMessage, body.errorMessage)).trim();
    const deliveredAtRaw = firstDefined(body.DeliveredAt, body.deliveredAt, body.DoneDate, body.doneDate, body.SubmitDate, body.submitDate);

    const filter = {};
    if (jobId) filter.jobId = jobId;
    if (messageId) filter.messageId = messageId;
    if (!Object.keys(filter).length) {
      return res.status(400).json({ error: "jobId or messageId is required" });
    }

    const log = await SmsDeliveryLog.findOne({
      $or: Object.entries(filter).map(([key, value]) => ({ [key]: value }))
    }).sort({ createdAt: -1 });
    if (!log) return res.status(404).json({ error: "SMS delivery log not found" });

    log.deliveryStatus = normalizeStatus(rawStatus || statusText || log.deliveryStatus);
    log.statusText = statusText || rawStatus || log.statusText;
    log.errorCode = String(firstDefined(body.ErrorCode, body.errorCode, log.errorCode)).trim();
    log.errorMessage = String(firstDefined(body.ErrorMessage, body.errorMessage, statusText, log.errorMessage)).trim();
    log.lastProviderUpdateAt = new Date();
    log.providerCallback = body;
    if (phone) log.phone = phone;
    if (deliveredAtRaw) {
      const deliveredAt = new Date(deliveredAtRaw);
      if (!Number.isNaN(deliveredAt.getTime())) log.deliveredAt = deliveredAt;
    }
    await log.save();

    console.log("[sms] ALOT delivery callback", {
      logId: log._id,
      jobId: log.jobId,
      messageId: log.messageId,
      deliveryStatus: log.deliveryStatus,
      statusText: log.statusText
    });
    res.json({ success: true, logId: String(log._id), deliveryStatus: log.deliveryStatus });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
