import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePilotRequest } from "../../lib/pilot-server/http";
import { getPilotStore } from "../../lib/pilot-server/store";

const origin = "http://localhost:3000";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vector-api-token-"));
  vi.stubEnv("VECTOR_DATA_DIR", directory);
  vi.stubEnv("SESSION_SECRET", "api-token-test-secret-12345678901234567890");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function request(path: string, method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
  return handlePilotRequest(new Request(`${origin}/api/pilot${path}`, {
    method,
    headers: { ...(method === "POST" ? { origin, "content-type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

describe("operator API tokens", () => {
  it("creates hashed bearer credentials, lists metadata and revokes access", async () => {
    const registration = await request("/auth/register", "POST", { name: "Operator", email: "operator@example.test", password: "operator test password 123" });
    const cookie = registration.headers.get("set-cookie")!.split(";")[0];
    const created = await request("/auth/api-tokens", "POST", { name: "Operator CLI" }, { cookie });
    expect(created.status).toBe(201);
    const result = await created.json() as { id: string; token: string; prefix: string };
    expect(result.token).toMatch(/^vec_[A-Za-z0-9_-]{43}$/);
    expect(result.prefix).toBe(result.token.slice(0, 12));
    expect(JSON.stringify(await getPilotStore().read())).not.toContain(result.token);

    const listed = await request("/auth/api-tokens", "GET", undefined, { cookie });
    expect(await listed.json()).toEqual({ tokens: [{ id: result.id, name: "Operator CLI", prefix: result.prefix, createdAt: expect.any(String) }] });
    expect((await request("/tasks", "GET", undefined, { authorization: `Bearer ${result.token}` })).status).toBe(200);

    expect((await request(`/auth/api-tokens/${result.id}`, "POST", {}, { authorization: `Bearer ${result.token}` })).status).toBe(200);
    expect((await request("/tasks", "GET", undefined, { authorization: `Bearer ${result.token}` })).status).toBe(401);
    expect((await request("/tasks", "GET", undefined, { cookie })).status).toBe(200);
  });

  it("rejects malformed token names and bearer credentials", async () => {
    const registration = await request("/auth/register", "POST", { name: "Operator", email: "operator@example.test", password: "operator test password 123" });
    const cookie = registration.headers.get("set-cookie")!.split(";")[0];
    expect((await request("/auth/api-tokens", "POST", { name: "" }, { cookie })).status).toBe(400);
    expect((await request("/tasks", "GET", undefined, { authorization: "Bearer vec_invalid" })).status).toBe(401);
  });
});
