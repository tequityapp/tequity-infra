# NEXT/ — changelog fragments

One file per log entry prevents concurrent pull requests from conflicting on a
shared running-log file.

## Adding an entry

In the same commit as a change that affects behaviour, pins, docs, or config,
add `NEXT/YYYY-MM-DD-issue-<identity>-<short-slug>.md`. Issue-backed work uses
`issue`; issue-less work uses an `id` containing a UTC timestamp or short UUID.
Each fragment declares its release impact:

```markdown
---
date: 2026-07-28
issue: 29
title: Short imperative title
impact: patch
---

One or two paragraphs describing what changed and why.
```

Fragments render newest first. Never edit another entry's file or reintroduce a
committed, hand-edited `NEXT.md`. `0000-archive.md` preserves the history from
before this repository adopted fragments and always sorts last.

## Reading the whole log

The generator-managed `scripts/render-next.sh` delegates rendering to the
immutable organization contract used by pull-request validation and releases:

```sh
./scripts/render-next.sh
./scripts/render-next.sh | less
```

Do not edit the renderer, changelog workflow, contract test, or release caller
by hand. Regenerate all four from the same immutable `Verjson/.github` commit
with `Verjson/.github/scripts/gen-changelog-caller.sh` when the contract pin
moves.
