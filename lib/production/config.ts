import { URL } from "node:url";

export type ProductionStorage = "postgres" | "json";

export interface ProductionConfig {
  nodeEnv: string;
  storage: ProductionStorage;
  databaseUrl?: string;
  appOrigin: string;
  sessionSecret: string;
  inviteOnly: boolean;
  dataDirectory?: string;
  workerAuthSecret?: string;
  baseSepoliaRpcUrl?: string;
  baseSepoliaEscrowAddress?: string;
  baseSepoliaTokenAddress?: string;
  baseSepoliaStartBlock?: string;
  walletConnectProjectId?: string;
  emailFrom?: string;
  emailProvider?: "smtp" | "log";
}

let cached: ProductionConfig | undefined;

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required for the configured runtime`);
  return value.trim();
}

function origin(value: string, production: boolean): string {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("VECTOR_APP_ORIGIN must be a valid absolute URL"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("VECTOR_APP_ORIGIN must be an origin URL without credentials, path, query, or fragment");
  }
  if (production && parsed.protocol !== "https:") throw new Error("VECTOR_APP_ORIGIN must use HTTPS in production");
  return parsed.origin;
}

function databaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  return value.trim();
}

function address(name: string, value: string | undefined): string {
  const normalized = required(name, value);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) throw new Error(`${name} must be a 20-byte hexadecimal address`);
  return normalized;
}

function block(name: string, value: string | undefined): string {
  const normalized = required(name, value);
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be a non-negative block number`);
  return normalized;
}

export function getProductionConfig(): ProductionConfig {
  if (cached) return cached;
  const nodeEnv = process.env.NODE_ENV || "development";
  const production = nodeEnv === "production";
  const requestedStorage = process.env.VECTOR_STORAGE;
  if (requestedStorage && requestedStorage !== "postgres" && requestedStorage !== "json") {
    throw new Error("VECTOR_STORAGE must be postgres or json");
  }
  const storage: ProductionStorage = production ? "postgres" : (requestedStorage === "postgres" ? "postgres" : "json");
  const database = storage === "postgres" ? databaseUrl(required("DATABASE_URL", process.env.DATABASE_URL)) : undefined;
  const appOrigin = origin(process.env.VECTOR_APP_ORIGIN || (production ? "" : "http://localhost:3000"), production);
  const sessionSecret = required("SESSION_SECRET", process.env.SESSION_SECRET);
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  if (storage === "json" && production) throw new Error("JSON storage is not permitted in production");
  const emailProvider = process.env.EMAIL_PROVIDER || (production ? "" : "log");
  if (emailProvider !== "smtp" && emailProvider !== "log") throw new Error("EMAIL_PROVIDER must be smtp or log");
  if (production) {
    required("WORKER_AUTH_SECRET", process.env.WORKER_AUTH_SECRET);
    required("BASE_SEPOLIA_RPC_URL", process.env.BASE_SEPOLIA_RPC_URL);
    address("BASE_SEPOLIA_ESCROW_ADDRESS", process.env.BASE_SEPOLIA_ESCROW_ADDRESS);
    address("BASE_SEPOLIA_TOKEN_ADDRESS", process.env.BASE_SEPOLIA_TOKEN_ADDRESS);
    block("BASE_SEPOLIA_START_BLOCK", process.env.BASE_SEPOLIA_START_BLOCK);
    required("WALLETCONNECT_PROJECT_ID", process.env.WALLETCONNECT_PROJECT_ID);
    required("EMAIL_FROM", process.env.EMAIL_FROM);
    if (emailProvider !== "smtp") throw new Error("EMAIL_PROVIDER must be smtp before production email is enabled");
    required("SMTP_HOST", process.env.SMTP_HOST);
    required("SMTP_USER", process.env.SMTP_USER);
    required("SMTP_PASSWORD", process.env.SMTP_PASSWORD);
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error("SMTP_PORT must be a valid TCP port");
  }

  cached = {
    nodeEnv, storage, databaseUrl: database, appOrigin, sessionSecret,
    inviteOnly: production || process.env.VECTOR_INVITE_ONLY === "true",
    dataDirectory: process.env.VECTOR_DATA_DIR,
    workerAuthSecret: process.env.WORKER_AUTH_SECRET,
    baseSepoliaRpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
    baseSepoliaEscrowAddress: process.env.BASE_SEPOLIA_ESCROW_ADDRESS,
    baseSepoliaTokenAddress: process.env.BASE_SEPOLIA_TOKEN_ADDRESS,
    baseSepoliaStartBlock: process.env.BASE_SEPOLIA_START_BLOCK,
    walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID,
    emailFrom: process.env.EMAIL_FROM,
    emailProvider: emailProvider as "smtp" | "log",
  };
  return cached;
}

export function resetProductionConfigForTests(): void {
  cached = undefined;
}
