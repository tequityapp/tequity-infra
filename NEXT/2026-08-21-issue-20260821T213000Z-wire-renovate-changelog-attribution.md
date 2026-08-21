---
date: 2026-08-21
id: 20260821T213000Z
impact: patch
title: Attribute Renovate pull requests with a NEXT/ fragment automatically
---

Renovate opened its pull requests with a manifest and a lockfile and no `NEXT/`
fragment, so the running log was incomplete by construction: every dependency
change that landed left no entry, and the contract's own rule that a manifest or
lockfile change requires a fragment was satisfied only when a human noticed.

The generated `renovate-attribution` caller closes that. It is a thin
`pull_request_target` delegation to the immutable trusted workflow and never
checks out pull-request code; it holds `contents: read` and
`pull-requests: read` only, and gates on same-repository head, a Renovate author,
and a `renovate/` branch prefix. The fragment is written by a short-lived App
installation token rather than `GITHUB_TOKEN`, which the contract test forbids
here precisely because a caller that could write with the job token would be a
write primitive reachable from a pull request.
