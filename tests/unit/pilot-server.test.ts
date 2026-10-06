import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePilotRequest } from "../../lib/pilot-server/http";
import { createPilotStore } from "../../lib/pilot-server/store";
import type { PilotSubmission, PilotTask, PilotTaskInput } from "../../lib/pilot-types";

const origin = "http://localhost:3000";
const baseCommit = "a".repeat(40);
const patch = "diff --git a/src/Target.sol b/src/Target.sol\n--- a/src/Target.sol\n+++ b/src/Target.sol\n@@ -1 +1 @@\n-contract Target {}\n+contract Target { uint256 value; }\n";
const otherPatch = patch.replace("uint256 value", "uint256 other");
let directory: string;

function taskInput(overrides: Partial<PilotTaskInput> = {}): PilotTaskInput {
  return {
    title: "Optimize a bounded target", description: "Reduce the measured cost while preserving behavior.",
    fixture: "external", repoUrl: "https://example.com/owner/repository", baseCommit,
    target: "Target.run", scopePaths: ["src/Target.sol"], constraints: "Preserve behavior and ABI.",
    minImprovementPct: 10, deadline: new Date(Date.now() + 86_400_000).toISOString(), maxSubmissions: 5,
    priceUsd: 100, operatorRewardUsd: 60, paymentTerms: "Recorded separately; no automatic transfers.",
    reviewTerms: "Measured improvement and passing correctness checks.", inviteEmails: ["operator@example.com", "second@example.com"],
    ...overrides,
  };
}

