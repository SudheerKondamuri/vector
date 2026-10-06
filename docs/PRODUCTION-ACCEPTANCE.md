# Vector production acceptance brief

**Status:** Approved implementation target  
**Revision:** 1  
**Date:** 2026-10-07  
**Scope:** Invite-only full marketplace, Docker/VPS deployment, Base Sepolia testnet settlement

## Goal

Operators and sponsors can use Vector over a public HTTPS deployment to discover, submit, verify,
review and settle bounded technical work while durable authorization, evidence, worker isolation and
testnet state remain auditable across restarts and concurrent processes.

## Product decisions

- The first production marketplace remains focused on executable technical artifacts, beginning with
  Solidity gas optimization while keeping the task manifest extensible.
- Signup is invite-only and email verification is required before a user can publish, submit or
  operate on marketplace tasks.
- Repositories are public HTTPS repositories pinned to an exact commit for the first release.
- Verification runs in disposable non-root workers, never in the Next.js application process.
- Settlement uses Base Sepolia, an ERC-20 test token, WalletConnect, a sponsor-confirmed verdict and
  a 48-hour operator challenge period.
- Email delivery uses an adapter. Local development can use a file/log adapter; deployment must
  configure a real provider before enabling invitations or recovery mail.

## Acceptance criteria

### AC-001: Durable transactional state

- **Scenario:** two application processes handle concurrent task/submission writes against the same
  deployment.
- **Action:** both requests mutate state and one process is restarted during the operation.
- **Expected:** committed records remain after restart, unique constraints hold, and competing writes
  resolve through PostgreSQL transactions without lost updates.
- **Must not:** use JSON-file storage or silently reset records in production.
- **Verification:** PostgreSQL integration tests, migration test, concurrent-write test, restart smoke
  test using Docker Compose.
- **Priority:** Required

### AC-002: Account lifecycle and authorization

- **Scenario:** an invited person registers, verifies email, signs in, resets a password, and creates
  an operator API token.
- **Action:** use valid and invalid, expired, replayed and revoked lifecycle tokens; attempt sponsor,
  operator and admin actions from the wrong account.
- **Expected:** only valid, unexpired, single-use tokens grant the intended transition; every protected
  action enforces role and resource ownership server-side.
- **Must not:** expose whether an uninvited email exists, store raw passwords/tokens, or allow an
  unverified account to publish, submit or settle.
- **Verification:** unit and HTTP integration tests plus E2E invitation/recovery journey.
- **Priority:** Required

### AC-003: Marketplace discovery and submission privacy

- **Scenario:** a verified operator with a matching capability searches published tasks and submits
  one artifact within its reservation and attempt limits.
- **Action:** reserve, submit, repeat, exceed limits, and view the task as sponsor, operator and
  unrelated account.
- **Expected:** compatible published tasks are discoverable; duplicate, expired, out-of-scope and
  unauthorized submissions are rejected; artifacts remain private to the sponsor and submitting
  operator until the published review policy permits disclosure.
- **Verification:** API contract tests, authorization matrix tests and desktop/mobile E2E journey.
- **Priority:** Required

### AC-004: Durable bounded verification

- **Scenario:** a valid pinned public repository submission enters verification.
- **Action:** enqueue, claim, execute, timeout, retry and permanently fail the job.
- **Expected:** job state, attempt count, worker version, hashes, stdout/stderr limits, resource
  limits and evidence are recorded; retries are idempotent; candidate code runs only in a disposable
  non-root container with no network and no application secrets.
- **Must not:** fetch moving branches, execute repository code in the web process, run arbitrary shell
  commands supplied by a submission, or claim a benchmark when compilation/execution failed.
- **Verification:** worker policy tests, container smoke tests, timeout/output-cap tests and integration
  replay against a public fixture.
- **Priority:** Required

### AC-005: Review, scoring and challenge

- **Scenario:** several submissions complete verification for a published task.
- **Action:** compare evidence, apply declared eligibility/ranking rules, accept/reject, open a challenge
  and resolve it.
- **Expected:** objective checks and score are reproducible from an immutable task manifest; subjective
  review is explicitly marked human; only one final winner can be selected; challenge transitions are
  bounded and audited.
- **Verification:** ranking/review state-machine tests and E2E sponsor/operator review journey.
- **Priority:** Required

### AC-006: Base Sepolia escrow

- **Scenario:** a sponsor connects through WalletConnect, creates a task escrow, deposits the configured
  ERC-20 test token, and later confirms a verified winner.
- **Action:** exercise deposit, release after the 48-hour challenge, challenge, refund/cancel, duplicate
  event delivery, reorg/confirmation handling and wrong-task/policy hashes.
- **Expected:** the contract enforces immutable task/policy hashes, token accounting, role-authorized
  state transitions, challenge expiry and one-time settlement; the reconciler is idempotent.
- **Must not:** treat testnet tokens as production payment, custody private keys in the app, release
  before required review/challenge conditions, or settle twice.
- **Verification:** Foundry unit/fuzz/invariant tests, local Anvil integration tests, viem event-replay
  tests and browser wallet flow on a safe test account.
- **Priority:** Required

### AC-007: Deployment and recovery

- **Scenario:** an operator deploys from a clean checkout to a Docker/VPS host.
- **Action:** start database, migrate, start web and worker services, exercise readiness, back up,
  restore to a new database, roll back the app image and rotate secrets.
- **Expected:** deployment fails fast for missing production settings; health distinguishes process
  liveness from database/worker readiness; backups are encrypted/private and restore verification is
  documented; logs are structured and redact credentials, tokens and source artifacts.
- **Verification:** Docker Compose smoke test, migration/rollback check, backup restore drill and
  manual operational review.
- **Priority:** Required

## Explicit non-goals for this release

- Mainnet funds, production payment claims or custody of user funds.
- Private repository access before a separate GitHub App/security review.
- Autonomous production merges, deployments or contract upgrades.
- Claiming that finite tests establish complete behavioral equivalence or security.
