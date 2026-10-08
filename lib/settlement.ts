export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_HEX_CHAIN_ID = "0x14a34";

export const VECTOR_ESCROW_ABI = [
  { type: "function", name: "createEscrow", stateMutability: "nonpayable", inputs: [
    { name: "operator", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint128" },
    { name: "taskHash", type: "bytes32" }, { name: "policyHash", type: "bytes32" }, { name: "challengePeriod", type: "uint64" },
  ], outputs: [{ name: "escrowId", type: "uint256" }] },
  { type: "function", name: "requestRelease", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }], outputs: [] },
  { type: "function", name: "challenge", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }], outputs: [] },
  { type: "function", name: "finalizeRelease", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }], outputs: [] },
  { type: "function", name: "resolveChallenge", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }, { name: "releaseToOperator", type: "bool" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }], outputs: [] },
  { type: "event", name: "EscrowFunded", anonymous: false, inputs: [
    { indexed: true, name: "escrowId", type: "uint256" }, { indexed: true, name: "sponsor", type: "address" }, { indexed: true, name: "operator", type: "address" },
    { indexed: false, name: "token", type: "address" }, { indexed: false, name: "amount", type: "uint256" }, { indexed: false, name: "taskHash", type: "bytes32" }, { indexed: false, name: "policyHash", type: "bytes32" },
  ] },
  { type: "event", name: "ReleaseRequested", anonymous: false, inputs: [{ indexed: true, name: "escrowId", type: "uint256" }, { indexed: false, name: "challengeEndsAt", type: "uint256" }] },
  { type: "event", name: "ChallengeOpened", anonymous: false, inputs: [{ indexed: true, name: "escrowId", type: "uint256" }, { indexed: true, name: "operator", type: "address" }] },
  { type: "event", name: "EscrowReleased", anonymous: false, inputs: [{ indexed: true, name: "escrowId", type: "uint256" }, { indexed: true, name: "operator", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] },
  { type: "event", name: "EscrowRefunded", anonymous: false, inputs: [{ indexed: true, name: "escrowId", type: "uint256" }, { indexed: true, name: "sponsor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] },
  { type: "event", name: "EscrowCancelled", anonymous: false, inputs: [{ indexed: true, name: "escrowId", type: "uint256" }, { indexed: true, name: "sponsor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
