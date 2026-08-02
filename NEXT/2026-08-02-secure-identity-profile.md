# Declare the secure Tequity identity profile

- Consume exact `@verjson/infra@0.14.4` canonical-audience validation.
- Declare environment-specific issuer, audience, JWKS, ordered ESC, and
  separate Vault-reference contracts.
- Allow only the immutable initial operator the exact six-permission catalog.
- Require RS256 and fresh MFA with TOTP first while retaining Google, Entra,
  and additive passkey capabilities.
- Add credential-free acceptance and fail-closed behavioral tests plus
  ADR-0004 rollout, audit, rotation, and rollback guards.
