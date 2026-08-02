import { VerjsonSpacesBucket } from '@verjson/infra';
import * as pulumi from '@pulumi/pulumi';
import { readFileSync } from 'node:fs';
import {
  storageDeploymentArgs,
  type ManagedEnvironment,
} from '../src/storage';

const resources: pulumi.runtime.MockResourceArgs[] = [];

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => {
    resources.push(args);
    return {
      id: args.id || `${args.name}-id`,
      state: { ...args.inputs, endpoint: 'tequity.nyc3.digitaloceanspaces.com' },
    };
  },
  call: () => ({}),
});

describe.each([
  ['nonprod', 'tequity-nonprod', 'https://dev.tequity.app'],
  ['prod', 'tequity', 'https://tequity.app'],
] as const)(
  '%s storage contract',
  (environment, bucketName, uploadOrigin) => {
    it('declares the exact private versioned bucket and PUT-only CORS policy', async () => {
      resources.length = 0;
      const bucket = new VerjsonSpacesBucket(
        `tequity-storage-${environment}`,
        storageDeploymentArgs(environment as ManagedEnvironment),
      );
      await Promise.all([
        outputValue(bucket.bucket.id),
        outputValue(bucket.corsConfiguration.id),
      ]);

      expect(resources[1]?.inputs).toMatchObject({
        name: bucketName,
        region: 'nyc3',
        acl: 'private',
        forceDestroy: false,
        versioning: { enabled: true },
      });
      expect(resources[2]?.inputs.corsRules).toEqual([
        {
          allowedHeaders: ['Content-Type', 'If-None-Match'],
          allowedMethods: ['PUT'],
          allowedOrigins: [uploadOrigin],
        },
      ]);
      if (environment === 'prod') {
        expect(storageDeploymentArgs(environment)).toMatchObject({
          bucketImportId: 'tequity',
          corsImportId: 'nyc3,tequity',
        });
        expect((bucket as unknown as { __protect: boolean }).__protect).toBe(
          true,
        );
      }
    });
  },
);

describe.each([
  [
    'nonprod',
    ['Tequity/tequity/shared', 'Tequity/tequity/nonprod'],
  ],
  [
    'prod',
    ['Tequity/tequity/shared', 'Tequity/tequity/prod'],
  ],
] as const)('%s stack contract', (environment, expectedRefs) => {
  it('composes only the fully qualified Tequity ESC environments in order', () => {
    const stack = readFileSync(`Pulumi.${environment}.yaml`, 'utf8');
    const refs = stack
      .split('\n')
      .filter((line) => line.startsWith('  - '))
      .map((line) => line.slice(4));

    expect(refs).toEqual(expectedRefs);
    expect(stack).not.toMatch(/Verjson|Fandemic|DO_S3_TOKEN|ciphertext|secure:/);
  });
});

function outputValue<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => output.apply(resolve));
}
