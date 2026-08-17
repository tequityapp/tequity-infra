# ADR-0004: Use canonical secretless validation for private packages

## Status

Accepted

## Context

Issues #17 and #26 require CI to consume private `@verjson` packages without
exposing a package credential to pull-request-controlled code. A direct
`pull_request_target` checkout followed by `npm ci` either depends on an ambient
self-hosted runner credential or places the mapped credential in the same job
that executes repository build and test code.

## Decision

Use the canonical reusable Node workflow from `Verjson/.github`, pinned at
`58a82143d28bc84c163d3fed092d8d9425b91a62`, for both pull-request and trusted-ref
validation. The caller grants package-read permission and maps only the existing
`NODE_AUTH_TOKEN` secret. A protected repository variable fixes the acquisition
policy to the `@verjson` scope and exact `@verjson/infra` package.

The canonical acquisition lane validates the lock entry and immutable GitHub
Packages URL before using the token. It transfers only a bounded, identity-bound
npm content cache. The consumer lane installs with lifecycle scripts disabled,
scrubs npm, Git, cloud, and OIDC credentials, and only then runs the repository's
reviewed validation script plan. Pull requests use the `pull_request` event;
trusted pushes and explicit dispatches use the separate trusted-ref mode with the
same package policy and script plan.

## Consequences

- Pull-request code never receives the package credential or ambient runner npm
  configuration.
- A new internal dependency requires an explicit caller allowlist and matching
  protected policy update.
- Missing package authorization, policy mismatch, cache mismatch, or credential
  scrub failure stops validation before consumer code executes.
- The handoff does not consume organization artifact quota with a complete
  `node_modules` tree.
- Pulumi/unit, dependency-smoke, secret-scan, offline-preview, Vault-render, and
  production-audit checks run in both event lanes.
