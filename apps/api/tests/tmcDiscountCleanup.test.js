const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTmcCleanupConfig } = require("../src/custom-apis/the-man-company/helpers");
const {
  expiredDiscountFilter,
  processExpiredDiscountRecord,
  runTmcDiscountCleanup
} = require("../src/custom-apis/the-man-company/cleanupService");

function makeRecord(overrides = {}) {
  return {
    _id: "record-1",
    code: "TMC-TEST",
    shopifyDiscountCodeNodeId: "gid://shopify/DiscountCodeNode/1",
    deletedFromShopify: false,
    deletedFromShopifyAt: null,
    lastCleanupCheckedAt: null,
    lastCleanupError: "",
    shopifyResponseMeta: { status: "", asyncUsageCount: null },
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
    ...overrides
  };
}

test("assertTmcCleanupConfig validates cron config", () => {
  assert.doesNotThrow(() =>
    assertTmcCleanupConfig({
      tmcAdminApi: "https://the-man-company.myshopify.com/admin/api/2026-04/graphql.json",
      tmcAccessToken: "token",
      defaultTmcDiscountExpirationTime: 5,
      discountCodesCleanupCron: "0 0 * * *"
    })
  );
  assert.throws(
    () =>
      assertTmcCleanupConfig({
        tmcAdminApi: "https://the-man-company.myshopify.com/admin/api/2026-04/graphql.json",
        tmcAccessToken: "token",
        defaultTmcDiscountExpirationTime: 5,
        discountCodesCleanupCron: "@daily"
      }),
    /standard 5-field cron expression/
  );
});

test("expiredDiscountFilter selects only expired not-yet-deleted records", () => {
  const now = new Date("2026-06-18T10:00:00.000Z");
  assert.deepEqual(expiredDiscountFilter(now), {
    brand: "the-man-company",
    expiresAt: { $lte: now },
    deletedFromShopify: false
  });
});

test("processExpiredDiscountRecord deletes unused expired Shopify discounts", async () => {
  const record = makeRecord();
  let deleteCalls = 0;
  const client = {
    async post(_url, payload) {
      if (payload.query.includes("query GetTmcDiscount")) {
        return {
          data: {
            data: {
              node: {
                id: "gid://shopify/DiscountCodeNode/1",
                codeDiscount: {
                  status: "EXPIRED",
                  endsAt: "2026-06-18T09:00:00.000Z",
                  asyncUsageCount: 0
                }
              }
            }
          }
        };
      }
      deleteCalls += 1;
      return {
        data: {
          data: {
            discountCodeDelete: {
              deletedCodeDiscountId: "gid://shopify/DiscountCodeNode/1",
              userErrors: []
            }
          }
        }
      };
    }
  };

  const result = await processExpiredDiscountRecord(record, {
    now: new Date("2026-06-18T10:00:00.000Z"),
    client
  });

  assert.equal(result.status, "deleted");
  assert.equal(deleteCalls, 1);
  assert.equal(record.deletedFromShopify, true);
  assert.equal(record.deletedFromShopifyAt.toISOString(), "2026-06-18T10:00:00.000Z");
  assert.equal(record.shopifyResponseMeta.asyncUsageCount, 0);
  assert.equal(record.lastCleanupError, "");
});

test("processExpiredDiscountRecord retains used expired Shopify discounts", async () => {
  const record = makeRecord();
  const client = {
    async post() {
      return {
        data: {
          data: {
            node: {
              id: "gid://shopify/DiscountCodeNode/1",
              codeDiscount: {
                status: "EXPIRED",
                endsAt: "2026-06-18T09:00:00.000Z",
                asyncUsageCount: 2
              }
            }
          }
        }
      };
    }
  };

  const result = await processExpiredDiscountRecord(record, {
    now: new Date("2026-06-18T10:00:00.000Z"),
    client
  });

  assert.equal(result.status, "retained");
  assert.equal(record.deletedFromShopify, false);
  assert.equal(record.shopifyResponseMeta.asyncUsageCount, 2);
  assert.equal(record.lastCleanupError, "");
});

test("processExpiredDiscountRecord handles Shopify delete failures without marking deleted", async () => {
  const record = makeRecord();
  const client = {
    calls: 0,
    async post(_url, payload) {
      this.calls += 1;
      if (payload.query.includes("query GetTmcDiscount")) {
        return {
          data: {
            data: {
              node: {
                id: "gid://shopify/DiscountCodeNode/1",
                codeDiscount: {
                  status: "EXPIRED",
                  endsAt: "2026-06-18T09:00:00.000Z",
                  asyncUsageCount: 0
                }
              }
            }
          }
        };
      }
      return {
        data: {
          data: {
            discountCodeDelete: {
              deletedCodeDiscountId: null,
              userErrors: [{ message: "delete failed" }]
            }
          }
        }
      };
    }
  };

  const result = await processExpiredDiscountRecord(record, {
    now: new Date("2026-06-18T10:00:00.000Z"),
    client
  });

  assert.equal(result.status, "failed");
  assert.equal(record.deletedFromShopify, false);
  assert.equal(record.lastCleanupError, "delete failed");
});

test("runTmcDiscountCleanup summarizes cleanup results", async () => {
  const records = [
    makeRecord({ _id: "deleted-record", code: "DEL", shopifyDiscountCodeNodeId: "gid://shopify/DiscountCodeNode/1" }),
    makeRecord({ _id: "used-record", code: "USED", shopifyDiscountCodeNodeId: "gid://shopify/DiscountCodeNode/2" }),
    makeRecord({ _id: "missing-id-record", code: "MISS", shopifyDiscountCodeNodeId: "" })
  ];
  const Model = {
    find(filter) {
      assert.equal(filter.brand, "the-man-company");
      return {
        sort() {
          return records;
        }
      };
    }
  };
  const client = {
    async post(_url, payload) {
      if (payload.query.includes("query GetTmcDiscount")) {
        const id = payload.variables.id;
        return {
          data: {
            data: {
              node: {
                id,
                codeDiscount: {
                  status: "EXPIRED",
                  endsAt: "2026-06-18T09:00:00.000Z",
                  asyncUsageCount: id.endsWith("/1") ? 0 : 4
                }
              }
            }
          }
        };
      }
      return {
        data: {
          data: {
            discountCodeDelete: {
              deletedCodeDiscountId: "gid://shopify/DiscountCodeNode/1",
              userErrors: []
            }
          }
        }
      };
    }
  };

  const summary = await runTmcDiscountCleanup({
    now: new Date("2026-06-18T10:00:00.000Z"),
    Model,
    client,
    logger: { log() {}, warn() {} }
  });

  assert.deepEqual(summary, {
    candidates: 3,
    deleted: 1,
    retained: 1,
    skipped: 1,
    failed: 0
  });
});
