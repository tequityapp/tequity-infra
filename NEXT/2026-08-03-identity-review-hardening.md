# Identity draft review hardening

- Merge the current two-cloud operating model into the identity branch while
  preserving fail-closed cloud environment and Kubernetes-context validation.
- Renumber the identity decision to ADR-0005 and refresh the lockfile past
  high-severity `brace-expansion` advisory GHSA-rgw5-rvv9-x895.
- Preserve the existing package-authorization and IAM security holds.

Refs tequity-infra#22 and PR #18.
