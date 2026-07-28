import * as k8s from '@pulumi/kubernetes';
import type * as pulumi from '@pulumi/pulumi';
import { assertSharedVaultTlsConnection, type Settings } from './config';
import { CONNECTOR_DATABASE } from './connector-database';

export interface DependencyResources {
  vault: k8s.helm.v3.Release;
}

export function buildSharedVaultReleaseArgs(
  cfg: Settings,
): k8s.helm.v3.ReleaseArgs {
  if (!cfg.sharedVaultTls) {
    throw new Error('Shared Vault bootstrap requires trusted TLS references.');
  }
  const tls = cfg.sharedVaultTls;
  assertSharedVaultTlsConnection(tls);
  const mountPath = `/vault/userconfig/${tls.tlsSecretName}`;
  return {
    chart: 'vault',
    version: cfg.versions.vault,
    namespace: cfg.appNamespace,
    repositoryOpts: { repo: 'https://helm.releases.hashicorp.com' },
    values: {
      fullnameOverride: 'vault',
      global: { tlsDisable: false },
      injector: { enabled: false },
      server: {
        volumes: [
          {
            name: 'vault-server-tls',
            secret: { secretName: tls.tlsSecretName },
          },
          {
            name: 'vault-server-ca',
            configMap: {
              name: tls.caConfigMapName,
              items: [{ key: tls.caConfigMapKey, path: 'ca.crt' }],
            },
          },
        ],
        volumeMounts: [
          { name: 'vault-server-tls', mountPath, readOnly: true },
          {
            name: 'vault-server-ca',
            mountPath: '/vault/tls/ca',
            readOnly: true,
          },
        ],
        extraEnvironmentVars: {
          VAULT_ADDR: `https://vault.${cfg.appNamespace}:8200`,
          VAULT_CACERT: '/vault/tls/ca/ca.crt',
        },
        readinessProbe: { enabled: false },
        livenessProbe: {
          enabled: true,
          execCommand: ['/bin/sh', '-ec', 'vault status'],
        },
        extraContainers: [
          {
            name: 'vault-tls-readiness',
            image:
              'hashicorp/vault:1.17.2@sha256:aaaedf0b3b34560157cc7c06f50f794eb7baa071165f2eed4db94b44db901806',
            imagePullPolicy: 'IfNotPresent',
            command: ['/bin/sh', '-ec', 'while true; do sleep 3600; done'],
            env: [
              {
                name: 'VAULT_ADDR',
                value: `https://vault.${cfg.appNamespace}:8200`,
              },
              { name: 'VAULT_CACERT', value: '/vault/tls/ca/ca.crt' },
            ],
            readinessProbe: {
              exec: { command: ['/bin/sh', '-ec', 'vault status'] },
              initialDelaySeconds: 5,
              periodSeconds: 5,
              timeoutSeconds: 3,
              failureThreshold: 2,
            },
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              readOnlyRootFilesystem: true,
              runAsNonRoot: true,
            },
            volumeMounts: [
              {
                name: 'vault-server-ca',
                mountPath: '/vault/tls/ca',
                readOnly: true,
              },
            ],
          },
        ],
        standalone: {
          config: [
            'ui = true',
            'listener "tcp" {',
            '  address = "0.0.0.0:8200"',
            '  cluster_address = "0.0.0.0:8201"',
            '  tls_disable = 0',
            `  tls_cert_file = "${mountPath}/${tls.tlsCertKey}"`,
            `  tls_key_file = "${mountPath}/${tls.tlsPrivateKeyKey}"`,
            '}',
            'storage "file" {',
            '  path = "/vault/data"',
            '}',
          ].join('\n'),
        },
      },
    },
  };
}

export function buildSharedVaultReleaseArgsForStage(
  cfg: Settings,
): k8s.helm.v3.ReleaseArgs | undefined {
  return cfg.sharedVaultTlsStage === 'disabled'
    ? undefined
    : buildSharedVaultReleaseArgs(cfg);
}

export const SHARED_VAULT_LIFECYCLE: pulumi.CustomResourceOptions = {
  protect: true,
  retainOnDelete: true,
  deleteBeforeReplace: false,
};

// Postgres, Redis, the optional protected shared Vault, and Temporal. All use
// fullnameOverride for stable in-cluster DNS the Helm chart relies on.
export interface Dependencies {
  postgresql: k8s.helm.v3.Release;
  vault?: k8s.helm.v3.Release;
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

  const vaultArgs = buildSharedVaultReleaseArgsForStage(cfg);
  const vault = vaultArgs
    ? new k8s.helm.v3.Release(
        'vault',
        vaultArgs,
        { provider, ...SHARED_VAULT_LIFECYCLE },
      )
    : undefined;

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
