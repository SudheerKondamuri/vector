import { randomUUID } from "node:crypto";
import { claimVerificationJob, completeVerificationJob, failVerificationJob } from "../lib/pilot-server/jobs.ts";
import { runExternalVerification } from "../lib/production/external-verifier.ts";
import { drainOneOutbox } from "../lib/production/email.ts";
import { reconcileSettlementEvents } from "../lib/production/chain-reconciler.ts";
import { getPilotStore } from "../lib/pilot-server/store.ts";

if (process.env.NODE_ENV === "production" && (!process.env.DATABASE_URL || !process.env.WORKER_AUTH_SECRET)) {
  throw new Error("DATABASE_URL and WORKER_AUTH_SECRET are required for the production worker");
}
if (process.env.NODE_ENV === "production" && (!process.env.BASE_SEPOLIA_RPC_URL || !process.env.BASE_SEPOLIA_ESCROW_ADDRESS || !process.env.BASE_SEPOLIA_START_BLOCK)) {
  throw new Error("BASE_SEPOLIA_RPC_URL, BASE_SEPOLIA_ESCROW_ADDRESS and BASE_SEPOLIA_START_BLOCK are required for the production settlement reconciler");
}
if (process.env.NODE_ENV === "production" && (process.env.EMAIL_PROVIDER !== "smtp" || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) {
  throw new Error("SMTP email delivery is required for the production worker");
}

const workerId = process.env.WORKER_ID || `worker-${randomUUID()}`;
const once = process.argv.includes("--once");
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function heartbeat(): Promise<void> {
  const store = getPilotStore();
  if ("postgres" in store) await store.heartbeat(workerId, process.env.VECTOR_WORKER_VERSION || "vector-worker/0.2.0", { verifier: "docker", email: "smtp" });
}

async function run(): Promise<void> {
  await heartbeat();
  let lastHeartbeat = Date.now();
  let lastChainSync = 0;
  while (true) {
    if (Date.now() - lastHeartbeat >= 30_000) { await heartbeat(); lastHeartbeat = Date.now(); }
    if (Date.now() - lastChainSync >= 15_000) {
      try { await reconcileSettlementEvents(); }
      catch (error) { process.stderr.write(`${JSON.stringify({ event: "settlement-reconciliation-failed", message: error instanceof Error ? error.message : "unknown error" })}\n`); }
      lastChainSync = Date.now();
    }
    await drainOneOutbox(workerId);
    const claimed = await claimVerificationJob(workerId);
    if (!claimed) {
      if (once) return;
      await sleep(1000);
      continue;
    }
    try {
      const evidence = await runExternalVerification(claimed.task, claimed.submission);
      await completeVerificationJob(claimed.job.id, workerId, evidence);
    } catch (error) {
      await failVerificationJob(claimed.job.id, workerId, error instanceof Error ? error.message : "External verification failed");
    }
    if (once) return;
  }
}

run().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`); process.exitCode = 1; });
