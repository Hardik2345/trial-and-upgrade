const axios = require("axios");
const RewardCreditJob = require("../models/RewardCreditJob");
const { recordFunnelEvent } = require("./funnelService");
const { addCustomerTags } = require("./shopifyService");
const { lookupFlitsCredits } = require("./flitsLookupService");
const env = require("../config/env");

function clearLock(job) {
  job.lockedAt = undefined;
  job.lockedBy = undefined;
}

async function enqueueCredit({ store, campaign, participant }, { logger = console } = {}) {
  if (!campaign.flitsCredit?.enabled) {
    logger.info?.("[flits-queue] credit skipped (disabled)", {
      store: store?.slug,
      campaignId: campaign?._id,
      participantId: participant?._id
    });
    return null;
  }
  const job = await RewardCreditJob.create({
    tenantStoreId: store._id,
    campaignId: campaign._id,
    participantId: participant._id,
    status: "pending",
    nextRunAt: new Date(),
    payload: {
      customer_email: participant.email,
      credit_details: {
        credit_value: participant.reward?.value || campaign.flitsCredit.value,
        comment_text: campaign.flitsCredit.commentText
      }
    }
  });
  logger.info?.("[flits-queue] credit queued", {
    store: store?.slug,
    campaignId: campaign?._id,
    participantId: participant?._id,
    jobId: job?._id,
    creditValue: job?.payload?.credit_details?.credit_value
  });
  return job;
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
    recordEvent = recordFunnelEvent,
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
      attempt: job?.attempts
    });
    await axiosClient.post(store.flitsConfig.customActionUrl, job.payload, {
      headers: { "x-api-key": store.flitsConfig.apiKey },
      timeout: 15000
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

    const flitsCustomerId = participant.shopifyCustomerId || participant.eligibilityCustomerId;
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

    const tagTargetGid = participant.shopifyCustomerGid || participant.eligibilityCustomerGid;
    try {
      await addTags(store, tagTargetGid, ["credited"]);
    } catch (tagErr) {
      logger.warn?.(`[flits-queue] Credit sent but Shopify credited tag failed for job ${job._id}: ${tagErr.message}`);
    }

    try {
      await recordEvent({ store, campaign, participant, eventType: "reward_credited" });
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

module.exports = { enqueueCredit, dueCreditJobFilter, claimCreditJob, processCreditJob };
