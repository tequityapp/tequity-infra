# ADR-0004: Manage Tequity upload storage as a separable Spaces component

- Status: Proposed
- Date: 2026-08-02
- Issue: [tequity-infra#13](https://github.com/tequityapp/tequity-infra/issues/13)

## Context

Browser uploads require create-only S3 PUT requests against DigitalOcean
Spaces. The bucket policy must admit only the application origin and the two
headers required by the signed request. Storage lifecycle changes are
security-sensitive because replacing or deleting a bucket can lose data, and
because production already has an authoritative bucket.

The released `@verjson/infra` Spaces component manages the bucket independently
of DOKS, enforces private versioned storage, fixes CORS to `PUT` with
`Content-Type` and `If-None-Match`, disables force deletion, and requires
import-first protected production adoption.

## Decision

Use `@verjson/infra@0.14.1` without a Tequity wrapper. Nonprod declares
`nyc3/tequity-nonprod` for `https://dev.tequity.app`. Production declares the
existing `nyc3/tequity` bucket for `https://tequity.app`, with bucket import ID
`tequity`, CORS import ID `nyc3,tequity`, and component-enforced protection.
Its canonical endpoint is
`https://tequity.nyc3.digitaloceanspaces.com`.

The fully qualified stacks are `Tequity/tequity-infra/nonprod` and
`Tequity/tequity-infra/prod`. Their stack files compose
`tequity/shared` first and the matching `tequity/nonprod` or `tequity/prod`
ESC environment second. ESC may inject environment-specific data-plane credentials at runtime,
but secret values are never Pulumi inputs, outputs, source, tests, or receipts.

Credential-free compilation, mocks, and policy tests remain separate from
cloud preview and apply. The shared reusable Pulumi workflow is not adopted:
its live-preview admission requires GCP Workload Identity and cannot represent
the DigitalOcean/ESC trust contract.

## Rollout and rollback

Preview only `Tequity/tequity-infra/nonprod` first. Stop on deletion,
replacement, rename, production, Fandemic, or unrelated resources. Apply only
after owner approval is recorded. Then create a bucket-limited data-plane key,
prove conditional PUT succeeds once and returns 412 on collision without
changing the stored bytes, delete the probe object, and retain only
key-material-free receipts.

Production is declaration-only in this change. Do not import, refresh, preview,
or apply it until a separate security review authorizes adoption. Its first
operation must be import, followed by refresh and a preview showing no
replacement, deletion, rename, or unrelated change. Protection is not removed
for rollback; revert configuration and investigate state ownership instead.

## Consequences

Local Docker Compose remains independent of Pulumi and ESC. Nonprod and
production have distinct bucket identities and independently managed
credentials. Exact CORS and import/protection invariants are executable offline,
while all live mutations retain a human security gate.
