import { createPublicClient, decodeEventLog, http, parseAbiItem, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { reconcileEscrowEvent } from "../pilot-server/settlement.ts";
import { getPilotStore } from "../pilot-server/store.ts";

const CHAIN_ID = 84532;
const EVENT_DEFINITIONS = [
  { name: "EscrowFunded", abi: parseAbiItem("event EscrowFunded(uint256 indexed escrowId, address indexed sponsor, address indexed operator, address token, uint256 amount, bytes32 taskHash, bytes32 policyHash)") },
  { name: "ReleaseRequested", abi: parseAbiItem("event ReleaseRequested(uint256 indexed escrowId, uint256 challengeEndsAt)") },
  { name: "ChallengeOpened", abi: parseAbiItem("event ChallengeOpened(uint256 indexed escrowId, address indexed operator)") },
  { name: "EscrowReleased", abi: parseAbiItem("event EscrowReleased(uint256 indexed escrowId, address indexed operator, uint256 amount)") },
  { name: "EscrowRefunded", abi: parseAbiItem("event EscrowRefunded(uint256 indexed escrowId, address indexed sponsor, uint256 amount)") },
  { name: "EscrowCancelled", abi: parseAbiItem("event EscrowCancelled(uint256 indexed escrowId, address indexed sponsor, uint256 amount)") },
] as const;

type ChainLog = { data: `0x${string}`; topics: readonly `0x${string}`[]; transactionHash: `0x${string}`; logIndex: number; blockNumber: bigint };

function text(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

export function chainPayload(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, text(value)]));
}

export function chainEventInput(contractAddress: string, definition: { name: string; abi: unknown }, log: ChainLog): { chainId: number; contractAddress: string; txHash: string; logIndex: number; blockNumber: string; eventName: string; payload: Record<string, string> } {
  const decoded = decodeEventLog({ abi: [definition.abi as never], data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
  return { chainId: CHAIN_ID, contractAddress, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber.toString(), eventName: definition.name, payload: chainPayload(decoded.args as Record<string, unknown>) };
}

function configuredAddress(): string | undefined {
  const value = process.env.BASE_SEPOLIA_ESCROW_ADDRESS?.trim();
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : undefined;
}

function configuredBlock(): bigint {
  const value = process.env.BASE_SEPOLIA_START_BLOCK?.trim();
  return value && /^\d+$/.test(value) ? BigInt(value) : BigInt(0);
}

export async function reconcileSettlementEvents(): Promise<{ scanned: number; recorded: number; fromBlock?: string; toBlock?: string }> {
  const rpc = process.env.BASE_SEPOLIA_RPC_URL?.trim();
  const contract = configuredAddress();
  if (!rpc || !contract) return { scanned: 0, recorded: 0 };
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const latest = await client.getBlockNumber();
  const confirmations = BigInt(Math.max(0, Number(process.env.BASE_SEPOLIA_CONFIRMATIONS || 3)));
  if (latest <= confirmations) return { scanned: 0, recorded: 0 };
  const toBlock = latest - confirmations;
  const state = await getPilotStore().read();
  const knownBlocks = state.escrowEvents.filter(event => event.chainId === CHAIN_ID && event.contractAddress.toLowerCase() === contract.toLowerCase()).map(event => BigInt(event.blockNumber));
  const latestKnown = knownBlocks.length ? knownBlocks.reduce((max, value) => value > max ? value : max, BigInt(0)) : undefined;
  const overlap = BigInt(Math.max(0, Number(process.env.BASE_SEPOLIA_REORG_OVERLAP_BLOCKS || 12)));
  const fromBlock = latestKnown === undefined ? configuredBlock() : (latestKnown > overlap ? latestKnown - overlap : BigInt(0));
  if (fromBlock > toBlock) return { scanned: 0, recorded: 0, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() };
  let scanned = 0;
  let recorded = 0;
  for (const definition of EVENT_DEFINITIONS) {
    const logs = await client.getLogs({ address: contract as Address, event: definition.abi, fromBlock, toBlock });
    for (const log of logs) {
      scanned += 1;
      const result = await reconcileEscrowEvent(chainEventInput(contract, definition, log as ChainLog));
      if (!result.duplicate) recorded += 1;
    }
  }
  return { scanned, recorded, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() };
}
