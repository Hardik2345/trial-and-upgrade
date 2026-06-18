const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractShopFromAdminApi,
  buildDiscountCode,
  normalizeDuration,
  normalizeProductId,
  toProductGid,
  assertTmcConfig
} = require("../src/custom-apis/the-man-company/helpers");
const {
  parseRequestPayload,
  buildCustomerGets,
  buildShopifyDiscountInput
} = require("../src/custom-apis/the-man-company/service");

test("assertTmcConfig rejects invalid TMC config", () => {
  assert.throws(
    () => assertTmcConfig({ tmcAdminApi: "", tmcAccessToken: "token", defaultTmcDiscountExpirationTime: 5 }),
    /TMC_ADMIN_API/
  );
  assert.throws(
    () => assertTmcConfig({ tmcAdminApi: "https://example.myshopify.com/admin/api/2026-04/graphql.json", tmcAccessToken: "", defaultTmcDiscountExpirationTime: 5 }),
    /TMC_ACCESS_TOKEN/
  );
  assert.throws(
    () => assertTmcConfig({ tmcAdminApi: "https://example.myshopify.com/admin/api/2026-04/graphql.json", tmcAccessToken: "token", defaultTmcDiscountExpirationTime: 0 }),
    /DEFAULT_TMC_DISCOUNT_EXPIRATION_TIME/
  );
});

test("extractShopFromAdminApi returns the Shopify hostname", () => {
  assert.equal(
    extractShopFromAdminApi("https://the-man-company.myshopify.com/admin/api/2026-04/graphql.json"),
    "the-man-company.myshopify.com"
  );
});

test("buildDiscountCode preserves prefix and falls back to random", () => {
  assert.match(buildDiscountCode("tmc"), /^TMC-[A-Z0-9]{8}$/);
  assert.match(buildDiscountCode(""), /^[A-Z0-9]{8}$/);
});

test("normalizeDuration uses default when omitted", () => {
  assert.equal(normalizeDuration(undefined, 7), 7);
  assert.equal(normalizeDuration("9", 7), 9);
  assert.throws(() => normalizeDuration(0, 7), /duration must be a positive integer/);
});

test("product ids are normalized to Shopify product gids", () => {
  assert.equal(normalizeProductId("12345"), "12345");
  assert.equal(toProductGid("12345"), "gid://shopify/Product/12345");
  assert.throws(() => normalizeProductId("gid://shopify/Product/12345"), /product_id must be a numeric Shopify product ID/);
});

test("parseRequestPayload validates conditional fields and applies defaults", () => {
  const parsed = parseRequestPayload(
    { type: "product", product_id: "12345", dtype: "percent", percent: 5 },
    6
  );
  assert.equal(parsed.type, "product");
  assert.equal(parsed.productIdNumeric, "12345");
  assert.equal(parsed.productGid, "gid://shopify/Product/12345");
  assert.equal(parsed.percent, 5);
  assert.equal(parsed.durationMinutes, 6);

  assert.throws(() => parseRequestPayload({ type: "product", dtype: "percent", percent: 5 }, 6), /product_id/);
  assert.throws(() => parseRequestPayload({ type: "cart", dtype: "percent" }, 6), /percent/);
  assert.throws(() => parseRequestPayload({ type: "cart", dtype: "fixed" }, 6), /price/);
});

test("buildCustomerGets shapes cart and product discounts correctly", () => {
  assert.deepEqual(
    buildCustomerGets({ type: "cart", dtype: "percent", percent: 5 }),
    { items: { all: true }, value: { percentage: 0.05 } }
  );

  assert.deepEqual(
    buildCustomerGets({ type: "product", dtype: "fixed", price: 100, productGid: "gid://shopify/Product/123" }),
    {
      items: { products: { productsToAdd: ["gid://shopify/Product/123"] } },
      value: { discountAmount: { amount: "100.00", appliesOnEachItem: false } }
    }
  );
});

test("buildShopifyDiscountInput creates an all-buyers discount with expiry", () => {
  const now = new Date("2026-06-18T10:00:00.000Z");
  const result = buildShopifyDiscountInput(
    {
      type: "cart",
      dtype: "fixed",
      price: 100,
      code: "TMC-TEST",
      durationMinutes: 5
    },
    now
  );

  assert.equal(result.input.context.all, "ALL");
  assert.equal(result.input.customerGets.items.all, true);
  assert.equal(result.input.customerGets.value.discountAmount.amount, "100.00");
  assert.equal(result.startsAt.toISOString(), "2026-06-18T10:00:00.000Z");
  assert.equal(result.expiresAt.toISOString(), "2026-06-18T10:05:00.000Z");
});
