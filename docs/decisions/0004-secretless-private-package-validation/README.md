# ADR-0004: Use canonical secretless validation for private packages

## Status

Accepted

## Context

Issue #27 replaces a `pull_request_target` workflow that checked out and ran
pull-request-controlled code on self-hosted runners. Issue #17 also records the
cross-organization package boundary that becomes active when `@verjson/infra`
is introduced. A package credential must never share an execution boundary with
repository lifecycle, build, or test code.

## Decision

Use the canonical reusable Node workflow from `Verjson/.github`, pinned at
`58a82143d28bc84c163d3fed092d8d9425b91a62`, for both pull-request and trusted-ref
validation. The caller grants package-read permission and maps only the existing
organization `NODE_AUTH_TOKEN`. The current protected repository policy permits
the `@verjson` scope and no packages because the main lock has no internal
dependencies. Adding one requires an explicit caller and protected-policy change.

The canonical acquisition lane validates the lock and protected policy before
using the token. It transfers only a bounded, identity-bound npm content cache.
The consumer lane installs with lifecycle scripts disabled, scrubs npm, Git,
cloud, and OIDC credentials, and only then runs the repository's reviewed
validation script plan. Pull requests use `pull_request`; trusted pushes and
explicit dispatches use a separate trusted-ref invocation with the same policy
and script plan.

## Consequences

- Pull-request code never receives package credentials or ambient runner npm
  configuration.
- The empty current allowlist makes tokened package network requests unnecessary
  and fails closed if an internal dependency appears without review.
- Missing authorization, policy mismatch, cache mismatch, or credential scrub
  failure stops validation before consumer code executes.
- The handoff does not upload a complete `node_modules` artifact.
- Build, unit, dependency-smoke, secret-scan, offline-preview, Vault-render, and
  production-audit checks run in both event lanes.
