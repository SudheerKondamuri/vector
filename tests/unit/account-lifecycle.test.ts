import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePilotRequest } from "../../lib/pilot-server/http";
import { openOutboxPayload, sessionCookie } from "../../lib/pilot-server/auth";
import { sha256, getPilotStore } from "../../lib/pilot-server/store";

const origin = "http://localhost:3000";
const password = "synthetic account password 123!";
let dir: string;
async function request(path: string, data: unknown, cookie?: string) {
  return handlePilotRequest(new Request(`${origin}/api/pilot${path}`, { method: "POST",
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) }));
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vector-lifecycle-"));
  vi.stubEnv("VECTOR_DATA_DIR", dir);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VECTOR_STORAGE", "json");
  vi.stubEnv("VECTOR_APP_ORIGIN", origin);
  vi.stubEnv("VECTOR_INVITE_ONLY", "true");
  vi.stubEnv("SESSION_SECRET", "synthetic-lifecycle-secret-12345678901234567890");
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe("invite-only account lifecycle", () => {
  it("keeps production email verification and Secure cookies enabled during browser tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VECTOR_ALLOW_JSON_TEST_STORAGE", "true");
    vi.stubEnv("VECTOR_E2E_MODE", "true");
    const token = "b".repeat(43);
    await getPilotStore().mutate(state => {
      state.invitations.push({ id: "invite-test-0002", email: "member@example.test", tokenHash: sha256(token), role: "member", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100000).toISOString() });
    });
    const registration = await request("/auth/register", { name: "Member", email: "member@example.test", password, invitationToken: token });
    expect(registration.status).toBe(201);
    expect((await registration.json()).user.emailVerified).toBe(false);
    expect(registration.headers.get("set-cookie")).not.toContain("; Secure");
    const cookie = registration.headers.get("set-cookie")!.split(";")[0];
    expect((await request("/auth/api-tokens", { name: "CLI" }, cookie)).status).toBe(403);
    expect(sessionCookie(new Request("https://vector.example/api/pilot/auth"), token)).toContain("; Secure");
  });

  it("does not allow a public deployment to select test JSON storage", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VECTOR_APP_ORIGIN", "https://vector.example");
    vi.stubEnv("VECTOR_ALLOW_JSON_TEST_STORAGE", "true");
    vi.stubEnv("VECTOR_E2E_MODE", "false");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getPilotStore()).toThrow(/Production storage/);
  });

  it("denies signup without a single-use invitation for the exact email", async () => {
    const response = await request("/auth/register", { name: "Member", email: "member@example.test", password });
    expect(response.status).toBe(403);
    expect((await getPilotStore().read()).users).toHaveLength(0);
  });

  it("uses email-bound invitations, rotates verification links and resets credentials", async () => {
    const token = "a".repeat(43);
    await getPilotStore().mutate(state => {
      state.invitations.push({ id: "invite-test-0001", email: "member@example.test", tokenHash: sha256(token), role: "member", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100000).toISOString() });
    });
    expect((await request("/auth/register", { name: "Member", email: "another@example.test", password, invitationToken: token })).status).toBe(403);
    const response = await request("/auth/register", { name: "Member", email: "member@example.test", password, invitationToken: token });
    expect(response.status).toBe(201);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const state = await getPilotStore().read();
    expect(state.users[0].emailVerifiedAt).toBeUndefined();
    expect(state.invitations[0].usedAt).toBeDefined();
    expect(state.outbox).toHaveLength(1);
    expect(state.users[0].emailVerificationSentAt).toBeDefined();
    expect(JSON.stringify(state)).not.toContain(token);
    const originalVerificationUrl = openOutboxPayload(state.outbox[0].payload.encrypted).url;
    const originalVerificationToken = new URL(originalVerificationUrl).searchParams.get("verify");
    expect((await request("/auth/resend-verification", {}, cookie)).status).toBe(429);
    await getPilotStore().mutate(next => { next.users[0].emailVerificationSentAt = new Date(Date.now() - 61_000).toISOString(); });
    expect((await request("/auth/resend-verification", {}, cookie)).status).toBe(200);
    const latest = await getPilotStore().read();
    const verificationUrl = openOutboxPayload(latest.outbox.at(-1)!.payload.encrypted).url;
    const verificationToken = new URL(verificationUrl).searchParams.get("verify");
    expect(verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await request("/auth/verify-email", { token: originalVerificationToken })).status).toBe(400);
    const verified = await request("/auth/verify-email", { token: verificationToken });
    expect(verified.status).toBe(200);
    expect((await getPilotStore().read()).users[0].emailVerifiedAt).toBeDefined();
    expect((await request("/auth/verify-email", { token: verificationToken })).status).toBe(400);
    const apiResponse = await request("/auth/api-tokens", { name: "CLI before recovery" }, cookie);
    expect(apiResponse.status).toBe(201);
    const apiToken = (await apiResponse.json()).token;
    await request("/auth/forgot-password", { email: "member@example.test" });
    const resetState = await getPilotStore().read();
    const resetUrl = openOutboxPayload(resetState.outbox.at(-1)!.payload.encrypted).url;
    const resetToken = new URL(resetUrl).searchParams.get("reset");
    expect((await request("/auth/reset-password", { token: resetToken, password: "replacement password 123!" })).status).toBe(200);
    expect((await request("/auth/reset-password", { token: resetToken, password: "replacement password 456!" })).status).toBe(400);
    expect((await request("/auth/logout-all", {}, cookie)).status).toBe(401);
    const bearerRead = await handlePilotRequest(new Request(`${origin}/api/pilot/tasks`, { headers: { authorization: `Bearer ${apiToken}` } }));
    expect(bearerRead.status).toBe(401);
    expect((await request("/auth/login", { email: "member@example.test", password: "replacement password 123!" })).status).toBe(200);
  });

  it("refuses expired invitations before creating an account", async () => {
    const token = "c".repeat(43);
    await getPilotStore().mutate(state => {
      state.invitations.push({ id: "invite-test-0003", email: "member@example.test", tokenHash: sha256(token), role: "member", createdAt: new Date(Date.now() - 100000).toISOString(), expiresAt: new Date(Date.now() - 1).toISOString() });
    });
    expect((await request("/auth/register", { name: "Member", email: "member@example.test", password, invitationToken: token })).status).toBe(403);
    expect((await getPilotStore().read()).users).toHaveLength(0);
  });

  it("reset requests do not disclose account membership", async () => {
    const response = await request("/auth/forgot-password", { email: "absent@example.test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "If the account is eligible, a recovery email will be sent." });
  });
});
