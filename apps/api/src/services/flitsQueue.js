const os = require("os");
const process = require("process");
const env = require("../config/env");
const TenantStore = require("../models/TenantStore");
const Campaign = require("../models/Campaign");
const Participant = require("../models/Participant");
const RewardCreditJob = require("../models/RewardCreditJob");
const { claimCreditJob, dueCreditJobFilter, processCreditJob } = require("./flitsService");

function makeWorkerId() {
  return `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
}

async function loadJobContext(job) {
  const [store, campaign, participant] = await Promise.all([
    TenantStore.findById(job.tenantStoreId),
    Campaign.findById(job.campaignId),
    Participant.findById(job.participantId)
  ]);
  if (!store) throw new Error(`Tenant store not found for job ${job._id}`);
  if (!campaign) throw new Error(`Campaign not found for job ${job._id}`);
  if (!participant) throw new Error(`Participant not found for job ${job._id}`);
  return { store, campaign, participant };
}

async function processClaimedJob(job, options = {}) {
  try {
    const context = await (options.loadContext || loadJobContext)(job);
    return processCreditJob(job, context, options);
  } catch (err) {
    const maxAttempts = options.maxAttempts || env.flitsQueueMaxAttempts;
    const exhausted = job.attempts >= maxAttempts;
    job.status = exhausted ? "dead" : "failed";
    job.lastError = err.message;
    job.lockedAt = undefined;
    job.lockedBy = undefined;
    job.processedAt = exhausted ? new Date() : undefined;
    job.nextRunAt = exhausted ? undefined : new Date(Date.now() + Math.min(job.attempts, 5) * 60 * 1000);
    await job.save();
    return { status: job.status, error: err };
  }
}

async function runFlitsQueueTick({
  workerId,
  maxConcurrency = env.flitsQueueMaxConcurrency,
  lockTtlMs = env.flitsQueueLockTtlMs,
  JobModel = RewardCreditJob,
  logger = console,
  ...processOptions
} = {}) {
  const dueAtStart = await JobModel.countDocuments(dueCreditJobFilter({ now: new Date(), lockTtlMs }));
  const summary = { due: dueAtStart, claimed: 0, sent: 0, failed: 0, dead: 0 };
  const workers = Math.max(1, maxConcurrency);
  const failures = [];

  async function runWorker(workerNumber) {
    const scopedWorkerId = `${workerId}:${workerNumber}`;
    while (true) {
      const job = await claimCreditJob({ workerId: scopedWorkerId, now: new Date(), lockTtlMs, JobModel });
      if (!job) return;

      summary.claimed += 1;
      const result = await processClaimedJob(job, { ...processOptions, logger });
      if (result.status === "sent") summary.sent += 1;
      if (result.status === "failed") summary.failed += 1;
      if (result.status === "dead") summary.dead += 1;
      if (result.error) failures.push({ job, result });
    }
  }

  await Promise.all(Array.from({ length: workers }, (_item, index) => runWorker(index + 1)));

  logger.log?.(
    `[flits-queue] tick due=${summary.due} claimed=${summary.claimed} sent=${summary.sent} failed=${summary.failed} dead=${summary.dead}`
  );
  for (const { job, result } of failures) {
    logger.warn?.(
      `[flits-queue] job=${job._id} status=${result.status} attempts=${job.attempts} nextRunAt=${job.nextRunAt || ""} error=${result.error.message}`
    );
  }
  return summary;
}

function startFlitsQueue({
  enabled = env.flitsQueueEnabled,
  intervalMs = env.flitsQueueIntervalMs,
  maxConcurrency = env.flitsQueueMaxConcurrency,
  lockTtlMs = env.flitsQueueLockTtlMs,
  maxAttempts = env.flitsQueueMaxAttempts,
  workerId = makeWorkerId(),
  logger = console
} = {}) {
  if (!enabled) {
    logger.log?.("[flits-queue] disabled");
    return { stop() {}, workerId, enabled: false };
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runFlitsQueueTick({ workerId, maxConcurrency, lockTtlMs, maxAttempts, logger });
    } catch (err) {
      logger.error?.(`[flits-queue] tick failed: ${err.stack || err.message}`);
    } finally {
      running = false;
    }
  };

  logger.log?.(
    `[flits-queue] starting workerId=${workerId} intervalMs=${intervalMs} maxConcurrency=${maxConcurrency} maxAttempts=${maxAttempts} lockTtlMs=${lockTtlMs}`
  );
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return {
    workerId,
    enabled: true,
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = { startFlitsQueue, runFlitsQueueTick, processClaimedJob, loadJobContext };
