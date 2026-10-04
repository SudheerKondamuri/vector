"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, Save } from "lucide-react";
import { jsonBody, pilotRequest } from "../../lib/pilot-client";
import { calculatePilotLedger } from "../../lib/pilot-ledger";
import type { PaymentStatus, PilotLedger, PilotTask, PilotUser } from "../../lib/pilot-types";
import type { TaskActionRunner } from "./task-detail";

type NumericField = Exclude<keyof PilotLedger, "paymentStatus" | "paymentReference">;
const groups: { title: string; help: string; fields: { key: NumericField; label: string }[] }[] = [
  { title: "Buyer effort", help: "Compare with a measured internal workflow. A 0 baseline means no baseline is recorded; buyer dollar savings are not inferred.", fields: [
    { key: "baselineMinutes", label: "Buyer baseline effort (minutes)" },
    { key: "setupMinutes", label: "Buyer setup effort (minutes)" },
    { key: "reviewMinutes", label: "Buyer review effort (minutes)" },
    { key: "reworkMinutes", label: "Buyer rework effort (minutes)" },
  ] },
  { title: "Platform cash", help: "Service revenue excludes operator-reward pass-through. Record platform-funded rewards or subsidies in support costs. Include retries, storage and acquisition costs.", fields: [
    { key: "serviceRevenueUsd", label: "Platform service revenue (USD)" },
    { key: "computeUsd", label: "Platform compute / storage / retries (USD)" },
    { key: "supportUsd", label: "Support / subsidies / acquisition (USD)" },
    { key: "paymentFeesUsd", label: "Payment fees (USD)" },
  ] },
  { title: "Platform labor", help: "Record delivery, support and dispute effort. Leave the rate at 0 when unknown; labor-inclusive contribution remains uncalculated.", fields: [
    { key: "platformMinutes", label: "Platform labor (minutes)" },
    { key: "platformHourlyUsd", label: "Platform hourly rate (USD/hour)" },
  ] },
  { title: "Operator economics", help: "Compensation is manually recorded. Include compute and effort across winning and losing attempts; submission costs are not automatically copied into this ledger. A 0 hourly rate is treated as unknown.", fields: [
    { key: "operatorPaidUsd", label: "Operator compensation paid (USD)" },
    { key: "operatorComputeUsd", label: "Operator total compute cost (USD)" },
    { key: "operatorMinutes", label: "Operator total effort (minutes)" },
    { key: "operatorHourlyUsd", label: "Operator hourly rate (USD/hour)" },
  ] },
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function LedgerPanel({ task, user, busy, busyAction, runAction }: {
  task: PilotTask;
  user: PilotUser;
  busy: boolean;
  busyAction: string | null;
  runAction: TaskActionRunner;
}) {
  const owner = task.ownerId === user.id;
  const ledger = task.ledger;
  const economics = calculatePilotLedger(ledger);
  const signClass = (value: number | null) => value === null || value === 0 ? "" : value > 0 ? "vp-detail-positive" : "vp-detail-negative";

  return <section className="vp-panel vp-detail-section vp-detail-ledger" id="vp-task-ledger" aria-labelledby="vp-ledger-title">
    <div className="vp-detail-section-heading"><div><p className="vp-detail-kicker">03 / ECONOMICS</p><h2 id="vp-ledger-title">Cost ledger</h2></div><span className="vp-badge"><BookOpen size={13} aria-hidden="true" /> Manual bookkeeping</span></div>
    <p className="vp-muted">Recorded costs, effort and payment references. Saving this ledger does not transfer funds or independently confirm that a payment occurred.</p>
    <div className="vp-detail-payment"><div><span className="vp-muted">Recorded payment status</span><strong className="vp-badge" data-status={ledger.paymentStatus}>{ledger.paymentStatus}</strong></div><div><span className="vp-muted">Payment / invoice reference</span><p className="vp-detail-preserve">{ledger.paymentReference || "No payment reference recorded."}</p></div></div>

    <div className="vp-detail-economics">
      <div className="vp-detail-economic-card"><span className="vp-detail-kicker">BUYER VALUE</span><h3>Net time released</h3><strong className={signClass(economics.buyerNetMinutes)}>{economics.buyerNetMinutes === null ? "Baseline unknown" : `${economics.buyerNetMinutes.toLocaleString()} min`}</strong><p>Baseline − setup − review − rework</p><dl><div><dt>Recorded baseline</dt><dd>{ledger.baselineMinutes > 0 ? `${ledger.baselineMinutes} min` : "Not recorded"}</dd></div><div><dt>Pilot buyer effort</dt><dd>{economics.buyerMinutes} min</dd></div></dl><small>Time comparison only. No buyer dollar savings are calculated.</small></div>
      <div className="vp-detail-economic-card"><span className="vp-detail-kicker">PLATFORM</span><h3>Cash contribution</h3><strong className={signClass(economics.platformCashUsd)}>{money(economics.platformCashUsd)}</strong><p>Service revenue − compute − support − fees</p><dl><div><dt>Recorded labor value</dt><dd>{economics.platformLaborUsd === null ? "Rate unknown" : money(economics.platformLaborUsd)}</dd></div><div><dt>Labor-inclusive contribution</dt><dd className={signClass(economics.platformContributionUsd)}>{economics.platformContributionUsd === null ? "Not calculated" : money(economics.platformContributionUsd)}</dd></div></dl><small>Operator-reward pass-through is excluded from service revenue.</small></div>
      <div className="vp-detail-economic-card"><span className="vp-detail-kicker">OPERATOR</span><h3>After compute</h3><strong className={signClass(economics.operatorCashUsd)}>{money(economics.operatorCashUsd)}</strong><p>Recorded compensation − operator compute</p><dl><div><dt>Recorded effort value</dt><dd>{economics.operatorLaborUsd === null ? "Rate unknown" : money(economics.operatorLaborUsd)}</dd></div><div><dt>Labor-inclusive return</dt><dd className={signClass(economics.operatorContributionUsd)}>{economics.operatorContributionUsd === null ? "Not calculated" : money(economics.operatorContributionUsd)}</dd></div></dl><small>Includes only costs recorded here, not an assumed win rate.</small></div>
    </div>
    <p className="vp-detail-ledger-note">These are calculations over recorded entries, not validated business results. Missing baselines or rates remain unknown; agreed prices are shown in the task scope, not counted as received revenue.</p>
    {owner ? <LedgerEditor key={JSON.stringify(ledger)} task={task} busy={busy} busyAction={busyAction} runAction={runAction} /> : <div className="vp-detail-ledger-readonly"><p className="vp-muted">The task owner maintains this ledger.</p>{groups.map(group => <div key={group.title}><h3>{group.title}</h3><dl className="vp-detail-ledger-values">{group.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{ledger[field.key].toLocaleString()}</dd></div>)}</dl></div>)}</div>}
  </section>;
}

