# Authenticate the private package install in CI

- Grant the CI workflow read-only GitHub Packages access.
- Scope npm to the `@verjson` GitHub Packages registry.
- Expose the automatic workflow token only to the dependency-install step.
- Run contributor code only under the unprivileged `pull_request` event and
  reject fork heads before assigning the persistent self-hosted runner.
- Add a workflow contract test that rejects write permissions or broader token
  exposure.
