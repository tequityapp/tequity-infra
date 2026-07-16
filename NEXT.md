# NEXT — tequity-infra log

Running log of what landed and what's next in the platform infra (Pulumi TS: PG/Redis/Vault/Temporal,
observability stack, External Secrets). Newest entry first. The umbrella `tequity-platform/NEXT.md`
holds the cross-repo platform narrative; this file is infra-scoped.

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
