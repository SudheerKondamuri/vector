# Vector — from brief to proof

A working, single-server pilot app for bounded Solidity gas-optimization work. The real application is `/workspace`; `/arena` is the preserved browser-only simulation.

## Run it

Use **Node 25+** and npm. No model API key, wallet, database service, Docker daemon or Foundry installation is required for the bundled reference exercise. Production deployment additionally uses PostgreSQL, a worker Docker host, email delivery and Base Sepolia configuration.

```sh
npm ci
npm run build
npm run start -- --port 3001
```

Open **http://localhost:3001/workspace**. For development, use `npm run dev -- --port 3001`. Both commands bind to loopback by default. Keep one application process writing the data directory.

For a PostgreSQL deployment, run migrations first, then provision the first administrator once with
`VECTOR_ADMIN_EMAIL`, `VECTOR_ADMIN_NAME` and `VECTOR_ADMIN_PASSWORD` supplied only to the command
environment: `npm run admin:create`. The bootstrap password is scrypt-hashed and is not retained by
the script; the administrator can then issue invite-only account invitations from the API.

## Try the complete reference flow

1. Create your own account. There are no preloaded credentials or demo accounts.
2. Select **Start reference exercise**, review the preset, and **Save draft**.
3. Open the saved task and select **Publish task**. The scope and terms are now hashed and frozen.
4. Select **Load example patch**, enter actual effort and compute cost (0 is allowed), then **Submit patch**.
5. Select **Run reference verification**. It compiles and executes both versions, measuring real EVM gas and comparing fixed arithmetic/revert cases.
6. Read the checks, measurements, limitations and replay instructions. Record a review reason and time, then accept or reject.
7. Optionally record costs and your existing invoice/payment process. **Save ledger** does not transfer money.
8. Download the original patch and **Export JSON** / **Export Markdown**. Reloading or signing in again preserves the task.

The bundled optimized example measures **267,162 → 121,370 fixed-call execution gas (54.57%)** with the pinned settings. Deployment is measured separately. This is fixture evidence, not a customer result or proof of complete correctness.

## Real project briefs

Use **New task** to save a repository pointer, pinned commit, allowed paths, behavior constraints, threshold, deadline, attempt cap, terms and invited emails. An invited operator creates an account using that email and sees the published task. Operators see only their own artifacts; the sponsor sees all submissions.

Operators run their own agents and Foundry environments externally. Upload or paste a unified patch, then attach the actual environment, checks, gas measurements, logs, limitations and replay instructions using the documented report JSON form. Report values are validated and percentages recalculated, but remain **operator-supplied, not independently rerun**. Reports may be corrected before review; changes are logged. Acceptance remains a sponsor decision.

The bundled local reference exercise does **not** fetch or execute custom repositories, run hosted AI agents, merge patches, deploy contracts, accept custody or automatically invoice/pay anyone. The approved production path adds a separately isolated worker for pinned public repositories and Base Sepolia ERC-20 escrow mechanics; testnet tokens are not production payment.

## Data and configuration

- Local accounts, password hashes, token hashes, tasks, patches, reports and audit events persist at `.data/pilot/state.json`. Production uses PostgreSQL and rejects JSON storage. `.data/` is ignored by git. Keep local data private; it contains authorized source artifacts and personal account data.
- Directories use mode `0700`; state files use `0600`. Writes are serialized, synced and atomically replaced. Corrupt records cause an error instead of silently resetting your data.
- `VECTOR_DATA_DIR=/absolute/private/folder` overrides storage. Back up this directory privately with the server stopped. Do not commit it or include it in public evidence.
- Sessions use opaque HttpOnly, SameSite cookies; passwords use scrypt. Authentication attempts are bounded. Cookies are Secure in the production server; use localhost/loopback for the local preview and HTTPS for a deployed origin.
- `VECTOR_APP_ORIGIN=https://your-vector.example` explicitly configures a canonical reverse-proxy origin. Without it, mutations are limited to localhost/loopback authorities. Forwarded host headers are not trusted automatically.
- Production signup is invite-only, requires email verification, supports password recovery, administrator-issued invitations and revocable bearer API tokens. Local development can use isolated JSON storage; do not expose the local mode or unrestricted signup to the public internet.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run verify:reference
```

Playwright needs its Chromium runtime: `npx playwright install chromium` on a fresh machine. E2E tests start a separate production server on port 3101 with fresh temporary data; they never reuse your app server or real records. `VECTOR_E2E_PORT` overrides the test port.

## Verification boundaries

The bundled reference worker uses **solc 0.8.30 / EthereumJS VM 10.1.3**, fixed Shanghai settings, actual deployment and execution, immutable source hashing, unified-patch validation, a 30-second deadline, 512 MiB Node heap cap, bounded output and a minimal environment. It is restricted to a bounded pure sum-loop fixture.

These process limits are **not an OS-level hostile-code sandbox**. There is no claim that tests prove full equivalence, security, arbitrary Foundry compatibility, or safe production merging. A dedicated disposable Docker/Foundry worker and security review remain necessary before independently verifying untrusted customer repositories.

The production implementation is being expanded under the approved [production acceptance brief](docs/PRODUCTION-ACCEPTANCE.md) and [production architecture](docs/PRODUCTION-ARCHITECTURE.md). The bundled reference fixture remains a test exercise and does not establish paid demand or sustainable economics. See [pilot strategy](docs/PAID-PILOT-PLAN.md) and [reference verifier details](lib/pilot-verifier/README.md).
