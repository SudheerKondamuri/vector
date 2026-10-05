"use client";

import { useState } from "react";
import { Download, Play, ShieldCheck } from "lucide-react";
import { pilotRequest, jsonBody } from "../../lib/pilot-client";
import { canAcceptSubmission } from "../../lib/pilot-eligibility";
import type { EvidenceCheck, ExternalReportInput, PilotSubmission, PilotTask, PilotUser } from "../../lib/pilot-types";
import type { TaskActionRunner } from "./task-detail";

const reportExample: ExternalReportInput = {
  environment: "Example only: Foundry version, solc version, optimizer runs, EVM target and OS",
  checks: [{ name: "Example behavior check", passed: true, detail: "Replace with the actual command, seed, exit status and observed result" }],
  metrics: [{ name: "Example workload (replace with measured gas)", baseline: 1200, candidate: 1080 }],
  logs: ["Replace with actual, shareable command output"],
  replayCommand: "Replace with the complete replay command against the pinned commit",
  limitations: ["State untested behavior, measurement uncertainty and any reproduction limits"],
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseReport(text: string): ExternalReportInput {
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error("Report JSON is invalid. Use double-quoted keys and remove trailing commas."); }
  if (!record(data)) throw new Error("The report must be a JSON object.");
  const unknown = Object.keys(data).filter(key => !["environment", "checks", "metrics", "logs", "replayCommand", "limitations"].includes(key));
  if (unknown.length) throw new Error(`Unsupported report fields: ${unknown.join(", ")}. Use the documented JSON format.`);
  if (typeof data.environment !== "string" || !data.environment.trim()) throw new Error("environment must describe the actual execution environment.");
  if (typeof data.replayCommand !== "string" || !data.replayCommand.trim()) throw new Error("replayCommand must contain the actual reproduction instructions.");
  if (!Array.isArray(data.checks) || data.checks.length === 0) throw new Error("checks must be a non-empty array of actual check results.");
  const checks: EvidenceCheck[] = data.checks.map((check, index) => {
    if (!record(check) || typeof check.name !== "string" || !check.name.trim() || typeof check.passed !== "boolean" || typeof check.detail !== "string" || !check.detail.trim()) {
      throw new Error(`checks[${index}] needs a name, boolean passed value and detail.`);
    }
    if (Object.keys(check).some(key => !["name", "passed", "detail"].includes(key))) throw new Error(`checks[${index}] only accepts name, passed and detail.`);
    return { name: check.name.trim(), passed: check.passed, detail: check.detail.trim() };
  });
  if (!Array.isArray(data.metrics) || !data.metrics.length) throw new Error("metrics must be a non-empty array of measured { name, baseline, candidate } values.");
  const metrics = data.metrics.map((metric, index) => {
    if (!record(metric) || typeof metric.name !== "string" || !metric.name.trim() || typeof metric.baseline !== "number" || !Number.isFinite(metric.baseline) || metric.baseline <= 0 || typeof metric.candidate !== "number" || !Number.isFinite(metric.candidate) || metric.candidate < 0) {
      throw new Error(`metrics[${index}] needs a name, a positive finite baseline and a non-negative finite candidate.`);
    }
    if (Object.keys(metric).some(key => !["name", "baseline", "candidate"].includes(key))) throw new Error(`metrics[${index}] only accepts name, baseline and candidate. Improvement is calculated from those measurements.`);
    return { name: metric.name.trim(), baseline: metric.baseline, candidate: metric.candidate };
  });
  const strings = (key: "logs" | "limitations") => {
    const value = data[key];
    if (!Array.isArray(value) || !value.length || !value.every((line): line is string => typeof line === "string" && Boolean(line.trim()))) throw new Error(`${key} must contain at least one non-empty text entry describing the actual output or limitations.`);
    return value;
  };
  return { environment: data.environment.trim(), checks, metrics, logs: strings("logs"), replayCommand: data.replayCommand.trim(), limitations: strings("limitations") };
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function EvidencePanel({ task, submission, user, busy, busyAction, runAction }: {
  task: PilotTask;
  submission: PilotSubmission;
  user: PilotUser;
  busy: boolean;
  busyAction: string | null;
  runAction: TaskActionRunner;
}) {
  const [reportText, setReportText] = useState("");
  const [reportError, setReportError] = useState("");
  const [reason, setReason] = useState("");
  const [reviewMinutes, setReviewMinutes] = useState("");
  const [reviewError, setReviewError] = useState("");
  const owner = task.ownerId === user.id;
  const canOperate = owner || submission.operatorId === user.id;
  const taskActive = task.status === "open" || task.status === "review";
  const awaitingEvidence = submission.status === "received" && !submission.evidence;
  const canRecord = canOperate && taskActive && !submission.review && (awaitingEvidence || (task.fixture === "external" && submission.status === "recorded"));
  const evidence = submission.evidence;
  const canReview = owner && task.status !== "draft" && task.status !== "archived" && !submission.review && submission.status !== "accepted" && submission.status !== "rejected";
  const canAccept = canReview && taskActive && !task.acceptedSubmissionId && canAcceptSubmission(task, submission);
  const endpoint = `/submissions/${encodeURIComponent(submission.id)}`;

  const recordReport = async () => {
    if (busy || !canRecord || task.fixture !== "external") return;
    setReportError("");
    let input: ExternalReportInput;
    try { input = parseReport(reportText); }
    catch (cause) { setReportError(cause instanceof Error ? cause.message : "Check the report JSON."); return; }
    const saved = await runAction(`report:${submission.id}`, () => pilotRequest<{ submission: PilotSubmission }>(`${endpoint}/report`, jsonBody(input)), "External report recorded. It has not been independently rerun.");
    if (saved) setReportText("");
  };

  const review = async (decision: "accept" | "reject") => {
    if (busy || !canReview || (decision === "accept" && !canAccept)) return;
    setReviewError("");
    if (reason.trim().length < 10) {
      setReviewError("Provide a meaningful review reason of at least 10 characters, tied to the scope and evidence.");
      return;
    }
    const minutes = Number(reviewMinutes);
    if (!reviewMinutes.trim() || !Number.isFinite(minutes) || minutes < 0) {
      setReviewError("Enter the actual non-negative review time in minutes.");
      return;
    }
    await runAction(`review:${submission.id}:${decision}`, () => pilotRequest<{ submission: PilotSubmission }>(`${endpoint}/review`, jsonBody({ decision, reason: reason.trim(), minutes })), decision === "accept" ? "Submission accepted. This records a review decision, not a payment." : "Submission rejected with your review reason recorded.");
  };

  return <article className="vp-panel vp-detail-evidence" aria-label={`Submission by ${submission.operatorName}`}>
    <header className="vp-detail-submission-heading"><div><p className="vp-detail-kicker">PATCH ARTIFACT</p><h3>{submission.operatorName}</h3><p className="vp-muted">Submitted <time dateTime={submission.createdAt} title={submission.createdAt}>{timestamp(submission.createdAt)}</time></p></div><span className="vp-badge" data-status={submission.status}>{submission.status}</span></header>
    <dl className="vp-detail-metadata vp-detail-artifact-metadata">
      <div className="vp-detail-metadata-wide"><dt>Artifact SHA256</dt><dd className="vp-detail-mono">{submission.artifactHash}</dd></div>
      <div className="vp-detail-metadata-wide"><dt>Base commit</dt><dd className="vp-detail-mono">{submission.baseCommit}</dd></div>
      <div><dt>Recorded compute</dt><dd>${submission.computeUsd.toFixed(2)}</dd></div>
      <div><dt>Recorded effort</dt><dd>{submission.effortMinutes.toLocaleString()} min</dd></div>
    </dl>
    <div className="vp-detail-scope"><h4>Method</h4><p className="vp-detail-preserve">{submission.method}</p></div>
    <div className="vp-detail-patch-row"><details className="vp-detail-disclosure"><summary>Original patch preview</summary><pre className="vp-detail-code">{submission.patch}</pre></details><a className="vp-button-secondary" href={`/api/pilot${endpoint}/artifact`} download><Download size={15} aria-hidden="true" /> Download original patch</a></div>

    {task.fixture === "reference" && canOperate && <div className="vp-detail-verification-action"><div><h4>Reference verification</h4><p className="vp-muted">{awaitingEvidence ? "Runs the original patch against the bounded bundled reference fixture." : "The recorded result is shown below. Verification is not repeated after evidence or review."}</p></div><button className="vp-button" type="button" disabled={busy || !canRecord} onClick={() => runAction(`verify:${submission.id}`, () => pilotRequest<{ submission: PilotSubmission }>(`${endpoint}/verify`, jsonBody({})), "Reference verification finished. Inspect the actual checks, gas results and limitations below.")}><Play size={15} aria-hidden="true" />{busyAction === `verify:${submission.id}` ? "Verifying…" : "Run reference verification"}</button></div>}
    {!evidence && <p className="vp-detail-no-evidence">No verification evidence has been recorded.{task.fixture === "external" ? " External reports are supplied by the operator, not independently executed here." : " Submission alone is not a verification result."}</p>}

    {task.fixture === "external" && canRecord && <section className="vp-detail-report-form" aria-label="External report">
      <h4>{evidence ? "Update external report" : "Record external report"}</h4><p className="vp-muted">Provide the actual environment, checks, gas measurements, logs, replay instructions and limitations. This app records the report without independently rerunning it. Reports can be corrected before owner review; changes are logged.</p>
      <details className="vp-detail-disclosure"><summary>Report JSON example & format</summary><p className="vp-muted">Example values only. Replace every example with your own execution evidence. Metrics use numeric gas values; checks use boolean passed values. Logs and limitations are arrays of strings.</p><pre className="vp-detail-code">{JSON.stringify(reportExample, null, 2)}</pre></details>
      <form onSubmit={event => { event.preventDefault(); void recordReport(); }} aria-busy={busyAction === `report:${submission.id}`}>
        {reportError && <p className="vp-error" role="alert">{reportError}</p>}
         <fieldset disabled={busy} className="vp-detail-fieldset"><label className="vp-field"><span>External report JSON</span><textarea aria-label="External report JSON" className="vp-detail-code-input" rows={12} value={reportText} onChange={event => setReportText(event.target.value)} required spellCheck={false} placeholder={'{"environment":"…","checks":[],"metrics":[],"logs":[],"replayCommand":"…","limitations":[]}'} /></label><button className="vp-button-secondary" type="submit">{busyAction === `report:${submission.id}` ? "Recording…" : "Record external report"}</button></fieldset>
      </form>
    </section>}

    {evidence && <RecordedEvidence submission={submission} />}

    {submission.review && <section className="vp-detail-review-record"><div className="vp-detail-section-heading"><h4>Owner decision</h4><span className="vp-badge" data-status={submission.review.decision === "accept" ? "accepted" : "rejected"}>{submission.review.decision === "accept" ? "Accepted" : "Rejected"}</span></div><p className="vp-detail-preserve">{submission.review.reason}</p><p className="vp-muted">{submission.review.reviewerName} · <time dateTime={submission.review.at} title={submission.review.at}>{timestamp(submission.review.at)}</time> · {submission.review.minutes} review min</p><small className="vp-muted">Review recorded. Payment remains a separate manual ledger entry.</small></section>}

    {canReview && <section className="vp-detail-review-form" aria-label="Owner review"><div className="vp-detail-section-heading"><h4><ShieldCheck size={17} aria-hidden="true" /> Owner review</h4><span className="vp-badge">Against frozen scope</span></div><p className="vp-muted">Explain the decision against the agreed criteria and record your review effort. Acceptance does not trigger payment.</p>{!canAccept && <p className="vp-muted">{task.acceptedSubmissionId || task.status === "accepted" ? "This task already has an accepted submission. Remaining submissions may be rejected with a reason." : "Acceptance requires artifact-bound passing checks and every gas measurement meeting the published threshold. You may reject with a reason."}</p>}{evidence?.source === "external-report" && <p className="vp-detail-external-label">External evidence has not been independently rerun. Acceptance is your manual review decision.</p>}
      {reviewError && <p className="vp-error" role="alert">{reviewError}</p>}
      <form onSubmit={event => event.preventDefault()}><fieldset className="vp-detail-fieldset" disabled={busy}><div className="vp-grid vp-detail-form-grid"><label className="vp-field vp-detail-full"><span>Review reason</span><textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} minLength={10} required placeholder="How does this patch meet or fail the frozen scope and acceptance criteria?" /></label><label className="vp-field"><span>Review time (minutes)</span><input type="number" min="0" step="0.1" value={reviewMinutes} onChange={event => setReviewMinutes(event.target.value)} required placeholder="Actual review effort" /></label></div><div className="vp-detail-actions"><button className="vp-button" type="button" disabled={!canAccept} onClick={() => review("accept")}>{busyAction === `review:${submission.id}:accept` ? "Accepting…" : "Accept submission"}</button><button className="vp-button-danger" type="button" onClick={() => review("reject")}>{busyAction === `review:${submission.id}:reject` ? "Rejecting…" : "Reject submission"}</button></div></fieldset></form>
    </section>}
  </article>;
}

