import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getReferenceBundle, runReferenceVerification } from "../../lib/pilot-verifier/index";
import { REFERENCE_COMMIT, REFERENCE_PATH, type PilotSubmission, type PilotTask } from "../../lib/pilot-types";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  kill = vi.fn(() => { queueMicrotask(() => this.emit("close", null, "SIGKILL")); return true; });
}

function inputs(): { task: PilotTask; submission: PilotSubmission } {
  const patch = getReferenceBundle().patch;
  return {
    task: { id: "bounded-task", fixture: "reference", baseCommit: REFERENCE_COMMIT, scopePaths: [REFERENCE_PATH], minImprovementPct: 10 } as PilotTask,
    submission: { taskId: "bounded-task", baseCommit: REFERENCE_COMMIT, patch, artifactHash: createHash("sha256").update(patch).digest("hex") } as PilotSubmission
  };
}

describe("reference child process containment", () => {
  let child: FakeChild;
  beforeEach(() => { child = new FakeChild(); spawn.mockReset().mockReturnValue(child); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("uses only a fixed node script, heap limit and secret-free minimal environment", async () => {
    vi.stubEnv("VECTOR_VERIFIER_TEST_SECRET", "synthetic-canary-not-a-real-secret");
    vi.stubEnv("NODE_OPTIONS", "--require=/untrusted/preload.cjs");
    const { task, submission } = inputs();
    const pending = runReferenceVerification(task, submission);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [executable, args, options] = spawn.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toContain("--max-old-space-size=512");
    expect(args.at(-1)).toMatch(/\/scripts\/reference-worker\.mjs$/);
    expect(options.shell).toBe(false);
    expect(options.env).toEqual({ NODE_ENV: "production", LANG: "C", LC_ALL: "C", TZ: "UTC" });
    const data = JSON.parse(child.stdin.end.mock.calls[0][0] as string);
    expect(Object.keys(data).sort()).toEqual(["artifactHash", "commit", "minImprovementPct", "patch"]);
    expect(data.patch).toBe(submission.patch);
    child.emit("close", 2, null);
    expect((await pending).outcome).toBe("failed");
  });

  it("kills the child at the fixed timeout and returns honest failure evidence", async () => {
    vi.useFakeTimers();
    const { task, submission } = inputs();
    const pending = runReferenceVerification(task, submission);
    await vi.advanceTimersByTimeAsync(30_000);
    const evidence = await pending;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(evidence.outcome).toBe("failed");
    expect(evidence.metrics).toEqual([]);
    expect(evidence.checks.at(-1)?.detail).toMatch(/timeout/i);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("caps combined stdout and stderr and never stores unstructured child output", async () => {
    const { task, submission } = inputs();
    const pending = runReferenceVerification(task, submission);
    child.stdout.emit("data", Buffer.alloc(120 * 1024, "a"));
    child.stderr.emit("data", Buffer.alloc(10 * 1024, "b"));
    const evidence = await pending;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(evidence.outcome).toBe("failed");
    expect(evidence.checks.at(-1)?.detail).toMatch(/output cap/i);
    expect(evidence.logs.join("")).not.toContain("a".repeat(100));
  });

  it("limits the runner to one child and requires explicit retry", async () => {
    const { task, submission } = inputs();
    const first = runReferenceVerification(task, submission);
    const second = await runReferenceVerification(task, submission);
    expect(second.outcome).toBe("failed");
    expect(second.checks.at(-1)?.detail).toMatch(/busy.*retry explicitly/i);
    expect(spawn).toHaveBeenCalledTimes(1);
    child.emit("close", 2, null);
    await first;
  });

  it("fails invalid JSON rather than retrying or inventing metrics", async () => {
    const { task, submission } = inputs();
    const pending = runReferenceVerification(task, submission);
    child.stdout.emit("data", Buffer.from("not-json"));
    child.emit("close", 0, null);
    const evidence = await pending;
    expect(evidence.outcome).toBe("failed");
    expect(evidence.metrics).toEqual([]);
    expect(evidence.checks.at(-1)?.detail).toMatch(/valid.*JSON/i);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("rejects a worker envelope that claims another artifact", async () => {
    const { task, submission } = inputs();
    const pending = runReferenceVerification(task, submission);
    child.stdout.emit("data", Buffer.from(JSON.stringify({ protocolVersion: 1, outcome: "passed", artifactHash: "0".repeat(64), checks: [], metrics: [], logs: [] })));
    child.emit("close", 0, null);
    const evidence = await pending;
    expect(evidence.outcome).toBe("failed");
    expect(evidence.metrics).toEqual([]);
    expect(evidence.checks.at(-1)?.detail).toMatch(/schema.*hash validation/i);
  });
});
