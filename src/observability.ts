import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';

// kube-prometheus-stack (Prometheus + Grafana, dashboard sidecar on the
// grafana_dashboard label) + the OTel Collector (OTLP → Prometheus). Telemetry
// path: services → OTel Collector → Prometheus → Grafana (ADR-0009).
export function deployObservability(provider: k8s.Provider, cfg: Settings): void {
  new k8s.helm.v3.Release(
    'kube-prometheus-stack',
    {
      chart: 'kube-prometheus-stack',
      version: cfg.versions.kubePrometheusStack,
      namespace: 'observability',
      createNamespace: true,
      repositoryOpts: { repo: 'https://prometheus-community.github.io/helm-charts' },
    },
    { provider },
  );

  new k8s.helm.v3.Release(
    'opentelemetry-collector',
    {
      chart: 'opentelemetry-collector',
      version: cfg.versions.otelCollector,
      namespace: 'observability',
      repositoryOpts: { repo: 'https://open-telemetry.github.io/opentelemetry-helm-charts' },
      values: { mode: 'deployment', fullnameOverride: 'otel-collector' },
    },
    { provider },
  );
}
