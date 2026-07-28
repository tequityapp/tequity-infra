import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as vault from '@pulumi/vault';
import {
  assertLeadCursorBootstrapReceipt,
  type LeadCursorVaultConnection,
  type Settings,
} from './config';

export const LEAD_CURSOR_KEYRING = Object.freeze({
  apiServiceAccountName: 'tequity-api',
  kubernetesSecretName: 'tequity-api-leads-cursor',
  kubernetesSecretKey: 'LEADS_CURSOR_KEYS_JSON',
  secretStoreName: 'tequity-api-leads-cursor-vault',
  vaultAuthBackend: 'kubernetes',
  vaultAuthRoleName: 'tequity-api-leads-cursor',
  vaultMount: 'tequity-api-leads-cursor',
  vaultPolicyName: 'tequity-api-leads-cursor-read',
  vaultRemoteKey: 'keyring',
  refreshInterval: '1m',
  tokenTtlSeconds: 600,
});

export const LEAD_CURSOR_MOUNT_LIFECYCLE = Object.freeze({
  protect: true,
  retainOnDelete: true,
  deleteBeforeReplace: false,
});

export const LEAD_CURSOR_BOOTSTRAP_LIFECYCLE = Object.freeze({
  protect: true,
  deleteBeforeReplace: false,
});

export const leadCursorVaultPolicy = `path "${LEAD_CURSOR_KEYRING.vaultMount}/data/${LEAD_CURSOR_KEYRING.vaultRemoteKey}" {
  capabilities = ["read"]
}`;

export function assertLeadCursorVaultConnection(
  connection: LeadCursorVaultConnection,
): void {
  let url: URL;
  try {
    url = new URL(connection.server);
  } catch {
    throw new Error('Lead cursor keyring requires a trusted HTTPS Vault endpoint.');
  }
  if (
    url.protocol !== 'https:'
    || !url.hostname
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
    || url.hostname === 'localhost'
    || url.hostname.endsWith('.localhost')
    || url.hostname === '127.0.0.1'
    || url.hostname === '::1'
    || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)
    || !/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i.test(connection.caConfigMapName)
    || !/^[A-Za-z0-9._-]+$/.test(connection.caConfigMapKey)
    || connection.caCertFile.trim().length === 0
  ) {
    throw new Error('Lead cursor keyring requires a trusted HTTPS Vault endpoint.');
  }
}

export function buildLeadCursorVaultProviderArgs(
  connection: LeadCursorVaultConnection,
): vault.ProviderArgs {
  assertLeadCursorVaultConnection(connection);
  return {
    address: connection.server,
    caCertFile: connection.caCertFile,
    skipTlsVerify: false,
    tokenName: 'tequity-infra-lead-cursor-bootstrap',
    maxLeaseTtlSeconds: 1_200,
  };
}

export function buildLeadCursorVaultMountArgs(): vault.MountArgs {
  return {
    path: LEAD_CURSOR_KEYRING.vaultMount,
    type: 'kv-v2',
    description: 'API-only lead cursor HMAC keyring',
    listingVisibility: 'hidden',
  };
}

export function buildLeadCursorVaultPolicyArgs(): vault.PolicyArgs {
  return {
    name: LEAD_CURSOR_KEYRING.vaultPolicyName,
    policy: leadCursorVaultPolicy,
  };
}

export function buildLeadCursorVaultAuthRoleArgs(
  namespace: string,
): vault.kubernetes.AuthBackendRoleArgs {
  return {
    backend: LEAD_CURSOR_KEYRING.vaultAuthBackend,
    roleName: LEAD_CURSOR_KEYRING.vaultAuthRoleName,
    boundServiceAccountNames: [LEAD_CURSOR_KEYRING.apiServiceAccountName],
    boundServiceAccountNamespaces: [namespace],
    audience: 'vault',
    tokenPolicies: [LEAD_CURSOR_KEYRING.vaultPolicyName],
    tokenNoDefaultPolicy: true,
    tokenTtl: LEAD_CURSOR_KEYRING.tokenTtlSeconds,
    tokenMaxTtl: LEAD_CURSOR_KEYRING.tokenTtlSeconds,
    tokenExplicitMaxTtl: LEAD_CURSOR_KEYRING.tokenTtlSeconds,
    tokenType: 'batch',
  };
}

export function buildLeadCursorServiceAccountArgs(
  namespace: string,
): k8s.core.v1.ServiceAccountArgs {
  return {
    metadata: {
      name: LEAD_CURSOR_KEYRING.apiServiceAccountName,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'tequity-api',
        'app.kubernetes.io/part-of': 'tequity',
      },
    },
    automountServiceAccountToken: false,
  };
}

export function buildLeadCursorSecretStoreArgs(
  namespace: string,
  connection: LeadCursorVaultConnection,
): k8s.apiextensions.CustomResourceArgs {
  assertLeadCursorVaultConnection(connection);
  return {
    apiVersion: 'external-secrets.io/v1beta1',
    kind: 'SecretStore',
    metadata: {
      name: LEAD_CURSOR_KEYRING.secretStoreName,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'tequity-api',
        'app.kubernetes.io/part-of': 'tequity',
      },
    },
    spec: {
      provider: {
        vault: {
          server: connection.server,
          path: LEAD_CURSOR_KEYRING.vaultMount,
          version: 'v2',
          caProvider: {
            type: 'ConfigMap',
            name: connection.caConfigMapName,
            key: connection.caConfigMapKey,
          },
          auth: {
            kubernetes: {
              mountPath: LEAD_CURSOR_KEYRING.vaultAuthBackend,
              role: LEAD_CURSOR_KEYRING.vaultAuthRoleName,
              serviceAccountRef: {
                name: LEAD_CURSOR_KEYRING.apiServiceAccountName,
                audiences: ['vault'],
              },
            },
          },
        },
      },
    },
  };
}

