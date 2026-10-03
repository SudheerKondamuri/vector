import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { REFERENCE_COMMIT, REFERENCE_PATH, type EvidenceCheck, type GasMetric, type PilotEvidence, type PilotSubmission, type PilotTask } from "../pilot-types.ts";
import { checkedArtifactHash, improvementPct } from "./evidence.ts";
import { validatePatch } from "./patch.ts";
import { MAX_PATCH_BYTES, projectPath, REFERENCE_SOURCE_SHA256, sha256 } from "./reference.ts";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 128 * 1024;
let activeWorker = false;
const LIMITATIONS = [
  "Controlled bundled reference verifier: not a hostile-code sandbox or security audit; do not expose it as arbitrary public code execution.",
  "Only the pinned built-in GasTarget sum loop is locally runnable. No repository fetching, imports, shell scripts, git apply or network installations are executed.",
  "Finite fixed arithmetic and revert cases do not prove correctness for arbitrary code. Sponsor review remains required.",
  "Gas is actual Shanghai EVM message execution gas; calls exclude transaction intrinsic/calldata gas and fees. Deployment code-deposit gas is shown separately.",
  "The 111… reference commit is a synthetic fixture label, not a fetched Git commit. Baseline SHA256 is pinned and recorded independently.",
  "Child process has a 30-second deadline, 512MiB Node heap limit, capped stdin/stdout/stderr and a minimal environment. This is not OS-level CPU, RSS or filesystem isolation."
];

type WorkerProof = { engine: string; environment: string; artifactHash: string; baselineSourceSha256: string; checks: EvidenceCheck[]; metrics: GasMetric[]; logs: string[] };

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Reference verification failed").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000);
}

async function runWorker(patch: string, artifactHash: string, minImprovementPct: number): Promise<unknown> {
  if (activeWorker) throw new Error("The single reference worker is busy; retry explicitly after the current run completes");
  activeWorker = true;
  try {
    return await new Promise((resolve, reject) => {
      // Fixed executable and script; input is data on stdin. No shell or inherited environment.
      const child = spawn(process.execPath, ["--max-old-space-size=512", "--disable-proto=throw", "--no-warnings", projectPath("scripts", "reference-worker.mjs")], {
        cwd: projectPath(), env: { NODE_ENV: "production", LANG: "C", LC_ALL: "C", TZ: "UTC" },
        shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let failure: Error | undefined;
      const stop = (message: string) => { failure ??= new Error(message); child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop("Reference worker exceeded its 30-second timeout"), TIMEOUT_MS);
      const capture = (chunk: Buffer, stdout: boolean) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) { stop("Reference worker exceeded its 128KiB combined output cap"); return; }
        if (stdout) chunks.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
      child.stdin.on("error", () => { /* A terminated or failed child may close stdin; close/error establishes the result. */ });
      child.on("error", (error) => { clearTimeout(timer); reject(new Error(`Reference worker could not start: ${safeError(error)}`)); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (failure) { reject(failure); return; }
        if (code !== 0) { reject(new Error(`Reference worker exited without valid evidence (${signal ?? code ?? "unknown"})`)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("Reference worker did not return valid bounded JSON evidence")); }
      });
      child.stdin.end(JSON.stringify({ patch, artifactHash, minImprovementPct, commit: REFERENCE_COMMIT }));
    });
  } finally { activeWorker = false; }
}

function proofText(value: unknown, maximum = 2000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
}

function parseProof(value: unknown, hash: string): WorkerProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reference evidence envelope");
  const proof = value as Record<string, unknown>;
  if (proof.protocolVersion !== 1 || proof.artifactHash !== hash || proof.baselineSourceSha256 !== REFERENCE_SOURCE_SHA256
    || !proofText(proof.engine, 1000) || !proofText(proof.environment, 4000)
    || !Array.isArray(proof.checks) || !proof.checks.length || proof.checks.length > 80
    || !Array.isArray(proof.metrics) || proof.metrics.length > 20
    || !Array.isArray(proof.logs) || !proof.logs.length || proof.logs.length > 60) {
    throw new Error("Reference worker evidence failed schema or immutable hash validation");
  }
  const checks = proof.checks.map((entry: unknown): EvidenceCheck => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid worker check");
    const check = entry as EvidenceCheck;
    if (!proofText(check.name, 160) || !proofText(check.detail) || typeof check.passed !== "boolean") throw new Error("Invalid worker check evidence");
    return { name: check.name, passed: check.passed, detail: check.detail };
  });
  const names = new Set<string>();
  const metrics = proof.metrics.map((entry: unknown): GasMetric => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid worker metric");
    const metric = entry as GasMetric;
    if (!proofText(metric.name, 160) || names.has(metric.name)
      || !Number.isSafeInteger(metric.baseline) || metric.baseline < 0
      || !Number.isSafeInteger(metric.candidate) || metric.candidate < 0) throw new Error("Invalid worker gas evidence");
    names.add(metric.name);
    return { name: metric.name, baseline: metric.baseline, candidate: metric.candidate, improvementPct: improvementPct(metric.baseline, metric.candidate) };
  });
  const logs = proof.logs.map((entry: unknown) => {
    if (!proofText(entry, 8000)) throw new Error("Invalid worker log entry");
    return entry;
  });
  return { engine: proof.engine, environment: proof.environment, artifactHash: hash, baselineSourceSha256: REFERENCE_SOURCE_SHA256, checks, metrics, logs };
}

