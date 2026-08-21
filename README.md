# tequity-infra

Pulumi (TypeScript) in-cluster platform for Tequity. It manages exactly two
cloud environments, `nonprod` and `prod`, and targets the Kubernetes context
configured for the selected cloud stack. It deploys, in order:

1. **Policy** — Kyverno + restricted Pod Security on the app namespace.
2. **Dependencies** — Postgres, Redis, optional shared Vault, Temporal.
3. **Observability** — kube-prometheus-stack (Prometheus/Grafana) + OTel Collector.
4. **Secrets** — External Secrets Operator + a ClusterSecretStore on the project Vault.
5. **Connector database boundary** — a dedicated RLS runtime role and Vault-backed Secret.
6. **Lead cursor keyring** — API-only Vault IAM + a dedicated ExternalSecret.

All chart versions are pinned in `src/config.ts` (overridable per stack).

## Environment operating model

The Pulumi Cloud stacks are:

- `tequity/tequity-infra/nonprod`
- `tequity/tequity-infra/prod`

The Pulumi ESC environments are `tequity/shared`, `tequity/nonprod`, and
`tequity/prod`. Each cloud stack imports `tequity/shared` first and its matching
environment second, so environment-specific values override shared defaults.
ESC supplies cloud configuration and secrets to Pulumi deployments; it does
not create, read, or manage developer `.env` files.

There is no local Pulumi stack. From the platform repository root, local
infrastructure starts with:

```bash
docker compose up
```

Docker Compose owns disposable developer dependencies and local verification.
MinIO is the local S3-compatible object-storage implementation. Its credentials
remain developer-oriented and disposable in local environment files or Compose
defaults. Starting Compose must not require Pulumi Cloud or ESC authentication.
An optional, explicit secret-export helper may be added later, but cannot become
a prerequisite for local startup.

The `nonprod` stack owns cloud integration and deployment testing. It defaults
to dedicated stateful resources, credentials, namespaces, and explicit
environment-qualified names. A foundational resource may be shared only after
its isolation, access-control, quota, lifecycle, and failure-domain behavior
are documented and reviewed. Convenience or cost alone is not evidence that a
stateful resource is safe to share.

The `prod` stack owns production resources. Before its first update, inventory
the live environment, identify authoritative resource IDs and settings, and
import existing resources into `tequity/tequity-infra/prod`. This includes the
current DigitalOcean Spaces bucket. Refresh and preview the imported state, and
resolve every replacement or deletion before allowing an update. Do not create
or rename production resources from inferred configuration.

Promote reviewed code, not state:

1. Preview and apply the reviewed revision to `nonprod`.
2. Run integration probes against its deployed endpoints and stateful services.
3. Select `prod` and run a separate preview with the production ESC composition.
4. Review the production diff and apply that same revision after approval.

Never copy Pulumi state, stack exports, or a stack snapshot from `nonprod` to
`prod`. Each stack has independent state and environment-specific
configuration. ADR-0003 records the complete boundary, sharing criteria,
production adoption gate, and rollback expectations.

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

## Identity deployment profile

Nonprod and production declare separate normalized Tequity identity profiles.
Each trusts only its exact Tequity issuer, API audience, and JWKS URL; allows
RS256 only; and references an environment-specific Vault signing key without
placing private material in Pulumi inputs, outputs, previews, or state.

The initial operator is selected only by immutable Tequity subject. All six
platform permissions require `acr=mfa` with `auth_time` no older than 300
seconds. Google and Entra are upstream authentication providers whose
identities resolve through the stable Tequity subject registry. Resource
servers never authorize raw provider claims.

For `nonprod` and `prod`, ESC must supply the non-secret
`googleOidcClientId`, `entraOidcClientId`, and tenant-specific
`entraOidcIssuerUrl` Pulumi configuration. Provider secrets and signing keys
remain behind exact environment-specific Vault references declared in
`src/identity.ts`.

Local Docker Compose does not depend on Pulumi or ESC. Cloud preview and apply
remain separate from credential-free validation. Production apply requires a
separate explicit human security approval.

### Platform exact-permission claim allowlist

`src/platform-permissions.ts` is the authoritative allowlist for platform-only exact
permission claims, and the identity profile is **derived** from it — a population added
or widened there cannot reach a deployment without passing its assertions
(tequity-docs ADR-0055).

Three operator populations exist. Only one, `security-control-operator`, may hold
`lead:provenance:read` and `lead:provenance:erase`; `platform-operator` and
`platform-read-only-operator` may not, and construction fails if either is widened to
include them. A population that is not declared — a tenant role, a tenant owner, an
unrecognized id — resolves to no permissions at all rather than to a default.

Only this environment's own Tequity issuer may mint a platform claim. An upstream
federated assertion (Google, Entra) is exchanged at that issuer first and never carries
platform claims directly; the other environment's issuer, a lookalike host, and a
wildcard origin all resolve to nothing. An issuer is accepted only as an exact canonical
https origin: a trailing slash, an explicit port, an uppercase host, a percent-encoded
label, or a path is rejected rather than normalized, so any shape the parser cannot fully
model fails closed.

Provenance additionally requires `acr=mfa` with `auth_time` no older than 300 seconds.
A session that fails step-up keeps the rest of its profile and loses only provenance:
step-up gates the two provenance permissions, not platform access as a whole.

