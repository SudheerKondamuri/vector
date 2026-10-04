import { REFERENCE_COMMIT, REFERENCE_PATH, type PilotTask, type PilotTaskInput, type TaskStatus } from "../../lib/pilot-types";

export type WorkspaceDraft = Omit<PilotTaskInput,
  "scopePaths" | "inviteEmails" | "minImprovementPct" | "maxSubmissions" | "priceUsd" | "operatorRewardUsd"
> & {
  scopePaths: string;
  inviteEmails: string;
  minImprovementPct: string;
  maxSubmissions: string;
  priceUsd: string;
  operatorRewardUsd: string;
};

export type WorkspaceTaskFilter = { ownership: "all" | "owned" | "invited"; status: TaskStatus | "all"; search: string };

function dateTimeLocal(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function createWorkspaceDraft(fixture: PilotTaskInput["fixture"], now = new Date()): WorkspaceDraft {
  const reference = fixture === "reference";
  return {
    fixture,
    title: reference ? "Optimize the GasTarget reference benchmark" : "",
    description: reference
      ? "Improve gas use in the bundled Solidity reference benchmark while preserving its public interface, outputs and test behavior. This is a local verification exercise with no service fee or operator payment."
      : "",
    repoUrl: "",
    baseCommit: reference ? REFERENCE_COMMIT : "",
    target: reference ? "GasTarget reference gas benchmark" : "",
    scopePaths: reference ? REFERENCE_PATH : "",
    constraints: reference
      ? "Change only src/GasTarget.sol. Preserve public interfaces, arithmetic results and all reference test behavior. No new dependencies, external calls or storage layout changes."
      : "Preserve public interfaces, outputs, access control and storage layout. Keep the existing tests passing. No new dependencies or external calls. Limit edits to the listed scope paths.",
    minImprovementPct: "10",
    deadline: dateTimeLocal(new Date(now.getTime() + 7 * 24 * 60 * 60_000)),
    maxSubmissions: "5",
    priceUsd: "0",
    operatorRewardUsd: "0",
    paymentTerms: reference
      ? "Reference exercise: no service charge or operator payment. No funds are collected or transferred."
      : "No automatic collection or payout. Agree an invoice and payment schedule separately; record actual payments in the manual ledger.",
    reviewTerms: reference
      ? "Accept only after the bundled reference checks pass, the minimum gas improvement is met and the sponsor records a reasoned review. A passing check is not automatic acceptance."
      : "Sponsor reviews the patch, scope compliance and reproducible benchmark evidence. External reports are unverified records; acceptance requires a reasoned manual review.",
    inviteEmails: "",
  };
}

function entries(value: string) {
  return [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))];
}

function safeScopePath(path: string) {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return path.length <= 240 && /^[a-zA-Z0-9._/-]+$/.test(path) && !normalized.startsWith("/")
    && !normalized.split("/").some(part => !part || part.startsWith("."));
}

export function validateWorkspaceCredentials(input: { name: string; email: string; password: string }, register: boolean) {
  const errors: Record<string, string> = {};
  if (register && (!input.name.trim() || input.name.length > 100 || input.name.includes("\0"))) errors.name = "Enter your name (up to 100 characters).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.trim().length > 254) errors.email = "Enter a valid email address.";
  if (input.password.trim().length < (register ? 12 : 1) || input.password.length > 256 || input.password.includes("\0") || new TextEncoder().encode(input.password).length > 512) {
    errors.password = register ? "Use a password with 12–256 characters (up to 512 UTF-8 bytes)." : "Enter your password (up to 256 characters).";
  }
  return errors;
}

