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
  return template.replace(/{{\s*([\w.-]+)\s*}}|{\s*([\w.-]+)\s*}/g, (match, doubleKey, singleKey) => {
    const key = String(doubleKey || singleKey || "").toLowerCase();
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
  const params = new URLSearchParams({
    user: store.smsConfig.user,
    password: store.smsConfig.password,
    senderid: store.smsConfig.senderId,
    channel: "Trans",
    DCS: "0",
    flashsms: "0",
    number: phone,
    text: message,
    route: store.smsConfig.route,
    TemplateID: store.smsConfig.dltTemplateId,
    PEID: store.smsConfig.peid
  });
  console.log("[otp] sending via ALOT", {
    store: store.slug,
    phone,
    senderid: store.smsConfig.senderId,
    channel: "Trans",
    DCS: "0",
    flashsms: "0",
    route: store.smsConfig.route,
    TemplateID: store.smsConfig.dltTemplateId,
    PEID: store.smsConfig.peid
  });
  const response = await axios.get(`https://alots.co.in/api/mt/SendSMS?${params.toString()}`);
  console.log("[otp] ALOT response", response.data);
  return response.data;
}

module.exports = { buildOtp, sendOtpSms };
