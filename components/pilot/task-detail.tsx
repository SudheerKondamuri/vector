"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Download, RefreshCw, ShieldAlert } from "lucide-react";
import { pilotRequest, PilotRequestError, jsonBody } from "../../lib/pilot-client";
import type { PilotTask, PilotTaskDetail, PilotTaskInput, PilotUser, ReviewChallenge } from "../../lib/pilot-types";
import { SubmissionPanel } from "./submission-panel";
import { EvidencePanel } from "./evidence-panel";
import { LedgerPanel } from "./ledger-panel";
import { SettlementPanel } from "./settlement-panel";
import "./task-detail.css";

export type TaskActionRunner = (
  key: string,
  action: () => Promise<unknown>,
  success: string,
) => Promise<boolean>;

type DetailError = { message: string; fields: Record<string, string> };

function requestError(error: unknown): DetailError {
  return {
    message: error instanceof Error ? error.message : "The request could not be completed.",
    fields: error instanceof PilotRequestError ? error.fields : {},
  };
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not specified" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function localDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TaskDetail({ taskId, user, onBack, onChanged }: {
  taskId: string;
  user: PilotUser;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<PilotTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DetailError | null>(null);
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [editing, setEditing] = useState(false);
  const actionLock = useRef(false);
  const activeTask = useRef(taskId);
  const errorRef = useRef<HTMLDivElement>(null);
  const changedRef = useRef(onChanged);
  activeTask.current = taskId;
  changedRef.current = onChanged;

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDetail(null);
    setError(null);
    setNotice("");
    setEditing(false);
    setRefreshRequired(false);
    pilotRequest<PilotTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setError(requestError(cause));
        if (cause instanceof PilotRequestError && cause.status === 401) changedRef.current();
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId]);

  const fetchLatest = useCallback(async () => {
    const data = await pilotRequest<PilotTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
    if (activeTask.current === taskId) {
      setDetail(data);
      setRefreshRequired(false);
    }
  }, [taskId]);

  const reload = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusyAction("reload");
    setError(null);
    setNotice("");
    try {
      await fetchLatest();
      onChanged();
    } catch (cause) {
      setError(requestError(cause));
      if (detail) setRefreshRequired(true);
      if (cause instanceof PilotRequestError && cause.status === 401) onChanged();
    } finally {
      setLoading(false);
      setBusyAction(null);
      actionLock.current = false;
    }
  };

  const runAction: TaskActionRunner = async (key, action, success) => {
    if (actionLock.current || refreshRequired) return false;
    actionLock.current = true;
    setBusyAction(key);
    setError(null);
    setNotice("");
    let recorded = false;
    try {
      await action();
      recorded = true;
      await fetchLatest();
      setNotice(success);
      onChanged();
      return true;
    } catch (cause) {
      const nextError = requestError(cause);
      if (recorded) nextError.message = `The action was recorded, but the latest task could not be loaded. Reload the task before continuing. ${nextError.message}`;
      else if (!(cause instanceof PilotRequestError)) nextError.message = `The request did not finish. Reload the task to check its state before trying again. ${nextError.message}`;
      setError(nextError);
      setRefreshRequired(recorded || !(cause instanceof PilotRequestError) || cause.status === 409 || cause.status >= 500);
      if (cause instanceof PilotRequestError && cause.status === 401) onChanged();
      return false;
    } finally {
      setBusyAction(null);
      actionLock.current = false;
    }
  };

  const task = detail?.task;
  const owner = task?.ownerId === user.id;
  const published = Boolean(task?.manifestHash || task?.publishedAt);
  const busy = Boolean(busyAction) || refreshRequired;
  const endpoint = `/tasks/${encodeURIComponent(taskId)}`;

  return (
    <div className="vp-detail">
      <div className="vp-detail-toolbar">
        <button className="vp-button-secondary" type="button" onClick={onBack} disabled={Boolean(busyAction)}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to workspace
        </button>
        <button className="vp-button-secondary" type="button" onClick={reload} disabled={Boolean(busyAction) || loading}>
          <RefreshCw size={15} aria-hidden="true" className={busyAction === "reload" ? "vp-detail-spin" : ""} />
          {busyAction === "reload" ? "Reloading…" : "Reload task"}
        </button>
      </div>

      {error && <div className="vp-error vp-detail-message" role="alert" tabIndex={-1} ref={errorRef}>
        <strong>{error.message}</strong>
        {Object.keys(error.fields).length > 0 && <ul>{Object.entries(error.fields).map(([field, message]) =>
          <li key={field}><span className="vp-detail-mono">{field}</span>: {message}</li>)}</ul>}
        {refreshRequired && <button className="vp-button-secondary" type="button" onClick={reload} disabled={Boolean(busyAction)}>Retry task load</button>}
      </div>}
      {notice && <p className="vp-detail-notice" role="status">{notice}</p>}
      {loading && <section className="vp-panel vp-detail-loading" aria-busy="true"><p role="status">Loading task…</p><div className="vp-detail-loading-line" /><div className="vp-detail-loading-line" /></section>}
      {!loading && !task && <section className="vp-panel vp-detail-empty">
        <h2>Task unavailable</h2><p className="vp-muted">Check your access or reload to try again.</p>
        <button className="vp-button" type="button" onClick={reload} disabled={Boolean(busyAction)}>Retry task load</button>
      </section>}

      {task && detail && <>
        <header className="vp-detail-header">
          <div>
            <div className="vp-detail-eyebrow"><span className="vp-badge" data-status={task.status}>{task.status}</span><span>{owner ? "Your task" : `Task by ${task.ownerName}`}</span><span>{task.fixture === "reference" ? "Reference fixture" : "External repository"}</span></div>
            <h1>{task.title}</h1>
            <p className="vp-muted">{task.description}</p>
          </div>
          {owner && task.status !== "archived" && <div className="vp-detail-actions">
            {task.status === "draft" && <>
              <button className="vp-button-secondary" type="button" disabled={busy || editing} onClick={() => setEditing(true)}>Edit draft</button>
               <button className="vp-button" type="button" disabled={busy || editing} onClick={() => runAction("publish", () => pilotRequest<{ task: PilotTask }>(`${endpoint}/publish`, jsonBody({})), "Task published. The scope manifest is now frozen and new operator invitations are queued.")}>
                {busyAction === "publish" ? "Publishing…" : "Publish task"}<ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </>}
            <button className="vp-button-danger" type="button" disabled={busy || editing} onClick={() => runAction("archive", () => pilotRequest<{ task: PilotTask }>(`${endpoint}/archive`, jsonBody({})), "Task archived.")}>{busyAction === "archive" ? "Archiving…" : "Archive task"}</button>
          </div>}
        </header>

        <nav className="vp-detail-nav" aria-label="Task sections"><a href="#vp-task-scope">Scope & terms</a><a href="#vp-task-submissions">Submissions <span>{detail.submissions.length}</span></a><a href="#vp-task-ledger">Cost ledger</a><a href="#vp-task-activity">Activity</a></nav>
        {editing && owner && task.status === "draft" && <DraftEditor key={`${task.id}-${task.updatedAt}`} task={task} busy={busy} busyAction={busyAction} runAction={runAction} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />}

        <section className="vp-panel vp-detail-section" id="vp-task-scope" aria-labelledby="vp-scope-title">
          <div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">01 / AGREEMENT</p><h2 id="vp-scope-title">Scope & terms</h2></div><span className="vp-badge">{task.status === "draft" ? "Editable draft" : published ? "Frozen manifest" : "Unpublished record"}</span></div>
          <p className="vp-muted">{task.status === "draft" ? "Review the complete scope before publishing. Submission intake opens on publication." : published ? "Published task fields are immutable. Review submissions against this recorded agreement." : "This task was archived before publication. No published manifest was created."}</p>
          <div className="vp-detail-stats">
            <div><span>Service price</span><strong>${task.priceUsd.toFixed(2)}</strong><small>Agreed, not a payment</small></div>
            <div><span>Operator reward</span><strong>${task.operatorRewardUsd.toFixed(2)}</strong><small>Subject to recorded terms</small></div>
            <div><span>Minimum improvement</span><strong>{task.minImprovementPct}%</strong><small>Gas benchmark threshold</small></div>
            <div><span>Submission limit</span><strong>{task.maxSubmissions}</strong><small>Task-wide limit</small></div>
          </div>
          <dl className="vp-detail-metadata">
            <div><dt>Repository</dt><dd className="vp-detail-mono">{task.repoUrl || "Not specified"}</dd></div>
            <div><dt>Base commit</dt><dd className="vp-detail-mono">{task.baseCommit || "Not specified"}</dd></div>
            <div><dt>Target</dt><dd>{task.target || "Not specified"}</dd></div>
            <div><dt>Deadline</dt><dd><time dateTime={task.deadline}>{dateLabel(task.deadline)}</time></dd></div>
            <div className="vp-detail-metadata-wide"><dt>Manifest SHA256</dt><dd className="vp-detail-mono">{task.manifestHash || "No manifest hash recorded yet"}</dd></div>
          </dl>
          <div className="vp-detail-scope"><h3>Allowed paths</h3>{task.scopePaths.length > 0 ? <ul className="vp-detail-paths">{task.scopePaths.map(path => <li key={path}><code>{path}</code></li>)}</ul> : <p className="vp-muted">No scope paths specified.</p>}</div>
          <div className="vp-detail-scope"><h3>Behavior & constraints</h3><p className="vp-detail-preserve">{task.constraints || "Not specified"}</p></div>
          <div className="vp-grid vp-detail-terms">
            <div><h3>Manual payment terms</h3><p className="vp-detail-preserve">{task.paymentTerms || "Not specified"}</p></div>
            <div><h3>Review & acceptance terms</h3><p className="vp-detail-preserve">{task.reviewTerms || "Not specified"}</p></div>
          </div>
          {owner && <div className="vp-detail-scope"><h3>Invited accounts</h3><p className="vp-muted">{task.inviteEmails.length ? task.inviteEmails.join(", ") : "No invited emails recorded."}</p></div>}
          <div className="vp-detail-export"><span className="vp-muted">Download the recorded evidence package</span><a className="vp-button-secondary" href={`/api/pilot${endpoint}/export?format=json`} download><Download size={15} aria-hidden="true" /> Export JSON</a><a className="vp-button-secondary" href={`/api/pilot${endpoint}/export?format=markdown`} download><Download size={15} aria-hidden="true" /> Export Markdown</a></div>
        </section>

        <section className="vp-detail-section" id="vp-task-submissions" aria-labelledby="vp-submissions-title">
          <div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">02 / DELIVERY</p><h2 id="vp-submissions-title">Submissions</h2></div><span className="vp-badge">{detail.submissions.length} visible</span></div>
          {!owner && <p className="vp-muted">Only your own submissions are shown. Other operators’ patches remain private.</p>}
          <SubmissionPanel key={task.id} task={task} user={user} busy={busy} busyAction={busyAction} runAction={runAction} />
           <div className="vp-detail-submission-list">
            {detail.submissions.length === 0 ? <div className="vp-panel vp-detail-empty"><h3>No submissions yet</h3><p className="vp-muted">{task.status === "draft" ? "Publish the task to enable patch submission." : owner ? "Submitted patches and their recorded evidence will appear here." : "Submit your patch to begin the evidence and review flow."}</p></div> : [...detail.submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(submission => <EvidencePanel key={submission.id} task={task} submission={submission} user={user} busy={busy} busyAction={busyAction} runAction={runAction} />)}
           </div>
         </section>

          <ChallengePanel task={task} detail={detail} user={user} busy={busy} busyAction={busyAction} runAction={runAction} />

           <LedgerPanel task={task} user={user} busy={busy} busyAction={busyAction} runAction={runAction} />

          <SettlementPanel task={task} submission={detail.submissions.find(submission => submission.id === task.acceptedSubmissionId)} escrow={detail.escrows[0]} user={user} onChanged={() => { void fetchLatest(); onChanged(); }} />

          <section className="vp-panel vp-detail-section" id="vp-task-activity" aria-labelledby="vp-activity-title">
          <div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">04 / RECORD</p><h2 id="vp-activity-title">Activity & audit trail</h2></div><span className="vp-badge">{detail.events.length} events</span></div>
          {detail.events.length === 0 ? <p className="vp-muted">No activity has been recorded.</p> : <ol className="vp-detail-events">{[...detail.events].sort((a, b) => b.at.localeCompare(a.at)).map(event => <li key={event.id}><span className="vp-detail-event-dot" aria-hidden="true" /><div><div className="vp-detail-event-meta"><strong>{event.actorName}</strong><code>{event.type}</code><time dateTime={event.at} title={event.at}>{dateLabel(event.at)}</time></div><p>{event.message}</p></div></li>)}</ol>}
        </section>
      </>}
    </div>
  );
}

