const express = require("express");
const bcrypt = require("bcrypt");
const TenantStore = require("../models/TenantStore");
const Campaign = require("../models/Campaign");
const FunnelEvent = require("../models/FunnelEvent");
const Participant = require("../models/Participant");
const AdminUser = require("../models/AdminUser");
const RefreshToken = require("../models/RefreshToken");
const SmsDeliveryLog = require("../models/SmsDeliveryLog");
const { requireAuth, requireSuperAdmin, canAccessStore } = require("../middleware/auth");
const { funnelStages, createOrReactivateCampaign } = require("../services/campaignService");
const { toCSV } = require("../utils/csv");
const { parsePagination, paginationMeta } = require("../utils/pagination");

const router = express.Router();
router.use(requireAuth);

const secretFields = new Set(["shopifyAccessToken", "smsPassword", "flitsApiKey", "flitsCreditToken"]);

function parseDateRange(query) {
  const start = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = query.endDate ? new Date(query.endDate) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const error = new Error("Invalid date range");
    error.status = 400;
    throw error;
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function storeResponse(store, counts = {}) {
  return {
    _id: store._id,
    name: store.name,
    slug: store.slug,
    shopifyDomain: store.shopifyDomain,
    game_enabled: store.game_enabled !== false,
    enabled: store.enabled,
    deletedAt: store.deletedAt,
    updatedAt: store.updatedAt,
    createdAt: store.createdAt,
    campaignCount: counts.campaignCount || 0,
    userCount: counts.userCount || 0,
    secrets: {
      shopifyAccessToken: Boolean(store.shopifyAccessToken),
      smsPassword: Boolean(store.smsConfig?.password),
      flitsApiKey: Boolean(store.flitsConfig?.apiKey),
      flitsCreditToken: Boolean(store.flitsConfig?.creditLookupToken)
    },
    smsConfig: {
      user: store.smsConfig?.user || "",
      senderId: store.smsConfig?.senderId || "",
      route: store.smsConfig?.route || "",
      dltTemplateId: store.smsConfig?.dltTemplateId || "",
      peid: store.smsConfig?.peid || "",
      messageTemplate: store.smsConfig?.messageTemplate || ""
    },
    flitsConfig: {
      customActionUrl: store.flitsConfig?.customActionUrl || "",
      creditLookupUrl: store.flitsConfig?.creditLookupUrl || "",
      creditLookupUserId: store.flitsConfig?.creditLookupUserId || "",
      integrationAppName: store.flitsConfig?.integrationAppName || "",
      flitsEligibleTags: store.flitsConfig?.flitsEligibleTags || []
    }
  };
}

function userResponse(user) {
  return {
    _id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantStoreIds: (user.tenantStoreIds || []).map(String),
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function scopedStoreFilter(req, includeDeleted = false) {
  const filter = includeDeleted ? {} : { deletedAt: null };
  if (req.auth.role !== "super_admin") filter._id = { $in: req.auth.tenantStoreIds };
  return filter;
}

async function countsForStores(storeIds) {
  const [campaignCounts, userCounts] = await Promise.all([
    Campaign.aggregate([
      { $match: { tenantStoreId: { $in: storeIds }, deletedAt: null } },
      { $group: { _id: "$tenantStoreId", count: { $sum: 1 } } }
    ]),
    AdminUser.aggregate([
      { $match: { role: "store_admin", tenantStoreIds: { $in: storeIds }, active: true } },
      { $unwind: "$tenantStoreIds" },
      { $match: { tenantStoreIds: { $in: storeIds } } },
      { $group: { _id: "$tenantStoreIds", count: { $sum: 1 } } }
    ])
  ]);
  const map = {};
  for (const id of storeIds) map[String(id)] = { campaignCount: 0, userCount: 0 };
  for (const item of campaignCounts) map[String(item._id)].campaignCount = item.count;
  for (const item of userCounts) map[String(item._id)].userCount = item.count;
  return map;
}

async function requireCampaignAccess(req) {
  const { storeId, campaignId } = req.query;
  if (!storeId) {
    const error = new Error("storeId is required");
    error.status = 400;
    throw error;
  }
  if (!canAccessStore(req, storeId)) {
    const error = new Error("Store access denied");
    error.status = 403;
    throw error;
  }
  const campaign = campaignId
    ? await Campaign.findOne({ _id: campaignId, tenantStoreId: storeId, deletedAt: null, enabled: true })
    : await Campaign.findOne({ tenantStoreId: storeId, deletedAt: null, enabled: true }).sort({ createdAt: 1 });
  if (!campaign) {
    const error = new Error("Campaign not found");
    error.status = 404;
    throw error;
  }
  return campaign;
}

function applySecretPatch(target, patch, clearSecrets = []) {
  for (const field of clearSecrets) {
    if (!secretFields.has(field)) continue;
    if (field === "shopifyAccessToken") target.shopifyAccessToken = "";
    if (field === "smsPassword") target.smsConfig.password = "";
    if (field === "flitsApiKey") target.flitsConfig.apiKey = "";
    if (field === "flitsCreditToken") target.flitsConfig.creditLookupToken = "";
  }
  if (patch.shopifyAccessToken) target.shopifyAccessToken = patch.shopifyAccessToken;
  if (patch.smsConfig?.password) target.smsConfig.password = patch.smsConfig.password;
  if (patch.flitsConfig?.apiKey) target.flitsConfig.apiKey = patch.flitsConfig.apiKey;
  if (patch.flitsConfig?.creditLookupToken) target.flitsConfig.creditLookupToken = patch.flitsConfig.creditLookupToken;
}

router.get("/stores", async (req, res, next) => {
  try {
    const includeDeleted = req.query.includeDeleted === "true" && req.auth.role === "super_admin";
    const stores = await TenantStore.find(await scopedStoreFilter(req, includeDeleted)).sort({ name: 1 });
    const countMap = await countsForStores(stores.map((store) => store._id));
    res.json({ stores: stores.map((store) => storeResponse(store, countMap[String(store._id)])) });
  } catch (err) {
    next(err);
  }
});

router.get("/stores/:storeId", async (req, res, next) => {
  try {
    if (!canAccessStore(req, req.params.storeId)) return res.status(403).json({ error: "Store access denied" });
    const store = await TenantStore.findById(req.params.storeId);
    if (!store || (store.deletedAt && req.auth.role !== "super_admin")) return res.status(404).json({ error: "Store not found" });
    const countMap = await countsForStores([store._id]);
    res.json({ store: storeResponse(store, countMap[String(store._id)]) });
  } catch (err) {
    next(err);
  }
});

router.post("/stores", requireSuperAdmin, async (req, res, next) => {
  try {
    const store = await TenantStore.create(req.body);
    res.status(201).json({ store: storeResponse(store) });
  } catch (err) {
    next(err);
  }
});

router.patch("/stores/:storeId", requireSuperAdmin, async (req, res, next) => {
  try {
    const store = await TenantStore.findOne({ _id: req.params.storeId, deletedAt: null });
    if (!store) return res.status(404).json({ error: "Store not found" });
    const body = req.body || {};
    for (const field of ["name", "slug", "shopifyDomain", "enabled", "game_enabled"]) {
      if (body[field] !== undefined) store[field] = body[field];
    }
    store.smsConfig = store.smsConfig || {};
    store.flitsConfig = store.flitsConfig || {};
    store.smsConfig = {
      ...store.smsConfig,
      ...(body.smsConfig || {}),
      password: store.smsConfig?.password || ""
    };
    store.flitsConfig = {
      ...store.flitsConfig,
      ...(body.flitsConfig || {}),
      apiKey: store.flitsConfig?.apiKey || "",
      creditLookupToken: store.flitsConfig?.creditLookupToken || ""
    };
    applySecretPatch(store, body, body.clearSecrets || []);
    await store.save();
    res.json({ store: storeResponse(store) });
  } catch (err) {
    next(err);
  }
});

router.delete("/stores/:storeId", requireSuperAdmin, async (req, res, next) => {
  try {
    const store = await TenantStore.findOne({ _id: req.params.storeId, deletedAt: null });
    if (!store) return res.status(404).json({ error: "Store not found" });
    const now = new Date();
    store.enabled = false;
    store.deletedAt = now;
    await store.save();
    await Campaign.updateMany({ tenantStoreId: store._id, deletedAt: null }, { $set: { enabled: false, deletedAt: now } });
    const affectedUsers = await AdminUser.find({ role: "store_admin", tenantStoreIds: store._id });
    for (const user of affectedUsers) {
      user.tenantStoreIds = (user.tenantStoreIds || []).filter((id) => String(id) !== String(store._id));
      if (!user.tenantStoreIds.length) {
        user.active = false;
        await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: now } });
      }
      await user.save();
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/campaigns", async (req, res, next) => {
  try {
    const storeId = req.query.storeId;
    if (!storeId || !canAccessStore(req, storeId)) return res.status(403).json({ error: "Store access denied" });
    const campaigns = await Campaign.find({ tenantStoreId: storeId, deletedAt: null }).sort({ createdAt: 1 });
    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

router.post("/campaigns", requireSuperAdmin, async (req, res, next) => {
  try {
    const store = await TenantStore.findOne({ _id: req.body.tenantStoreId, deletedAt: null });
    if (!store) return res.status(404).json({ error: "Store not found" });
    const { campaign, reactivated } = await createOrReactivateCampaign(req.body);
    res.status(reactivated ? 200 : 201).json({ campaign, reactivated });
  } catch (err) {
    next(err);
  }
});

router.patch("/campaigns/:campaignId", requireSuperAdmin, async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, deletedAt: null });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    for (const field of ["name", "slug", "mechanicType", "playEventLabel", "otpLength", "otpTtlMinutes", "eligibilityTags", "postPlayTags", "flitsCredit", "customCredit", "enabled", "rewards"]) {
      if (req.body[field] !== undefined) campaign[field] = req.body[field];
    }
    await campaign.save();
    res.json({ campaign });
  } catch (err) {
    next(err);
  }
});

router.delete("/campaigns/:campaignId", requireSuperAdmin, async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, deletedAt: null });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    campaign.enabled = false;
    campaign.deletedAt = new Date();
    await campaign.save();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/users", requireSuperAdmin, async (req, res, next) => {
  try {
    const filter = { role: "store_admin" };
    if (req.query.storeId) filter.tenantStoreIds = req.query.storeId;
    const users = await AdminUser.find(filter).sort({ createdAt: -1 }).select("-passwordHash");
    res.json({ users: users.map(userResponse) });
  } catch (err) {
    next(err);
  }
});

