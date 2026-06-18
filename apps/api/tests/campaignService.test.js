const test = require("node:test");
const assert = require("node:assert/strict");
const { pickReward, funnelStages, createOrReactivateCampaign } = require("../src/services/campaignService");

test("pickReward falls back to wallet credit when campaign has no rewards", () => {
  const reward = pickReward({ flitsCredit: { value: 500 } });
  assert.equal(reward.key, "wallet_500");
  assert.equal(reward.value, 500);
});

test("pickReward ignores zero-weight rewards", () => {
  const reward = pickReward({
    rewards: [
      { key: "never", label: "Never", value: 0, weight: 0 },
      { key: "always", label: "Always", value: 10, weight: 1 }
    ]
  });
  assert.equal(reward.key, "always");
});

test("funnelStages uses campaign play label", () => {
  const stages = funnelStages({ playEventLabel: "Rolled Dice" });
  assert.deepEqual(stages.map((stage) => stage.label), ["Entered", "OTP Sent", "OTP Verified", "Rolled Dice"]);
});

test("createOrReactivateCampaign reactivates soft-deleted campaign with same slug", async () => {
  const existing = {
    _id: "campaign-1",
    tenantStoreId: "store-1",
    slug: "old-slug",
    name: "Old",
    enabled: false,
    deletedAt: new Date("2026-06-01T00:00:00.000Z"),
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    }
  };
  const CampaignModel = {
    async findOne(filter) {
      assert.deepEqual(filter, { tenantStoreId: "store-1", slug: "spinwheel" });
      return existing;
    }
  };

  const result = await createOrReactivateCampaign({
    tenantStoreId: "store-1",
    name: "Spin Wheel",
    slug: "SpinWheel",
    enabled: undefined,
    rewards: [{ key: "wallet_399", label: "Wallet Credit 399", value: 399, weight: 1 }]
  }, { CampaignModel });

  assert.equal(result.reactivated, true);
  assert.equal(result.campaign, existing);
  assert.equal(existing.name, "Spin Wheel");
  assert.equal(existing.slug, "spinwheel");
  assert.equal(existing.enabled, true);
  assert.equal(existing.deletedAt, null);
  assert.equal(existing.saveCalls, 1);
});

test("createOrReactivateCampaign rejects active duplicate campaign slug", async () => {
  const CampaignModel = {
    async findOne() {
      return { _id: "campaign-1", deletedAt: null };
    }
  };

  await assert.rejects(
    () => createOrReactivateCampaign({ tenantStoreId: "store-1", slug: "spinwheel" }, { CampaignModel }),
    (err) => err.status === 409 && err.message === "Campaign slug already exists"
  );
});

test("createOrReactivateCampaign creates new campaign when slug is unused", async () => {
  let created;
  const CampaignModel = {
    async findOne() {
      return null;
    },
    async create(input) {
      created = input;
      return { _id: "campaign-2", ...input };
    }
  };

  const result = await createOrReactivateCampaign({
    tenantStoreId: "store-1",
    name: "Spin Wheel",
    slug: "SpinWheel"
  }, { CampaignModel });

  assert.equal(result.reactivated, false);
  assert.equal(result.campaign.slug, "spinwheel");
  assert.equal(created.slug, "spinwheel");
});
