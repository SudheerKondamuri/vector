import type { ExternalReportInput, PilotLedger, PilotTaskInput, SubmissionInput } from "../pilot-types.ts";
import { REFERENCE_COMMIT, REFERENCE_PATH } from "../pilot-types.ts";
import { PilotError } from "./errors.ts";

export const PATCH_BYTES = 100_000;
export const TASK_FIELDS = ["title", "description", "fixture", "repoUrl", "baseCommit", "target", "scopePaths", "constraints", "minImprovementPct", "deadline", "maxSubmissions", "priceUsd", "operatorRewardUsd", "paymentTerms", "reviewTerms", "inviteEmails"] as const;
export const LEDGER_NUMBERS = ["serviceRevenueUsd", "operatorPaidUsd", "computeUsd", "supportUsd", "paymentFeesUsd", "platformMinutes", "platformHourlyUsd", "operatorComputeUsd", "operatorMinutes", "operatorHourlyUsd", "baselineMinutes", "setupMinutes", "reviewMinutes", "reworkMinutes"] as const;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PilotError(400, "A JSON object is required.");
  return value as Record<string, unknown>;
}

export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  if (unknown.length) throw new PilotError(400, "The request contains unsupported fields.", Object.fromEntries(unknown.map(key => [key, "Unsupported field."])));
}

export function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length > 254 || !emailPattern.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max && !value.includes("\0");
}

function number(value: unknown, max = 1_000_000_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

export function safeScopePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9._/-]+$/.test(value)) return false;
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  return !path.startsWith("/") && !path.split("/").some(part => !part || part.startsWith("."));
}

function finish(fields: Record<string, string>): void {
  if (Object.keys(fields).length) throw new PilotError(400, "Check the highlighted fields.", fields);
}

export function credentials(value: unknown, register: boolean): { email: string; password: string; name?: string; invitationToken?: string } {
  const input = object(value);
  onlyKeys(input, register ? ["email", "password", "name", "invitationToken"] : ["email", "password"]);
  const fields: Record<string, string> = {};
  const email = normalizedEmail(input.email);
  if (!email) fields.email = "Enter a valid email address.";
  if (!text(input.password, register ? 12 : 1, 256) || (typeof input.password === "string" && Buffer.byteLength(input.password) > 512)) fields.password = register ? "Use a password with 12–256 characters." : "Enter your password.";
  if (register && !text(input.name, 1, 100)) fields.name = "Enter a name with up to 100 characters.";
  if (register && input.invitationToken !== undefined && (typeof input.invitationToken !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input.invitationToken))) fields.invitationToken = "Use a valid invitation link.";
  finish(fields);
  return { email: email!, password: input.password as string, ...(register ? { name: (input.name as string).trim(), ...(input.invitationToken ? { invitationToken: input.invitationToken as string } : {}) } : {}) };
}

