const axios = require("axios");
const env = require("../../config/env");
const TmcDiscountCode = require("../../models/TmcDiscountCode");

const GET_DISCOUNT_QUERY = `
  query GetTmcDiscount($id: ID!) {
    node(id: $id) {
      ... on DiscountCodeNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            status
            endsAt
            asyncUsageCount
          }
        }
      }
    }
  }
`;

const DELETE_DISCOUNT_MUTATION = `
  mutation DeleteTmcDiscount($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors {
        field
        code
        message
      }
    }
  }
`;

function cleanupShopifyClient() {
  return axios.create({
    baseURL: env.tmcAdminApi,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": env.tmcAccessToken
    },
    timeout: 15000
  });
}

function expiredDiscountFilter(now = new Date()) {
  return {
    brand: "the-man-company",
    expiresAt: { $lte: now },
    deletedFromShopify: false
  };
}

async function fetchDiscountUsage(discountNodeId, client = cleanupShopifyClient()) {
  const response = await client.post("", {
    query: GET_DISCOUNT_QUERY,
    variables: { id: discountNodeId }
  });

  if (response.data.errors?.length) {
    const error = new Error(response.data.errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }

  const node = response.data.data?.node;
  const discount = node?.codeDiscount;
  return {
    found: Boolean(node && discount),
    id: node?.id || discountNodeId,
    status: discount?.status || "",
    endsAt: discount?.endsAt || null,
    asyncUsageCount: typeof discount?.asyncUsageCount === "number" ? discount.asyncUsageCount : null
  };
}

async function deleteDiscountFromShopify(discountNodeId, client = cleanupShopifyClient()) {
  const response = await client.post("", {
    query: DELETE_DISCOUNT_MUTATION,
    variables: { id: discountNodeId }
  });

  if (response.data.errors?.length) {
    const error = new Error(response.data.errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }

  const payload = response.data.data?.discountCodeDelete;
  const userErrors = payload?.userErrors || [];
  if (userErrors.length) {
    const error = new Error(userErrors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }

  return payload?.deletedCodeDiscountId || "";
}

async function markCleanupCheck(record, now, usageInfo, errorMessage = "") {
  record.lastCleanupCheckedAt = now;
  record.lastCleanupError = errorMessage;
  if (usageInfo && typeof usageInfo.asyncUsageCount === "number") {
    record.shopifyResponseMeta = {
      ...(record.shopifyResponseMeta?.toObject ? record.shopifyResponseMeta.toObject() : record.shopifyResponseMeta),
      status: usageInfo.status || record.shopifyResponseMeta?.status || "",
      asyncUsageCount: usageInfo.asyncUsageCount
    };
  }
  await record.save();
}

async function processExpiredDiscountRecord(record, options = {}) {
  const now = options.now || new Date();
  const client = options.client || cleanupShopifyClient();

  if (!record.shopifyDiscountCodeNodeId) {
    await markCleanupCheck(record, now, null, "Missing shopifyDiscountCodeNodeId");
    return { status: "skipped", reason: "missing-discount-node-id" };
  }

  try {
    const usageInfo = await fetchDiscountUsage(record.shopifyDiscountCodeNodeId, client);
    if (!usageInfo.found) {
      await markCleanupCheck(record, now, null, "Shopify discount not found");
      return { status: "skipped", reason: "not-found" };
    }

    if ((usageInfo.asyncUsageCount || 0) > 0) {
      await markCleanupCheck(record, now, usageInfo, "");
      return { status: "retained", reason: "used" };
    }

    await deleteDiscountFromShopify(record.shopifyDiscountCodeNodeId, client);
    record.deletedFromShopify = true;
    record.deletedFromShopifyAt = now;
    await markCleanupCheck(record, now, usageInfo, "");
    return { status: "deleted", reason: "unused-expired" };
  } catch (err) {
    await markCleanupCheck(record, now, null, err.message);
    return { status: "failed", reason: "shopify-error", error: err };
  }
}

async function runTmcDiscountCleanup(options = {}) {
  const now = options.now || new Date();
  const Model = options.Model || TmcDiscountCode;
  const logger = options.logger || console;
  const client = options.client || cleanupShopifyClient();
  const records = await Model.find(expiredDiscountFilter(now)).sort({ expiresAt: 1, createdAt: 1 });
  const summary = { candidates: records.length, deleted: 0, retained: 0, skipped: 0, failed: 0 };

  for (const record of records) {
    const result = await processExpiredDiscountRecord(record, { now, client });
    if (result.status === "deleted") summary.deleted += 1;
    if (result.status === "retained") summary.retained += 1;
    if (result.status === "skipped") summary.skipped += 1;
    if (result.status === "failed") {
      summary.failed += 1;
      logger.warn?.(
        `[tmc-discount-cleanup] record=${record._id} code=${record.code} reason=${result.reason} error=${result.error.message}`
      );
    }
  }

  logger.log?.(
    `[tmc-discount-cleanup] candidates=${summary.candidates} deleted=${summary.deleted} retained=${summary.retained} skipped=${summary.skipped} failed=${summary.failed}`
  );
  return summary;
}

module.exports = {
  expiredDiscountFilter,
  fetchDiscountUsage,
  deleteDiscountFromShopify,
  processExpiredDiscountRecord,
  runTmcDiscountCleanup
};
