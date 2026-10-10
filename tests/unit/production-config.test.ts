import { afterEach, describe, expect, it } from "vitest";
import { getProductionConfig, resetProductionConfigForTests } from "../../lib/production/config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  resetProductionConfigForTests();
});

describe("production configuration", () => {
  it("fails closed when the production database and cryptographic settings are missing", () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    delete process.env.DATABASE_URL;
    delete process.env.VECTOR_APP_ORIGIN;
    delete process.env.SESSION_SECRET;
    expect(() => getProductionConfig()).toThrow(/DATABASE_URL/);
  });

  it("requires HTTPS, a strong session secret, and an invite-only mode in production", () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    process.env.DATABASE_URL = "postgres://vector:password@db:5432/vector";
    process.env.VECTOR_APP_ORIGIN = "http://vector.example";
    process.env.SESSION_SECRET = "short";
    expect(() => getProductionConfig()).toThrow(/HTTPS/);

    process.env.VECTOR_APP_ORIGIN = "https://vector.example";
    expect(() => getProductionConfig()).toThrow(/SESSION_SECRET/);

    process.env.SESSION_SECRET = "a".repeat(64);
    process.env.WORKER_AUTH_SECRET = "b".repeat(64);
    process.env.BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_SEPOLIA_ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BASE_SEPOLIA_TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.BASE_SEPOLIA_START_BLOCK = "123";
    process.env.WALLETCONNECT_PROJECT_ID = "test-walletconnect-project";
    process.env.EMAIL_FROM = "Vector <test@example.test>";
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_USER = "test-user";
    process.env.SMTP_PASSWORD = "test-password";
    const config = getProductionConfig();
    expect(config.inviteOnly).toBe(true);
    expect(config.appOrigin).toBe("https://vector.example");
  });

  it("permits isolated JSON storage only when explicitly selected outside production", () => {
    process.env = { ...process.env, NODE_ENV: "test" };
    process.env.VECTOR_STORAGE = "json";
    process.env.SESSION_SECRET = "a".repeat(64);
    const config = getProductionConfig();
    expect(config.storage).toBe("json");
    expect(config.inviteOnly).toBe(false);
  });

  it("requires settlement, worker and email configuration together in production", () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgres://vector:password@db:5432/vector",
      VECTOR_APP_ORIGIN: "https://vector.example",
      SESSION_SECRET: "a".repeat(64),
      WORKER_AUTH_SECRET: "b".repeat(64),
      BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
      BASE_SEPOLIA_ESCROW_ADDRESS: "0x1111111111111111111111111111111111111111",
      BASE_SEPOLIA_TOKEN_ADDRESS: "0x2222222222222222222222222222222222222222",
      BASE_SEPOLIA_START_BLOCK: "123",
      WALLETCONNECT_PROJECT_ID: "test-walletconnect-project",
      EMAIL_FROM: "Vector <test@example.test>",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "test-user",
      SMTP_PASSWORD: "test-password",
    };
    delete process.env.WALLETCONNECT_PROJECT_ID;
    expect(() => getProductionConfig()).toThrow(/WALLETCONNECT_PROJECT_ID/);
  });
});
