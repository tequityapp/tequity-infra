## 2026-07-30 — define the two-cloud-environment operating model

Retired the local `dev` Pulumi stack and constrained the program to `nonprod`
and `prod`. ADR-0003 separates disposable Docker Compose and MinIO development
from Pulumi Cloud and ESC, defaults nonprod stateful resources to dedicated
ownership, requires discovery and import before production management, and
promotes reviewed code without copying stack state.
