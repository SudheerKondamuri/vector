import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getReferenceBundle, recordExternalEvidence, validatePatch } from "../../lib/pilot-verifier/index";
import { REFERENCE_COMMIT, REFERENCE_PATH, type ExternalReportInput, type PilotSubmission } from "../../lib/pilot-types";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const patchAt = (path: string) => `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-contract Before {}\n+contract After {}\n`;
const submission = (patch = patchAt("src/Vault.sol")): PilotSubmission => ({
  id: "submission-1", taskId: "task-1", operatorId: "operator-1", operatorName: "Operator",
  patch, artifactHash: hash(patch), baseCommit: "a".repeat(40), method: "Manual optimization",
  computeUsd: 0, effortMinutes: 10, status: "received", createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z"
});
const report = (): ExternalReportInput => ({
  environment: "Foundry v1.0.0; solc 0.8.30; local report supplied by operator",
  checks: [{ name: "Existing tests", passed: true, detail: "12 existing tests passed in the supplied run" }],
  metrics: [{ name: "sum(100)", baseline: 1000, candidate: 800 }],
  logs: ["forge test: 12 passed"], replayCommand: "forge test --gas-report",
  limitations: ["Operator-supplied report; repository was not independently executed here."]
});

describe("strict unified patch artifacts", () => {
  it("accepts the bundled real patch and returns its sole changed path", () => {
    const bundle = getReferenceBundle();
    expect(bundle.commit).toBe(REFERENCE_COMMIT);
    expect(bundle.path).toBe(REFERENCE_PATH);
    expect(bundle.source).toContain("require(n <= 1000");
    expect(validatePatch(bundle.patch, [REFERENCE_PATH])).toEqual([REFERENCE_PATH]);
  });

  it("allows a normal single-file source patch within a declared directory", () => {
    expect(validatePatch(patchAt("src/Vault.sol"), ["src/"])).toEqual(["src/Vault.sol"]);
  });

  it.each([
    "../src/Vault.sol", "/src/Vault.sol", "src/../Vault.sol", "src//Vault.sol",
    "C:/Vault.sol", "src\\Vault.sol", "src/%2e%2e/Vault.sol", "src/./Vault.sol",
    "tests/Vault.sol", "test/Vault.sol", "src/Vault.t.sol", "src/Vault.test.sol",
    "node_modules/Vault.sol", "scripts/Vault.sol", ".env", "foundry.toml", "hardhat.config.ts"
  ])("rejects unsafe or protected path %s even if explicitly scoped", (path) => {
    expect(() => validatePatch(patchAt(path), [path])).toThrow();
  });

  it("does not confuse a directory prefix with a similarly named directory", () => {
    expect(() => validatePatch(patchAt("src2/Vault.sol"), ["src/"])).toThrow();
  });

  it("rejects patches outside scope or with invalid scopes", () => {
    expect(() => validatePatch(patchAt("src/Vault.sol"), ["src/Other.sol"])).toThrow();
    expect(() => validatePatch(patchAt("src/Vault.sol"), [])).toThrow();
    expect(() => validatePatch(patchAt("src/Vault.sol"), ["../"])).toThrow();
  });

  it.each([
    "", "not a diff", patchAt("src/Vault.sol").replace("@@ -1 +1 @@", "@@ -1,2 +1,1 @@"),
    patchAt("src/Vault.sol").replace("+++ b/src/Vault.sol", "+++ b/src/Other.sol"),
    patchAt("src/Vault.sol") + patchAt("src/Other.sol"),
    "diff --git a/src/Vault.sol b/src/Vault.sol\nrename from src/Vault.sol\nrename to src/Other.sol\n",
    "GIT binary patch\nliteral 9\n", patchAt("src/Vault.sol").replace("+++ b/src/Vault.sol", "+++ /dev/null"),
    patchAt("src/Vault.sol") + "index 123..456 100644\n",
    patchAt("src/Vault.sol").replace("--- a/src/Vault.sol", "--- a/src/Vault.sol\t2026-10-05"),
    "--- a/src/Vault.sol\n+++ b/src/Vault.sol\n@@ -1 +1 @@\n contract Before {}\n",
    patchAt("src/Vault.sol").replace("@@ -1 +1 @@", "@@ -999999999999999999999 +1 @@")
  ])("rejects malformed, metadata, deletion, binary or multi-file artifacts", (patch) => {
    expect(() => validatePatch(patch, ["src/"])).toThrow();
  });

  it("checks reference hunks against the immutable baseline", () => {
    const bundle = getReferenceBundle();
    expect(() => validatePatch(bundle.patch.replace("total += i;", "total += 7;"), [REFERENCE_PATH])).toThrow();
  });

  it("accepts ordered matching hunks and standard zero-count insertion coordinates", () => {
    const edits = `--- a/${REFERENCE_PATH}\n+++ b/${REFERENCE_PATH}\n@@ -7 +7 @@\n-        for (uint256 i = 0; i < n; i++) {\n+        for (uint256 i = 0; i < n; i++) { // first edit\n@@ -8 +8 @@\n-            total += i;\n+            total += i; // second edit\n`;
    expect(validatePatch(edits, [REFERENCE_PATH])).toEqual([REFERENCE_PATH]);
    const insertion = `--- a/${REFERENCE_PATH}\n+++ b/${REFERENCE_PATH}\n@@ -7,0 +8,1 @@\n+            // inserted within the loop\n`;
    expect(validatePatch(insertion, [REFERENCE_PATH])).toEqual([REFERENCE_PATH]);
  });

  it.each([
    `@@ -6 +6 @@\n-        require(n <= 1000, "n too large");\n+        require(n < 1001, "n too large");\n`,
    `@@ -5 +5 @@\n-    function sum(uint256 n) external pure returns (uint256 total) {\n+    function sum(uint256 n) external view returns (uint256 total) {\n`,
    `@@ -500 +500 @@\n-        total += i;\n+        total += 1;\n`
  ])("rejects immutable guard/interface edits and out-of-file hunks", (hunk) => {
    expect(() => validatePatch(`--- a/${REFERENCE_PATH}\n+++ b/${REFERENCE_PATH}\n${hunk}`, [REFERENCE_PATH])).toThrow();
  });

  it("accepts only the canonical git index metadata", () => {
    const patch = `diff --git a/src/Vault.sol b/src/Vault.sol\nindex aaaaaaa..bbbbbbb 100644\n${patchAt("src/Vault.sol")}`;
    expect(validatePatch(patch, ["src/"])).toEqual(["src/Vault.sol"]);
    expect(() => validatePatch(patch.replace("100644", "100755"), ["src/"])).toThrow();
  });

  it("caps artifact bytes, including multibyte input", () => {
    expect(() => validatePatch("x".repeat(100 * 1024 + 1), [REFERENCE_PATH])).toThrow();
    expect(() => validatePatch("é".repeat(60000), [REFERENCE_PATH])).toThrow();
  });
});

