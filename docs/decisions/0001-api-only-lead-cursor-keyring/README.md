# ADR-0001: API-only lead cursor keyring

- Status: Proposed
- Date: 2026-07-27
- Issue: [tequity-infra#5](https://github.com/tequityapp/tequity-infra/issues/5)
- Platform contract: [tequity-platform#59](https://github.com/tequityapp/tequity-platform/issues/59)
- API contract: [tequity-api#155](https://github.com/tequityapp/tequity-api/pull/155)

## Context

Production lead cursors require a rotating HMAC keyring. Its bytes are sensitive
application credentials and must not pass through Git, Pulumi inputs/state,
previews, logs, stack outputs, Helm values, or CI artifacts. The API is the only
workload that signs or verifies cursors.

## Decision

Dedicated Vault KV v2 mount/path `tequity-api-leads-cursor/keyring` is the
source of truth. Isolating it from the shared `secret/` mount prevents the
legacy general-purpose Vault role from becoming an alternate read path. The
record has one field named `LEADS_CURSOR_KEYS_JSON`, validated by the API as
one active key id and one to four unique keys. Key material is written through
the approved Vault operator workflow, never through Pulumi.

Pulumi manages only:

- the dedicated hidden KV-v2 mount and a read-only Vault policy for its exact
  data path;
- a Vault Kubernetes-auth role bound to service account `tequity-api` in the
  configured application namespace, with no default policy and a ten-minute
  batch token;
- a namespaced External Secrets `SecretStore` using that identity; and
- an `ExternalSecret` that maps only `LEADS_CURSOR_KEYS_JSON` into the dedicated
  `tequity-api-leads-cursor` Kubernetes Secret.

Both Pulumi and External Secrets connect only to an approved HTTPS Vault
origin with certificate verification. Pulumi receives a reviewed CA file path;
External Secrets receives a ConfigMap/key CA reference. Neither certificate
private keys nor Vault tokens enter Pulumi inputs. The operator token is
ephemeral environment state.

The rollout uses explicit `disabled`, `bootstrap`, and `delivery` stages.
Bootstrap creates or imports the mount and then manages the protected IAM
boundary without creating a SecretStore. An audited operator writes the first
keyring directly to Vault and records a key-material-free issue #5 receipt.
Delivery requires that receipt and then adds the SecretStore and
ExternalSecret. A direct single-pass rollout is prohibited; its preview must
be rejected. Local development remains `disabled`.

The service account does not automount a token. External Secrets requests a
short-lived audience-bound token. UI and worker identities are not bound to the
Vault role and the keyring is never added to the shared `tequity-secrets`
Secret. Helm must mount the dedicated Secret only into the API pod.

The mount is protected, retained on delete, and never replaced before delete;
the policy, role, and API service account are also protected. Switching back to
`disabled` therefore fails closed instead of deleting the mount or stripping
IAM in a partial update. The ExternalSecret uses orphan ownership so a delivery
rollback does not delete the target Secret.

Rotation is additive: write a new Vault version containing the new active key
and all still-valid verification keys, wait for External Secrets and API
readiness, retain retired keys for at least the longest cursor TTL previously
configured, and remove them only in a later audited deployment. Vault version
history supports rollback. Emergency compromise may remove a key immediately;
that intentionally invalidates outstanding cursors and requires an incident
record.

## Consequences

Vault IAM changes require a sensitive human review before apply. Deployments
fail closed until the API service account, Vault role, source record, and
dedicated Helm secret reference all exist. Rotation never replaces or deletes
the Pulumi resources and does not expose key material to Pulumi.

Decommission is an explicit audited workflow, not a config rollback. Operators
first return to bootstrap, stop consumers, wait beyond the longest cursor TTL,
archive version/audit metadata without values, and verify no Secret consumers.
They then unprotect and remove IAM through a reviewed Pulumi update. The mount
is retained even when removed from Pulumi state. Disabling that retained mount,
which destroys its history, is a final separate destructive Vault action that
requires explicit human approval and audit evidence.
