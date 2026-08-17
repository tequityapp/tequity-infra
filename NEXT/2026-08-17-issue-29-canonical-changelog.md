---
date: 2026-08-17
issue: 29
title: Adopt the canonical dispatched-release changelog contract
impact: patch
---

Generate the changelog validation workflow, local renderer, contract test, and
dispatch-only release caller from one immutable `Verjson/.github` contract SHA.
Repository tests now enforce artifact provenance and release safety before a
snapshot can consume `NEXT/` fragments. Existing unreleased entries now use
canonical filename identities and metadata without changing their prose.