export function taskInput(value: unknown): PilotTaskInput {
  const input = object(value);
  onlyKeys(input, TASK_FIELDS);
  const fields: Record<string, string> = {};
  for (const [key, min, max] of [["title", 3, 140], ["description", 10, 20_000], ["target", 1, 300], ["constraints", 1, 12_000], ["paymentTerms", 1, 4000], ["reviewTerms", 1, 4000]] as const) {
    if (!text(input[key], min, max)) fields[key] = `Use ${min}–${max} characters.`;
  }
  if (input.fixture !== "reference" && input.fixture !== "external") fields.fixture = "Choose reference or external.";
  if (typeof input.repoUrl !== "string" || input.repoUrl.length > 2048) fields.repoUrl = "Enter a repository URL.";
  else if (input.fixture === "external") {
    try {
      const url = new URL(input.repoUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fields.repoUrl = "Use an HTTP(S) repository URL without credentials.";
    } catch { fields.repoUrl = "Enter a valid HTTP(S) repository URL."; }
  }
  if (typeof input.baseCommit !== "string" || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(input.baseCommit)) fields.baseCommit = "Use the full hexadecimal base commit.";
  if (!Array.isArray(input.scopePaths) || input.scopePaths.length < 1 || input.scopePaths.length > 20 || !input.scopePaths.every(safeScopePath) || new Set(input.scopePaths).size !== input.scopePaths.length) fields.scopePaths = "Choose 1–20 unique relative files or directories without traversal.";
  if (input.fixture === "reference") {
    if (input.baseCommit !== REFERENCE_COMMIT) fields.baseCommit = "Use the bundled reference commit.";
    if (!Array.isArray(input.scopePaths) || !input.scopePaths.includes(REFERENCE_PATH)) fields.scopePaths = "Include the bundled reference target path.";
  }
  if (!number(input.minImprovementPct, 100)) fields.minImprovementPct = "Use an improvement from 0 to 100 percent.";
  if (typeof input.deadline !== "string" || input.deadline.length > 40 || !Number.isFinite(Date.parse(input.deadline))) fields.deadline = "Enter a valid deadline with a timezone.";
  else if (!/(?:Z|[+-]\d\d:\d\d)$/.test(input.deadline)) fields.deadline = "Include a timezone in the deadline.";
  if (!number(input.maxSubmissions, 100) || !Number.isInteger(input.maxSubmissions) || (input.maxSubmissions as number) < 1) fields.maxSubmissions = "Use a submission cap from 1 to 100.";
  for (const key of ["priceUsd", "operatorRewardUsd"] as const) if (!number(input[key], 1_000_000)) fields[key] = "Use an amount from 0 to 1,000,000 USD.";
  if (number(input.priceUsd) && number(input.operatorRewardUsd) && input.operatorRewardUsd > input.priceUsd) fields.operatorRewardUsd = "The reward cannot exceed the sponsor's total price.";
  if (!Array.isArray(input.inviteEmails) || input.inviteEmails.length > 100 || input.inviteEmails.some(email => !normalizedEmail(email))) fields.inviteEmails = "Invite up to 100 valid email addresses.";
  finish(fields);
  return {
    ...(input as unknown as PilotTaskInput), title: (input.title as string).trim(), description: (input.description as string).trim(),
    baseCommit: (input.baseCommit as string).toLowerCase(), deadline: new Date(input.deadline as string).toISOString(),
    scopePaths: [...input.scopePaths as string[]], inviteEmails: [...new Set((input.inviteEmails as string[]).map(email => normalizedEmail(email)!))],
  };
}

export function draftChanges(value: unknown): Record<string, unknown> {
  const input = object(value);
  onlyKeys(input, TASK_FIELDS);
  if (!Object.keys(input).length) throw new PilotError(400, "Provide at least one draft field to change.");
  return input;
}

export function submissionInput(value: unknown): SubmissionInput {
  const input = object(value);
  onlyKeys(input, ["patch", "baseCommit", "method", "computeUsd", "effortMinutes"]);
  const fields: Record<string, string> = {};
  if (!text(input.patch, 1, PATCH_BYTES) || (typeof input.patch === "string" && Buffer.byteLength(input.patch) > PATCH_BYTES)) fields.patch = "Provide a UTF-8 patch of up to 100 KB.";
  if (typeof input.baseCommit !== "string" || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(input.baseCommit)) fields.baseCommit = "Use the full hexadecimal base commit.";
  if (!text(input.method, 1, 10_000)) fields.method = "Describe the method in up to 10,000 characters.";
  if (!number(input.computeUsd, 1_000_000)) fields.computeUsd = "Enter a non-negative compute cost.";
  if (!number(input.effortMinutes, 1_000_000)) fields.effortMinutes = "Enter non-negative effort minutes.";
  finish(fields);
  return { ...(input as unknown as SubmissionInput), baseCommit: (input.baseCommit as string).toLowerCase() };
}

export function externalReport(value: unknown): ExternalReportInput {
  const input = object(value);
  onlyKeys(input, ["environment", "checks", "metrics", "logs", "replayCommand", "limitations"]);
  const fields: Record<string, string> = {};
  if (!text(input.environment, 1, 2000)) fields.environment = "Describe the benchmark environment.";
  if (!text(input.replayCommand, 1, 4000)) fields.replayCommand = "Record a reproducible command; it will not be executed.";
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 50 || input.checks.some(check => !check || typeof check !== "object" || !text(check.name, 1, 200) || typeof check.passed !== "boolean" || !text(check.detail, 1, 2000) || Object.keys(check).some(key => !["name", "passed", "detail"].includes(key)))) fields.checks = "Record 1–50 named checks with results and details.";
  if (!Array.isArray(input.metrics) || input.metrics.length < 1 || input.metrics.length > 50 || input.metrics.some(metric => !metric || typeof metric !== "object" || !text(metric.name, 1, 200) || !number(metric.baseline, 1e15) || metric.baseline <= 0 || !number(metric.candidate, 1e15) || Object.keys(metric).some(key => !["name", "baseline", "candidate"].includes(key)))) fields.metrics = "Record positive baselines and non-negative candidate measurements.";
  for (const key of ["logs", "limitations"] as const) if (!Array.isArray(input[key]) || input[key].length > 100 || (input[key] as unknown[]).some(line => !text(line, 0, 2000))) fields[key] = "Use up to 100 text entries of 2,000 characters each.";
  finish(fields);
  return input as unknown as ExternalReportInput;
}

