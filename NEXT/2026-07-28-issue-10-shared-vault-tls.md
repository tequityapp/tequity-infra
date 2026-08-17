---
date: 2026-07-28
issue: 10
title: Harden the legacy shared Vault store with verified TLS
impact: patch
---

- Replace the plaintext shared Vault trust boundary with a protected TLS-only
  Helm release, chart-wide HTTPS service/client settings, trusted-CA probes,
  and an HTTPS `ClusterSecretStore` pinned to a reviewed CA ConfigMap.
- Require staged bootstrap and an issue-backed live-consumer/TLS attestation
  before delivery; rollback removes the store and fails closed.
- Keep certificate private keys, Vault tokens, and secret values outside
  Pulumi inputs, state, previews, Git, and CI.
- Record migration, certificate rotation, rollback, and decommission guards in
  ADR-0002.
