import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';

// Postgres, Redis, Vault (per-project, HA/raft), and Temporal. All use
// fullnameOverride for stable in-cluster DNS the Helm chart relies on.
export function deployDependencies(provider: k8s.Provider, cfg: Settings): void {
  const ns = cfg.appNamespace;

  new k8s.helm.v3.Release(
    'postgresql',
    {
      chart: 'postgresql',
      version: cfg.versions.postgresql,
      namespace: ns,
      repositoryOpts: { repo: 'https://charts.bitnami.com/bitnami' },
      values: { fullnameOverride: 'postgres' },
    },
    { provider },
  );

  new k8s.helm.v3.Release(
    'redis',
    {
      chart: 'redis',
      version: cfg.versions.redis,
      namespace: ns,
      repositoryOpts: { repo: 'https://charts.bitnami.com/bitnami' },
      values: { fullnameOverride: 'redis', architecture: 'standalone' },
    },
    { provider },
  );

  new k8s.helm.v3.Release(
    'vault',
    {
      chart: 'vault',
      version: cfg.versions.vault,
      namespace: ns,
      repositoryOpts: { repo: 'https://helm.releases.hashicorp.com' },
      values: { fullnameOverride: 'vault' },
    },
    { provider },
  );

  new k8s.helm.v3.Release(
    'temporal',
    {
      chart: 'temporal',
      version: cfg.versions.temporal,
      namespace: ns,
      repositoryOpts: { repo: 'https://go.temporal.io/helm-charts' },
      values: { fullnameOverride: 'temporal' },
    },
    { provider },
  );
}
