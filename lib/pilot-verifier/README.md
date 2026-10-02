# Controlled Solidity reference verification

This is a real, offline compile/deploy/execute benchmark for the bundled fixture.
It is **not a hostile-code sandbox or a security audit** and must not be exposed
as an arbitrary public code-execution service. Only the bundled reference loop
can run locally; external repository reports remain operator-supplied records.

## Public server integration

Import from `lib/pilot-verifier/index.ts`:

- `validatePatch(patch, scopePaths): string[]` throws for invalid artifacts and
  returns the single changed Solidity source path. Declare exact paths or
  directory scopes ending in `/`. Call this before saving any submission.
- `getReferenceBundle()` returns `{ source, patch, commit, path }`, including a
  real checked-to-unchecked unified diff.
- `runReferenceVerification(task, submission): Promise<PilotEvidence>` returns
  `passed` or `failed` evidence, including honest failure receipts for invalid
  input, compiler failures, wrong behavior, regressions, insufficient improvement
  and worker failures. It does not change task/submission status or accept work.
- `recordExternalEvidence(submission, report): PilotEvidence` validates the
  artifact hash and bounded report fields, defensively copies report entries and
  recalculates percentages. It always returns `source: external-report` and
  `outcome: recorded`, including when supplied checks pass. Replay instructions
  are recorded as text and are never executed. Scope validation belongs to the
  preceding `validatePatch(patch, task.scopePaths)` call.

Reference execution requires `fixture: reference`, matching task/submission IDs,
the shared `REFERENCE_COMMIT` label on both inputs, **exactly**
`scopePaths: [REFERENCE_PATH]`, a matching SHA256 artifact hash and a finite
0–100% threshold. A strictly positive measured improvement is required even
when the configured threshold is zero. Keep authorization and manual review in
the API/service layer. One worker can run per loaded verifier instance; a busy
run returns failure evidence requiring an explicit retry.

## Artifact and source integrity

Patches are at most **100,000 UTF-8 bytes**, single-file existing `.sol` edits
with canonical relative `a/` and `b/` paths and consistent, ordered unified
hunks. Traversal, absolute/encoded/hidden paths, tests, configurations, scripts,
dependency folders, binary patches, file creation/deletion, renames, extra files
and unsupported metadata are rejected. An optional canonical git `diff --git`
header and a single strict `index` line are accepted. CRLF and no-newline metadata
are intentionally not supported.

For external repositories this is structural validation only: no checkout is
fetched and their source content, hunk applicability or commit is not independently
verified. The path `src/GasTarget.sol` is reserved for the pinned reference source.

For `src/GasTarget.sol`, hunk removals and context must match the pinned source
exactly. The compiler pragma, contract wrapper, pure `sum(uint256) -> uint256`
interface, `n <= 1000` guard and closing structure are immutable. Only the loop
body may change. Runtime bytecode is scanned (skipping PUSH operands) to reject
calls, creates, storage, logs and self-destruct, including pure precompile calls.

- Baseline source SHA256:
  `ebfd7c3bdd5c3d7456a97f667c90d16e8e3f025a3b5b217f77d2284f5c3fdfc5`
- Example artifact SHA256:
  `0b4ed02817cfbcd02b098c2927f8f0a6a567ab18176e042525f307c0e8afd352`
- `REFERENCE_COMMIT` remains the shared synthetic `111…111` fixture label.
  It is explicitly not represented as an actual fetched Git commit. A future
  shared-contract change could replace this label with an explicit content
  digest/version; the real baseline digest is independently pinned today.

## Actual execution environment and boundaries

Pinned npm dependencies: `solc 0.8.30`, `@ethereumjs/vm 10.1.3`,
`@ethereumjs/common 10.1.3`, `@ethereumjs/util 10.1.3`; lockfile also pins
`@ethereumjs/evm 10.1.3`. Actual compiler:
`0.8.30+commit.73712a01.Emscripten.clang`.

Both sources compile with identical settings: optimizer enabled, 200 runs,
`viaIR: false`, `evmVersion: shanghai`, metadata hash `none`, CBOR disabled.
Creation bytecode is actually executed in separate fresh EthereumJS VMs using
mainnet Shanghai rules, then stored runtime is compared with compiler output.
Every call resets its state checkpoint and access journal and runs statically
with a 1,000,000 gas limit. Deployment has a 2,000,000 gas limit.

The application only validates data and spawns a fixed worker. Compilation and
EVM execution occur in `scripts/reference-worker.mjs`, launched with the exact
Node executable, `--max-old-space-size=512`, no shell, a 30-second timeout and a
128KiB combined stdout/stderr cap. Stdin is bounded. The child receives only
`NODE_ENV`, `LANG`, `LC_ALL` and `TZ`, not inherited secrets or `NODE_OPTIONS`.
No repository fetching, shell code, `git apply`, arbitrary project scripts,
compiler import callback, remote service or runtime package installation is used.
The heap cap is not an OS RSS/cgroup limit, and this process is not an OS
filesystem/network sandbox. Deploy the project files, fixtures, scripts and
installed dependencies together, running from the project root with Node 25.

Checks use an independent arithmetic and exact revert-data oracle, ABI equality,
per-case gas nonregression and the sum of fixed-call execution gas. There are
13 fixed calls: `n = 0, 1, 2, 10, 32, 100, 999, 1000`, reverting `1001` and
`uint256 max`, empty calldata, truncated arguments and an unknown selector.
The aggregate excludes deployment. Gas is EVM message execution, not full
transaction intrinsic/calldata gas, fees, Foundry output or mainnet economics.
Finite cases cannot prove all behaviors of arbitrary candidate code.

