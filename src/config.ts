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

export interface Settings {
  environment: string;
  kubeContext: string;
  appNamespace: string;
  leadCursorKeyringEnabled: boolean;
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

export function loadSettings(): Settings {
  const cfg = new pulumi.Config('tequity-infra');
  return {
    environment: cfg.get('environment') ?? 'dev',
    kubeContext: cfg.get('kubeContext') ?? 'kind-tequity',
    appNamespace: cfg.get('appNamespace') ?? 'tequity',
    leadCursorKeyringEnabled: cfg.getBoolean('leadCursorKeyringEnabled') ?? false,
    versions: { ...defaultVersions, ...(cfg.getObject<Partial<Versions>>('versions') ?? {}) },
  };
}
