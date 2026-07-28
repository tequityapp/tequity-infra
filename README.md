# tequity-infra

Pulumi (TypeScript) in-cluster platform for Tequity. Cloud-agnostic: it targets
whatever kube context is configured (kind locally, GKE optionally) and deploys,
in order:

1. **Policy** — Kyverno + restricted Pod Security on the app namespace.
2. **Dependencies** — Postgres, Redis, Vault (per-project), Temporal.
3. **Observability** — kube-prometheus-stack (Prometheus/Grafana) + OTel Collector.
4. **Secrets** — External Secrets Operator + a ClusterSecretStore on the project Vault.
5. **Lead cursor keyring** — API-only Vault IAM + a dedicated ExternalSecret.

All chart versions are pinned in `src/config.ts` (overridable per stack).

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
