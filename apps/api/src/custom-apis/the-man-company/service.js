const axios = require("axios");
const env = require("../../config/env");
const TmcDiscountCode = require("../../models/TmcDiscountCode");
const {
  extractShopFromAdminApi,
  buildDiscountCode,
  normalizeDuration,
  normalizeProductId,
  toProductGid,
  buildTmcDiscountTitle,
  buildIdempotencyKey
} = require("./helpers");

const DISCOUNT_CREATE_QUERY = `
  mutation CreateTmcDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) @idempotent(key: "__IDEMPOTENCY_KEY__") {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
            asyncUsageCount
            codes(first: 1) {
              nodes {
                code
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function parseRequestPayload(payload, defaultDuration) {
  const type = String(payload.type || "").trim().toLowerCase();
  const dtype = String(payload.dtype || "").trim().toLowerCase();

  if (!["product", "cart"].includes(type)) {
    const error = new Error("type must be either product or cart");
    error.status = 400;
    throw error;
  }

  if (!["percent", "fixed"].includes(dtype)) {
    const error = new Error("dtype must be either percent or fixed");
    error.status = 400;
    throw error;
  }

  const durationMinutes = normalizeDuration(payload.duration, defaultDuration);
  const prefix = String(payload.prefix || "").trim();
  const effectivePrefix = prefix || env.tmcDefaultDiscountPrefix;
  const code = buildDiscountCode(prefix, env.tmcDefaultDiscountPrefix);
  const parsed = {
    type,
    dtype,
    code,
    prefix: effectivePrefix,
    durationMinutes,
    productIdNumeric: "",
    productGid: "",
    percent: null,
    price: null,
    orderDiscountCombination: false
  };

  if (type === "product") {
    parsed.productIdNumeric = normalizeProductId(payload.product_id);
    parsed.productGid = toProductGid(parsed.productIdNumeric);
  }

  if (dtype === "percent") {
    const percent = Number(payload.percent);
    if (!Number.isInteger(percent) || percent <= 0) {
      const error = new Error("percent must be a positive integer");
      error.status = 400;
      throw error;
    }
    parsed.percent = percent;
  }

  if (dtype === "fixed") {
    const price = Number(payload.price);
    if (!Number.isInteger(price) || price <= 0) {
      const error = new Error("price must be a positive integer");
      error.status = 400;
      throw error;
    }
    parsed.price = price;
  }

  if (type === "product") {
    if (payload.order_discount_combination !== undefined && typeof payload.order_discount_combination !== "boolean") {
      const error = new Error("order_discount_combination must be a boolean");
      error.status = 400;
      throw error;
    }
    parsed.orderDiscountCombination = Boolean(payload.order_discount_combination);
  }

  return parsed;
}

function buildCustomerGets(payload) {
  const items = payload.type === "cart"
    ? { all: true }
    : { products: { productsToAdd: [payload.productGid] } };

  const value = payload.dtype === "percent"
    ? { percentage: payload.percent / 100 }
    : {
        discountAmount: {
          amount: payload.price.toFixed(2),
          appliesOnEachItem: false
        }
      };

  return { items, value };
}

function buildShopifyDiscountInput(payload, now = new Date()) {
  const startsAt = new Date(now);
  const expiresAt = new Date(startsAt.getTime() + payload.durationMinutes * 60 * 1000);
  const title = buildTmcDiscountTitle(payload);

  return {
    startsAt,
    expiresAt,
    title,
    input: {
      title,
      code: payload.code,
      startsAt: startsAt.toISOString(),
      endsAt: expiresAt.toISOString(),
      appliesOncePerCustomer: payload.type === "product",
      context: { all: "ALL" },
      combinesWith: {
        orderDiscounts: payload.type === "product" ? payload.orderDiscountCombination : false,
        productDiscounts: false,
        shippingDiscounts: false
      },
      customerGets: buildCustomerGets(payload)
    }
  };
}

function shopifyClient() {
  return axios.create({
    baseURL: env.tmcAdminApi,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": env.tmcAccessToken
    },
    timeout: 15000
  });
}

async function createShopifyDiscount(payload) {
  const idempotencyKey = buildIdempotencyKey();
  const { input, startsAt, expiresAt, title } = buildShopifyDiscountInput(payload);
  const query = DISCOUNT_CREATE_QUERY.replace("__IDEMPOTENCY_KEY__", idempotencyKey);
  const response = await shopifyClient().post("", {
    query,
    variables: { basicCodeDiscount: input }
  });

  if (response.data.errors?.length) {
    const error = new Error(response.data.errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }

  const mutation = response.data.data?.discountCodeBasicCreate;
  const userErrors = mutation?.userErrors || [];
  if (userErrors.length) {
    const error = new Error(userErrors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }

  const node = mutation?.codeDiscountNode;
  const codeDiscount = node?.codeDiscount;
  const createdCode = codeDiscount?.codes?.nodes?.[0]?.code || payload.code;

  return {
    title,
    startsAt,
    expiresAt,
    shopifyDiscountCodeNodeId: node?.id || "",
    shopifyDiscountId: node?.id || "",
    code: createdCode,
    shopifyResponseMeta: {
      status: codeDiscount?.status || "",
      asyncUsageCount: typeof codeDiscount?.asyncUsageCount === "number" ? codeDiscount.asyncUsageCount : null
    }
  };
}

async function createTmcDiscount(requestBody) {
  const parsedPayload = parseRequestPayload(requestBody, env.defaultTmcDiscountExpirationTime);
  const shop = extractShopFromAdminApi(env.tmcAdminApi);

  await TmcDiscountCode.updateMany(
    { expired: false, expiresAt: { $lte: new Date() } },
    { $set: { expired: true, expiredAt: new Date() } }
  );

  const createdDiscount = await createShopifyDiscount(parsedPayload);
  const record = await TmcDiscountCode.create({
    brand: "the-man-company",
    shop,
    code: createdDiscount.code,
    title: createdDiscount.title,
    type: parsedPayload.type,
    productIdNumeric: parsedPayload.productIdNumeric,
    productGid: parsedPayload.productGid,
    dtype: parsedPayload.dtype,
    percent: parsedPayload.percent,
    price: parsedPayload.price,
    prefix: parsedPayload.prefix,
    orderDiscountCombination: parsedPayload.orderDiscountCombination,
    durationMinutes: parsedPayload.durationMinutes,
    startsAt: createdDiscount.startsAt,
    expiresAt: createdDiscount.expiresAt,
    shopifyDiscountId: createdDiscount.shopifyDiscountId,
    shopifyDiscountCodeNodeId: createdDiscount.shopifyDiscountCodeNodeId,
    shopifyResponseMeta: createdDiscount.shopifyResponseMeta
  });

  return {
    success: true,
    code: createdDiscount.code,
    shop,
    type: parsedPayload.type,
    dtype: parsedPayload.dtype,
    duration: parsedPayload.durationMinutes,
    startsAt: createdDiscount.startsAt,
    expiresAt: createdDiscount.expiresAt,
    discountId: createdDiscount.shopifyDiscountId,
    recordId: String(record._id)
  };
}

module.exports = {
  parseRequestPayload,
  buildCustomerGets,
  buildShopifyDiscountInput,
  createTmcDiscount
};
