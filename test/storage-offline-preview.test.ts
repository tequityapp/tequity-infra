import { VerjsonSpacesBucket } from '@verjson/infra';
import * as pulumi from '@pulumi/pulumi';
import { storageDeploymentArgs, type ManagedEnvironment } from '../src/storage';

/**
 * tequity-infra#13 asks for evidence that a production apply ADOPTS the existing
 * authoritative Spaces bucket and configures exact CORS on it, rather than replacing
 * it or reaching anything else. A credential-free offline preview is the part of that
 * evidence this repository can produce on its own; `scripts/spaces-cors-probe.sh`
 * produces the live half against the real endpoint.
 */

interface RegisteredResource {
  type: string;
  name: string;
  id: string;
  inputs: Record<string, unknown>;
}

const registered: RegisteredResource[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      registered.push({
        type: args.type,
        name: args.name,
        id: args.id ?? '',
        inputs: args.inputs,
      });
      return {
        id: args.id || `${args.name}-id`,
        state: { ...args.inputs, endpoint: 'tequity.nyc3.digitaloceanspaces.com' },
      };
    },
    call: (args) => args.inputs,
  },
  'tequity-infra',
  'storage-offline-preview',
  false,
);

const approvedProductionOrigins = ['https://tequity.app'];
const authoritativeImportId = 'nyc3,tequity';

async function preview(environment: ManagedEnvironment) {
  registered.length = 0;
  const bucket = new VerjsonSpacesBucket(
    `tequity-storage-${environment}`,
    storageDeploymentArgs(environment),
  );
  await Promise.all([
    new Promise((resolve) => bucket.bucket.id.apply(resolve)),
    new Promise((resolve) => bucket.corsConfiguration.id.apply(resolve)),
  ]);
  return { bucket, registered: [...registered] };
}

describe('production Spaces offline preview', () => {
  it('adopts the authoritative bucket instead of creating a replacement', async () => {
    const { registered: resources } = await preview('prod');

    const bucket = resources.find(
      (resource) =>
        resource.type === 'digitalocean:index/spacesBucket:SpacesBucket',
    );
    const cors = resources.find((resource) =>
      resource.type.endsWith('SpacesBucketCorsConfiguration'),
    );

    // A concrete id on registration is an import: Pulumi adopts the existing object
    // rather than planning a create, which is what "no replacement" means here.
    expect(bucket?.id).toBe(authoritativeImportId);
    expect(cors?.id).toBe(authoritativeImportId);
    expect(bucket?.inputs).toMatchObject({
      name: 'tequity',
      region: 'nyc3',
      acl: 'private',
      forceDestroy: false,
      versioning: { enabled: true },
    });
  });

  it('touches nothing beyond the bucket and its CORS configuration', async () => {
    const { registered: resources } = await preview('prod');

    expect(resources.map((resource) => resource.type)).toEqual([
      'verjson:infra:SpacesBucket',
      'digitalocean:index/spacesBucket:SpacesBucket',
      'digitalocean:index/spacesBucketCorsConfiguration:SpacesBucketCorsConfiguration',
    ]);
  });

  it('protects the production bucket from a destructive plan', async () => {
    const { bucket } = await preview('prod');

    expect((bucket as unknown as { __protect: boolean }).__protect).toBe(true);
  });

  it('configures exactly the approved origin, method, and headers', async () => {
    const { registered: resources } = await preview('prod');
    const cors = resources.find((resource) =>
      resource.type.endsWith('SpacesBucketCorsConfiguration'),
    );

    expect(cors?.inputs.corsRules).toEqual([
      {
        allowedHeaders: ['Content-Type', 'If-None-Match'],
        allowedMethods: ['PUT'],
        allowedOrigins: approvedProductionOrigins,
      },
    ]);
  });

  it('never widens any CORS field to a wildcard', async () => {
    const { registered: resources } = await preview('prod');

    expect(JSON.stringify(resources)).not.toContain('"*"');
    expect(JSON.stringify(resources)).not.toMatch(
      /GET|POST|DELETE|HEAD|Authorization/,
    );
  });

  it('carries no credential or ciphertext into the preview', async () => {
    const { registered: resources } = await preview('prod');

    expect(JSON.stringify(resources)).not.toMatch(
      /accessKey|secretKey|DO_S3_TOKEN|ciphertext|Bearer /i,
    );
  });

  it('imports only the authoritative bucket, never the nonprod one', async () => {
    expect(storageDeploymentArgs('prod')).toMatchObject({
      bucketImportId: authoritativeImportId,
      corsImportId: authoritativeImportId,
    });
    expect(storageDeploymentArgs('nonprod')).not.toHaveProperty(
      'bucketImportId',
    );
    expect(storageDeploymentArgs('nonprod')).not.toHaveProperty('corsImportId');
  });
});
