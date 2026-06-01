const express = require("express");
const { randomUUID } = require("crypto");
const OtpChallenge = require("../models/OtpChallenge");
const Participant = require("../models/Participant");
const { findCampaignBySlugs, pickReward } = require("../services/campaignService");
const { buildOtp, sendOtpSms } = require("../services/otpService");
const { findOrCreateCustomer, addCustomerTags } = require("../services/shopifyService");
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

router.post("/:storeSlug/:campaignSlug/start", async (req, res, next) => {
  try {
    const { store, campaign } = await findCampaignBySlugs(req.params.storeSlug, req.params.campaignSlug);
    const normalizedPhone = validateDetails(req.body);
    const phoneIdentifier = hashPhone(normalizedPhone, store._id);
    const existing = await Participant.findOne({ tenantStoreId: store._id, campaignId: campaign._id, phoneHash: phoneIdentifier });
    if (existing?.playedAt) {
      return res.status(409).json({ error: "This mobile number has already played", alreadyPlayed: true });
    }

    const shopifyResult = await findOrCreateCustomer(store, {
      name: req.body.name,
      email: req.body.email,
      phone: normalizedPhone
    });
    const eligibilityCustomer = shopifyResult.eligibilityCustomer || shopifyResult.primaryCustomer;
    const primaryCustomer = shopifyResult.primaryCustomer;
    const tags = eligibilityCustomer?.tags || [];
    const alreadyRedeemed = campaign.eligibilityTags.some((tag) => tags.includes(tag));
    const { otp, otpHash } = buildOtp(campaign.otpLength || 6);
    const expiresAt = new Date(Date.now() + (campaign.otpTtlMinutes || 10) * 60 * 1000);
    const challenge = await OtpChallenge.create({
      tenantStoreId: store._id,
      campaignId: campaign._id,
      challengeId: randomUUID(),
      phoneHash: phoneIdentifier,
      otpHash,
      name: req.body.name,
      email: req.body.email,
      phoneMasked: maskPhone(normalizedPhone),
      phoneDisplay: normalizedPhone,
      shopifyCustomerId: primaryCustomer?.numericId,
      shopifyCustomerGid: primaryCustomer?.id,
      eligibilityCustomerId: eligibilityCustomer?.numericId,
      eligibilityCustomerGid: eligibilityCustomer?.id,
      phoneCollision: Boolean(shopifyResult.phoneCollision),
      alreadyRedeemed,
      expiresAt
    });
    await sendOtpSms(store, normalizedPhone, otp);
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
      phoneCollision: challenge.phoneCollision,
      alreadyRedeemed,
      otp
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
