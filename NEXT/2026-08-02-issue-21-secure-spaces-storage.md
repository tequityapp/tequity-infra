---
date: 2026-08-02
issue: 21
title: Declare secure DigitalOcean Spaces upload storage
impact: minor
---

Consume the separable `@verjson/infra@0.18.3` Spaces component to declare exact
nonproduction storage and protected, import-first production storage. Restrict
browser CORS to `PUT`, `Content-Type`, and `If-None-Match` from one exact
environment origin, and compose fully qualified Tequity ESC environments
without placing credentials in Pulumi inputs or outputs.

Credential-free contract tests and ADR-0005 preserve rollout, replacement,
package-authorization, and two-cloud environment safeguards reviewed for PR #16.
