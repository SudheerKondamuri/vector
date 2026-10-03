// Fixed offline worker. Solidity and the EVM run only in this bounded child process.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import solc from "solc";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createVM } from "@ethereumjs/vm";
import { Account, bytesToHex, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { REFERENCE_COMMIT, REFERENCE_PATH } from "../lib/pilot-types.ts";
import { applyReferencePatch } from "../lib/pilot-verifier/patch.ts";
import { MAX_PATCH_BYTES, REFERENCE_SOURCE_SHA256, sha256 } from "../lib/pilot-verifier/reference.ts";

const started = performance.now();
const checks = [];
const metrics = [];
const logs = [];
const version = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
const versions = { node: process.version, solc: solc.version(), vm: version("@ethereumjs/vm"), evm: version("@ethereumjs/evm"), common: version("@ethereumjs/common"), util: version("@ethereumjs/util") };
const settings = {
  optimizer: { enabled: true, runs: 200 }, viaIR: false, evmVersion: "shanghai",
  metadata: { bytecodeHash: "none", appendCBOR: false },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.methodIdentifiers"] } }
};
const engine = `EthereumJS VM ${versions.vm} / EVM ${versions.evm} (real offline message execution)`;
const environment = `Node ${versions.node}; solc ${versions.solc}; @ethereumjs/common ${versions.common}; @ethereumjs/util ${versions.util}; optimizer enabled/runs=200; viaIR=false; EVM shanghai / mainnet Shanghai; metadata hash=none/CBOR=false`;
const log = (entry) => logs.push(JSON.stringify(entry));
const check = (name, passed, detail) => checks.push({ name, passed, detail });
const pct = (baseline, candidate) => baseline === 0 ? 0 : ((baseline - candidate) / baseline) * 100;
const safeMessage = (error) => (error instanceof Error ? error.message : "Reference worker failure").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000);

async function request() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_PATCH_BYTES * 2 + 2000) throw new Error("Worker input exceeds its bound");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["patch", "artifactHash", "minImprovementPct", "commit"].includes(key))
    || typeof input.patch !== "string" || input.artifactHash !== sha256(input.patch)
    || input.commit !== REFERENCE_COMMIT || typeof input.minImprovementPct !== "number"
    || !Number.isFinite(input.minImprovementPct) || input.minImprovementPct < 0 || input.minImprovementPct > 100) {
    throw new Error("Worker accepts only the immutable reference patch request");
  }
  return input;
}

function compile(source, label) {
  // No import callback, repository loading, network or compiler command is provided.
  const result = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { [REFERENCE_PATH]: { content: source } }, settings })));
  const diagnostics = (result.errors ?? []).slice(0, 20);
  for (const diagnostic of diagnostics) log({ event: "compiler-diagnostic", source: label, severity: diagnostic.severity, code: diagnostic.errorCode, message: safeMessage(new Error(diagnostic.message)) });
  const errors = diagnostics.filter((entry) => entry.severity === "error");
  const contract = result.contracts?.[REFERENCE_PATH]?.GasTarget;
  const success = errors.length === 0 && Boolean(contract?.evm?.bytecode?.object) && Boolean(contract?.evm?.deployedBytecode?.object);
  check(`${label} compilation`, success, success ? "Pinned solc produced ABI, creation and runtime bytecode using identical fixed settings." : "Compilation failed; no gas result is fabricated.");
  if (!success) return null;
  if (contract.evm.bytecode.object.length > 49_152 * 2 || contract.evm.deployedBytecode.object.length > 24_576 * 2) throw new Error("Compiled contract exceeds Shanghai bytecode size limits");
  log({ event: "compiled", source: label, creationBytes: contract.evm.bytecode.object.length / 2, runtimeBytes: contract.evm.deployedBytecode.object.length / 2, runtimeHexSha256: sha256(contract.evm.deployedBytecode.object) });
  return contract;
}

async function deploy(contract, label) {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai });
  const vm = await createVM({ common });
  const caller = createAddressFromString("0x00000000000000000000000000000000000000ce");
  await vm.stateManager.putAccount(caller, new Account(0n, 10n ** 18n));
  const result = await vm.evm.runCall({ caller, origin: caller, data: hexToBytes(`0x${contract.evm.bytecode.object}`), gasLimit: 2_000_000n, value: 0n });
  const exception = result.execResult.exceptionError?.error;
  if (exception || !result.createdAddress) throw new Error(`${label} deployment failed: ${exception ?? "no created address"}`);
  const deployed = bytesToHex(await vm.stateManager.getCode(result.createdAddress));
  if (deployed !== `0x${contract.evm.deployedBytecode.object}`) throw new Error(`${label} deployed runtime does not match compiler output`);
  vm.evm.journal.cleanJournal();
  const gas = Number(result.execResult.executionGasUsed);
  log({ event: "deployment", source: label, gas, address: result.createdAddress.toString(), runtimeMatchesCompiler: true });
  return { vm, caller, address: result.createdAddress, gas };
}

