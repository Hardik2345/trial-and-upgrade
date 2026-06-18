const { randomBytes, randomUUID } = require("crypto");

function assertTmcConfig(env) {
  if (!env.tmcAdminApi) {
    throw new Error("Missing required env var TMC_ADMIN_API");
  }
  if (!env.tmcAccessToken) {
    throw new Error("Missing required env var TMC_ACCESS_TOKEN");
  }
  if (!Number.isInteger(env.defaultTmcDiscountExpirationTime) || env.defaultTmcDiscountExpirationTime <= 0) {
    throw new Error("DEFAULT_TMC_DISCOUNT_EXPIRATION_TIME must be a positive integer");
  }
}

function assertTmcCleanupConfig(env) {
  assertTmcConfig(env);
  const cron = String(env.discountCodesCleanupCron || "").trim();
  if (!cron) {
    throw new Error("Missing required env var DISCOUNT_CODES_CLEANUP_CRON");
  }
  const cronParts = cron.split(/\s+/);
  if (cronParts.length !== 5) {
    throw new Error("DISCOUNT_CODES_CLEANUP_CRON must be a standard 5-field cron expression");
  }
}

function extractShopFromAdminApi(adminApi) {
  const parsed = new URL(adminApi);
  return parsed.hostname;
}

function normalizeCodeToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function randomCodeToken(length = 8) {
  return randomBytes(length)
    .toString("base64")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, length);
}

function buildDiscountCode(prefix) {
  const normalizedPrefix = normalizeCodeToken(prefix);
  const suffix = randomCodeToken(8);
  if (!normalizedPrefix) return suffix;
  return `${normalizedPrefix}-${suffix}`;
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be a positive integer`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function normalizeDuration(duration, defaultDuration) {
  if (duration === undefined || duration === null || duration === "") {
    return parsePositiveInteger(defaultDuration, "duration");
  }
  return parsePositiveInteger(duration, "duration");
}

function normalizeProductId(productId) {
  const normalized = String(productId || "").trim();
  if (!/^\d+$/.test(normalized)) {
    const error = new Error("product_id must be a numeric Shopify product ID");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function toProductGid(productId) {
  return `gid://shopify/Product/${productId}`;
}

function buildTmcDiscountTitle({ code, type, dtype }) {
  return `TMC ${type} ${dtype} discount ${code}`;
}

function buildIdempotencyKey() {
  return randomUUID();
}

module.exports = {
  assertTmcConfig,
  assertTmcCleanupConfig,
  extractShopFromAdminApi,
  buildDiscountCode,
  normalizeDuration,
  normalizeProductId,
  toProductGid,
  buildTmcDiscountTitle,
  buildIdempotencyKey
};
