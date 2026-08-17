---
date: 2026-07-28
issue: 7
title: Remediate brace-expansion dependency chains
impact: patch
---

- Replace Jest's legacy `glob` chain with Vitest and constrain the Pulumi GCP
  package-json consumer to a compatible release whose `glob`/`minimatch` chain
  natively resolves `brace-expansion` 5.0.8.
- Exercise every installed `glob` and `minimatch` instance with brace patterns
  so dependency overrides cannot silently introduce API incompatibilities.
- Require the full dependency audit, build, tests, and offline Pulumi mock
  preview to pass.
