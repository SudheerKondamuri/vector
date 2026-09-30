import { describe, expect, it } from "vitest";
import { buildPolicyHash, buildTaskHash, canRequestSettlement, transitionEscrow } from "../../lib/settlement-domain";
import type { PilotTask, PilotSubmission } from "../../lib/pilot-types";

const task = { id: "task-0001", title: "Task", description: "A bounded task", fixture: "external", repoUrl: "https://example.com/repo", baseCommit: "a".repeat(40), target: "Target.run", scopePaths: ["src/Target.sol"], constraints: "Preserve ABI", minImprovementPct: 10, deadline: new Date(Date.now() + 86_400_000).toISOString(), maxSubmissions: 5, priceUsd: 100, operatorRewardUsd: 50, paymentTerms: "terms", reviewTerms: "review", inviteEmails: [], ownerId: "owner-0001", ownerName: "Owner", status: "accepted", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), manifestHash: "a".repeat(64), acceptedSubmissionId: "submission-0001", ledger: {} } as unknown as PilotTask;
const submission = { id: "submission-0001", taskId: task.id, operatorId: "operator-0001", operatorName: "Operator", patch: "patch", baseCommit: task.baseCommit, method: "method", computeUsd: 1, effortMinutes: 2, artifactHash: "b".repeat(64), status: "accepted", createdAt: task.createdAt, updatedAt: task.updatedAt, review: { decision: "accept", reason: "accepted", reviewerName: "Owner", at: new Date().toISOString(), minutes: 1 } } as PilotSubmission;

describe("settlement domain", () => {
  it("derives stable task and policy hashes from immutable terms", () => {
    expect(buildTaskHash(task)).toMatch(/^0x[a-f0-9]{64}$/);
    expect(buildTaskHash(task)).toBe(buildTaskHash({ ...task }));
    expect(buildPolicyHash(task)).toMatch(/^0x[a-f0-9]{64}$/);
    expect(buildPolicyHash(task)).not.toBe(buildPolicyHash({ ...task, reviewTerms: "changed" }));
  });

  it("requires an accepted, unchallenged submission before funding or release", () => {
    expect(canRequestSettlement(task, submission, false)).toBe(true);
    expect(canRequestSettlement({ ...task, status: "review" }, submission, false)).toBe(false);
    expect(canRequestSettlement(task, { ...submission, status: "rejected" }, false)).toBe(false);
    expect(canRequestSettlement(task, submission, true)).toBe(false);
  });

  it("allows only monotonic escrow state transitions", () => {
    expect(transitionEscrow("intent", "funded")).toBe("funded");
    expect(transitionEscrow("funded", "release-pending")).toBe("release-pending");
    expect(transitionEscrow("release-pending", "released")).toBe("released");
    expect(() => transitionEscrow("released", "funded")).toThrow();
    expect(transitionEscrow("funded", "refunded")).toBe("refunded");
  });
});
