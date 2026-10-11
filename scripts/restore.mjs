#!/usr/bin/env node
import { createDecipheriv, scryptSync } from "node:crypto";
import { chmod, mkdtemp, read, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...process.env, NODE_ENV: "production" } });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${code}): ${stderr.slice(0, 4000)}`)));
  });
}

if (process.env.VECTOR_RESTORE_CONFIRM !== "RESTORE_VECTOR") throw new Error("Set VECTOR_RESTORE_CONFIRM=RESTORE_VECTOR before a destructive restore");
const backup = resolve(required("VECTOR_BACKUP_FILE"));
const databaseUrl = required("VECTOR_RESTORE_DATABASE_URL");
const passphrase = required("VECTOR_BACKUP_PASSPHRASE");
const handle = await (await import("node:fs/promises")).open(backup, "r");
const work = await mkdtemp(join(tmpdir(), "vector-restore-"));
const plain = join(work, "database.dump");
try {
  const prefix = Buffer.alloc(4096);
  const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
  const headerEnd = prefix.subarray(0, prefixRead.bytesRead).indexOf(10);
  if (headerEnd < 0) throw new Error("Backup header is invalid");
  const header = JSON.parse(prefix.subarray(0, headerEnd).toString("utf8"));
  if (header.format !== "vector-backup" || header.version !== 1 || header.algorithm !== "aes-256-gcm") throw new Error("Unsupported Vector backup format");
  const size = (await stat(backup)).size;
  const tag = Buffer.alloc(16);
  await handle.read(tag, 0, tag.length, size - tag.length);
  const key = scryptSync(passphrase, Buffer.from(header.salt, "base64url"), 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64url"));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(backup, { start: headerEnd + 1, end: size - tag.length - 1 }), decipher, createWriteStream(plain, { mode: 0o600 }));
  await chmod(plain, 0o600);
  await run("pg_restore", ["--exit-on-error", "--clean", "--if-exists", "--no-owner", "--dbname", databaseUrl, plain]);
  process.stdout.write(JSON.stringify({ event: "backup-restored", file: basename(backup), target: "configured restore database", restoredAt: new Date().toISOString() }) + "\n");
} finally {
  await handle.close();
  await rm(work, { recursive: true, force: true });
}