External reports require nonempty environment/replay text, boolean checks with
nonempty details, finite nonnegative safe gas numbers, and nonempty logs and
limitations, all bounded to 100KB total with individual item/count limits.
Nonrepresentable percentage ratios are rejected. Zero-baseline percentages are
displayed as 0 with an explicit limitation; no saving is invented.

## Replay and measured result (2026-10-05)

Run from the project root:

```sh
node scripts/reference-verify.mjs
node scripts/reference-verify.mjs --patch fixtures/reference/wrong-output.patch
node scripts/reference-verify.mjs --min-improvement 90
node scripts/reference-verify.mjs --patch fixtures/reference/no-improvement.patch --min-improvement 0
```

The first invocation exited **0 / passed** on Node **v25.6.1**. All others
exited **1 / failed**. CLI errors use exit 2. Evidence contains the exact artifact
hash, compiler/EVM versions/settings, both source hashes, safe structured logs,
parent wall-clock `elapsedMs`, check results and downloadable-artifact replay
instructions. Save an uploaded artifact as `./downloaded.patch` and use its
returned `replayCommand`, including the expected SHA256.

| Case | Baseline gas | Optimized gas |
|---|---:|---:|
| Deployment (code deposit included) | 46,697 | 38,285 |
| sum(0) | 309 | 309 |
| sum(1) | 432 | 364 |
| sum(2) | 555 | 419 |
| sum(10) | 1,539 | 859 |
| sum(32) | 4,245 | 2,069 |
| sum(100) | 12,609 | 5,809 |
| sum(999) | 123,186 | 55,254 |
| sum(1000) | 123,309 | 55,309 |
| sum(1001) revert | 326 | 326 |
| sum(uint256 max) revert | 326 | 326 |
| Empty calldata revert | 68 | 68 |
| Truncated argument revert | 157 | 157 |
| Unknown selector revert | 101 | 101 |
| **Aggregate fixed calls** | **267,162** | **121,370** |

Aggregate improvement: **54.57063504540316%**. The faster wrong-output patch
produces the same gas savings but fails seven behavior checks. The valid patch
fails a 90% threshold. The comment-only patch produces **267,162 -> 267,162**,
0%, and fails even at a zero threshold. A syntax-invalid body yields a real
compiler failure with no fabricated benchmark; a precompile-call patch is
rejected before deployment.

## TDD evidence and checks

Journeys: preserve artifact scope/integrity; record external evidence without
claiming independent execution; measure the reference honestly in a bounded
worker and prevent incomplete/incorrect evidence from passing.

- `npm run test:unit -- tests/unit/pilot-verifier.test.ts`: runtime RED against
  explicit unimplemented exports (**7 failed / 45 passed**), then GREEN.
- `npm run test:unit -- tests/unit/pilot-verifier-reference.test.ts`: runtime
  RED (**11 failed**) before the worker implementation, then GREEN with actual
  Solidity/EVM execution. Further RED/GREEN cases cover percentage overflow and
  pure-precompile rejection.
- `npm run test:unit -- tests/unit/pilot-verifier.test.ts tests/unit/pilot-verifier-bounds.test.ts tests/unit/pilot-verifier-reference.test.ts`:
  **76 passed**. Bound tests verify the fixed command/minimal environment,
  timeout kill, combined output cap, single-worker limit, malformed receipts and
  no automatic retry. Real-worker tests cover pass and negative outcomes.
- `npx vitest run tests/unit/pilot-verifier*.test.ts --coverage.enabled --coverage.include 'lib/pilot-verifier/**/*.ts' --coverage.reporter=text --coverage.reportsDirectory /tmp/opencode/vector-verifier-coverage`:
  **passed**; 88.01% statements, 86.75% branches, 96.22% functions, 92.96% lines
  for the TypeScript verifier modules. Child-worker JavaScript is verified by
  actual execution rather than included in parent V8 coverage.
- `npx eslint lib/pilot-verifier tests/unit/pilot-verifier*.test.ts scripts/reference*.mjs`:
  **passed**.
- `npx tsc --noEmit --target ES2017 --lib ESNext,DOM --module esnext --moduleResolution bundler --esModuleInterop --strict --skipLibCheck --allowImportingTsExtensions lib/pilot-verifier/*.ts tests/unit/pilot-verifier*.test.ts`:
  **passed**.

No Git checkpoints were created because this workspace is not a Git repository.

### Delivery self-review

Overall **4.2/5**; scoped implementation is deliverable with minor integration nits.

| Axis | Score | Evidence and specific improvement |
|---|---:|---|
| Accuracy | 4 | Actual EVM/compiler results and both negative controls are verified; replace the legacy synthetic label with an explicit digest/version in a future coordinated shared-contract change. |
| Completeness | 4 | All four requested exports and failure paths are present; source digests currently live in structured logs because the shared evidence DTO has no dedicated digest fields. |
| Clarity | 5 | Public signatures, exact eligibility rules, execution boundaries, measured cases and replay commands are documented together. |
| Actionability | 4 | CLI, scoped lint/typecheck and 76 tests pass; the full project typecheck observed during T3 was blocked by an unrelated `tests/e2e/demo.spec.ts:66` TS1434 syntax error that the coordinator must resolve. |
| Conciseness | 4 | The API entrypoint is four exports; this README combines integration and detailed TDD proof, which could later be split for quicker navigation. |

Highest-impact follow-ups: (1) resolve the unrelated project typecheck blocker;
(2) coordinate explicit fixture-version/source-digest DTO fields if the shared
contract is revised. No critical self-review issues. Self-check: the measured
proof and explicit integration limits support this assessment. Deliver as-is.
