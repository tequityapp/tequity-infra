# NEXT/ — changelog fragments

One file per log entry prevents concurrent pull requests from conflicting on a
shared running-log file.

## Adding an entry

In the same commit as a change that affects behaviour, pins, docs, or config,
add `NEXT/YYYY-MM-DD-<short-slug>.md`. The file is one entry beginning with an
H2 title:

```markdown
## 2026-07-28 — short imperative title

One or two paragraphs describing what changed, why, and relevant issue/PR/ADR
references.
```

Fragments render newest first. Never edit another entry's file or reintroduce a
committed, hand-edited `NEXT.md`. `0000-archive.md` preserves the history from
before this repository adopted fragments and always sorts last.

## Reading the whole log

`scripts/render-next.sh` concatenates every fragment newest-first to stdout:

```sh
./scripts/render-next.sh
./scripts/render-next.sh | less
```
