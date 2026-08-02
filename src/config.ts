import * as pulumi from '@pulumi/pulumi';

export interface Versions {
  kyverno: string;
  postgresql: string;
  redis: string;
  vault: string;
  temporal: string;
  kubePrometheusStack: string;
  otelCollector: string;
  externalSecrets: string;
}

export const leadCursorKeyringStages = ['disabled', 'bootstrap', 'delivery'] as const;
export type LeadCursorKeyringStage = (typeof leadCursorKeyringStages)[number];
export const sharedVaultTlsStages = ['disabled', 'bootstrap', 'delivery'] as const;
export type SharedVaultTlsStage = (typeof sharedVaultTlsStages)[number];

export interface LeadCursorVaultConnection {
  server: string;
  caConfigMapName: string;
  caConfigMapKey: string;
  caCertFile: string;
}

export interface SharedVaultTlsConnection {
  caConfigMapName: string;
  caConfigMapKey: string;
  tlsSecretName: string;
  tlsCertKey: string;
  tlsPrivateKeyKey: string;
}

export interface Settings {
  environment: string;
  kubeContext: string;
  appNamespace: string;
  leadCursorKeyringStage: LeadCursorKeyringStage;
  leadCursorVault?: LeadCursorVaultConnection;
  leadCursorBootstrapReceipt?: string;
  sharedVaultTlsStage: SharedVaultTlsStage;
  sharedVaultTls?: SharedVaultTlsConnection;
  sharedVaultTlsReceipt?: string;
  versions: Versions;
  identityProviders?: {
    googleClientId: string;
    entraClientId: string;
    entraIssuerUrl: string;
  };
}

// Pinned chart versions; override per stack via Pulumi config `versions`.
export const defaultVersions: Versions = {
  kyverno: '3.3.4',
  postgresql: '16.2.1',
  redis: '20.6.0',
  vault: '0.28.1',
  temporal: '0.50.0',
  kubePrometheusStack: '65.5.1',
  otelCollector: '0.108.0',
  externalSecrets: '0.10.5',
};

export function parseLeadCursorKeyringStage(value: string): LeadCursorKeyringStage {
  if ((leadCursorKeyringStages as readonly string[]).includes(value)) {
    return value as LeadCursorKeyringStage;
  }
  throw new Error(
    `Invalid lead cursor keyring stage: expected ${leadCursorKeyringStages.join(', ')}`,
  );
}

export function parseSharedVaultTlsStage(value: string): SharedVaultTlsStage {
  if ((sharedVaultTlsStages as readonly string[]).includes(value)) {
    return value as SharedVaultTlsStage;
  }
  throw new Error(
    `Invalid shared Vault TLS stage: expected ${sharedVaultTlsStages.join(', ')}`,
  );
}

export function assertSharedVaultTlsReceipt(receipt: string): void {
  if (
    !/^https:\/\/github\.com\/tequityapp\/tequity-infra\/issues\/10#issuecomment-[1-9][0-9]*$/.test(
      receipt,
    )
  ) {
    throw new Error(
      'Shared Vault TLS delivery receipt must link an audited tequity-infra issue #10 comment.',
    );
  }
}

export function assertSharedVaultTlsConnection(
  connection: SharedVaultTlsConnection,
): void {
  const dnsLabel = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
  const dataKey = /^[A-Za-z0-9._-]+$/;
  if (
    !dnsLabel.test(connection.caConfigMapName)
    || !dataKey.test(connection.caConfigMapKey)
    || !dnsLabel.test(connection.tlsSecretName)
    || !dataKey.test(connection.tlsCertKey)
    || !dataKey.test(connection.tlsPrivateKeyKey)
  ) {
    throw new Error(
      'Shared Vault TLS requires valid certificate Secret and CA ConfigMap references.',
    );
  }
}

export function assertLeadCursorBootstrapReceipt(receipt: string): void {
  if (
    !/^https:\/\/github\.com\/tequityapp\/tequity-infra\/issues\/5#issuecomment-[1-9][0-9]*$/.test(
      receipt,
    )
  ) {
    throw new Error(
      'Lead cursor bootstrap receipt must link an audited tequity-infra issue #5 comment.',
    );
  }
}

export function loadSettings(): Settings {
  const cfg = new pulumi.Config('tequity-infra');
  const leadCursorKeyringStage = parseLeadCursorKeyringStage(
    cfg.get('leadCursorKeyringStage') ?? 'disabled',
  );
  const leadCursorVault =
    leadCursorKeyringStage === 'disabled'
      ? undefined
      : {
          server: cfg.require('leadCursorVaultServer'),
          caConfigMapName: cfg.require('leadCursorVaultCaConfigMapName'),
          caConfigMapKey: cfg.require('leadCursorVaultCaConfigMapKey'),
          caCertFile: cfg.require('leadCursorVaultCaCertFile'),
        };
  const leadCursorBootstrapReceipt =
    leadCursorKeyringStage === 'delivery'
      ? cfg.require('leadCursorBootstrapReceipt')
      : undefined;
  if (leadCursorBootstrapReceipt) {
    assertLeadCursorBootstrapReceipt(leadCursorBootstrapReceipt);
  }
  const sharedVaultTlsStage = parseSharedVaultTlsStage(
    cfg.get('sharedVaultTlsStage') ?? 'disabled',
  );
  const sharedVaultTls =
    sharedVaultTlsStage === 'disabled'
      ? undefined
      : {
          caConfigMapName: cfg.require('sharedVaultCaConfigMapName'),
          caConfigMapKey: cfg.require('sharedVaultCaConfigMapKey'),
          tlsSecretName: cfg.require('sharedVaultTlsSecretName'),
          tlsCertKey: cfg.get('sharedVaultTlsCertKey') ?? 'tls.crt',
          tlsPrivateKeyKey: cfg.get('sharedVaultTlsPrivateKeyKey') ?? 'tls.key',
        };
  if (sharedVaultTls) {
    assertSharedVaultTlsConnection(sharedVaultTls);
  }
  const sharedVaultTlsReceipt =
    sharedVaultTlsStage === 'delivery'
      ? cfg.require('sharedVaultTlsReceipt')
      : undefined;
  if (sharedVaultTlsReceipt) {
    assertSharedVaultTlsReceipt(sharedVaultTlsReceipt);
  }

  const environment = cfg.get('environment') ?? 'dev';
  const identityProviders =
    environment === 'nonprod' || environment === 'prod'
      ? {
          googleClientId: cfg.require('googleOidcClientId'),
          entraClientId: cfg.require('entraOidcClientId'),
          entraIssuerUrl: cfg.require('entraOidcIssuerUrl'),
        }
      : undefined;

  return {
    environment,
    kubeContext: cfg.get('kubeContext') ?? 'kind-tequity',
    appNamespace: cfg.get('appNamespace') ?? 'tequity',
    leadCursorKeyringStage,
    leadCursorVault,
    leadCursorBootstrapReceipt,
    sharedVaultTlsStage,
    sharedVaultTls,
    sharedVaultTlsReceipt,
    versions: { ...defaultVersions, ...(cfg.getObject<Partial<Versions>>('versions') ?? {}) },
    identityProviders,
  };
}
