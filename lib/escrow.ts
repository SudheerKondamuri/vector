export type AgentId = "atlas" | "sentinel" | "scout" | "quill";
export type EscrowStatus = "draft" | "funded" | "running" | "review" | "released" | "disputed" | "refunded" | "failed" | "expired";
export type EscrowAction = "fund" | "start" | "advance" | "release" | "dispute" | "refund";

export type Milestone = {
  id: string;
  title: string;
  detail: string;
  complete: boolean;
};

export type Escrow = {
  id: string;
  title: string;
  description: string;
  agentId: AgentId;
  amount: number;
  deadline: number;
  status: EscrowStatus;
  milestones: Milestone[];
  createdAt: string;
  updatedAt: string;
  txHash?: string;
  disputeReason?: string;
};

export type EscrowDraft = {
  title: string;
  description: string;
  agentId: string;
  amount: string;
  deadline: string;
};

export type DemoState = {
  version: 1;
  escrows: Escrow[];
  walletConnected: boolean;
  balance: number;
  activity: ActivityItem[];
};

export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: "lime" | "violet" | "cyan" | "amber" | "red";
};

export const DEMO_BALANCE = 24850;
export const STORAGE_KEY = "vector-escrow-demo-v1";

const AGENTS: AgentId[] = ["atlas", "sentinel", "scout", "quill"];
const STATUSES: EscrowStatus[] = ["draft", "funded", "running", "review", "released", "disputed", "refunded", "failed", "expired"];

const now = () => new Date().toISOString();

export function validateDraft(draft: EscrowDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = draft.title?.trim() ?? "";
  const description = draft.description?.trim() ?? "";
  const amount = Number(draft.amount);
  const deadline = Number(draft.deadline);

  if (title.length < 2 || title.length > 100) errors.title = "Use a task name between 2 and 100 characters.";
  if (description.length < 12) errors.description = "Add a brief with at least 12 characters.";
  if (!AGENTS.includes(draft.agentId as AgentId)) errors.agentId = "Choose an available agent.";
  if (!Number.isFinite(amount) || !Number.isInteger(amount * 100) || amount < 1 || amount > 10000) errors.amount = "Budget must be between 1 and 10,000 USDC.";
  if (!Number.isInteger(deadline) || deadline < 1 || deadline > 30) errors.deadline = "Deadline must be between 1 and 30 days.";
  return errors;
}

