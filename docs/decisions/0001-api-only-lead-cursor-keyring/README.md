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

The resources are gated by the explicit
`tequity-infra:leadCursorKeyringEnabled` stack setting. Local development keeps
the setting false so it never needs a Vault operator token; an approved
deployment enables it and fails closed if Vault IAM or the source record is
absent.

The service account does not automount a token. External Secrets requests a
short-lived audience-bound token. UI and worker identities are not bound to the
Vault role and the keyring is never added to the shared `tequity-secrets`
Secret. Helm must mount the dedicated Secret only into the API pod.

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