router.post("/users", requireSuperAdmin, async (req, res, next) => {
  try {
    const { email, name, password, tenantStoreIds = [] } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: "email, name and password are required" });
    const stores = await TenantStore.find({ _id: { $in: tenantStoreIds }, deletedAt: null });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await AdminUser.create({
      email,
      name,
      passwordHash,
      role: "store_admin",
      tenantStoreIds: stores.map((store) => store._id),
      active: true
    });
    res.status(201).json({ user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:userId", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = await AdminUser.findOne({ _id: req.params.userId, role: "store_admin" });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.active !== undefined) user.active = req.body.active;
    if (req.body.tenantStoreIds) {
      const stores = await TenantStore.find({ _id: { $in: req.body.tenantStoreIds }, deletedAt: null });
      user.tenantStoreIds = stores.map((store) => store._id);
    }
    await user.save();
    if (!user.active) await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:userId/reset-password", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = await AdminUser.findOne({ _id: req.params.userId, role: "store_admin" });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!req.body.password) return res.status(400).json({ error: "password is required" });
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    await user.save();
    await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:userId/deactivate", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = await AdminUser.findOne({ _id: req.params.userId, role: "store_admin" });
    if (!user) return res.status(404).json({ error: "User not found" });
    user.active = false;
    await user.save();
    await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ user: userResponse(user) });
  } catch (err) {
    next(err);
  }
});