function ChallengePanel({ task, detail, user, busy, busyAction, runAction }: {
  task: PilotTask;
  detail: PilotTaskDetail;
  user: PilotUser;
  busy: boolean;
  busyAction: string | null;
  runAction: TaskActionRunner;
}) {
  const accepted = detail.submissions.find(submission => submission.id === task.acceptedSubmissionId);
  const open = detail.challenges.find(challenge => challenge.status === "open");
  const resolved = detail.challenges.filter(challenge => challenge.status === "resolved");
  const [reason, setReason] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState("");
  const acceptedOperator = accepted?.operatorId === user.id && accepted.status === "accepted";
  const owner = task.ownerId === user.id;
  const challengeOpen = accepted?.review ? Date.parse(accepted.review.at) + 48 * 60 * 60 * 1000 > Date.now() : false;

  async function openChallenge() {
    if (!accepted || reason.trim().length < 10) { setError("Describe the evidence or acceptance issue in at least 10 characters."); return; }
    setError("");
    const saved = await runAction(`challenge:${accepted.id}`, () => pilotRequest<{ challenge: ReviewChallenge }>(`/submissions/${encodeURIComponent(accepted.id)}/challenge`, jsonBody({ reason: reason.trim() })), "Challenge opened. The sponsor can now review the recorded concern.");
    if (saved) setReason("");
  }

  async function resolve(decision: "uphold" | "dismiss") {
    if (!open || decisionReason.trim().length < 10) { setError("Add a reason for the challenge decision in at least 10 characters."); return; }
    setError("");
    const saved = await runAction(`resolve-challenge:${open.id}`, () => pilotRequest<{ challenge: ReviewChallenge }>(`/challenges/${encodeURIComponent(open.id)}/resolve`, jsonBody({ decision, reason: decisionReason.trim() })), `Challenge ${decision === "uphold" ? "upheld" : "dismissed"}. The decision is now part of the task record.`);
    if (saved) setDecisionReason("");
  }

  if (!accepted && !resolved.length) return null;
  return <section className="vp-panel vp-detail-section vp-challenge-panel" id="vp-task-challenges" aria-labelledby="vp-challenges-title"><div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">03 / CHALLENGE</p><h2 id="vp-challenges-title">Challenge &amp; resolution</h2></div><span className="vp-badge"><ShieldAlert size={12} aria-hidden="true" />{open ? "Open review" : resolved.length ? "Recorded" : "No challenge"}</span></div><p className="vp-muted">The accepted operator has 48 hours to challenge an acceptance with a concrete reason. The sponsor resolves the record; no challenge silently changes the published evidence.</p>{error && <p className="vp-error" role="alert">{error}</p>}{accepted && acceptedOperator && !open && challengeOpen && <div className="vp-challenge-action"><div><h3>Something is wrong with the acceptance?</h3><p className="vp-muted">Open one challenge before the window closes. Point to the scope, check result, or review decision that needs attention.</p></div><label className="vp-field"><span>Challenge reason</span><textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Name the specific issue and the evidence that supports it." /></label><button type="button" className="vp-button-danger" disabled={busy} onClick={() => void openChallenge()}>{busyAction === `challenge:${accepted.id}` ? "Opening…" : "Open challenge"}</button></div>}{open && owner && <div className="vp-challenge-action vp-challenge-owner"><div><h3>Resolve the operator challenge</h3><p className="vp-muted">Opened by <strong>{open.challengerName}</strong> on {dateLabel(open.openedAt)}. Read the reason, inspect the evidence above, then record a bounded decision.</p><p className="vp-detail-preserve vp-challenge-reason">{open.reason}</p></div><label className="vp-field"><span>Resolution reason</span><textarea rows={3} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} placeholder="Explain why the acceptance stands or is withdrawn." /></label><div className="vp-detail-actions"><button type="button" className="vp-button" disabled={busy} onClick={() => void resolve("dismiss")}>{busyAction === `resolve-challenge:${open.id}` ? "Saving…" : "Dismiss challenge"}</button><button type="button" className="vp-button-danger" disabled={busy} onClick={() => void resolve("uphold")}>Uphold and reopen review</button></div></div>}{open && !owner && <div className="vp-challenge-callout"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Challenge is with the sponsor.</strong><p className="vp-muted">Your reason is recorded. The task will update when the sponsor resolves it.</p></div></div>}{resolved.map(challenge => <div className="vp-challenge-record" key={challenge.id}><div><span className="vp-badge" data-status={challenge.resolution === "uphold" ? "failed" : "accepted"}>{challenge.resolution === "uphold" ? "Upheld" : "Dismissed"}</span><strong>{challenge.resolutionReason}</strong></div><p className="vp-muted">Resolved by {challenge.resolverName || "workspace owner"} · {dateLabel(challenge.resolvedAt || challenge.openedAt)}</p></div>)}</section>;
}

