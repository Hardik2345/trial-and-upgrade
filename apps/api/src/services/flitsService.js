const axios = require("axios");
const RewardCreditJob = require("../models/RewardCreditJob");
const { recordFunnelEvent } = require("./funnelService");
const { addCustomerTags, getCustomerByGid } = require("./shopifyService");
const { lookupFlitsCredits } = require("./flitsLookupService");
const env = require("../config/env");

const CUSTOM_CREDIT_LIMIT_STORE_DOMAINS = new Set(["skincarepersonaltouch.myshopify.com"]);
const ELIGIBLE_QUANTITY_TAG_PREFIX = "eligible-qty-";
const CREDITED_ONCE_TAG = "credited-once";
const CREDITED_TWICE_TAG = "credited-twice";
const MAX_CUSTOM_CREDIT_LIMIT = 2;
const MARKETPLACE_CUSTOMER_CREDIT_DELAY_MS = 15000;

function clearLock(job) {
  job.lockedAt = undefined;
  job.lockedBy = undefined;
}

function formatFlitsPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return phone;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function summarizeCreditPayload(payload) {
  return {
    customer_email: payload?.customer_email || "",
    shopify_customer_id: payload?.shopify_customer_id || "",
    credit_value: payload?.credit_details?.credit_value,
    comment_text: payload?.credit_details?.comment_text || "",
    time_upto: payload?.credit_details?.time_upto
  };
}

function parseEligibleQuantityTag(tags) {
  for (const tag of tags || []) {
    const normalized = String(tag || "").trim().toLowerCase();
    if (!normalized.startsWith(ELIGIBLE_QUANTITY_TAG_PREFIX)) continue;
    const rawQuantity = normalized.slice(ELIGIBLE_QUANTITY_TAG_PREFIX.length);
    if (!/^\d+$/.test(rawQuantity)) continue;
    const quantity = Number(rawQuantity);
    if (Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_CUSTOM_CREDIT_LIMIT) return quantity;
  }
  return null;
}

function creditedTagUsage(tags) {
  const normalizedTags = (tags || []).map((tag) => String(tag || "").trim().toLowerCase());
  if (normalizedTags.includes(CREDITED_TWICE_TAG)) return 2;
  if (normalizedTags.includes(CREDITED_ONCE_TAG)) return 1;
  return 0;
}

function isCustomCreditLimitStore(store) {
  return CUSTOM_CREDIT_LIMIT_STORE_DOMAINS.has(String(store?.shopifyDomain || "").trim().toLowerCase());
}

function creditUsageFilter({ store, participant }) {
  const customerId = participant.creditCustomerId || participant.shopifyCustomerId || participant.eligibilityCustomerId || "";
  const customerEmail = normalizeEmail(participant.creditCustomerEmail);
  const customerPhone = formatFlitsPhone(participant.phoneDisplay);
  const identifiers = [];
  if (customerId) identifiers.push({ "payload.shopify_customer_id": customerId });
  if (customerEmail) identifiers.push({ "payload.customer_email": customerEmail });
  // Backward compatibility: old jobs were keyed by phone. Keep matching them
  // for queue-state checks after switching new Flits jobs to email.
  if (customerPhone) identifiers.push({ "payload.customer_phone": customerPhone });

  return {
    tenantStoreId: store._id,
    status: { $in: ["pending", "processing", "failed", "sent"] },
    ...(identifiers.length ? { $or: identifiers } : { _id: null })
  };
}

async function inflightCreditCount({ store, participant }, { JobModel = RewardCreditJob } = {}) {
  return JobModel.countDocuments({
    ...creditUsageFilter({ store, participant }),
    status: { $in: ["pending", "processing", "failed"] }
  });
}

async function creditSuccessTags({ store, participant }, { fetchCustomerByGid = getCustomerByGid } = {}) {
  const tags = ["credited"];
  if (!isCustomCreditLimitStore(store)) return tags;

  const customerGid = participant.creditCustomerGid || participant.eligibilityCustomerGid || participant.shopifyCustomerGid;
  const customer = await fetchCustomerByGid(store, customerGid);
  const usedCredits = creditedTagUsage(customer?.tags || []);
  if (usedCredits <= 0) tags.push(CREDITED_ONCE_TAG);
  else tags.push(CREDITED_TWICE_TAG);
  return tags;
}

