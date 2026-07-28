import * as k8s from '@pulumi/kubernetes';
import { assertSharedVaultTlsConnection, type Settings } from './config';
import {
  deployLeadCursorKeyringBootstrap,
  deployLeadCursorKeyringDelivery,
} from './lead-cursor-keyring';

// Vault through Kubernetes auth. Individual ExternalSecrets own narrowly scoped
// runtime Secrets; credential values never pass through Pulumi inputs/state.
export interface Secrets {
  externalSecrets: k8s.helm.v3.Release;
  vaultStore?: k8s.apiextensions.CustomResource;
}

export function buildSharedVaultStoreArgs(
  cfg: Settings,
): k8s.apiextensions.CustomResourceArgs {
  if (!cfg.sharedVaultTls) {
    throw new Error('Shared Vault delivery requires trusted TLS references.');
  }
  const tls = cfg.sharedVaultTls;
  assertSharedVaultTlsConnection(tls);
  return {
    apiVersion: 'external-secrets.io/v1beta1',
    kind: 'ClusterSecretStore',
    metadata: { name: 'tequity-vault' },
    spec: {
      provider: {
        vault: {
          server: `https://vault.${cfg.appNamespace}:8200`,
          path: 'secret',
          version: 'v2',
          caProvider: {
            type: 'ConfigMap',
            namespace: cfg.appNamespace,
            name: tls.caConfigMapName,
            key: tls.caConfigMapKey,
          },
          auth: { kubernetes: { mountPath: 'kubernetes', role: 'tequity' } },
        },
      },
    },
  };
}

export function deploySecrets(
  provider: k8s.Provider,
  cfg: Settings,
  vault?: k8s.helm.v3.Release,
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

  let vaultStore: k8s.apiextensions.CustomResource | undefined;
  if (cfg.sharedVaultTlsStage === 'delivery') {
    if (!vault || !cfg.sharedVaultTlsReceipt) {
      throw new Error(
        'Shared Vault delivery requires TLS bootstrap and an audited inventory receipt.',
      );
    }
    vaultStore = new k8s.apiextensions.CustomResource(
      'tequity-vault-store',
      buildSharedVaultStoreArgs(cfg),
      { provider, dependsOn: [externalSecrets, vault] },
    );
  }

  if (cfg.leadCursorKeyringStage !== 'disabled') {
    const bootstrap = deployLeadCursorKeyringBootstrap(provider, cfg);
    if (cfg.leadCursorKeyringStage === 'delivery') {
      deployLeadCursorKeyringDelivery(
        provider,
        cfg,
        { externalSecrets },
        bootstrap,
      );
    }
  }

  return { externalSecrets, vaultStore };
}
