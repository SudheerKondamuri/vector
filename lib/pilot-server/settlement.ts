import { randomUUID } from "node:crypto";
import type { EscrowEventRecord, EscrowRecord } from "../pilot-types.ts";
import { buildPolicyHash, buildTaskHash, canRequestSettlement, ESCROW_CHALLENGE_PERIOD_SECONDS, transitionEscrow, type EscrowStatus } from "../settlement-domain.ts";
import { requireUser } from "./auth.ts";
import { PilotError } from "./errors.ts";
import { audit, getPilotStore, type PilotState } from "./store.ts";
import { escrowEventInput, escrowIntentInput, escrowTransactionInput } from "./validation.ts";

function taskFor(state: PilotState, taskId: string) {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new PilotError(404, "Task not found.");
  return task;
}

function visible(state: PilotState, escrow: EscrowRecord, userId: string): EscrowRecord {
  if (escrow.sponsorId !== userId && escrow.operatorId !== userId) throw new PilotError(403, "You do not have access to this escrow.");
  return escrow;
}

function activeChallenge(state: PilotState, submissionId: string): boolean {
  return state.challenges.some(challenge => challenge.submissionId === submissionId && challenge.status === "open");
}

export async function createEscrowIntent(taskId: string, value: unknown, token?: string): Promise<EscrowRecord> {
  const input = escrowIntentInput(value);
  return getPilotStore().mutate(state => {
    const sponsor = requireUser(state, token);
    const task = taskFor(state, taskId);
    if (task.ownerId !== sponsor.id) throw new PilotError(403, "Only the task sponsor can create settlement intent.");
    if (!task.acceptedSubmissionId) throw new PilotError(409, "An accepted submission is required before settlement.");
    const submission = state.submissions.find(item => item.id === task.acceptedSubmissionId);
    if (!submission || !canRequestSettlement(task, submission, activeChallenge(state, submission.id))) throw new PilotError(409, "Settlement is blocked until the accepted submission is challenge-free.");
    if (state.escrows.some(escrow => escrow.submissionId === submission.id && !["released", "refunded", "cancelled"].includes(escrow.status))) throw new PilotError(409, "Settlement intent already exists for this submission.");
    const now = new Date().toISOString();
    const escrow: EscrowRecord = { id: randomUUID(), taskId, submissionId: submission.id, sponsorId: sponsor.id, operatorId: submission.operatorId, sponsorAddress: input.sponsorAddress, operatorAddress: input.operatorAddress, tokenAddress: input.tokenAddress, contractAddress: input.contractAddress, amountAtomic: input.amountAtomic, chainId: input.chainId, taskHash: buildTaskHash(task), policyHash: buildPolicyHash(task), challengePeriodSeconds: input.challengePeriodSeconds, status: "intent", createdAt: now, updatedAt: now };
    state.escrows.push(escrow);
    audit(state, sponsor, taskId, "escrow.intent-created", `Base Sepolia escrow intent ${escrow.id} created. No token transfer has occurred.`);
    return escrow;
  });
}

export async function getEscrow(id: string, token?: string): Promise<EscrowRecord> {
  const state = await getPilotStore().read();
  const user = requireUser(state, token);
  const escrow = state.escrows.find(item => item.id === id);
  if (!escrow) throw new PilotError(404, "Escrow not found.");
  return visible(state, escrow, user.id);
}

export async function recordFunding(id: string, value: unknown, token?: string): Promise<EscrowRecord> {
  const input = escrowTransactionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const escrow = state.escrows.find(item => item.id === id);
    if (!escrow) throw new PilotError(404, "Escrow not found.");
    visible(state, escrow, user.id);
    if (escrow.sponsorId !== user.id || escrow.status !== "intent") throw new PilotError(409, "This escrow is not ready to record funding.");
    escrow.status = transitionEscrow(escrow.status, "funded");
    escrow.fundingTxHash = input.txHash;
    escrow.onchainEscrowId = input.onchainEscrowId;
    escrow.updatedAt = new Date().toISOString();
    audit(state, user, escrow.taskId, "escrow.funded", `Funding transaction ${input.txHash} recorded. Reconciliation remains authoritative.`);
    return escrow;
  });
}

export async function recordReleaseRequest(id: string, value: unknown, token?: string): Promise<EscrowRecord> {
  const input = escrowTransactionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const escrow = state.escrows.find(item => item.id === id);
    if (!escrow) throw new PilotError(404, "Escrow not found.");
    if (escrow.sponsorId !== user.id || escrow.status !== "funded") throw new PilotError(409, "This escrow is not ready for a release request.");
    if (activeChallenge(state, escrow.submissionId)) throw new PilotError(409, "An open review challenge blocks settlement.");
    escrow.status = transitionEscrow(escrow.status, "release-pending");
    escrow.releaseTxHash = input.txHash;
    escrow.challengeEndsAt = new Date(Date.now() + ESCROW_CHALLENGE_PERIOD_SECONDS * 1000).toISOString();
    escrow.updatedAt = new Date().toISOString();
    audit(state, user, escrow.taskId, "escrow.release-requested", `Release request transaction ${input.txHash} recorded; the 48-hour challenge period is active.`);
    return escrow;
  });
}

