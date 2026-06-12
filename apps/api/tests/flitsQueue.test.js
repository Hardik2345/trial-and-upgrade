const test = require("node:test");
const assert = require("node:assert/strict");
const {
  enqueueCredit,
  dueCreditJobFilter,
  claimCreditJob,
  processCreditJob,
  parseEligibleQuantityTag,
  creditSuccessTags,
  creditResult,
  customCreditLimitDecision
} = require("../src/services/flitsService");
const { runFlitsQueueTick } = require("../src/services/flitsQueue");

function makeJob(overrides = {}) {
  return {
    _id: "job_1",
    attempts: 1,
    status: "processing",
    payload: { ok: true },
    lockedAt: new Date(),
    lockedBy: "worker",
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
    ...overrides
  };
}

test("dueCreditJobFilter selects due pending, due failed, and stale processing jobs", () => {
  const now = new Date("2026-05-27T10:00:00.000Z");
  const filter = dueCreditJobFilter({ now, lockTtlMs: 120000 });

  assert.deepEqual(filter, {
    $or: [
      { status: "pending", nextRunAt: { $lte: now } },
      { status: "failed", nextRunAt: { $lte: now } },
      { status: "processing", lockedAt: { $lte: new Date("2026-05-27T09:58:00.000Z") } }
    ]
  });
});

test("claimCreditJob atomically marks a due job as processing", async () => {
  const now = new Date("2026-05-27T10:00:00.000Z");
  let captured;
  const JobModel = {
    async findOneAndUpdate(filter, update, options) {
      captured = { filter, update, options };
      return makeJob({ attempts: 2, lockedAt: now, lockedBy: "worker-1" });
    }
  };

  const job = await claimCreditJob({ workerId: "worker-1", now, lockTtlMs: 120000, JobModel });

  assert.equal(job.lockedBy, "worker-1");
  assert.equal(captured.update.$set.status, "processing");
  assert.equal(captured.update.$set.lockedAt, now);
  assert.equal(captured.update.$set.lockedBy, "worker-1");
  assert.deepEqual(captured.update.$inc, { attempts: 1 });
  assert.deepEqual(captured.options, { sort: { nextRunAt: 1, createdAt: 1 }, new: true });
});

test("parseEligibleQuantityTag accepts only hard-capped eligible quantity tags", () => {
  assert.equal(parseEligibleQuantityTag(["eligible-qty-1"]), 1);
  assert.equal(parseEligibleQuantityTag(["Eligible-Qty-2"]), 2);
  assert.equal(parseEligibleQuantityTag(["eligible-qty-3"]), null);
  assert.equal(parseEligibleQuantityTag(["eligible-qty-x"]), null);
  assert.equal(parseEligibleQuantityTag(["played"]), null);
});

test("custom credit limit does not affect other stores", async () => {
  const decision = await customCreditLimitDecision(
    {
      store: { _id: "store-1", shopifyDomain: "other.myshopify.com" },
      participant: { phoneDisplay: "9967833007", shopifyCustomerGid: "gid://shopify/Customer/1" }
    },
    {
      fetchCustomerByGid: async () => {
        throw new Error("should not fetch customer for other stores");
      }
    }
  );

  assert.deepEqual(decision, { applies: false, allowed: true });
});

test("custom credit limit does not affect SorrySugar", async () => {
  const decision = await customCreditLimitDecision(
    {
      store: { _id: "store-1", slug: "sorrysugar", shopifyDomain: "em52un-mk.myshopify.com" },
      participant: { phoneDisplay: "9967833007", shopifyCustomerGid: "gid://shopify/Customer/1" }
    },
    {
      fetchCustomerByGid: async () => {
        throw new Error("should not fetch customer for SorrySugar");
      }
    }
  );

  assert.deepEqual(decision, { applies: false, allowed: true });
});

test("custom credit limit blocks skincare customer without eligible quantity tag", async () => {
  const decision = await customCreditLimitDecision(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      participant: { phoneDisplay: "9967833007", shopifyCustomerGid: "gid://shopify/Customer/1" }
    },
    {
      fetchCustomerByGid: async () => ({ tags: ["played"] })
    }
  );

  assert.equal(decision.applies, true);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "missing_eligible_quantity_tag");
});

test("custom credit limit requires marketplace skincare customer tag when marketplace auto-credit is disabled", async () => {
  let fetched = false;
  const decision = await customCreditLimitDecision(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      participant: {
        phoneDisplay: "9967833007",
        shopifyCustomerId: "1",
        shopifyCustomerGid: "gid://shopify/Customer/1",
        customerSource: "marketplace"
      }
    },
    {
      fetchCustomerByGid: async () => {
        fetched = true;
        return { tags: ["played"] };
      },
      logger: { info() {} }
    }
  );

  assert.equal(fetched, true);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "missing_eligible_quantity_tag");
});

