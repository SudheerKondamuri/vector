export const STAGES = ['open', 'committed', 'revealed', 'verified', 'settled'] as const;
export type Stage = (typeof STAGES)[number];
export type Category = 'DeFi' | 'Optimization' | 'Data';

export type Bounty = {
  id: string;
  title: string;
  description: string;
  category: Category;
  reward: number;
  agents: number;
  duration: number;
  stage: Stage;
  createdAt: number;
  owner: boolean;
};

export type Agent = {
  id: string;
  name: string;
  handle: string;
  role: string;
  color: string;
  success: number;
  earned: number;
  runs: number;
  description: string;
};

export type Activity = {
  id: string;
  message: string;
  time: number;
  type: 'created' | 'progress' | 'wallet' | 'reset';
};

export type DemoState = {
  version: 1;
  walletConnected: boolean;
  bounties: Bounty[];
  activity: Activity[];
};

export type BountyInput = {
  title: string;
  description: string;
  category: Category;
  reward: number;
  duration: number;
};

export const STAGE_LABELS: Record<Stage, string> = {
  open: 'OPEN',
  committed: 'COMMIT',
  revealed: 'REVEAL',
  verified: 'VERIFY',
  settled: 'SETTLED',
};

export const AGENTS: Agent[] = [
  { id: 'cipher', name: 'Cipher', handle: '@cipher_works', role: 'Route optimizer', color: '#c9fb77', success: 98.2, earned: 18420, runs: 142, description: 'Searches path space until the route is mathematically boring.' },
  { id: 'atlas', name: 'Atlas', handle: '@atlas_machine', role: 'DeFi strategist', color: '#ae93ff', success: 96.4, earned: 22180, runs: 118, description: 'Reads liquidity like a map. Never takes the scenic route.' },
  { id: 'nexus', name: 'Nexus', handle: '@nexus_signal', role: 'Data verifier', color: '#79d4e5', success: 99.1, earned: 12890, runs: 204, description: 'Turns messy evidence into a clean, verifiable signal.' },
  { id: 'spectra', name: 'Spectra', handle: '@spectra_ai', role: 'MEV sentinel', color: '#f4a7c1', success: 94.8, earned: 16740, runs: 93, description: 'Sees the transaction before it becomes a transaction.' },
  { id: 'morrow', name: 'Morrow', handle: '@morrowlabs', role: 'Proof engineer', color: '#ffbe7a', success: 97.7, earned: 8950, runs: 76, description: 'Makes complex assertions feel like simple yes or no questions.' },
];

const DAY = 86_400_000;
const SEED_TIME = 1_759_430_400_000;

const seededBounties: Bounty[] = [
  { id: 'eth-usdc-route', title: 'Find the optimal ETH → USDC route', description: 'Find the best execution route across the simulated liquidity graph with less than 12 bps of slippage.', category: 'DeFi', reward: 2400, agents: 6, duration: 18, stage: 'open', createdAt: SEED_TIME - 1_800_000, owner: false },
  { id: 'merkle-drop', title: 'Compress a 10k leaf distribution', description: 'Generate the smallest proof bundle for a distribution tree while keeping verification under 180k gas.', category: 'Optimization', reward: 1800, agents: 4, duration: 9, stage: 'committed', createdAt: SEED_TIME - DAY, owner: false },
  { id: 'liquidation-cascade', title: 'Model the liquidation cascade', description: 'Identify the lowest-risk unwind sequence for a three-asset lending position.', category: 'DeFi', reward: 3200, agents: 8, duration: 27, stage: 'revealed', createdAt: SEED_TIME - 2 * DAY, owner: false },
  { id: 'gas-golf', title: 'Cut this swapper below 68k gas', description: 'Return an equivalent execution plan and a compact rationale for every saved opcode.', category: 'Optimization', reward: 950, agents: 3, duration: 6, stage: 'verified', createdAt: SEED_TIME - 3 * DAY, owner: false },
  { id: 'oracle-drift', title: 'Detect oracle drift before the block', description: 'Find anomalous price movement in the supplied block window and explain the confidence score.', category: 'Data', reward: 1250, agents: 5, duration: 14, stage: 'settled', createdAt: SEED_TIME - 5 * DAY, owner: false },
  { id: 'vault-rebalance', title: 'Rebalance the vault with zero dust', description: 'Propose a deterministic sequence that leaves no residual token balance after rebalance.', category: 'DeFi', reward: 2100, agents: 5, duration: 22, stage: 'open', createdAt: SEED_TIME - 4 * DAY, owner: false },
];

export const INITIAL_STATE: DemoState = {
  version: 1,
  walletConnected: false,
  bounties: seededBounties,
  activity: [
    { id: 'activity-1', message: 'Cipher entered the ETH → USDC route arena', time: SEED_TIME - 180_000, type: 'progress' },
    { id: 'activity-2', message: 'Gas Golf evidence passed verification', time: SEED_TIME - 720_000, type: 'progress' },
    { id: 'activity-3', message: 'New bounty published: Vault rebalance', time: SEED_TIME - 3_600_000, type: 'created' },
  ],
};

export function cloneInitialState(): DemoState {
  return JSON.parse(JSON.stringify(INITIAL_STATE)) as DemoState;
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
}

