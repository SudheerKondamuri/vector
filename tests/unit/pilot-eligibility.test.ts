import { describe, expect, it } from "vitest";
import { canAcceptSubmission } from "../../lib/pilot-eligibility";
import type { PilotSubmission, PilotTask } from "../../lib/pilot-types";

const task = { fixture: "reference", minImprovementPct: 10 } as PilotTask;
const submission = {
  status: "verified", artifactHash: "a".repeat(64),
  evidence: {
    source: "reference-run", outcome: "passed", artifactHash: "a".repeat(64),
    checks: [{ name: "Behavior", passed: true, detail: "Measured" }],
    metrics: [
      { name: "sum(0)", baseline: 309, candidate: 309, improvementPct: 0 },
      { name: "Aggregate fixed calls", baseline: 267162, candidate: 121370, improvementPct: 54.57 },
    ],
  },
} as PilotSubmission;

describe("shared review eligibility", () => {
  it("allows unchanged boundary calls when the reference aggregate meets the threshold", () => {
    expect(canAcceptSubmission(task, submission)).toBe(true);
  });
  it("requires an aggregate, artifact binding, real reference evidence and all checks", () => {
    expect(canAcceptSubmission(task, { ...submission, evidence: { ...submission.evidence!, metrics: submission.evidence!.metrics.slice(0, 1) } })).toBe(false);
    expect(canAcceptSubmission(task, { ...submission, artifactHash: "wrong" })).toBe(false);
    expect(canAcceptSubmission(task, { ...submission, status: "received" })).toBe(false);
    expect(canAcceptSubmission(task, { ...submission, evidence: { ...submission.evidence!, checks: [{ name: "Fail", passed: false, detail: "Failure" }] } })).toBe(false);
    expect(canAcceptSubmission(task, { ...submission, evidence: undefined })).toBe(false);
  });
  it("rejects regressions, invalid measurements and an insufficient aggregate", () => {
    const evidence = submission.evidence!;
    for (const metric of [
      { name: "sum(0)", baseline: 309, candidate: 310, improvementPct: 100 },
      { name: "sum(0)", baseline: 0, candidate: 0, improvementPct: 100 },
      { name: "sum(0)", baseline: 309, candidate: -1, improvementPct: 100 },
      { name: "sum(0)", baseline: Infinity, candidate: 0, improvementPct: 100 },
    ]) expect(canAcceptSubmission(task, { ...submission, evidence: { ...evidence, metrics: [metric, evidence.metrics[1]] } })).toBe(false);
    expect(canAcceptSubmission({ ...task, minImprovementPct: 90 }, submission)).toBe(false);
  });
  it("allows manually reviewed external reports only for external tasks and every reported workload", () => {
    const external = { ...submission, status: "recorded", evidence: { ...submission.evidence!, source: "external-report", outcome: "recorded", metrics: [submission.evidence!.metrics[1]] } } as PilotSubmission;
    expect(canAcceptSubmission({ ...task, fixture: "external" }, external)).toBe(true);
    expect(canAcceptSubmission(task, external)).toBe(false);
    expect(canAcceptSubmission({ ...task, fixture: "external" }, submission)).toBe(false);
    expect(canAcceptSubmission({ ...task, fixture: "external" }, { ...external, evidence: { ...external.evidence!, metrics: submission.evidence!.metrics } })).toBe(false);
  });
});
