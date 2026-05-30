const { connectDatabase } = require("../src/config/db");
const TenantStore = require("../src/models/TenantStore");
const Campaign = require("../src/models/Campaign");

async function main() {
  await connectDatabase();
  const store = await TenantStore.findOneAndUpdate(
    { slug: "demo-store" },
    {
      name: "Demo Store",
      slug: "demo-store",
      shopifyDomain: "demo.myshopify.com",
      enabled: true
    },
    { upsert: true, new: true }
  );
  const campaign = await Campaign.findOneAndUpdate(
    { tenantStoreId: store._id, slug: "trial-and-error" },
    {
      tenantStoreId: store._id,
      name: "Trial and Error",
      slug: "trial-and-error",
      mechanicType: "spin_the_wheel",
      playEventLabel: "Spun Wheel",
      rewards: [{ key: "wallet_399", label: "Wallet Credit 399", value: 399, weight: 1 }],
      postPlayTags: ["played"],
      flitsCredit: { enabled: true, value: 399, commentText: "Rewarding the user in wallet" },
      enabled: true
    },
    { upsert: true, new: true }
  );
  console.log(`Seeded ${store.slug} / ${campaign.slug}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
