# Authenticate the private package install in CI

- Grant the CI workflow read-only GitHub Packages access.
- Scope npm to the `@verjson` GitHub Packages registry.
- Expose a cross-organization `read:packages` token only to the
  dependency-install step. `GITHUB_TOKEN` cannot read another org's
  packages and 403s on `@verjson/*`, which lives in the Verjson org, so the
  org-level PAT supplies access with `github.token` as the same-org fallback.
- Run contributor code only under the unprivileged `pull_request` event and
  reject fork heads before assigning the persistent self-hosted runner.
- Add a workflow contract test that rejects write permissions or broader token
  exposure.
