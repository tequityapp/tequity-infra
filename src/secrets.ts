import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';
import { deployLeadCursorKeyring } from './lead-cursor-keyring';

// External Secrets Operator + a ClusterSecretStore pointing at the per-project
// Vault (k8s auth), syncing into the tequity-secrets k8s Secret that tequity-helm
// mounts.
export function deploySecrets(provider: k8s.Provider, cfg: Settings): void {
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

  new k8s.apiextensions.CustomResource(
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
    { provider },
  );

  if (cfg.leadCursorKeyringEnabled) {
    deployLeadCursorKeyring(provider, cfg, { externalSecrets });
  }
}