describe("operator-supplied external evidence", () => {
  it("records, hashes and recalculates evidence without claiming execution or passing", () => {
    const input = report();
    input.metrics[0] = { ...input.metrics[0], improvementPct: 99 } as typeof input.metrics[number];
    const artifact = submission();
    const evidence = recordExternalEvidence(artifact, input);
    expect(evidence.source).toBe("external-report");
    expect(evidence.outcome).toBe("recorded");
    expect(evidence.artifactHash).toBe(hash(artifact.patch));
    expect(evidence.metrics[0].improvementPct).toBe(20);
    expect(evidence.engine).toMatch(/supplied|external/i);
    expect(evidence.limitations.join(" ")).toMatch(/not.*(run|execut|independent)/i);
    expect(evidence.elapsedMs).toBe(0);
  });

  it("preserves failed checks and honest negative improvement", () => {
    const input = report();
    input.checks[0].passed = false;
    input.metrics[0].candidate = 1200;
    const evidence = recordExternalEvidence(submission(), input);
    expect(evidence.outcome).toBe("recorded");
    expect(evidence.checks[0].passed).toBe(false);
    expect(evidence.metrics[0].improvementPct).toBe(-20);
  });

  it("does not invent a percentage for a zero baseline", () => {
    const input = report();
    input.metrics[0] = { name: "zero", baseline: 0, candidate: 5 };
    const evidence = recordExternalEvidence(submission(), input);
    expect(evidence.metrics[0].improvementPct).toBe(0);
    expect(evidence.limitations.join(" ")).toMatch(/zero baseline/i);
  });

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid gas %s", (value) => {
    const input = report();
    input.metrics[0].candidate = value;
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
    input.metrics[0].candidate = 800;
    input.metrics[0].baseline = value;
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
  });

  it.each(["environment", "replayCommand", "checks", "metrics", "logs", "limitations"] as const)("requires nonempty %s", (key) => {
    const input = report();
    if (key === "environment" || key === "replayCommand") input[key] = "   ";
    else (input[key] as unknown[]) = [];
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
  });

  it("requires real check booleans and nonempty evidence details", () => {
    const input = report();
    input.checks[0].passed = "true" as unknown as boolean;
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
    input.checks[0].passed = true;
    input.checks[0].detail = "";
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
  });

  it("rejects finite inputs whose recalculated percentage would overflow", () => {
    const input = report();
    input.metrics[0] = { name: "unrepresentable ratio", baseline: Number.MIN_VALUE, candidate: Number.MAX_SAFE_INTEGER };
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
  });

  it("rejects oversized or unsafe report text", () => {
    const input = report();
    input.logs = ["x".repeat(100 * 1024)];
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
    input.logs = ["\u001b[31munsafe terminal escape"];
    expect(() => recordExternalEvidence(submission(), input)).toThrow();
  });

  it("rejects submission artifact tampering", () => {
    const artifact = submission();
    artifact.artifactHash = "0".repeat(64);
    expect(() => recordExternalEvidence(artifact, report())).toThrow();
  });

  it("takes a defensive copy of report arrays", () => {
    const input = report();
    const evidence = recordExternalEvidence(submission(), input);
    input.checks[0].passed = false;
    input.logs[0] = "mutated";
    expect(evidence.checks[0].passed).toBe(true);
    expect(evidence.logs[0]).toBe("forge test: 12 passed");
  });
});
