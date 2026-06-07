const axios = require("axios");

function normalizeFlitsValue(value) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeFlitsText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function applyLookupTemplate(template, values) {
  let result = String(template || "");
  for (const [key, value] of Object.entries(values || {})) {
    result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), encodeURIComponent(String(value || "")));
  }
  return result;
}

function appendQueryParam(url, key, value) {
  if (!value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function maskTokenInUrl(url) {
  return String(url || "").replace(/([?&]token=)[^&]+/i, "$1***");
}

async function lookupFlitsCredits(store, { shopifyCustomerId }, { axiosClient = axios, logger = console } = {}) {
  const flitsConfig = store?.flitsConfig || {};
  const creditLookupUrl = normalizeFlitsText(flitsConfig.creditLookupUrl);
  const creditLookupUserId = normalizeFlitsText(flitsConfig.creditLookupUserId);
  const creditLookupToken = normalizeFlitsText(flitsConfig.creditLookupToken);
  const integrationAppName = normalizeFlitsText(flitsConfig.integrationAppName);
  const normalizedShopifyCustomerId = normalizeFlitsText(shopifyCustomerId);
  if (!creditLookupUrl || !creditLookupUserId || !normalizedShopifyCustomerId) {
    return {
      totalPoints: 0,
      redeemedPoints: 0,
      customer: null
    };
  }

  const creditLookupTemplate = creditLookupUrl;
  const url = applyLookupTemplate(creditLookupTemplate, {
    user_id: creditLookupUserId,
    shopify_customer_id: normalizedShopifyCustomerId,
    token: creditLookupToken
  });
  const requestUrl = creditLookupTemplate.includes("{{token}}") ? url : appendQueryParam(url, "token", creditLookupToken);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  if (integrationAppName) {
    headers["x-integration-app-name"] = integrationAppName;
  }

  logger.info?.("[flits-lookup] fetching credits", {
    store: store?.slug,
    shopifyCustomerId: normalizedShopifyCustomerId,
    url: maskTokenInUrl(requestUrl),
    integrationAppName
  });
  let response;
  try {
    response = await axiosClient.get(requestUrl, {
      headers,
      timeout: 15000
    });
  } catch (err) {
    logger.error?.("[flits-lookup] fetch failed", {
      store: store?.slug,
      shopifyCustomerId: normalizedShopifyCustomerId,
      url: maskTokenInUrl(requestUrl),
      status: err?.response?.status || null,
      data: err?.response?.data || null,
      message: err?.message || "unknown"
    });
    throw err;
  }
  const customer = response.data?.customer || null;
  const totalPoints = normalizeFlitsValue(customer?.credits);
  const redeemedPoints = Math.abs(normalizeFlitsValue(customer?.total_spent_credits));
  logger.info?.("[flits-lookup] fetched credits", {
    store: store?.slug,
    shopifyCustomerId: normalizedShopifyCustomerId,
    totalPoints,
    redeemedPoints
  });
  return { totalPoints, redeemedPoints, customer };
}

module.exports = { lookupFlitsCredits };