test("custom credit limit allows marketplace skincare customer exactly once when campaign toggle is enabled", async () => {
  let countCalls = 0;
  const base = {
    store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
    campaign: { customCredit: { marketplaceAutoCreditEnabled: true } },
    participant: {
      phoneDisplay: "9967833007",
      shopifyCustomerId: "1",
      shopifyCustomerGid: "gid://shopify/Customer/1",
      customerSource: "marketplace"
    }
  };
  const firstDecision = await customCreditLimitDecision(base, {
    JobModel: {
      countDocuments: async () => {
        countCalls += 1;
        return 0;
      }
    },
    fetchCustomerByGid: async () => {
      throw new Error("should not require eligible quantity tag for marketplace customers");
    },
    logger: { info() {} }
  });
  const secondDecision = await customCreditLimitDecision(base, {
    JobModel: {
      countDocuments: async () => {
        countCalls += 1;
        return 1;
      }
    },
    fetchCustomerByGid: async () => {
      throw new Error("should not require eligible quantity tag for marketplace customers");
    },
    logger: { info() {} }
  });

  assert.equal(firstDecision.allowed, true);
  assert.equal(firstDecision.reason, "marketplace_first_credit");
  assert.equal(secondDecision.allowed, false);
  assert.equal(secondDecision.reason, "marketplace_limit_reached");
  assert.equal(countCalls, 2);
});

test("custom credit limit allows skincare customer while under quantity", async () => {
  let capturedFilter;
  const decision = await customCreditLimitDecision(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      participant: {
        phoneDisplay: "9967833007",
        shopifyCustomerId: "1",
        creditCustomerEmail: "customer@example.com",
        shopifyCustomerGid: "gid://shopify/Customer/1"
      }
    },
    {
      fetchCustomerByGid: async () => ({ tags: ["eligible-qty-2"] }),
      JobModel: {
        async countDocuments(filter) {
          capturedFilter = filter;
          return 1;
        }
      },
      logger: { info() {} }
    }
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.eligibleQuantity, 2);
  assert.equal(decision.usedCredits, 1);
  assert.deepEqual(capturedFilter.status.$in, ["pending", "processing", "failed", "sent"]);
  assert.deepEqual(capturedFilter.$or, [
    { "payload.shopify_customer_id": "1" },
    { "payload.customer_email": "customer@example.com" },
    { "payload.customer_phone": "+919967833007" }
  ]);
});

test("custom credit limit blocks skincare customer at quantity", async () => {
  const decision = await customCreditLimitDecision(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      participant: {
        phoneDisplay: "9967833007",
        shopifyCustomerId: "1",
        shopifyCustomerGid: "gid://shopify/Customer/1"
      }
    },
    {
      fetchCustomerByGid: async () => ({ tags: ["eligible-qty-1"] }),
      JobModel: { countDocuments: async () => 1 },
      logger: { info() {} }
    }
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "limit_reached");
  assert.equal(decision.eligibleQuantity, 1);
  assert.equal(decision.usedCredits, 1);
});

test("enqueueCredit skips creating job when custom credit limit blocks", async () => {
  let createCalled = false;
  const job = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      campaign: {
        _id: "campaign-1",
        flitsCredit: { enabled: true, value: 399, commentText: "Reward" },
        customCredit: { marketplaceAutoCreditEnabled: true }
      },
      participant: {
        _id: "participant-1",
        phoneDisplay: "9967833007",
        shopifyCustomerGid: "gid://shopify/Customer/1",
        reward: { value: 399 }
      }
    },
    {
      fetchCustomerByGid: async () => ({ tags: [] }),
      JobModel: {
        countDocuments: async () => 0,
        create: async () => {
          createCalled = true;
        }
      },
      logger: { info() {} }
    }
  );

  assert.equal(job, null);
  assert.equal(createCalled, false);
});

