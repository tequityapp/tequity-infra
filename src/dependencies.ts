import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';
import { CONNECTOR_DATABASE } from './connector-database';

// Postgres, Redis, Vault (per-project, HA/raft), and Temporal. All use
// fullnameOverride for stable in-cluster DNS the Helm chart relies on.
export interface Dependencies {
  postgresql: k8s.helm.v3.Release;
  vault: k8s.helm.v3.Release;
}

export function deployDependencies(provider: k8s.Provider, cfg: Settings): Dependencies {
  const ns = cfg.appNamespace;

  const postgresql = new k8s.helm.v3.Release(
    'postgresql',
    {
      chart: 'postgresql',
      version: cfg.versions.postgresql,
      namespace: ns,
      repositoryOpts: { repo: 'https://charts.bitnami.com/bitnami' },
      values: {
        fullnameOverride: 'postgres',
        // The admin credential remains chart-managed. Runtime roles are
        // reconciled separately and never own migrations.
        auth: { database: CONNECTOR_DATABASE.database },
      },
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

  const vault = new k8s.helm.v3.Release(
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

  return { postgresql, vault };
}