function LedgerEditor({ task, busy, busyAction, runAction }: {
  task: PilotTask;
  busy: boolean;
  busyAction: string | null;
  runAction: TaskActionRunner;
}) {
  const [error, setError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(task.ledger.paymentStatus);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const next: PilotLedger = { ...task.ledger };
    for (const field of groups.flatMap(group => group.fields)) {
      const raw = String(form.get(field.key) ?? "").trim();
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value < 0) {
        setError(`${field.label}: enter a finite, non-negative number.`);
        return;
      }
      next[field.key] = value;
    }
    next.paymentStatus = paymentStatus;
    next.paymentReference = String(form.get("paymentReference") ?? "").trim();
    if (paymentStatus === "paid" && !next.paymentReference) {
      setError("Record the actual payment reference before marking the manual ledger paid.");
      return;
    }
    await runAction("save-ledger", () => pilotRequest<{ task: PilotTask }>(`/tasks/${encodeURIComponent(task.id)}/ledger`, { ...jsonBody(next), method: "PATCH" }), "Manual ledger saved. No funds were transferred.");
  };

  return <details className="vp-detail-ledger-editor" open>
    <summary>Edit recorded costs & payment status</summary>
    <form onSubmit={save} aria-busy={busyAction === "save-ledger"}>
      {error && <p className="vp-error" role="alert">{error}</p>}
      <fieldset className="vp-detail-fieldset" disabled={busy}>
        {groups.map(group => <div className="vp-detail-ledger-group" key={group.title}><h3>{group.title}</h3><p className="vp-muted">{group.help}</p><div className="vp-grid vp-detail-form-grid">{group.fields.map(field => <label className="vp-field" key={field.key}><span>{field.label}</span><input type="number" name={field.key} min="0" max={field.key.endsWith("Minutes") ? "1000000" : "1000000000"} step="0.01" defaultValue={task.ledger[field.key]} required inputMode="decimal" /></label>)}</div></div>)}
        <div className="vp-detail-ledger-group"><h3>Manual payment record</h3><p className="vp-muted">Record your existing invoice/payment process. Paid status requires a reference; this is not a Vector payment receipt.</p><div className="vp-grid vp-detail-form-grid"><label className="vp-field"><span>Manual payment status</span><select name="paymentStatus" value={paymentStatus} onChange={event => setPaymentStatus(event.target.value as PaymentStatus)}><option value="unpaid">Unpaid</option><option value="invoiced">Invoiced</option><option value="paid">Paid · manually recorded</option></select></label><label className="vp-field"><span>Payment / invoice reference</span><input name="paymentReference" defaultValue={task.ledger.paymentReference} required={paymentStatus === "paid"} maxLength={2000} placeholder="Actual invoice or payment reference" /></label></div></div>
        <div className="vp-detail-form-footer"><p className="vp-muted">Owner-entered entries. Review minutes are added when decisions are recorded; adjust the total here without counting them twice.</p><button className="vp-button" type="submit"><Save size={15} aria-hidden="true" />{busyAction === "save-ledger" ? "Saving ledger…" : "Save ledger"}</button></div>
      </fieldset>
    </form>
  </details>;
}
