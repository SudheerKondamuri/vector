# Vector operations runbook

## Backup

Backups are encrypted locally before they leave the host. Keep the passphrase in a secret manager;
do not place it in the repository or a checked-in `.env` file.

```bash
DATABASE_URL='postgresql://…' \
VECTOR_BACKUP_PASSPHRASE='from-secret-manager' \
VECTOR_BACKUP_DIR='/srv/vector/backups' \
npm run backup
```

The command writes a mode-0600 `vector-*.dump.enc` file and never prints the database URL or
passphrase. Copy the encrypted file to private durable storage with a retention policy.

## Restore drill

Restore into a new PostgreSQL database, never over the active database during a drill:

```bash
VECTOR_BACKUP_FILE='/srv/vector/backups/vector-…dump.enc' \
VECTOR_RESTORE_DATABASE_URL='postgresql://…/vector_restore' \
VECTOR_BACKUP_PASSPHRASE='from-secret-manager' \
VECTOR_RESTORE_CONFIRM=RESTORE_VECTOR \
npm run restore
```

Run migrations/readiness against the restored database, sign in with a test account, open a task,
verify that audit events and escrow records remain present, and record the restore duration. Rotate
the backup passphrase if it was exposed during the drill.

## Deployment checks

1. Run migrations before starting web and worker services.
2. Confirm `/api/health` returns process liveness and `/api/ready` returns database and worker readiness.
3. Confirm the worker has a fresh heartbeat and the Base Sepolia reconciler has RPC, contract, start-block,
   confirmation, and overlap settings.
4. Confirm `VERIFIER_IMAGE` is an immutable digest and `NEXT_PUBLIC_*` settlement values were supplied
   as Docker build arguments.
5. Exercise one reference task in staging before accepting real invited work.

## Secret rotation

Rotate `SESSION_SECRET`, `WORKER_AUTH_SECRET`, SMTP credentials, WalletConnect credentials, and RPC
credentials through a staged deployment. Session-secret rotation intentionally invalidates existing
sessions; API tokens remain separately revocable and should be rotated when worker/tool credentials
change.
