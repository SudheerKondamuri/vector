#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getReferenceBundle, runReferenceVerification } from "../lib/pilot-verifier/index.ts";
import { MAX_PATCH_BYTES, sha256 } from "../lib/pilot-verifier/reference.ts";
import { REFERENCE_COMMIT, REFERENCE_PATH } from "../lib/pilot-types.ts";

const help = `Controlled offline Solidity reference verifier (Node 25 required).
Usage: node scripts/reference-verify.mjs [--patch FILE.patch] [--min-improvement 10] [--artifact-sha256 HEX]
Defaults: bundled fixtures/reference/optimized.patch; 10% aggregate fixed-call gas improvement.
The fixed child worker has a 30s timeout, 512MiB Node heap and 128KiB combined output cap.
Only the pinned GasTarget sum loop is executable. No remote repositories or project scripts are loaded.
This controlled reference verifier is not a hostile-code sandbox or security audit.
Output: structured PilotEvidence JSON. Exit 0 for passed; exit 1 for failed; exit 2 for invalid CLI input.
For a downloaded submission save its exact artifact as ./downloaded.patch and use the evidence replayCommand.
`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") process.stdout.write(help);
  else {
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      if (!["--patch", "--min-improvement", "--artifact-sha256"].includes(key) || !args[index + 1] || options.has(key)) throw new Error("Invalid or duplicate option. Use --help.");
      options.set(key, args[index + 1]);
    }
    const thresholdText = options.get("--min-improvement") ?? "10";
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(thresholdText)) throw new Error("Minimum improvement must be a finite percentage from 0 to 100.");
    const minImprovementPct = Number(thresholdText);
    if (!Number.isFinite(minImprovementPct) || minImprovementPct > 100) throw new Error("Minimum improvement exceeds 100%.");
    const artifact = options.get("--patch");
    let patch;
    if (artifact) {
      const path = resolve(process.cwd(), artifact);
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > MAX_PATCH_BYTES) throw new Error("Patch must be a regular file of at most 100KB.");
      patch = readFileSync(path, "utf8");
    } else patch = getReferenceBundle().patch;
    const expectedHash = options.get("--artifact-sha256");
    if (expectedHash && !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("Expected artifact hash must be a lowercase SHA256.");
    const now = new Date().toISOString();
    const task = {
      id: "reference-cli-task", ownerId: "local-cli", ownerName: "Local CLI", status: "open", fixture: "reference",
      title: "Bundled reference verification", description: "Controlled pure bounded sum",
      repoUrl: "", baseCommit: REFERENCE_COMMIT, target: "GasTarget.sum(uint256)", scopePaths: [REFERENCE_PATH],
      constraints: "Retain pure ABI, input bound and arithmetic behavior", minImprovementPct,
      deadline: now, maxSubmissions: 1, priceUsd: 0, operatorRewardUsd: 0,
      paymentTerms: "No payment", reviewTerms: "Manual review required", inviteEmails: [], createdAt: now, updatedAt: now, ledger: {}
    };
    const submission = {
      id: "reference-cli-submission", taskId: task.id, operatorId: "local-cli", operatorName: "Local CLI",
      status: "received", patch, artifactHash: expectedHash ?? sha256(patch), baseCommit: REFERENCE_COMMIT,
      method: "CLI artifact replay", computeUsd: 0, effortMinutes: 0, createdAt: now, updatedAt: now
    };
    const evidence = await runReferenceVerification(task, submission);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = evidence.outcome === "passed" ? 0 : 1;
  }
} catch (error) {
  const message = (error instanceof Error ? error.message : "Invalid reference invocation").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 2;
}