async function customCreditLimitDecision(
  { store, campaign, participant },
  {
    JobModel = RewardCreditJob,
    fetchCustomerByGid = getCustomerByGid,
    logger = console
  } = {}
) {
  if (!isCustomCreditLimitStore(store)) return { applies: false, allowed: true };

  const marketplaceAutoCreditEnabled = campaign?.customCredit?.marketplaceAutoCreditEnabled === true;
  if (marketplaceAutoCreditEnabled && participant.customerSource === "marketplace") {
    const usedCredits = await JobModel.countDocuments(creditUsageFilter({ store, participant }));
    const allowed = usedCredits < 1;
    logger.info?.("[flits-queue] custom marketplace customer credit checked", {
      store: store?.slug,
      participantId: participant?._id,
      usedCredits,
      allowed
    });
    return { applies: true, allowed, reason: allowed ? "marketplace_first_credit" : "marketplace_limit_reached", eligibleQuantity: 1, usedCredits };
  }

  const customerGid = participant.eligibilityCustomerGid || participant.shopifyCustomerGid;
  const customer = await fetchCustomerByGid(store, customerGid);
  const customerTags = customer?.tags || [];
  const eligibleQuantity = parseEligibleQuantityTag(customerTags);
  if (!eligibleQuantity) {
    return { applies: true, allowed: false, reason: "missing_eligible_quantity_tag", eligibleQuantity: null, usedCredits: 0 };
  }

  const usedCredits = creditedTagUsage(customerTags);
  const activeCredits = await inflightCreditCount({ store, participant }, { JobModel });
  const allowed = usedCredits < eligibleQuantity && activeCredits === 0;
  logger.info?.("[flits-queue] custom credit limit checked", {
    store: store?.slug,
    participantId: participant?._id,
    customerGid: customerGid || "",
    eligibleQuantity,
    usedCredits,
    activeCredits,
    allowed
  });
  return { applies: true, allowed, reason: allowed ? "under_limit" : "limit_reached", eligibleQuantity, usedCredits };
}

function creditSkipMessage(reason) {
  switch (reason) {
    case "missing_eligible_quantity_tag":
      return "You are not eligible for wallet credit.";
    case "limit_reached":
      return "You have already redeemed the allowed number of wallet credits.";
    case "marketplace_limit_reached":
      return "You have already redeemed your marketplace customer wallet credit.";
    case "flits_credit_disabled":
      return "Wallet credit is currently disabled for this campaign.";
    case "missing_credit_email":
      return "Wallet credit could not be issued because no email is linked to the customer.";
    case "already_redeemed":
      return "This mobile number has already played.";
    case "already_played":
      return "This mobile number has already played.";
    case "non_marketplace_credit_disabled":
      return "Wallet credit is only issued to marketplace customers for this campaign.";
    default:
      return "Wallet credit was not issued.";
  }
}

function creditResult({ job = null, reason = null, eligibleQuantity = null, usedCredits = null } = {}) {
  if (job) {
    return {
      credited: true,
      queued: true,
      creditJobId: job._id,
      reason: "queued",
      message: "Wallet credit is being processed."
    };
  }
  return {
    credited: false,
    queued: false,
    creditJobId: null,
    reason,
    message: creditSkipMessage(reason),
    eligibleQuantity,
    usedCredits
  };
}

async function resolveCreditCustomer({ store, participant }, { fetchCustomerByGid = getCustomerByGid } = {}) {
  const existingEmail = normalizeEmail(participant.creditCustomerEmail);
  const existingId = participant.creditCustomerId || participant.shopifyCustomerId || participant.eligibilityCustomerId || "";
  const existingGid = participant.creditCustomerGid || participant.eligibilityCustomerGid || participant.shopifyCustomerGid || "";
  if (existingEmail) {
    return { id: existingId, gid: existingGid, email: existingEmail };
  }

  const customer = await fetchCustomerByGid(store, existingGid);
  return {
    id: customer?.numericId || existingId,
    gid: customer?.id || existingGid,
    email: normalizeEmail(customer?.email)
  };
}

