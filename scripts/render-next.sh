#!/usr/bin/env bash
# Render NEXT/ changelog fragments newest first.
set -euo pipefail

next_dir="$(cd "$(dirname "$0")/.." && pwd)/NEXT"
[ -d "$next_dir" ] || { echo "render-next: no NEXT/ directory at $next_dir" >&2; exit 1; }

mapfile -t fragments < <(cd "$next_dir" && ls -1 ./*.md 2>/dev/null | sed 's#^\./##' | grep -vx 'README.md' | sort -r)
if [ "${#fragments[@]}" -eq 0 ]; then
  echo "render-next: no fragments in $next_dir" >&2
  exit 1
fi

first=1
for fragment in "${fragments[@]}"; do
  [ "$first" = 1 ] || printf '\n'
  cat "$next_dir/$fragment"
  first=0
done
