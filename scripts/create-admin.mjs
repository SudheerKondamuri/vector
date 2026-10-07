#!/usr/bin/env node
import { randomUUID, scryptSync } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
const email = process.env.VECTOR_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.VECTOR_ADMIN_NAME?.trim();
const password = process.env.VECTOR_ADMIN_PASSWORD;

if (!connectionString || !email || !name || !password) {
  process.stderr.write("DATABASE_URL, VECTOR_ADMIN_EMAIL, VECTOR_ADMIN_NAME and VECTOR_ADMIN_PASSWORD are required.\n");
  process.exit(2);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 1 || name.length > 100 || password.length < 12 || password.length > 256) {
  process.stderr.write("The admin email, name or password is invalid.\n");
  process.exit(2);
}

const salt = Buffer.from(randomUUID().replaceAll("-", "").slice(0, 32), "hex").toString("hex");
const passwordHash = `scrypt$16384$8$1$${salt}$${scryptSync(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
const now = new Date().toISOString();
const userId = randomUUID();
const client = new Client({ connectionString, application_name: "vector-admin-bootstrap", connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  await client.query("BEGIN");
  const result = await client.query("SELECT payload FROM vector_pilot_state WHERE id = 1 FOR UPDATE");
  if (!result.rowCount) throw new Error("The production state row is missing. Run npm run migrate first.");
  const state = result.rows[0].payload;
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("The production state payload is invalid.");
  if (!Array.isArray(state.users)) state.users = [];
  if (state.users.some(user => user.email === email)) throw new Error("An account with that email already exists.");
  for (const key of ["sessions", "apiTokens", "reservations", "attempts", "invitations", "outbox", "profiles", "jobs", "challenges", "escrows", "escrowEvents", "tasks", "submissions", "events"]) if (!Array.isArray(state[key])) state[key] = [];
  state.users.push({ id: userId, name, email, createdAt: now, passwordHash, role: "admin", emailVerifiedAt: now });
  state.events.push({ id: randomUUID(), taskId: "", actorName: name, type: "account.admin-provisioned", message: "Initial administrator provisioned by the deployment bootstrap command.", at: now, accountId: userId });
  await client.query("UPDATE vector_pilot_state SET payload = $1::jsonb, updated_at = NOW() WHERE id = 1", [JSON.stringify(state)]);
  await client.query("COMMIT");
  process.stdout.write(`Provisioned verified administrator ${email}.\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write(`${error instanceof Error ? error.message : "admin bootstrap failed"}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
