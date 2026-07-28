import * as k8s from '@pulumi/kubernetes';
import * as vault from '@pulumi/vault';
import type { Settings } from './config';

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

export const leadCursorVaultPolicy = `path "${LEAD_CURSOR_KEYRING.vaultMount}/data/${LEAD_CURSOR_KEYRING.vaultRemoteKey}" {
  capabilities = ["read"]
}`;

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
): k8s.apiextensions.CustomResourceArgs {
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
          server: `http://vault.${namespace}:8200`,
          path: LEAD_CURSOR_KEYRING.vaultMount,
          version: 'v2',
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
        creationPolicy: 'Owner',
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

export interface LeadCursorKeyringResources {
  mount: vault.Mount;
  policy: vault.Policy;
  authRole: vault.kubernetes.AuthBackendRole;
  serviceAccount: k8s.core.v1.ServiceAccount;
  secretStore: k8s.apiextensions.CustomResource;
  externalSecret: k8s.apiextensions.CustomResource;
}

export function deployLeadCursorKeyring(
  provider: k8s.Provider,
  cfg: Settings,
  dependencies: LeadCursorKeyringDependencies,
): LeadCursorKeyringResources {
  const mount = new vault.Mount(
    'lead-cursor-keyring-mount',
    buildLeadCursorVaultMountArgs(),
  );
  const policy = new vault.Policy(
    'lead-cursor-keyring-read-policy',
    buildLeadCursorVaultPolicyArgs(),
    { dependsOn: [mount] },
  );
  const authRole = new vault.kubernetes.AuthBackendRole(
    'lead-cursor-keyring-auth-role',
    buildLeadCursorVaultAuthRoleArgs(cfg.appNamespace),
    { dependsOn: [policy] },
  );
  const serviceAccount = new k8s.core.v1.ServiceAccount(
    'lead-cursor-api-service-account',
    buildLeadCursorServiceAccountArgs(cfg.appNamespace),
    { provider },
  );
  const secretStore = new k8s.apiextensions.CustomResource(
    'lead-cursor-keyring-secret-store',
    buildLeadCursorSecretStoreArgs(cfg.appNamespace),
    {
      provider,
      dependsOn: [dependencies.externalSecrets, authRole, serviceAccount],
    },
  );

  const externalSecret = new k8s.apiextensions.CustomResource(
    'lead-cursor-keyring-external-secret',
    buildLeadCursorExternalSecretArgs(cfg.appNamespace),
    { provider, dependsOn: [secretStore] },
  );

  return { mount, policy, authRole, serviceAccount, secretStore, externalSecret };
}
