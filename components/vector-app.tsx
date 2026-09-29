"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import "./dashboard.css";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, ChevronDown, ChevronRight, CircleHelp, Clock3,
  Command, Copy, Cpu, Globe2, LayoutDashboard, Link2, LockKeyhole, Menu, MoreHorizontal, Plus,
  RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Timer, TrendingUp, WalletCards, X, Zap, Check, AlertTriangle, CircleX, Filter,
} from "lucide-react";
import {
  createEscrow, createInitialState, getTotals, restoreState, STORAGE_KEY, transitionEscrow,
  validateDraft, type ActivityItem, type AgentId, type DemoState, type Escrow, type EscrowDraft, type EscrowStatus,
} from "@/lib/escrow";

const agentMeta: Record<AgentId, { name: string; symbol: string; role: string; color: string; bg: string; description: string; tags: string[] }> = {
  atlas: { name: "Atlas", symbol: "AT", role: "Strategy & research", color: "#b9ff66", bg: "rgba(185,255,102,.12)", description: "Finds signal in messy, multi-source questions and turns it into decisions.", tags: ["Research", "Synthesis", "Citations"] },
  sentinel: { name: "Sentinel", symbol: "SN", role: "Security & risk", color: "#b68cff", bg: "rgba(182,140,255,.13)", description: "Stress tests protocols, contracts and operational assumptions before they cost you.", tags: ["Security", "Audits", "Risk"] },
  scout: { name: "Scout", symbol: "SC", role: "Market intelligence", color: "#6ee7ff", bg: "rgba(110,231,255,.12)", description: "Tracks narrative velocity across communities, markets and emerging categories.", tags: ["Markets", "Signals", "Trends"] },
  quill: { name: "Quill", symbol: "QL", role: "Writing & communication", color: "#ffcb70", bg: "rgba(255,203,112,.12)", description: "Turns raw thinking into crisp, high-conviction artifacts that move work forward.", tags: ["Writing", "Briefs", "Voice"] },
};

const statusMeta: Record<EscrowStatus, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "status-draft", dot: "#82909b" },
  funded: { label: "Funded", className: "status-cyan", dot: "#6ee7ff" },
  running: { label: "Running", className: "status-violet", dot: "#b68cff" },
  review: { label: "Review needed", className: "status-lime", dot: "#b9ff66" },
  released: { label: "Completed", className: "status-lime", dot: "#b9ff66" },
  disputed: { label: "Disputed", className: "status-amber", dot: "#ffcb70" },
  refunded: { label: "Refunded", className: "status-red", dot: "#ff7e9a" },
  failed: { label: "Failed", className: "status-red", dot: "#ff7e9a" },
  expired: { label: "Expired", className: "status-red", dot: "#ff7e9a" },
};

type View = "dashboard" | "escrows" | "agents" | "activity" | "settings";
type Dialog = "create" | "wallet" | "fund" | "release" | "dispute" | "success" | "dispute-success" | "refund" | "refund-success" | "reset" | "help" | null;

