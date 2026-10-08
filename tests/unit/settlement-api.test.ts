import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePilotRequest } from "../../lib/pilot-server/http";
import { reconcileEscrowEvent } from "../../lib/pilot-server/settlement";
import { getPilotStore } from "../../lib/pilot-server/store";

const origin = "http://localhost:3000";
const patch = "diff --git a/src/Target.sol b/src/Target.sol\n--- a/src/Target.sol\n+++ b/src/Target.sol\n@@ -1 +1 @@\n-contract Target {}\n+contract Target { uint256 value; }\n";
const input = { title: "Settlement task", description: "A bounded technical task with testnet settlement.", fixture: "external", repoUrl: "https://example.com/repository", baseCommit: "a".repeat(40), target: "Target.run", scopePaths: ["src/Target.sol"], constraints: "Preserve behavior.", minImprovementPct: 10, deadline: new Date(Date.now() + 86_400_000).toISOString(), maxSubmissions: 5, priceUsd: 100, operatorRewardUsd: 50, paymentTerms: "Base Sepolia test token.", reviewTerms: "Sponsor reviews.", inviteEmails: [] };
let directory: string;
async function request(path: string, method = "GET", body?: unknown, cookie?: string) { return handlePilotRequest(new Request(`${origin}/api/pilot${path}`, { method, headers: { ...(method !== "GET" ? { origin, "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })); }
async function account(email: string) { const response = await request("/auth/register", "POST", { name: email.split("@")[0], email, password: "settlement test password 123" }); return { cookie: response.headers.get("set-cookie")!.split(";")[0], ...(await response.json()) }; }
const report = { environment: "isolated", checks: [{ name: "behavior", passed: true, detail: "pass" }], metrics: [{ name: "Target.run", baseline: 100, candidate: 70 }], logs: ["done"], replayCommand: "forge test", limitations: ["manual"] };

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "vector-settlement-")); vi.stubEnv("VECTOR_DATA_DIR", directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("escrow settlement API", () => {
  it("creates intent, records wallet transactions, and deduplicates chain events", async () => {
    const owner = await account("owner@example.test");
    const operator = await account("operator@example.test");
    const task = (await (await request("/tasks", "POST", input, owner.cookie)).json()).task;
    await request(`/tasks/${task.id}/publish`, "POST", {}, owner.cookie);
    const submission = (await (await request(`/tasks/${task.id}/submissions`, "POST", { patch, baseCommit: input.baseCommit, method: "measured", computeUsd: 1, effortMinutes: 2 }, operator.cookie)).json()).submission;
    await request(`/submissions/${submission.id}/report`, "POST", report, operator.cookie);
    await request(`/submissions/${submission.id}/review`, "POST", { decision: "accept", reason: "Accepted.", minutes: 1 }, owner.cookie);
    const intent = await request(`/tasks/${task.id}/escrow-intent`, "POST", { sponsorAddress: "0x1111111111111111111111111111111111111111", operatorAddress: "0x2222222222222222222222222222222222222222", tokenAddress: "0x3333333333333333333333333333333333333333", contractAddress: "0x4444444444444444444444444444444444444444", amountAtomic: "50000000", chainId: 84532, challengePeriodSeconds: 172800 }, owner.cookie);
    expect(intent.status).toBe(201);
    const escrow = (await intent.json()).escrow;
    expect(escrow.taskHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect((await request(`/escrows/${escrow.id}/funding`, "POST", { txHash: "0x" + "a".repeat(64), onchainEscrowId: "1" }, owner.cookie)).status).toBe(200);
    expect((await request(`/escrows/${escrow.id}/release-request`, "POST", { txHash: "0x" + "b".repeat(64) }, owner.cookie)).status).toBe(200);
    expect((await request(`/escrows/${escrow.id}/challenge`, "POST", { txHash: "0x" + "c".repeat(64) }, operator.cookie)).status).toBe(200);
    const event = { chainId: 84532, contractAddress: escrow.contractAddress, txHash: "0x" + "d".repeat(64), logIndex: 0, blockNumber: "10", eventName: "ChallengeOpened", payload: { escrowId: "1" } };
    expect((await reconcileEscrowEvent(event)).duplicate).toBe(false);
    expect((await reconcileEscrowEvent(event)).duplicate).toBe(true);
    expect((await request(`/escrows/${escrow.id}`, "GET", undefined, operator.cookie)).status).toBe(200);
    expect((await request(`/escrows/${escrow.id}/resolve-challenge?releaseToOperator=false`, "POST", { txHash: "0x" + "e".repeat(64) }, owner.cookie)).status).toBe(200);

    const secondIntent = await request(`/tasks/${task.id}/escrow-intent`, "POST", { sponsorAddress: escrow.sponsorAddress, operatorAddress: escrow.operatorAddress, tokenAddress: escrow.tokenAddress, contractAddress: escrow.contractAddress, amountAtomic: escrow.amountAtomic, chainId: 84532, challengePeriodSeconds: 172800 }, owner.cookie);
    const second = (await secondIntent.json()).escrow;
    await request(`/escrows/${second.id}/funding`, "POST", { txHash: "0x" + "f".repeat(64), onchainEscrowId: "2" }, owner.cookie);
    await reconcileEscrowEvent({ chainId: 84532, contractAddress: second.contractAddress, txHash: "0x" + "1".repeat(64), logIndex: 0, blockNumber: "11", eventName: "ReleaseRequested", payload: { escrowId: "2", challengeEndsAt: String(Math.floor((Date.now() - 1000) / 1000)) } });
    await getPilotStore().mutate(state => { state.escrows.find(item => item.id === second.id)!.challengeEndsAt = new Date(Date.now() - 1000).toISOString(); });
    expect((await request(`/escrows/${second.id}/finalize`, "POST", { txHash: "0x" + "2".repeat(64) }, owner.cookie)).status).toBe(200);

    const thirdIntent = await request(`/tasks/${task.id}/escrow-intent`, "POST", { sponsorAddress: escrow.sponsorAddress, operatorAddress: escrow.operatorAddress, tokenAddress: escrow.tokenAddress, contractAddress: escrow.contractAddress, amountAtomic: escrow.amountAtomic, chainId: 84532, challengePeriodSeconds: 172800 }, owner.cookie);
    const third = (await thirdIntent.json()).escrow;
    await request(`/escrows/${third.id}/funding`, "POST", { txHash: "0x" + "3".repeat(64), onchainEscrowId: "3" }, owner.cookie);
    await request(`/escrows/${third.id}/release-request`, "POST", { txHash: "0x" + "4".repeat(64) }, owner.cookie);
    await request(`/escrows/${third.id}/challenge`, "POST", { txHash: "0x" + "5".repeat(64) }, operator.cookie);
    expect((await request(`/escrows/${third.id}/resolve-challenge?releaseToOperator=true`, "POST", { txHash: "0x" + "6".repeat(64) }, owner.cookie)).status).toBe(200);
  });

  it("blocks settlement intent when the accepted submission has an open review challenge", async () => {
    const owner = await account("owner@example.test");
    const operator = await account("operator@example.test");
    const task = (await (await request("/tasks", "POST", input, owner.cookie)).json()).task;
    await request(`/tasks/${task.id}/publish`, "POST", {}, owner.cookie);
    const submission = (await (await request(`/tasks/${task.id}/submissions`, "POST", { patch, baseCommit: input.baseCommit, method: "measured", computeUsd: 1, effortMinutes: 2 }, operator.cookie)).json()).submission;
    await request(`/submissions/${submission.id}/report`, "POST", report, operator.cookie);
    await request(`/submissions/${submission.id}/review`, "POST", { decision: "accept", reason: "Accepted.", minutes: 1 }, owner.cookie);
    await request(`/submissions/${submission.id}/challenge`, "POST", { reason: "Evidence needs a second look." }, operator.cookie);
    expect((await request(`/tasks/${task.id}/escrow-intent`, "POST", { sponsorAddress: "0x1111111111111111111111111111111111111111", operatorAddress: "0x2222222222222222222222222222222222222222", tokenAddress: "0x3333333333333333333333333333333333333333", contractAddress: "0x4444444444444444444444444444444444444444", amountAtomic: "1", chainId: 84532, challengePeriodSeconds: 172800 }, owner.cookie)).status).toBe(409);
  });
});
