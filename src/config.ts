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

export interface LeadCursorVaultConnection {
  server: string;
  caConfigMapName: string;
  caConfigMapKey: string;
  caCertFile: string;
}

export interface Settings {
  environment: string;
  kubeContext: string;
  appNamespace: string;
  leadCursorKeyringStage: LeadCursorKeyringStage;
  leadCursorVault?: LeadCursorVaultConnection;
  leadCursorBootstrapReceipt?: string;
  versions: Versions;
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

  return {
    environment: cfg.get('environment') ?? 'dev',
    kubeContext: cfg.get('kubeContext') ?? 'kind-tequity',
    appNamespace: cfg.get('appNamespace') ?? 'tequity',
    leadCursorKeyringStage,
    leadCursorVault,
    leadCursorBootstrapReceipt,
    versions: { ...defaultVersions, ...(cfg.getObject<Partial<Versions>>('versions') ?? {}) },
  };
}
