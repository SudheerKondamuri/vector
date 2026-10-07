#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write("DATABASE_URL is required for migrations.\n");
  process.exit(2);
}

const directory = resolve(process.cwd(), "db", "migrations");
const files = (await readdir(directory)).filter(file => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
const client = new Client({ connectionString, application_name: "vector-migrations", connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("CREATE TABLE IF NOT EXISTS vector_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const applied = new Set((await client.query("SELECT version FROM vector_schema_migrations")).rows.map(row => row.version));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(directory, file), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO vector_schema_migrations (version) VALUES ($1)", [file]);
    process.stdout.write(`applied ${file}\n`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write(`${error instanceof Error ? error.message : "migration failed"}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
