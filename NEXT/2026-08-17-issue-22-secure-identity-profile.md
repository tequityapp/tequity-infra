---
date: 2026-08-17
issue: 22
title: Declare secure Tequity identity profile
impact: minor
---

Consume `@verjson/infra@0.18.3` to declare exact environment-specific issuer,
audience, JWKS, ordered ESC, and Vault-reference contracts. Allow only the
immutable initial operator's exact six-permission catalog, require RS256 and
fresh TOTP-first MFA, require an exact tenant-specific Microsoft Entra issuer,
reject non-canonical raw issuer spellings including normalized paths, host or
scheme case, backslashes, encoding aliases, default ports, and uppercase tenant
UUIDs, and retain Google and additive passkey support without placing signing
keys or client secrets in Pulumi inputs or outputs.

Preserve current fail-closed cloud configuration and dependency security,
record the identity decision as unique ADR-0006, and add credential-free
acceptance and rejection coverage for the reviewed PR #18 / issue #22 scope.
