import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';

// External Secrets Operator + a ClusterSecretStore pointing at the per-project
// Vault through Kubernetes auth. Individual ExternalSecrets own narrowly scoped
// runtime Secrets; credential values never pass through Pulumi inputs/state.
export interface Secrets {
  externalSecrets: k8s.helm.v3.Release;
  vaultStore: k8s.apiextensions.CustomResource;
}

export function deploySecrets(
  provider: k8s.Provider,
  cfg: Settings,
  vault: k8s.helm.v3.Release,
): Secrets {
  const externalSecrets = new k8s.helm.v3.Release(
    'external-secrets',
    {
      chart: 'external-secrets',
      version: cfg.versions.externalSecrets,
      namespace: 'external-secrets',
      createNamespace: true,
      repositoryOpts: { repo: 'https://charts.external-secrets.io' },
    },
    { provider },
  );

  const vaultStore = new k8s.apiextensions.CustomResource(
    'tequity-vault-store',
    {
      apiVersion: 'external-secrets.io/v1beta1',
      kind: 'ClusterSecretStore',
      metadata: { name: 'tequity-vault' },
      spec: {
        provider: {
          vault: {
            server: 'http://vault.' + cfg.appNamespace + ':8200',
            path: 'secret',
            version: 'v2',
            auth: { kubernetes: { mountPath: 'kubernetes', role: 'tequity' } },
          },
        },
      },
    },
    { provider, dependsOn: [externalSecrets, vault] },
  );

  return { externalSecrets, vaultStore };
}
