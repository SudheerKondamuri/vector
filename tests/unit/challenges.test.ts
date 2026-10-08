import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePilotRequest } from "../../lib/pilot-server/http";
import { getPilotStore } from "../../lib/pilot-server/store";

const origin = "http://localhost:3000";
const patch = "diff --git a/src/Target.sol b/src/Target.sol\n--- a/src/Target.sol\n+++ b/src/Target.sol\n@@ -1 +1 @@\n-contract Target {}\n+contract Target { uint256 value; }\n";
const input = { title: "Challengeable task", description: "A public technical task with a bounded acceptance process.", fixture: "external", repoUrl: "https://example.com/repository", baseCommit: "a".repeat(40), target: "Target.run", scopePaths: ["src/Target.sol"], constraints: "Preserve behavior and ABI.", minImprovementPct: 10, deadline: new Date(Date.now() + 86_400_000).toISOString(), maxSubmissions: 5, priceUsd: 100, operatorRewardUsd: 50, paymentTerms: "Recorded separately.", reviewTerms: "Sponsor reviews the report.", inviteEmails: [] };

let directory: string;
async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
  return handlePilotRequest(new Request(`${origin}/api/pilot${path}`, { method, headers: { ...(method !== "GET" ? { origin, "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function account(email: string) {
  const response = await request("/auth/register", "POST", { name: email.split("@")[0], email, password: "challenge test password 123" });
  return { cookie: response.headers.get("set-cookie")!.split(";")[0], ...(await response.json()) };
}
const report = { environment: "isolated", checks: [{ name: "behavior", passed: true, detail: "pass" }], metrics: [{ name: "Target.run", baseline: 100, candidate: 70 }], logs: ["done"], replayCommand: "forge test --gas-report", limitations: ["manual"] };

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "vector-challenges-")); vi.stubEnv("VECTOR_DATA_DIR", directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("review challenge state machine", () => {
  it("opens an operator challenge after acceptance and lets the sponsor uphold it", async () => {
    const owner = await account("owner@example.test");
    const operator = await account("operator@example.test");
    const created = await request("/tasks", "POST", input, owner.cookie);
    const task = (await created.json()).task;
    await request(`/tasks/${task.id}/publish`, "POST", {}, owner.cookie);
    const submitted = await request(`/tasks/${task.id}/submissions`, "POST", { patch, baseCommit: input.baseCommit, method: "measured", computeUsd: 1, effortMinutes: 2 }, operator.cookie);
    const submission = (await submitted.json()).submission;
    await request(`/submissions/${submission.id}/report`, "POST", report, operator.cookie);
    expect((await request(`/submissions/${submission.id}/review`, "POST", { decision: "accept", reason: "The report meets the published threshold.", minutes: 3 }, owner.cookie)).status).toBe(200);
    const opened = await request(`/submissions/${submission.id}/challenge`, "POST", { reason: "The reported environment does not match the agreed fixture." }, operator.cookie);
    expect(opened.status).toBe(201);
    const challenge = (await opened.json()).challenge;
    expect(challenge.status).toBe("open");
    const resolved = await request(`/challenges/${challenge.id}/resolve`, "POST", { decision: "uphold", reason: "The challenge is valid; the acceptance is withdrawn." }, owner.cookie);
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).challenge.status).toBe("resolved");
    const state = await getPilotStore().read();
    expect(state.tasks[0].status).toBe("review");
    expect(state.tasks[0].acceptedSubmissionId).toBeUndefined();
    expect(state.submissions[0].status).toBe("rejected");
  });

  it("rejects challenges after the fixed 48-hour window", async () => {
    const owner = await account("owner@example.test");
    const operator = await account("operator@example.test");
    const taskResponse = await request("/tasks", "POST", input, owner.cookie);
    const task = (await taskResponse.json()).task;
    await request(`/tasks/${task.id}/publish`, "POST", {}, owner.cookie);
    const submissionResponse = await request(`/tasks/${task.id}/submissions`, "POST", { patch, baseCommit: input.baseCommit, method: "measured", computeUsd: 1, effortMinutes: 2 }, operator.cookie);
    const submission = (await submissionResponse.json()).submission;
    await request(`/submissions/${submission.id}/report`, "POST", report, operator.cookie);
    await request(`/submissions/${submission.id}/review`, "POST", { decision: "accept", reason: "Accepted after review.", minutes: 1 }, owner.cookie);
    await getPilotStore().mutate(state => { state.submissions[0].review!.at = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(); });
    expect((await request(`/submissions/${submission.id}/challenge`, "POST", { reason: "Late challenge" }, operator.cookie)).status).toBe(409);
  });
});
