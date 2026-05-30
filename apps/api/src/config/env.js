const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/spin-the-wheel",
  apiOrigins: (process.env.API_ORIGIN || "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  accessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret",
  refreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || "2026-04",
  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || "",
  piiEncryptionKey: process.env.PII_ENCRYPTION_KEY || "dev-only-pii-encryption-secret-32",
  devReturnOtp: process.env.DEV_RETURN_OTP === "true",
  flitsQueueEnabled: process.env.FLITS_QUEUE_ENABLED !== "false",
  flitsQueueIntervalMs: numberEnv("FLITS_QUEUE_INTERVAL_MS", 15000),
  flitsQueueMaxConcurrency: numberEnv("FLITS_QUEUE_MAX_CONCURRENCY", 5),
  flitsQueueMaxAttempts: numberEnv("FLITS_QUEUE_MAX_ATTEMPTS", 5),
  flitsQueueLockTtlMs: numberEnv("FLITS_QUEUE_LOCK_TTL_MS", 120000)
};

env.isProduction = env.nodeEnv === "production";

module.exports = env;
