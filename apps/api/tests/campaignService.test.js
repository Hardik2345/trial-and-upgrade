const test = require("node:test");
const assert = require("node:assert/strict");
const { pickReward, funnelStages } = require("../src/services/campaignService");

test("pickReward falls back to wallet credit when campaign has no rewards", () => {
  const reward = pickReward({ flitsCredit: { value: 500 } });
  assert.equal(reward.key, "wallet_399");
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
