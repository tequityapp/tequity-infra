# Authenticate the private package install in CI

- Grant the CI workflow read-only GitHub Packages access.
- Scope npm to the `@verjson` GitHub Packages registry.
- Expose the automatic workflow token only to the dependency-install step.
- Add a workflow contract test that rejects write permissions or broader token
  exposure.
