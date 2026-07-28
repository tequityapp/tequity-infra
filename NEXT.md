# NEXT — tequity-infra log

Running log of what landed and what's next in the platform infra (Pulumi TS: PG/Redis/Vault/Temporal,
observability stack, External Secrets). Newest entry first. The umbrella `tequity-platform/NEXT.md`
holds the cross-repo platform narrative; this file is infra-scoped.

## 2026-07-27 — Proposed API-only lead cursor keyring boundary

Infra #5 now declares an isolated Vault KV v2 mount, exact-path read policy, and
Kubernetes-auth role bound only to the `tequity-api` service account. Keeping
the keyring outside the shared `secret/` mount prevents its broader legacy role
from becoming an alternate read path. A namespaced SecretStore syncs only
`LEADS_CURSOR_KEYS_JSON` into `tequity-api-leads-cursor`; UI, worker, the shared
Secret, Pulumi inputs/state/outputs, previews, and logs never receive the
keyring bytes.

Rotation adds a new active key while retaining verification keys for at least
the longest prior cursor TTL, then removes retired keys in a later audited Vault
version. Emergency removal is explicit and intentionally invalidates issued
cursors. The IAM decision remains Proposed and held for human security review;
this change performs no Vault write, provider apply, or live IAM mutation. An
explicit stack setting gates the resources and remains false for local
development.

Refs: [infra#5](https://github.com/tequityapp/tequity-infra/issues/5),
[platform#59](https://github.com/tequityapp/tequity-platform/issues/59),
[api#155](https://github.com/tequityapp/tequity-api/pull/155),
[helm#6](https://github.com/tequityapp/tequity-helm/issues/6).

## 2026-07-27 — Route validation to the labeled self-hosted CI pool

The actionlint and Pulumi validation jobs now target the portable `[self-hosted, ci]` pool adopted
by ADR-0039. Both use trusted-base `pull_request_target` definitions, reject forks before runner
assignment, check out an admitted same-repository PR by immutable head SHA, and disable checkout
credential persistence. Validation has explicit `contents: read` permissions and supplies no
private package or cloud credential. The committed lockfile makes `npm ci` deterministic and
runnable. Actionlint recognizes both approved organization runner labels.

Runner host provisioning is not present in this repository today. Infra issue
[infra#6](https://github.com/tequityapp/tequity-infra/issues/6) owns a versioned, attested baseline
that installs the missing GitHub CLI, Docker Compose v2 plugin, and PowerShell 7 without changing
live hosts in this migration. The former reusable Pulumi workflow could not disable its
credential-persisting checkout or separate validation from broader permissions, so its upstream
hardening is handed to
[Verjson/.github#151](https://github.com/Verjson/.github/issues/151). The lockfile's currently
unavoidable high-severity transitive audit findings are tracked in
[infra#7](https://github.com/tequityapp/tequity-infra/issues/7).

Refs: [tequity-platform#62](https://github.com/tequityapp/tequity-platform/issues/62),
[ADR-0039](https://github.com/tequityapp/tequity-docs/pull/28).

## 2026-07-21 — CI: adopt Verjson/.github pulumi-ci reusable + actionlint

`ci.yml` now calls `Verjson/.github/.github/workflows/pulumi-ci.yml@main` with a credential-free
`validate-command` (`npm run build` + `npm test`); the live `pulumi preview` self-skips when no cloud
secrets are present. Pins `runner: ["ubuntu-latest"]`. Adds `actionlint.yml` (standalone,
ubuntu-latest, pinned actionlint 1.7.7 + SHA256) linting `.github/workflows/**` on push/PR — Verjson's
`actionlint.yml` is not a `workflow_call` reusable and hard-codes the GCP pool, so it cannot be
consumed via `uses:`.

## 2026-07-16 — verJSON auth/observability packages: infra asks (see umbrella NEXT.md)

Infra provisions the substrate the shared packages run against — `src/observability.ts`,
`src/secrets.ts`, `src/dependencies.ts`, `src/config.ts`. As the packages consolidate auth + telemetry,
infra owns standing up the backing services and secret paths they assume.

- **`@verjson/observability`:** provision the **OTel collector** using the package's shared
  `collector-config` (rather than a bespoke config) and the **dashboards** it ships, so the platform's
  telemetry pipeline is the one the package expects (ADR-0009). Ensure the stack ingests the package's
  conventions — including **`genai-cost`** metrics — so LLM spend is observable and can feed the billing
  usage ledger (ADR-0016).
- **`@verjson/authn` / `@verjson/oidc-claims-middleware`:** provision / point at the **OIDC IdP + issuer**
  the front door and token-verification middleware depend on (tenant IdP + the service-principal issuer,
  ADR-0019/0020). Stand up the **Vault paths + External Secrets** for authn/session signing keys, and
  keep the service-principal credential material in the machine-identity path.
- **Alignment:** these back the config that `tequity-helm` surfaces as chart values — infra creates the
  issuer/collector/secret, helm wires the env, the service consumes the package. Keep the three in step.

Downstream adoption owned by `tequity-platform-pm`; upstream gaps (e.g. a collector-config the package
should ship) go as `from:tequity` issues on the package repo (never fork).