async function enqueueCredit(
  { store, campaign, participant },
  {
    logger = console,
    JobModel = RewardCreditJob,
    fetchCustomerByGid = getCustomerByGid,
    includeResult = false
  } = {}
) {
  if (!campaign.flitsCredit?.enabled) {
    logger.info?.("[flits-queue] credit skipped (disabled)", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id
    });
    const result = creditResult({ reason: "flits_credit_disabled" });
    return includeResult ? result : null;
  }
  if (campaign.customCredit?.marketplaceOnlyCredit && participant.customerSource !== "marketplace") {
    logger.info?.("[flits-queue] credit skipped (marketplace-only)", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      customerSource: participant?.customerSource
    });
    const result = creditResult({ reason: "non_marketplace_credit_disabled" });
    return includeResult ? result : null;
  }
  const creditLimit = await customCreditLimitDecision(
    { store, campaign, participant },
    { JobModel, fetchCustomerByGid, logger }
  );
  if (creditLimit.applies && !creditLimit.allowed) {
    logger.info?.("[flits-queue] credit skipped (custom limit)", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      reason: creditLimit.reason,
      eligibleQuantity: creditLimit.eligibleQuantity,
      usedCredits: creditLimit.usedCredits
    });
    const result = creditResult({
      reason: creditLimit.reason,
      eligibleQuantity: creditLimit.eligibleQuantity,
      usedCredits: creditLimit.usedCredits
    });
    return includeResult ? result : null;
  }

  const creditCustomer = await resolveCreditCustomer({ store, participant }, { fetchCustomerByGid });
  if (!creditCustomer.email) {
    logger.info?.("[flits-queue] credit skipped (missing resolved customer email)", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      customerGid: creditCustomer.gid || ""
    });
    const result = creditResult({ reason: "missing_credit_email" });
    return includeResult ? result : null;
  }

  const firstRunDelayMs = participant.customerSource === "marketplace" ? MARKETPLACE_CUSTOMER_CREDIT_DELAY_MS : 0;
  const job = await JobModel.create({
    tenantStoreId: store._id,
    campaignId: campaign._id,
    participantId: participant._id,
    status: "pending",
    nextRunAt: new Date(Date.now() + firstRunDelayMs),
    payload: {
      customer_email: creditCustomer.email,
      shopify_customer_id: creditCustomer.id || "",
      credit_details: {
        credit_value: participant.reward?.value || campaign.flitsCredit.value,
        comment_text: campaign.flitsCredit.commentText,
        time_upto: 30
      }
    }
  });
  logger.info?.("[flits-queue] credit payload prepared", {
    store: store?.slug,
    campaignId: campaign?._id,
    participantId: participant?._id,
    payload: summarizeCreditPayload(job.payload)
  });
  logger.info?.("[flits-queue] credit queued", {
    store: store?.slug,
    campaignId: campaign?._id,
    participantId: participant?._id,
    jobId: job?._id,
    creditValue: job?.payload?.credit_details?.credit_value
  });
  return includeResult ? creditResult({ job }) : job;
}

function dueCreditJobFilter({ now = new Date(), lockTtlMs = env.flitsQueueLockTtlMs } = {}) {
  const staleBefore = new Date(now.getTime() - lockTtlMs);
  return {
    $or: [
      { status: "pending", nextRunAt: { $lte: now } },
      { status: "failed", nextRunAt: { $lte: now } },
      { status: "processing", lockedAt: { $lte: staleBefore } }
    ]
  };
}

async function claimCreditJob({
  workerId,
  now = new Date(),
  lockTtlMs = env.flitsQueueLockTtlMs,
  JobModel = RewardCreditJob
} = {}) {
  if (!workerId) throw new Error("workerId is required to claim credit jobs");
  return JobModel.findOneAndUpdate(
    dueCreditJobFilter({ now, lockTtlMs }),
    {
      $set: {
        status: "processing",
        lockedAt: now,
        lockedBy: workerId
      },
      $inc: { attempts: 1 }
    },
    { sort: { nextRunAt: 1, createdAt: 1 }, new: true }
  );
}