async function request(path: string, method = "GET", body?: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) {
  return handlePilotRequest(new Request(`${origin}/api/pilot${path}`, {
    method,
    headers: { ...(method !== "GET" ? { origin, "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...extraHeaders },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
}

async function account(email = "owner@example.com", name = "Owner") {
  const response = await request("/auth/register", "POST", { email, name, password: "a secure test password" });
  expect(response.status).toBe(201);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const { user } = await response.json();
  return { cookie, user };
}

async function createTask(cookie: string, overrides: Partial<PilotTaskInput> = {}) {
  const response = await request("/tasks", "POST", taskInput(overrides), cookie);
  expect(response.status).toBe(201);
  return (await response.json()).task as PilotTask;
}

async function publish(cookie: string, task: PilotTask) {
  const response = await request(`/tasks/${task.id}/publish`, "POST", {}, cookie);
  expect(response.status).toBe(200);
  return (await response.json()).task as PilotTask;
}

async function submit(cookie: string, task: PilotTask, candidate = patch) {
  const response = await request(`/tasks/${task.id}/submissions`, "POST", { patch: candidate, baseCommit: task.baseCommit, method: "Measured local optimization", computeUsd: 1, effortMinutes: 15 }, cookie);
  expect(response.status).toBe(201);
  return (await response.json()).submission as PilotSubmission;
}

function report(candidate = 80) {
  return {
    environment: "Local isolated Solidity benchmark", checks: [
      { name: "Correctness", passed: true, detail: "All behavior tests pass" },
      { name: "Scope", passed: true, detail: "Only the allowed target changed" },
    ], metrics: [{ name: "Target.run", baseline: 100, candidate }], logs: ["benchmark completed"],
    replayCommand: "forge test --gas-report", limitations: ["Manually supplied; execution not verified by Vector."],
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vector-pilot-"));
  process.env.VECTOR_DATA_DIR = directory;
});

afterEach(async () => {
  delete process.env.VECTOR_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});

describe("persistent pilot authentication", () => {
  it("registers, hashes credentials and tokens, reloads, logs in, and invalidates logout", async () => {
    const response = await request("/auth/register", "POST", { name: "Owner", email: "OWNER@example.com", password: "a secure test password" });
    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    const cookie = setCookie.split(";")[0];
    const { user } = await response.json();
    expect(user.email).toBe("owner@example.com");
    const raw = await readFile(join(directory, "state.json"), "utf8");
    expect(raw).not.toContain("a secure test password");
    expect(raw).not.toContain(cookie.split("=")[1]);
    expect(raw).toContain("scrypt");
    expect((await stat(join(directory, "state.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await createPilotStore(directory).read()).users).toHaveLength(1);
    expect(await (await request("/auth", "GET", undefined, cookie)).json()).toEqual({ user });
    expect((await request("/auth/logout", "POST", {}, cookie)).status).toBe(200);
    expect(await (await request("/auth", "GET", undefined, cookie)).json()).toEqual({ user: null });
    const login = await request("/auth/login", "POST", { email: "owner@example.com", password: "a secure test password" });
    expect(login.status).toBe(200);
    expect((await login.json()).user).toEqual(user);
    expect((await request("/tasks", "GET", undefined, cookie)).status).toBe(401);
  });

  it("uses safe errors and bounds repeated login attempts", async () => {
    await account();
    const unknown = await request("/auth/login", "POST", { email: "absent@example.com", password: "wrong password" });
    const wrong = await request("/auth/login", "POST", { email: "owner@example.com", password: "wrong password" });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
    let response = wrong;
    for (let i = 0; i < 10; i++) response = await request("/auth/login", "POST", { email: "owner@example.com", password: "wrong password" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects malformed credentials and duplicate registrations without revealing account details", async () => {
    const invalid = await request("/auth/register", "POST", { name: "", email: "bad", password: "short" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).fields).toHaveProperty("password");
    await account();
    const duplicate = await request("/auth/register", "POST", { name: "Different", email: "OWNER@example.com", password: "another secure password" });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).not.toContain("owner@example.com");
  });
});

describe("pilot ownership, persistence and publication", () => {
  it("allows owner/invited access while keeping operators' artifacts, evidence, and events private", async () => {
    const owner = await account();
    const operator = await account("operator@example.com", "Operator");
    const second = await account("second@example.com", "Second");
    const outsider = await account("outsider@example.com", "Outsider");
    const task = await publish(owner.cookie, await createTask(owner.cookie));
    const firstSubmission = await submit(operator.cookie, task);
    const secondSubmission = await submit(second.cookie, task, otherPatch);
    const owned = await (await request(`/tasks/${task.id}`, "GET", undefined, owner.cookie)).json();
    expect(owned.submissions).toHaveLength(2);
    const visible = await (await request(`/tasks/${task.id}`, "GET", undefined, operator.cookie)).json();
    expect(visible.submissions.map((item: PilotSubmission) => item.id)).toEqual([firstSubmission.id]);
    expect(JSON.stringify(visible)).not.toContain(secondSubmission.id);
    expect(JSON.stringify(visible)).not.toContain(otherPatch);
    expect((await request(`/submissions/${secondSubmission.id}/artifact`, "GET", undefined, operator.cookie)).status).toBe(403);
    expect((await request(`/tasks/${task.id}`, "GET", undefined, outsider.cookie)).status).toBe(403);
    expect((await (await request("/tasks", "GET", undefined, outsider.cookie)).json()).tasks).toEqual([]);
    const exported = await request(`/tasks/${task.id}/export?format=json`, "GET", undefined, operator.cookie);
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/);
    expect(await exported.text()).not.toContain(secondSubmission.id);
    const artifact = await request(`/submissions/${firstSubmission.id}/artifact`, "GET", undefined, operator.cookie);
    expect(artifact.headers.get("content-disposition")).toMatch(/\.patch/);
    expect(await artifact.text()).toBe(patch);
    const reloaded = await createPilotStore(directory).read();
    expect(reloaded.tasks[0].manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reloaded.submissions).toHaveLength(2);
    expect(reloaded.events.some(event => event.type === "task.published")).toBe(true);
  });

  it("edits only owner drafts, freezes terms, and exposes drafts only to owners", async () => {
    const owner = await account();
    const operator = await account("operator@example.com", "Operator");
    const task = await createTask(owner.cookie);
    expect((await request(`/tasks/${task.id}`, "GET", undefined, operator.cookie)).status).toBe(403);
    expect((await request(`/tasks/${task.id}`, "PATCH", { title: "Unauthorized change" }, operator.cookie)).status).toBe(403);
    const edited = await request(`/tasks/${task.id}`, "PATCH", { title: "Updated draft" }, owner.cookie);
    expect((await edited.json()).task.title).toBe("Updated draft");
    const published = await publish(owner.cookie, task);
    expect(published.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await request(`/tasks/${task.id}`, "PATCH", { priceUsd: 200 }, owner.cookie)).status).toBe(409);
    expect((await request(`/tasks/${task.id}/publish`, "POST", {}, owner.cookie)).status).toBe(409);
    const current = (await (await request(`/tasks/${task.id}`, "GET", undefined, owner.cookie)).json()).task;
    expect(current.manifestHash).toBe(published.manifestHash);
    expect((await request(`/tasks/${task.id}/archive`, "POST", {}, operator.cookie)).status).toBe(403);
    expect((await request(`/tasks/${task.id}/archive`, "POST", {}, owner.cookie)).status).toBe(200);
    expect((await request(`/tasks/${task.id}/submissions`, "POST", { patch, baseCommit, method: "test", computeUsd: 0, effortMinutes: 1 }, operator.cookie)).status).toBe(409);
  });

  it.each([{ maxSubmissions: 0 }, { priceUsd: -1 }, { baseCommit: "not-a-commit" }, { deadline: "invalid" }, { scopePaths: ["../escape"] }, { inviteEmails: ["invalid"] }, { minImprovementPct: 101 }, { ownerId: "forged" }])("rejects invalid task inputs %o", async (override) => {
    const owner = await account();
    const response = await request("/tasks", "POST", { ...taskInput(), ...override }, owner.cookie);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  });

  it("serializes concurrent writes and refuses corrupt persisted data without resetting it", async () => {
    const owner = await account();
    await Promise.all(Array.from({ length: 8 }, (_, i) => createTask(owner.cookie, { title: `Task ${i}` })));
    expect((await createPilotStore(directory).read()).tasks).toHaveLength(8);
    await writeFile(join(directory, "state.json"), "{corrupt private data");
    const response = await request("/tasks", "GET", undefined, owner.cookie);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("corrupt private data");
    expect(await readFile(join(directory, "state.json"), "utf8")).toBe("{corrupt private data");
  });

  it("refuses unexpected persisted fields instead of exposing corrupted records", async () => {
    const owner = await account();
    const task = await createTask(owner.cookie);
    const raw = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    raw.tasks[0].internalSecret = "never expose this corrupted field";
    await writeFile(join(directory, "state.json"), JSON.stringify(raw));
    const response = await request(`/tasks/${task.id}`, "GET", undefined, owner.cookie);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("never expose");
    expect(await readFile(join(directory, "state.json"), "utf8")).toContain("never expose");
  });
});

describe("submissions, honest review and ledger", () => {
  it("supports explicitly scoped source directories and keeps sibling directories out of scope", async () => {
    const owner = await account();
    const task = await publish(owner.cookie, await createTask(owner.cookie, { scopePaths: ["src/"] }));
    await submit(owner.cookie, task);
    const response = await request(`/tasks/${task.id}/submissions`, "POST", {
      patch: otherPatch.replaceAll("src/Target.sol", "src-extra/Target.sol"), baseCommit, method: "Out of scope", computeUsd: 0, effortMinutes: 1,
    }, owner.cookie);
    expect(response.status).toBe(400);
  });

  it("executes only the real pinned reference verifier and accepts its passing aggregate measurement", async () => {
    const owner = await account();
    const reference = await request("/reference");
    expect(reference.status).toBe(200);
    const bundle = await reference.json();
    expect(bundle.source).toContain("contract GasTarget");
    const task = await publish(owner.cookie, await createTask(owner.cookie, {
      fixture: "reference", repoUrl: "", baseCommit: bundle.commit, scopePaths: [bundle.path], target: "GasTarget.sum(uint256)",
    }));
    const submission = await submit(owner.cookie, task, bundle.patch);
    // A supplied report must never bypass the local reference checks.
    expect((await request(`/submissions/${submission.id}/report`, "POST", report(), owner.cookie)).status).toBe(409);
    const verified = await request(`/submissions/${submission.id}/verify`, "POST", {}, owner.cookie);
    expect(verified.status).toBe(200);
    const result = (await verified.json()).submission as PilotSubmission;
    expect(result.status).toBe("verified");
    expect(result.evidence?.source).toBe("reference-run");
    expect(result.evidence?.outcome).toBe("passed");
    expect(result.evidence?.metrics.some(metric => metric.improvementPct === 0)).toBe(true);
    expect((await request(`/submissions/${submission.id}/verify`, "POST", {}, owner.cookie)).status).toBe(409);
    expect((await request(`/submissions/${submission.id}/review`, "POST", { decision: "accept", reason: "Pinned reference checks and aggregate threshold pass.", minutes: 4 }, owner.cookie)).status).toBe(200);
    expect((await createPilotStore(directory).read()).submissions[0].status).toBe("accepted");
  }, 40_000);

  it("refuses past deadlines and submission costs outside their bounds", async () => {
    const owner = await account();
    const expired = await createTask(owner.cookie, { deadline: new Date(Date.now() - 1000).toISOString() });
    expect((await request(`/tasks/${expired.id}/publish`, "POST", {}, owner.cookie)).status).toBe(400);
    const task = await publish(owner.cookie, await createTask(owner.cookie));
    const input = { patch, baseCommit, method: "Measured optimization", computeUsd: -1, effortMinutes: 1 };
    expect((await request(`/tasks/${task.id}/submissions`, "POST", input, owner.cookie)).status).toBe(400);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(task.deadline) + 1);
    try {
      expect((await request(`/tasks/${task.id}/submissions`, "POST", { ...input, computeUsd: 0 }, owner.cookie)).status).toBe(409);
    } finally { clock.mockRestore(); }
  });

  it("keeps a busy reference worker retryable instead of recording a fake optimization failure", async () => {
    const owner = await account();
    const bundle = await (await request("/reference")).json();
    const input = { fixture: "reference" as const, repoUrl: "", baseCommit: bundle.commit, scopePaths: [bundle.path], target: "GasTarget.sum(uint256)" };
    const first = await submit(owner.cookie, await publish(owner.cookie, await createTask(owner.cookie, input)), bundle.patch);
    const second = await submit(owner.cookie, await publish(owner.cookie, await createTask(owner.cookie, input)), bundle.patch);
    const results = await Promise.all([first, second].map(item => request(`/submissions/${item.id}/verify`, "POST", {}, owner.cookie)));
    expect(results.map(result => result.status).sort()).toEqual([200, 503]);
    const retryId = [first.id, second.id][results.findIndex(result => result.status === 503)];
    const stored = (await createPilotStore(directory).read()).submissions.find(item => item.id === retryId)!;
    expect(stored.status).toBe("received");
    expect(stored.evidence).toBeUndefined();
    expect((await request(`/submissions/${retryId}/verify`, "POST", {}, owner.cookie)).status).toBe(200);
  }, 40_000);

  it("enforces published state, commit, scope, unique artifact hashes and the submission cap", async () => {
    const owner = await account();
    const operator = await account("operator@example.com", "Operator");
    const task = await createTask(owner.cookie, { maxSubmissions: 1 });
    const input = { patch, baseCommit, method: "Measured optimization", computeUsd: 0, effortMinutes: 1 };
    expect((await request(`/tasks/${task.id}/submissions`, "POST", input, owner.cookie)).status).toBe(409);
    await publish(owner.cookie, task);
    expect((await request(`/tasks/${task.id}/submissions`, "POST", { ...input, baseCommit: "b".repeat(40) }, operator.cookie)).status).toBe(400);
    expect((await request(`/tasks/${task.id}/submissions`, "POST", { ...input, patch: patch.replaceAll("src/Target.sol", "src/Other.sol") }, operator.cookie)).status).toBe(400);
    await submit(operator.cookie, task);
    const duplicate = await request(`/tasks/${task.id}/submissions`, "POST", input, operator.cookie);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already|duplicate/i);
    expect((await request(`/tasks/${task.id}/submissions`, "POST", { ...input, patch: otherPatch }, operator.cookie)).status).toBe(409);
  });

  it("does not accept unverified evidence, rejects insufficient reports, and permits exactly one reviewed winner", async () => {
    const owner = await account();
    const operator = await account("operator@example.com", "Operator");
    const task = await publish(owner.cookie, await createTask(owner.cookie));
    const submission = await submit(operator.cookie, task);
    const other = await submit(operator.cookie, task, otherPatch);
    const accept = { decision: "accept", reason: "Evidence meets the agreed target.", minutes: 7 };
    expect((await request(`/submissions/${submission.id}/review`, "POST", accept, operator.cookie)).status).toBe(403);
    expect((await request(`/submissions/${submission.id}/review`, "POST", accept, owner.cookie)).status).toBe(409);
    expect((await request(`/submissions/${submission.id}/verify`, "POST", {}, operator.cookie)).status).toBe(409);
    const weakReport = await request(`/submissions/${submission.id}/report`, "POST", report(95), operator.cookie);
    expect(weakReport.status).toBe(200);
    expect((await weakReport.json()).submission.evidence.source).toBe("external-report");
    expect((await request(`/submissions/${submission.id}/review`, "POST", accept, owner.cookie)).status).toBe(409);
    const recorded = await request(`/submissions/${submission.id}/report`, "POST", report(), operator.cookie);
    expect(recorded.status).toBe(200);
    expect((await recorded.json()).submission.status).toBe("recorded");
    await request(`/submissions/${other.id}/report`, "POST", report(), operator.cookie);
    const accepted = await request(`/submissions/${submission.id}/review`, "POST", accept, owner.cookie);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).submission.status).toBe("accepted");
    expect((await request(`/submissions/${submission.id}/review`, "POST", accept, owner.cookie)).status).toBe(409);
    expect((await request(`/submissions/${other.id}/review`, "POST", accept, owner.cookie)).status).toBe(409);
    expect((await request(`/submissions/${submission.id}/report`, "POST", report(), operator.cookie)).status).toBe(409);
    const detail = await (await request(`/tasks/${task.id}`, "GET", undefined, owner.cookie)).json();
    expect(detail.task.acceptedSubmissionId).toBe(submission.id);
    expect(detail.task.status).toBe("accepted");
    expect(detail.task.ledger.reviewMinutes).toBe(7);
    expect(detail.task.ledger.operatorPaidUsd).toBe(0);
    expect(detail.task.ledger.paymentStatus).toBe("unpaid");
  });

  it("allows explicit rejection with an audited reason and rejects malformed reports", async () => {
    const owner = await account();
    const task = await publish(owner.cookie, await createTask(owner.cookie));
    const submission = await submit(owner.cookie, task);
    expect((await request(`/submissions/${submission.id}/report`, "POST", { ...report(), metrics: [{ name: "x", baseline: 0, candidate: 1 }] }, owner.cookie)).status).toBe(400);
    expect((await request(`/submissions/${submission.id}/review`, "POST", { decision: "reject", reason: "", minutes: -1 }, owner.cookie)).status).toBe(400);
    const rejection = await request(`/submissions/${submission.id}/review`, "POST", { decision: "reject", reason: "Correctness evidence is missing.", minutes: 3 }, owner.cookie);
    expect(rejection.status).toBe(200);
    expect((await rejection.json()).submission.review.reason).toBe("Correctness evidence is missing.");
    expect((await request(`/submissions/${submission.id}/verify`, "POST", {}, owner.cookie)).status).toBe(409);
  });

  it("blocks acceptance when any recorded check fails and serializes competing winner decisions", async () => {
    const owner = await account();
    const operator = await account("operator@example.com", "Operator");
    const task = await publish(owner.cookie, await createTask(owner.cookie));
    const first = await submit(operator.cookie, task);
    const second = await submit(operator.cookie, task, otherPatch);
    const failed = report();
    failed.checks[0].passed = false;
    expect((await request(`/submissions/${first.id}/report`, "POST", failed, operator.cookie)).status).toBe(200);
    const accept = { decision: "accept", reason: "Passing measurements and all correctness checks.", minutes: 2 };
    expect((await request(`/submissions/${first.id}/review`, "POST", accept, owner.cookie)).status).toBe(409);
    await request(`/submissions/${first.id}/report`, "POST", report(), operator.cookie);
    await request(`/submissions/${second.id}/report`, "POST", report(), operator.cookie);
    const decisions = await Promise.all([first, second].map(item => request(`/submissions/${item.id}/review`, "POST", accept, owner.cookie)));
    expect(decisions.map(response => response.status).sort()).toEqual([200, 409]);
    const state = await createPilotStore(directory).read();
    expect(state.submissions.filter(submission => submission.status === "accepted")).toHaveLength(1);
    expect(state.tasks[0].ledger.reviewMinutes).toBe(2);
  });

  it("records payment bookkeeping without executing transfers or treating rewards as revenue", async () => {
    const owner = await account();
    const operator = await account("operator@example.com", "Operator");
    const task = await publish(owner.cookie, await createTask(owner.cookie));
    const ledger = { ...task.ledger, serviceRevenueUsd: 25, operatorPaidUsd: 60, computeUsd: 2, supportUsd: 3, paymentFeesUsd: 1, paymentStatus: "paid", paymentReference: "Manual receipt 123" };
    expect((await request(`/tasks/${task.id}/ledger`, "PATCH", ledger, operator.cookie)).status).toBe(403);
    expect((await request(`/tasks/${task.id}/ledger`, "PATCH", { ...ledger, computeUsd: -1 }, owner.cookie)).status).toBe(400);
    const updated = await request(`/tasks/${task.id}/ledger`, "PATCH", ledger, owner.cookie);
    expect(updated.status).toBe(200);
    expect((await updated.json()).task.ledger.serviceRevenueUsd).toBe(25);
    const exported = await request(`/tasks/${task.id}/export?format=markdown`, "GET", undefined, owner.cookie);
    const text = await exported.text();
    expect(text).toMatch(/manual|recorded/i);
    expect(text).toMatch(/no.*transfer|not.*transfer/i);
    expect(text).toContain("19.00");
    const recorded = await (await request(`/tasks/${task.id}/export?format=json`, "GET", undefined, owner.cookie)).json();
    expect(recorded.economics.platformCashUsd).toBe(19);
    expect(recorded.economics.platformNetUsd).toBeNull();
    expect(recorded.economics.operatorNetUsd).toBeNull();
    expect(recorded.economics.timeSavedMinutes).toBeNull();
  });
});

describe("HTTP boundary", () => {
  it("accepts the actual loopback Host when Next normalizes request.url, but rejects foreign origins", async () => {
    const input = { name: "Loopback", email: "loopback@example.com", password: "a secure test password" };
    const response = await request("/auth/register", "POST", input, undefined, { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" });
    expect(response.status).toBe(201);
    expect((await request("/auth/login", "POST", input, undefined, { host: "127.0.0.1:3000", origin: "https://evil.example", "x-forwarded-host": "evil.example" })).status).toBe(403);
  });

  it("does not accept unconfigured non-loopback hosts as an invitation application", async () => {
    const response = await request("/auth/register", "POST", { name: "Owner", email: "owner@example.com", password: "a secure test password" }, undefined,
      { host: "rebinding.example:3000", origin: "http://rebinding.example:3000" });
    expect(response.status).toBe(403);
  });

  it("requires same-origin JSON mutations and limits actual request bytes", async () => {
    const body = { name: "Owner", email: "owner@example.com", password: "a secure test password" };
    expect((await request("/auth/register", "POST", body, undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await request("/auth/register", "POST", body, undefined, { "content-type": "text/plain" })).status).toBe(415);
    const missingOrigin = await handlePilotRequest(new Request(`${origin}/api/pilot/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(missingOrigin.status).toBe(403);
    const oversized = await request("/auth/register", "POST", { ...body, name: "x".repeat(600_000) });
    expect(oversized.status).toBe(413);
    const malformed = await handlePilotRequest(new Request(`${origin}/api/pilot/auth/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" }));
    expect(malformed.status).toBe(400);
  });

  it("returns controlled not-found responses and prevents unauthenticated access", async () => {
    expect((await request("/tasks")).status).toBe(401);
    expect((await request("/unknown")).status).toBe(404);
    const owner = await account();
    const missing = await request("/tasks/nonexistent", "GET", undefined, owner.cookie);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBeTruthy();
  });
});
