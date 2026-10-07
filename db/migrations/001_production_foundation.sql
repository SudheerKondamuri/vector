CREATE TABLE IF NOT EXISTS vector_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vector_pilot_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO vector_pilot_state (id, version, payload)
VALUES (1, 1, '{"version":1,"users":[],"sessions":[],"apiTokens":[],"reservations":[],"attempts":[],"invitations":[],"outbox":[],"profiles":[],"jobs":[],"challenges":[],"escrows":[],"escrowEvents":[],"tasks":[],"submissions":[],"events":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vector_worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS vector_worker_heartbeats_last_seen_idx
  ON vector_worker_heartbeats (last_seen_at);

CREATE TABLE IF NOT EXISTS vector_marketplace_profiles (
  user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  adapter_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'paused', 'hidden')),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  challenged_count INTEGER NOT NULL DEFAULT 0 CHECK (challenged_count >= 0),
  challenge_failures INTEGER NOT NULL DEFAULT 0 CHECK (challenge_failures >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vector_task_reservations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, operator_id)
);

CREATE INDEX IF NOT EXISTS vector_task_reservations_active_idx
  ON vector_task_reservations (task_id, expires_at) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS vector_api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS vector_api_tokens_user_idx ON vector_api_tokens (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS vector_verification_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  submission_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vector_verification_jobs_claim_idx
  ON vector_verification_jobs (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS vector_review_challenges (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  challenger_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  resolution TEXT CHECK (resolution IN ('uphold', 'dismiss')),
  resolution_reason TEXT,
  resolver_id TEXT,
  resolver_name TEXT,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS vector_review_challenges_submission_idx ON vector_review_challenges (submission_id, status);

CREATE TABLE IF NOT EXISTS vector_escrows (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  sponsor_address TEXT NOT NULL,
  operator_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  amount_atomic NUMERIC(78, 0) NOT NULL,
  chain_id BIGINT NOT NULL,
  task_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  challenge_period_seconds INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('intent', 'funded', 'release-pending', 'challenged', 'released', 'refunded', 'cancelled')),
  onchain_escrow_id NUMERIC(78, 0),
  funding_tx_hash TEXT,
  release_tx_hash TEXT,
  challenge_tx_hash TEXT,
  settlement_tx_hash TEXT,
  challenge_ends_at TIMESTAMPTZ,
  last_event_block NUMERIC(78, 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS vector_escrows_task_idx ON vector_escrows (task_id, status);

CREATE TABLE IF NOT EXISTS vector_escrow_events (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS vector_audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
