const express = require("express");
const { randomUUID } = require("crypto");
const OtpChallenge = require("../models/OtpChallenge");
const Participant = require("../models/Participant");
const TenantStore = require("../models/TenantStore");
const NewUser = require("../models/NewUser");
const UserLookupOtpChallenge = require("../models/UserLookupOtpChallenge");
const env = require("../config/env");
const { findCampaignBySlugs, pickReward } = require("../services/campaignService");
const { buildOtp, sendOtpSms } = require("../services/otpService");
const { findOrCreateCustomer, addCustomerTags, findCustomer } = require("../services/shopifyService");
const { enqueueCredit } = require("../services/flitsService");
const { recordFunnelEvent } = require("../services/funnelService");
const { normalizePhone, maskPhone, hashPhone, sha256 } = require("../utils/crypto");

const router = express.Router();

function validateDetails({ name, email, phone }) {
  if (!name || !email || !phone) {
    const error = new Error("name, email and phone are required");
    error.status = 400;
    throw error;
  }
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    const error = new Error("A valid mobile number is required");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function validatePhoneOnly({ phone }) {
  if (!phone) {
    const error = new Error("phone is required");
    error.status = 400;
    throw error;
  }
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    const error = new Error("A valid mobile number is required");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function customerName(customer) {
  if (!customer) return "";
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
}

async function hydrateChallengeCustomerContext(store, campaign, challenge) {
  const shopifyResult = await findOrCreateCustomer(store, {
    name: challenge.name,
    email: challenge.email,
    phone: challenge.phoneDisplay
  });
  const eligibilityCustomer = shopifyResult.eligibilityCustomer || shopifyResult.primaryCustomer;
  const primaryCustomer = shopifyResult.primaryCustomer;
  const tags = eligibilityCustomer?.tags || [];
  const alreadyRedeemed = campaign.eligibilityTags.some((tag) => tags.includes(tag));

  challenge.shopifyCustomerId = primaryCustomer?.numericId || "";
  challenge.shopifyCustomerGid = primaryCustomer?.id || "";
  challenge.eligibilityCustomerId = eligibilityCustomer?.numericId || "";
  challenge.eligibilityCustomerGid = eligibilityCustomer?.id || "";
  challenge.phoneCollision = Boolean(shopifyResult.phoneCollision);
  challenge.alreadyRedeemed = alreadyRedeemed;
  await challenge.save();

  return { alreadyRedeemed };
}

async function findStoreBySlug(storeSlug) {
  const store = await TenantStore.findOne({ slug: storeSlug, enabled: true, deletedAt: null });
  if (!store) {
    const error = new Error("Store not found");
    error.status = 404;
    throw error;
  }
  return store;
}

async function createOrRefreshOtpChallenge({
  tenantStoreId,
  campaignId,
  phoneHash,
  otpHash,
  expiresAt,
  payload = {}
}) {
  const filter = {
    tenantStoreId,
    phoneHash,
    verifiedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  };
  if (campaignId) {
    filter.campaignId = campaignId;
  } else {
    filter.campaignId = { $exists: false };
  }

  const existing = await OtpChallenge.findOne(filter).sort({ createdAt: -1 });
  if (existing) {
    existing.otpHash = otpHash;
    existing.expiresAt = expiresAt;
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }

  return OtpChallenge.create({
    tenantStoreId,
    campaignId,
    challengeId: randomUUID(),
    phoneHash,
    otpHash,
    expiresAt,
    ...payload
  });
}

async function createOrRefreshUserLookupChallenge({
  tenantStoreId,
  phoneHash,
  otpHash,
  expiresAt,
  payload = {}
}) {
  const existing = await UserLookupOtpChallenge.findOne({
    tenantStoreId,
    phoneHash,
    verifiedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
  if (existing) {
    existing.otpHash = otpHash;
    existing.expiresAt = expiresAt;
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }

  return UserLookupOtpChallenge.create({
    tenantStoreId,
    challengeId: randomUUID(),
    phoneHash,
    otpHash,
    expiresAt,
    ...payload
  });
}

router.post("/:storeSlug/:campaignSlug/start", async (req, res, next) => {
  try {
    const { store, campaign } = await findCampaignBySlugs(req.params.storeSlug, req.params.campaignSlug);
    const normalizedPhone = validateDetails(req.body);
    const phoneIdentifier = hashPhone(normalizedPhone, store._id);
    const { otp, otpHash } = buildOtp(campaign.otpLength || 6);
    const expiresAt = new Date(Date.now() + (campaign.otpTtlMinutes || 10) * 60 * 1000);
    const challenge = await createOrRefreshOtpChallenge({
      tenantStoreId: store._id,
      campaignId: campaign._id,
      phoneHash: phoneIdentifier,
      otpHash,
      expiresAt,
      payload: {
        name: req.body.name,
        email: req.body.email,
        phoneMasked: maskPhone(normalizedPhone),
        phoneDisplay: normalizedPhone
      }
    });
    await sendOtpSms(store, normalizedPhone, otp, { name: req.body.name });
    await recordFunnelEvent({
      store,
      campaign,
      eventType: "entered",
      metadata: { name: req.body.name, email: req.body.email, mobile: normalizedPhone, phoneHash: phoneIdentifier }
    });
    await recordFunnelEvent({
      store,
      campaign,
      eventType: "otp_sent",
      metadata: { name: req.body.name, email: req.body.email, mobile: normalizedPhone, phoneHash: phoneIdentifier }
    });
    res.json({
      success: true,
      challengeId: challenge.challengeId,
      expiresAt,
      phoneCollision: false,
      alreadyRedeemed: false
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:storeSlug/user-lookup", async (req, res, next) => {
  try {
    const store = await findStoreBySlug(req.params.storeSlug);
    const normalizedPhone = validatePhoneOnly(req.body);
    const customer = await findCustomer(store, { phone: normalizedPhone });
    if (!customer) {
      await NewUser.updateOne(
        { tenantStoreId: store._id, phoneNormalized: normalizedPhone },
        {
          $setOnInsert: {
            tenantStoreId: store._id,
            publicId: randomUUID(),
            phoneNormalized: normalizedPhone,
            phoneDisplay: normalizedPhone
          }
        },
        { upsert: true }
      );
      return res.json({
        success: true,
        type: "new",
        phone: normalizedPhone,
        name: "",
        totalPoints: 0,
        redeemedPoints: 0
      });
    }

    const { otp, otpHash } = buildOtp(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const challenge = await createOrRefreshUserLookupChallenge({
      tenantStoreId: store._id,
      phoneHash: hashPhone(normalizedPhone, store._id),
      otpHash,
      expiresAt,
      payload: {
        phoneDisplay: normalizedPhone,
        shopifyCustomerId: customer.numericId,
        shopifyCustomerGid: customer.id
      }
    });
    await sendOtpSms(store, normalizedPhone, otp, { name: customerName(customer) });
    const response = {
      success: true,
      type: "existing",
      phone: normalizedPhone,
      name: customerName(customer),
      challengeId: challenge.challengeId,
      expiresAt
    };
    if (env.devReturnOtp) response.otp = otp;
    res.json(response);
  } catch (err) {
    next(err);
  }
});

router.post("/:storeSlug/user-lookup/verify", async (req, res, next) => {
  try {
    const store = await findStoreBySlug(req.params.storeSlug);
    if (!req.body.challengeId || !req.body.otp) {
      const error = new Error("challengeId and otp are required");
      error.status = 400;
      throw error;
    }
    const challenge = await UserLookupOtpChallenge.findOne({
      challengeId: req.body.challengeId,
      tenantStoreId: store._id
    });
    if (!challenge) return res.status(404).json({ error: "OTP challenge not found" });
    if (challenge.expiresAt <= new Date()) return res.status(400).json({ error: "OTP expired" });
    if (challenge.otpHash !== sha256(req.body.otp || "")) return res.status(400).json({ error: "Invalid OTP" });

    challenge.verifiedAt = new Date();
    await challenge.save();
    res.json({
      success: true,
      verified: true,
      type: "existing",
      phone: challenge.phoneDisplay,
      name: "",
      totalPoints: null,
      redeemedPoints: null
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:storeSlug/:campaignSlug/verify-otp", async (req, res, next) => {
  try {
    const { store, campaign } = await findCampaignBySlugs(req.params.storeSlug, req.params.campaignSlug);
    const challenge = await OtpChallenge.findOne({
      challengeId: req.body.challengeId,
      tenantStoreId: store._id,
      campaignId: campaign._id
    });
    if (!challenge) return res.status(404).json({ error: "OTP challenge not found" });
    if (challenge.expiresAt <= new Date()) return res.status(400).json({ error: "OTP expired" });
    if (challenge.otpHash !== sha256(req.body.otp || "")) return res.status(400).json({ error: "Invalid OTP" });

    challenge.verifiedAt = new Date();
    await challenge.save();
    const existing = await Participant.findOne({ tenantStoreId: store._id, campaignId: campaign._id, phoneHash: challenge.phoneHash });
    if (existing?.playedAt) {
      return res.json({
        success: true,
        verified: true,
        alreadyPlayed: true,
        message: "This mobile number has already played"
      });
    }
    await hydrateChallengeCustomerContext(store, campaign, challenge);
    await recordFunnelEvent({
      store,
      campaign,
      eventType: "otp_verified",
      metadata: {
        name: challenge.name,
        email: challenge.email,
        mobile: challenge.phoneDisplay || challenge.phoneMasked,
        phoneHash: challenge.phoneHash
      }
    });
    if (store.game_enabled === false) {
      const existing = await Participant.findOne({ tenantStoreId: store._id, campaignId: campaign._id, phoneHash: challenge.phoneHash });
      if (!existing?.playedAt) {
        const participant = await Participant.create({
          tenantStoreId: store._id,
          campaignId: campaign._id,
          name: challenge.name,
          email: challenge.email,
          phoneHash: challenge.phoneHash,
          phoneMasked: challenge.phoneMasked,
          phoneDisplay: challenge.phoneDisplay,
          shopifyCustomerId: challenge.shopifyCustomerId,
          shopifyCustomerGid: challenge.shopifyCustomerGid,
          eligibilityCustomerId: challenge.eligibilityCustomerId,
          eligibilityCustomerGid: challenge.eligibilityCustomerGid,
          phoneCollision: challenge.phoneCollision,
          reward: {
            key: `wallet_${campaign.flitsCredit?.value || 0}`,
            label: "Wallet Credit",
            value: campaign.flitsCredit?.value || 0
          },
          alreadyRedeemed: challenge.alreadyRedeemed,
          startedAt: challenge.createdAt,
          otpSentAt: challenge.createdAt,
          otpVerifiedAt: challenge.verifiedAt,
          playedAt: new Date()
        });
        await recordFunnelEvent({ store, campaign, participant, eventType: "played" });
        if (!challenge.alreadyRedeemed) {
          await enqueueCredit({ store, campaign, participant });
        }
      }
      await OtpChallenge.deleteOne({ _id: challenge._id });
    }
    res.json({ success: true, verified: true });
  } catch (err) {
    next(err);
  }
});

router.post("/:storeSlug/:campaignSlug/play", async (req, res, next) => {
  try {
    const { store, campaign } = await findCampaignBySlugs(req.params.storeSlug, req.params.campaignSlug);
    const challenge = await OtpChallenge.findOne({
      challengeId: req.body.challengeId,
      tenantStoreId: store._id,
      campaignId: campaign._id
    });
    if (!challenge || !challenge.verifiedAt) return res.status(401).json({ error: "OTP verification required" });
    const existing = await Participant.findOne({ tenantStoreId: store._id, campaignId: campaign._id, phoneHash: challenge.phoneHash });
    if (existing?.playedAt) return res.status(409).json({ error: "This mobile number has already played", alreadyPlayed: true });
    if (!challenge.eligibilityCustomerId && !challenge.shopifyCustomerId) {
      await hydrateChallengeCustomerContext(store, campaign, challenge);
    }

    const reward = pickReward(campaign);
    const participant = await Participant.create({
      tenantStoreId: store._id,
      campaignId: campaign._id,
      name: challenge.name,
      email: challenge.email,
      phoneHash: challenge.phoneHash,
      phoneMasked: challenge.phoneMasked,
      phoneDisplay: challenge.phoneDisplay,
      shopifyCustomerId: challenge.shopifyCustomerId,
      shopifyCustomerGid: challenge.shopifyCustomerGid,
      eligibilityCustomerId: challenge.eligibilityCustomerId,
      eligibilityCustomerGid: challenge.eligibilityCustomerGid,
      phoneCollision: challenge.phoneCollision,
      reward: {
        key: reward.key,
        label: reward.label,
        value: reward.value,
        metadata: reward.metadata
      },
      alreadyRedeemed: challenge.alreadyRedeemed,
      startedAt: challenge.createdAt,
      otpSentAt: challenge.createdAt,
      otpVerifiedAt: challenge.verifiedAt,
      playedAt: new Date()
    });
    const tagTargetGid = participant.shopifyCustomerGid || participant.eligibilityCustomerGid;
    await addCustomerTags(store, tagTargetGid, campaign.postPlayTags);
    await recordFunnelEvent({ store, campaign, participant, eventType: "played" });
    const creditJob = challenge.alreadyRedeemed ? null : await enqueueCredit({ store, campaign, participant });
    await OtpChallenge.deleteOne({ _id: challenge._id });
    res.json({
      success: true,
      reward: participant.reward,
      participantId: participant._id,
      creditJobId: creditJob?._id
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "This mobile number has already played", alreadyPlayed: true });
    next(err);
  }
});

router.get("/:storeSlug/:campaignSlug/status", async (req, res, next) => {
  try {
    const { store, campaign } = await findCampaignBySlugs(req.params.storeSlug, req.params.campaignSlug);
    const challenge = req.query.challengeId
      ? await OtpChallenge.findOne({ challengeId: req.query.challengeId, tenantStoreId: store._id, campaignId: campaign._id })
      : null;
    res.json({
      store: { id: store._id, name: store.name, slug: store.slug },
      campaign: {
        id: campaign._id,
        name: campaign.name,
        slug: campaign.slug,
        mechanicType: campaign.mechanicType,
        playEventLabel: campaign.playEventLabel
      },
      challenge: challenge
        ? { verified: Boolean(challenge.verifiedAt), expiresAt: challenge.expiresAt }
        : null
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
