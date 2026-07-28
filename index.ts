import * as k8s from '@pulumi/kubernetes';
import { loadSettings } from './src/config';
import { deployPolicies } from './src/policy';
import { deployDependencies } from './src/dependencies';
import { deployObservability } from './src/observability';
import { deploySecrets } from './src/secrets';
import { deployConnectorDatabase } from './src/connector-database';

// Cloud-agnostic: target whatever kube context is configured. Locally that is a
// kind cluster; in cloud it is the cluster created by a provider module under
// src/providers/ (opt-in; e.g. GKE). The in-cluster platform below is identical
// everywhere.
const cfg = loadSettings();
const provider = new k8s.Provider('tequity', { context: cfg.kubeContext });

// 1. Harden the cluster (admission policy, Pod Security, network defaults).
deployPolicies(provider, cfg);
// 2. Install the required dependencies (Postgres, Redis, Vault, Temporal).
const dependencies = deployDependencies(provider, cfg);
// 3. Stand up the observability stack (Prometheus/Grafana + OTel collector).
deployObservability(provider, cfg);
// 4. Wire secret sync from the per-project Vault into the cluster.
const secrets = deploySecrets(provider, cfg, dependencies.vault);
// 5. Sync and reconcile the dedicated least-privilege connector DB role only
// after the verified-TLS shared store reaches its audited delivery stage.
if (secrets.vaultStore) {
  deployConnectorDatabase(provider, cfg, {
    postgresql: dependencies.postgresql,
    externalSecrets: secrets.externalSecrets,
    vaultStore: secrets.vaultStore,
  });
}

export const environment = cfg.environment;
export const appNamespace = cfg.appNamespace;
