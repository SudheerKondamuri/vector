"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { FileUp, FlaskConical } from "lucide-react";
import { pilotRequest, PilotRequestError, jsonBody } from "../../lib/pilot-client";
import type { PilotSubmission, PilotTask, PilotUser, SubmissionInput } from "../../lib/pilot-types";
import type { TaskActionRunner } from "./task-detail";

type ReferenceBundle = { source: string; patch: string; commit: string; path: string };

export function SubmissionPanel({ task, user, busy, busyAction, runAction }: {
  task: PilotTask;
  user: PilotUser;
  busy: boolean;
  busyAction: string | null;
  runAction: TaskActionRunner;
}) {
  const [patch, setPatch] = useState("");
  const [baseCommit, setBaseCommit] = useState(task.baseCommit);
  const [method, setMethod] = useState("");
  const [computeUsd, setComputeUsd] = useState("");
  const [effortMinutes, setEffortMinutes] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reading, setReading] = useState<"file" | "reference" | null>(null);
  const [fileName, setFileName] = useState("");
  const [reference, setReference] = useState<ReferenceBundle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const readLock = useRef(false);
  const allowed = task.ownerId === user.id || task.inviteEmails.some(email => email.toLowerCase() === user.email.toLowerCase());
  const intakeOpen = task.status === "open" || task.status === "review";
  const deadlinePassed = Number.isFinite(Date.parse(task.deadline)) && Date.parse(task.deadline) <= Date.now();
  const disabled = busy || Boolean(reading);

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file || readLock.current || busy) return;
    readLock.current = true;
    setReading("file");
    setError("");
    setFields({});
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("The selected patch file is empty.");
      setPatch(text);
      setFileName(file.name);
      setReference(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read. Paste the patch text instead.");
    } finally {
      setReading(null);
      readLock.current = false;
    }
  };

  const loadReference = async () => {
    if (readLock.current || busy) return;
    readLock.current = true;
    setReading("reference");
    setError("");
    setFields({});
    try {
      const bundle = await pilotRequest<ReferenceBundle>("/reference");
      setReference(bundle);
      setPatch(bundle.patch);
      setBaseCommit(bundle.commit);
      setMethod("Bundled reference example patch, loaded from the reference fixture.");
      setFileName("");
      if (fileInput.current) fileInput.current.value = "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reference patch could not be loaded.");
      setFields(cause instanceof PilotRequestError ? cause.fields : {});
    } finally {
      setReading(null);
      readLock.current = false;
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setError("");
    setFields({});
    const compute = Number(computeUsd);
    const effort = Number(effortMinutes);
    if (!patch.trim() || !baseCommit.trim() || !method.trim()) {
      setError("Provide the original patch, its base commit and a method summary.");
      return;
    }
    if (!computeUsd.trim() || !effortMinutes.trim() || !Number.isFinite(compute) || !Number.isFinite(effort) || compute < 0 || effort < 0) {
      setError("Record non-negative compute cost and effort minutes, including unsuccessful attempts. Enter 0 only when appropriate.");
      return;
    }
    const input: SubmissionInput = { patch, baseCommit: baseCommit.trim(), method: method.trim(), computeUsd: compute, effortMinutes: effort };
    const submitted = await runAction("submit-patch", () => pilotRequest<{ submission: PilotSubmission }>(`/tasks/${encodeURIComponent(task.id)}/submissions`, jsonBody(input)), "Patch submitted. Its original artifact and SHA256 are recorded below.");
    if (submitted) {
      setPatch("");
      setMethod("");
      setComputeUsd("");
      setEffortMinutes("");
      setReference(null);
      setFileName("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (!allowed || !intakeOpen || deadlinePassed) {
    const reason = !allowed ? "Submission access is limited to the task owner and invited accounts."
      : task.status === "draft" ? "This draft is not open for submissions."
      : deadlinePassed && intakeOpen ? "The submission deadline has passed."
      : `Submission intake is closed for this ${task.status} task.`;
    return <div className="vp-panel vp-detail-intake-closed"><h3>Patch intake</h3><p className="vp-muted">{reason}</p></div>;
  }

  return <div className="vp-panel vp-detail-intake">
    <div className="vp-detail-section-heading"><div><h3>Submit a patch</h3><p className="vp-muted">Upload a Git patch or paste its exact contents. No submission is created until you submit.</p></div>{task.fixture === "reference" && <button className="vp-button-secondary" type="button" onClick={loadReference} disabled={disabled}><FlaskConical size={15} aria-hidden="true" />{reading === "reference" ? "Loading example…" : "Load example patch"}</button>}</div>
    {error && <div className="vp-error" role="alert">{error}{Object.keys(fields).length > 0 && <ul>{Object.entries(fields).map(([field, message]) => <li key={field}>{field}: {message}</li>)}</ul>}</div>}
    <form onSubmit={submit} aria-busy={busyAction === "submit-patch"}>
      <fieldset disabled={disabled} className="vp-detail-fieldset">
        <label className="vp-field vp-detail-file-field"><span><FileUp size={15} aria-hidden="true" /> Upload patch file</span><input ref={fileInput} type="file" accept=".patch,.diff,.txt,text/plain" onChange={loadFile} />{fileName && <small>{fileName} loaded locally</small>}</label>
         <label className="vp-field"><span>Git patch</span><textarea aria-label="Git patch" className="vp-detail-code-input" name="patch" value={patch} onChange={event => setPatch(event.target.value)} rows={10} required spellCheck={false} placeholder="diff --git a/src/Contract.sol b/src/Contract.sol" /></label>
        <div className="vp-grid vp-detail-form-grid">
          <label className="vp-field vp-detail-full"><span>Patch base commit</span><input name="baseCommit" value={baseCommit} onChange={event => setBaseCommit(event.target.value)} required spellCheck={false} /></label>
           <label className="vp-field vp-detail-full"><span>Method summary</span><textarea aria-label="Method summary" name="method" value={method} onChange={event => setMethod(event.target.value)} required rows={2} placeholder="Tools, approach and attempts used to produce this patch" /></label>
          <label className="vp-field"><span>Submission compute cost (USD)</span><input name="computeUsd" type="number" min="0" step="0.01" value={computeUsd} onChange={event => setComputeUsd(event.target.value)} required placeholder="Recorded cost" /></label>
          <label className="vp-field"><span>Submission effort (minutes)</span><input name="effortMinutes" type="number" min="0" step="0.1" value={effortMinutes} onChange={event => setEffortMinutes(event.target.value)} required placeholder="Total effort across attempts" /></label>
        </div>
        {reference && <details className="vp-detail-disclosure"><summary>Loaded reference source · {reference.path}</summary><p className="vp-muted">Base commit: <code>{reference.commit}</code>. The example patch will be submitted as a real artifact.</p><pre className="vp-detail-code">{reference.source}</pre></details>}
        <div className="vp-detail-form-footer"><p className="vp-muted">{task.fixture === "reference" ? "After submission, run reference verification explicitly. Submission alone does not verify a patch." : "External repositories require an operator-supplied report after submission. They are not run by this application."}</p><button className="vp-button" type="submit">{busyAction === "submit-patch" ? "Submitting…" : "Submit patch"}</button></div>
      </fieldset>
    </form>
  </div>;
}
