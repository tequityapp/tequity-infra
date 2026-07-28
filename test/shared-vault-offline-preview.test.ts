import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { defaultVersions, type Settings } from '../src/config';
import { deployDependencies } from '../src/dependencies';
import { deploySecrets } from '../src/secrets';

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
  'shared-vault-offline-preview',
  false,
);

describe('shared Vault TLS offline Pulumi preview', () => {
  it('registers only the TLS chart and HTTPS store boundary', async () => {
    const provider = new k8s.Provider('shared-vault-offline-kubernetes', {
      context: 'offline-preview',
    });
    const settings: Settings = {
      environment: 'offline-preview',
      kubeContext: 'offline-preview',
      appNamespace: 'tequity',
      leadCursorKeyringStage: 'disabled',
      sharedVaultTlsStage: 'delivery',
      sharedVaultTls: {
        caConfigMapName: 'approved-vault-ca',
        caConfigMapKey: 'ca.crt',
        tlsSecretName: 'vault-server-tls',
        tlsCertKey: 'tls.crt',
        tlsPrivateKeyKey: 'tls.key',
      },
      sharedVaultTlsReceipt:
        'https://github.com/tequityapp/tequity-infra/issues/10#issuecomment-123456',
      versions: defaultVersions,
    };

    const dependencies = deployDependencies(provider, settings);
    const secrets = deploySecrets(provider, settings, dependencies.vault);
    if (!dependencies.vault || !secrets.vaultStore) {
      throw new Error('offline delivery preview did not register Vault resources');
    }

    await new Promise<void>((resolve) => {
      pulumi
        .all([dependencies.vault!.urn, secrets.vaultStore!.urn])
        .apply(() => resolve());
    });

    const preview = JSON.stringify(registeredResources);
    expect(preview).toContain('https://vault.tequity:8200');
    expect(preview).toContain('/vault/tls/ca/ca.crt');
    expect(preview).toContain('tls_disable = 0');
    expect(preview).not.toContain('http://vault');
    expect(preview).not.toContain('tls-skip-verify');
    expect(preview).not.toContain('VAULT_SKIP_VERIFY');
    expect(registeredResources.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['vault', 'tequity-vault-store']),
    );
  });
});