test("enqueueCredit returns structured skip response for missing eligible quantity tag", async () => {
  const credit = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      campaign: {
        _id: "campaign-1",
        flitsCredit: { enabled: true, value: 399, commentText: "Reward" },
        customCredit: { marketplaceAutoCreditEnabled: true }
      },
      participant: {
        _id: "participant-1",
        phoneDisplay: "9967833007",
        shopifyCustomerGid: "gid://shopify/Customer/1",
        reward: { value: 399 }
      }
    },
    {
      includeResult: true,
      fetchCustomerByGid: async () => ({ tags: [] }),
      JobModel: {
        countDocuments: async () => 0,
        create: async () => {
          throw new Error("should not create a credit job");
        }
      },
      logger: { info() {} }
    }
  );

  assert.deepEqual(credit, {
    credited: false,
    queued: false,
    creditJobId: null,
    reason: "missing_eligible_quantity_tag",
    message: "You are not eligible for wallet credit.",
    eligibleQuantity: null,
    usedCredits: 0
  });
});

test("enqueueCredit returns structured skip response for exhausted custom limit", async () => {
  const credit = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      campaign: { _id: "campaign-1", flitsCredit: { enabled: true, value: 399, commentText: "Reward" } },
      participant: {
        _id: "participant-1",
        phoneDisplay: "9967833007",
        shopifyCustomerId: "123",
        shopifyCustomerGid: "gid://shopify/Customer/1",
        reward: { value: 399 }
      }
    },
    {
      includeResult: true,
      fetchCustomerByGid: async () => ({ tags: ["eligible-qty-1"] }),
      JobModel: {
        countDocuments: async () => 1,
        create: async () => {
          throw new Error("should not create a credit job");
        }
      },
      logger: { info() {} }
    }
  );

  assert.equal(credit.credited, false);
  assert.equal(credit.queued, false);
  assert.equal(credit.creditJobId, null);
  assert.equal(credit.reason, "limit_reached");
  assert.equal(credit.message, "You have already redeemed the allowed number of wallet credits.");
  assert.equal(credit.eligibleQuantity, 1);
  assert.equal(credit.usedCredits, 1);
});

test("enqueueCredit returns structured skip response for exhausted marketplace customer", async () => {
  const credit = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "skincarepersonaltouch", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      campaign: {
        _id: "campaign-1",
        flitsCredit: { enabled: true, value: 399, commentText: "Reward" },
        customCredit: { marketplaceAutoCreditEnabled: true }
      },
      participant: {
        _id: "participant-1",
        phoneDisplay: "9967833007",
        eligibilityCustomerGid: "gid://shopify/Customer/1",
        customerSource: "marketplace",
        reward: { value: 399 }
      }
    },
    {
      includeResult: true,
      fetchCustomerByGid: async () => {
        throw new Error("should not fetch marketplace customer tags");
      },
      JobModel: {
        countDocuments: async () => 1,
        create: async () => {
          throw new Error("should not create a credit job");
        }
      },
      logger: { info() {} }
    }
  );

  assert.equal(credit.credited, false);
  assert.equal(credit.reason, "marketplace_limit_reached");
  assert.equal(credit.message, "You have already redeemed your marketplace customer wallet credit.");
});

test("enqueueCredit returns structured queued response when credit job is created", async () => {
  const credit = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "other", shopifyDomain: "other.myshopify.com" },
      campaign: { _id: "campaign-1", flitsCredit: { enabled: true, value: 399, commentText: "Reward" } },
      participant: {
        _id: "participant-1",
        phoneDisplay: "9967833007",
        shopifyCustomerId: "123",
        creditCustomerEmail: "customer@example.com",
        reward: { value: 399 }
      }
    },
    {
      includeResult: true,
      JobModel: {
        create: async (payload) => ({ _id: "job-1", ...payload })
      },
      logger: { info() {} }
    }
  );

  assert.deepEqual(credit, {
    credited: true,
    queued: true,
    creditJobId: "job-1",
    reason: "queued",
    message: "Wallet credit is being processed."
  });
});

test("enqueueCredit returns structured disabled response when campaign credit is off", async () => {
  const credit = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "other", shopifyDomain: "other.myshopify.com" },
      campaign: { _id: "campaign-1", flitsCredit: { enabled: false, value: 399, commentText: "Reward" } },
      participant: { _id: "participant-1", phoneDisplay: "9967833007" }
    },
    { includeResult: true, logger: { info() {} } }
  );

  assert.equal(credit.credited, false);
  assert.equal(credit.reason, "flits_credit_disabled");
  assert.equal(credit.message, "Wallet credit is currently disabled for this campaign.");
});

test("creditResult returns structured already redeemed response", () => {
  assert.deepEqual(creditResult({ reason: "already_redeemed" }), {
    credited: false,
    queued: false,
    creditJobId: null,
    reason: "already_redeemed",
    message: "This mobile number has already played.",
    eligibleQuantity: null,
    usedCredits: null
  });
});

