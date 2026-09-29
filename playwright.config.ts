import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash, scryptSync } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const port = Number(process.env.VECTOR_E2E_PORT || 3101);
const baseURL = `http://127.0.0.1:${port}`;
// Never use the person's app records or an unrelated listening preview for a test run.
const dataDirectory = mkdtempSync(join(tmpdir(), "vector-browser-tests-"));
const e2eAdminPassword = "E2E admin password 2026!";
const e2eAdminSalt = "0123456789abcdef0123456789abcdef";
const e2eAdminSessionToken = Buffer.alloc(32, 7).toString("base64url");
const e2eAdminHash = `scrypt$16384$8$1$${e2eAdminSalt}$${scryptSync(e2eAdminPassword, Buffer.from(e2eAdminSalt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
const e2eNow = Date.now();
writeFileSync(join(dataDirectory, "state.json"), JSON.stringify({
  version: 1,
  users: [{ id: "e2e-admin-0001", name: "E2E Administrator", email: "e2e-admin@example.test", createdAt: new Date().toISOString(), passwordHash: e2eAdminHash, role: "admin", emailVerifiedAt: new Date().toISOString() }],
  sessions: [{ tokenHash: createHash("sha256").update(e2eAdminSessionToken).digest("hex"), userId: "e2e-admin-0001", createdAt: new Date(e2eNow).toISOString(), expiresAt: new Date(e2eNow + 7 * 24 * 60 * 60 * 1000).toISOString() }],
  attempts: [], invitations: [], outbox: [], profiles: [], jobs: [], tasks: [], submissions: [], events: [],
}));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Kolkata"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }
  ],
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    env: { VECTOR_DATA_DIR: dataDirectory, VECTOR_STORAGE: "json", VECTOR_ALLOW_JSON_TEST_STORAGE: "true", VECTOR_E2E_MODE: "true", SESSION_SECRET: "e2e-only-session-secret-please-do-not-use" },
    reuseExistingServer: false,
    timeout: 120000
  }
});
