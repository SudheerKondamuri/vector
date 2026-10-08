import { describe, expect, it } from "vitest";
import { capabilityMatch, rankSubmissions, scoreSubmission } from "../../lib/marketplace";
import type { MarketplaceProfile, PilotSubmission, PilotTask } from "../../lib/pilot-types";

const task = { target: "GasTarget.sum", description: "Optimize Solidity EVM gas usage.", constraints: "Use Foundry and preserve ABI." } as PilotTask;
const profile = { capabilities: ["solidity", "evm-gas"], availability: "available" } as MarketplaceProfile;

function submission(id: string, candidate: number): PilotSubmission {
  return {
    id, taskId: "task-0001", operatorId: `operator-${id}`, operatorName: id, patch: "patch", baseCommit: "a".repeat(40), method: "method", computeUsd: 1, effortMinutes: 2,
    artifactHash: id.padEnd(64, "0"), status: "verified", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    evidence: { id: `evidence-${id}`, source: "worker-run", outcome: "passed", engine: "worker", environment: "test", generatedAt: new Date().toISOString(), artifactHash: id.padEnd(64, "0"), checks: [{ name: "behavior", passed: true, detail: "pass" }], metrics: [{ name: "Target", baseline: 100, candidate, improvementPct: (100 - candidate) }, { name: "Aggregate fixed calls", baseline: 100, candidate, improvementPct: (100 - candidate) }], logs: [], limitations: [], replayCommand: "test", elapsedMs: 1 },
  };
}

describe("marketplace ranking", () => {
  it("matches normalized capabilities and rejects paused profiles", () => {
    expect(capabilityMatch(task, profile).matched).toEqual(["solidity", "evm-gas"]);
    expect(capabilityMatch(task, { ...profile, availability: "paused" }).matched).toEqual([]);
  });

  it("scores objective evidence and ranks the strongest candidate first", () => {
    const fast = submission("fast", 40);
    const slow = submission("slow", 80);
    expect(scoreSubmission(task, fast)).toBeGreaterThan(scoreSubmission(task, slow));
    expect(rankSubmissions(task, [slow, fast]).map(item => item.id)).toEqual(["fast", "slow"]);
  });
});
