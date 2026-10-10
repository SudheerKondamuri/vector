import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const manifest = JSON.parse(await readFile("/workspace/.vector/manifest.json", "utf8"));

function safe(value, max = 32_000) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

async function forge(root) {
  return new Promise(resolve => {
    const child = spawn("forge", ["test", "--gas-report", "--root", root], { cwd: root, env: { PATH: process.env.PATH, HOME: "/tmp", FOUNDRY_DISABLE_TELEMETRY: "1", FOUNDRY_CACHE_PATH: "/tmp/foundry-cache", FOUNDRY_OUT: "/tmp/foundry-out", FOUNDRY_SNAPSHOTS: "/tmp/foundry-snapshots" }, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.on("error", error => resolve({ code: 1, output: `${stdout}\n${stderr}\n${safe(error)}` }));
    child.on("close", code => resolve({ code: code ?? 1, output: `${stdout}\n${stderr}` }));
  });
}

function gasTotal(output) {
  const values = [];
  for (const match of output.matchAll(/\|\s*[^|\n]+\s*\|\s*([0-9][0-9,]*)\s*\|/g)) values.push(Number(match[1].replaceAll(",", "")));
  return values.filter(value => Number.isSafeInteger(value) && value > 0).reduce((sum, value) => sum + value, 0);
}

const baseline = await forge("/workspace/.vector/baseline");
const candidate = await forge("/workspace");
const checks = [
  { name: "Pinned baseline forge tests", passed: baseline.code === 0, detail: safe(baseline.output, 4000) },
  { name: "Candidate forge tests", passed: candidate.code === 0, detail: safe(candidate.output, 4000) },
];
const baselineGas = gasTotal(baseline.output);
const candidateGas = gasTotal(candidate.output);
const metrics = baselineGas > 0 && candidateGas > 0 ? [{ name: manifest.target || "Forge gas report", baseline: baselineGas, candidate: candidateGas, improvementPct: (baselineGas - candidateGas) / baselineGas * 100 }] : [];
process.stdout.write(JSON.stringify({
  engine: "Pinned Foundry verifier image",
  environment: `Foundry isolated workspace; base commit ${manifest.baseCommit}; artifact ${manifest.artifactHash}`,
  checks,
  metrics,
  logs: [safe(candidate.output)],
  replayCommand: "forge test --gas-report",
  limitations: ["The fixed verifier entrypoint runs the repository's Foundry test suite and compares parsed gas-report totals; sponsor review remains required.", "The host worker controls network, CPU, memory, PIDs, filesystem and command selection."],
}));
