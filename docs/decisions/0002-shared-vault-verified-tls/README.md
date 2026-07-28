# ADR-0002: Verified TLS for the legacy shared Vault store

- Status: Proposed
- Date: 2026-07-28
- Issue: [tequity-infra#10](https://github.com/tequityapp/tequity-infra/issues/10)

## Context

The legacy cluster-wide `tequity-vault` store connected to the in-cluster
Vault service over plaintext HTTP. That trust boundary could expose shared
secret responses and Kubernetes-auth tokens to a compromised network path.
The dedicated lead-cursor store already requires independently reviewed HTTPS
and CA references; it is not a consumer of this shared store.

A repository-wide inventory on 2026-07-28 found no tracked `ExternalSecret`
whose `secretStoreRef` names `tequity-vault`. Operators must repeat the live
cluster inventory before cutover because untracked resources may exist.

## Decision

Local development and new stacks default the legacy shared Vault path to
`disabled`; local application secrets continue to use gitignored development
environment files. Disabled creates neither a Vault release nor a
ClusterSecretStore. Existing stacks must configure and preview `bootstrap`
before adopting this program version so their managed Vault release is updated
in place rather than removed. Enabling the shared path requires an explicit
staged configuration:

1. `bootstrap` deploys the protected Vault Helm release with a TLS-only listener.
   The certificate and private key come from an existing Kubernetes TLS Secret
   mounted read-only by the chart. Pulumi receives only the Secret name and data
   key names, never certificate or private-key bytes.
2. An operator verifies the served hostname and chain from the
   External Secrets namespace, inventories every live `ExternalSecret`, records
   the key-material-free results on issue #10, and supplies that exact comment
   URL as the delivery receipt.
3. `delivery` creates `tequity-vault` with an HTTPS URL and an explicit
   ConfigMap CA provider. The store depends on both the operator chart and the
   TLS Vault release.

The certificate must cover `vault.<application namespace>` and contain the
required intermediates. The CA ConfigMap contains only reviewed public trust
material and is provisioned outside this stack. Private keys, Vault tokens,
and secret values must never enter Pulumi config, state, previews, Git, CI
artifacts, or issue comments. No TLS-verification bypass is supported.

The Vault release is protected, retained on delete, and never deleted before
replacement. Existing managed releases must remain in state during adoption;
review a refresh and preview before applying `bootstrap`.

## Migration and rollback

Before bootstrap, inventory all live consumers with their namespace, remote
path, target Secret, owner, and readiness check. Pause writes or deployments
that depend on the shared store. Verify the TLS Secret and CA ConfigMap are
present, public certificate data matches, the certificate covers the service
DNS name, and no private key is present in the ConfigMap.

Apply `bootstrap` first. This deliberately omits the ClusterSecretStore, so a
consumer cannot silently fall back to plaintext while TLS is being verified.
After the issue #10 receipt is reviewed, preview and apply `delivery`, then
verify store readiness, every inventoried sync, and every workload readiness
check.

If delivery or a consumer check fails, return to `bootstrap`. That removes the
store and fails closed while retaining the protected Vault release and its
storage. Restore the prior certificate Secret version if the TLS listener
itself fails, then re-verify before attempting delivery. Never roll back to
HTTP or introduce `skipTlsVerify`.

Changing an existing deployed stack to `disabled` is a decommission request:
it removes the store and attempts to remove the protected Vault release.
Protection makes that deletion fail. Decommission requires a separate approved
issue, consumer
inventory proving zero users, a backup and restore test, explicit unprotection,
and a reviewed maintenance window.

## Consequences

The shared store cannot exist without verified TLS and an auditable cutover
receipt. Bootstrap temporarily makes legacy consumers unavailable by design,
so operators must schedule migration from the live inventory. Certificate
issuance and rotation remain an external responsibility; rotation updates the
existing Secret, verifies the listener and store, and retains the previous
version for rollback without changing Pulumi inputs.
