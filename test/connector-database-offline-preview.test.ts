import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { defaultVersions } from '../src/config';
import {
  CONNECTOR_DATABASE,
  deployConnectorDatabase,
} from '../src/connector-database';

interface RegisteredResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const registeredResources: RegisteredResource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args) => {
      registeredResources.push({
        type: args.type,
        name: args.name,
        inputs: args.inputs,
      });
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: (args) => args.inputs,
  },
  'tequity-infra',
  'connector-offline-preview',
  false,
);

describe('connector database offline Pulumi preview', () => {
  it('registers only references and an effective-privilege-enforcing policy', async () => {
    const provider = new k8s.Provider('connector-offline-kubernetes', {
      context: 'offline-preview',
    });
    const postgresql = new k8s.helm.v3.Release(
      'connector-offline-postgresql',
      {
        chart: 'postgresql',
        version: defaultVersions.postgresql,
        namespace: 'tequity',
      },
      { provider },
    );
    const externalSecrets = new k8s.helm.v3.Release(
      'connector-offline-external-secrets',
      {
        chart: 'external-secrets',
        version: defaultVersions.externalSecrets,
        namespace: 'external-secrets',
      },
      { provider },
    );
    const vaultStore = new k8s.apiextensions.CustomResource(
      'connector-offline-vault-store',
      {
        apiVersion: 'external-secrets.io/v1beta1',
        kind: 'ClusterSecretStore',
        metadata: { name: 'tequity-vault' },
      },
      { provider },
    );

    const connector = deployConnectorDatabase(
      provider,
      {
        environment: 'nonprod',
        kubeContext: 'offline-preview',
        appNamespace: 'tequity',
        leadCursorKeyringStage: 'disabled',
        sharedVaultTlsStage: 'disabled',
      versions: defaultVersions,
      identityProviders: {
        googleClientId: 'tequity-google-client',
        entraClientId: 'tequity-entra-client',
        entraIssuerUrl:
          'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0',
      },
    },
      { postgresql, externalSecrets, vaultStore },
    );

    await new Promise<void>((resolve) => {
      pulumi
        .all([
          connector.configMap.urn,
          connector.externalSecret.urn,
          connector.bootstrapJob.urn,
          connector.reconcileCronJob.urn,
        ])
        .apply(() => resolve());
    });

    const preview = JSON.stringify(registeredResources);
    expect(registeredResources.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'kubernetes:core/v1:ConfigMap',
        'kubernetes:external-secrets.io/v1beta1:ExternalSecret',
        'kubernetes:batch/v1:Job',
        'kubernetes:batch/v1:CronJob',
      ]),
    );
    expect(preview).toContain(CONNECTOR_DATABASE.vaultPath);
    expect(preview).toContain("has_database_privilege('tequity_connector'");
    expect(preview).toContain("has_schema_privilege('tequity_connector'");
    expect(preview).toContain("has_table_privilege('tequity_connector'");
    expect(preview).toContain("has_function_privilege('tequity_connector'");
    expect(preview).toContain('revoke all privileges on all functions in schema public from public');
    expect(preview).not.toMatch(/postgresql:\/\/tequity_connector:(?!\{\{)/);
    expect(preview).not.toMatch(/["']password["']\s*:\s*["'][a-f0-9]{32,}["']/i);
  });
});