export function ledgerInput(value: unknown): PilotLedger {
  const input = object(value);
  onlyKeys(input, [...LEDGER_NUMBERS, "paymentStatus", "paymentReference"]);
  const fields: Record<string, string> = {};
  for (const key of LEDGER_NUMBERS) if (!number(input[key], key.endsWith("Minutes") ? 1_000_000 : 1_000_000_000)) fields[key] = "Enter a bounded, non-negative amount.";
  if (!["unpaid", "invoiced", "paid"].includes(input.paymentStatus as string)) fields.paymentStatus = "Choose unpaid, invoiced, or paid.";
  if (!text(input.paymentReference, input.paymentStatus === "paid" ? 1 : 0, 2000)) fields.paymentReference = "Record a payment reference (required for paid status).";
  finish(fields);
  return input as unknown as PilotLedger;
}

export function reviewInput(value: unknown): { decision: "accept" | "reject"; reason: string; minutes: number } {
  const input = object(value);
  onlyKeys(input, ["decision", "reason", "minutes"]);
  const fields: Record<string, string> = {};
  if (input.decision !== "accept" && input.decision !== "reject") fields.decision = "Choose accept or reject.";
  if (!text(input.reason, 1, 4000)) fields.reason = "Record the reason for this decision.";
  if (!number(input.minutes, 1_000_000)) fields.minutes = "Enter non-negative review minutes.";
  finish(fields);
  return input as unknown as { decision: "accept" | "reject"; reason: string; minutes: number };
}

export function challengeInput(value: unknown): { reason: string } {
  const input = object(value);
  onlyKeys(input, ["reason"]);
  if (!text(input.reason, 10, 4000)) throw new PilotError(400, "Record a challenge reason between 10 and 4,000 characters.", { reason: "Explain the evidence or process issue." });
  return { reason: (input.reason as string).trim() };
}

export function challengeResolutionInput(value: unknown): { decision: "uphold" | "dismiss"; reason: string } {
  const input = object(value);
  onlyKeys(input, ["decision", "reason"]);
  if (input.decision !== "uphold" && input.decision !== "dismiss") throw new PilotError(400, "Choose uphold or dismiss.", { decision: "Choose how to resolve the challenge." });
  if (!text(input.reason, 10, 4000)) throw new PilotError(400, "Record a resolution reason between 10 and 4,000 characters.", { reason: "Explain the resolution." });
  return { decision: input.decision, reason: (input.reason as string).trim() };
}

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const txPattern = /^0x[a-fA-F0-9]{64}$/;

export function escrowIntentInput(value: unknown): { sponsorAddress: string; operatorAddress: string; tokenAddress: string; contractAddress: string; amountAtomic: string; chainId: number; challengePeriodSeconds: number } {
  const input = object(value);
  onlyKeys(input, ["sponsorAddress", "operatorAddress", "tokenAddress", "contractAddress", "amountAtomic", "chainId", "challengePeriodSeconds"]);
  if (typeof input.sponsorAddress !== "string" || !addressPattern.test(input.sponsorAddress)) throw new PilotError(400, "The sponsor wallet address is invalid.");
  if (typeof input.operatorAddress !== "string" || !addressPattern.test(input.operatorAddress)) throw new PilotError(400, "The operator wallet address is invalid.");
  if (typeof input.tokenAddress !== "string" || !addressPattern.test(input.tokenAddress)) throw new PilotError(400, "The token address is invalid.");
  if (typeof input.contractAddress !== "string" || !addressPattern.test(input.contractAddress)) throw new PilotError(400, "The escrow contract address is invalid.");
  if (typeof input.amountAtomic !== "string" || !/^\d+$/.test(input.amountAtomic) || BigInt(input.amountAtomic) <= BigInt(0)) throw new PilotError(400, "The escrow amount must be a positive integer token amount.");
  if (input.chainId !== 84532) throw new PilotError(400, "Settlement is restricted to Base Sepolia.");
  if (input.challengePeriodSeconds !== 172800) throw new PilotError(400, "The settlement challenge period must be 48 hours.");
  return input as { sponsorAddress: string; operatorAddress: string; tokenAddress: string; contractAddress: string; amountAtomic: string; chainId: number; challengePeriodSeconds: number };
}

