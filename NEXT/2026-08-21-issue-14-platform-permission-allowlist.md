---
date: 2026-08-21
issue: 14
impact: minor
title: Enforce the OIDC issuer and operator-population allowlist for platform exact-permission claims
---

`@verjson/infra` already refuses an operator profile whose permissions disagree with its
named catalog profile. What nothing verified was **who may be minted the platform-only
permissions at all** — the repository documented a narrower security-operator boundary
than any test asserted, which is the gap tequity-infra#14 was opened for.

`src/platform-permissions.ts` is now the authoritative allowlist, and the identity profile
is derived from it rather than restating it, so a population added or widened there cannot
reach a deployment without passing its assertions. Only `security-control-operator` may
hold `lead:provenance:read` and `lead:provenance:erase`; a tenant role, a tenant owner,
the platform read-only operator, an unrelated platform operator, and an undeclared
population all resolve to no provenance — and an undeclared population resolves to no
permissions at all rather than to a default.

Only this environment's own Tequity issuer may mint a platform claim. An upstream
federated assertion is exchanged there first and never carries platform claims directly.
An issuer is accepted only as an exact canonical https origin, so a trailing slash, an
explicit port, an uppercase host, a percent-encoded label, or a path is rejected rather
than normalized: any shape the parser cannot fully model fails closed. Provenance
additionally requires `acr=mfa` within 300 seconds, and a session that fails step-up loses
only provenance rather than platform access.

The catalog version is deliberately unchanged. The emitted permission vocabulary is the
same six exact permissions; what this adds is a minting-side constraint on who may hold
two of them, not a new claim for a consumer to understand.