test("creditResult returns structured already played response", () => {
  assert.deepEqual(creditResult({ reason: "already_played" }), {
    credited: false,
    queued: false,
    creditJobId: null,
    reason: "already_played",
    message: "This mobile number has already played.",
    eligibleQuantity: null,
    usedCredits: null
  });
});

test("enqueueCredit sends Flits payload with resolved customer email and no phone", async () => {
  let captured;
  await enqueueCredit(
    {
      store: { _id: "store-1", slug: "other", shopifyDomain: "other.myshopify.com" },
      campaign: { _id: "campaign-1", flitsCredit: { enabled: true, value: 399, commentText: "Reward" } },
      participant: {
        _id: "participant-1",
        email: "hardikparikh19@gmail.com",
        phoneDisplay: "9967833007",
        shopifyCustomerId: "123",
        creditCustomerEmail: "resolved@example.com",
        reward: { value: 399 }
      }
    },
    {
      JobModel: {
        create: async (payload) => {
          captured = payload;
          return payload;
        }
      },
      logger: { info() {} }
    }
  );

  assert.equal(captured.payload.customer_email, "resolved@example.com");
  assert.equal(captured.payload.customer_phone, undefined);
  assert.equal(captured.payload.shopify_customer_id, "123");
  assert.equal(captured.payload.credit_details.time_upto, 30);
});

test("enqueueCredit skips when resolved credit email is missing", async () => {
  let createCalled = false;
  const credit = await enqueueCredit(
    {
      store: { _id: "store-1", slug: "other", shopifyDomain: "other.myshopify.com" },
      campaign: { _id: "campaign-1", flitsCredit: { enabled: true, value: 399, commentText: "Reward" } },
      participant: {
        _id: "participant-1",
        phoneDisplay: "9967833007",
        shopifyCustomerId: "123",
        reward: { value: 399 }
      }
    },
    {
      includeResult: true,
      fetchCustomerByGid: async () => null,
      JobModel: {
        create: async () => {
          createCalled = true;
        }
      },
      logger: { info() {} }
    }
  );

  assert.equal(createCalled, false);
  assert.equal(credit.credited, false);
  assert.equal(credit.reason, "missing_credit_email");
  assert.equal(credit.message, "Wallet credit could not be issued because no email is linked to the customer.");
});

