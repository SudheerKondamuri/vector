import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getReferenceBundle, runReferenceVerification } from "../../lib/pilot-verifier/index";
import { REFERENCE_COMMIT, REFERENCE_PATH, type PilotSubmission, type PilotTask } from "../../lib/pilot-types";

function task(minImprovementPct = 10): PilotTask {
  return {
    id: "reference-task", ownerId: "owner", ownerName: "Owner", status: "open", fixture: "reference",
    title: "Reference", description: "Optimize the bounded pure sum", repoUrl: "", baseCommit: REFERENCE_COMMIT,
    target: "GasTarget.sum(uint256)", scopePaths: [REFERENCE_PATH], constraints: "Preserve ABI and behavior",
    minImprovementPct, deadline: "2026-12-01T00:00:00.000Z", maxSubmissions: 5, priceUsd: 0,
    operatorRewardUsd: 0, paymentTerms: "Reference exercise", reviewTerms: "Review evidence", inviteEmails: [],
    createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", ledger: {} as PilotTask["ledger"]
  };
}

function submission(patch = getReferenceBundle().patch): PilotSubmission {
  return {
    id: "reference-submission", taskId: "reference-task", operatorId: "operator", operatorName: "Operator",
    status: "received", patch, artifactHash: createHash("sha256").update(patch).digest("hex"), baseCommit: REFERENCE_COMMIT,
    method: "Unchecked bounded sum loop", computeUsd: 0, effortMinutes: 5,
    createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z"
  };
}

describe("real bounded Solidity reference execution", () => {
  it("compiles, deploys and measures the optimized patch in a bounded child process", async () => {
    const evidence = await runReferenceVerification(task(), submission());
    expect(evidence.outcome).toBe("passed");
    expect(evidence.source).toBe("reference-run");
    expect(evidence.checks.every((check) => check.passed)).toBe(true);
    expect(evidence.engine).toMatch(/EthereumJS.*10\.1\.3/);
    expect(evidence.environment).toMatch(/solc.*0\.8\.30/);
    expect(evidence.environment).toContain("shanghai");
    expect(evidence.logs.join(" ")).toMatch(/baselineSourceSha256/);
    expect(evidence.logs.join(" ")).toMatch(/candidateSourceSha256/);
    expect(evidence.metrics.find((metric) => metric.name === "sum(1000)")?.baseline).toBeGreaterThan(10_000);
    expect(evidence.metrics.find((metric) => metric.name === "sum(1000)")?.candidate).toBeLessThan(
      evidence.metrics.find((metric) => metric.name === "sum(1000)")!.baseline
    );
    expect(evidence.metrics.find((metric) => metric.name === "Aggregate fixed calls")?.improvementPct).toBeGreaterThan(10);
    expect(evidence.checks.some((check) => /sum\(1001\)/.test(check.name))).toBe(true);
    expect(evidence.checks.some((check) => /empty calldata/.test(check.name))).toBe(true);
    expect(evidence.elapsedMs).toBeGreaterThan(0);
    expect(evidence.replayCommand).toContain("node scripts/reference-verify.mjs");
    expect(evidence.limitations.join(" ")).toMatch(/not.*hostile.code sandbox/i);
  }, 40_000);

  it("rejects a compilable but functionally wrong faster loop", async () => {
    const patch = getReferenceBundle().patch.replace("+                total += i;", "+                total += 1;");
    const evidence = await runReferenceVerification(task(), submission(patch));
    expect(evidence.outcome).toBe("failed");
    expect(evidence.checks.some((check) => !check.passed && /behavior/i.test(check.name))).toBe(true);
    expect(evidence.checks.find((check) => check.name === "Measured reference result eligibility")?.passed).toBe(false);
  }, 40_000);

  it("fails an improvement below the specified threshold", async () => {
    const evidence = await runReferenceVerification(task(90), submission());
    expect(evidence.outcome).toBe("failed");
    expect(evidence.checks.find((check) => check.name === "Aggregate improvement threshold")?.passed).toBe(false);
  }, 40_000);

  it("fails a valid but gas-identical comment edit even at a zero threshold", async () => {
    const patch = `--- a/${REFERENCE_PATH}\n+++ b/${REFERENCE_PATH}\n@@ -8 +8 @@\n-            total += i;\n+            total += i; // no actual gas improvement\n`;
    const evidence = await runReferenceVerification(task(0), submission(patch));
    expect(evidence.outcome).toBe("failed");
    expect(evidence.metrics.find((metric) => metric.name === "Aggregate fixed calls")?.improvementPct).toBe(0);
    expect(evidence.checks.find((check) => check.name === "Aggregate improvement threshold")?.passed).toBe(false);
  }, 40_000);

  it("fails a syntax-invalid body without claiming a benchmark", async () => {
    const patch = getReferenceBundle().patch.replace("+                total += i;", "+                total += ;");
    const evidence = await runReferenceVerification(task(), submission(patch));
    expect(evidence.outcome).toBe("failed");
    expect(evidence.checks.find((check) => /candidate compilation/i.test(check.name))?.passed).toBe(false);
    expect(evidence.metrics).toEqual([]);
  }, 40_000);

  it("rejects a pure precompile call rather than treating the loop scope as permission for external calls", async () => {
    const patch = getReferenceBundle().patch
      .replace("@@ -4,8 +4,11 @@", "@@ -4,8 +4,14 @@")
      .replace("+        for (uint256 i = 0; i < n; ) {", "+        if (n == 777) {\n+            total = uint256(uint160(ecrecover(bytes32(0), 0, bytes32(0), bytes32(0))));\n+        }\n+        for (uint256 i = 0; i < n; ) {");
    const evidence = await runReferenceVerification(task(), submission(patch));
    expect(evidence.outcome).toBe("failed");
    expect(evidence.checks.find((check) => check.name === "No external calls or mutable state")?.passed).toBe(false);
    expect(evidence.metrics).toEqual([]);
  }, 40_000);

  it.each(["external", "commit", "artifact", "scope", "taskId", "threshold"])("fails ineligible %s input before executing", async (caseName) => {
    const request = task();
    const artifact = submission();
    if (caseName === "external") request.fixture = "external";
    if (caseName === "commit") artifact.baseCommit = "a".repeat(40);
    if (caseName === "artifact") artifact.artifactHash = "0".repeat(64);
    if (caseName === "scope") request.scopePaths = ["src/"];
    if (caseName === "taskId") artifact.taskId = "other-task";
    if (caseName === "threshold") request.minImprovementPct = NaN;
    const evidence = await runReferenceVerification(request, artifact);
    expect(evidence.outcome).toBe("failed");
    expect(evidence.metrics).toEqual([]);
    expect(evidence.engine).toMatch(/not executed/i);
    expect(evidence.checks.some((check) => !check.passed)).toBe(true);
  });
});
