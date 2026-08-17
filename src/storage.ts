import {
  VerjsonSpacesBucket,
  type VerjsonSpacesBucketArgs,
} from '@verjson/infra';

export const managedEnvironments = ['nonprod', 'prod'] as const;
export type ManagedEnvironment = (typeof managedEnvironments)[number];

const storageContracts = {
  nonprod: {
    bucketName: 'tequity-nonprod',
    uploadOrigin: 'https://dev.tequity.app',
  },
  prod: {
    bucketName: 'tequity',
    uploadOrigin: 'https://tequity.app',
  },
} as const;

export function storageDeploymentArgs(
  environment: ManagedEnvironment,
): VerjsonSpacesBucketArgs {
  const contract = storageContracts[environment];
  return {
    environment,
    region: 'nyc3',
    bucketName: contract.bucketName,
    allowedOrigins: [contract.uploadOrigin],
    ...(environment === 'prod'
      ? {
          bucketImportId: 'nyc3,tequity',
          corsImportId: 'nyc3,tequity',
        }
      : {}),
  };
}

export function deployStorage(environment: ManagedEnvironment): void {
  new VerjsonSpacesBucket(
    `tequity-storage-${environment}`,
    storageDeploymentArgs(environment),
  );
}
