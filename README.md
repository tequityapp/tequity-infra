# tequity-infra

Pulumi (TypeScript) in-cluster platform for Tequity. Cloud-agnostic: it targets
whatever kube context is configured (kind locally, GKE optionally) and deploys,
in order:

1. **Policy** — Kyverno + restricted Pod Security on the app namespace.
2. **Dependencies** — Postgres, Redis, Vault (per-project), Temporal.
3. **Observability** — kube-prometheus-stack (Prometheus/Grafana) + OTel Collector.
4. **Secrets** — External Secrets Operator + a ClusterSecretStore on the project Vault.

All chart versions are pinned in `src/config.ts` (overridable per stack).

```bash
npm ci
npm run build      # tsc --noEmit
npm test           # version-pinning guard (no cloud)
npm run preview    # pulumi preview (needs a stack + kube context)
```

Cluster creation is an opt-in provider module under `src/providers/`; the
in-cluster platform above is identical everywhere.
