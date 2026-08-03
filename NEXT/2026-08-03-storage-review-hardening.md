# Storage draft review hardening

- Merge the current two-cloud operating model into the storage branch and keep
  its canonical stack environment references.
- Renumber the storage decision to ADR-0004 and refresh the lockfile past
  high-severity `brace-expansion` advisory GHSA-rgw5-rvv9-x895.
- Preserve the existing package-authorization and security holds.

Refs tequity-infra#21 and PR #16.
