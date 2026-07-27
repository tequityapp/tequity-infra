# tequity-infra

Pulumi (TypeScript) in-cluster platform for Tequity. Cloud-agnostic: it targets
whatever kube context is configured (kind locally, GKE optionally) and deploys,
in order:

1. **Policy** — Kyverno + restricted Pod Security on the app namespace.
2. **Dependencies** — Postgres, Redis, Vault (per-project), Temporal.
3. **Observability** — kube-prometheus-stack (Prometheus/Grafana) + OTel Collector.
4. **Secrets** — External Secrets Operator + a ClusterSecretStore on the project Vault.
5. **Connector database boundary** — a dedicated RLS runtime role and Vault-backed Secret.

All chart versions are pinned in `src/config.ts` (overridable per stack).

```bash
npm ci
npm run build      # tsc --noEmit
npm test           # version-pinning guard (no cloud)
npm run preview    # pulumi preview (needs a stack + kube context)
```

Cluster creation is an opt-in provider module under `src/providers/`; the
in-cluster platform above is identical everywhere.

## Connector database bootstrap

The cloud-storage connector uses the dedicated PostgreSQL role
`tequity_connector`. It is always reconciled as:

- `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`;
- no role memberships;
- `CONNECT` on the application database and `USAGE` on `public`;
- CRUD on `storage_connection` and `storage_token`;
- SELECT/INSERT on append-only `audit_event`;
- INSERT on `outbox`;
- no privileges on other public tables, sequences, or functions.

The admin credential remains owned by the PostgreSQL chart and is used only by
the bootstrap/reconcile Job. Application migrations still run as admin and own
DDL; the connector role cannot create databases, roles, schemas, or tables.
`src/connector-database.ts` validates these invariants while the Pulumi program
is evaluated, so an unsafe flag fails preview before resources are registered.

Vault KV v2 at `secret/tequity/connector-database` is the credential source of
truth. Pulumi stores only that path and Kubernetes Secret references. It never
generates, receives, serializes, or logs the password. External Secrets creates
only the dedicated `tequity-connector-database` runtime Secret; do not add
`CONNECTOR_DATABASE_URL` to the global `tequity-secrets` Secret.

Before the first deployment, authenticate the Vault CLI with create/update
access to that one KV path, review the operation, and write 32 random bytes as
lowercase hex directly over stdin:

```powershell
pwsh -File scripts/rotate-connector-database-password.ps1 -WhatIf
pwsh -File scripts/rotate-connector-database-password.ps1
```

Then run `pulumi preview` and `pulumi up`. The bootstrap Job waits for the
ExternalSecret and PostgreSQL admin Secret, creates or hardens the role
idempotently, rotates its password, revokes old privileges/memberships, grants
the allowlist, and verifies the unsafe flags are false in one transaction. A
five-minute CronJob continuously reconciles the same policy.

After `job/tequity-connector-role-bootstrap` succeeds, set
`worker.connectorDatabase.enabled=true` in the Helm release. Enabling earlier is
intentionally fail-closed.

### Rotation

1. Set the Helm connector flag to `false`; unrelated worker queues remain live.
2. Run the rotation script. It writes a new Vault KV version without placing
   the password in argv, a file, Pulumi state, or command output.
3. Force/wait for the ExternalSecret refresh, then wait for a successful
   `tequity-connector-role-reconcile` Job (or create one from the CronJob).
4. Re-enable the Helm connector flag.

The old Vault KV version supports controlled rollback. Roll it back, wait for
ESO + role reconciliation, and only then re-enable the connector. Never rotate
by editing a Kubernetes Secret or Pulumi config; Vault is authoritative.
