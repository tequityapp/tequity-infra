## 2026-08-08 — Adopt @verjson/infra and declare the infrastructure spec

- Add `@verjson/infra@^0.18.3`, the org's reusable Pulumi ComponentResources, and declare
  tequity's per-environment requirements as an `InfrastructureSpecV1` validated by the module's
  own `validateInfrastructureSpec` — a versioned contract with a published JSON Schema, so a
  drifting spec fails the way a drifting entity fails `tequity-schema`.
- This repo was hand-rolling capabilities the module already owns. `@verjson/infra` ships
  `VerjsonObservability`, `VerjsonPostgres`, `VerjsonVault`, `VerjsonEventHub`, `VerjsonCluster`,
  `VerjsonSpacesBucket` and `VerjsonDigitalOceanDeployment`; of three verJSON infra repos only
  `catalog-infra` had adopted it, and at `^0.7.2` — eleven minors behind. `connector-database`
  and `lead-cursor-keyring` stay here: the module owns capabilities, this repo owns tequity's
  own invariants.
- `identity` is turned **on** against the `platform` profile's default. ADR-0022 makes
  `verjson-authn` the single public perimeter and reframes it from an in-process library into a
  deployed service, so it is infrastructure rather than an api dependency. `search` stays
  **off** — retrieval runs on pgvector and Apache AGE inside Postgres (ADR-0010), so an
  OpenSearch cluster would be unpatched attack surface rather than a spare.
- Prod's region and hostname are caller-supplied and the spec fails closed without them.
  ADR-0003 records that production already owns an authoritative Spaces bucket that must not be
  replaced from guessed inputs; `VerjsonDigitalOceanDeployment` implements exactly that as
  import-first adoption (`spacesBucketImportId`, `clusterImportId`, `vpcImportId`,
  `domainImportId`, `certificateImportId`). Tequity wrote the constraint and the module built the
  answer; this connects them.
- No resources are provisioned yet. This lands the dependency and the declaration so the DOKS
  bring-up is a reviewable diff against a validated spec rather than a first draft.
- Extend the canonical secretless Node contract to approve exactly the protected
  `@verjson/infra` lock entry. Pull-request and trusted-ref validation keep the same bounded
  script plan, and no other internal package is admitted.
