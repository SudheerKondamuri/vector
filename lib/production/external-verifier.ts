import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PilotEvidence, PilotSubmission, PilotTask } from "../pilot-types.ts";
import { validatePatch } from "../pilot-verifier/patch.ts";
import { sha256 } from "../pilot-server/store.ts";
import { workerEvidence } from "../pilot-server/jobs.ts";

const OUTPUT_LIMIT = 128 * 1024;
const COMMAND_TIMEOUT = 120_000;

function safe(value: unknown, max = 4000): string {
  return (value instanceof Error ? value.message : String(value)).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

async function command(command: string, args: string[], cwd: string, timeout = COMMAND_TIMEOUT): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, env: { NODE_ENV: "production", PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"] }) as unknown as ChildProcessWithoutNullStreams;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let finished = false;
    const done = (callback: () => void) => { if (finished) return; finished = true; clearTimeout(timer); callback(); };
    const append = (target: Buffer[], chunk: Buffer) => { size += chunk.length; if (size > OUTPUT_LIMIT) { child.kill("SIGKILL"); done(() => reject(new Error("Verifier command exceeded its combined output cap"))); return; } target.push(chunk); };
    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    child.on("error", (error: Error) => done(() => reject(error)));
    child.on("close", (code: number | null) => done(() => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })));
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(() => reject(new Error(`Verifier command exceeded ${timeout}ms`))); }, timeout);
  });
}

function metric(value: unknown): value is { name: string; baseline: number; candidate: number } {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { name?: unknown }).name === "string" && Number.isSafeInteger((value as { baseline?: unknown }).baseline) && (value as { baseline: number }).baseline > 0 && Number.isSafeInteger((value as { candidate?: unknown }).candidate) && (value as { candidate: number }).candidate >= 0;
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    const [left, right] = normalized.split("::");
    const expand = (part: string) => {
      if (!part) return [];
      const groups = part.split(":").filter(Boolean);
      const last = groups.at(-1);
      if (!last?.includes(".")) return groups;
      const octets = last.split(".").map(Number);
      if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return ["invalid"];
      groups.splice(-1, 1, ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
      return groups;
    };
    let groups = [...expand(left), ...expand(right)];
    if (normalized.includes("::")) {
      const missing = 8 - groups.length;
      if (missing < 1) return true;
      groups = [...expand(left), ...Array.from({ length: missing }, () => "0"), ...expand(right)];
    }
    if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return true;
    const value = groups.reduce((total, group) => (total << BigInt(16)) + BigInt(parseInt(group, 16)), BigInt(0));
    if ((value >> BigInt(32)) === BigInt(0xffff)) return isPrivateIpv4(Number(value & BigInt(0xffffffff)));
    return value === BigInt(0) || value === BigInt(1) || (value >> BigInt(121)) === BigInt(0x7e) || (value >> BigInt(118)) === BigInt(0x3fa) || (value >> BigInt(120)) === BigInt(0xff) || (value >> BigInt(96)) === BigInt(0x20010db8);
  }
  if (isIP(address) !== 4) return true;
  return isPrivateIpv4(address.split(".").map(Number).reduce((value, part) => (value * 256) + part, 0));
}

function isPrivateIpv4(value: number): boolean {
  const parts = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 0 && parts[2] <= 2) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51)) || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224;
}

export async function assertPublicRepositoryUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("External verification accepts only a valid public HTTPS repository URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || url.port) throw new Error("External verification accepts only public HTTPS repositories without credentials, queries, fragments or custom ports");
  const allowed = (process.env.PUBLIC_REPOSITORY_HOSTS || "github.com,gitlab.com,bitbucket.org").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(url.hostname.toLowerCase())) throw new Error("Repository host is not on the production allowlist");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error("Repository host resolves to a private or unsupported network address");
  return url;
}

