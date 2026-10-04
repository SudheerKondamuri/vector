"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Compass, MailCheck,
  ClipboardList, Clock3, FileCode2, FolderOpen, GitCommitHorizontal, LayoutDashboard,
  LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Search, ShieldCheck, UserRound, Users, X,
} from "lucide-react";
import { jsonBody, pilotRequest, PilotRequestError } from "@/lib/pilot-client";
import type { PilotEvent, PilotList, PilotSession, PilotTask, PilotUser, TaskStatus } from "@/lib/pilot-types";
import { TaskDetail } from "./task-detail";
import { WorkspaceAuth, WorkspaceBrand } from "./workspace-auth";
import { WorkspaceBuilder } from "./workspace-builder";
import { filterWorkspaceTasks, workspaceTaskSummary, type WorkspaceTaskFilter } from "./workspace-validation";
import { WalletConnectButton } from "./wallet-connect-button";
import { MarketplaceView, ProfileAccessView } from "./marketplace-view";
import "./workspace.css";

type WorkspaceView = "overview" | "tasks" | "discover" | "activity" | "profile" | "guide";
const navigation = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "discover", label: "Network", icon: Compass },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "profile", label: "Profile", icon: UserRound },
  { key: "guide", label: "Guide", icon: BookOpen },
] as const;
const statuses: Record<TaskStatus, string> = { draft: "Draft", open: "Open", review: "In review", accepted: "Accepted", archived: "Archived" };
const taskHref = (id: string) => `/workspace?view=tasks&task=${encodeURIComponent(id)}`;
const date = (value: string, time = false) => new Date(value).toLocaleString(undefined, time
  ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
  : { month: "short", day: "numeric", year: "numeric" });
const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

export function WorkspaceLoading() {
  return <div className="vp-workspace"><div className="vp-session-loading"><WorkspaceBrand /><div className="vp-loading" role="status"><LoaderCircle className="vp-spin" size={23} aria-hidden="true" /><h1>Opening your workspace.</h1><p>Restoring your saved session…</p></div></div></div>;
}

