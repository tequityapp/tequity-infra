import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { defaultVersions } from '../src/config';
import { deployLeadCursorKeyring } from '../src/lead-cursor-keyring';

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
  it('registers references and IAM metadata without a plaintext Secret or stack output', async () => {
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
    const resources = deployLeadCursorKeyring(
      provider,
      {
        environment: 'offline-preview',
        kubeContext: 'offline-preview',
        appNamespace: 'tequity',
        leadCursorKeyringEnabled: true,
        versions: defaultVersions,
      },
      { externalSecrets },
    );

    await new Promise<void>((resolve) => {
      pulumi
        .all([
          resources.mount.urn,
          resources.policy.urn,
          resources.authRole.urn,
          resources.serviceAccount.urn,
          resources.secretStore.urn,
          resources.externalSecret.urn,
        ])
        .apply(() => resolve());
    });

    expect(registeredResources.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
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
    expect(preview).not.toContain('activeKid');
    expect(preview).not.toMatch(/"keys"\s*:/);
    expect(preview).not.toMatch(/"secret"\s*:/);
  });
});
