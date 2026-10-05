import { mkdir, open, lstat, chmod, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { EscrowEventRecord, EscrowRecord, MarketplaceProfile, PilotEvent, PilotSubmission, PilotTask, PilotUser, ReviewChallenge, VerificationJob } from "../pilot-types.ts";
import { PilotError, unavailable } from "./errors.ts";
import { credentials, ledgerInput, normalizedEmail, reviewInput, submissionInput, taskInput, TASK_FIELDS } from "./validation.ts";

export type AccountRole = "admin" | "member";
export interface StoredUser extends PilotUser { passwordHash: string; role: AccountRole; emailVerifiedAt?: string; emailVerificationTokenHash?: string; emailVerificationExpiresAt?: string; emailVerificationSentAt?: string; passwordResetTokenHash?: string; passwordResetExpiresAt?: string }
export interface StoredSession { tokenHash: string; userId: string; createdAt: string; expiresAt: string }
export interface AuthAttempt { key: string; count: number; resetAt: string }
export interface StoredInvitation { id: string; email: string; tokenHash: string; role: AccountRole; createdAt: string; expiresAt: string; usedAt?: string; taskId?: string }
export interface StoredApiToken { id: string; userId: string; name: string; tokenHash: string; prefix: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }
export interface StoredReservation { id: string; taskId: string; operatorId: string; expiresAt: string; releasedAt?: string; createdAt: string }
export interface OutboxMessage { id: string; type: "email-verification" | "password-reset" | "invitation"; to: string; payload: Record<string, string>; createdAt: string; sentAt?: string; attempts: number; lockedBy?: string; lockedAt?: string; errorMessage?: string }
export interface AuditEvent extends PilotEvent { privateOperatorId?: string; accountId?: string }
export interface PilotState {
  version: 1;
  users: StoredUser[];
  sessions: StoredSession[];
  apiTokens: StoredApiToken[];
  reservations: StoredReservation[];
  attempts: AuthAttempt[];
  invitations: StoredInvitation[];
  outbox: OutboxMessage[];
  profiles: MarketplaceProfile[];
  jobs: VerificationJob[];
  challenges: ReviewChallenge[];
  escrows: EscrowRecord[];
  escrowEvents: EscrowEventRecord[];
  tasks: PilotTask[];
  submissions: PilotSubmission[];
  events: AuditEvent[];
}

const MAX_STATE_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{8,80}$/;
const globals = globalThis as typeof globalThis & { __vectorPilotWrites?: Map<string, Promise<unknown>>; __vectorPilotPools?: Map<string, Pool> };
const writes = globals.__vectorPilotWrites ??= new Map<string, Promise<unknown>>();
const pools = globals.__vectorPilotPools ??= new Map<string, Pool>();

function initial(): PilotState {
  return { version: 1, users: [], sessions: [], apiTokens: [], reservations: [], attempts: [], invitations: [], outbox: [], profiles: [], jobs: [], challenges: [], escrows: [], escrowEvents: [], tasks: [], submissions: [], events: [] };
}

function date(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max = 20_000): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw unavailable();
}

function keys(value: object, allowed: readonly string[]): void {
  assert(Object.keys(value).every(key => allowed.includes(key)));
}

function unique(items: { id: string }[]): void {
  assert(new Set(items.map(item => item.id)).size === items.length);
}

