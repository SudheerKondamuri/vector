import type { PilotSubmission, PilotTask } from "./pilot-types";

/** One acceptance gate shared by the API and browser. Review is still a human decision. */
export function canAcceptSubmission(task: PilotTask, submission: PilotSubmission): boolean {
  const evidence = submission.evidence;
  if (!evidence || evidence.artifactHash !== submission.artifactHash || !evidence.checks.length
    || !evidence.checks.every(check => check.passed) || !evidence.metrics.length) return false;
  const validSource = task.fixture === "reference"
    ? submission.status === "verified" && evidence.source === "reference-run" && evidence.outcome === "passed"
    : (submission.status === "recorded" && evidence.source === "external-report" && evidence.outcome === "recorded")
      || (submission.status === "verified" && evidence.source === "worker-run" && evidence.outcome === "passed");
  if (!validSource || !evidence.metrics.every(metric => Number.isFinite(metric.baseline) && metric.baseline > 0
    && Number.isFinite(metric.candidate) && metric.candidate >= 0 && metric.candidate <= metric.baseline)) return false;
  // Reference revert/empty calls may remain unchanged. Its frozen scoring rule is the aggregate.
  const scored = evidence.source === "reference-run"
    ? evidence.metrics.filter(metric => metric.name === "Aggregate fixed calls") : evidence.metrics;
  return scored.length > 0 && scored.every(metric => (metric.baseline - metric.candidate) / metric.baseline * 100 + 1e-9 >= task.minImprovementPct);
}