export function validateWorkspaceTaskDraft(draft: WorkspaceDraft, now = new Date()): { errors: Record<string, string>; input?: PilotTaskInput } {
  const errors: Record<string, string> = {};
  const text = (key: "title" | "description" | "target" | "constraints" | "paymentTerms" | "reviewTerms", label: string, min: number, max: number) => {
    const value = draft[key].trim();
    if (value.length < min || value.length > max) errors[key] = `${label} must be ${min}–${max.toLocaleString()} characters.`;
    return value;
  };
  const title = text("title", "Title", 3, 140);
  const description = text("description", "Brief", 10, 10_000);
  const target = text("target", "Benchmark target", 3, 300);
  const constraints = text("constraints", "Constraints", 10, 10_000);
  const paymentTerms = text("paymentTerms", "Payment terms", 10, 4_000);
  const reviewTerms = text("reviewTerms", "Review terms", 10, 4_000);
  const repoUrl = draft.repoUrl.trim();
  const baseCommit = draft.baseCommit.trim().toLowerCase();
  const scopePaths = entries(draft.scopePaths);
  const inviteEmails = entries(draft.inviteEmails.toLowerCase());

  if (draft.fixture === "external") {
    try {
      const url = new URL(repoUrl);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash || repoUrl.length > 2048) throw new Error();
    } catch { errors.repoUrl = "Use a full HTTPS repository URL without credentials or a fragment."; }
  } else if (repoUrl) errors.repoUrl = "The reference exercise uses the bundled fixture, not a remote repository.";
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) errors.baseCommit = "Enter the full 40-character hexadecimal commit SHA.";
  if (!scopePaths.length || scopePaths.length > 20 || scopePaths.some(path => !safeScopePath(path))) {
    errors.scopePaths = "List 1–20 relative files or directories using letters, numbers, dashes, underscores and slashes. No hidden, absolute or traversal paths or globs.";
  }
  if (inviteEmails.length > 25 || inviteEmails.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    errors.inviteEmails = "Enter up to 25 valid email addresses, separated by commas or new lines.";
  }

  const minImprovementPct = Number(draft.minImprovementPct);
  if (!draft.minImprovementPct.trim() || !Number.isFinite(minImprovementPct) || minImprovementPct <= 0 || minImprovementPct > 100) {
    errors.minImprovementPct = "Set a minimum improvement greater than 0 and no more than 100%.";
  }
  const maxSubmissions = Number(draft.maxSubmissions);
  if (!draft.maxSubmissions.trim() || !Number.isInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > 100) {
    errors.maxSubmissions = "Allow 1–100 submissions using a whole number.";
  }
  const deadline = new Date(draft.deadline);
  if (!draft.deadline || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= now.getTime()) errors.deadline = "Choose a deadline in the future (your local time).";
  const money = (key: "priceUsd" | "operatorRewardUsd") => {
    const raw = draft[key].trim();
    const amount = Number(raw);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(amount) || amount > 1_000_000) errors[key] = "Enter USD 0–1,000,000 with at most two decimal places.";
    return amount;
  };
  const priceUsd = money("priceUsd");
  const operatorRewardUsd = money("operatorRewardUsd");
  if (Number.isFinite(priceUsd) && Number.isFinite(operatorRewardUsd) && operatorRewardUsd > priceUsd) errors.operatorRewardUsd = "The operator reward cannot exceed the service price.";
  if (draft.fixture === "reference") {
    if (baseCommit !== REFERENCE_COMMIT) errors.baseCommit = "The reference exercise must use its fixed bundled commit.";
    if (scopePaths.length !== 1 || scopePaths[0] !== REFERENCE_PATH) errors.scopePaths = `The reference scope is fixed to ${REFERENCE_PATH}.`;
    if (priceUsd !== 0) errors.priceUsd = "Reference exercises have a USD 0 service price.";
    if (operatorRewardUsd !== 0) errors.operatorRewardUsd = "Reference exercises have a USD 0 operator reward.";
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: { title, description, fixture: draft.fixture, repoUrl, baseCommit, target, scopePaths, constraints, minImprovementPct,
      deadline: deadline.toISOString(), maxSubmissions, priceUsd, operatorRewardUsd, paymentTerms, reviewTerms, inviteEmails },
  };
}

export function filterWorkspaceTasks(tasks: PilotTask[], userId: string, filter: WorkspaceTaskFilter) {
  const search = filter.search.trim().toLowerCase();
  return tasks.filter(task => (filter.ownership === "all" || (filter.ownership === "owned" ? task.ownerId === userId : task.ownerId !== userId))
    && (filter.status === "all" || task.status === filter.status)
    && (!search || [task.title, task.description, task.target, task.ownerName].some(value => value.toLowerCase().includes(search))));
}

export function workspaceTaskSummary(tasks: PilotTask[], userId: string) {
  const owned = tasks.filter(task => task.ownerId === userId);
  return {
    total: tasks.length,
    owned: owned.length,
    invited: tasks.length - owned.length,
    active: tasks.filter(task => task.status === "open" || task.status === "review").length,
    needsReview: owned.filter(task => task.status === "review").length,
    accepted: tasks.filter(task => task.status === "accepted").length,
    drafts: owned.filter(task => task.status === "draft").length,
  };
}