export async function recordChallengeTransaction(id: string, value: unknown, token?: string): Promise<EscrowRecord> {
  const input = escrowTransactionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const escrow = state.escrows.find(item => item.id === id);
    if (!escrow) throw new PilotError(404, "Escrow not found.");
    if (escrow.operatorId !== user.id || escrow.status !== "release-pending" || !escrow.challengeEndsAt || Date.parse(escrow.challengeEndsAt) <= Date.now()) throw new PilotError(409, "This escrow is not open for an operator challenge.");
    escrow.status = transitionEscrow(escrow.status, "challenged");
    escrow.challengeTxHash = input.txHash;
    escrow.updatedAt = new Date().toISOString();
    audit(state, user, escrow.taskId, "escrow.challenged", `Challenge transaction ${input.txHash} recorded.`);
    return escrow;
  });
}

export async function recordFinalization(id: string, value: unknown, token?: string): Promise<EscrowRecord> {
  const input = escrowTransactionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const escrow = state.escrows.find(item => item.id === id);
    if (!escrow) throw new PilotError(404, "Escrow not found.");
    if (escrow.sponsorId !== user.id || escrow.status !== "release-pending" || !escrow.challengeEndsAt || Date.parse(escrow.challengeEndsAt) > Date.now()) throw new PilotError(409, "The escrow challenge period is still open.");
    escrow.status = transitionEscrow(escrow.status, "released");
    escrow.settlementTxHash = input.txHash;
    escrow.updatedAt = new Date().toISOString();
    audit(state, user, escrow.taskId, "escrow.released", `Final release transaction ${input.txHash} recorded.`);
    return escrow;
  });
}

export async function recordChallengeResolution(id: string, value: unknown, releaseToOperator: boolean, token?: string): Promise<EscrowRecord> {
  const input = escrowTransactionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const escrow = state.escrows.find(item => item.id === id);
    if (!escrow) throw new PilotError(404, "Escrow not found.");
    if (escrow.sponsorId !== user.id || escrow.status !== "challenged") throw new PilotError(409, "This escrow is not waiting for challenge resolution.");
    escrow.status = transitionEscrow(escrow.status, releaseToOperator ? "released" : "refunded");
    escrow.settlementTxHash = input.txHash;
    escrow.updatedAt = new Date().toISOString();
    audit(state, user, escrow.taskId, releaseToOperator ? "escrow.challenge-resolved-release" : "escrow.challenge-resolved-refund", `Challenge resolution transaction ${input.txHash} recorded.`);
    return escrow;
  });
}

export async function reconcileEscrowEvent(value: unknown): Promise<{ duplicate: boolean; event: EscrowEventRecord; escrow?: EscrowRecord }> {
  const input = escrowEventInput(value);
  return getPilotStore().mutate(state => {
    const key = `${input.chainId}:${input.contractAddress}:${input.txHash}:${input.logIndex}`;
    const existing = state.escrowEvents.find(event => `${event.chainId}:${event.contractAddress}:${event.txHash}:${event.logIndex}` === key);
    if (existing) return { duplicate: true, event: existing, escrow: state.escrows.find(escrow => escrow.contractAddress.toLowerCase() === input.contractAddress.toLowerCase() && escrow.onchainEscrowId === input.payload.escrowId) };
    const event: EscrowEventRecord = { ...input, observedAt: new Date().toISOString() };
    state.escrowEvents.push(event);
    const escrow = state.escrows.find(item => item.contractAddress.toLowerCase() === input.contractAddress.toLowerCase() && item.onchainEscrowId === input.payload.escrowId);
    if (!escrow) return { duplicate: false, event };
    const target: Record<string, EscrowStatus> = { EscrowFunded: "funded", ReleaseRequested: "release-pending", ChallengeOpened: "challenged", EscrowReleased: "released", EscrowRefunded: "refunded", EscrowCancelled: "cancelled" };
    const next = target[input.eventName];
    if (next && escrow.status !== next && !["released", "refunded", "cancelled"].includes(escrow.status)) {
      try { escrow.status = transitionEscrow(escrow.status, next); } catch { /* stale or out-of-order logs remain recorded for operator review */ }
      escrow.updatedAt = event.observedAt;
      escrow.lastEventBlock = input.blockNumber;
      if (input.eventName === "ReleaseRequested" && input.payload.challengeEndsAt) escrow.challengeEndsAt = new Date(Number(input.payload.challengeEndsAt) * 1000).toISOString();
      if (input.eventName === "EscrowReleased" || input.eventName === "EscrowRefunded" || input.eventName === "EscrowCancelled") escrow.settlementTxHash = input.txHash;
    }
    return { duplicate: false, event, escrow };
  });
}
