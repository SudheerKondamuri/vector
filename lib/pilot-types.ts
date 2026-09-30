/** Shared contract for the persistent, single-server Vector pilot application. */
export type PilotUser = { id: string; name: string; email: string; createdAt: string; emailVerified?: boolean };
export type TaskStatus = "draft" | "open" | "review" | "accepted" | "archived";
export type SubmissionStatus = "received" | "verified" | "failed" | "recorded" | "accepted" | "rejected";
export type PaymentStatus = "unpaid" | "invoiced" | "paid";
export type ProfileAvailability = "available" | "paused" | "hidden";
export type EscrowStatus = "intent" | "funded" | "release-pending" | "challenged" | "released" | "refunded" | "cancelled";

export interface EscrowRecord {
  id: string;
  taskId: string;
  submissionId: string;
  sponsorId: string;
  operatorId: string;
  sponsorAddress: string;
  operatorAddress: string;
  tokenAddress: string;
  contractAddress: string;
  amountAtomic: string;
  chainId: number;
  taskHash: string;
  policyHash: string;
  challengePeriodSeconds: number;
  status: EscrowStatus;
  onchainEscrowId?: string;
  fundingTxHash?: string;
  releaseTxHash?: string;
  challengeTxHash?: string;
  settlementTxHash?: string;
  challengeEndsAt?: string;
  lastEventBlock?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowEventRecord {
  chainId: number;
  contractAddress: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  eventName: string;
  payload: Record<string, string>;
  observedAt: string;
}

export interface MarketplaceProfile {
  userId: string;
  handle: string;
  bio: string;
  capabilities: string[];
  adapterVersions: Record<string, string>;
  availability: ProfileAvailability;
  completedCount: number;
  acceptedCount: number;
  challengedCount: number;
  challengeFailures: number;
  createdAt: string;
  updatedAt: string;
}

export type ChallengeStatus = "open" | "resolved";
export type ChallengeResolution = "uphold" | "dismiss";
export interface ReviewChallenge {
  id: string;
  taskId: string;
  submissionId: string;
  challengerId: string;
  challengerName: string;
  reason: string;
  openedAt: string;
  expiresAt: string;
  status: ChallengeStatus;
  resolution?: ChallengeResolution;
  resolutionReason?: string;
  resolverId?: string;
  resolverName?: string;
  resolvedAt?: string;
}

export interface PilotLedger {
  serviceRevenueUsd: number;
  operatorPaidUsd: number;
  computeUsd: number;
  supportUsd: number;
  paymentFeesUsd: number;
  platformMinutes: number;
  platformHourlyUsd: number;
  operatorComputeUsd: number;
  operatorMinutes: number;
  operatorHourlyUsd: number;
  baselineMinutes: number;
  setupMinutes: number;
  reviewMinutes: number;
  reworkMinutes: number;
  paymentStatus: PaymentStatus;
  paymentReference: string;
}

export interface PilotTaskInput {
  title: string;
  description: string;
  fixture: "reference" | "external";
  repoUrl: string;
  baseCommit: string;
  target: string;
  scopePaths: string[];
  constraints: string;
  minImprovementPct: number;
  deadline: string;
  maxSubmissions: number;
  priceUsd: number;
  operatorRewardUsd: number;
  paymentTerms: string;
  reviewTerms: string;
  inviteEmails: string[];
}

export interface PilotTask extends PilotTaskInput {
  id: string;
  ownerId: string;
  ownerName: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  manifestHash?: string;
  acceptedSubmissionId?: string;
  ledger: PilotLedger;
}

export interface EvidenceCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface GasMetric {
  name: string;
  baseline: number;
  candidate: number;
  improvementPct: number;
}

export interface PilotEvidence {
  id: string;
  source: "reference-run" | "external-report" | "worker-run";
  outcome: "passed" | "failed" | "recorded";
  engine: string;
  environment: string;
  generatedAt: string;
  artifactHash: string;
  checks: EvidenceCheck[];
  metrics: GasMetric[];
  logs: string[];
  limitations: string[];
  replayCommand: string;
  elapsedMs: number;
}

export type VerificationJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface VerificationJob {
  id: string;
  taskId: string;
  submissionId: string;
  status: VerificationJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedBy?: string;
  lockedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface SubmissionInput {
  patch: string;
  baseCommit: string;
  method: string;
  computeUsd: number;
  effortMinutes: number;
}

export interface PilotSubmission extends SubmissionInput {
  id: string;
  taskId: string;
  operatorId: string;
  operatorName: string;
  artifactHash: string;
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
  evidence?: PilotEvidence;
  review?: { decision: "accept" | "reject"; reason: string; reviewerName: string; at: string; minutes: number; supersededByChallenge?: boolean };
}

export interface PilotEvent {
  id: string;
  taskId: string;
  actorName: string;
  type: string;
  message: string;
  at: string;
}

export interface PilotTaskDetail {
  task: PilotTask;
  submissions: PilotSubmission[];
  events: PilotEvent[];
  challenges: ReviewChallenge[];
  escrows: EscrowRecord[];
}

export interface ExternalReportInput {
  environment: string;
  checks: EvidenceCheck[];
  metrics: { name: string; baseline: number; candidate: number }[];
  logs: string[];
  replayCommand: string;
  limitations: string[];
}

export interface PilotSession { user: PilotUser | null }
export interface PilotList { tasks: PilotTask[]; events: PilotEvent[] }
export interface PilotApiError { error: string; fields?: Record<string, string> }

export const REFERENCE_COMMIT = "1111111111111111111111111111111111111111";
export const REFERENCE_PATH = "src/GasTarget.sol";
