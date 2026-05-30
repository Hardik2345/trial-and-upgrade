const TenantStore = require("../models/TenantStore");
const Campaign = require("../models/Campaign");

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
    : [{ key: "wallet_399", label: "Wallet Credit", value: campaign.flitsCredit?.value || 399, weight: 1 }];
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

module.exports = { findCampaignBySlugs, pickReward, funnelStages };
