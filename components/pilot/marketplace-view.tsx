"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, Check, CircleDot, Code2, Copy, KeyRound,
  LoaderCircle, PauseCircle, Save, Search, ShieldCheck, UserRound, X,
} from "lucide-react";
import { jsonBody, pilotRequest, PilotRequestError } from "../../lib/pilot-client";
import type { MarketplaceProfile, PilotTask, PilotUser } from "../../lib/pilot-types";

type MarketplaceToken = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string; revokedAt?: string };

const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export function MarketplaceView({ user, onSessionExpired }: { user: PilotUser; onSessionExpired: () => void }) {
  const [tab, setTab] = useState<"tasks" | "operators">("tasks");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<PilotTask[]>([]);
  const [profiles, setProfiles] = useState<MarketplaceProfile[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reserved, setReserved] = useState<Set<string>>(new Set());
  const [reserving, setReserving] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      const endpoint = tab === "tasks" ? `/marketplace/tasks?q=${encodeURIComponent(search.trim())}` : `/marketplace/profiles?q=${encodeURIComponent(search.trim())}`;
      pilotRequest<{ tasks?: PilotTask[]; profiles?: MarketplaceProfile[] }>(endpoint, { signal: controller.signal })
        .then(result => {
          if (controller.signal.aborted) return;
          if (tab === "tasks") setTasks(result.tasks || []); else setProfiles(result.profiles || []);
        })
        .catch(cause => { if (controller.signal.aborted) return; if (cause instanceof PilotRequestError && cause.status === 401) { onSessionExpired(); return; } setError(cause instanceof Error ? cause.message : "The network could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, search ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [onSessionExpired, search, tab, user.id]);

  async function reserve(task: PilotTask) {
    if (reserving) return;
    setReserving(task.id);
    setError("");
    try {
      const result = await pilotRequest<{ reservation: { expiresAt: string } }>(`/tasks/${encodeURIComponent(task.id)}/reserve`, jsonBody({}));
      setReserved(previous => new Set(previous).add(task.id));
      setNotice(`Slot reserved until ${date(result.reservation.expiresAt)}. Open the brief to submit your patch.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not be reserved.");
    } finally { setReserving(null); }
  }

  return <>
    <div className="vp-page-heading vp-marketplace-heading">
      <div><div className="vp-eyebrow"><CircleDot size={11} aria-hidden="true" />THE OPEN NETWORK</div><h1>Work with a<br /><em>proof trail.</em></h1><p>Discover bounded technical work, publish your own brief, and build a reputation around results that can be inspected.</p></div>
      <div className="vp-marketplace-heading-aside"><span className="vp-marketplace-signal"><i />Live discovery</span><span>Base Sepolia settlement is available on eligible accepted work.</span></div>
    </div>
    {notice && <div className="vp-success-notice" role="status"><Check size={17} aria-hidden="true" /><span>{notice}</span><button type="button" className="vp-icon-button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} aria-hidden="true" /></button></div>}
    {error && <div className="vp-error" role="alert">{error}</div>}
    <div className="vp-network-stats" aria-label="Network summary"><div><span>Open briefs</span><strong>{tasks.length}</strong><small>matched to your profile</small></div><div><span>Visible operators</span><strong>{profiles.length}</strong><small>available to collaborate</small></div><div><span>Trust rule</span><strong><ShieldCheck size={22} aria-hidden="true" /></strong><small>evidence before acceptance</small></div></div>
    <section className="vp-marketplace-panel vp-panel">
      <div className="vp-marketplace-toolbar"><div className="vp-marketplace-tabs" role="tablist" aria-label="Marketplace directory"><button type="button" role="tab" aria-selected={tab === "tasks"} onClick={() => setTab("tasks")}><Code2 size={16} aria-hidden="true" />Find briefs<span>{tasks.length}</span></button><button type="button" role="tab" aria-selected={tab === "operators"} onClick={() => setTab("operators")}><UserRound size={16} aria-hidden="true" />Find operators<span>{profiles.length}</span></button></div><label className="vp-field vp-marketplace-search"><span className="vp-sr-only">Search the network</span><Search size={16} aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === "tasks" ? "Search briefs, targets or constraints…" : "Search handles, capabilities or specialties…"} /></label></div>
      <div className="vp-marketplace-results-label" role="status">{busy ? "Searching the network…" : tab === "tasks" ? `${tasks.length} ${tasks.length === 1 ? "brief" : "briefs"} available to inspect` : `${profiles.length} ${profiles.length === 1 ? "operator" : "operators"} visible in the directory`}</div>
      {busy ? <MarketplaceSkeleton /> : tab === "tasks" ? <TaskDirectory tasks={tasks} reserved={reserved} reserving={reserving} onReserve={reserve} /> : <OperatorDirectory profiles={profiles} />}
    </section>
  </>;
}

function TaskDirectory({ tasks, reserved, reserving, onReserve }: { tasks: PilotTask[]; reserved: Set<string>; reserving: string | null; onReserve: (task: PilotTask) => void }) {
  if (!tasks.length) return <MarketplaceEmpty icon={<Code2 size={22} aria-hidden="true" />} title="No matching briefs yet." body="Published work appears here when its scope is open to your account. Add capabilities to your profile to improve matching." href="/workspace?view=profile" link="Tune your operator profile" />;
  return <div className="vp-directory-grid">{tasks.map(task => <article className="vp-directory-card" key={task.id}><div className="vp-directory-card-top"><span className="vp-badge vp-status-open"><span className="vp-badge-dot" />{task.status === "review" ? "In review" : "Open"}</span><span className="vp-directory-date">Due {date(task.deadline)}</span></div><h3>{task.title}</h3><p>{task.description}</p><div className="vp-directory-code"><Code2 size={14} aria-hidden="true" /><span>{task.target}</span></div><div className="vp-directory-tags">{task.scopePaths.slice(0, 3).map(path => <code key={path}>{path}</code>)}{task.scopePaths.length > 3 && <span>+{task.scopePaths.length - 3}</span>}</div><div className="vp-directory-facts"><span><strong>{task.minImprovementPct}%</strong> minimum improvement</span><span><strong>{usd(task.operatorRewardUsd)}</strong> operator reward</span><span><strong>{task.maxSubmissions}</strong> submission slots</span></div><div className="vp-directory-actions"><Link className="vp-button-secondary" href={`/workspace?view=tasks&task=${encodeURIComponent(task.id)}`}>Inspect brief<ArrowUpRight size={14} aria-hidden="true" /></Link><button type="button" className="vp-button" onClick={() => onReserve(task)} disabled={reserved.has(task.id) || reserving === task.id}>{reserving === task.id ? <LoaderCircle className="vp-spin" size={15} aria-hidden="true" /> : reserved.has(task.id) ? <Check size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}{reserved.has(task.id) ? "Reserved" : reserving === task.id ? "Reserving…" : "Reserve slot"}</button></div></article>)}</div>;
}

function OperatorDirectory({ profiles }: { profiles: MarketplaceProfile[] }) {
  if (!profiles.length) return <MarketplaceEmpty icon={<UserRound size={22} aria-hidden="true" />} title="The directory is growing." body="Operators become visible when they publish a profile. Your own profile is the first signal in the network." href="/workspace?view=profile" link="Create your profile" />;
  return <div className="vp-directory-grid vp-operator-grid">{profiles.map(profile => { const challenged = profile.challengedCount; const completed = profile.completedCount; return <article className="vp-directory-card vp-operator-card" key={profile.userId}><div className="vp-operator-heading"><span className="vp-operator-avatar">{profile.handle.slice(0, 2).toUpperCase()}</span><div><h3>@{profile.handle}</h3><span className={`vp-availability vp-availability-${profile.availability}`}><i />{profile.availability}</span></div><BadgeCheck size={18} aria-label="Profile record" /></div><p>{profile.bio || "This operator has not added a public bio yet."}</p><div className="vp-directory-tags">{profile.capabilities.length ? profile.capabilities.slice(0, 5).map(capability => <span key={capability}>{capability}</span>) : <span>No capabilities listed</span>}</div><div className="vp-operator-metrics"><div><strong>{completed}</strong><span>completed</span></div><div><strong>{profile.acceptedCount}</strong><span>accepted</span></div><div><strong>{challenged}</strong><span>challenged</span></div><div><strong>{profile.challengeFailures}</strong><span>failed challenges</span></div></div><div className="vp-directory-card-footer"><span><ShieldCheck size={14} aria-hidden="true" /> Evidence-led reputation</span><ArrowRight size={15} aria-hidden="true" /></div></article>; })}</div>;
}

function MarketplaceEmpty({ icon, title, body, href, link }: { icon: React.ReactNode; title: string; body: string; href: string; link: string }) {
  return <div className="vp-empty vp-marketplace-empty"><span className="vp-empty-icon">{icon}</span><h3>{title}</h3><p>{body}</p><Link className="vp-button-secondary" href={href}>{link}<ArrowRight size={14} aria-hidden="true" /></Link></div>;
}

function MarketplaceSkeleton() {
  return <div className="vp-directory-grid" aria-busy="true" aria-label="Loading network results"><div className="vp-directory-skeleton" /><div className="vp-directory-skeleton" /><div className="vp-directory-skeleton" /></div>;
}

export function ProfileAccessView({ user, onSignedOut, onSessionExpired }: { user: PilotUser; onSignedOut: () => void; onSessionExpired: () => void }) {
  const [profile, setProfile] = useState<MarketplaceProfile | null>(null);
  const [tokens, setTokens] = useState<MarketplaceToken[]>([]);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [availability, setAvailability] = useState<MarketplaceProfile["availability"]>("available");
  const [tokenName, setTokenName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      pilotRequest<{ profile: MarketplaceProfile }>("/profile", { signal: controller.signal }),
      pilotRequest<{ tokens: MarketplaceToken[] }>("/auth/api-tokens", { signal: controller.signal }),
    ]).then(([profileResult, tokenResult]) => {
      if (controller.signal.aborted) return;
      const next = profileResult.profile;
      setProfile(next); setHandle(next.handle); setBio(next.bio); setCapabilities(next.capabilities.join(", ")); setAvailability(next.availability); setTokens(tokenResult.tokens);
    }).catch(cause => { if (controller.signal.aborted) return; if (cause instanceof PilotRequestError && cause.status === 401) { onSessionExpired(); return; } setError(cause instanceof Error ? cause.message : "Your account settings could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [onSessionExpired, user.id]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await pilotRequest<{ profile: MarketplaceProfile }>("/profile", { ...jsonBody({ handle: handle.trim(), bio: bio.trim(), capabilities: capabilities.split(",").map(value => value.trim()).filter(Boolean), adapterVersions: profile?.adapterVersions || {}, availability }), method: "PATCH" });
      setProfile(result.profile); setNotice("Your public operator profile is saved.");
    } catch (cause) { setError(cause instanceof PilotRequestError ? cause.message : cause instanceof Error ? cause.message : "The profile could not be saved."); }
    finally { setSaving(false); }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokenName.trim()) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await pilotRequest<{ id: string; name: string; prefix: string; token: string; createdAt: string }>("/auth/api-tokens", jsonBody({ name: tokenName.trim() }));
      setTokens(previous => [{ id: result.id, name: result.name, prefix: result.prefix, createdAt: result.createdAt }, ...previous]); setNewToken(result.token); setTokenName(""); setNotice("Token created. Copy it now; Vector will not show the secret again.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The API token could not be created."); }
    finally { setSaving(false); }
  }

  async function revokeToken(id: string) {
    if (revokeId !== id) { setRevokeId(id); return; }
    setSaving(true); setError("");
    try { await pilotRequest(`/auth/api-tokens/${encodeURIComponent(id)}`, jsonBody({})); setTokens(previous => previous.map(token => token.id === id ? { ...token, revokedAt: new Date().toISOString() } : token)); setRevokeId(null); setNotice("The API token was revoked."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The API token could not be revoked."); }
    finally { setSaving(false); }
  }

  async function logoutAll() {
    setSaving(true); setError("");
    try { await pilotRequest("/auth/logout-all", jsonBody({})); onSignedOut(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The active sessions could not be closed."); }
    finally { setSaving(false); }
  }

  if (busy) return <section className="vp-data-loading" aria-busy="true"><div className="vp-loading" role="status"><LoaderCircle className="vp-spin" size={22} aria-hidden="true" /><h1>Loading your profile.</h1><p>Preparing your public record and API access…</p></div></section>;
  return <>
    <div className="vp-page-heading"><div><div className="vp-eyebrow"><UserRound size={11} aria-hidden="true" />IDENTITY & ACCESS</div><h1>Your profile<br /><em>is the signal.</em></h1><p>Choose how the network sees your operator capabilities. Reputation stays tied to recorded work, not marketing claims.</p></div><span className="vp-badge"><CircleDot size={11} aria-hidden="true" />{profile?.availability || "available"}</span></div>
    {notice && <div className="vp-success-notice" role="status"><Check size={17} aria-hidden="true" /><span>{notice}</span><button type="button" className="vp-icon-button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} aria-hidden="true" /></button></div>}
    {error && <div className="vp-error" role="alert">{error}</div>}
    <div className="vp-profile-layout"><section className="vp-panel vp-profile-editor"><div className="vp-section-heading"><div><span className="vp-eyebrow">PUBLIC RECORD</span><h2>Operator profile</h2></div><Save size={17} aria-hidden="true" /></div><form onSubmit={saveProfile}><div className="vp-field"><label htmlFor="vp-profile-handle">Handle</label><input id="vp-profile-handle" value={handle} onChange={event => setHandle(event.target.value)} placeholder="your-handle" maxLength={40} required /><span className="vp-field-help">3–40 letters, numbers, dashes or underscores.</span></div><div className="vp-field"><label htmlFor="vp-profile-bio">Short bio</label><textarea id="vp-profile-bio" value={bio} onChange={event => setBio(event.target.value)} rows={6} maxLength={2000} placeholder="What kind of technical work does your agent help deliver?" /><span className="vp-field-help">Be specific about the work and evidence you can produce.</span></div><div className="vp-field"><label htmlFor="vp-profile-capabilities">Capabilities</label><input id="vp-profile-capabilities" value={capabilities} onChange={event => setCapabilities(event.target.value)} placeholder="Foundry, Solidity, gas optimization" /><span className="vp-field-help">Separate capabilities with commas. These power brief matching.</span></div><div className="vp-field"><label htmlFor="vp-profile-availability">Availability</label><select id="vp-profile-availability" value={availability} onChange={event => setAvailability(event.target.value as MarketplaceProfile["availability"])}><option value="available">Available for new work</option><option value="paused">Paused temporarily</option><option value="hidden">Hidden from the directory</option></select></div><button className="vp-button" type="submit" disabled={saving}><Save size={15} aria-hidden="true" />{saving ? "Saving…" : "Save profile"}</button></form></section><aside className="vp-profile-aside"><section className="vp-panel vp-profile-proof"><div className="vp-profile-avatar-large">{handle.slice(0, 2).toUpperCase() || "OP"}</div><span className={`vp-availability vp-availability-${profile?.availability || "available"}`}><i />{profile?.availability || "available"}</span><h2>@{handle || "your-handle"}</h2><p>{bio || "Add a bio to show sponsors what your operator can deliver."}</p><div className="vp-operator-metrics"><div><strong>{profile?.completedCount || 0}</strong><span>completed</span></div><div><strong>{profile?.acceptedCount || 0}</strong><span>accepted</span></div><div><strong>{profile?.challengeFailures || 0}</strong><span>challenge losses</span></div></div></section><section className="vp-panel vp-account-note"><ShieldCheck size={18} aria-hidden="true" /><div><strong>{user.email}</strong><p>Verified account. Your work and invitations remain private to the accounts allowed by each brief.</p></div></section></aside></div>
    <section className="vp-panel vp-token-panel"><div className="vp-section-heading"><div><span className="vp-eyebrow"><KeyRound size={11} aria-hidden="true" />PROGRAMMATIC ACCESS</span><h2>API tokens</h2></div><span className="vp-muted">{tokens.filter(token => !token.revokedAt).length} active</span></div><p className="vp-muted">Use a scoped bearer token for operator tooling. Secrets are shown only once and are stored hashed.</p>{newToken && <div className="vp-token-secret" role="status"><div><strong>Copy this token now</strong><code>{newToken}</code></div><button className="vp-button-secondary" type="button" onClick={() => void navigator.clipboard?.writeText(newToken)}><Copy size={14} aria-hidden="true" />Copy token</button></div>}<form className="vp-token-create" onSubmit={createToken}><div className="vp-field"><label htmlFor="vp-token-name">New token name</label><input id="vp-token-name" value={tokenName} onChange={event => setTokenName(event.target.value)} placeholder="operator-cli" maxLength={100} /></div><button className="vp-button-secondary" type="submit" disabled={saving || !tokenName.trim()}><KeyRound size={14} aria-hidden="true" />Create token</button></form>{tokens.length ? <div className="vp-token-list">{tokens.map(token => <div className={`vp-token-row${token.revokedAt ? " vp-token-revoked" : ""}`} key={token.id}><div><strong>{token.name}</strong><span>{token.prefix} · created {date(token.createdAt)}{token.lastUsedAt ? ` · last used ${date(token.lastUsedAt)}` : ""}</span></div>{token.revokedAt ? <span className="vp-badge">Revoked</span> : <button type="button" className="vp-button-danger" onClick={() => void revokeToken(token.id)} disabled={saving}>{revokeId === token.id ? "Confirm revoke" : "Revoke"}</button>}</div>)}</div> : <div className="vp-empty vp-empty-small"><span className="vp-empty-icon"><KeyRound size={20} aria-hidden="true" /></span><h3>No API tokens yet.</h3><p>Create one when you are ready to connect an operator tool.</p></div>}</section>
    <section className="vp-panel vp-session-controls"><div><span className="vp-eyebrow"><PauseCircle size={11} aria-hidden="true" />SESSION CONTROL</span><h2>Close active sessions</h2><p className="vp-muted">Use this after rotating credentials or when you no longer recognize a session. You’ll need to sign in again everywhere.</p></div><button type="button" className="vp-button-danger" onClick={() => void logoutAll()} disabled={saving}>Sign out everywhere</button></section>
  </>;
}
