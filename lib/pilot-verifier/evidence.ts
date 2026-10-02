import { randomUUID } from "node:crypto";
import type { EvidenceCheck, ExternalReportInput, GasMetric, PilotEvidence, PilotSubmission } from "../pilot-types.ts";
import { MAX_PATCH_BYTES, sha256 } from "./reference.ts";

export function improvementPct(baseline: number, candidate: number): number {
  const percentage = baseline === 0 ? 0 : ((baseline - candidate) / baseline) * 100;
  if (!Number.isFinite(percentage)) throw new Error("Recalculated gas improvement percentage must be finite");
  return percentage;
}

export function checkedArtifactHash(submission: PilotSubmission): string {
  if (typeof submission.patch !== "string" || !submission.patch || Buffer.byteLength(submission.patch, "utf8") > MAX_PATCH_BYTES) {
    throw new Error("Submission requires a nonempty patch of at most 100KB");
  }
  const hash = sha256(submission.patch);
  if (!/^[a-f0-9]{64}$/.test(submission.artifactHash) || submission.artifactHash !== hash) {
    throw new Error("Submission artifact SHA256 does not match the patch");
  }
  return hash;
}

function text(value: unknown, label: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum
    || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be nonempty bounded text without control characters`);
  }
  return value.trim();
}

function list<T>(value: unknown, label: string, parse: (entry: unknown) => T, maximum = 50): T[] {
  if (!Array.isArray(value) || !value.length || value.length > maximum) throw new Error(`${label} requires 1–${maximum} entries`);
  return value.map(parse);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} requires an object`);
  return value as Record<string, unknown>;
}

function gas(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error("Gas must be a finite nonnegative safe number");
  }
  return value;
}

export function recordExternalEvidence(submission: PilotSubmission, report: ExternalReportInput): PilotEvidence {
  const artifactHash = checkedArtifactHash(submission);
  const input = object(report, "Report");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PATCH_BYTES) throw new Error("External report exceeds 100KB");
  const environment = text(input.environment, "Environment");
  const replayCommand = text(input.replayCommand, "Replay instructions", 1000);
  const checks = list<EvidenceCheck>(input.checks, "Checks", (entry) => {
    const check = object(entry, "Check");
    if (typeof check.passed !== "boolean") throw new Error("Check passed must be a real boolean");
    return { name: text(check.name, "Check name", 160), passed: check.passed, detail: text(check.detail, "Check evidence") };
  });
  const metrics = list<GasMetric>(input.metrics, "Metrics", (entry) => {
    const metric = object(entry, "Metric");
    const baseline = gas(metric.baseline);
    const candidate = gas(metric.candidate);
    return { name: text(metric.name, "Metric name", 160), baseline, candidate, improvementPct: improvementPct(baseline, candidate) };
  });
  const logs = list(input.logs, "Logs", (entry) => text(entry, "Log entry"));
  const limitations = list(input.limitations, "Limitations", (entry) => text(entry, "Limitation"), 20);
  limitations.push("External operator-supplied report: Vector has not independently executed the repository, replay command or checks.");
  if (metrics.some((metric) => metric.baseline === 0)) {
    limitations.push("A percentage is undefined for a zero baseline; its improvementPct is displayed as 0, not as a measured saving.");
  }
  return {
    id: randomUUID(), source: "external-report", outcome: "recorded", engine: "External operator-supplied report (not rerun)",
    environment, generatedAt: new Date().toISOString(), artifactHash, checks, metrics, logs, limitations, replayCommand, elapsedMs: 0
  };
}
