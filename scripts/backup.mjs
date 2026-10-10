#!/usr/bin/env node
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, read, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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

const databaseUrl = required("DATABASE_URL");
const passphrase = required("VECTOR_BACKUP_PASSPHRASE");
const directory = resolve(process.env.VECTOR_BACKUP_DIR || "./backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const work = await mkdtemp(join(tmpdir(), "vector-backup-"));
const plain = join(work, "database.dump");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const temporary = join(directory, `.vector-${timestamp}.dump.enc.tmp`);
const output = join(directory, `vector-${timestamp}.dump.enc`);

try {
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", plain, "--dbname", databaseUrl]);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = `${JSON.stringify({ format: "vector-backup", version: 1, algorithm: "aes-256-gcm", salt: salt.toString("base64url"), iv: iv.toString("base64url"), createdAt: new Date().toISOString() })}\n`;
  await writeFile(temporary, header, { mode: 0o600 });
  await pipeline(createReadStream(plain), cipher, createWriteStream(temporary, { flags: "a", mode: 0o600 }));
  await writeFile(temporary, cipher.getAuthTag(), { flag: "a", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, output);
  const size = (await stat(output)).size;
  process.stdout.write(JSON.stringify({ event: "backup-created", file: basename(output), bytes: size, createdAt: new Date().toISOString() }) + "\n");
} finally {
  await rm(work, { recursive: true, force: true });
  await rm(temporary, { force: true });
}