/** A controlled reference check, not an API for running arbitrary Solidity projects. */
export async function runReferenceVerification(task: PilotTask, submission: PilotSubmission): Promise<PilotEvidence> {
  const started = performance.now();
  const checks: EvidenceCheck[] = [];
  const patch = submission.patch;
  const minImprovementPct = task.minImprovementPct;
  const artifactHash = typeof patch === "string" && Buffer.byteLength(patch, "utf8") <= MAX_PATCH_BYTES ? sha256(patch) : "";
  const evidence: PilotEvidence = {
    id: randomUUID(), source: "reference-run", outcome: "failed", engine: "Reference worker not executed",
    environment: `Controlled bundled fixture only; baseline SHA256 ${REFERENCE_SOURCE_SHA256}`,
    generatedAt: new Date().toISOString(), artifactHash, checks, metrics: [], logs: [], limitations: [...LIMITATIONS],
    replayCommand: "", elapsedMs: 0
  };
  const check = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  check("Reference fixture eligibility", task.fixture === "reference" && submission.taskId === task.id,
    "Local execution is restricted to the built-in reference fixture and a submission belonging to the requested task.");
  check("Immutable reference base label", task.baseCommit === REFERENCE_COMMIT && submission.baseCommit === REFERENCE_COMMIT,
    `Task and patch must use the bundled synthetic reference label ${REFERENCE_COMMIT}; source integrity is separately checked by SHA256.`);
  check("Immutable reference source scope", Array.isArray(task.scopePaths) && task.scopePaths.length === 1 && task.scopePaths[0] === REFERENCE_PATH,
    `The local reference scope must be exactly [${REFERENCE_PATH}].`);
  check("Finite improvement threshold", typeof minImprovementPct === "number" && Number.isFinite(minImprovementPct) && minImprovementPct >= 0 && minImprovementPct <= 100,
    "Threshold must be a finite percentage from 0 to 100; a strictly positive measured saving is always required.");
  try {
    checkedArtifactHash(submission);
    check("Submission artifact SHA256", true, `UTF-8 patch SHA256 ${artifactHash}; artifact bound 100KB.`);
  } catch (error) { check("Submission artifact SHA256", false, safeError(error)); }
  try {
    validatePatch(patch, task.scopePaths);
    check("Patch hunk and loop-only scope validation", true, "Unified hunks match the pinned fixture; immutable contract, pragma, pure interface and n <= 1000 guard are retained.");
  } catch (error) { check("Patch hunk and loop-only scope validation", false, safeError(error)); }
  if (checks.every((entry) => entry.passed)) {
    evidence.replayCommand = `node scripts/reference-verify.mjs --patch ./downloaded.patch --min-improvement ${minImprovementPct} --artifact-sha256 ${artifactHash}`;
    try {
      const proof = parseProof(await runWorker(patch, artifactHash, minImprovementPct), artifactHash);
      evidence.engine = proof.engine;
      evidence.environment = proof.environment;
      checks.push(...proof.checks);
      evidence.metrics = proof.metrics;
      evidence.logs = proof.logs;
      const aggregate = proof.metrics.find((metric) => metric.name === "Aggregate fixed calls");
      const samples = proof.metrics.filter((metric) => metric.name !== "Aggregate fixed calls" && !metric.name.startsWith("Deployment"));
      const eligible = Boolean(proof.checks.every((entry) => entry.passed)
        && aggregate && samples.length === 13 && aggregate.baseline > aggregate.candidate
        && aggregate.improvementPct >= minImprovementPct
        && aggregate.baseline === samples.reduce((sum, metric) => sum + metric.baseline, 0)
        && aggregate.candidate === samples.reduce((sum, metric) => sum + metric.candidate, 0)
        && proof.metrics.every((metric) => metric.candidate <= metric.baseline));
      check("Measured reference result eligibility", eligible, "Pass requires actual complete metrics, a correct aggregate, a positive threshold-qualified saving, no per-case regression and every behavioral/compiler check passing.");
      evidence.outcome = checks.every((entry) => entry.passed) ? "passed" : "failed";
    } catch (error) {
      evidence.engine = "Reference child process (no completed benchmark evidence)";
      check("Bounded reference worker completion", false, safeError(error));
      evidence.logs = [JSON.stringify({ event: "runner-failure", message: safeError(error) })];
    }
  } else evidence.logs = [JSON.stringify({ event: "reference-not-executed", failedChecks: checks.filter((entry) => !entry.passed).map((entry) => entry.name) })];
  evidence.elapsedMs = Math.round(performance.now() - started);
  return evidence;
}