export function validateBounty(input: BountyInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 8 || title.length > 90) errors.title = 'Use 8–90 characters.';
  if (description.length < 20 || description.length > 1000) errors.description = 'Use 20–1,000 characters.';
  if (!['DeFi', 'Optimization', 'Data'].includes(input.category)) errors.category = 'Choose a valid category.';
  if (!Number.isFinite(input.reward) || input.reward < 10 || input.reward > 100000) errors.reward = 'Reward must be between $10 and $100,000.';
  if (![6, 12, 24, 48, 72].includes(input.duration)) errors.duration = 'Choose a valid duration.';
  return errors;
}

function withActivity(state: DemoState, message: string, type: Activity['type'], now: number): DemoState {
  return { ...state, activity: [{ id: `activity-${now}-${state.activity.length}`, message, time: now, type }, ...state.activity].slice(0, 12) };
}

export function createBounty(state: DemoState, input: BountyInput, id = `bounty-${Date.now()}`, now = Date.now()): DemoState {
  const errors = validateBounty(input);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  if (!state.walletConnected) throw new Error('Connect the demo wallet before publishing.');
  const bounty: Bounty = { id, title: input.title.trim(), description: input.description.trim(), category: input.category, reward: input.reward, agents: 0, duration: input.duration, stage: 'open', createdAt: now, owner: true };
  return withActivity({ ...state, bounties: [bounty, ...state.bounties] }, `You published “${bounty.title}”`, 'created', now);
}

export function advanceBounty(state: DemoState, id: string, now = Date.now()): DemoState {
  if (!state.walletConnected) throw new Error('Connect the demo wallet to advance a simulation.');
  const index = state.bounties.findIndex((bounty) => bounty.id === id);
  if (index === -1) return state;
  const bounty = state.bounties[index];
  if (bounty.stage === 'settled') return state;
  const nextStage = STAGES[STAGES.indexOf(bounty.stage) + 1];
  if (!nextStage) return state;
  const updated = { ...bounty, stage: nextStage, agents: Math.max(bounty.agents, nextStage === 'committed' ? 3 : bounty.agents) };
  const bounties = state.bounties.slice();
  bounties[index] = updated;
  const message = nextStage === 'settled' ? `Settlement released for “${bounty.title}”` : `“${bounty.title}” moved to ${STAGE_LABELS[nextStage].toLowerCase()}`;
  return withActivity({ ...state, bounties }, message, 'progress', now);
}

export function toggleWallet(state: DemoState, now = Date.now()): DemoState {
  const connected = !state.walletConnected;
  return withActivity({ ...state, walletConnected: connected }, connected ? 'Demo wallet connected · local fork' : 'Demo wallet disconnected', 'wallet', now);
}

function isValidBounty(value: unknown): value is Bounty {
  if (!value || typeof value !== 'object') return false;
  const bounty = value as Bounty;
  return typeof bounty.id === 'string' && typeof bounty.title === 'string' && typeof bounty.description === 'string' && ['DeFi', 'Optimization', 'Data'].includes(bounty.category) && Number.isFinite(bounty.reward) && Number.isFinite(bounty.duration) && STAGES.includes(bounty.stage) && Number.isFinite(bounty.createdAt) && Number.isFinite(bounty.agents) && typeof bounty.owner === 'boolean';
}

export function parseSavedState(raw: string | null): DemoState {
  if (!raw) return cloneInitialState();
  try {
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (parsed.version !== 1 || typeof parsed.walletConnected !== 'boolean' || !Array.isArray(parsed.bounties) || !parsed.bounties.every(isValidBounty)) return cloneInitialState();
    const activity = Array.isArray(parsed.activity) ? parsed.activity.filter((item) => item && typeof item.id === 'string' && typeof item.message === 'string' && Number.isFinite(item.time)).slice(0, 12) as Activity[] : [];
    return { version: 1, walletConnected: parsed.walletConnected, bounties: parsed.bounties, activity };
  } catch {
    return cloneInitialState();
  }
}

export function getEvidence(bounty: Bounty) {
  const route = bounty.category === 'DeFi' ? 'multi-hop path / WETH → USDC' : bounty.category === 'Optimization' ? 'compressed execution trace' : 'anomaly cluster / block window';
  return {
    winner: AGENTS[(bounty.title.length + bounty.agents) % AGENTS.length].name,
    output: route,
    improvement: bounty.category === 'Optimization' ? '−18.4% execution cost' : bounty.category === 'Data' ? '+23.1% signal confidence' : '−11.8 bps price impact',
    gas: bounty.category === 'Optimization' ? '61,842 gas' : '142,908 gas',
    hash: `0x${(bounty.id + '8f3c9a1b7e').split('').map((char) => char.charCodeAt(0).toString(16)).join('').slice(0, 18)}`,
    checks: [
      { label: 'Output matches task schema', passed: true },
      { label: 'No replayed commitment', passed: true },
      { label: 'Constraint bounds respected', passed: bounty.stage !== 'open' },
      { label: 'Independent verifier agrees', passed: bounty.stage === 'verified' || bounty.stage === 'settled' },
    ],
  };
}
