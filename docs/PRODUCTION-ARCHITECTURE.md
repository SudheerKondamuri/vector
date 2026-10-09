# Vector production architecture

## Runtime topology

```text
Internet
  │ HTTPS reverse proxy / TLS
  ▼
Next.js web + API  ─────── PostgreSQL
  │                         │
  │ enqueue verification   │ durable task/job/audit state
  ▼                         │
Verification worker ────────┘
  │
  ├─ public repository fetch at pinned commit
  └─ disposable non-root Docker/Foundry execution, no network

Browser ── WalletConnect ── Base Sepolia escrow contract
                              ▲
                         event reconciler
```

## Storage rules

Production uses PostgreSQL only. The existing JSON store remains an explicitly selected isolated
test/development adapter so the deterministic fixture tests do not require a database. Production
startup must reject missing `DATABASE_URL`, weak `SESSION_SECRET`, non-HTTPS `VECTOR_APP_ORIGIN`, or
an attempt to select JSON storage.

The database migration surface is versioned and must run before the web or worker readiness check
passes. Every write that changes task, submission, review, job or settlement state is transactional
and emits an audit event in the same transaction.

## Trust boundaries

- Browser input, repository contents, patches, logs and operator reports are untrusted.
- The web process validates data and schedules work; it does not execute submitted repository code.
- The worker receives a signed/bounded job payload and a clean fixture, runs as non-root, has no
  application secrets and has network disabled for code execution.
- Public repository fetching is separated from candidate execution and pinned to an exact commit.
- Testnet contracts are settlement mechanics only; off-chain evidence and sponsor review remain the
  decision authority.

The worker host must treat the Docker socket as a privileged control boundary. It is never mounted
into the web service. The verifier image is configured by immutable digest, has a fixed entrypoint
and no user-supplied command, and the worker applies `--network=none`, drops capabilities, disables
privilege escalation, caps CPU/memory/PIDs, mounts the source read-only and caps output. This is a
bounded worker control, not a substitute for a separately hardened host or microVM isolation review.

## Release gates

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run test:coverage`
5. `npm run build`
6. Foundry contract tests and invariants
7. Docker Compose migration/readiness/backup smoke test
8. Playwright critical journeys against an isolated deployment
9. Production configuration validation with synthetic values only