const currency = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortHash = (value?: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Pending";

export default function VectorApp({ initialCreate = false }: { initialCreate?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const routeView: View = pathname === "/escrows" ? "escrows" : pathname === "/agents" ? "agents" : pathname === "/settings" ? "settings" : pathname === "/activity" ? "activity" : "dashboard";
  const [state, setState] = useState<DemoState>(() => createInitialState());
  const [hydrated, setHydrated] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(initialCreate ? "create" : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<EscrowDraft>({ title: "", description: "", agentId: "atlas", amount: "500", deadline: "7" });
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [disputeReason, setDisputeReason] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Active" | "Completed" | "Needs review">("All");
  const [copied, setCopied] = useState(false);
  const stateRef = useRef(state);
  const [storageError, setStorageError] = useState(false);
  const commit = (updater: (previous: DemoState) => DemoState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    try {
      const restored = restoreState(window.localStorage.getItem(STORAGE_KEY));
      stateRef.current = restored;
      setState(restored);
    } catch { setStorageError(true); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { setStorageError(true); }
  }, [hydrated, state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      if (!current.escrows.some(item => item.status === "running")) return;
      const ready: ActivityItem[] = [];
      const escrows = current.escrows.map(item => {
        if (item.status !== "running") return item;
        const next = transitionEscrow(item, "advance", current.walletConnected, current.balance);
        if (next.status === "review") ready.push({ id: crypto.randomUUID(), title: "Milestones ready for review", detail: item.title, timestamp: "now", tone: "lime" });
        return next;
      });
      const next = { ...current, escrows, activity: [...ready, ...current.activity].slice(0, 50) };
      stateRef.current = next;
      setState(next);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hydrated]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (dialog) setDialog(null); else setSelectedId(null); setMobileNav(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSelectedId(null); setDialog("create"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  const totals = useMemo(() => getTotals(state.escrows), [state.escrows]);
  const selected = state.escrows.find(escrow => escrow.id === selectedId) ?? null;

  const navigate = (view: View) => {
    setMobileNav(false);
    router.push(view === "dashboard" ? "/arena" : `/${view}`);
  };

  const applyAction = (action: Parameters<typeof transitionEscrow>[1]) => {
    if (!selected) return false;
    try {
      const current = stateRef.current;
      const escrow = current.escrows.find(item => item.id === selected.id);
      if (!escrow) return false;
      const next = transitionEscrow(escrow, action, current.walletConnected, current.balance);
      if (action === "dispute") next.disputeReason = disputeReason.trim();
      commit(previous => ({ ...previous, escrows: previous.escrows.map(item => item.id === escrow.id ? next : item), balance: Math.round((previous.balance + (action === "refund" ? escrow.amount : action === "fund" ? -escrow.amount : 0)) * 100) / 100 }));
      if (action === "fund") addActivity("Escrow funded", selected.title, "cyan");
      if (action === "dispute") addActivity("Dispute opened", disputeReason.trim(), "amber");
      if (action === "release") addActivity("Payment released", `${selected.title} · ${currency(selected.amount)}`, "lime");
      if (action === "refund") addActivity("Funds refunded", selected.title, "cyan");
      setDialog(null);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    }
  };

  const addActivity = (title: string, detail: string, tone: ActivityItem["tone"]) => {
    commit(previous => ({ ...previous, activity: [{ id: crypto.randomUUID(), title, detail, timestamp: "now", tone }, ...previous.activity].slice(0, 50) }));
  };

  const connectWallet = () => {
    commit(previous => ({ ...previous, walletConnected: !previous.walletConnected }));
    setDialog(null);
    setToast(stateRef.current.walletConnected ? "Demo wallet connected" : "Demo wallet disconnected");
  };

  const createNewEscrow = () => {
    const errors = validateDraft(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length) return;
    const escrow = createEscrow(draft, crypto.randomUUID());
    commit(previous => ({ ...previous, escrows: [escrow, ...previous.escrows] }));
    setSelectedId(escrow.id);
    setDialog(null);
    addActivity("Escrow created", `${escrow.title} · ${currency(escrow.amount)}`, "violet");
  };

  const runAgent = () => {
    if (selected && applyAction("start")) {
      addActivity("Agent started", `${agentMeta[selected.agentId].name} is working on ${selected.title}`, "violet");
    }
  };

  const openEscrow = (id: string) => { setSelectedId(id); setDialog(null); };
  const openNew = () => { setDraftErrors({}); setDraft({ title: "", description: "", agentId: "atlas", amount: "500", deadline: "7" }); setSelectedId(null); setDialog("create"); };
  const currentStatus = selected ? statusMeta[selected.status] : null;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} inert={!!dialog || !!selected}>
        <Link className="brand" href="/">
          <span className="brand-mark"><span /><span /><span /></span><span className="brand-word">VECTOR</span><span className="brand-beta">BETA</span>
        </Link>
        <div className="workspace-switcher"><div className="workspace-avatar">F</div><div><div className="workspace-name">Fission Labs</div><div className="workspace-sub">Personal workspace</div></div><ChevronDown size={14} /></div>
        <div className="nav-label">Workspace</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <NavItem icon={<LayoutDashboard size={16} />} label="Command center" active={routeView === "dashboard"} onClick={() => navigate("dashboard")} />
          <NavItem icon={<LockKeyhole size={16} />} label="Escrows" active={routeView === "escrows"} onClick={() => navigate("escrows")} count={state.escrows.filter(item => ["funded", "running", "review"].includes(item.status)).length} />
          <NavItem icon={<Bot size={16} />} label="Agent directory" active={routeView === "agents"} onClick={() => navigate("agents")} />
          <NavItem icon={<Activity size={16} />} label="Activity log" active={routeView === "activity"} onClick={() => navigate("activity")} />
        </nav>
        <div className="nav-label nav-label-lower">System</div>
        <nav className="primary-nav"><NavItem icon={<Settings2 size={16} />} label="Settings" active={routeView === "settings"} onClick={() => navigate("settings")} /><NavItem icon={<CircleHelp size={16} />} label="Help center" onClick={() => { setMobileNav(false); setDialog("help"); }} /></nav>
        <div className="sidebar-bottom"><div className="network-card"><div className="network-orbit"><Globe2 size={16} /></div><div><div className="network-name">Base mainnet</div><div className="network-status"><i /> All systems operational</div></div></div><div className="profile-row"><div className="profile-avatar">FM</div><div className="profile-copy"><strong>Felix M.</strong><span>0x8a…42d9</span></div><MoreHorizontal size={16} /></div></div>
      </aside>

      <main className="main-area" inert={!!dialog || !!selected || mobileNav}>
        <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={13} /><strong>{routeView === "dashboard" ? "Command center" : routeView === "agents" ? "Agent directory" : routeView === "escrows" ? "Escrows" : routeView === "settings" ? "Settings" : "Activity log"}</strong></div><div className="topbar-actions"><div className="live-pill"><i /> Local simulation</div><button className="icon-button" onClick={openNew} aria-label="Quick create escrow"><Command size={17} /></button><button className="wallet-button" aria-label={state.walletConnected ? "Manage demo wallet" : "Connect wallet"} onClick={() => setDialog("wallet")}><WalletCards size={16} /><span>{state.walletConnected ? "0x8a…42d9" : "Connect wallet"}</span></button></div></header>
        <div className="page-content">
          <div className="demo-banner"><ShieldCheck size={13} /> SIMULATION MODE <span>No real funds or AI requests. Your work stays in this browser.</span></div>
          {storageError && <p className="storage-error" role="alert">Browser storage is unavailable. This session works, but changes will not survive a reload.</p>}
          {routeView === "dashboard" && <DashboardView state={state} totals={totals} onOpen={openEscrow} onNew={openNew} onNavigate={navigate} />}
          {routeView === "escrows" && <EscrowsView escrows={state.escrows} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} onOpen={openEscrow} onNew={openNew} />}
          {routeView === "agents" && <AgentsView onNew={openNew} onOpen={openEscrow} escrows={state.escrows} />}
          {routeView === "activity" && <ActivityView activity={state.activity} />}
          {routeView === "settings" && <SettingsView state={state} onWallet={() => setDialog("wallet")} onReset={() => setDialog("reset")} />}
        </div>
      </main>

      {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      {selected && !dialog && <EscrowDetail escrow={selected} connected={state.walletConnected} status={currentStatus!} onClose={() => setSelectedId(null)} onConnect={() => setDialog("wallet")} onFund={() => setDialog("fund")} onRun={runAgent} onRelease={() => setDialog("release")} onDispute={() => { setDisputeReason(""); setDialog("dispute"); }} onRefund={() => setDialog("refund")} copied={copied} onCopy={async () => { try { await navigator.clipboard.writeText(selected.txHash ?? ""); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setToast("Clipboard unavailable. Select and copy the transaction ID."); } }} />}
      {dialog && <DialogLayer type={dialog} amount={selected?.amount ?? 0} balance={state.balance} connected={state.walletConnected} draft={draft} setDraft={setDraft} errors={draftErrors} onCreate={createNewEscrow} onClose={() => setDialog(null)} onConnect={connectWallet} onFund={() => applyAction("fund")} onRelease={() => { if (applyAction("release")) setDialog("success"); }} onDispute={() => { if (!selected || disputeReason.trim().length < 8) { setToast("Add a little more context for the dispute."); return; } if (applyAction("dispute")) setDialog("dispute-success"); }} reason={disputeReason} setReason={setDisputeReason} onRefund={() => { if (applyAction("refund")) setDialog("refund-success"); }} onRefundStart={() => setDialog("refund")} onReset={() => { commit(() => createInitialState()); setSelectedId(null); setDialog(null); setToast("Demo reset to the starting state."); }} />}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </div>
  );
}

function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; count?: number }) {
  const href = ({ "Command center": "/arena", "Escrows": "/escrows", "Agent directory": "/agents", "Activity log": "/activity", "Settings": "/settings" } as Record<string, string>)[label];
  const content = <>{icon}<span>{label}</span>{count ? <em>{count}</em> : null}</>;
  return href ? <Link href={href} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>{content}</Link> : <button className="nav-item" onClick={onClick}>{content}</button>;
}

function DashboardView({ state, totals, onOpen, onNew, onNavigate }: { state: DemoState; totals: ReturnType<typeof getTotals>; onOpen: (id: string) => void; onNew: () => void; onNavigate: (view: View) => void }) {
  const active = state.escrows.filter(item => ["funded", "running", "review"].includes(item.status)).slice(0, 3);
  return <>
    <section className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line" />Your autonomous workspace</div><h1>Your command<br /> <em>center.</em></h1><p className="hero-copy">Deploy work to autonomous agents. Keep custody of<br className="desktop-only" /> the outcome until it is actually done.</p></div><button className="primary-button hero-cta" onClick={onNew}><Plus size={18} />New escrow<span className="button-key" aria-hidden="true">⌘ K</span></button></section>
    <section className="metrics-grid"><MetricCard label="Secured in escrow" value={currency(totals.locked)} change={String(state.escrows.filter(e => ["funded", "running", "review", "disputed"].includes(e.status)).length)} context="funded assignments" icon={<LockKeyhole size={17} />} tone="lime" /><MetricCard label="Settled to agents" value={currency(totals.settled)} change={String(state.escrows.filter(e => e.status === "released").length)} context="completed assignments" icon={<ArrowUpRight size={17} />} tone="violet" /><MetricCard label="Active escrows" value={String(totals.active).padStart(2, "0")} change={String(state.escrows.filter(e => e.status === "review").length)} context="need your review" icon={<Zap size={17} />} tone="cyan" /><MetricCard label="Demo wallet balance" value={currency(state.balance)} change="USDC" context="simulated funds" icon={<Timer size={17} />} tone="amber" /></section>
    <div className="section-heading"><div><div className="eyebrow mini"><span className="eyebrow-line" />The live board</div><h2>Escrows in motion <span className="live-count">{active.length} live</span></h2></div><button className="text-button" onClick={() => onNavigate("escrows")}>View all escrows <ArrowUpRight size={14} /></button></div>
    <section className="dashboard-grid"><div className="panel escrow-panel"><div className="panel-top"><div className="panel-title">Current operations <span className="panel-spark"><span /><span /><span /><span /><span /></span></div><LockKeyhole size={16} /></div><div className="escrow-list">{active.map(item => <EscrowRow key={item.id} escrow={item} onClick={() => onOpen(item.id)} />)}{!active.length && <p className="empty-state">All clear. Create an escrow to start a new assignment.</p>}</div><button className="add-row" onClick={onNew}><Plus size={15} /> Create another escrow</button></div><ActivityPanel activity={state.activity.slice(0, 4)} onView={() => onNavigate("activity")} /></section>
    <section className="lower-grid"><div className="panel graph-panel"><div className="panel-top"><div><div className="panel-title">Escrow velocity</div><div className="panel-subtitle">Settled value over the last 30 days</div></div><div className="graph-select">Last 30 days <ChevronDown size={14} /></div></div><div className="chart"><div className="chart-y"><span>$20k</span><span>$15k</span><span>$10k</span><span>$5k</span><span>$0</span></div><div className="chart-body"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 760 170" preserveAspectRatio="none" aria-label="Escrow velocity chart"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#b9ff66" stopOpacity=".26" /><stop offset="1" stopColor="#b9ff66" stopOpacity="0" /></linearGradient></defs><path d="M0,148 C40,138 55,152 93,128 S155,112 190,125 S245,112 283,96 S342,110 378,82 S440,97 474,65 S525,78 560,57 S617,67 651,33 S702,48 760,18 L760,170 L0,170Z" fill="url(#chart-fill)" /><path d="M0,148 C40,138 55,152 93,128 S155,112 190,125 S245,112 283,96 S342,110 378,82 S440,97 474,65 S525,78 560,57 S617,67 651,33 S702,48 760,18" fill="none" stroke="#b9ff66" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg><div className="chart-dates"><span>Sep 04</span><span>Sep 11</span><span>Sep 18</span><span>Sep 25</span><span>Oct 03</span></div></div></div></div><div className="panel network-panel"><div className="panel-top"><div className="panel-title">System pulse</div><div className="pulse-dot"><i /> Live</div></div><div className="pulse-stat"><span>Agent network</span><strong>99.98%</strong><small>uptime this month</small></div><div className="mini-bars"><div style={{ height: "36%" }} /><div style={{ height: "54%" }} /><div style={{ height: "45%" }} /><div style={{ height: "72%" }} /><div style={{ height: "67%" }} /><div style={{ height: "84%" }} /><div style={{ height: "78%" }} /><div style={{ height: "100%" }} /><div style={{ height: "86%" }} /><div style={{ height: "93%" }} /><div style={{ height: "76%" }} /><div style={{ height: "96%" }} /></div><div className="pulse-footer"><span><i className="dot-lime" /> 04 agents online</span><span><i className="dot-violet" /> 18 tasks this week</span></div></div></section>
  </>;
}

function MetricCard({ label, value, change, context, icon, tone }: { label: string; value: string; change: string; context: string; icon: React.ReactNode; tone: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-icon">{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-change"><span>{change}</span> {context}</div><div className="metric-line" /></div>;
}

function EscrowRow({ escrow, onClick }: { escrow: Escrow; onClick: () => void }) {
  const agent = agentMeta[escrow.agentId]; const status = statusMeta[escrow.status];
  const completed = escrow.milestones.filter(m => m.complete).length;
  return <button className="escrow-row" onClick={onClick}><div className="agent-chip" style={{ color: agent.color, background: agent.bg }}>{agent.symbol}</div><div className="row-main"><strong>{escrow.title}</strong><span><span className="agent-name">{agent.name}</span><span className="row-separator">/</span>{completed} of 3 milestones</span></div><div className="row-progress"><span><i style={{ width: `${completed / 3 * 100}%` }} /></span><small>{Math.round(completed / 3 * 100)}%</small></div><div className={`status-badge ${status.className}`}><i style={{ background: status.dot }} />{status.label}</div><div className="row-amount">{currency(escrow.amount)}<span>USDC</span></div><ChevronRight className="row-chevron" size={16} /></button>;
}

function ActivityPanel({ activity, onView }: { activity: ActivityItem[]; onView: () => void }) {
  return <div className="panel activity-panel"><div className="panel-top"><div className="panel-title">Recent activity</div><Activity size={16} /></div><div className="activity-list">{activity.map(item => <ActivityRow key={item.id} item={item} />)}</div><button className="panel-link" onClick={onView}>Open activity log <ArrowUpRight size={14} /></button></div>;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const icons = { lime: <Check size={14} />, violet: <Cpu size={14} />, cyan: <LockKeyhole size={14} />, amber: <AlertTriangle size={14} />, red: <CircleX size={14} /> };
  return <div className="activity-row"><div className={`activity-icon activity-${item.tone}`}>{icons[item.tone]}</div><div><strong>{item.title}</strong><span>{item.detail}</span></div><time>{item.timestamp}</time></div>;
}

function EscrowsView({ escrows, filter, setFilter, search, setSearch, onOpen, onNew }: { escrows: Escrow[]; filter: "All" | "Active" | "Completed" | "Needs review"; setFilter: (value: "All" | "Active" | "Completed" | "Needs review") => void; search: string; setSearch: (value: string) => void; onOpen: (id: string) => void; onNew: () => void }) {
  const filtered = escrows.filter(item => { const query = search.toLowerCase(); const matchesSearch = !query || item.title.toLowerCase().includes(query) || item.description.toLowerCase().includes(query); const matchesFilter = filter === "All" || (filter === "Active" && ["funded", "running", "disputed"].includes(item.status)) || (filter === "Completed" && ["released", "refunded"].includes(item.status)) || (filter === "Needs review" && item.status === "review"); return matchesSearch && matchesFilter; });
  return <><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />Trust layer</div><h1>Every outcome,<br /><em>accounted for.</em></h1><p>Track agent work from first signature to final settlement.</p></div><button className="primary-button" onClick={onNew}><Plus size={18} />New escrow</button></section><div className="toolbar"><div className="search-field"><Search size={16} /><input aria-label="Search escrows" placeholder="Search escrows" value={search} onChange={event => setSearch(event.target.value)} />{search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}</div><div className="filter-group">{(["All", "Active", "Completed", "Needs review"] as const).map(value => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value}{value === "Needs review" && <span className="filter-count">1</span>}</button>)}</div><button className="filter-button"><Filter size={15} /> Filters</button></div><section className="all-escrows-table"><div className="table-head"><span>Escrow</span><span>Agent</span><span>Status</span><span>Progress</span><span>Value</span><span /></div>{filtered.length ? filtered.map(item => <button className="table-row" key={item.id} onClick={() => onOpen(item.id)}><div className="table-title"><div className="agent-chip" style={{ color: agentMeta[item.agentId].color, background: agentMeta[item.agentId].bg }}>{agentMeta[item.agentId].symbol}</div><div><strong>{item.title}</strong><span>Updated just now · {item.deadline}d window</span></div></div><div className="table-agent">{agentMeta[item.agentId].name}<span>{agentMeta[item.agentId].role}</span></div><div><span className={`status-badge ${statusMeta[item.status].className}`}><i style={{ background: statusMeta[item.status].dot }} />{statusMeta[item.status].label}</span></div><div className="table-progress"><span><i style={{ width: `${item.milestones.filter(m => m.complete).length / 3 * 100}%` }} /></span><small>{item.milestones.filter(m => m.complete).length}/3</small></div><strong className="table-value">{currency(item.amount)}</strong><ChevronRight size={16} /></button>) : <div className="empty-state"><div className="empty-icon"><Search size={20} /></div><h3>No escrows found</h3><p>Try another search or clear your filters.</p><button className="secondary-button" onClick={() => { setSearch(""); setFilter("All"); }}>Clear filters</button></div>}</section></>;
}

function AgentsView({ onNew }: { onNew: () => void; onOpen: (id: string) => void; escrows: Escrow[] }) {
  return <><section className="page-heading agents-heading"><div><div className="eyebrow"><span className="eyebrow-line" />Specialist network</div><h1>Find your unfair<br /><em>advantage.</em></h1><p>Agents with a point of view, ready to take on the work you should not.</p></div><button className="primary-button" onClick={onNew}><Plus size={18} />Deploy an agent</button></section><div className="agents-grid">{(Object.keys(agentMeta) as AgentId[]).map((id, index) => { const agent = agentMeta[id]; return <article className="agent-card" key={id}><div className="agent-card-top"><div className="large-agent-mark" style={{ color: agent.color, background: agent.bg }}>{agent.symbol}</div><span className="online-label"><i /> Available</span><button className="icon-button"><MoreHorizontal size={16} /></button></div><div className="agent-card-number">0{index + 1}</div><h3>{agent.name}</h3><div className="agent-role">{agent.role}</div><p>{agent.description}</p><div className="agent-tags">{agent.tags.map(tag => <span key={tag}>{tag}</span>)}</div><div className="agent-card-footer"><span><TrendingUp size={14} /> 98.{index + 1}% success</span><button className="small-arrow" onClick={onNew}><ArrowUpRight size={15} /></button></div></article>; })}</div><section className="agent-callout"><div className="callout-signal"><span /><span /><span /><span /></div><div><div className="eyebrow mini"><span className="eyebrow-line" />The next layer</div><h2>Your best work is still yours.</h2><p>Vector handles the execution surface. You keep the judgment, the keys and the final say.</p></div><button className="secondary-button" onClick={onNew}>Start a brief <ArrowUpRight size={14} /></button></section></>;
}

function ActivityView({ activity }: { activity: ActivityItem[] }) {
  return <><section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />Immutable by design</div><h1>Nothing moves<br /><em>without a trace.</em></h1><p>Agent decisions, wallet signatures and settlement events in one place.</p></div><div className="activity-summary"><strong>{activity.length}</strong><span>events this session</span></div></section><section className="panel full-activity"><div className="panel-top"><div className="panel-title">Session event stream</div><div className="live-pill"><i /> Streaming</div></div>{activity.map((item, index) => <div className="full-activity-row" key={item.id}><div className="activity-index">0{index + 1}</div><ActivityRow item={item} /><div className="event-hash">0x{item.id.replace("a", "f8d")}… <Copy size={13} /></div></div>)}</section></>;
}

function SettingsView({ state, onReset, onWallet }: { state: DemoState; onReset: () => void; onWallet: () => void }) {
  return <><section className="page-heading settings-heading"><div><div className="eyebrow"><span className="eyebrow-line" />Control plane</div><h1>Set the rules<br /> <em>of engagement.</em></h1><p>Demo controls for this local Vector workspace.</p></div><div className="settings-version">VECTOR / 1.0<br /><span>frontend preview</span></div></section><section className="settings-content"><SettingsBlock icon={<WalletCards size={18} />} title="Wallet connection" description={`Available demo balance: ${currency(state.balance)} USDC.`} action={<button className="secondary-button" onClick={onWallet}>{state.walletConnected ? "Manage wallet" : "Connect"}</button>} /><SettingsBlock icon={<Globe2 size={18} />} title="Network" description="Base-style settlement simulation. No RPC, contracts, or real funds are used." action={<div className="network-select"><Globe2 size={15} /> Local demo</div>} /><SettingsBlock icon={<ShieldCheck size={18} />} title="Your data" description="Escrows are stored only in this browser. No private keys or credentials are requested." action={<span className="status-badge status-lime">Local storage</span>} /><SettingsBlock icon={<RefreshCw size={18} />} title="Reset demo workspace" description="Restore the original escrows, wallet state and activity log." action={<button className="danger-button" onClick={onReset}>Reset demo</button>} /></section></>;
}

function SettingsBlock({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action: React.ReactNode }) { return <div className="settings-block"><div className="settings-icon">{icon}</div><div className="settings-copy"><h3>{title}</h3><p>{description}</p></div><div className="settings-action">{action}</div></div>; }

function EscrowDetail({ escrow, connected, status, onClose, onConnect, onFund, onRun, onRelease, onDispute, onRefund, copied, onCopy }: { escrow: Escrow; connected: boolean; status: { label: string; className: string; dot: string }; onClose: () => void; onConnect: () => void; onFund: () => void; onRun: () => void; onRelease: () => void; onDispute: () => void; onRefund: () => void; copied: boolean; onCopy: () => void }) {
  const agent = agentMeta[escrow.agentId]; const completed = escrow.milestones.filter(m => m.complete).length; const isRunning = escrow.status === "running";
  return <div className="detail-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${escrow.title} details`}><div className="drawer-top"><button className="back-button" onClick={onClose}><ArrowDownRight size={15} />Close detail</button><span className={`status-badge ${status.className}`}><i style={{ background: status.dot }} />{status.label}</span></div><div className="drawer-title"><div className="large-agent-mark" style={{ color: agent.color, background: agent.bg }}>{agent.symbol}</div><div><div className="eyebrow mini"><span className="eyebrow-line" />Escrow / {escrow.id.slice(-6)}</div><h2>{escrow.title}</h2><p>With {agent.name} · {agent.role}</p></div></div><div className="drawer-value"><div><span>Locked value</span><strong>{currency(escrow.amount)} <small>USDC</small></strong></div><div className="drawer-deadline"><Clock3 size={15} /><span>{escrow.deadline} day window</span></div></div><div className="drawer-body"><div className="detail-section"><div className="detail-section-title"><span>Mission brief</span><span className="detail-number">01</span></div><p className="mission-copy">{escrow.description}</p></div><div className="detail-section"><div className="detail-section-title"><span>Milestones</span><span className="milestone-count">{completed} / 3 complete</span></div><div className="milestone-list">{escrow.milestones.map((milestone, index) => <div className={`milestone ${milestone.complete ? "complete" : ""}`} key={milestone.id}><div className="milestone-marker">{milestone.complete ? <Check size={13} /> : <span>0{index + 1}</span>}</div><div><strong>{milestone.title}</strong><p>{milestone.detail}</p></div>{isRunning && !milestone.complete && index === completed && <span className="milestone-live"><i />Working</span>}</div>)}</div></div><div className="detail-section execution-section"><div className="detail-section-title"><span>Execution trace</span><span className="live-pill"><i /> {isRunning ? "Live" : "Encrypted"}</span></div><div className="trace-line"><span className="trace-node done"><Check size={11} /></span><div><strong>Brief signed</strong><small>Scope locked · 09:42:18</small></div></div><div className="trace-line"><span className={`trace-node ${isRunning || completed > 0 ? "done" : "pending"}`}>{completed > 0 ? <Check size={11} /> : <span />}</span><div><strong>Agent execution</strong><small>{isRunning ? "Processing evidence…" : completed > 0 ? "Checkpoint verified" : "Awaiting agent"}</small></div></div><div className="trace-line"><span className={`trace-node ${escrow.status === "released" ? "done" : "pending"}`}>{escrow.status === "released" ? <Check size={11} /> : <span />}</span><div><strong>Settlement</strong><small>{escrow.status === "released" ? "Payment released" : "Requires your approval"}</small></div></div></div>{escrow.txHash && <div className="transaction-row"><span><Link2 size={14} /> Funding transaction</span><button onClick={onCopy}>{copied ? "Copied" : shortHash(escrow.txHash)} <Copy size={13} /></button></div>}</div><div className="drawer-footer">{!connected && !["released", "refunded"].includes(escrow.status) ? <button className="primary-button full-button" onClick={onConnect}><WalletCards size={17} />Connect to continue</button> : escrow.status === "draft" ? <button className="primary-button full-button" onClick={onFund}><LockKeyhole size={17} />Fund escrow · {currency(escrow.amount)}</button> : escrow.status === "funded" ? <button className="primary-button full-button" onClick={onRun}><Zap size={17} />Run {agent.name}</button> : escrow.status === "running" ? <button className="primary-button full-button is-loading" disabled><span className="button-spinner" />{completed === 0 ? "Agent is reading the brief" : "Agent is executing"}…</button> : escrow.status === "review" ? <div className="drawer-action-stack"><button className="primary-button full-button" onClick={onRelease}><Check size={17} />Approve & release · {currency(escrow.amount)}</button><button className="subtle-danger-button" onClick={onDispute}>Open a dispute</button></div> : escrow.status === "disputed" ? <button className="primary-button full-button" onClick={onRefund}><RefreshCw size={17} />Simulate refund</button> : <div className="final-state"><Check size={16} />{status.label} — this escrow is closed</div>}</div></aside></div>;
}

function DialogLayer({ type, amount, balance, connected, draft, setDraft, errors, onCreate, onClose, onConnect, onFund, onRelease, onDispute, reason, setReason, onRefund, onRefundStart, onReset }: { type: Dialog; amount: number; balance: number; connected: boolean; draft: EscrowDraft; setDraft: React.Dispatch<React.SetStateAction<EscrowDraft>>; errors: Record<string, string>; onCreate: () => void; onClose: () => void; onConnect: () => void; onFund: () => void; onRelease: () => void; onDispute: () => void; reason: string; setReason: (value: string) => void; onRefund: () => void; onRefundStart: () => void; onReset: () => void }) {
  if (type === "create") return <Modal title="Create an escrow" eyebrow="New assignment" onClose={onClose} wide><div className="modal-intro">Define the outcome. Vector holds the value until the work proves itself.</div><div className="form-grid"><label className="field field-wide">Task name<input aria-label="Task name" autoFocus value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} placeholder="e.g. Analyze a protocol" />{errors.title && <small className="field-error">{errors.title}</small>}</label><label className="field field-wide">Task brief<textarea aria-label="Task brief" value={draft.description} onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))} placeholder="What should the agent know, find or deliver?" rows={4} />{errors.description && <small className="field-error">{errors.description}</small>}</label><label className="field">Agent<select aria-label="Agent" value={draft.agentId} onChange={event => setDraft(previous => ({ ...previous, agentId: event.target.value }))}>{(Object.keys(agentMeta) as AgentId[]).map(id => <option key={id} value={id}>{agentMeta[id].name} — {agentMeta[id].role}</option>)}</select></label><label className="field">Budget (USDC)<input aria-label="Budget (USDC)" inputMode="decimal" value={draft.amount} onChange={event => setDraft(previous => ({ ...previous, amount: event.target.value }))} />{errors.amount && <small className="field-error">{errors.amount}</small>}</label><label className="field">Deadline<select aria-label="Deadline" value={draft.deadline} onChange={event => setDraft(previous => ({ ...previous, deadline: event.target.value }))}>{["3", "7", "14", "30"].map(day => <option value={day} key={day}>{day} days</option>)}</select></label></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onCreate}><Sparkles size={16} />Create escrow</button></div></Modal>;
  if (type === "wallet") return <Modal title={connected ? "Your demo wallet" : "Connect your wallet"} eyebrow="Simulated wallet" onClose={onClose}><div className="wallet-modal-icon"><WalletCards size={28} /></div><div className="modal-intro">Use a local demo wallet to explore funding, approvals and disputes. No real wallet connection, signature or assets are involved.</div><div className="wallet-option selected"><div className="wallet-option-icon">FM</div><div><strong>Fission Labs wallet</strong><span>0x8a4c…42d9 · {currency(balance)} USDC</span></div><Check size={17} /></div><button className="primary-button full-button" onClick={onConnect}>{connected ? "Disconnect demo wallet" : "Connect demo wallet"} <ArrowUpRight size={16} /></button><p className="modal-note"><ShieldCheck size={14} /> Local simulation · no keys required.</p></Modal>;
  if (type === "fund") return <Modal title="Fund this escrow?" eyebrow="Signature preview" onClose={onClose}><div className="confirm-amount">{currency(amount)} <span>USDC</span></div><p className="modal-intro">This demo value stays locked until <strong>all three milestones</strong> are complete and you approve the result.</p><div className="confirm-breakdown"><span>Escrow value<strong>{currency(amount)}</strong></span><span>Demo network fee<strong>$0.00</strong></span><span>Available after<strong>{currency(balance - amount)}</strong></span></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onFund}><LockKeyhole size={16} />Confirm funding</button></div></Modal>;
  if (type === "release") return <Modal title="Release payment?" eyebrow="Final approval" onClose={onClose}><div className="success-preview"><div className="success-check"><Check size={24} /></div><div><strong>Sample work ready</strong><span>All three demo milestones are complete.</span></div></div><p className="modal-intro">Release <strong>{currency(amount)} USDC</strong> to the simulated agent? This closes the escrow.</p><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Not yet</button><button className="primary-button" onClick={onRelease}><Check size={16} />Confirm release</button></div></Modal>;
  if (type === "dispute") return <Modal title="Open a dispute" eyebrow="Escrow protection" onClose={onClose}><p className="modal-intro">Tell us what missed the mark. The value stays locked while you review the evidence.</p><label className="field field-wide">Dispute reason<textarea aria-label="Dispute reason" autoFocus rows={5} value={reason} onChange={event => setReason(event.target.value)} placeholder="What should be investigated?" /></label><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onDispute}><ShieldCheck size={16} />Submit dispute</button></div></Modal>;
  if (type === "success") return <Modal title="Action confirmed" eyebrow="On-chain simulation" onClose={onClose}><div className="success-modal"><div className="success-check"><Check size={28} /></div><h3>Payment released</h3><p>The agent has been paid and this escrow is now complete.</p><button className="primary-button full-button" onClick={onClose}>Done</button></div></Modal>;
  if (type === "dispute-success") return <Modal title="Dispute opened" eyebrow="Escrow protection" onClose={onClose}><div className="success-modal"><div className="success-check"><ShieldCheck size={28} /></div><h3>Dispute opened</h3><p>The value remains locked while the evidence is reviewed.</p><button className="primary-button full-button" onClick={onRefundStart}><RefreshCw size={16} />Simulate refund</button></div></Modal>;
  if (type === "refund") return <Modal title="Refund this escrow?" eyebrow="Funds return" onClose={onClose}><p className="modal-intro">This simulation returns the locked value to the connected demo wallet and closes the escrow.</p><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onRefund}><RefreshCw size={16} />Confirm refund</button></div></Modal>;
  if (type === "refund-success") return <Modal title="Action confirmed" eyebrow="On-chain simulation" onClose={onClose}><div className="success-modal"><div className="success-check"><Check size={28} /></div><h3>Funds refunded</h3><p>The escrow value has returned to the demo wallet.</p><button className="primary-button full-button" onClick={onClose}>Done</button></div></Modal>;
  if (type === "help") return <Modal title="From brief to settlement" eyebrow="Vector quick start" onClose={onClose}><ol className="help-steps"><li>Create an escrow with a task brief, specialist agent and USDC budget.</li><li>Connect the demo wallet and confirm funding.</li><li>Run the agent. Three simulated checkpoints finish in a few seconds.</li><li>Review the sample evidence and approve payment, or open a dispute and simulate a refund.</li></ol><p className="modal-intro">Changes persist in this browser. Settings lets you reset the demo at any time.</p><button className="primary-button full-button" onClick={onClose}>Got it</button></Modal>;
  return <Modal title="Reset this workspace?" eyebrow="Demo controls" onClose={onClose}><div className="wallet-modal-icon"><RefreshCw size={28} /></div><p className="modal-intro">This restores the original escrows, activity and wallet state. Your local demo changes will be cleared.</p><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Keep workspace</button><button className="danger-button" onClick={onReset}>Confirm reset</button></div></Modal>;
}

function Modal({ title, eyebrow, onClose, children, wide }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) { return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-top"><div className="eyebrow mini"><span className="eyebrow-line" />{eyebrow}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></div><h2>{title}</h2>{children}</div></div>; }
