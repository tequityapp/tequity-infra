# ADR-0004: Declare the normalized Tequity identity deployment profile

- Status: Proposed
- Date: 2026-08-02
- Issue: [tequity-infra#14](https://github.com/tequityapp/tequity-infra/issues/14)

## Context

Tequity resource servers must trust only normalized Tequity session tokens.
Raw Google and Entra claims are authentication inputs, not authorization
claims. Platform authorization is especially sensitive because the initial
operator receives tenant, billing, and provenance-erasure capabilities.

`@verjson/infra@0.14.4` provides a secret-free deployment profile that validates
canonical HTTPS audiences, immutable subjects, exact permission profiles,
ordered ESC references, MFA policy, provider registry metadata, and Vault
references without placing referenced secret values in Pulumi state or output.

## Decision

Declare one profile per environment:

- nonprod issuer `https://auth.dev.tequity.app`, audience
  `https://api.dev.tequity.app`, and JWKS
  `https://auth.dev.tequity.app/.well-known/jwks.json`;
- production issuer `https://auth.tequity.app`, audience
  `https://api.tequity.app`, and JWKS
  `https://auth.tequity.app/.well-known/jwks.json`.

Both profiles allow RS256 only and resolve Google and Entra identities through
`tequity-subject-registry` to stable internal subjects. Google/Entra client
identifiers and the tenant-specific Entra issuer are non-secret Pulumi
configuration composed from ESC. Client secrets and separate environment
signing keys are referenced only by `vault://` URIs.

The sole initial full operator is immutable subject
`5fc54cd0-5f6c-41bf-a44c-cd9e0a6439b1`. Its named profile exactly contains:

- `platform:read`
- `tenant:provision`
- `tenant:setBilling`
- `billing:admin`
- `lead:provenance:read`
- `lead:provenance:erase`

All six require `acr=mfa` and `auth_time` no older than 300 seconds. TOTP is
first in the supported-factor order. Passkeys remain additive. Email, display
name, upstream IdP subject alone, organization membership, repository role,
wildcards, aliases, and partial or excess permission sets grant nothing.

The ordered ESC references are `Tequity/tequity/shared` followed by
`Tequity/tequity/nonprod` or `Tequity/tequity/prod`.

## Rollout, audit, and rollback

Credential-free tests validate both exact profiles and adversarial malformed,
duplicate, sparse, wildcard, stale-MFA, wrong-subject, partial-permission, and
wrong-ESC cases. They also prove normalized outputs contain no client-secret or
private-key material.

Preview only `Tequity/tequity-infra/nonprod` after CI package authentication is
restored. Stop on deletion, replacement, rename, production, Fandemic, or
unrelated changes. Apply only with recorded owner approval, then mint a
nonprod token and verify exact issuer, audience, subject, algorithm, catalog
version, permissions, MFA freshness, and rejection cases without recording the
token.

Production apply is out of scope and requires separate human security approval.
Rotate a provider identifier or Vault key reference by changing only that
environment, retaining the prior Vault key through the overlap window, and
auditing normalized key-material-free outputs. Rollback restores the prior
reviewed references; it never copies keys, ciphertext, state, or snapshots
between environments.

## Consequences

Pulumi records only the normalized public contract and opaque Vault reference
locations. Resource servers have one Tequity trust boundary, while provider
authentication and signing material remain independently rotatable per
environment.
