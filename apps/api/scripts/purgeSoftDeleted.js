const mongoose = require("mongoose");
const { connectDatabase } = require("../src/config/db");
const TenantStore = require("../src/models/TenantStore");
const Campaign = require("../src/models/Campaign");

function hasExecuteFlag() {
  return process.argv.includes("--execute");
}

async function main() {
  const execute = hasExecuteFlag();
  await connectDatabase();

  const softDeletedStores = await TenantStore.find({ deletedAt: { $ne: null } }).select("_id name slug shopifyDomain deletedAt").lean();
  const softDeletedStoreIds = softDeletedStores.map((store) => store._id);
  const campaignFilter = {
    $or: [
      { deletedAt: { $ne: null } },
      ...(softDeletedStoreIds.length ? [{ tenantStoreId: { $in: softDeletedStoreIds } }] : [])
    ]
  };
  const softDeletedCampaigns = await Campaign.find(campaignFilter).select("_id name slug tenantStoreId deletedAt").lean();

  const summary = {
    execute,
    stores: softDeletedStores.map((store) => ({
      id: String(store._id),
      name: store.name,
      slug: store.slug,
      shopifyDomain: store.shopifyDomain,
      deletedAt: store.deletedAt
    })),
    campaigns: softDeletedCampaigns.map((campaign) => ({
      id: String(campaign._id),
      name: campaign.name,
      slug: campaign.slug,
      tenantStoreId: String(campaign.tenantStoreId),
      deletedAt: campaign.deletedAt
    }))
  };

  if (!execute) {
    console.log(JSON.stringify({
      ...summary,
      dryRun: true,
      message: "No records deleted. Re-run with --execute to permanently delete these soft-deleted stores and campaigns."
    }, null, 2));
    return;
  }

  const [campaignDeleteResult, storeDeleteResult] = await Promise.all([
    softDeletedCampaigns.length
      ? Campaign.deleteMany({ _id: { $in: softDeletedCampaigns.map((campaign) => campaign._id) } })
      : { deletedCount: 0 },
    softDeletedStores.length
      ? TenantStore.deleteMany({ _id: { $in: softDeletedStoreIds } })
      : { deletedCount: 0 }
  ]);

  console.log(JSON.stringify({
    ...summary,
    deleted: {
      stores: storeDeleteResult.deletedCount || 0,
      campaigns: campaignDeleteResult.deletedCount || 0
    }
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