export function buildLeadCursorExternalSecretArgs(
  namespace: string,
): k8s.apiextensions.CustomResourceArgs {
  return {
    apiVersion: 'external-secrets.io/v1beta1',
    kind: 'ExternalSecret',
    metadata: {
      name: LEAD_CURSOR_KEYRING.kubernetesSecretName,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'tequity-api',
        'app.kubernetes.io/part-of': 'tequity',
      },
    },
    spec: {
      refreshInterval: LEAD_CURSOR_KEYRING.refreshInterval,
      secretStoreRef: {
        kind: 'SecretStore',
        name: LEAD_CURSOR_KEYRING.secretStoreName,
      },
      target: {
        name: LEAD_CURSOR_KEYRING.kubernetesSecretName,
        creationPolicy: 'Orphan',
        deletionPolicy: 'Retain',
        template: {
          engineVersion: 'v2',
          type: 'Opaque',
          metadata: {
            labels: {
              'app.kubernetes.io/name': 'tequity-api',
              'app.kubernetes.io/part-of': 'tequity',
            },
          },
        },
      },
      data: [
        {
          secretKey: LEAD_CURSOR_KEYRING.kubernetesSecretKey,
          remoteRef: {
            key: LEAD_CURSOR_KEYRING.vaultRemoteKey,
            property: LEAD_CURSOR_KEYRING.kubernetesSecretKey,
          },
        },
      ],
    },
  };
}

export interface LeadCursorKeyringDependencies {
  externalSecrets: k8s.helm.v3.Release;
}

export interface LeadCursorKeyringBootstrapResources {
  vaultProvider: vault.Provider;
  mount: vault.Mount;
  policy: vault.Policy;
  authRole: vault.kubernetes.AuthBackendRole;
  serviceAccount: k8s.core.v1.ServiceAccount;
}

export interface LeadCursorKeyringDeliveryResources {
  secretStore: k8s.apiextensions.CustomResource;
  externalSecret: k8s.apiextensions.CustomResource;
}

function protectedVaultOptions(
  provider: vault.Provider,
  dependsOn: pulumi.Resource[] = [],
): pulumi.CustomResourceOptions {
  return {
    provider,
    dependsOn,
    ...LEAD_CURSOR_BOOTSTRAP_LIFECYCLE,
  };
}

export function deployLeadCursorKeyringBootstrap(
  provider: k8s.Provider,
  cfg: Settings,
): LeadCursorKeyringBootstrapResources {
  if (!cfg.leadCursorVault) {
    throw new Error('Lead cursor keyring bootstrap requires trusted Vault configuration.');
  }
  const vaultProvider = new vault.Provider(
    'lead-cursor-vault',
    buildLeadCursorVaultProviderArgs(cfg.leadCursorVault),
  );
  const mount = new vault.Mount(
    'lead-cursor-keyring-mount',
    buildLeadCursorVaultMountArgs(),
    {
      provider: vaultProvider,
      ...LEAD_CURSOR_MOUNT_LIFECYCLE,
    },
  );
  const policy = new vault.Policy(
    'lead-cursor-keyring-read-policy',
    buildLeadCursorVaultPolicyArgs(),
    protectedVaultOptions(vaultProvider, [mount]),
  );
  const authRole = new vault.kubernetes.AuthBackendRole(
    'lead-cursor-keyring-auth-role',
    buildLeadCursorVaultAuthRoleArgs(cfg.appNamespace),
    protectedVaultOptions(vaultProvider, [policy]),
  );
  const serviceAccount = new k8s.core.v1.ServiceAccount(
    'lead-cursor-api-service-account',
    buildLeadCursorServiceAccountArgs(cfg.appNamespace),
    {
      provider,
      ...LEAD_CURSOR_BOOTSTRAP_LIFECYCLE,
    },
  );

  return { vaultProvider, mount, policy, authRole, serviceAccount };
}

export function deployLeadCursorKeyringDelivery(
  provider: k8s.Provider,
  cfg: Settings,
  dependencies: LeadCursorKeyringDependencies,
  bootstrap: LeadCursorKeyringBootstrapResources,
): LeadCursorKeyringDeliveryResources {
  if (!cfg.leadCursorVault) {
    throw new Error('Lead cursor keyring delivery requires trusted Vault configuration.');
  }
  if (!cfg.leadCursorBootstrapReceipt) {
    throw new Error('Lead cursor keyring delivery requires an audited bootstrap receipt.');
  }
  assertLeadCursorBootstrapReceipt(cfg.leadCursorBootstrapReceipt);
  const secretStore = new k8s.apiextensions.CustomResource(
    'lead-cursor-keyring-secret-store',
    buildLeadCursorSecretStoreArgs(cfg.appNamespace, cfg.leadCursorVault),
    {
      provider,
      dependsOn: [
        dependencies.externalSecrets,
        bootstrap.mount,
        bootstrap.authRole,
        bootstrap.serviceAccount,
      ],
    },
  );

  const externalSecret = new k8s.apiextensions.CustomResource(
    'lead-cursor-keyring-external-secret',
    buildLeadCursorExternalSecretArgs(cfg.appNamespace),
    { provider, dependsOn: [secretStore] },
  );

  return { secretStore, externalSecret };
}
