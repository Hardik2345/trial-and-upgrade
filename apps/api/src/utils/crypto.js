const crypto = require("crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits;
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 4) return normalized;
  return `${normalized.slice(0, 2)}******${normalized.slice(-2)}`;
}

function makeOtp(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function hashRefreshToken(token) {
  return sha256(token);
}

function hashPhone(phone, tenantStoreId) {
  return sha256(`${tenantStoreId}:${normalizePhone(phone)}`);
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  sha256,
  normalizePhone,
  maskPhone,
  makeOtp,
  hashRefreshToken,
  hashPhone,
  safeCompare
};
