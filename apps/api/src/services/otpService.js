const { sha256, makeOtp } = require("../utils/crypto");

function buildOtp(length) {
  const otp = makeOtp(length);
  return { otp, otpHash: sha256(otp) };
}

function renderSmsTemplate(template, data) {
  if (!template) return "";
  const normalized = {};
  for (const [key, value] of Object.entries(data || {})) {
    normalized[String(key).toLowerCase()] = value;
  }
  return template.replace(/\$\{\s*([\w.-]+)\s*\}|{{\s*([\w.-]+)\s*}}|{\s*([\w.-]+)\s*}/g, (match, dollarKey, doubleKey, singleKey) => {
    const key = String(dollarKey || doubleKey || singleKey || "").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) return match;
    const value = normalized[key];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

function resolveStoreSiteUrl(store) {
  if (store?.shopifyDomain) return `https://${store.shopifyDomain}`;
  return "https://sosorrysugar.com";
}

function normalizeSmsValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeSmsNumber(phone) {
  const digits = normalizeSmsValue(phone).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

async function sendOtpSms(store, phone, otp, context = {}) {
  if (!store.smsConfig?.user || process.env.NODE_ENV !== "production") {
    console.log(`[otp] ${store.slug} ${phone}`);
    return { skipped: true };
  }

  const axios = require("axios");
  const template = store.smsConfig?.messageTemplate?.trim();
  const message = template
    ? renderSmsTemplate(template, {
        name: context.name,
        otp,
        storeName: store.name,
        siteUrl: resolveStoreSiteUrl(store)
      })
    : `Your OTP for registration on our website https://sosorrysugar.com is ${otp}. Do not share this code with anyone. Valid for 10 minutes only. - Team Sorry Sugar`;
  const senderId = normalizeSmsValue(store.smsConfig.senderId);
  const route = normalizeSmsValue(store.smsConfig.route);
  const dltTemplateId = normalizeSmsValue(store.smsConfig.dltTemplateId);
  const peid = normalizeSmsValue(store.smsConfig.peid);
  const number = normalizeSmsNumber(phone);
  const params = new URLSearchParams({
    user: normalizeSmsValue(store.smsConfig.user),
    password: normalizeSmsValue(store.smsConfig.password),
    senderid: senderId,
    channel: "Trans",
    DCS: "0",
    flashsms: "0",
    number,
    text: message,
    route,
    TemplateID: dltTemplateId,
    templateid: dltTemplateId,
    dlttemplateid: dltTemplateId,
    PEID: peid,
    peid,
    EntityId: peid,
    entityid: peid
  });
  console.log("[otp] sending via ALOT", {
    store: store.slug,
    phone: number,
    senderid: senderId,
    channel: "Trans",
    DCS: "0",
    flashsms: "0",
    route,
    TemplateID: dltTemplateId,
    templateid: dltTemplateId,
    dlttemplateid: dltTemplateId,
    PEID: peid,
    peid,
    EntityId: peid,
    entityid: peid,
    text: message
  });
  const response = await axios.get(`https://alots.co.in/api/mt/SendSMS?${params.toString()}`);
  console.log("[otp] ALOT response", response.data);
  return response.data;
}

module.exports = { buildOtp, sendOtpSms };
