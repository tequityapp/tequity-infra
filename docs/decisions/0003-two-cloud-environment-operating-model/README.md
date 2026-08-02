# ADR-0003: Two cloud environments with local Compose isolation

- Status: Proposed
- Date: 2026-07-30

## Context

Tequity needs repeatable cloud integration testing and independently governed
production infrastructure without coupling developer onboarding to Pulumi
Cloud. A local Pulumi stack would duplicate Docker Compose, introduce remote
authentication into offline workflows, and blur ownership of disposable
developer services. Production already has authoritative resources, including
a DigitalOcean Spaces bucket, that must not be replaced from guessed inputs.

## Decision

Pulumi manages exactly two cloud environments:

| Responsibility | Owner |
| --- | --- |
| Disposable developer infrastructure and local verification | Docker Compose |
| Cloud integration and deployment testing | `tequity/tequity-infra/nonprod` |
| Production resources | `tequity/tequity-infra/prod` |
| Cloud stack configuration and secrets | Pulumi ESC |

Local development runs `docker compose up` and uses MinIO as its S3-compatible
object-storage implementation. Local `.env` files and Compose credentials are
developer-oriented and disposable. Compose has no required Pulumi Cloud or ESC
authentication path. A future opt-in export helper may improve convenience but
must preserve an offline, self-contained default.

Cloud stacks compose ESC environments in this order:

- `nonprod`: `tequity/shared`, then `tequity/nonprod`
- `prod`: `tequity/shared`, then `tequity/prod`

Only non-secret defaults that are genuinely invariant belong in
`tequity/shared`. Credentials, provider targets, resource IDs, capacity,
retention, and other environment-specific values belong in the matching
environment. ESC does not own local `.env` files.

Nonprod defaults to dedicated stateful services and explicit
environment-qualified names. Sharing a foundational resource requires evidence
of tenant isolation, least-privilege access, independent lifecycle and backup,
adequate quotas, bounded failure impact, and cost or operational benefit.
Stateful stores, buckets, databases, queues, encryption keys, and secret stores
remain dedicated unless all criteria are documented. A shared control-plane or
other stateless foundation may be considered when it cannot expose, delete,
throttle, or couple production data and deployments.

Production adoption is discovery-first. Operators inventory live resources and
record authoritative provider IDs, regions, names, policies, retention,
encryption, ownership, and dependency relationships. They import each existing
resource into the production stack, including the current DigitalOcean Spaces
bucket, then refresh and preview. Any proposed replacement, deletion, rename,
or material policy change blocks the first update until reconciled. Missing
information is not permission to create a replacement.

Promotion deploys the same reviewed source revision independently. Operators
preview and apply it in nonprod, run integration probes, then select prod and
run a fresh preview using production configuration. Pulumi state, exports, and
snapshots are never copied or promoted between stacks.

## Verification and rollback

Nonprod verification covers workload readiness, connectivity, object-storage
read/write/delete behavior, secret synchronization, migrations, observability,
and policy enforcement. Production preview is a distinct approval artifact and
must be checked for destructive or replacement operations.

A failed nonprod deployment is rolled back or corrected only in nonprod. A
failed production deployment uses the production stack's own state and the
reviewed resource-specific recovery plan. Restoring a nonprod snapshot into
prod is prohibited.

## Consequences

Developers retain fast offline onboarding, while cloud behavior is exercised in
nonprod. Dedicated stateful resources cost more but make ownership, cleanup,
security, and failure isolation explicit. Production onboarding requires an
inventory and import phase before Pulumi may become authoritative; this delay is
intentional protection against destructive assumptions.
