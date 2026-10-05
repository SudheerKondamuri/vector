"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, ArrowUpRight, Check, FileCode2, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { jsonBody, pilotRequest, PilotRequestError } from "@/lib/pilot-client";
import type { PilotSession, PilotUser } from "@/lib/pilot-types";
import { validateWorkspaceCredentials } from "./workspace-validation";

export function WorkspaceBrand() {
  return (
    <Link href="/" className="vp-brand" aria-label="Vector home">
      <svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M3 4.5 13 22 23 4.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="13" cy="4.5" r="2.7" fill="#d5fb78" /></svg>
      <span>VECTOR<span className="vp-brand-dot">.</span></span>
    </Link>
  );
}

export function WorkspaceAuth({ onSignedIn, notice, initialInvitationToken }: { onSignedIn: (user: PilotUser) => void; notice?: string; initialInvitationToken?: string }) {
  const [mode, setMode] = useState<"register" | "login">(notice && !initialInvitationToken ? "login" : "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationToken, setInvitationToken] = useState(initialInvitationToken || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [recovering, setRecovering] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const register = mode === "register";

  function switchMode(next: typeof mode) {
    setMode(next);
    setRecovering(false);
    setError("");
    setRecoveryNotice("");
    setFields({});
    setPassword("");
  }

  function beginRecovery() {
    setRecovering(true);
    setError("");
    setRecoveryNotice("");
    setFields({});
    setPassword("");
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
    event.preventDefault();
    const next = event.key === "Home" ? "register" : event.key === "End" ? "login" : register ? "login" : "register";
    switchMode(next);
    document.getElementById(next === "register" ? "vp-signup-tab" : "vp-login-tab")?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (recovering) {
      const recoveryEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
        setFields({ email: "Enter a valid email address." });
        setError("Check the highlighted fields to continue.");
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      submitting.current = true;
      setBusy(true);
      setError("");
      setRecoveryNotice("");
      try {
        const result = await pilotRequest<{ message: string }>("/auth/forgot-password", jsonBody({ email: recoveryEmail }));
        setRecoveryNotice(result.message);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not start account recovery.");
        requestAnimationFrame(() => errorRef.current?.focus());
      } finally {
        submitting.current = false;
        setBusy(false);
      }
      return;
    }
    const invalid = validateWorkspaceCredentials({ name, email, password }, register);
    setFields(invalid);
    setError("");
    if (Object.keys(invalid).length) {
      setError("Check the highlighted fields to continue.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const payload = { ...(register ? { name: name.trim(), ...(invitationToken.trim() ? { invitationToken: invitationToken.trim() } : {}) } : {}), email: email.trim().toLowerCase(), password };
      const session = await pilotRequest<PilotSession>(`/auth/${mode}`, jsonBody(payload));
      if (!session.user) throw new Error("The server did not return a signed-in account. Please try again.");
      setPassword("");
      onSignedIn(session.user);
    } catch (cause) {
      setFields(cause instanceof PilotRequestError ? cause.fields : {});
      setError(cause instanceof Error ? cause.message : "Could not connect. Please try again.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function clearField(key: string) {
    setFields(previous => { const next = { ...previous }; delete next[key]; return next; });
  }

  return (
    <div className="vp-auth">
      <header className="vp-auth-top"><WorkspaceBrand /><span className="vp-eyebrow"><span className="vp-status-dot" />PERSISTENT WORKSPACE</span></header>
      <main className="vp-auth-layout" id="workspace-main">
        <section className="vp-auth-story" aria-labelledby="vp-auth-story-title">
          <div className="vp-eyebrow">A SMALLER LOOP. A REAL RESULT.</div>
          <h1 id="vp-auth-story-title">Good work.<br /><em>Show the proof.</em></h1>
          <p className="vp-auth-lede">One place to define the task, invite an operator and review the evidence. From a precise brief to a recorded decision.</p>
          <div className="vp-auth-proof" aria-label="The task workflow">
            <div><span className="vp-auth-proof-icon"><FileCode2 size={19} aria-hidden="true" /></span><strong>Define</strong><small>A pinned commit &amp; bounded scope</small></div>
            <span className="vp-auth-proof-connector" aria-hidden="true" />
            <div><span className="vp-auth-proof-icon vp-auth-proof-violet"><ShieldCheck size={19} aria-hidden="true" /></span><strong>Verify</strong><small>Evidence with visible limitations</small></div>
            <span className="vp-auth-proof-connector" aria-hidden="true" />
            <div><span className="vp-auth-proof-icon vp-auth-proof-lime"><Check size={19} aria-hidden="true" /></span><strong>Decide</strong><small>A human review, on the record</small></div>
          </div>
          <div className="vp-auth-story-foot"><span>VECTOR / WORKSPACE 01</span><Link href="/arena">Explore the simulation <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        </section>

        <section className="vp-auth-card vp-panel" aria-labelledby="vp-auth-title">
           {!recovering && <div className="vp-auth-tabs" role="tablist" aria-label="Account access">
             <button type="button" role="tab" aria-selected={register} aria-controls="vp-auth-form" id="vp-signup-tab" tabIndex={register ? 0 : -1} disabled={busy} onKeyDown={tabKey} onClick={() => switchMode("register")}>Sign up</button>
             <button type="button" role="tab" aria-selected={!register} aria-controls="vp-auth-form" id="vp-login-tab" tabIndex={!register ? 0 : -1} disabled={busy} onKeyDown={tabKey} onClick={() => switchMode("login")}>Log in</button>
           </div>}
           {recovering && <button type="button" className="vp-text-button" onClick={() => switchMode("login")} disabled={busy}>← Back to sign in</button>}
           <div className="vp-auth-card-heading"><span className="vp-auth-lock"><LockKeyhole size={20} aria-hidden="true" /></span><h2 id="vp-auth-title">{recovering ? "Recover your account." : register ? "Make it your workspace." : "Welcome back."}</h2><p>{recovering ? "Enter your account email and we’ll send a time-limited password reset link." : register ? "Create a real account. Sponsor tasks and contribute to briefs you’re invited to." : "Log in to your saved tasks, invitations and review history."}</p></div>
           {notice && <p className="vp-notice" role="status">{notice}</p>}
           {recoveryNotice && <p className="vp-notice" role="status">{recoveryNotice}</p>}
            <form id="vp-auth-form" role="tabpanel" aria-labelledby={recovering ? "vp-auth-title" : register ? "vp-signup-tab" : "vp-login-tab"} onSubmit={submit} noValidate aria-busy={busy}>
             {error && <div className="vp-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
             <fieldset disabled={busy} className="vp-auth-fields">
               {register && !recovering && <div className="vp-field"><label htmlFor="vp-auth-name">Your name</label><input id="vp-auth-name" name="name" autoComplete="name" value={name} onChange={event => { setName(event.target.value); clearField("name"); }} placeholder="How should we address you?" maxLength={100} required aria-invalid={!!fields.name} aria-describedby={fields.name ? "vp-auth-name-error" : undefined} />{fields.name && <span className="vp-field-error" id="vp-auth-name-error">{fields.name}</span>}</div>}
               <div className="vp-field"><label htmlFor="vp-auth-email">Email address</label><input id="vp-auth-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={event => { setEmail(event.target.value); clearField("email"); }} placeholder="you@yourteam.com" maxLength={254} required aria-invalid={!!fields.email} aria-describedby={fields.email ? "vp-auth-email-error" : undefined} />{fields.email && <span className="vp-field-error" id="vp-auth-email-error">{fields.email}</span>}</div>
               {register && !recovering && <div className="vp-field"><label htmlFor="vp-auth-invitation">Invitation token <span className="vp-muted">(required for invite-only deployments)</span></label><input id="vp-auth-invitation" name="invitationToken" autoCapitalize="none" spellCheck={false} value={invitationToken} onChange={event => { setInvitationToken(event.target.value); clearField("invitationToken"); }} placeholder="Paste your invitation token" maxLength={43} aria-invalid={!!fields.invitationToken} aria-describedby={fields.invitationToken ? "vp-auth-invitation-error" : undefined} />{fields.invitationToken && <span className="vp-field-error" id="vp-auth-invitation-error">{fields.invitationToken}</span>}</div>}
               {!recovering && <div className="vp-field"><label htmlFor="vp-auth-password">Password</label><input id="vp-auth-password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => { setPassword(event.target.value); clearField("password"); }} placeholder={register ? "At least 12 characters" : "Your account password"} minLength={register ? 12 : 1} maxLength={256} required aria-invalid={!!fields.password} aria-describedby={fields.password ? "vp-auth-password-error" : "vp-auth-password-help"} />{fields.password ? <span className="vp-field-error" id="vp-auth-password-error">{fields.password}</span> : <span className="vp-field-help" id="vp-auth-password-help">{register ? "Use a unique password. Your session is restored with a server cookie." : "Use the password you created for this server."}</span>}</div>}
               <button className="vp-button vp-auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="vp-spin" size={16} aria-hidden="true" />{recovering ? "Sending…" : register ? "Creating account…" : "Logging in…"}</> : <>{recovering ? "Send recovery email" : register ? "Create account" : "Log in"}<ArrowRight size={17} aria-hidden="true" /></>}</button>
             </fieldset>
           </form>
           {!register && !recovering && <button type="button" className="vp-text-button vp-auth-recovery" onClick={beginRecovery} disabled={busy}>Forgot your password?</button>}
           <p className="vp-auth-storage"><LockKeyhole size={13} aria-hidden="true" />Accounts and tasks are saved on this server. No demo accounts or simulated balances.</p>
        </section>
      </main>
      <footer className="vp-auth-footer"><span>PRECISE BRIEFS. LEGIBLE EVIDENCE.</span><span>REFERENCE VERIFICATION + MANUAL REVIEW</span></footer>
    </div>
  );
}
