# Declare secure DigitalOcean Spaces upload storage

- Consume the separable `@verjson/infra@0.14.1` Spaces component.
- Declare exact nonprod storage and protected import-first production storage.
- Lock browser CORS to `PUT`, `Content-Type`, `If-None-Match`, and one exact
  environment origin.
- Compose fully qualified Tequity ESC environments in the required order
  without placing credentials in Pulumi inputs or outputs.
- Add credential-free contract tests and ADR-0004 rollout guards.