async function call(deployment, data) {
  deployment.vm.evm.journal.cleanJournal();
  await deployment.vm.stateManager.checkpoint();
  try {
    const { execResult } = await deployment.vm.evm.runCall({
      caller: deployment.caller, origin: deployment.caller, to: deployment.address,
      data: hexToBytes(data), gasLimit: 1_000_000n, value: 0n, isStatic: true
    });
    return { gas: Number(execResult.executionGasUsed), output: bytesToHex(execResult.returnValue), exception: execResult.exceptionError?.error ?? null };
  } finally {
    await deployment.vm.stateManager.revert();
    deployment.vm.evm.journal.cleanJournal();
  }
}

function cases(selector) {
  const word = (value) => BigInt(value).toString(16).padStart(64, "0");
  const reason = Buffer.from("n too large", "utf8");
  const revert = `0x08c379a0${word(32)}${word(reason.length)}${reason.toString("hex").padEnd(64, "0")}`;
  return [
    ...[0n, 1n, 2n, 10n, 32n, 100n, 999n, 1000n].map((n) => ({ name: `sum(${n})`, data: `0x${selector}${word(n)}`, output: `0x${word(n * (n - 1n) / 2n)}`, exception: null })),
    ...[1001n, (1n << 256n) - 1n].map((n) => ({ name: n === 1001n ? "sum(1001) revert" : "sum(uint256 max) revert", data: `0x${selector}${word(n)}`, output: revert, exception: "revert" })),
    { name: "empty calldata revert", data: "0x", output: "0x", exception: "revert" },
    { name: "truncated argument revert", data: `0x${selector}00`, output: "0x", exception: "revert" },
    { name: "unknown selector revert", data: "0xffffffff", output: "0x", exception: "revert" }
  ];
}

function forbiddenOpcodes(hex) {
  const bytecode = Buffer.from(hex, "hex");
  const forbidden = new Map([
    [0x54, "SLOAD"], [0x55, "SSTORE"], [0x5c, "TLOAD"], [0x5d, "TSTORE"],
    [0xf0, "CREATE"], [0xf1, "CALL"], [0xf2, "CALLCODE"], [0xf4, "DELEGATECALL"],
    [0xf5, "CREATE2"], [0xfa, "STATICCALL"], [0xff, "SELFDESTRUCT"],
    ...[0xa0, 0xa1, 0xa2, 0xa3, 0xa4].map((opcode, index) => [opcode, `LOG${index}`])
  ]);
  const found = new Set();
  for (let cursor = 0; cursor < bytecode.length; cursor++) {
    const opcode = bytecode[cursor];
    if (forbidden.has(opcode)) found.add(forbidden.get(opcode));
    // PUSH data is data, not executable opcodes; compiler CBOR metadata is disabled.
    if (opcode >= 0x60 && opcode <= 0x7f) cursor += opcode - 0x5f;
  }
  return [...found];
}