export default function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "error">("loading");
  const [sessionError, setSessionError] = useState("");
  const [user, setUser] = useState<PilotUser | null>(null);
  const [authNotice, setAuthNotice] = useState("");
  const [data, setData] = useState<PilotList | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const logoutLock = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const rawView = params.get("view");
  const view: WorkspaceView = navigation.some(item => item.key === rawView) ? rawView as WorkspaceView : "overview";
  const taskId = params.get("task");
  const resetToken = params.get("reset");
  const create = params.get("create");
  const fixture = !taskId && (create === "reference" || create === "external") ? create : null;
  const activeView = taskId || fixture ? "tasks" : view;
  const currentLabel = navigation.find(item => item.key === activeView)!.label;

  const sessionExpired = useCallback(() => {
    setUser(null);
    setData(null);
    setLoadedAt("");
    setNotice("");
    setAuthNotice("Your session has ended. Log in to continue with your saved tasks.");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSessionState("loading");
    setSessionError("");
    async function restore() {
      let verificationNotice = "";
      if (params.get("verify")) {
        try {
          await pilotRequest<{ user: PilotUser }>("/auth/verify-email", { ...jsonBody({ token: params.get("verify") }), signal: controller.signal });
          verificationNotice = "Email verified. Your workspace is ready.";
        } catch (cause) {
          verificationNotice = cause instanceof Error ? cause.message : "The verification link could not be used.";
        }
        if (verificationNotice) setAuthNotice(verificationNotice);
        if (!controller.signal.aborted) router.replace("/workspace", { scroll: false });
      }
      const session = await pilotRequest<PilotSession>("/auth", { signal: controller.signal });
      if (controller.signal.aborted) return;
      setUser(session.user);
      if (!session.user && verificationNotice) setAuthNotice(verificationNotice);
      setSessionState("ready");
    }
    restore().catch(cause => {
      if (controller.signal.aborted) return;
      setSessionError(cause instanceof Error ? cause.message : "Could not restore your session.");
      setSessionState("error");
    });
    return () => controller.abort();
  }, [params, router, sessionAttempt]);

  useEffect(() => {
    if (!user || user.emailVerified === false) return;
    const controller = new AbortController();
    setListBusy(true);
    setListError("");
    pilotRequest<PilotList>("/tasks", { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setData(result);
      setLoadedAt(new Date().toISOString());
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof PilotRequestError && cause.status === 401) { sessionExpired(); return; }
      setListError(cause instanceof Error ? cause.message : "Could not load your tasks.");
    }).finally(() => { if (!controller.signal.aborted) setListBusy(false); });
    return () => controller.abort();
  }, [user, listVersion, sessionExpired]);

  useEffect(() => {
    if (user) {
      mainRef.current?.focus({ preventScroll: true });
      // Account forms and sticky mobile navigation must not leave the new heading offscreen.
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [activeView, taskId, fixture, user]);

  const refresh = () => setListVersion(value => value + 1);
  const startTask = (kind: "reference" | "external") => router.push(`/workspace?view=tasks&create=${kind}`);
  const taskCreated = (task: PilotTask) => {
    setData(previous => previous ? { ...previous, tasks: [task, ...previous.tasks.filter(item => item.id !== task.id)] } : null);
    setNotice("Draft saved. Review the brief, then publish when you’re ready.");
    refresh();
    router.push(taskHref(task.id));
  };

  async function logout() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setLogoutBusy(true);
    setActionError("");
    try {
      await pilotRequest("/auth/logout", jsonBody({}));
      setUser(null);
      setData(null);
      setLoadedAt("");
      setNotice("");
      setAuthNotice("You’ve logged out. Your tasks and evidence remain saved on this server.");
      router.replace("/workspace");
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not log out. Please try again."); }
    finally { logoutLock.current = false; setLogoutBusy(false); }
  }

  if (sessionState === "loading") return <WorkspaceLoading />;
  if (sessionState === "error") return <div className="vp-workspace"><div className="vp-session-loading"><WorkspaceBrand /><section className="vp-panel vp-session-error"><LockKeyhole size={25} aria-hidden="true" /><h1>Your session couldn’t be restored.</h1><p className="vp-error" role="alert">{sessionError}</p><p className="vp-muted">The server may be unavailable. Retry to open your saved workspace.</p><button type="button" className="vp-button" onClick={() => setSessionAttempt(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Retry connection</button><Link href="/" className="vp-text-button">Back to Vector<ArrowUpRight size={14} aria-hidden="true" /></Link></section></div></div>;
  if (resetToken) return <PasswordResetForm token={resetToken} onComplete={() => { setAuthNotice("Your password was reset. Sign in with the new password."); router.replace("/workspace", { scroll: false }); setSessionAttempt(value => value + 1); }} />;
  if (!user) return <div className="vp-workspace"><WorkspaceAuth notice={authNotice || (params.get("invite") ? "Your invitation is ready. Create an account to join this workspace." : undefined)} initialInvitationToken={params.get("invite") || undefined} onSignedIn={account => { setData(null); setListBusy(true); setAuthNotice(""); setActionError(""); setUser(account); }} /></div>;
  if (user.emailVerified === false) return <EmailVerificationRequired user={user} onLogout={logout} />;

  return (
    <div className="vp-workspace vp-shell">
      <a href="#workspace-main" className="vp-skip-link">Skip to workspace</a>
      <aside className="vp-sidebar" aria-label="Workspace sidebar">
        <WorkspaceBrand />
        <div className="vp-workspace-tag"><span className="vp-workspace-symbol"><FolderOpen size={17} aria-hidden="true" /></span><div><strong>Your workspace</strong><span>Persistent · single server</span></div><LockKeyhole size={12} aria-hidden="true" /></div>
        <div className="vp-nav-label">WORKSPACE</div>
        <nav className="vp-navigation" aria-label="Workspace navigation">{navigation.map(item => <Link href={`/workspace?view=${item.key}`} key={item.key} className={`vp-nav-item${activeView === item.key ? " vp-nav-item-active" : ""}`} aria-current={activeView === item.key ? "page" : undefined}><item.icon size={18} aria-hidden="true" /><span>{item.label}</span>{item.key === "tasks" && data && <span className="vp-nav-count">{data.tasks.length}</span>}{item.key === "activity" && data && <span className="vp-nav-count">{data.events.length}</span>}</Link>)}</nav>
        <div className="vp-sidebar-bottom">
          <Link href="/workspace?view=guide" className="vp-sidebar-guide"><span className="vp-sidebar-guide-icon"><CircleHelp size={18} aria-hidden="true" /></span><strong>Evidence before acceptance.</strong><span>A quick guide to the pilot’s verification and payment records.</span><span className="vp-sidebar-guide-link">Read the guide<ArrowRight size={13} aria-hidden="true" /></span></Link>
          <Link href="/arena" className="vp-simulation-link">Legacy simulation<ArrowUpRight size={14} aria-hidden="true" /></Link>
          <div className="vp-profile"><span className="vp-avatar" aria-hidden="true">{user.name.trim().slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.email}</span></div></div>
          <button type="button" className="vp-logout" disabled={logoutBusy} onClick={logout}>{logoutBusy ? <LoaderCircle className="vp-spin" size={15} aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />}{logoutBusy ? "Logging out…" : "Log out"}</button>
        </div>
      </aside>

      <div className="vp-main-shell">
        <header className="vp-topbar"><div className="vp-breadcrumb"><span>Workspace</span><ChevronRight size={13} aria-hidden="true" /><strong>{currentLabel}</strong>{(taskId || fixture) && <><ChevronRight size={13} aria-hidden="true" /><span>{fixture ? "New draft" : "Task detail"}</span></>}</div><div className="vp-topbar-actions"><WalletConnectButton /><span className="vp-server-label"><span className="vp-status-dot" />SAVED ON SERVER</span><button type="button" className="vp-icon-button" onClick={refresh} disabled={listBusy} aria-label="Refresh workspace" title="Refresh workspace"><RefreshCw size={16} className={listBusy ? "vp-spin" : undefined} aria-hidden="true" /></button>{!fixture && !taskId && <button type="button" className="vp-button vp-button-small" onClick={() => startTask("external")}><Plus size={15} aria-hidden="true" /><span>New task</span></button>}</div></header>
        <main className="vp-main" id="workspace-main" tabIndex={-1} ref={mainRef}>
          {notice && <div className="vp-success-notice" role="status"><Check size={17} aria-hidden="true" /><span>{notice}</span><button type="button" className="vp-icon-button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} aria-hidden="true" /></button></div>}
          {actionError && <div className="vp-error" role="alert">{actionError}</div>}
          {listError && <div className="vp-error vp-load-error" role="alert"><div><strong>Workspace refresh failed.</strong><p>{listError}{data && loadedAt ? ` Showing your last loaded records from ${date(loadedAt, true)}.` : " Your saved records have not been loaded."}</p></div><button type="button" className="vp-button-secondary" onClick={refresh} disabled={listBusy}>Retry</button></div>}
          {taskId ? <TaskDetail key={taskId} taskId={taskId} user={user} onBack={() => router.push("/workspace?view=tasks")} onChanged={() => { setNotice(""); refresh(); }} />
            : fixture ? <WorkspaceBuilder key={fixture} fixture={fixture} onCancel={() => { refresh(); router.push("/workspace?view=tasks"); }} onCreated={taskCreated} onSessionExpired={sessionExpired} />
              : view === "guide" ? <WorkspaceGuide onReference={() => startTask("reference")} />
                : !data ? <WorkspaceDataLoading busy={listBusy} />
                  : view === "tasks" ? <WorkspaceTasks data={data} user={user} onCreate={() => startTask("external")} onReference={() => startTask("reference")} />
                       : view === "discover" ? <MarketplaceView user={user} onSessionExpired={sessionExpired} />
                       : view === "profile" ? <ProfileAccessView user={user} onSignedOut={sessionExpired} onSessionExpired={sessionExpired} />
                       : view === "activity" ? <WorkspaceActivity data={data} />
                      : <WorkspaceOverview data={data} user={user} onCreate={() => startTask("external")} onReference={() => startTask("reference")} />}
          {loadedAt && !taskId && !fixture && view !== "guide" && <footer className="vp-content-footer"><span><LockKeyhole size={12} aria-hidden="true" />Only your briefs and tasks you’re invited to.</span><span>{listBusy ? "Refreshing…" : `Loaded ${date(loadedAt, true)}`}</span></footer>}
        </main>
      </div>
    </div>
  );
}

function WorkspaceDataLoading({ busy }: { busy: boolean }) {
  return <section className="vp-data-loading" aria-busy={busy}><div className="vp-loading" role="status">{busy && <LoaderCircle className="vp-spin" size={22} aria-hidden="true" />}<h1>{busy ? "Loading your workspace." : "Your records aren’t available yet."}</h1><p>{busy ? "Reading your saved tasks and audit events…" : "Use Retry above to reconnect to the server."}</p></div>{busy && <div className="vp-skeleton-grid" aria-hidden="true"><div /><div /><div /><div /></div>}</section>;
}

function EmailVerificationRequired({ user, onLogout }: { user: PilotUser; onLogout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function resend() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await pilotRequest<{ message: string }>("/auth/resend-verification", jsonBody({}));
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send a verification email.");
    } finally { setBusy(false); }
  }

  return <div className="vp-workspace"><div className="vp-session-loading"><WorkspaceBrand /><section className="vp-panel vp-session-error" aria-labelledby="vp-verify-title"><MailCheck size={29} aria-hidden="true" /><h1 id="vp-verify-title">Verify your email.</h1><p className="vp-muted">We sent a verification link to <strong>{user.email}</strong>. Verify it before opening saved tasks and marketplace features.</p>{error && <p className="vp-error" role="alert">{error}</p>}{notice && <p className="vp-notice" role="status">{notice}</p>}<button type="button" className="vp-button" onClick={resend} disabled={busy}>{busy ? "Sending…" : "Send another verification email"}</button><button type="button" className="vp-text-button" onClick={onLogout}>Log out</button></section></div></div>;
}

function PasswordResetForm({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12 || password.length > 256) { setError("Use a password with 12–256 characters."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true);
    setError("");
    try {
      await pilotRequest("/auth/reset-password", jsonBody({ token, password }));
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The password could not be reset.");
    } finally { setBusy(false); }
  }

  return <div className="vp-workspace"><div className="vp-session-loading"><WorkspaceBrand /><section className="vp-panel vp-session-error" aria-labelledby="vp-reset-title"><LockKeyhole size={29} aria-hidden="true" /><h1 id="vp-reset-title">Choose a new password.</h1><p className="vp-muted">Use a unique password with at least 12 characters. Your existing sessions will be signed out.</p>{error && <p className="vp-error" role="alert">{error}</p>}<form className="vp-auth-fields" onSubmit={submit}><div className="vp-field"><label htmlFor="vp-reset-password">New password</label><input id="vp-reset-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={256} required /></div><div className="vp-field"><label htmlFor="vp-reset-confirmation">Confirm new password</label><input id="vp-reset-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={12} maxLength={256} required /></div><button type="submit" className="vp-button" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button></form></section></div></div>;
}

function TaskCard({ task, userId }: { task: PilotTask; userId: string }) {
  const owned = task.ownerId === userId;
  return <article className="vp-task-card vp-panel"><Link href={taskHref(task.id)} className="vp-task-card-link" aria-label={`Open task: ${task.title}`}><div className="vp-task-card-top"><span className="vp-task-icon"><FileCode2 size={18} aria-hidden="true" /></span><span className={`vp-badge vp-status-${task.status}`}><span className="vp-badge-dot" />{statuses[task.status]}</span></div><div className="vp-task-role">{owned ? "YOUR BRIEF" : `INVITED · ${task.ownerName}`}</div><h3>{task.title}</h3><p className="vp-task-description">{task.description}</p><div className="vp-task-target"><GitCommitHorizontal size={13} aria-hidden="true" /><span>{task.target}</span></div><div className="vp-task-card-meta"><span>{task.fixture === "reference" ? "Reference fixture" : "External repository"}</span><span>{task.minImprovementPct}% minimum</span></div><div className="vp-task-card-bottom"><span><Clock3 size={12} aria-hidden="true" />{date(task.deadline)}</span><strong>{task.fixture === "reference" ? "USD 0 exercise" : `${usd(task.priceUsd)} brief`}</strong><ArrowUpRight size={17} aria-hidden="true" /></div></Link></article>;
}

function WorkspaceOverview({ data, user, onCreate, onReference }: { data: PilotList; user: PilotUser; onCreate: () => void; onReference: () => void }) {
  const summary = workspaceTaskSummary(data.tasks, user.id);
  const recent = [...data.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  return <>
    <div className="vp-page-heading"><div><div className="vp-eyebrow">THE WORK, ON THE RECORD</div><h1>From brief to <em>proof.</em></h1><p>Your tasks, invitations and decisions. A clear view of what’s actually happening.</p></div><button type="button" className="vp-button" onClick={onCreate}><Plus size={17} aria-hidden="true" />Create task</button></div>
    <div className="vp-metrics" aria-label="Workspace task counts">
      <Metric label="Accessible tasks" value={summary.total} detail={`${summary.owned} sponsored by you`} icon={ClipboardList} />
      <Metric label="Active tasks" value={summary.active} detail="Open or in review" icon={Activity} />
      <Metric label="Your review queue" value={summary.needsReview} detail="Your briefs marked in review" icon={ShieldCheck} accent />
      <Metric label="Invited tasks" value={summary.invited} detail="Operator access by email" icon={Users} />
    </div>
    <div className="vp-overview-grid">
      <section className="vp-launchpad vp-panel"><div className="vp-eyebrow"><span className="vp-status-dot" />A KNOWN STARTING POINT</div><h2>Run a tighter<br /><em>feedback loop.</em></h2><p>Try the bundled gas-optimization fixture: a pinned scope, local reference checks and a reviewable patch. No paid brief required.</p><div className="vp-reference-flow" aria-label="Reference task workflow"><span><FileCode2 size={18} aria-hidden="true" /><small>PIN THE SCOPE</small></span><ArrowRight size={16} aria-hidden="true" /><span><ShieldCheck size={18} aria-hidden="true" /><small>CHECK THE PATCH</small></span><ArrowRight size={16} aria-hidden="true" /><span><Check size={18} aria-hidden="true" /><small>RECORD A REVIEW</small></span></div><div className="vp-launchpad-bottom"><button type="button" className="vp-button" onClick={onReference}>Start reference exercise<ArrowUpRight size={15} aria-hidden="true" /></button><span>USD 0 · bundled fixture</span></div></section>
      <section className="vp-progress-panel vp-panel" aria-labelledby="vp-next-heading"><div className="vp-section-heading"><h2 id="vp-next-heading">Move the work forward</h2><span className="vp-eyebrow">YOUR BRIEFS</span></div><Link href="/workspace?view=tasks&status=draft&ownership=owned" className="vp-next-row"><span className="vp-next-icon"><FileCode2 size={17} aria-hidden="true" /></span><div><strong>Drafts to shape</strong><small>Pin scope and terms before publishing</small></div><b>{summary.drafts}</b><ChevronRight size={16} aria-hidden="true" /></Link><Link href="/workspace?view=tasks&status=review&ownership=owned" className="vp-next-row"><span className="vp-next-icon vp-next-icon-lime"><ShieldCheck size={17} aria-hidden="true" /></span><div><strong>Reviews to record</strong><small>Read the evidence, explain the decision</small></div><b>{summary.needsReview}</b><ChevronRight size={16} aria-hidden="true" /></Link><div className="vp-progress-note"><LockKeyhole size={17} aria-hidden="true" /><p>Service prices and rewards are agreed terms. Payments are manual ledger records; Vector doesn’t collect or transfer funds.</p></div></section>
    </div>
    <section className="vp-recent-section"><div className="vp-section-heading"><div><span className="vp-eyebrow">IN YOUR WORKSPACE</span><h2>Recent tasks</h2></div><Link href="/workspace?view=tasks" className="vp-text-button">View all tasks<ArrowRight size={14} aria-hidden="true" /></Link></div>{recent.length ? <div className="vp-task-grid">{recent.map(task => <TaskCard key={task.id} task={task} userId={user.id} />)}</div> : <EmptyTasks onCreate={onCreate} />}</section>
    <section className="vp-recent-section"><div className="vp-section-heading"><div><span className="vp-eyebrow">RECORDED TASK ACTIVITY</span><h2>Latest events</h2></div><Link href="/workspace?view=activity" className="vp-text-button">View activity<ArrowRight size={14} aria-hidden="true" /></Link></div><EventList events={[...data.events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4)} tasks={data.tasks} /></section>
  </>;
}

function Metric({ label, value, detail, icon: Icon, accent = false }: { label: string; value: number; detail: string; icon: typeof Activity; accent?: boolean }) {
  return <div className={`vp-metric vp-panel${accent ? " vp-metric-accent" : ""}`}><div><span>{label}</span><Icon size={16} aria-hidden="true" /></div><strong>{value}</strong><small>{detail}</small></div>;
}

function EmptyTasks({ onCreate }: { onCreate: () => void }) {
  return <div className="vp-empty vp-panel"><span className="vp-empty-icon"><FolderOpen size={24} aria-hidden="true" /></span><h3>Your workspace starts with a brief.</h3><p>No tasks yet. Create a draft to sponsor work, or ask a sponsor to invite <strong>your account email</strong> to a task.</p><button type="button" className="vp-button-secondary" onClick={onCreate}><Plus size={15} aria-hidden="true" />Create your first task</button></div>;
}

function WorkspaceTasks({ data, user, onCreate, onReference }: { data: PilotList; user: PilotUser; onCreate: () => void; onReference: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const rawStatus = params.get("status");
  const status: WorkspaceTaskFilter["status"] = rawStatus && Object.keys(statuses).includes(rawStatus) ? rawStatus as TaskStatus : "all";
  const rawOwnership = params.get("ownership");
  const ownership: WorkspaceTaskFilter["ownership"] = rawOwnership === "owned" || rawOwnership === "invited" ? rawOwnership : "all";
  const filtered = useMemo(() => filterWorkspaceTasks(data.tasks, user.id, { search, status, ownership })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.tasks, user.id, search, status, ownership]);
  const summary = workspaceTaskSummary(data.tasks, user.id);

  function setFilter(key: "status" | "ownership", value: string) {
    const query = new URLSearchParams(params.toString());
    query.set("view", "tasks");
    if (value === "all") query.delete(key); else query.set(key, value);
    router.replace(`/workspace?${query.toString()}`, { scroll: false });
  }
  function reset() { setSearch(""); router.replace("/workspace?view=tasks", { scroll: false }); }

  return <>
    <div className="vp-page-heading"><div><div className="vp-eyebrow">A PRECISE BRIEF IS THE STARTING POINT</div><h1>Your tasks.</h1><p>Sponsor a brief or contribute as an invited operator. Every account can do both.</p></div><button type="button" className="vp-button-secondary" onClick={onReference}><FileCode2 size={16} aria-hidden="true" />Use reference preset</button></div>
    <div className="vp-task-toolbar vp-panel"><div className="vp-ownership-filters" role="group" aria-label="Task ownership">{([{ value: "all", label: "All tasks", count: summary.total }, { value: "owned", label: "My briefs", count: summary.owned }, { value: "invited", label: "Invited to me", count: summary.invited }] as const).map(item => <button key={item.value} type="button" aria-pressed={ownership === item.value} className={ownership === item.value ? "vp-filter-active" : ""} onClick={() => setFilter("ownership", item.value)}>{item.label}<span>{item.count}</span></button>)}</div><div className="vp-task-search-row"><div className="vp-field vp-search-field"><label htmlFor="vp-task-search" className="vp-sr-only">Search tasks</label><Search size={16} aria-hidden="true" /><input id="vp-task-search" type="search" placeholder="Search title, target or sponsor…" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="vp-field vp-filter-select"><label htmlFor="vp-task-status" className="vp-sr-only">Task status</label><select id="vp-task-status" value={status} onChange={event => setFilter("status", event.target.value)}><option value="all">All statuses</option>{Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></div></div>
    <div className="vp-results-label" role="status">{filtered.length} {filtered.length === 1 ? "task" : "tasks"}{search || status !== "all" || ownership !== "all" ? ` matching your filters · ${summary.total} accessible in total` : " in your workspace"}</div>
    {!data.tasks.length ? <EmptyTasks onCreate={onCreate} /> : filtered.length ? <div className="vp-task-grid">{filtered.map(task => <TaskCard key={task.id} task={task} userId={user.id} />)}</div> : <div className="vp-empty vp-panel"><span className="vp-empty-icon"><Search size={23} aria-hidden="true" /></span><h3>No tasks match these filters.</h3><p>Try another search or clear the filters to see all your accessible tasks.</p><button type="button" className="vp-button-secondary" onClick={reset}>Clear filters</button></div>}
  </>;
}

function EventList({ events, tasks, filtered = false }: { events: PilotEvent[]; tasks: PilotTask[]; filtered?: boolean }) {
  if (!events.length) return <div className="vp-empty vp-panel vp-empty-small"><span className="vp-empty-icon"><Activity size={22} aria-hidden="true" /></span><h3>{filtered ? "No events match your search." : "A clean activity record."}</h3><p>{filtered ? "Change the search or event type to see other records." : "Task creation, publication, submissions and reviews appear here as they happen. There’s no simulated activity."}</p></div>;
  return <ol className="vp-event-list vp-panel">{events.map(event => <li key={event.id}><span className="vp-event-marker"><Activity size={15} aria-hidden="true" /></span><div className="vp-event-copy"><div><strong>{event.message}</strong><time dateTime={event.at}>{date(event.at, true)}</time></div><p><span>{event.actorName}</span><span aria-hidden="true">·</span><span className="vp-event-type">{event.type.replace(/[._-]/g, " ")}</span></p>{event.taskId ? <Link href={taskHref(event.taskId)} className="vp-event-task">{tasks.find(task => task.id === event.taskId)?.title || "Open task record"}<ArrowUpRight size={12} aria-hidden="true" /></Link> : <span className="vp-event-account">Account event</span>}</div></li>)}</ol>;
}

function WorkspaceActivity({ data }: { data: PilotList }) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const types = [...new Set(data.events.map(event => event.type))].sort();
  const filtered = data.events.filter(event => (type === "all" || event.type === type)
    && (!search.trim() || [event.actorName, event.message, event.type, data.tasks.find(task => task.id === event.taskId)?.title || ""].some(value => value.toLowerCase().includes(search.trim().toLowerCase()))))
    .sort((a, b) => b.at.localeCompare(a.at));
  return <><div className="vp-page-heading"><div><div className="vp-eyebrow">THE AUDIT TRAIL</div><h1>Work leaves a record.</h1><p>Actual events from your tasks and invitations, newest first.</p></div><span className="vp-badge"><Activity size={12} aria-hidden="true" />{data.events.length} {data.events.length === 1 ? "EVENT" : "EVENTS"}</span></div><div className="vp-activity-toolbar"><div className="vp-field vp-search-field"><label className="vp-sr-only" htmlFor="vp-activity-search">Search activity</label><Search size={16} aria-hidden="true" /><input id="vp-activity-search" type="search" placeholder="Search events, people or tasks…" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="vp-field vp-filter-select"><label className="vp-sr-only" htmlFor="vp-activity-type">Event type</label><select id="vp-activity-type" value={type} onChange={event => setType(event.target.value)}><option value="all">All event types</option>{types.map(value => <option value={value} key={value}>{value.replace(/[._-]/g, " ")}</option>)}</select></div></div><div className="vp-results-label" role="status">{filtered.length} {filtered.length === 1 ? "event" : "events"}{search || type !== "all" ? " matching your filters" : " recorded"}</div><EventList events={filtered} tasks={data.tasks} filtered={!!search || type !== "all"} /></>;
}

function WorkspaceGuide({ onReference }: { onReference: () => void }) {
  return <div className="vp-guide"><div className="vp-page-heading"><div><div className="vp-eyebrow">THE PILOT, EXPLAINED</div><h1>Know what the<br /><em>evidence means.</em></h1><p>A practical loop for a bounded Solidity optimization task, with the limits kept visible.</p></div><span className="vp-guide-glyph" aria-hidden="true"><ShieldCheck size={40} strokeWidth={1.2} /></span></div>
    <section className="vp-panel vp-guide-process" aria-labelledby="vp-guide-process-title"><div className="vp-section-heading"><h2 id="vp-guide-process-title">One brief. One decision trail.</h2><span className="vp-eyebrow">THE WORKFLOW</span></div><div className="vp-guide-steps"><article><span>01 / DEFINE</span><h3>Save a draft.</h3><p>Pin a commit, allowed paths, benchmark target, threshold, deadline and submission cap. Agree review and payment terms.</p></article><article><span>02 / INVITE</span><h3>Publish the brief.</h3><p>Invite operators by email. They use their own accounts. Every account can sponsor its own tasks and work on invited tasks.</p></article><article><span>03 / EVIDENCE</span><h3>Submit a patch.</h3><p>Keep the patch within scope. Record effort and compute costs. Run reference checks or attach an external report.</p></article><article><span>04 / DECIDE</span><h3>Explain the review.</h3><p>Inspect the evidence and its limitations, then accept or reject with a reason. Export the task record for a durable handoff.</p></article></div></section>
    <div className="vp-guide-grid"><section className="vp-panel vp-guide-card vp-guide-card-reference"><span className="vp-guide-icon"><ShieldCheck size={23} aria-hidden="true" /></span><span className="vp-eyebrow">BUNDLED REFERENCE</span><h2>Local checks, real receipts.</h2><p>The reference preset uses <code>src/GasTarget.sol</code>, a fixed bundled commit and a USD 0 price. The server runs only this bundled fixture, producing checks, metrics, logs and replay details.</p><p>Read the evidence’s engine, environment and limitations. A successful reference run checks that fixture; it does not prove unrelated contracts are safe or verify customer demand.</p><button type="button" className="vp-button-secondary" onClick={onReference}>Try the reference preset<ArrowRight size={15} aria-hidden="true" /></button></section><section className="vp-panel vp-guide-card"><span className="vp-guide-icon vp-guide-icon-violet"><FileCode2 size={23} aria-hidden="true" /></span><span className="vp-eyebrow">EXTERNAL REPOSITORIES</span><h2>A report isn’t a verifier.</h2><p>The HTTPS repository link is saved as a pointer. Vector does not fetch a custom repository or execute its code. An operator runs checks externally and records the environment, metrics, logs and replay command.</p><p>These reports remain visibly <strong>unverified external evidence</strong>. The sponsor reviews the claims; recording a report does not independently confirm that its numbers or checks are true.</p></section></div>
    <section className="vp-panel vp-guide-practical" aria-labelledby="vp-guide-practical-title"><h2 id="vp-guide-practical-title">The practical details</h2><div><article><LockKeyhole size={20} aria-hidden="true" /><h3>Local, single-server storage</h3><p>Accounts, sessions, tasks and audit history persist in private files on this server. The browser uses a session cookie; backend records are not stored in localStorage. Access is limited to the sponsor and invited account emails.</p></article><article><ClipboardList size={20} aria-hidden="true" /><h3>Manual invoice records</h3><p>A service price and operator reward are brief terms, not a balance. Record invoices, actual payments, costs and time in the ledger. No checkout, escrow funding or automated transfer happens here.</p></article><article><BookOpen size={20} aria-hidden="true" /><h3>A separate simulation</h3><p>The original arena is an illustrative simulation with fictional agents and funds. Its state and claims are separate from these real accounts and server-saved task records.</p><Link href="/arena" className="vp-text-button">Open the legacy simulation<ArrowUpRight size={14} aria-hidden="true" /></Link></article></div></section>
  </div>;
}