export async function runExternalVerification(task: PilotTask, submission: PilotSubmission): Promise<PilotEvidence> {
  const started = performance.now();
  const artifactHash = sha256(submission.patch);
  const image = process.env.VERIFIER_IMAGE;
  if (!image || !/^([\w.-]+\/)*[\w.-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("VERIFIER_IMAGE must be a pinned image digest");
  const repositoryUrl = await assertPublicRepositoryUrl(task.repoUrl);
  validatePatch(submission.patch, task.scopePaths);
  const root = await mkdtemp(join(tmpdir(), "vector-verifier-"));
  const source = join(root, "source");
  const baseline = join(root, "baseline");
  const patchFile = join(root, "candidate.patch");
  const volumeName = `vector-verifier-${randomUUID()}`;
  const seedName = `${volumeName}-seed`;
  let volumeCreated = false;
  try {
    const clone = await command("git", ["-c", "http.followRedirects=false", "clone", "--no-checkout", "--filter=blob:none", "--depth=1", "--no-tags", repositoryUrl.toString(), source], root);
    if (clone.code !== 0) throw new Error(`Repository fetch failed: ${safe(clone.stderr)}`);
    const fetched = await command("git", ["-c", "core.hooksPath=/dev/null", "-c", "http.followRedirects=false", "-C", source, "fetch", "--depth=1", "origin", task.baseCommit], root);
    if (fetched.code !== 0) throw new Error(`Pinned commit fetch failed: ${safe(fetched.stderr)}`);
    const checkout = await command("git", ["-c", "core.hooksPath=/dev/null", "-C", source, "checkout", "--detach", task.baseCommit], root);
    if (checkout.code !== 0) throw new Error(`Pinned commit checkout failed: ${safe(checkout.stderr)}`);
    const baselineCopy = await command("cp", ["-a", source, baseline], root);
    if (baselineCopy.code !== 0) throw new Error(`Pinned baseline copy failed: ${safe(baselineCopy.stderr)}`);
    await writeFile(patchFile, submission.patch, { encoding: "utf8", mode: 0o600 });
    const check = await command("git", ["-c", "core.hooksPath=/dev/null", "-C", source, "apply", "--check", "--whitespace=error", patchFile], root);
    if (check.code !== 0) throw new Error(`Patch does not apply to the pinned commit: ${safe(check.stderr)}`);
    const apply = await command("git", ["-c", "core.hooksPath=/dev/null", "-C", source, "apply", "--whitespace=error", patchFile], root);
    if (apply.code !== 0) throw new Error(`Patch application failed: ${safe(apply.stderr)}`);
    const vectorDir = join(source, ".vector");
    await mkdir(vectorDir, { recursive: true, mode: 0o700 });
    const baselineTransfer = await command("cp", ["-a", baseline, join(vectorDir, "baseline")], root);
    if (baselineTransfer.code !== 0) throw new Error(`Pinned baseline transfer failed: ${safe(baselineTransfer.stderr)}`);
    await writeFile(join(vectorDir, "manifest.json"), JSON.stringify({ target: task.target, baseCommit: task.baseCommit, artifactHash, minImprovementPct: task.minImprovementPct, scopePaths: task.scopePaths }), { encoding: "utf8", mode: 0o600 });
    const volume = await command("docker", ["volume", "create", volumeName], root);
    if (volume.code !== 0) throw new Error(`Verifier volume creation failed: ${safe(volume.stderr)}`);
    volumeCreated = true;
    const seed = await command("docker", ["create", "--name", seedName, "--mount", `type=volume,source=${volumeName},target=/workspace`, image], root);
    if (seed.code !== 0) throw new Error(`Verifier volume seed creation failed: ${safe(seed.stderr)}`);
    const copy = await command("docker", ["cp", `${source}/.`, `${seedName}:/workspace/`], root);
    if (copy.code !== 0) throw new Error(`Verifier source transfer failed: ${safe(copy.stderr)}`);
    const removeSeed = await command("docker", ["rm", seedName], root);
    if (removeSeed.code !== 0) throw new Error(`Verifier volume seed cleanup failed: ${safe(removeSeed.stderr)}`);
    const isolatedResult = await command("docker", ["run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=1024m", "--cpus=2", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m", "--mount", `type=volume,source=${volumeName},target=/workspace,readonly`, image], root, 180_000);
    if (isolatedResult.code !== 0) throw new Error(`Verifier container failed: ${safe(isolatedResult.stderr)}`);
    const envelope = JSON.parse(isolatedResult.stdout) as Record<string, unknown>;
    if (!Array.isArray(envelope.checks) || !Array.isArray(envelope.metrics) || !Array.isArray(envelope.logs) || typeof envelope.environment !== "string" || typeof envelope.engine !== "string" || typeof envelope.replayCommand !== "string") throw new Error("Verifier container returned an invalid evidence envelope");
    const metrics = envelope.metrics.filter(metric).map(item => ({ ...item, improvementPct: (item.baseline - item.candidate) / item.baseline * 100 }));
    return workerEvidence({ artifactHash, engine: envelope.engine, environment: envelope.environment, checks: envelope.checks as PilotEvidence["checks"], metrics, logs: envelope.logs.map(line => safe(line, 8000)), limitations: ["Executed in the pinned verifier image; source repository and candidate patch were fetched at the declared commit.", "Container controls are bounded process controls and require host-level security review before hostile public submissions."], replayCommand: envelope.replayCommand, elapsedMs: Math.round(performance.now() - started) });
  } finally {
    await command("docker", ["rm", "-f", seedName], root).catch(() => undefined);
    if (volumeCreated) await command("docker", ["volume", "rm", volumeName], root).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}
