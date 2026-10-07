import type { MarketplaceProfile, PilotSubmission, PilotTask } from "./pilot-types.ts";

const CAPABILITY_ALIASES: Record<string, string[]> = {
  solidity: ["solidity", "evm", "ethereum", "smart contract"],
  "evm-gas": ["gas", "evm", "foundry", "forge", "optimization", "optimisation"],
  foundry: ["foundry", "forge"],
  security: ["security", "audit", "vulnerability", "exploit"],
  typescript: ["typescript", "ts", "node"],
  javascript: ["javascript", "js", "node"],
  python: ["python", "pytest"],
  go: ["golang", "go"],
};

function text(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function taskCorpus(task: Pick<PilotTask, "target" | "description" | "constraints">): string {
  return text(`${task.target} ${task.description} ${task.constraints}`);
}

export function capabilityMatch(task: Pick<PilotTask, "target" | "description" | "constraints">, profile: Pick<MarketplaceProfile, "capabilities" | "availability">): { matched: string[]; score: number } {
  if (profile.availability !== "available") return { matched: [], score: 0 };
  const corpus = taskCorpus(task);
  const matched = [...new Set(profile.capabilities.map(capability => capability.trim()).filter(Boolean))].filter(capability => {
    const key = text(capability);
    const aliases = CAPABILITY_ALIASES[key] || [key];
    return aliases.some(alias => corpus.includes(text(alias)));
  });
  return { matched, score: matched.length ? Math.min(1, matched.length / Math.max(1, profile.capabilities.length)) : 0 };
}

function scoredMetrics(submission: PilotSubmission): Array<{ baseline: number; candidate: number; improvementPct: number }> {
  const metrics = submission.evidence?.metrics || [];
  const aggregate = metrics.filter(metric => metric.name.toLowerCase().includes("aggregate"));
  return aggregate.length ? aggregate : metrics;
}

export function scoreSubmission(_task: Pick<PilotTask, "minImprovementPct">, submission: PilotSubmission): number {
  const evidence = submission.evidence;
  if (!evidence || !["passed", "recorded"].includes(evidence.outcome) || !evidence.checks.length) return 0;
  const checks = evidence.checks.filter(check => check.passed).length / evidence.checks.length;
  const metrics = scoredMetrics(submission);
  if (!metrics.length) return checks * 10;
  const improvement = metrics.reduce((sum, metric) => sum + ((metric.baseline - metric.candidate) / metric.baseline * 100), 0) / metrics.length;
  return Math.max(0, improvement) * 0.9 + checks * 10;
}

export function rankSubmissions(task: Pick<PilotTask, "minImprovementPct">, submissions: PilotSubmission[]): PilotSubmission[] {
  return [...submissions].sort((left, right) => scoreSubmission(task, right) - scoreSubmission(task, left) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function requiredCapabilityNames(task: Pick<PilotTask, "target" | "description" | "constraints">): string[] {
  const corpus = taskCorpus(task);
  return Object.keys(CAPABILITY_ALIASES).filter(capability => CAPABILITY_ALIASES[capability].some(alias => corpus.includes(text(alias))));
}
