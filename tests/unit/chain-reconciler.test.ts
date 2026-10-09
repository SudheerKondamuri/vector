import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { chainEventInput, chainPayload, reconcileSettlementEvents } from "../../lib/production/chain-reconciler";

afterEach(() => vi.unstubAllEnvs());

describe("Base Sepolia settlement reconciler", () => {
  it("normalizes bigint event arguments into bounded string payloads", () => {
    expect(chainPayload({ escrowId: BigInt(7), amount: BigInt("12345678901234567890"), sponsor: "0xabc" })).toEqual({ escrowId: "7", amount: "12345678901234567890", sponsor: "0xabc" });
  });

  it("does not contact an RPC when settlement deployment is not configured", async () => {
    delete process.env.BASE_SEPOLIA_RPC_URL;
    delete process.env.BASE_SEPOLIA_ESCROW_ADDRESS;
    await expect(reconcileSettlementEvents()).resolves.toEqual({ scanned: 0, recorded: 0 });
  });

  it("decodes an indexed event into the reconciler contract", () => {
    const abi = parseAbiItem("event ReleaseRequested(uint256 indexed escrowId, uint256 challengeEndsAt)");
    const topics = encodeEventTopics({ abi: [abi], eventName: "ReleaseRequested", args: { escrowId: BigInt(9) } });
    const data = encodeAbiParameters([{ type: "uint256" }], [BigInt(123)]);
    const normalizedTopics = topics.filter((topic): topic is `0x${string}` => typeof topic === "string");
    expect(chainEventInput("0x1111111111111111111111111111111111111111", { name: "ReleaseRequested", abi }, { data, topics: normalizedTopics, transactionHash: `0x${"a".repeat(64)}`, logIndex: 2, blockNumber: BigInt(42) })).toMatchObject({ eventName: "ReleaseRequested", blockNumber: "42", payload: { escrowId: "9", challengeEndsAt: "123" } });
  });
});