let input;
try {
  input = await request();
  log({ event: "environment", versions, settings, settingsSha256: sha256(JSON.stringify(settings)), environmentKeys: Object.keys(process.env).sort() });
  const pinned = versions.solc === "0.8.30+commit.73712a01.Emscripten.clang"
    && [versions.vm, versions.evm, versions.common, versions.util].every((value) => value === "10.1.3");
  check("Pinned compiler and EVM versions", pinned, "solc 0.8.30+commit.73712a01; EthereumJS VM/EVM/Common/Util 10.1.3; Shanghai.");
  if (!pinned) throw new Error("Installed compiler or EVM differs from the pinned verifier versions");
  const { baseline, candidate } = applyReferencePatch(input.patch);
  check("Pinned fixture SHA256 and loop-only scope", sha256(baseline) === REFERENCE_SOURCE_SHA256,
    `baseline source SHA256 ${REFERENCE_SOURCE_SHA256}; only ${REFERENCE_PATH}'s sum loop is editable.`);
  log({ event: "source-integrity", referenceCommit: REFERENCE_COMMIT, commitIsSyntheticLabel: true, path: REFERENCE_PATH, artifactSha256: input.artifactHash, baselineSourceSha256: sha256(baseline), candidateSourceSha256: sha256(candidate) });
  const baselineContract = compile(baseline, "Baseline");
  const candidateContract = compile(candidate, "Candidate");
  if (baselineContract && candidateContract) {
    const abiMatches = JSON.stringify(baselineContract.abi) === JSON.stringify(candidateContract.abi)
      && JSON.stringify(baselineContract.evm.methodIdentifiers) === JSON.stringify(candidateContract.evm.methodIdentifiers);
    check("ABI and selector matching", abiMatches, "Candidate must preserve the baseline's pure sum(uint256) -> uint256 ABI and method selectors.");
    if (!abiMatches) throw new Error("Candidate ABI differs from the immutable reference interface");
    const baselineForbidden = forbiddenOpcodes(baselineContract.evm.deployedBytecode.object);
    const candidateForbidden = forbiddenOpcodes(candidateContract.evm.deployedBytecode.object);
    const noExternalOrMutableState = baselineForbidden.length === 0 && candidateForbidden.length === 0;
    check("No external calls or mutable state", noExternalOrMutableState,
      noExternalOrMutableState ? "Runtime opcode scan (skipping PUSH data) found no calls, creates, storage, logs or self-destruct." : `Forbidden runtime opcodes: baseline [${baselineForbidden.join(", ")}]; candidate [${candidateForbidden.join(", ")}].`);
    if (!noExternalOrMutableState) throw new Error("Reference loop cannot use calls, create contracts or access mutable state");
    const baselineDeployment = await deploy(baselineContract, "Baseline");
    const candidateDeployment = await deploy(candidateContract, "Candidate");
    check("Creation bytecode deployment", true, "Creation bytecode executed in separate identical fresh VMs; stored runtime matches compiler output.");
    metrics.push({ name: "Deployment execution (includes code deposit)", baseline: baselineDeployment.gas, candidate: candidateDeployment.gas, improvementPct: pct(baselineDeployment.gas, candidateDeployment.gas) });
    check("Deployment gas no regression", candidateDeployment.gas <= baselineDeployment.gas, `Baseline ${baselineDeployment.gas}; candidate ${candidateDeployment.gas} EVM gas.`);
    let baselineTotal = 0;
    let candidateTotal = 0;
    const samples = cases(baselineContract.evm.methodIdentifiers["sum(uint256)"]);
    for (const sample of samples) {
      const baselineResult = await call(baselineDeployment, sample.data);
      const candidateResult = await call(candidateDeployment, sample.data);
      const baselineCorrect = baselineResult.output === sample.output && baselineResult.exception === sample.exception;
      const candidateCorrect = candidateResult.output === sample.output && candidateResult.exception === sample.exception;
      const matches = baselineResult.output === candidateResult.output && baselineResult.exception === candidateResult.exception;
      const equivalent = baselineCorrect && candidateCorrect && matches;
      check(`Behavior ${sample.name}`, equivalent, equivalent
        ? "Both outputs and exceptions match each other and the independently calculated arithmetic/revert oracle."
        : "Output or exception differs from the mathematical/revert oracle or baseline; optimization is ineligible.");
      check(`Gas no regression ${sample.name}`, candidateResult.gas <= baselineResult.gas,
        `Baseline ${baselineResult.gas}; candidate ${candidateResult.gas} execution gas; fixed 1,000,000 gas limit.`);
      metrics.push({ name: sample.name, baseline: baselineResult.gas, candidate: candidateResult.gas, improvementPct: pct(baselineResult.gas, candidateResult.gas) });
      baselineTotal += baselineResult.gas;
      candidateTotal += candidateResult.gas;
      log({ event: "case", name: sample.name, equivalent, expectedOutput: sample.output, expectedException: sample.exception, baseline: baselineResult, candidate: candidateResult });
    }
    const aggregatePct = pct(baselineTotal, candidateTotal);
    metrics.push({ name: "Aggregate fixed calls", baseline: baselineTotal, candidate: candidateTotal, improvementPct: aggregatePct });
    check("Aggregate improvement threshold", candidateTotal < baselineTotal && aggregatePct >= input.minImprovementPct,
      `Sum of ${samples.length} fixed-call execution gas (equal weight per call; deployment excluded): ${baselineTotal} -> ${candidateTotal}, ${aggregatePct.toFixed(6)}%; requires a positive saving and >= ${input.minImprovementPct}%.`);
    log({ event: "aggregate", caseCount: samples.length, baseline: baselineTotal, candidate: candidateTotal, improvementPct: aggregatePct, minImprovementPct: input.minImprovementPct, weighting: "sum of fixed calls; equal weight per call; deployment excluded" });
  }
} catch (error) {
  check("Controlled reference worker completion", false, safeMessage(error));
  log({ event: "worker-failure", message: safeMessage(error) });
}

const proof = {
  protocolVersion: 1, engine, environment, artifactHash: input?.artifactHash ?? "", baselineSourceSha256: REFERENCE_SOURCE_SHA256,
  outcome: checks.length > 0 && checks.every((entry) => entry.passed) && metrics.length > 0 ? "passed" : "failed",
  checks, metrics, logs, elapsedMs: Math.round(performance.now() - started)
};
const output = `${JSON.stringify(proof)}\n`;
if (Buffer.byteLength(output, "utf8") > 128 * 1024) {
  process.stderr.write("Reference evidence exceeded the fixed output bound.\n");
  process.exitCode = 2;
} else process.stdout.write(output);