export function escrowTransactionInput(value: unknown): { txHash: string; onchainEscrowId?: string } {
  const input = object(value);
  onlyKeys(input, ["txHash", "onchainEscrowId"]);
  if (typeof input.txHash !== "string" || !txPattern.test(input.txHash)) throw new PilotError(400, "The transaction hash is invalid.");
  if (input.onchainEscrowId !== undefined && (typeof input.onchainEscrowId !== "string" || !/^\d+$/.test(input.onchainEscrowId))) throw new PilotError(400, "The on-chain escrow identifier is invalid.");
  return input as { txHash: string; onchainEscrowId?: string };
}

export function escrowEventInput(value: unknown): { chainId: number; contractAddress: string; txHash: string; logIndex: number; blockNumber: string; eventName: string; payload: Record<string, string> } {
  const input = object(value);
  onlyKeys(input, ["chainId", "contractAddress", "txHash", "logIndex", "blockNumber", "eventName", "payload"]);
  if (input.chainId !== 84532 || typeof input.contractAddress !== "string" || !addressPattern.test(input.contractAddress) || typeof input.txHash !== "string" || !txPattern.test(input.txHash) || !Number.isInteger(input.logIndex) || (input.logIndex as number) < 0 || typeof input.blockNumber !== "string" || !/^\d+$/.test(input.blockNumber) || typeof input.eventName !== "string" || !/^[A-Za-z][A-Za-z0-9]{1,80}$/.test(input.eventName) || !recordValue(input.payload) || Object.entries(input.payload).some(([key, item]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(key) || typeof item !== "string" || item.length > 4000)) throw new PilotError(400, "The escrow event payload is invalid.");
  return input as { chainId: number; contractAddress: string; txHash: string; logIndex: number; blockNumber: string; eventName: string; payload: Record<string, string> };
}

export function emptyLedger(): PilotLedger {
  return { ...Object.fromEntries(LEDGER_NUMBERS.map(key => [key, 0])), paymentStatus: "unpaid", paymentReference: "" } as PilotLedger;
}

export function profileInput(value: unknown): { handle: string; bio: string; capabilities: string[]; adapterVersions: Record<string, string>; availability: "available" | "paused" | "hidden" } {
  const input = object(value);
  onlyKeys(input, ["handle", "bio", "capabilities", "adapterVersions", "availability"]);
  if (typeof input.handle !== "string" || !/^[a-zA-Z0-9_-]{3,40}$/.test(input.handle)) throw new PilotError(400, "Handle must use 3–40 letters, numbers, dashes or underscores.", { handle: "Use a unique marketplace handle." });
  if (!text(input.bio, 0, 2000)) throw new PilotError(400, "Profile bio is too long.", { bio: "Use up to 2,000 characters." });
  if (!Array.isArray(input.capabilities) || input.capabilities.length > 50 || input.capabilities.some(item => typeof item !== "string" || item.trim().length < 1 || item.length > 120)) throw new PilotError(400, "Profile capabilities are invalid.", { capabilities: "Use up to 50 named capabilities." });
  if (!recordValue(input.adapterVersions) || Object.entries(input.adapterVersions).some(([key, item]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(key) || typeof item !== "string" || item.length > 80)) throw new PilotError(400, "Adapter versions are invalid.");
  if (!['available', 'paused', 'hidden'].includes(input.availability as string)) throw new PilotError(400, "Choose a valid profile availability.");
  return { handle: input.handle, bio: (input.bio as string).trim(), capabilities: [...new Set((input.capabilities as string[]).map(item => item.trim()))], adapterVersions: { ...(input.adapterVersions as Record<string, string>) }, availability: input.availability as "available" | "paused" | "hidden" };
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