async function processCreditJob(
  job,
  { store, campaign, participant },
  {
    maxAttempts = env.flitsQueueMaxAttempts,
    axiosClient = axios,
    addTags = addCustomerTags,
    fetchCustomerByGid = getCustomerByGid,
    recordEvent = recordFunnelEvent,
    JobModel = RewardCreditJob,
    logger = console
  } = {}
) {
  try {
    if (!store.flitsConfig?.customActionUrl || !store.flitsConfig?.apiKey) {
      const err = new Error("Flits configuration is missing");
      logger.warn?.("[flits-queue] credit blocked (missing config)", {
        store: store?.slug,
        campaignId: campaign?._id,
        participantId: participant?._id,
        jobId: job?._id
      });
      throw err;
    }
    logger.info?.("[flits-queue] credit sending", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      jobId: job?._id,
      creditValue: job?.payload?.credit_details?.credit_value,
      attempt: job?.attempts,
      identifiers: {
        customer_email: job?.payload?.customer_email || "",
        shopify_customer_id: job?.payload?.shopify_customer_id || ""
      }
    });
    const response = await axiosClient.post(store.flitsConfig.customActionUrl, job.payload, {
      headers: { "x-api-key": store.flitsConfig.apiKey },
      timeout: 15000
    });
    logger.info?.("[flits-queue] credit endpoint response", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      jobId: job?._id,
      status: response?.status || null,
      data: response?.data || null
    });
    job.status = "sent";
    job.sentAt = new Date();
    job.processedAt = job.sentAt;
    job.lastError = "";
    clearLock(job);
    await job.save();
    logger.info?.("[flits-queue] credit sent", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      jobId: job?._id,
      sentAt: job?.sentAt
    });

    const flitsCustomerId = participant.creditCustomerId || participant.shopifyCustomerId || participant.eligibilityCustomerId;
    if (flitsCustomerId) {
      try {
        const { totalPoints, redeemedPoints, customer } = await lookupFlitsCredits(store, {
          shopifyCustomerId: flitsCustomerId
        }, { axiosClient, logger });
        logger.info?.("[flits-queue] credit verification", {
          store: store?.slug,
          campaignId: campaign?._id,
          participantId: participant?._id,
          jobId: job?._id,
          shopifyCustomerId: String(flitsCustomerId),
          customerFound: Boolean(customer),
          totalPoints,
          redeemedPoints
        });
      } catch (lookupErr) {
        logger.warn?.("[flits-queue] credit verification failed", {
          store: store?.slug,
          campaignId: campaign?._id,
          participantId: participant?._id,
          jobId: job?._id,
          shopifyCustomerId: String(flitsCustomerId),
          error: lookupErr.message
        });
      }
    }

    const tagTargetGid = participant.creditCustomerGid || participant.eligibilityCustomerGid || participant.shopifyCustomerGid;
    let creditTags = ["credited"];
    try {
      creditTags = await creditSuccessTags({ store, participant }, { fetchCustomerByGid });
    } catch (countErr) {
      logger.warn?.("[flits-queue] Credit sent but custom credited tag count failed", {
        store: store?.slug,
        campaignId: campaign?._id,
        participantId: participant?._id,
        jobId: job?._id,
        error: countErr.message
      });
    }
    try {
      logger.info?.("[flits-queue] credit tagging shopify customer", {
        store: store?.slug,
        campaignId: campaign?._id,
        participantId: participant?._id,
        jobId: job?._id,
        customerGid: tagTargetGid || "",
        tags: creditTags
      });
      await addTags(store, tagTargetGid, creditTags);
      logger.info?.("[flits-queue] credit tagged shopify customer", {
        store: store?.slug,
        campaignId: campaign?._id,
        participantId: participant?._id,
        jobId: job?._id
      });
    } catch (tagErr) {
      logger.warn?.(`[flits-queue] Credit sent but Shopify credited tag failed for job ${job._id}: ${tagErr.message}`);
    }

    try {
      logger.info?.("[flits-queue] credit recording funnel event", {
        store: store?.slug,
        campaignId: campaign?._id,
        participantId: participant?._id,
        jobId: job?._id,
        eventType: "reward_credited"
      });
      await recordEvent({ store, campaign, participant, eventType: "reward_credited" });
      logger.info?.("[flits-queue] credit recorded funnel event", {
        store: store?.slug,
        campaignId: campaign?._id,
        participantId: participant?._id,
        jobId: job?._id
      });
    } catch (eventErr) {
      logger.warn?.(`[flits-queue] Credit sent but reward_credited event failed for job ${job._id}: ${eventErr.message}`);
    }

    return { status: "sent" };
  } catch (err) {
    const exhausted = job.attempts >= maxAttempts;
    job.status = exhausted ? "dead" : "failed";
    job.lastError = err.message;
    job.processedAt = exhausted ? new Date() : undefined;
    job.nextRunAt = exhausted ? undefined : new Date(Date.now() + Math.min(job.attempts, 5) * 60 * 1000);
    clearLock(job);
    await job.save();
    logger.warn?.("[flits-queue] credit failed", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id,
      jobId: job?._id,
      attempts: job?.attempts,
      exhausted,
      error: err.message
    });
    return { status: job.status, error: err };
  }
}

module.exports = {
  enqueueCredit,
  dueCreditJobFilter,
  claimCreditJob,
  processCreditJob,
  parseEligibleQuantityTag,
  isCustomCreditLimitStore,
  creditSuccessTags,
  creditResult,
  customCreditLimitDecision
};
