---
date: 2026-08-21
id: 20260821T210000Z
impact: patch
title: Regenerate the changelog contract artifacts at one organization-wide pin
---

Every changelog contract artifact in this repository was regenerated with
`Verjson/.github scripts/gen-changelog-caller.sh` at
`413bf03b179ff3028e6c7da5551aaa44562ddd8d`, the commit the reference adopter
`Verjson/verjson-ai` already runs. The family had drifted to six different pins
across eight repositories, so a local `scripts/render-next.sh` no longer
predicted what CI validated — the failure the generator exists to prevent. The
files are generated, never hand-edited, so the workflow, renderer, and contract
test agree on one commit by construction.

This repository had no generated `changelog-contract.yml` pull-request gate at all, so the contract test it ships was never executed on a pull request. The gate is added here, on a GitHub-hosted ephemeral runner, checking the PR out with `persist-credentials: false`.
