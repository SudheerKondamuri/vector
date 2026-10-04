"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, FileCode2, GitCommitHorizontal, Info, LoaderCircle, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { jsonBody, pilotRequest, PilotRequestError } from "@/lib/pilot-client";
import { REFERENCE_PATH, type PilotTask, type PilotTaskInput } from "@/lib/pilot-types";
import { createWorkspaceDraft, validateWorkspaceTaskDraft, type WorkspaceDraft } from "./workspace-validation";

function BuilderField({ name, label, errors, help, children, wide = false }: { name: string; label: string; errors: Record<string, string>; help?: string; children: ReactNode; wide?: boolean }) {
  return <div className={`vp-field${wide ? " vp-field-wide" : ""}`}><label htmlFor={`vp-build-${name}`}>{label}</label>{children}{errors[name] ? <span id={`vp-build-${name}-error`} className="vp-field-error">{errors[name]}</span> : help && <span id={`vp-build-${name}-help`} className="vp-field-help">{help}</span>}</div>;
}

export function WorkspaceBuilder({ fixture, onCancel, onCreated, onSessionExpired }: {
  fixture: PilotTaskInput["fixture"];
  onCancel: () => void;
  onCreated: (task: PilotTask) => void;
  onSessionExpired: () => void;
}) {
  const [draft, setDraft] = useState(() => createWorkspaceDraft(fixture));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkRequired, setCheckRequired] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const reference = fixture === "reference";

  function update(key: keyof WorkspaceDraft, value: string) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
  }

  function control(key: keyof WorkspaceDraft) {
    return {
      id: `vp-build-${key}`, name: key, value: draft[key],
      onChange: (event: { target: { value: string } }) => update(key, event.target.value),
      "aria-invalid": !!errors[key], "aria-describedby": `vp-build-${key}-${errors[key] ? "error" : "help"}`,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || checkRequired) return;
    const result = validateWorkspaceTaskDraft(draft);
    setErrors(result.errors);
    setError("");
    if (!result.input) {
      setError("Your draft needs a few adjustments. Check the highlighted fields below.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const response = await pilotRequest<{ task: PilotTask }>("/tasks", jsonBody(result.input));
      onCreated(response.task);
    } catch (cause) {
      if (cause instanceof PilotRequestError && cause.status === 401) { onSessionExpired(); return; }
      setErrors(cause instanceof PilotRequestError ? cause.fields : {});
      const uncertain = !(cause instanceof PilotRequestError) || cause.status >= 500;
      setCheckRequired(uncertain);
      setError(uncertain ? "The save request did not finish. Check your saved tasks before creating another draft; this draft may already have been recorded."
        : cause.message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="vp-builder">
      <button type="button" className="vp-text-button" onClick={onCancel} disabled={busy}><ArrowLeft size={15} aria-hidden="true" />Back to tasks</button>
      <div className="vp-page-heading"><div><div className="vp-eyebrow">NEW TASK / {reference ? "REFERENCE EXERCISE" : "EXTERNAL REPOSITORY"}</div><h1>{reference ? "Start with a known baseline." : "Make the brief precise."}</h1><p>{reference ? "A ready-to-edit brief for the bundled Solidity fixture. Save it as a draft, then publish when you’re ready." : "Pin the code, bound the changes and define what a good result looks like. You can review the draft before publishing."}</p></div><span className="vp-badge"><Save size={12} aria-hidden="true" />SAVED AS DRAFT</span></div>
      <div className={`vp-builder-note${reference ? " vp-builder-note-reference" : ""}`}><Info size={18} aria-hidden="true" /><div><strong>{reference ? "A real verification exercise. A USD 0 brief." : "External evidence is recorded, not independently verified."}</strong><p>{reference ? "The server can run the bundled reference checks. This exercise represents no customer demand, service revenue or operator payment." : "Vector stores your HTTPS repository link without fetching or executing it. Operators run their environment separately and attach an explicitly unverified report."}</p></div></div>

      <form onSubmit={submit} noValidate aria-busy={busy}>
        {error && <div className="vp-error" role="alert" tabIndex={-1} ref={errorRef}>{error}{Object.entries(errors).filter(([key]) => key === "fixture" || (reference && key === "repoUrl")).map(([key, message]) => <p key={key}>{message}</p>)}{checkRequired && <div className="vp-error-action"><button type="button" className="vp-button-secondary" onClick={onCancel}>Check saved tasks<ArrowRight size={14} aria-hidden="true" /></button></div>}</div>}
        <fieldset disabled={busy || checkRequired} className="vp-builder-fields">
          <section className="vp-panel vp-form-section" aria-labelledby="vp-brief-heading">
            <div className="vp-form-section-heading"><span className="vp-step-number">01</span><div><h2 id="vp-brief-heading">The brief</h2><p>Give the operator a concrete outcome.</p></div><FileCode2 size={19} aria-hidden="true" /></div>
            <div className="vp-grid">
              <BuilderField name="title" label="Task title" errors={errors} help="A short, specific outcome (3–140 characters)." wide><input {...control("title")} maxLength={140} placeholder="Reduce gas in the batch-processing path" required /></BuilderField>
              <BuilderField name="description" label="Task brief" errors={errors} help="Describe the baseline, intended change and definition of done." wide><textarea {...control("description")} rows={4} maxLength={10000} placeholder="What should improve, and what must remain true?" required /></BuilderField>
              <BuilderField name="target" label="Benchmark target" errors={errors} help="Name the contract, function or benchmark to measure." wide><input {...control("target")} maxLength={300} placeholder="Batch.process — batch gas benchmark" required /></BuilderField>
            </div>
          </section>

          <section className="vp-panel vp-form-section" aria-labelledby="vp-scope-heading">
            <div className="vp-form-section-heading"><span className="vp-step-number">02</span><div><h2 id="vp-scope-heading">A pinned starting point</h2><p>{reference ? "The fixture and allowed file are fixed." : "The repository is a pointer. The commit is the baseline."}</p></div><GitCommitHorizontal size={20} aria-hidden="true" /></div>
            <div className="vp-grid">
              {reference ? <div className="vp-fixture-line vp-field-wide"><span><FileCode2 size={17} aria-hidden="true" />Bundled fixture</span><code>{REFERENCE_PATH}</code></div> : <BuilderField name="repoUrl" label="Repository URL (HTTPS)" errors={errors} help="A full HTTPS URL; Vector will not fetch this repository." wide><input {...control("repoUrl")} type="url" maxLength={2048} autoCapitalize="none" spellCheck={false} placeholder="https://github.com/your-team/your-repository" required /></BuilderField>}
              <BuilderField name="baseCommit" label="Base commit (40-character SHA)" errors={errors} help={reference ? "Fixed reference commit identifier; this is a bundled fixture, not a remote checkout." : "Use a full commit SHA, not a branch or tag."} wide><input {...control("baseCommit")} className="vp-mono-input" autoCapitalize="none" spellCheck={false} maxLength={40} readOnly={reference} required /></BuilderField>
              <BuilderField name="scopePaths" label="Allowed scope paths" errors={errors} help={reference ? "Only this reference file may change." : "Up to 20 relative files or directories, one per line. No hidden paths, absolute paths, traversal or globs."} wide><textarea {...control("scopePaths")} className="vp-mono-input" rows={reference ? 2 : 3} placeholder={"src/Batch.sol\ntest/Batch.t.sol"} readOnly={reference} spellCheck={false} required /></BuilderField>
              <BuilderField name="constraints" label="Behavior and implementation constraints" errors={errors} help="Spell out the interfaces, tests and behaviors that must be preserved." wide><textarea {...control("constraints")} rows={4} maxLength={10000} required /></BuilderField>
            </div>
          </section>

          <section className="vp-panel vp-form-section" aria-labelledby="vp-review-heading">
            <div className="vp-form-section-heading"><span className="vp-step-number">03</span><div><h2 id="vp-review-heading">Acceptance &amp; capacity</h2><p>Make the threshold and review process explicit.</p></div><ShieldCheck size={20} aria-hidden="true" /></div>
            <div className="vp-grid">
              <BuilderField name="minImprovementPct" label="Minimum improvement (%)" errors={errors} help="Required reduction from the baseline; greater than 0, up to 100%."><input {...control("minImprovementPct")} type="number" min="0.01" max="100" step="0.01" inputMode="decimal" required /></BuilderField>
              <BuilderField name="maxSubmissions" label="Submission cap" errors={errors} help="A whole number from 1 to 100."><input {...control("maxSubmissions")} type="number" min="1" max="100" step="1" inputMode="numeric" required /></BuilderField>
              <BuilderField name="deadline" label="Submission deadline" errors={errors} help="Choose a future date and time in your local timezone." wide><input {...control("deadline")} type="datetime-local" required /></BuilderField>
              <BuilderField name="reviewTerms" label="Review and acceptance terms" errors={errors} help="Who reviews, which checks matter, and what counts as acceptance?" wide><textarea {...control("reviewTerms")} rows={3} maxLength={4000} required /></BuilderField>
            </div>
          </section>

          <section className="vp-panel vp-form-section" aria-labelledby="vp-terms-heading">
            <div className="vp-form-section-heading"><span className="vp-step-number">04</span><div><h2 id="vp-terms-heading">Terms &amp; people</h2><p>{reference ? "An unpaid exercise with optional collaborators." : "Agreed amounts, manual payment records and invited operators."}</p></div><LockKeyhole size={19} aria-hidden="true" /></div>
            <div className="vp-grid">
              <BuilderField name="priceUsd" label="Service price (USD)" errors={errors} help={reference ? "Fixed at USD 0 for this reference exercise." : "The agreed service price, not collected automatically. Zero is allowed."}><input {...control("priceUsd")} type="number" min="0" max="1000000" step="0.01" inputMode="decimal" readOnly={reference} required /></BuilderField>
              <BuilderField name="operatorRewardUsd" label="Operator reward (USD)" errors={errors} help={reference ? "Fixed at USD 0; there is no operator payout." : "No more than the service price. Actual payment is recorded separately."}><input {...control("operatorRewardUsd")} type="number" min="0" max="1000000" step="0.01" inputMode="decimal" readOnly={reference} required /></BuilderField>
              <BuilderField name="paymentTerms" label="Payment and invoice terms" errors={errors} help="Amounts are commitments in the brief; the manual ledger records actual payments." wide><textarea {...control("paymentTerms")} rows={3} maxLength={4000} required /></BuilderField>
              <BuilderField name="inviteEmails" label="Invited operator emails (optional)" errors={errors} help="Separate up to 25 email addresses with commas or new lines. People sign up with the same email to access the task." wide><textarea {...control("inviteEmails")} rows={2} autoCapitalize="none" spellCheck={false} placeholder={"operator@yourteam.com"} /></BuilderField>
            </div>
          </section>

          <div className="vp-builder-footer"><p><LockKeyhole size={14} aria-hidden="true" />A draft is saved privately on this server. Publishing is a separate step.</p><div className="vp-actions"><button className="vp-button-secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="vp-button" type="submit" disabled={busy || checkRequired}>{busy ? <><LoaderCircle size={16} className="vp-spin" aria-hidden="true" />Saving draft…</> : <>Save draft<ArrowRight size={16} aria-hidden="true" /></>}</button></div></div>
        </fieldset>
      </form>
    </div>
  );
}
