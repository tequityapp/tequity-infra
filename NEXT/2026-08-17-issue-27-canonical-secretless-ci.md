## 2026-08-17 — Adopt canonical secretless CI

Replace the Node CI job's `pull_request_target` execution with the immutable
canonical workflow at `58a82143d28bc84c163d3fed092d8d9425b91a62`, and move
actionlint pull-request validation to a GitHub-hosted runner with immutable action
pins. Pull-request and trusted-ref Node validation share an exact empty
internal-package allowlist for the current lock. The token-bearing lane executes
no repository code and hands off only a bounded exact-attempt npm content cache;
the reviewed Node validation plan runs only after npm, Git, cloud, and OIDC
credentials are scrubbed.

The new production gate also refreshes only `brace-expansion@5.0.9` and
`js-yaml@4.3.1`, clearing GHSA-rgw5-rvv9-x895 and GHSA-5p4m-2wfm-xmqj. Focused
smoke assertions pin both compatible transitive patches. No infrastructure
dependency, specification, domain behavior, or resource provisioning is added.