**Rotation.** The allowlist is code and rotates through a reviewed pull request, never
through a console. Adding an operator to the security-control population is a change to
`operatorProfiles` in `src/identity.ts`; adding a population is a change to
`src/platform-permissions.ts`. Both are covered by
`test/platform-permission-allowlist.test.ts`, which fails if a non-designated population
gains provenance. Signing keys rotate independently through the Vault references above;
neither rotation exposes a token, because no token or credential is an input to, or an
output of, this module.

**Audit.** `permissionCatalog.operatorPermissionProfiles` publishes the populations and
their exact permissions in every rendered profile, so a diff of a preview shows precisely
which population changed. `expect(JSON.stringify(allowlist)).not.toMatch(...)` holds the
structure free of secret-shaped material, so a preview is safe to attach to a review.

**Rollback.** Reverting the pull request restores the previous allowlist; there is no
out-of-band state to unwind, because nothing here is provisioned imperatively. A
provenance grant made in error is revoked by reverting the operator profile and
re-applying, and the operator's next token cannot carry the permission once the profile
no longer names the population.

**Deployment verification, without exposing tokens.** Run `npm test` and
`npm run preview:offline` — neither needs a credential. Against a stack, `pulumi preview`
shows the normalized profile; read `permissionCatalog` and `operatorProfiles` from the
preview diff. Do not decode, paste, or log an issued token to verify a claim: the
property that matters is which population the profile names, and that is visible in the
preview. Production apply remains gated on a separate explicit human security approval.

**Production enablement of the Platform Admin console stays blocked** until that approval
records verification against the prod stack. This repository can prove which populations
exist and who may hold provenance; it cannot prove the console's own gating, which lives
in `tequity-ui`/`tequity-api` (tequity-ui#25, tequity-ui#214).

## Cloud storage stacks

Local development uses Docker Compose and does not depend on Pulumi or ESC.
Cloud operations use only these fully qualified Pulumi stacks:

- `Tequity/tequity-infra/nonprod`, composing
  `tequity/shared` then `tequity/nonprod`
- `Tequity/tequity-infra/prod`, composing
  `tequity/shared` then `tequity/prod`

Nonprod declares the private, versioned `nyc3/tequity-nonprod` bucket with
exact CORS for `https://dev.tequity.app`. Production is declaration-only:
the existing protected `nyc3/tequity` bucket must be imported before any
preview or apply, and its exact origin is `https://tequity.app`.

Run credential-free validation independently:

```bash
npm run build
npm test
npm run scan:secrets
```

Do not run cloud preview or apply as part of validation. Nonprod preview and
apply require an approved deployment window and must stop on any deletion,
replacement, rename, production, Fandemic, or unrelated change. Production
import, preview, and apply require a separate explicit security approval.
Never place Spaces credentials or ESC ciphertext in Pulumi inputs, outputs,
state, source, tests, logs, or receipts.

Cluster creation is an opt-in provider module under `src/providers/`; the
in-cluster platform code is shared by both cloud stacks.

### Upload CORS evidence

tequity-infra#13 asks not for a CORS configuration but for **evidence** that the
production apply does what it claims. That evidence has two halves, and only one of
them can be produced without a credential.

**The offline half — `npm run preview:offline`, no credential.**
`test/storage-offline-preview.test.ts` runs the production stack through Pulumi's mock
runtime and asserts what a preview would show: both DigitalOcean resources register with
the concrete id `nyc3,tequity`, which is an **import** — Pulumi adopts the existing
authoritative bucket rather than planning a create — the bucket keeps
`acl: private`, `forceDestroy: false`, and versioning; the component is `protect`ed; the
CORS rule is exactly `PUT` from exactly `https://tequity.app` with exactly
`Content-Type` and `If-None-Match`; and **no third resource of any kind is registered**,
so the plan cannot touch anything unrelated. No wildcard appears anywhere in it.

**The live half — `scripts/spaces-cors-probe.sh`, credentialed, run once by an operator.**
It answers what an offline preview cannot: whether the endpoint actually behaves that way.

```bash
SPACES_KEY=... SPACES_SECRET=... bash scripts/spaces-cors-probe.sh
```

It proves four things and deletes what it created, including on an early failure:

1. a browser preflight from `https://tequity.app` is answered for `PUT` with
   `Content-Type` and `If-None-Match`, echoing that exact origin and not a wildcard;
2. a preflight from an unapproved origin is not answered;
3. a create-only conditional `PUT` (`If-None-Match: *`) succeeds on a fresh key;
4. the same `PUT` repeated returns `412` and a **signed** read-back shows the stored
   bytes unchanged — an unsigned read against a private bucket returns a `403` body,
   which would report a false change.

It is run by no workflow and by CI at no point, because it writes to the production
bucket. Credentials are read from the environment and never echoed; the transcript
carries request and response metadata only, and is what gets attached to the issue.

The probe gets exactly one attempt with a production credential, so its request signing
is pinned by golden vectors in `test/spaces-cors-probe.test.ts`. All four request shapes
were cross-checked against an independent SigV4 implementation (botocore 1.34.46) using
the public AWS example credentials, which authorize nothing; a change that alters the
canonical request breaks those vectors rather than surfacing as a misleading `403`
during the one credentialed session.

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
