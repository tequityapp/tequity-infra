## 2026-07-28 — adopt NEXT/ changelog fragments

Replaced the shared `NEXT.md` running log with one dated fragment per change.
The previous history is preserved verbatim in `NEXT/0000-archive.md`, and
`scripts/render-next.sh` renders the complete newest-first log on demand.
Concurrent infrastructure branches can now record changes without repeatedly
conflicting on the same changelog file.
