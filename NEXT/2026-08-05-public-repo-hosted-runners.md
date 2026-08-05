# Run this public repository's CI on hosted runners — 2026-08-05

- Route `ci` and `actionlint` to `ubuntu-24.04` instead of the shared self-hosted pool. This repository is public and the pool sets `allows_public_repositories=false`, so its jobs were never assigned a runner and queued indefinitely — measured at roughly two hours with four of six runners idle.
- Keep the pool's restriction rather than widening it. Public-repository pull-request code must not execute on a persistent shared runner (ADR-0033 routing, ADR-0041 isolation), and the ephemeral untrusted-PR group is not provisioned yet, so GitHub-hosted is the fail-safe tier. Hosted minutes are free for public repositories.
