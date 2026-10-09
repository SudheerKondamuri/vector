import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgotPassword, register } from "../../lib/pilot-server/auth";
import { getPilotStore } from "../../lib/pilot-server/store";
import { drainOneOutbox } from "../../lib/production/email";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vector-email-outbox-"));
  vi.stubEnv("VECTOR_DATA_DIR", directory);
  vi.stubEnv("SESSION_SECRET", "email-outbox-test-secret-12345678901234567890");
  vi.stubEnv("EMAIL_PROVIDER", "log");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function queuePasswordReset(): Promise<void> {
  await register({ name: "Outbox User", email: "outbox@example.test", password: "outbox test password 123" });
  await forgotPassword({ email: "outbox@example.test" });
}

describe("email outbox worker", () => {
  it("claims, delivers and marks an encrypted message exactly once", async () => {
    await queuePasswordReset();
    expect(await drainOneOutbox("email-worker-1")).toBe(true);

    const state = await getPilotStore().read();
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0].sentAt).toBeDefined();
    expect(state.outbox[0].attempts).toBe(1);
    expect(state.outbox[0].lockedBy).toBeUndefined();
    expect(state.outbox[0].lockedAt).toBeUndefined();
    expect(state.outbox[0].errorMessage).toBeUndefined();
    expect(state.outbox[0].payload.encrypted).toBeTruthy();
    expect(await drainOneOutbox("email-worker-2")).toBe(false);
  });

  it("records provider failures for retry without losing the message", async () => {
    await queuePasswordReset();
    vi.stubEnv("EMAIL_PROVIDER", "unsupported");

    expect(await drainOneOutbox("email-worker-1")).toBe(true);
    const state = await getPilotStore().read();
    expect(state.outbox[0].sentAt).toBeUndefined();
    expect(state.outbox[0].attempts).toBe(1);
    expect(state.outbox[0].errorMessage).toMatch(/EMAIL_PROVIDER/);
    expect(state.outbox[0].lockedBy).toBeUndefined();
  });
});
