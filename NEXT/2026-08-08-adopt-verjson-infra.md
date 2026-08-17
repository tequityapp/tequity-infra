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
- Pull-request and trusted-ref validation now use the immutable canonical Node contract at
  `58a82143d28bc84c163d3fed092d8d9425b91a62`. Its isolated acquisition lane may read only the
  protected `@verjson/infra` lock entry with the existing package-read secret; the consumer lane
  receives a bounded exact-attempt npm cache and runs Pulumi/unit/smoke/audit checks only after
  npm, Git, cloud, and OIDC credentials are scrubbed. No full `node_modules` artifact is handed
  across the boundary.

Adoption keeps the production dependency tree audit-clean by refreshing compatible patches for
`brace-expansion@5.0.9` and `js-yaml@4.3.1`, which resolve GHSA-rgw5-rvv9-x895 and
GHSA-5p4m-2wfm-xmqj; dependency smoke pins both safe versions and canonical CI runs the
production audit. Separately, `nanoid@3.3.16` is pre-existing **dev** debt via
`vitest → vite → postcss@8.5.24` — the same advisory `tequity-ui` cleared today by lifting postcss
to 8.5.26.
