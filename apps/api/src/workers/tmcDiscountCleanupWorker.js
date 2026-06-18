const env = require("../config/env");
const { connectDatabase } = require("../config/db");
const { assertTmcCleanupConfig } = require("../custom-apis/the-man-company/helpers");
const { runTmcDiscountCleanup } = require("../custom-apis/the-man-company/cleanupService");

async function runWorker() {
  assertTmcCleanupConfig(env);
  await connectDatabase();
  return runTmcDiscountCleanup();
}

if (require.main === module) {
  runWorker()
    .then((summary) => {
      console.log("[tmc-discount-cleanup] complete", summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[tmc-discount-cleanup] failed", err);
      process.exit(1);
    });
}

module.exports = { runWorker };
