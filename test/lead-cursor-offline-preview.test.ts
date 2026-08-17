import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { defaultVersions, type Settings } from '../src/config';
import {
  deployLeadCursorKeyringBootstrap,
  deployLeadCursorKeyringDelivery,
} from '../src/lead-cursor-keyring';

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
  'offline-preview',
  false,
);

describe('lead cursor keyring offline Pulumi preview', () => {
  it('separates protected bootstrap from secret delivery without plaintext inputs', async () => {
    const provider = new k8s.Provider('offline-kubernetes', {
      context: 'offline-preview',
    });
    const externalSecrets = new k8s.helm.v3.Release(
      'offline-external-secrets',
      {
        chart: 'external-secrets',
        version: defaultVersions.externalSecrets,
        namespace: 'external-secrets',
      },
      { provider },
    );
    const trustedVault = {
      server: 'https://vault.test.invalid:8200',
      caConfigMapName: 'approved-vault-ca',
      caConfigMapKey: 'ca.crt',
      caCertFile: '/approved/trust/vault-ca.pem',
    };
    const settings: Settings = {
      environment: 'nonprod',
      kubeContext: 'offline-preview',
      appNamespace: 'tequity',
      leadCursorKeyringStage: 'bootstrap' as const,
      leadCursorVault: trustedVault,
      leadCursorBootstrapReceipt:
        'https://github.com/tequityapp/tequity-infra/issues/5#issuecomment-123456',
      sharedVaultTlsStage: 'disabled' as const,
      versions: defaultVersions,
      identityProviders: {
        googleClientId: 'tequity-google-client',
        entraClientId: 'tequity-entra-client',
        entraIssuerUrl:
          'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0',
      },
    };
    const bootstrap = deployLeadCursorKeyringBootstrap(
      provider,
      settings,
    );

    await new Promise<void>((resolve) => {
      pulumi
        .all([
          bootstrap.mount.urn,
          bootstrap.policy.urn,
          bootstrap.authRole.urn,
          bootstrap.serviceAccount.urn,
        ])
        .apply(() => resolve());
    });

    expect(registeredResources.map(({ type }) => type)).not.toEqual(
      expect.arrayContaining([
        'kubernetes:external-secrets.io/v1beta1:SecretStore',
        'kubernetes:external-secrets.io/v1beta1:ExternalSecret',
      ]),
    );

    const delivery = deployLeadCursorKeyringDelivery(
      provider,
      settings,
      { externalSecrets },
      bootstrap,
    );
    await new Promise<void>((resolve) => {
      pulumi
        .all([delivery.secretStore.urn, delivery.externalSecret.urn])
        .apply(() => resolve());
    });

    expect(registeredResources.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'pulumi:providers:vault',
        'vault:index/mount:Mount',
        'vault:index/policy:Policy',
        'vault:kubernetes/authBackendRole:AuthBackendRole',
        'kubernetes:core/v1:ServiceAccount',
        'kubernetes:external-secrets.io/v1beta1:SecretStore',
        'kubernetes:external-secrets.io/v1beta1:ExternalSecret',
      ]),
    );
    expect(registeredResources.map(({ type }) => type)).not.toContain(
      'kubernetes:core/v1:Secret',
    );

    const preview = JSON.stringify(registeredResources);
    expect(preview).toContain('tequity-api-leads-cursor/data/keyring');
    expect(preview).toContain('https://vault.test.invalid:8200');
    expect(preview).not.toContain('http://');
    expect(preview).not.toMatch(/"skipTlsVerify":true/);
    expect(preview).not.toContain('activeKid');
    expect(preview).not.toMatch(/"keys"\s*:/);
    expect(preview).not.toMatch(/"secret"\s*:/);
  });
});
