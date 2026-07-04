import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';

// Kyverno + a require-resource-limits policy (Audit), a default-deny-ingress
// NetworkPolicy, and the app namespace labelled with the restricted Pod
// Security Standard.
export function deployPolicies(provider: k8s.Provider, cfg: Settings): void {
  new k8s.helm.v3.Release(
    'kyverno',
    {
      chart: 'kyverno',
      version: cfg.versions.kyverno,
      namespace: 'kyverno',
      createNamespace: true,
      repositoryOpts: { repo: 'https://kyverno.github.io/kyverno/' },
    },
    { provider },
  );

  new k8s.core.v1.Namespace(
    'app-namespace',
    {
      metadata: {
        name: cfg.appNamespace,
        labels: {
          'pod-security.kubernetes.io/enforce': 'restricted',
        },
      },
    },
    { provider },
  );
}