export function createEscrow(draft: EscrowDraft, id = `escrow-${Date.now()}`): Escrow {
  const errors = validateDraft(draft);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const timestamp = now();
  return {
    id,
    title: draft.title.trim(),
    description: draft.description.trim(),
    agentId: draft.agentId as AgentId,
    amount: Number(draft.amount),
    deadline: Number(draft.deadline),
    status: "draft",
    milestones: [
      { id: `${id}-brief`, title: "Brief understood", detail: "Agent confirms scope and success criteria.", complete: false },
      { id: `${id}-work`, title: "Agent delivers", detail: "The selected agent completes the requested work.", complete: false },
      { id: `${id}-review`, title: "Human review", detail: "You inspect evidence before releasing payment.", complete: false }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function assertWallet(connected: boolean) {
  if (!connected) throw new Error("Connect a wallet before signing this transaction.");
}

export function transitionEscrow(escrow: Escrow, action: EscrowAction, walletConnected: boolean, availableBalance: number): Escrow {
  const next: Escrow = { ...escrow, milestones: escrow.milestones.map(milestone => ({ ...milestone })) };
  next.updatedAt = now();
  if (action === "fund") {
    assertWallet(walletConnected);
    if (escrow.status !== "draft") throw new Error("Only a draft escrow can be funded.");
    if (availableBalance < escrow.amount) throw new Error("Insufficient demo wallet balance.");
    next.status = "funded";
    next.txHash = `0x${escrow.id.replace(/[^a-z0-9]/gi, "").padEnd(16, "0").slice(0, 16)}`;
  } else if (action === "start") {
    if (escrow.status !== "funded") throw new Error("Fund the escrow before running the agent.");
    next.status = "running";
  } else if (action === "advance") {
    if (escrow.status !== "running") throw new Error("The agent is not running.");
    const nextMilestone = next.milestones.find(milestone => !milestone.complete);
    if (!nextMilestone) throw new Error("All milestones are already complete.");
    nextMilestone.complete = true;
    if (next.milestones.every(milestone => milestone.complete)) next.status = "review";
  } else if (action === "release") {
    assertWallet(walletConnected);
    if (escrow.status !== "review") throw new Error("The escrow is not ready for release.");
    if (!escrow.milestones.every(milestone => milestone.complete)) throw new Error("Complete every milestone before release.");
    next.status = "released";
  } else if (action === "dispute") {
    assertWallet(walletConnected);
    if (!["funded", "running", "review"].includes(escrow.status)) throw new Error("This escrow cannot be disputed now.");
    next.status = "disputed";
  } else if (action === "refund") {
    assertWallet(walletConnected);
    if (escrow.status !== "disputed") throw new Error("Open a dispute before refunding.");
    next.status = "refunded";
  }
  return next;
}

export function getTotals(escrows: Escrow[]) {
  const lockedStatuses: EscrowStatus[] = ["funded", "running", "review", "disputed"];
  const settledStatuses: EscrowStatus[] = ["released"];
  const locked = escrows.filter(escrow => lockedStatuses.includes(escrow.status)).reduce((sum, escrow) => sum + escrow.amount, 0);
  const settled = escrows.filter(escrow => settledStatuses.includes(escrow.status)).reduce((sum, escrow) => sum + escrow.amount, 0);
  const active = escrows.filter(escrow => !["released", "refunded", "failed", "expired"].includes(escrow.status)).length;
  return { locked, settled, active, total: locked + settled };
}

function seededEscrow(id: string, title: string, description: string, agentId: AgentId, amount: number, status: EscrowStatus, complete = false): Escrow {
  const item = createEscrow({ title, description, agentId, amount: String(amount), deadline: "7" }, id);
  return { ...item, status, milestones: item.milestones.map((milestone, index) => ({ ...milestone, complete: complete || (status === "review" && index < 3) || (status === "running" && index === 0) })) };
}

export function createInitialState(): DemoState {
  const escrows = [
    seededEscrow("escrow-seo", "SEO & market intelligence", "Map the next category-defining topics and return a cited opportunity brief.", "scout", 4200, "running"),
    seededEscrow("escrow-audit", "Smart contract security audit", "Review the staking module for exploit paths and prioritize remediations.", "sentinel", 5000, "review", true),
    seededEscrow("escrow-research", "DeFi protocol research", "Build a decision memo on liquidity, incentives and protocol risk.", "atlas", 4800, "funded"),
    seededEscrow("escrow-portfolio", "Portfolio risk monitor", "Set up a weekly agent report for wallet concentration and drawdown.", "atlas", 500, "draft"),
    seededEscrow("escrow-released-a", "Treasury runway model", "Model runway scenarios across the current treasury allocation.", "quill", 6200, "released", true),
    seededEscrow("escrow-released-b", "Community sentiment scan", "Summarize community signal from the last governance cycle.", "scout", 4650, "released", true)
  ];
  const activity: ActivityItem[] = [
    { id: "a1", title: "Milestone verified", detail: "Smart contract security audit", timestamp: "2m ago", tone: "lime" },
    { id: "a2", title: "Agent checkpoint", detail: "SEO & market intelligence is running", timestamp: "14m ago", tone: "violet" },
    { id: "a3", title: "Escrow funded", detail: "DeFi protocol research · 4,800 USDC", timestamp: "1h ago", tone: "cyan" },
    { id: "a4", title: "Payment released", detail: "Treasury runway model · 6,200 USDC", timestamp: "3h ago", tone: "lime" }
  ];
  return { version: 1, escrows, walletConnected: false, balance: DEMO_BALANCE, activity };
}

function validEscrow(value: unknown): value is Escrow {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Escrow>;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.amount === "number" && Number.isFinite(item.amount) && typeof item.description === "string" && AGENTS.includes(item.agentId as AgentId) && STATUSES.includes(item.status as EscrowStatus) && Array.isArray(item.milestones) && item.milestones.length === 3 && item.milestones.every(m => Boolean(m) && typeof m === "object" && typeof (m as Milestone).title === "string" && typeof (m as Milestone).complete === "boolean");
}

export function restoreState(raw: string | null): DemoState {
  const fallback = createInitialState();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.escrows) || !parsed.escrows.every(validEscrow)) return fallback;
    if (typeof parsed.balance !== "number" || !Number.isFinite(parsed.balance) || parsed.balance < 0) return fallback;
    if (typeof parsed.walletConnected !== "boolean" || !Array.isArray(parsed.activity)) return fallback;
    return { version: 1, escrows: parsed.escrows, balance: parsed.balance, walletConnected: parsed.walletConnected, activity: parsed.activity };
  } catch {
    return fallback;
  }
}