function RecordedEvidence({ submission }: { submission: PilotSubmission }) {
  const evidence = submission.evidence;
  if (!evidence) return null;
  const external = evidence.source === "external-report";
  const worker = evidence.source === "worker-run";
  return <section className="vp-detail-recorded-evidence" aria-label="Recorded evidence">
    <div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">EVIDENCE RECORD</p><h4>{external ? "External report" : worker ? "Worker verification" : "Reference run"}</h4></div><span className="vp-badge" data-status={evidence.outcome}>{evidence.outcome}</span></div>
    {external && <p className="vp-detail-external-label">Operator-supplied external report · not independently rerun</p>}
    {worker && <p className="vp-detail-external-label">Pinned repository worker run · inspect the verifier image, limits and replay record</p>}
    <dl className="vp-detail-metadata">
      <div><dt>Engine</dt><dd>{evidence.engine}</dd></div>
      <div><dt>Recorded at</dt><dd><time dateTime={evidence.generatedAt} title={evidence.generatedAt}>{timestamp(evidence.generatedAt)}</time></dd></div>
      {!external && <div><dt>Elapsed verification time</dt><dd>{evidence.elapsedMs.toLocaleString()} ms</dd></div>}
      <div className="vp-detail-metadata-wide"><dt>Environment</dt><dd className="vp-detail-preserve">{evidence.environment}</dd></div>
      <div className="vp-detail-metadata-wide"><dt>Evidence artifact SHA256</dt><dd className="vp-detail-mono">{evidence.artifactHash}</dd></div>
    </dl>
    {evidence.artifactHash !== submission.artifactHash && <p className="vp-error" role="alert">This evidence hash differs from the submitted artifact hash. Review the recorded artifact linkage.</p>}

    <div className="vp-detail-evidence-block"><h4>{external ? "Reported checks" : "Executed checks"}</h4>{evidence.checks.length === 0 ? <p className="vp-muted">No check results were supplied.</p> : <ul className="vp-detail-checks">{evidence.checks.map((check, index) => <li key={`${check.name}-${index}`}><span className="vp-badge" data-status={check.passed ? "passed" : "failed"}>{external ? check.passed ? "Reported pass" : "Reported fail" : check.passed ? "Pass" : "Fail"}</span><div><strong>{check.name}</strong><p className="vp-detail-preserve">{check.detail}</p></div></li>)}</ul>}</div>

    <div className="vp-detail-evidence-block"><h4>Gas benchmark comparison</h4>{evidence.metrics.length === 0 ? <p className="vp-muted">No gas measurements were recorded.</p> : <div className="vp-detail-table-wrap" role="region" aria-label="Gas benchmark comparison" tabIndex={0}><table className="vp-detail-gas-table"><caption>{external ? "Operator-reported gas measurements; not independently rerun." : worker ? "Measurements from the pinned verification worker." : "Baseline and candidate measurements from the bundled reference fixture."}</caption><thead><tr><th scope="col">Workload</th><th scope="col">Baseline gas</th><th scope="col">Candidate gas</th><th scope="col">Improvement</th></tr></thead><tbody>{evidence.metrics.map((metric, index) => <tr key={`${metric.name}-${index}`}><th scope="row">{metric.name}</th><td>{metric.baseline.toLocaleString()}</td><td>{metric.candidate.toLocaleString()}</td><td className={metric.improvementPct > 0 ? "vp-detail-positive" : metric.improvementPct < 0 ? "vp-detail-negative" : ""}>{metric.improvementPct > 0 ? "+" : ""}{metric.improvementPct.toFixed(2)}%{metric.improvementPct < 0 && <small> regression</small>}</td></tr>)}</tbody></table></div>}</div>

    <div className="vp-detail-evidence-block"><h4>Limitations</h4>{evidence.limitations.length ? <ul className="vp-detail-limitations">{evidence.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : <p className="vp-muted">No limitations were supplied.</p>}</div>
    <div className="vp-detail-evidence-block"><h4>Replay instructions</h4>{evidence.replayCommand ? <pre className="vp-detail-code vp-detail-replay">{evidence.replayCommand}</pre> : <p className="vp-muted">No replay instructions were supplied.</p>}</div>
    <details className="vp-detail-disclosure"><summary>{external ? "Reported logs" : "Run logs"} · {evidence.logs.length} entries</summary>{evidence.logs.length ? <pre className="vp-detail-code">{evidence.logs.join("\n")}</pre> : <p className="vp-muted">No logs were supplied.</p>}</details>
  </section>;
}
