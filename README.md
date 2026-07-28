# tequity-infra

Pulumi (TypeScript) in-cluster platform for Tequity. Cloud-agnostic: it targets
whatever kube context is configured (kind locally, GKE optionally) and deploys,
in order:

1. **Policy** — Kyverno + restricted Pod Security on the app namespace.
2. **Dependencies** — Postgres, Redis, optional shared Vault, Temporal.
3. **Observability** — kube-prometheus-stack (Prometheus/Grafana) + OTel Collector.
4. **Secrets** — External Secrets Operator + a ClusterSecretStore on the project Vault.
5. **Connector database boundary** — a dedicated RLS runtime role and Vault-backed Secret.
6. **Lead cursor keyring** — API-only Vault IAM + a dedicated ExternalSecret.

All chart versions are pinned in `src/config.ts` (overridable per stack).

The legacy shared Vault path is disabled by default, including for local
development. Its verified-TLS migration and rollback contract is recorded in
`docs/decisions/0002-shared-vault-verified-tls/README.md`.
Disabled stacks deploy neither Vault nor the shared store. Before adopting this
program on a stack that already manages Vault, configure `bootstrap` and its
trust references so the protected release is updated in place rather than
planned for removal.

## Shared Vault verified-TLS migration

Do not place certificate bytes, private keys, Vault tokens, or application
secrets in Pulumi config. Provision a TLS Secret in the application namespace
and a public CA ConfigMap that External Secrets can read. The certificate must
cover `vault.<application namespace>`.

Bootstrap configuration references only those existing objects:

- `tequity-infra:sharedVaultTlsStage=bootstrap`
- `tequity-infra:sharedVaultTlsSecretName`
- `tequity-infra:sharedVaultTlsCertKey` (defaults to `tls.crt`)
- `tequity-infra:sharedVaultTlsPrivateKeyKey` (defaults to `tls.key`)
- `tequity-infra:sharedVaultCaConfigMapName`
- `tequity-infra:sharedVaultCaConfigMapKey`

Before applying bootstrap to an existing stack, refresh state and confirm the
managed `vault` release remains present. Review the preview for a TLS-only
listener, chart-wide HTTPS service/client settings, CA-mounted health checks,
and no store. Verify the served chain and hostname from the
`external-secrets` namespace, and inventory every live `ExternalSecret` that
names `tequity-vault`.

Record the key-material-free inventory and TLS results as a comment on infra
issue #10. Then set `tequity-infra:sharedVaultTlsStage=delivery` and
`tequity-infra:sharedVaultTlsReceipt` to that exact comment URL. Delivery adds
the HTTPS store with the reviewed CA reference. If any sync or workload check
fails, return to `bootstrap`; this removes the store and fails closed without
deleting the protected Vault release. Plaintext and TLS-verification bypasses
are unsupported.

```bash
npm ci
npm run scan:secrets # deterministic tracked-file policy; no installer/network
npm run build      # tsc --noEmit
npm test           # version-pinning guard (no cloud)
npm run preview:offline # Pulumi mocks; no Kubernetes/Vault connection
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

## Lead cursor keyring

The cursor keyring contract is recorded in
`docs/decisions/0001-api-only-lead-cursor-keyring/README.md`. Pulumi manages
only the Vault read policy, Kubernetes-auth role, API service account, and
External Secrets references. It does not receive the value stored at
the dedicated `tequity-api-leads-cursor/keyring` KV-v2 mount and path. The
separate mount prevents the existing shared `secret/` role from becoming an
alternate read path.

The Vault endpoint must be an approved HTTPS origin. Configure its URL, a
local CA-certificate file path for the Pulumi Vault provider, and the
ConfigMap/key reference containing the same public CA for External Secrets:

- `tequity-infra:leadCursorVaultServer`
- `tequity-infra:leadCursorVaultCaCertFile`
- `tequity-infra:leadCursorVaultCaConfigMapName`
- `tequity-infra:leadCursorVaultCaConfigMapKey`

Pulumi stores those trust references, never certificate private keys or Vault
tokens. Supply the operator token only through the approved ephemeral
environment. TLS verification is mandatory. The CA file and ConfigMap must be
provisioned and reviewed outside this stack before bootstrap.

### Staged bootstrap and delivery

Do not switch directly from `disabled` to `delivery`. Every preview and apply
below remains subject to the sensitive hold and a separate operator approval.

#### Stage 1 — protected bootstrap

1. If the dedicated mount already exists, import it into the
   `lead-cursor-keyring-mount` Pulumi resource before any update. Never create a
   second mount or disable the existing one.
2. Set `tequity-infra:leadCursorKeyringStage=bootstrap` plus the approved TLS
   references. Review a preview that contains only the explicit Vault provider,
   retained/protected mount, exact-path policy, auth role, and API service
   account. It must contain no SecretStore, ExternalSecret, or secret value.
3. Apply only after the approved review, then verify the mount, role, audit
   device, TLS chain, and Pulumi protection flags. If any check fails, remain
   in `bootstrap`; do not switch to `disabled` or delete the mount.

#### Stage 2 — audited operator write

Write a valid `LEADS_CURSOR_KEYS_JSON` field through the audited Vault
secret-management workflow over the approved HTTPS endpoint. The record has
one active id and one to four unique entries matching the API contract. Never
place the JSON in Pulumi config, shell arguments, files, logs, Kubernetes
manifests, issue comments, or CI. Verify only the version metadata and audit
receipt. On failure, restore the prior Vault version or remain at bootstrap;
Pulumi never reads or writes the value.

Record a key-material-free checkpoint comment on infra issue #5. Delivery
requires its exact URL in `tequity-infra:leadCursorBootstrapReceipt`.

#### Stage 3 — delivery

Set `tequity-infra:leadCursorKeyringStage=delivery` only after Stage 1 state
and the Stage 2 receipt exist. The reviewed preview must add only the trusted
SecretStore and ExternalSecret. Verify sync and API boot/readiness before Helm
or UI promotion. If delivery fails, return to `bootstrap`; the orphaned target
Secret and protected Vault history remain available for controlled recovery.
Do not expose the Secret to another workload.

Helm must use service account `tequity-api` and mount only
`tequity-api-leads-cursor` into the API. UI and worker workloads must not
reference that service account or Secret.

### Rotation

1. Add the new key to the existing Vault record and make its id the active key;
   retain all unexpired verification keys and keep the keyring within four
   unique entries.
2. Commit the new Vault version through the approved audited workflow. Wait for
   the ExternalSecret refresh, then roll and verify API boot/readiness.
3. Keep every retired verification key for at least the longest cursor TTL that
   was configured while it signed cursors.
4. Remove a retired key only in a later audited deployment after that retention
   window. Roll back to the prior Vault version if the new API rollout fails.

Emergency compromise may remove the affected key immediately after incident
authorization. This intentionally invalidates outstanding cursors; record the
incident, key id, operator, time, and affected rollout without recording key
material.

### Explicit decommission

Changing the stage to `disabled` is not a decommission mechanism: protected
bootstrap resources make that update fail before deletion. Decommission
requires a dedicated approved issue and change window. First return to
`bootstrap`, stop all consumers, wait beyond the longest cursor TTL, archive
the Vault version/audit metadata without values, and verify the orphaned
Kubernetes Secret has no consumers. Then explicitly unprotect and remove the
role, policy, and service account through a reviewed Pulumi update. The mount
uses retain-on-delete, so removing it from Pulumi state does not disable the
engine or erase history. Disabling the retained Vault mount is a final,
separate destructive operator action requiring explicit approval and a Vault
audit record.