test("creditSuccessTags adds credited-once for first custom brand credit", async () => {
  const tags = await creditSuccessTags(
    {
      store: { _id: "store-1", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      participant: { phoneDisplay: "9967833007", shopifyCustomerId: "123" }
    },
    {
      JobModel: {
        countDocuments: async () => 1
      }
    }
  );

  assert.deepEqual(tags, ["credited", "credited-once"]);
});

test("creditSuccessTags adds credited-twice for second custom brand credit", async () => {
  const tags = await creditSuccessTags(
    {
      store: { _id: "store-1", shopifyDomain: "skincarepersonaltouch.myshopify.com" },
      participant: { phoneDisplay: "9967833007", shopifyCustomerId: "123" }
    },
    {
      JobModel: {
        countDocuments: async () => 2
      }
    }
  );

  assert.deepEqual(tags, ["credited", "credited-twice"]);
});

test("creditSuccessTags does not add custom tags for other stores", async () => {
  const tags = await creditSuccessTags(
    {
      store: { _id: "store-1", shopifyDomain: "other.myshopify.com" },
      participant: { phoneDisplay: "9967833007", shopifyCustomerId: "123" }
    },
    {
      JobModel: {
        countDocuments: async () => {
          throw new Error("should not count custom credits for other stores");
        }
      }
    }
  );

  assert.deepEqual(tags, ["credited"]);
});

test("runFlitsQueueTick drains due jobs while respecting max concurrency", async () => {
  let claims = 0;
  let active = 0;
  let maxActive = 0;
  const jobs = [
    makeJob({ _id: "job_1" }),
    makeJob({ _id: "job_2" }),
    makeJob({ _id: "job_3" }),
    makeJob({ _id: "job_4" }),
    makeJob({ _id: "job_5" })
  ];
  const JobModel = {
    async countDocuments() {
      return jobs.length;
    },
    async findOneAndUpdate() {
      return jobs[claims++];
    }
  };

  const summary = await runFlitsQueueTick({
    workerId: "worker-1",
    maxConcurrency: 2,
    JobModel,
    loadContext: async () => ({
      store: { flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" } },
      campaign: {},
      participant: { shopifyCustomerGid: "gid://shopify/Customer/1" }
    }),
    axiosClient: {
      post: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return { status: 200 };
      }
    },
    addTags: async () => null,
    recordEvent: async () => null,
    logger: { log() {}, warn() {}, error() {} }
  });

  assert.equal(claims, jobs.length + 2);
  assert.equal(summary.claimed, jobs.length);
  assert.equal(summary.sent, jobs.length);
  assert.equal(maxActive, 2);
});

test("processCreditJob marks sent and tags primary Shopify customer with credited", async () => {
  const job = makeJob();
  const calls = { tags: [], events: 0 };

  const result = await processCreditJob(
    job,
    {
      store: { flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" } },
      campaign: {},
      participant: { shopifyCustomerGid: "gid://shopify/Customer/1" }
    },
    {
      axiosClient: { post: async () => ({ status: 200 }) },
      addTags: async (_store, gid, tags) => calls.tags.push({ gid, tags }),
      recordEvent: async () => {
        calls.events += 1;
      }
    }
  );

  assert.equal(result.status, "sent");
  assert.equal(job.status, "sent");
  assert.ok(job.sentAt);
  assert.ok(job.processedAt);
  assert.equal(job.lockedAt, undefined);
  assert.equal(job.lockedBy, undefined);
  assert.deepEqual(calls.tags, [{ gid: "gid://shopify/Customer/1", tags: ["credited"] }]);
  assert.equal(calls.events, 1);
});

test("processCreditJob tags custom brand second credit with credited-twice", async () => {
  const job = makeJob();
  const calls = { tags: [] };

  const result = await processCreditJob(
    job,
    {
      store: {
        _id: "store-1",
        shopifyDomain: "skincarepersonaltouch.myshopify.com",
        flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" }
      },
      campaign: {},
      participant: {
        phoneDisplay: "9967833007",
        shopifyCustomerId: "123",
        shopifyCustomerGid: "gid://shopify/Customer/1"
      }
    },
    {
      axiosClient: { post: async () => ({ status: 200 }) },
      addTags: async (_store, gid, tags) => calls.tags.push({ gid, tags }),
      recordEvent: async () => null,
      JobModel: { countDocuments: async () => 2 }
    }
  );

  assert.equal(result.status, "sent");
  assert.deepEqual(calls.tags, [{ gid: "gid://shopify/Customer/1", tags: ["credited", "credited-twice"] }]);
});

test("processCreditJob falls back to eligibility customer when tagging credited", async () => {
  const job = makeJob();
  let taggedGid;

  await processCreditJob(
    job,
    {
      store: { flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" } },
      campaign: {},
      participant: { eligibilityCustomerGid: "gid://shopify/Customer/2" }
    },
    {
      axiosClient: { post: async () => ({ status: 200 }) },
      addTags: async (_store, gid) => {
        taggedGid = gid;
      },
      recordEvent: async () => null
    }
  );

  assert.equal(taggedGid, "gid://shopify/Customer/2");
  assert.equal(job.status, "sent");
});

test("processCreditJob does not fail a sent credit when Shopify GID is missing", async () => {
  const job = makeJob();

  const result = await processCreditJob(
    job,
    {
      store: { flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" } },
      campaign: {},
      participant: {}
    },
    {
      axiosClient: { post: async () => ({ status: 200 }) },
      addTags: async () => {
        throw new Error("missing gid");
      },
      recordEvent: async () => null,
      logger: { warn() {} }
    }
  );

  assert.equal(result.status, "sent");
  assert.equal(job.status, "sent");
});

test("processCreditJob schedules retry on Flits failure", async () => {
  const job = makeJob({ attempts: 2 });

  const result = await processCreditJob(
    job,
    {
      store: { flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" } },
      campaign: {},
      participant: {}
    },
    {
      maxAttempts: 5,
      axiosClient: { post: async () => { throw new Error("flits down"); } }
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(job.status, "failed");
  assert.equal(job.lastError, "flits down");
  assert.ok(job.nextRunAt instanceof Date);
  assert.equal(job.lockedAt, undefined);
  assert.equal(job.lockedBy, undefined);
});

test("processCreditJob marks dead after max attempts", async () => {
  const job = makeJob({ attempts: 5 });

  const result = await processCreditJob(
    job,
    {
      store: { flitsConfig: { customActionUrl: "https://flits.example/credit", apiKey: "secret" } },
      campaign: {},
      participant: {}
    },
    {
      maxAttempts: 5,
      axiosClient: { post: async () => { throw new Error("permanent failure"); } }
    }
  );

  assert.equal(result.status, "dead");
  assert.equal(job.status, "dead");
  assert.equal(job.nextRunAt, undefined);
  assert.ok(job.processedAt instanceof Date);
});
