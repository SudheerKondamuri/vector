import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePilotRequest } from "../../lib/pilot-server/http";
import type { PilotTaskInput } from "../../lib/pilot-types";
import { getPilotStore } from "../../lib/pilot-server/store";
import { openOutboxPayload } from "../../lib/pilot-server/auth";

const origin = "http://localhost:3000";
let directory: string;
const baseCommit = "b".repeat(40);
const input: PilotTaskInput = {
  title: "Discoverable gas task", description: "A bounded Foundry gas optimization task for marketplace discovery.", fixture: "external", repoUrl: "https://example.com/vector/repo", baseCommit, target: "Target.run", scopePaths: ["src/Target.sol"], constraints: "Preserve Solidity behavior and ABI.", minImprovementPct: 10, deadline: new Date(Date.now() + 86_400_000).toISOString(), maxSubmissions: 5, priceUsd: 100, operatorRewardUsd: 50, paymentTerms: "Invoice separately.", reviewTerms: "Sponsor reviews evidence.", inviteEmails: [],
};

async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
  return handlePilotRequest(new Request(`${origin}/api/pilot${path}`, { method, headers: { ...(method !== "GET" ? { origin, "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function account(email: string) {
  const response = await request("/auth/register", "POST", { name: email.split("@")[0], email, password: "marketplace test password 123" });
  return { cookie: response.headers.get("set-cookie")!.split(";")[0], ...(await response.json()) };
}
async function createPublished(cookie: string) {
  const created = await request("/tasks", "POST", input, cookie);
  const task = (await created.json()).task;
  const published = await request(`/tasks/${task.id}/publish`, "POST", {}, cookie);
  return (await published.json()).task;
}

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "vector-marketplace-")); vi.stubEnv("VECTOR_DATA_DIR", directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("marketplace surfaces", () => {
  it("updates a profile and discovers only published tasks", async () => {
    const sponsor = await account("sponsor@example.test");
    const operator = await account("operator@example.test");
    const task = await createPublished(sponsor.cookie);
    const profile = await request("/profile", "PATCH", { handle: "operator-one", bio: "Gas optimization operator", capabilities: ["evm-gas", "solidity"], adapterVersions: { "evm-gas": "1" }, availability: "available" }, operator.cookie);
    expect(profile.status).toBe(200);
    const discovered = await request("/marketplace/tasks?q=Discoverable", "GET", undefined, operator.cookie);
    expect((await discovered.json()).tasks.map((item: { id: string }) => item.id)).toEqual([task.id]);
    expect((await request(`/tasks/${task.id}`, "GET", undefined, operator.cookie)).status).toBe(200);
    const reserved = await request(`/tasks/${task.id}/reserve`, "POST", {}, operator.cookie);
    expect(reserved.status).toBe(200);
    const reservation = (await reserved.json()).reservation;
    expect(reservation.taskId).toBe(task.id);
    const repeated = await request(`/tasks/${task.id}/reserve`, "POST", {}, operator.cookie);
    expect(await repeated.json()).toMatchObject({ reservation: { id: reservation.id } });
    expect((await request(`/tasks/${task.id}/release-reservation`, "POST", {}, operator.cookie)).status).toBe(200);
    const profiles = await request("/marketplace/profiles?q=solidity", "GET", undefined, sponsor.cookie);
    expect((await profiles.json()).profiles[0].handle).toBe("operator-one");
  });

  it("returns a single-use invite token without storing its raw value", async () => {
    const sponsor = await account("sponsor@example.test");
    expect((await request("/auth/invitations", "POST", { email: "member@example.test" }, sponsor.cookie)).status).toBe(403);
    await getPilotStore().mutate(state => { state.users.find(user => user.id === sponsor.user.id)!.role = "admin"; });
    const response = await request("/auth/invitations", "POST", { email: "new@example.test" }, sponsor.cookie);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = await (await import("../../lib/pilot-server/store")).getPilotStore().read();
    expect(JSON.stringify(state)).not.toContain(result.token);
  });

  it("turns task invite emails into usable, email-bound onboarding links when publishing", async () => {
    const sponsor = await account("sponsor@example.test");
    vi.stubEnv("VECTOR_INVITE_ONLY", "true");
    const created = await request("/tasks", "POST", { ...input, inviteEmails: ["new-operator@example.test"] }, sponsor.cookie);
    const task = (await created.json()).task;
    expect((await request(`/tasks/${task.id}/publish`, "POST", {}, sponsor.cookie)).status).toBe(200);
    const state = await getPilotStore().read();
    const invitation = state.outbox.find(message => message.type === "invitation");
    expect(invitation?.to).toBe("new-operator@example.test");
    const payload = openOutboxPayload(invitation!.payload.encrypted);
    const token = new URL(payload.url).searchParams.get("invite");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const registration = await request("/auth/register", "POST", { name: "New Operator", email: "new-operator@example.test", password: "marketplace test password 123", invitationToken: token });
    expect(registration.status).toBe(201);
    expect((await getPilotStore().read()).invitations[0].usedAt).toBeDefined();
  });
});
