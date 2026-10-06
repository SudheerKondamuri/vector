import { randomUUID } from "node:crypto";
import type { PilotEvidence, PilotSubmission, PilotTask, VerificationJob } from "../pilot-types.ts";
import { getPilotStore, type PilotState } from "./store.ts";
import { PilotError } from "./errors.ts";

export interface ClaimedVerification {
  job: VerificationJob;
  task: PilotTask;
  submission: PilotSubmission;
}

function stale(job: VerificationJob, now: number): boolean {
  return job.status === "running" && !!job.lockedAt && Date.parse(job.lockedAt) < now - 10 * 60 * 1000;
}

export async function claimVerificationJob(workerId: string): Promise<ClaimedVerification | null> {
  if (!workerId || workerId.length > 80) throw new PilotError(400, "Worker identity is invalid.");
  const store = getPilotStore();
  const lease = "postgres" in store ? await store.claimVerificationJob(workerId) : null;
  if ("postgres" in store && !lease) return null;
  return store.mutate(state => {
    const now = Date.now();
    const job = lease ? state.jobs.find(candidate => candidate.id === lease.id) : state.jobs.find(candidate => (candidate.status === "queued" || (candidate.status === "failed" && candidate.attempts < candidate.maxAttempts) || stale(candidate, now)) && Date.parse(candidate.availableAt) <= now);
    if (!job) return null;
    const task = state.tasks.find(candidate => candidate.id === job.taskId);
    const submission = state.submissions.find(candidate => candidate.id === job.submissionId);
    if (!task || !submission || submission.evidence || submission.status !== "received") {
      job.status = "cancelled";
      job.finishedAt = new Date(now).toISOString();
      job.errorMessage = "Submission is no longer eligible for queued verification.";
      if (lease && "postgres" in store) void store.finishVerificationJob(lease.id, workerId, "cancelled", undefined, job.errorMessage);
      return null;
    }
    job.status = "running";
    job.attempts = lease ? lease.attempts : job.attempts + 1;
    job.lockedBy = workerId;
    job.lockedAt = new Date(now).toISOString();
    job.startedAt = job.startedAt || job.lockedAt;
    job.errorMessage = undefined;
    return { job: { ...job }, task: { ...task }, submission: { ...submission } };
  });
}

export async function completeVerificationJob(jobId: string, workerId: string, evidence: PilotEvidence): Promise<PilotSubmission> {
  const store = getPilotStore();
  const submission = await store.mutate(state => {
    const job = state.jobs.find(candidate => candidate.id === jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) throw new PilotError(409, "This verification job is not owned by the worker.");
    const submission = state.submissions.find(candidate => candidate.id === job.submissionId);
    const task = state.tasks.find(candidate => candidate.id === job.taskId);
    if (!submission || !task || submission.evidence) throw new PilotError(409, "This submission is no longer eligible for verification.");
    if (evidence.artifactHash !== submission.artifactHash || evidence.source !== "worker-run") throw new PilotError(400, "Worker evidence is not bound to the submitted artifact.");
    submission.evidence = evidence;
    submission.status = evidence.outcome === "passed" ? "verified" : "failed";
    submission.updatedAt = new Date().toISOString();
    task.updatedAt = submission.updatedAt;
    job.status = evidence.outcome === "passed" ? "succeeded" : "failed";
    job.finishedAt = submission.updatedAt;
    job.lockedBy = undefined;
    job.lockedAt = undefined;
    job.errorMessage = evidence.outcome === "passed" ? undefined : "Verification checks failed.";
    state.events.push({ id: randomUUID(), taskId: task.id, actorName: `worker:${workerId}`, type: "submission.verified", message: `Pinned verification worker completed ${evidence.outcome} evidence for ${submission.id}.`, at: submission.updatedAt, privateOperatorId: submission.operatorId });
    return submission;
  });
  if ("postgres" in store) await store.finishVerificationJob(jobId, workerId, evidence.outcome === "passed" ? "succeeded" : "failed", undefined, evidence.outcome === "passed" ? undefined : "Verification checks failed.");
  return submission;
}

export async function failVerificationJob(jobId: string, workerId: string, message: string, retryable = true): Promise<void> {
  const store = getPilotStore();
  let availableAt: string | undefined;
  await store.mutate(state => {
    const job = state.jobs.find(candidate => candidate.id === jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) throw new PilotError(409, "This verification job is not owned by the worker.");
    const now = Date.now();
    job.status = retryable && job.attempts < job.maxAttempts ? "failed" : "failed";
    job.availableAt = new Date(now + (retryable && job.attempts < job.maxAttempts ? Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 15 * 60_000) : 0)).toISOString();
    availableAt = job.availableAt;
    job.finishedAt = new Date(now).toISOString();
    job.lockedBy = undefined;
    job.lockedAt = undefined;
    job.errorMessage = message.slice(0, 4000);
    const submission = state.submissions.find(candidate => candidate.id === job.submissionId);
    if (submission) state.events.push({ id: randomUUID(), taskId: job.taskId, actorName: `worker:${workerId}`, type: "submission.verification-failed", message: `Pinned verification worker attempt failed: ${job.errorMessage}`, at: job.finishedAt, privateOperatorId: submission.operatorId });
  });
  if ("postgres" in store) await store.finishVerificationJob(jobId, workerId, "failed", availableAt, message.slice(0, 4000));
}

export function workerEvidence(input: {
  artifactHash: string;
  engine: string;
  environment: string;
  checks: PilotEvidence["checks"];
  metrics: PilotEvidence["metrics"];
  logs: string[];
  limitations: string[];
  replayCommand: string;
  elapsedMs: number;
}): PilotEvidence {
  return { id: randomUUID(), source: "worker-run", outcome: input.checks.length > 0 && input.checks.every(check => check.passed) ? "passed" : "failed", generatedAt: new Date().toISOString(), ...input };
}
