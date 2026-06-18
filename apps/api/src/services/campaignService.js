const TenantStore = require("../models/TenantStore");
const Campaign = require("../models/Campaign");

function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

async function findCampaignBySlugs(storeSlug, campaignSlug) {
  const store = await TenantStore.findOne({ slug: storeSlug, enabled: true, deletedAt: null });
  if (!store) {
    const error = new Error("Store not found");
    error.status = 404;
    throw error;
  }
  const campaign = await Campaign.findOne({ tenantStoreId: store._id, slug: campaignSlug, enabled: true, deletedAt: null });
  if (!campaign) {
    const error = new Error("Campaign not found");
    error.status = 404;
    throw error;
  }
  return { store, campaign };
}

function pickReward(campaign) {
  const rewards = campaign.rewards?.length
    ? campaign.rewards
    : [{ key: `wallet_${campaign.flitsCredit?.value || 399}`, label: "Wallet Credit", value: campaign.flitsCredit?.value || 399, weight: 1 }];
  const total = rewards.reduce((sum, reward) => sum + Math.max(0, reward.weight || 0), 0);
  let random = Math.random() * (total || 1);
  for (const reward of rewards) {
    random -= Math.max(0, reward.weight || 0);
    if (random <= 0) return reward;
  }
  return rewards[rewards.length - 1];
}

function funnelStages(campaign) {
  return [
    { key: "entered", label: "Entered" },
    { key: "otp_sent", label: "OTP Sent" },
    { key: "otp_verified", label: "OTP Verified" },
    { key: "played", label: campaign.playEventLabel || "Played" }
  ];
}

async function createOrReactivateCampaign(input, { CampaignModel = Campaign } = {}) {
  const tenantStoreId = input.tenantStoreId;
  const slug = normalizeSlug(input.slug);
  const existing = await CampaignModel.findOne({ tenantStoreId, slug });

  if (existing?.deletedAt) {
    Object.assign(existing, input, {
      tenantStoreId,
      slug,
      enabled: input.enabled !== undefined ? input.enabled : true,
      deletedAt: null
    });
    await existing.save();
    return { campaign: existing, reactivated: true };
  }

  if (existing) {
    const error = new Error("Campaign slug already exists");
    error.status = 409;
    throw error;
  }

  const campaign = await CampaignModel.create({ ...input, slug });
  return { campaign, reactivated: false };
}

module.exports = { findCampaignBySlugs, pickReward, funnelStages, createOrReactivateCampaign };