router.get("/funnel-stats", async (req, res, next) => {
  try {
    const campaign = await requireCampaignAccess(req);
    const { start, end } = parseDateRange(req.query);
    const eventType = req.query.eventType;
    if (!eventType || eventType === "funnel") return res.status(400).json({ error: "eventType is required" });
    const pagination = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 });
    const filter = {
      tenantStoreId: req.query.storeId,
      campaignId: campaign._id,
      eventType,
      occurredAt: { $gte: start, $lte: end }
    };
    if (req.query.mobile) filter.mobile = new RegExp(String(req.query.mobile).replace(/[^\d]/g, ""), "i");

    const [total, events] = await Promise.all([
      FunnelEvent.countDocuments(filter),
      FunnelEvent.find(filter).sort({ occurredAt: -1 }).skip(pagination.skip).limit(pagination.limit)
    ]);
    res.json({
      total,
      page: pagination.page,
      limit: pagination.limit,
      pagination: paginationMeta({ total, page: pagination.page, limit: pagination.limit }),
      label: eventType === "played" ? campaign.playEventLabel : eventType,
      rows: events.map((event, index) => ({
        index: pagination.skip + index + 1,
        name: event.name,
        mobile: event.mobile,
        timestamp: event.occurredAt
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard-stats", async (req, res, next) => {
  try {
    const campaign = await requireCampaignAccess(req);
    const { start, end } = parseDateRange(req.query);
    const base = {
      tenantStoreId: req.query.storeId,
      campaignId: campaign._id,
      occurredAt: { $gte: start, $lte: end }
    };
    if (req.query.mobile) base.mobile = new RegExp(String(req.query.mobile).replace(/[^\d]/g, ""), "i");
    const stages = funnelStages(campaign);
    const counts = {};
    for (const stage of stages) {
      counts[stage.key] = await FunnelEvent.countDocuments({ ...base, eventType: stage.key });
    }
    const conversionRates = {
      enteredToOtpSent: counts.entered ? (counts.otp_sent / counts.entered) * 100 : 0,
      otpSentToOtpVerified: counts.otp_sent ? (counts.otp_verified / counts.otp_sent) * 100 : 0,
      otpVerifiedToPlayed: counts.otp_verified ? (counts.played / counts.otp_verified) * 100 : 0
    };
    res.json({ stages, counts, conversionRates });
  } catch (err) {
    next(err);
  }
});

router.get("/funnel-export", async (req, res, next) => {
  try {
    const campaign = await requireCampaignAccess(req);
    const { start, end } = parseDateRange(req.query);
    const eventType = req.query.eventType;
    if (!eventType || eventType === "funnel") return res.status(400).json({ error: "eventType is required" });
    const filter = {
      tenantStoreId: req.query.storeId,
      campaignId: campaign._id,
      eventType,
      occurredAt: { $gte: start, $lte: end }
    };
    if (req.query.mobile) filter.mobile = new RegExp(String(req.query.mobile).replace(/[^\d]/g, ""), "i");
    const events = await FunnelEvent.find(filter).sort({ occurredAt: -1 }).limit(10000);
    const rows = events.map((event, index) => ({
      "#": index + 1,
      Stage: eventType,
      Name: event.name,
      Mobile: event.mobile,
      Timestamp: event.occurredAt.toISOString(),
      Reward: event.rewardLabel || ""
    }));
    res.header("Content-Type", "text/csv");
    res.attachment(`${eventType}-funnel.csv`);
    res.send(toCSV(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/participants", async (req, res, next) => {
  try {
    const campaign = await requireCampaignAccess(req);
    const participants = await Participant.find({ tenantStoreId: req.query.storeId, campaignId: campaign._id }).sort({ playedAt: -1 }).limit(100);
    res.json({ participants });
  } catch (err) {
    next(err);
  }
});

router.get("/sms-delivery-logs", async (req, res, next) => {
  try {
    const storeId = req.query.storeId;
    if (!storeId) return res.status(400).json({ error: "storeId is required" });
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: "Store access denied" });

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const filter = { tenantStoreId: storeId };
    if (req.query.phone) filter.phone = new RegExp(String(req.query.phone).replace(/[^\d]/g, ""));
    if (req.query.jobId) filter.jobId = String(req.query.jobId);
    if (req.query.messageId) filter.messageId = String(req.query.messageId);
    if (req.query.deliveryStatus) filter.deliveryStatus = String(req.query.deliveryStatus);

    const logs = await SmsDeliveryLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({
      logs: logs.map((log) => ({
        _id: log._id,
        provider: log.provider,
        channel: log.channel,
        phone: log.phone,
        senderId: log.senderId,
        route: log.route,
        dltTemplateId: log.dltTemplateId,
        peid: log.peid,
        jobId: log.jobId,
        messageId: log.messageId,
        submitStatus: log.submitStatus,
        deliveryStatus: log.deliveryStatus,
        statusText: log.statusText,
        errorCode: log.errorCode,
        errorMessage: log.errorMessage,
        deliveredAt: log.deliveredAt,
        lastProviderUpdateAt: log.lastProviderUpdateAt,
        createdAt: log.createdAt,
        updatedAt: log.updatedAt,
        providerResponse: log.providerResponse,
        providerCallback: log.providerCallback
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