function DraftEditor({ task, busy, busyAction, runAction, onCancel, onSaved }: {
  task: PilotTask;
  busy: boolean;
  busyAction: string | null;
  runAction: TaskActionRunner;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState("");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFormError("");
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const deadline = new Date(text("deadline"));
    if (Number.isNaN(deadline.getTime())) {
      setFormError("Enter a valid deadline in your local time zone.");
      return;
    }
    const input: PilotTaskInput = {
      title: text("title"),
      description: text("description"),
      fixture: text("fixture") === "reference" ? "reference" : "external",
      repoUrl: text("repoUrl"),
      baseCommit: text("baseCommit"),
      target: text("target"),
      scopePaths: text("scopePaths").split(/[\n,]+/).map(path => path.trim()).filter(Boolean),
      constraints: text("constraints"),
      minImprovementPct: Number(text("minImprovementPct")),
      deadline: deadline.toISOString(),
      maxSubmissions: Number(text("maxSubmissions")),
      priceUsd: Number(text("priceUsd")),
      operatorRewardUsd: Number(text("operatorRewardUsd")),
      paymentTerms: text("paymentTerms"),
      reviewTerms: text("reviewTerms"),
      inviteEmails: text("inviteEmails").split(/[\s,;]+/).filter(Boolean),
    };
    const saved = await runAction("save-draft", () => pilotRequest<{ task: PilotTask }>(`/tasks/${encodeURIComponent(task.id)}`, { ...jsonBody(input), method: "PATCH" }), "Draft saved.");
    if (saved) onSaved();
  };

  return <section className="vp-panel vp-detail-section vp-detail-draft" aria-labelledby="vp-draft-title">
    <div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">EDIT AGREEMENT</p><h2 id="vp-draft-title">Edit draft</h2></div><span className="vp-badge">Not published</span></div>
    <form onSubmit={save} aria-busy={busyAction === "save-draft"}>
      {formError && <p className="vp-error" role="alert">{formError}</p>}
      <fieldset disabled={busy} className="vp-detail-fieldset">
        <div className="vp-grid vp-detail-form-grid">
          <label className="vp-field vp-detail-full"><span>Task title</span><input name="title" defaultValue={task.title} required /></label>
          <label className="vp-field vp-detail-full"><span>Description</span><textarea name="description" defaultValue={task.description} rows={4} required /></label>
          <label className="vp-field"><span>Verification source</span><select name="fixture" defaultValue={task.fixture}><option value="reference">Bundled reference fixture</option><option value="external">External report</option></select></label>
           <label className="vp-field"><span>Repository URL</span><input name="repoUrl" defaultValue={task.repoUrl} required={task.fixture === "external"} spellCheck={false} placeholder={task.fixture === "reference" ? "Bundled fixture — no repository URL needed" : "https://github.com/team/repository"} /></label>
          <label className="vp-field"><span>Base commit</span><input name="baseCommit" defaultValue={task.baseCommit} required spellCheck={false} /></label>
          <label className="vp-field"><span>Target function or component</span><input name="target" defaultValue={task.target} required /></label>
          <label className="vp-field vp-detail-full"><span>Scope paths · one per line</span><textarea name="scopePaths" defaultValue={task.scopePaths.join("\n")} rows={3} required spellCheck={false} /></label>
          <label className="vp-field vp-detail-full"><span>Behavior & constraints</span><textarea name="constraints" defaultValue={task.constraints} rows={4} required /></label>
          <label className="vp-field"><span>Minimum gas improvement (%)</span><input name="minImprovementPct" type="number" min="0" max="100" step="any" defaultValue={task.minImprovementPct} required /></label>
          <label className="vp-field"><span>Deadline · your local time</span><input name="deadline" type="datetime-local" defaultValue={localDate(task.deadline)} required /></label>
          <label className="vp-field"><span>Maximum submissions</span><input name="maxSubmissions" type="number" min="1" step="1" defaultValue={task.maxSubmissions} required /></label>
          <label className="vp-field"><span>Service price (USD)</span><input name="priceUsd" type="number" min="0" step="0.01" defaultValue={task.priceUsd} required /></label>
          <label className="vp-field"><span>Operator reward (USD)</span><input name="operatorRewardUsd" type="number" min="0" step="0.01" defaultValue={task.operatorRewardUsd} required /></label>
          <label className="vp-field"><span>Invited emails · comma or newline separated</span><textarea name="inviteEmails" defaultValue={task.inviteEmails.join("\n")} rows={2} /></label>
          <label className="vp-field vp-detail-full"><span>Manual payment terms</span><textarea name="paymentTerms" defaultValue={task.paymentTerms} rows={3} required /></label>
          <label className="vp-field vp-detail-full"><span>Review & acceptance terms</span><textarea name="reviewTerms" defaultValue={task.reviewTerms} rows={3} required /></label>
        </div>
        <p className="vp-muted">Reference verification runs only the bundled fixture. External repositories use operator-supplied reports.</p>
        <div className="vp-detail-actions"><button className="vp-button" type="submit">{busyAction === "save-draft" ? "Saving…" : "Save draft"}</button><button className="vp-button-secondary" type="button" onClick={onCancel}>Cancel edit</button></div>
      </fieldset>
    </form>
  </section>;
}
