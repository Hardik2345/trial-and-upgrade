const { sha256, makeOtp } = require("../utils/crypto");

function buildOtp(length) {
  const otp = makeOtp(length);
  return { otp, otpHash: sha256(otp) };
}

async function sendOtpSms(store, phone, otp) {
  if (!store.smsConfig?.user || process.env.NODE_ENV !== "production") {
    console.log(`[otp] ${store.slug} ${phone}: ${otp}`);
    return { skipped: true };
  }

  const axios = require("axios");
  const message = `Your OTP is ${otp}. Do not share this code with anyone. Valid for 10 minutes.`;
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
    PEID: store.smsConfig.peid,
    text: message
  });
  const response = await axios.get(`https://alots.co.in/api/mt/SendSMS?${params.toString()}`);
  console.log("[otp] ALOT response", response.data);
  return response.data;
}

module.exports = { buildOtp, sendOtpSms };