/** Refuse malformed or partially corrupted state instead of inventing replacement data. */
function validateState(value: unknown): PilotState {
  try {
    assert(record(value) && value.version === 1);
    // Version 1 JSON records predate the production lifecycle collections. Add
    // only those known empty collections; reject every other unexpected field.
    if (!Array.isArray(value.invitations)) value.invitations = [];
    if (!Array.isArray(value.apiTokens)) value.apiTokens = [];
    if (!Array.isArray(value.reservations)) value.reservations = [];
    if (!Array.isArray(value.outbox)) value.outbox = [];
    if (!Array.isArray(value.profiles)) value.profiles = [];
    if (!Array.isArray(value.jobs)) value.jobs = [];
    if (!Array.isArray(value.challenges)) value.challenges = [];
    if (!Array.isArray(value.escrows)) value.escrows = [];
    if (!Array.isArray(value.escrowEvents)) value.escrowEvents = [];
    keys(value, ["version", "users", "sessions", "apiTokens", "reservations", "attempts", "invitations", "outbox", "profiles", "jobs", "challenges", "escrows", "escrowEvents", "tasks", "submissions", "events"]);
    for (const key of ["users", "sessions", "apiTokens", "reservations", "attempts", "invitations", "outbox", "profiles", "jobs", "challenges", "escrows", "escrowEvents", "tasks", "submissions", "events"]) assert(Array.isArray(value[key]) && (value[key] as unknown[]).length <= 100_000);
    const state = value as unknown as PilotState;
    for (const user of state.users) {
      assert(record(user) && ID.test(user.id) && boundedText(user.name, 100) && user.name.trim() && normalizedEmail(user.email) === user.email && date(user.createdAt));
      keys(user, ["id", "name", "email", "createdAt", "passwordHash", "role", "emailVerifiedAt", "emailVerificationTokenHash", "emailVerificationExpiresAt", "emailVerificationSentAt", "passwordResetTokenHash", "passwordResetExpiresAt"]);
      assert(typeof user.passwordHash === "string" && /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(user.passwordHash));
      assert(user.role === undefined || user.role === "admin" || user.role === "member");
      if (user.emailVerifiedAt !== undefined) assert(date(user.emailVerifiedAt));
      for (const key of ["emailVerificationTokenHash", "passwordResetTokenHash"] as const) if (user[key] !== undefined) assert(HASH.test(user[key]!));
      for (const key of ["emailVerificationExpiresAt", "emailVerificationSentAt", "passwordResetExpiresAt"] as const) if (user[key] !== undefined) assert(date(user[key]));
      credentials({ name: user.name, email: user.email, password: "validation-placeholder" }, true);
    }
    unique(state.users);
    assert(new Set(state.users.map(user => user.email)).size === state.users.length);
    const users = new Set(state.users.map(user => user.id));
    for (const session of state.sessions) {
      assert(record(session) && HASH.test(session.tokenHash) && users.has(session.userId) && date(session.createdAt) && date(session.expiresAt));
      keys(session, ["tokenHash", "userId", "createdAt", "expiresAt"]);
    }
    assert(new Set(state.sessions.map(session => session.tokenHash)).size === state.sessions.length);
    for (const apiToken of state.apiTokens) {
      assert(record(apiToken) && ID.test(apiToken.id) && users.has(apiToken.userId) && boundedText(apiToken.name, 100) && apiToken.name.trim() && HASH.test(apiToken.tokenHash) && /^vec_[a-zA-Z0-9_-]{8}$/.test(apiToken.prefix) && date(apiToken.createdAt));
      keys(apiToken, ["id", "userId", "name", "tokenHash", "prefix", "createdAt", "lastUsedAt", "revokedAt"]);
      if (apiToken.lastUsedAt !== undefined) assert(date(apiToken.lastUsedAt));
      if (apiToken.revokedAt !== undefined) assert(date(apiToken.revokedAt));
    }
    unique(state.apiTokens);
    assert(new Set(state.apiTokens.map(apiToken => apiToken.tokenHash)).size === state.apiTokens.length);
    const taskIds = new Set(state.tasks.map(task => task.id));
    for (const reservation of state.reservations) {
      assert(record(reservation) && ID.test(reservation.id) && taskIds.has(reservation.taskId) && users.has(reservation.operatorId) && date(reservation.expiresAt) && date(reservation.createdAt));
      keys(reservation, ["id", "taskId", "operatorId", "expiresAt", "releasedAt", "createdAt"]);
      if (reservation.releasedAt !== undefined) assert(date(reservation.releasedAt));
    }
    unique(state.reservations);
    assert(new Set(state.reservations.filter(reservation => !reservation.releasedAt).map(reservation => `${reservation.taskId}:${reservation.operatorId}`)).size === state.reservations.filter(reservation => !reservation.releasedAt).length);
    for (const attempt of state.attempts) {
      assert(record(attempt) && HASH.test(attempt.key) && Number.isInteger(attempt.count) && attempt.count >= 0 && attempt.count <= 1000 && date(attempt.resetAt));
      keys(attempt, ["key", "count", "resetAt"]);
    }
    assert(new Set(state.attempts.map(attempt => attempt.key)).size === state.attempts.length);
    for (const invitation of state.invitations) {
      assert(record(invitation) && ID.test(invitation.id) && normalizedEmail(invitation.email) === invitation.email && HASH.test(invitation.tokenHash) && (invitation.role === "admin" || invitation.role === "member") && date(invitation.createdAt) && date(invitation.expiresAt));
      keys(invitation, ["id", "email", "tokenHash", "role", "createdAt", "expiresAt", "usedAt", "taskId"]);
       if (invitation.usedAt !== undefined) assert(date(invitation.usedAt));
       if (invitation.taskId !== undefined) assert(ID.test(invitation.taskId));
    }
    unique(state.invitations);
    for (const message of state.outbox) {
      assert(record(message) && ID.test(message.id) && ["email-verification", "password-reset", "invitation"].includes(message.type) && normalizedEmail(message.to) === message.to && record(message.payload) && date(message.createdAt) && Number.isInteger(message.attempts) && message.attempts >= 0 && message.attempts <= 20);
      keys(message, ["id", "type", "to", "payload", "createdAt", "sentAt", "attempts", "lockedBy", "lockedAt", "errorMessage"]);
      assert(Object.entries(message.payload).every(([key, item]) => /^[a-zA-Z0-9_-]{1,80}$/.test(key) && boundedText(item, 4000)));
      if (message.sentAt !== undefined) assert(date(message.sentAt));
      if (message.lockedAt !== undefined) assert(date(message.lockedAt));
      if (message.errorMessage !== undefined) assert(boundedText(message.errorMessage, 4000));
    }
    unique(state.outbox);
    for (const profile of state.profiles) {
      assert(record(profile) && users.has(profile.userId) && ID.test(profile.userId) && /^[a-zA-Z0-9_-]{3,40}$/.test(profile.handle) && boundedText(profile.bio, 2000) && Array.isArray(profile.capabilities) && profile.capabilities.length <= 50 && profile.capabilities.every(capability => typeof capability === "string" && capability.length <= 120) && record(profile.adapterVersions) && ["available", "paused", "hidden"].includes(profile.availability) && Number.isInteger(profile.completedCount) && profile.completedCount >= 0 && Number.isInteger(profile.acceptedCount) && profile.acceptedCount >= 0 && Number.isInteger(profile.challengedCount) && profile.challengedCount >= 0 && Number.isInteger(profile.challengeFailures) && profile.challengeFailures >= 0 && date(profile.createdAt) && date(profile.updatedAt));
      keys(profile, ["userId", "handle", "bio", "capabilities", "adapterVersions", "availability", "completedCount", "acceptedCount", "challengedCount", "challengeFailures", "createdAt", "updatedAt"]);
    }
    assert(new Set(state.profiles.map(profile => profile.userId)).size === state.profiles.length);
    assert(new Set(state.profiles.map(profile => profile.handle)).size === state.profiles.length);
    for (const task of state.tasks) {
      assert(record(task) && ID.test(task.id) && users.has(task.ownerId) && boundedText(task.ownerName, 100) && ["draft", "open", "review", "accepted", "archived"].includes(task.status) && date(task.createdAt) && date(task.updatedAt));
      keys(task, [...TASK_FIELDS, "id", "ownerId", "ownerName", "status", "createdAt", "updatedAt", "publishedAt", "manifestHash", "acceptedSubmissionId", "ledger"]);
      taskInput(Object.fromEntries(TASK_FIELDS.map(key => [key, task[key]])));
      ledgerInput(task.ledger);
      if (task.publishedAt !== undefined) assert(date(task.publishedAt));
      if (task.manifestHash !== undefined) assert(HASH.test(task.manifestHash) && task.manifestHash === manifestHash(task));
      if (!["draft", "archived"].includes(task.status)) assert(task.manifestHash && task.publishedAt);
      if (task.acceptedSubmissionId !== undefined) assert(ID.test(task.acceptedSubmissionId));
    }
    unique(state.tasks);
    const tasks = new Map(state.tasks.map(task => [task.id, task]));
    for (const submission of state.submissions) {
      assert(record(submission) && ID.test(submission.id) && tasks.has(submission.taskId) && users.has(submission.operatorId) && boundedText(submission.operatorName, 100) && ["received", "verified", "failed", "recorded", "accepted", "rejected"].includes(submission.status) && date(submission.createdAt) && date(submission.updatedAt));
      keys(submission, ["patch", "baseCommit", "method", "computeUsd", "effortMinutes", "id", "taskId", "operatorId", "operatorName", "artifactHash", "status", "createdAt", "updatedAt", "evidence", "review"]);
      submissionInput(Object.fromEntries(["patch", "baseCommit", "method", "computeUsd", "effortMinutes"].map(key => [key, submission[key as keyof PilotSubmission]])));
      assert(HASH.test(submission.artifactHash) && submission.artifactHash === sha256(submission.patch) && submission.baseCommit === tasks.get(submission.taskId)!.baseCommit);
      if (submission.evidence) {
        const evidence = submission.evidence;
         assert(record(evidence) && ID.test(evidence.id) && ["reference-run", "external-report", "worker-run"].includes(evidence.source) && ["passed", "failed", "recorded"].includes(evidence.outcome) && date(evidence.generatedAt) && evidence.artifactHash === submission.artifactHash && boundedText(evidence.engine, 2000) && boundedText(evidence.environment, 4000) && boundedText(evidence.replayCommand, 4000));
        keys(evidence, ["id", "source", "outcome", "engine", "environment", "generatedAt", "artifactHash", "checks", "metrics", "logs", "limitations", "replayCommand", "elapsedMs"]);
        assert(Array.isArray(evidence.checks) && evidence.checks.length <= 100 && evidence.checks.every(check => record(check) && boundedText(check.name, 300) && typeof check.passed === "boolean" && boundedText(check.detail, 4000)));
        assert(Array.isArray(evidence.metrics) && evidence.metrics.length <= 100 && evidence.metrics.every(metric => record(metric) && boundedText(metric.name, 300) && Number.isFinite(metric.baseline) && metric.baseline > 0 && Number.isFinite(metric.candidate) && metric.candidate >= 0 && Number.isFinite(metric.improvementPct)));
        for (const check of evidence.checks) keys(check, ["name", "passed", "detail"]);
        for (const metric of evidence.metrics) keys(metric, ["name", "baseline", "candidate", "improvementPct"]);
        assert(Array.isArray(evidence.logs) && evidence.logs.length <= 1000 && evidence.logs.every(line => boundedText(line, 32_000)) && Array.isArray(evidence.limitations) && evidence.limitations.length <= 100 && evidence.limitations.every(line => boundedText(line, 4000)) && Number.isFinite(evidence.elapsedMs) && evidence.elapsedMs >= 0);
         if (submission.status === "verified") assert(["reference-run", "worker-run"].includes(evidence.source) && evidence.outcome === "passed");
        if (submission.status === "recorded") assert(evidence.source === "external-report" && evidence.outcome === "recorded");
      } else assert(!["verified", "recorded", "accepted"].includes(submission.status));
      if (submission.review) {
        keys(submission.review, ["decision", "reason", "minutes", "reviewerName", "at", "supersededByChallenge"]);
        reviewInput({ decision: submission.review.decision, reason: submission.review.reason, minutes: submission.review.minutes });
        assert(date(submission.review.at) && boundedText(submission.review.reviewerName, 100));
        assert(submission.status === (submission.review.decision === "accept" && !submission.review.supersededByChallenge ? "accepted" : "rejected"));
      }
      if (submission.status === "accepted" || submission.status === "rejected") assert(submission.review);
    }
    unique(state.submissions);
    assert(new Set(state.submissions.map(submission => `${submission.taskId}:${submission.artifactHash}`)).size === state.submissions.length);
    for (const job of state.jobs) {
      assert(record(job) && ID.test(job.id) && tasks.has(job.taskId) && state.submissions.some(submission => submission.id === job.submissionId && submission.taskId === job.taskId) && ["queued", "running", "succeeded", "failed", "cancelled"].includes(job.status) && Number.isInteger(job.attempts) && job.attempts >= 0 && job.attempts <= 10 && Number.isInteger(job.maxAttempts) && job.maxAttempts >= 1 && job.maxAttempts <= 10 && date(job.availableAt));
      keys(job, ["id", "taskId", "submissionId", "status", "attempts", "maxAttempts", "availableAt", "lockedBy", "lockedAt", "startedAt", "finishedAt", "errorMessage"]);
      if (job.lockedAt !== undefined) assert(date(job.lockedAt));
      if (job.startedAt !== undefined) assert(date(job.startedAt));
      if (job.finishedAt !== undefined) assert(date(job.finishedAt));
      if (job.errorMessage !== undefined) assert(boundedText(job.errorMessage, 4000));
    }
    unique(state.jobs);
    assert(new Set(state.jobs.map(job => job.submissionId)).size === state.jobs.length);
    for (const challenge of state.challenges) {
      assert(record(challenge) && ID.test(challenge.id) && taskIds.has(challenge.taskId) && state.submissions.some(submission => submission.id === challenge.submissionId && submission.taskId === challenge.taskId) && users.has(challenge.challengerId) && boundedText(challenge.challengerName, 100) && boundedText(challenge.reason, 4000) && date(challenge.openedAt) && date(challenge.expiresAt) && ["open", "resolved"].includes(challenge.status));
      keys(challenge, ["id", "taskId", "submissionId", "challengerId", "challengerName", "reason", "openedAt", "expiresAt", "status", "resolution", "resolutionReason", "resolverId", "resolverName", "resolvedAt"]);
      if (challenge.status === "resolved") assert(challenge.resolution === "uphold" || challenge.resolution === "dismiss");
      if (challenge.resolutionReason !== undefined) assert(boundedText(challenge.resolutionReason, 4000));
      if (challenge.resolverId !== undefined) assert(users.has(challenge.resolverId));
      if (challenge.resolverName !== undefined) assert(boundedText(challenge.resolverName, 100));
      if (challenge.resolvedAt !== undefined) assert(date(challenge.resolvedAt));
    }
    unique(state.challenges);
    for (const escrow of state.escrows) {
      assert(record(escrow) && ID.test(escrow.id) && taskIds.has(escrow.taskId) && state.submissions.some(submission => submission.id === escrow.submissionId && submission.taskId === escrow.taskId) && users.has(escrow.sponsorId) && users.has(escrow.operatorId) && /^0x[a-fA-F0-9]{40}$/.test(escrow.sponsorAddress) && /^0x[a-fA-F0-9]{40}$/.test(escrow.operatorAddress) && /^0x[a-fA-F0-9]{40}$/.test(escrow.tokenAddress) && /^0x[a-fA-F0-9]{40}$/.test(escrow.contractAddress) && /^\d+$/.test(escrow.amountAtomic) && Number.isInteger(escrow.chainId) && escrow.chainId > 0 && /^0x[a-fA-F0-9]{64}$/.test(escrow.taskHash) && /^0x[a-fA-F0-9]{64}$/.test(escrow.policyHash) && Number.isInteger(escrow.challengePeriodSeconds) && escrow.challengePeriodSeconds > 0 && ["intent", "funded", "release-pending", "challenged", "released", "refunded", "cancelled"].includes(escrow.status) && date(escrow.createdAt) && date(escrow.updatedAt));
      keys(escrow, ["id", "taskId", "submissionId", "sponsorId", "operatorId", "sponsorAddress", "operatorAddress", "tokenAddress", "contractAddress", "amountAtomic", "chainId", "taskHash", "policyHash", "challengePeriodSeconds", "status", "onchainEscrowId", "fundingTxHash", "releaseTxHash", "challengeTxHash", "settlementTxHash", "challengeEndsAt", "lastEventBlock", "createdAt", "updatedAt"]);
      for (const key of ["onchainEscrowId", "fundingTxHash", "releaseTxHash", "challengeTxHash", "settlementTxHash"] as const) if (escrow[key] !== undefined) assert(typeof escrow[key] === "string" && escrow[key].length <= 200);
      if (escrow.challengeEndsAt !== undefined) assert(date(escrow.challengeEndsAt));
      if (escrow.lastEventBlock !== undefined) assert(/^\d+$/.test(escrow.lastEventBlock));
    }
    unique(state.escrows);
    assert(new Set(state.escrows.filter(escrow => !["released", "refunded", "cancelled"].includes(escrow.status)).map(escrow => escrow.submissionId)).size === state.escrows.filter(escrow => !["released", "refunded", "cancelled"].includes(escrow.status)).length);
    for (const event of state.escrowEvents) {
      assert(record(event) && Number.isInteger(event.chainId) && event.chainId > 0 && /^0x[a-fA-F0-9]{40}$/.test(event.contractAddress) && /^0x[a-fA-F0-9]{64}$/.test(event.txHash) && Number.isInteger(event.logIndex) && event.logIndex >= 0 && /^\d+$/.test(event.blockNumber) && boundedText(event.eventName, 100) && record(event.payload) && date(event.observedAt));
      keys(event, ["chainId", "contractAddress", "txHash", "logIndex", "blockNumber", "eventName", "payload", "observedAt"]);
      assert(Object.entries(event.payload).every(([key, item]) => /^[a-zA-Z0-9_-]{1,80}$/.test(key) && boundedText(item, 4000)));
    }
    assert(new Set(state.escrowEvents.map(event => `${event.chainId}:${event.contractAddress}:${event.txHash}:${event.logIndex}`)).size === state.escrowEvents.length);
    for (const task of state.tasks) {
      const accepted = state.submissions.filter(submission => submission.taskId === task.id && submission.status === "accepted");
      assert(accepted.length <= 1 && (task.acceptedSubmissionId ? accepted[0]?.id === task.acceptedSubmissionId : accepted.length === 0));
      if (task.status === "accepted") assert(task.acceptedSubmissionId);
    }
    for (const event of state.events) {
      assert(record(event) && ID.test(event.id) && (event.taskId === "" || tasks.has(event.taskId)) && boundedText(event.actorName, 100) && boundedText(event.type, 100) && boundedText(event.message, 4000) && date(event.at) && (event.privateOperatorId === undefined || users.has(event.privateOperatorId)) && (event.accountId === undefined || users.has(event.accountId)));
      keys(event, ["id", "taskId", "actorName", "type", "message", "at", "privateOperatorId", "accountId"]);
    }
    unique(state.events);
    return state;
  } catch { throw unavailable(); }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** The published manifest includes every input field, including invitations and all financial terms. */
export function manifestHash(task: PilotTask): string {
  return sha256(JSON.stringify(Object.fromEntries(TASK_FIELDS.map(key => [key, task[key]]))));
}

function errno(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

function retryablePostgres(error: unknown): boolean {
  return errno(error, "40001") || errno(error, "40P01");
}

export function createPilotStore(directory: string) {
  const dir = resolve(directory);
  const file = join(dir, "state.json");

  async function readFileState(): Promise<PilotState> {
    let handle;
    try {
      const info = await lstat(file);
      assert(info.isFile() && !info.isSymbolicLink() && info.size <= MAX_STATE_BYTES);
      handle = await open(file, "r");
      const raw = await handle.readFile("utf8");
      assert(Buffer.byteLength(raw) <= MAX_STATE_BYTES);
      return validateState(JSON.parse(raw));
    } catch (error) {
      if (errno(error, "ENOENT")) return initial();
      throw unavailable();
    } finally { await handle?.close(); }
  }

  async function save(state: PilotState): Promise<void> {
    validateState(state);
    const raw = JSON.stringify(state);
    if (Buffer.byteLength(raw) > MAX_STATE_BYTES) throw new PilotError(503, "Pilot storage has reached its capacity. Archive and back up the private data before continuing.");
    const temporary = join(dir, `.state-${randomUUID()}.tmp`);
    let handle;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const info = await lstat(dir);
      assert(info.isDirectory() && !info.isSymbolicLink());
      await chmod(dir, 0o700);
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(raw, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, file);
      const directoryHandle = await open(dir, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch { throw unavailable(); }
    finally {
      await handle?.close();
      await unlink(temporary).catch(() => undefined);
    }
  }

  async function mutate<T>(fn: (state: PilotState) => T | Promise<T>): Promise<T> {
    const previous = writes.get(dir) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const state = await readFileState();
      const result = await fn(state);
      await save(state);
      return result;
    });
    writes.set(dir, operation);
    try { return await operation; }
    finally { if (writes.get(dir) === operation) writes.delete(dir); }
  }

  async function read(): Promise<PilotState> {
    await writes.get(dir)?.catch(() => undefined);
    return readFileState();
  }

  return { read, mutate, directory: dir };
}

export interface PilotStore {
  read(): Promise<PilotState>;
  mutate<T>(fn: (state: PilotState) => T | Promise<T>): Promise<T>;
  directory: string;
}

export interface PostgresPilotStore extends PilotStore {
  postgres: true;
  claimVerificationJob(workerId: string): Promise<{ id: string; attempts: number } | null>;
  finishVerificationJob(jobId: string, workerId: string, status: "succeeded" | "failed" | "cancelled", availableAt?: string, errorMessage?: string): Promise<void>;
  heartbeat(workerId: string, version: string, capabilities: Record<string, string>): Promise<void>;
  workerReady(maxAgeMs: number): Promise<boolean>;
}

function poolFor(connectionString: string): Pool {
  const existing = pools.get(connectionString);
  if (existing) return existing;
  const pool = new Pool({
    connectionString,
    max: Number(process.env.VECTOR_DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "vector",
  });
  pools.set(connectionString, pool);
  return pool;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

/**
 * PostgreSQL-backed state adapter. The state payload remains compatible with the
 * deterministic pilot domain model, while row-level locking makes each mutation
 * atomic across multiple web processes. The production migration creates the row.
 */
export function createPostgresPilotStore(connectionString: string): PostgresPilotStore & { health(): Promise<void>; close(): Promise<void> } {
  const pool = poolFor(connectionString);
  const directory = `postgres:${sha256(connectionString)}`;

  async function read(): Promise<PilotState> {
    try {
      const result = await pool.query<{ payload: unknown }>("SELECT payload FROM vector_pilot_state WHERE id = 1");
      return result.rowCount ? validateState(result.rows[0].payload) : initial();
    } catch {
      throw unavailable();
    }
  }

  async function mutate<T>(fn: (state: PilotState) => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        const result = await client.query<{ payload: unknown }>("SELECT payload FROM vector_pilot_state WHERE id = 1 FOR UPDATE");
        const state = result.rowCount ? validateState(result.rows[0].payload) : initial();
        const value = await fn(state);
        validateState(state);
        await client.query(
          `INSERT INTO vector_pilot_state (id, version, payload, updated_at)
           VALUES (1, $1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
          [state.version, JSON.stringify(state)],
        );
        await syncNormalized(client, state);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        if (client) await rollback(client);
        if (error instanceof PilotError) throw error;
        if (retryablePostgres(error) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        throw unavailable();
      } finally {
        client?.release();
      }
    }
    throw unavailable();
  }

  async function health(): Promise<void> {
    try { await pool.query("SELECT 1"); }
    catch { throw unavailable(); }
  }

  async function syncNormalized(client: PoolClient, state: PilotState): Promise<void> {
    for (const profile of state.profiles) await client.query(
      `INSERT INTO vector_marketplace_profiles (user_id, handle, bio, capabilities, adapter_versions, availability, completed_count, accepted_count, challenged_count, challenge_failures, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id) DO UPDATE SET handle=EXCLUDED.handle,bio=EXCLUDED.bio,capabilities=EXCLUDED.capabilities,adapter_versions=EXCLUDED.adapter_versions,availability=EXCLUDED.availability,completed_count=EXCLUDED.completed_count,accepted_count=EXCLUDED.accepted_count,challenged_count=EXCLUDED.challenged_count,challenge_failures=EXCLUDED.challenge_failures,updated_at=EXCLUDED.updated_at`,
      [profile.userId, profile.handle, profile.bio, JSON.stringify(profile.capabilities), JSON.stringify(profile.adapterVersions), profile.availability, profile.completedCount, profile.acceptedCount, profile.challengedCount, profile.challengeFailures, profile.createdAt, profile.updatedAt],
    );
    for (const reservation of state.reservations) await client.query(
      `INSERT INTO vector_task_reservations (id, task_id, operator_id, expires_at, released_at, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET expires_at=EXCLUDED.expires_at,released_at=EXCLUDED.released_at`,
      [reservation.id, reservation.taskId, reservation.operatorId, reservation.expiresAt, reservation.releasedAt || null, reservation.createdAt],
    );
    for (const job of state.jobs) await client.query(
      `INSERT INTO vector_verification_jobs (id, task_id, submission_id, status, attempts, max_attempts, available_at, locked_by, locked_at, started_at, finished_at, error_message, evidence, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,attempts=EXCLUDED.attempts,available_at=EXCLUDED.available_at,locked_by=EXCLUDED.locked_by,locked_at=EXCLUDED.locked_at,started_at=EXCLUDED.started_at,finished_at=EXCLUDED.finished_at,error_message=EXCLUDED.error_message,evidence=EXCLUDED.evidence,updated_at=NOW()`,
      [job.id, job.taskId, job.submissionId, job.status, job.attempts, job.maxAttempts, job.availableAt, job.lockedBy || null, job.lockedAt || null, job.startedAt || null, job.finishedAt || null, job.errorMessage || null, JSON.stringify(state.submissions.find(submission => submission.id === job.submissionId)?.evidence || null)],
    );
    for (const challenge of state.challenges) await client.query(
      `INSERT INTO vector_review_challenges (id,task_id,submission_id,challenger_id,challenger_name,reason,opened_at,expires_at,status,resolution,resolution_reason,resolver_id,resolver_name,resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,resolution=EXCLUDED.resolution,resolution_reason=EXCLUDED.resolution_reason,resolver_id=EXCLUDED.resolver_id,resolver_name=EXCLUDED.resolver_name,resolved_at=EXCLUDED.resolved_at`,
      [challenge.id, challenge.taskId, challenge.submissionId, challenge.challengerId, challenge.challengerName, challenge.reason, challenge.openedAt, challenge.expiresAt, challenge.status, challenge.resolution || null, challenge.resolutionReason || null, challenge.resolverId || null, challenge.resolverName || null, challenge.resolvedAt || null],
    );
    for (const escrow of state.escrows) await client.query(
      `INSERT INTO vector_escrows (id,task_id,submission_id,sponsor_id,operator_id,sponsor_address,operator_address,token_address,contract_address,amount_atomic,chain_id,task_hash,policy_hash,challenge_period_seconds,status,onchain_escrow_id,funding_tx_hash,release_tx_hash,challenge_tx_hash,settlement_tx_hash,challenge_ends_at,last_event_block,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,onchain_escrow_id=EXCLUDED.onchain_escrow_id,funding_tx_hash=EXCLUDED.funding_tx_hash,release_tx_hash=EXCLUDED.release_tx_hash,challenge_tx_hash=EXCLUDED.challenge_tx_hash,settlement_tx_hash=EXCLUDED.settlement_tx_hash,challenge_ends_at=EXCLUDED.challenge_ends_at,last_event_block=EXCLUDED.last_event_block,updated_at=EXCLUDED.updated_at`,
      [escrow.id, escrow.taskId, escrow.submissionId, escrow.sponsorId, escrow.operatorId, escrow.sponsorAddress, escrow.operatorAddress, escrow.tokenAddress, escrow.contractAddress, escrow.amountAtomic, escrow.chainId, escrow.taskHash, escrow.policyHash, escrow.challengePeriodSeconds, escrow.status, escrow.onchainEscrowId || null, escrow.fundingTxHash || null, escrow.releaseTxHash || null, escrow.challengeTxHash || null, escrow.settlementTxHash || null, escrow.challengeEndsAt || null, escrow.lastEventBlock || null, escrow.createdAt, escrow.updatedAt],
    );
    for (const event of state.escrowEvents) await client.query(
      `INSERT INTO vector_escrow_events (chain_id,contract_address,tx_hash,log_index,block_number,event_name,payload,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING`,
      [event.chainId, event.contractAddress, event.txHash, event.logIndex, event.blockNumber, event.eventName, JSON.stringify(event.payload), event.observedAt],
    );
  }

  async function claimVerificationJob(workerId: string): Promise<{ id: string; attempts: number } | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; attempts: number }>(
        `WITH candidate AS (
           SELECT id FROM vector_verification_jobs
           WHERE ((status = 'queued' AND available_at <= NOW()) OR (status = 'failed' AND attempts < max_attempts AND available_at <= NOW()) OR (status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes'))
           ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE vector_verification_jobs job SET status='running', attempts=job.attempts + 1, locked_by=$1, locked_at=NOW(), started_at=COALESCE(job.started_at,NOW()), updated_at=NOW()
         FROM candidate WHERE job.id=candidate.id RETURNING job.id, job.attempts`, [workerId],
      );
      await client.query("COMMIT");
      return result.rowCount ? result.rows[0] : null;
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async function finishVerificationJob(jobId: string, workerId: string, status: "succeeded" | "failed" | "cancelled", availableAt?: string, errorMessage?: string): Promise<void> {
    await pool.query("UPDATE vector_verification_jobs SET status=$1, available_at=COALESCE($2, available_at), finished_at=NOW(), locked_by=NULL, locked_at=NULL, error_message=$3, updated_at=NOW() WHERE id=$4 AND locked_by=$5", [status, availableAt || null, errorMessage || null, jobId, workerId]);
  }

  async function heartbeat(workerId: string, version: string, capabilities: Record<string, string>): Promise<void> {
    await pool.query("INSERT INTO vector_worker_heartbeats (worker_id,version,last_seen_at,capabilities) VALUES ($1,$2,NOW(),$3::jsonb) ON CONFLICT (worker_id) DO UPDATE SET version=EXCLUDED.version,last_seen_at=NOW(),capabilities=EXCLUDED.capabilities", [workerId, version, JSON.stringify(capabilities)]);
  }

  async function workerReady(maxAgeMs: number): Promise<boolean> {
    const result = await pool.query("SELECT 1 FROM vector_worker_heartbeats WHERE last_seen_at > NOW() - ($1::text || ' milliseconds')::interval LIMIT 1", [maxAgeMs]);
    return Boolean(result.rowCount);
  }

  async function close(): Promise<void> {
    pools.delete(connectionString);
    await pool.end();
  }

  return { read, mutate, directory, postgres: true as const, claimVerificationJob, finishVerificationJob, heartbeat, workerReady, health, close };
}

export function getPilotStore(): PilotStore | PostgresPilotStore {
  const requested = process.env.VECTOR_STORAGE;
  const production = process.env.NODE_ENV === "production";
  const testJson = process.env.VECTOR_ALLOW_JSON_TEST_STORAGE === "true" && process.env.VECTOR_E2E_MODE === "true";
  const usePostgres = requested === "postgres" || (production && !testJson);
  if (usePostgres) {
    if (!process.env.DATABASE_URL) throw new PilotError(503, "Production storage is not configured.");
    return createPostgresPilotStore(process.env.DATABASE_URL);
  }
  if (production && !testJson) throw new PilotError(503, "Production storage is not configured.");
  const directory = process.env.VECTOR_DATA_DIR || join(process.cwd(), ".data", "pilot");
  if (process.env.NODE_ENV === "test" && !process.env.VECTOR_DATA_DIR) throw new PilotError(503, "Tests require an isolated VECTOR_DATA_DIR.");
  return createPilotStore(directory);
}

export async function checkPostgresHealth(connectionString = process.env.DATABASE_URL): Promise<void> {
  if (!connectionString) throw unavailable();
  await createPostgresPilotStore(connectionString).health();
}

export function audit(state: PilotState, actor: PilotUser, taskId: string, type: string, message: string, privateOperatorId?: string): void {
  state.events.push({ id: randomUUID(), taskId, actorName: actor.name, type, message, at: new Date().toISOString(), ...(privateOperatorId ? { privateOperatorId } : {}), ...(!taskId ? { accountId: actor.id } : {}) });
}
