## 2026-07-28 — Least-privilege connector database role + dedicated Secret

Infra now owns the Helm #3 deployment contract without putting credential
material in Pulumi: Vault KV `secret/tequity/connector-database` is synced by
ESO only to `tequity-connector-database`, which contains the worker's
`CONNECTOR_DATABASE_URL` plus the reconciler-only password key. No connector key
is added to global `tequity-secrets`.

An initial Job and five-minute CronJob idempotently create/harden the dedicated
`tequity_connector` login, remove memberships and prior grants, rotate its
password, grant only connector storage/audit/outbox operations, and assert
`NOSUPERUSER` + `NOBYPASSRLS` (plus the other no-privilege flags) in one
transaction. Migrations and DDL remain on the PostgreSQL admin role. The client
image is multi-architecture digest-pinned and the Pod satisfies the restricted
security profile.

Credential rotation is an explicit Vault operation over stdin, followed by ESO
and role reconciliation while the Helm connector flag is disabled. Policy tests
make unsafe role SQL fail before resource registration and prove generated
secret values cannot be serialized into resource arguments/source/log output.
Reconciliation also removes PUBLIC-derived database, schema, relation, column,
sequence, and function privileges before applying the exact allowlist, then
verifies effective privileges through PostgreSQL's `has_*_privilege` checks.
An offline Pulumi-mocks preview locks the registered resource graph and secret
references without contacting or mutating a provider.
Refs: #3, tequity-helm#3/#5, ADR-0010, ADR-0020, ADR-0033.
