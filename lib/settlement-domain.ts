import { createHash } from "node:crypto";
import type { PilotSubmission, PilotTask } from "./pilot-types.ts";

export type EscrowStatus = "intent" | "funded" | "release-pending" | "challenged" | "released" | "refunded" | "cancelled";
export const ESCROW_CHALLENGE_PERIOD_SECONDS = 48 * 60 * 60;

function hash(value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function buildTaskHash(task: PilotTask): `0x${string}` {
  return hash({ manifestHash: task.manifestHash, taskId: task.id, baseCommit: task.baseCommit, scopePaths: task.scopePaths, target: task.target });
}

export function buildPolicyHash(task: PilotTask): `0x${string}` {
  return hash({ reviewTerms: task.reviewTerms, paymentTerms: task.paymentTerms, minImprovementPct: task.minImprovementPct, challengePeriodSeconds: ESCROW_CHALLENGE_PERIOD_SECONDS });
}

export function canRequestSettlement(task: PilotTask, submission: PilotSubmission, challengeOpen: boolean): boolean {
  return task.status === "accepted" && task.acceptedSubmissionId === submission.id && submission.status === "accepted" && submission.review?.decision === "accept" && !submission.review.supersededByChallenge && !challengeOpen;
}

const transitions: Record<EscrowStatus, EscrowStatus[]> = {
  intent: ["funded", "cancelled"],
  funded: ["release-pending", "refunded", "cancelled"],
  "release-pending": ["challenged", "released"],
  challenged: ["released", "refunded"],
  released: [],
  refunded: [],
  cancelled: [],
};

export function transitionEscrow(current: EscrowStatus, next: EscrowStatus): EscrowStatus {
  if (!transitions[current].includes(next)) throw new Error(`Invalid escrow transition ${current} -> ${next}`);
  return next;
}
