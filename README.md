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

Before an approved deployment, a Vault operator writes a valid
`LEADS_CURSOR_KEYS_JSON` field through the audited secret-management workflow.
The record contains one `activeKid` and one to four unique `{kid, secret}`
entries matching the API contract. Do not place the JSON in Pulumi config,
shell arguments, files, logs, Kubernetes manifests, issue comments, or CI.
Run Pulumi with Vault provider authentication supplied by the operator
environment; never persist the Vault token in a stack config.
After the sensitive review is accepted, set
`tequity-infra:leadCursorKeyringEnabled=true` in the deployment stack. The
local development stack leaves it disabled so offline cluster bring-up never
requires operator Vault credentials.

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
