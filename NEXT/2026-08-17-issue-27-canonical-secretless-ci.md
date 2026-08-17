# Adopt canonical secretless Node CI — 2026-08-17

Replace `pull_request_target` execution of pull-request heads with the immutable
canonical Node workflow at `58a82143d28bc84c163d3fed092d8d9425b91a62`.
Pull-request and trusted-ref validation now share an exact empty internal-package
allowlist for the current lock, while the protected policy prevents a branch from
authorizing new package access. The token-bearing lane executes no repository
code and hands off only a bounded exact-attempt npm content cache; build, test,
dependency smoke, secret scan, offline previews, Vault render, and the production
audit run only after npm, Git, cloud, and OIDC credentials are scrubbed.

The new production gate also refreshes only `brace-expansion@5.0.9` and
`js-yaml@4.3.1`, clearing GHSA-rgw5-rvv9-x895 and GHSA-5p4m-2wfm-xmqj. Focused
smoke assertions pin both compatible transitive patches. No infrastructure
dependency, specification, domain behavior, or resource provisioning is added.
