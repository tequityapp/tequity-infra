import {
  VerjsonIdentityDeploymentProfile,
  type VerjsonIdentityDeploymentProfileArgs,
} from '@verjson/infra';

export const identityEnvironments = ['nonprod', 'prod'] as const;
export type IdentityEnvironment = (typeof identityEnvironments)[number];

export const initialOperatorSubject =
  '5fc54cd0-5f6c-41bf-a44c-cd9e0a6439b1';
export const platformOperatorPermissions = [
  'platform:read',
  'tenant:provision',
  'tenant:setBilling',
  'billing:admin',
  'lead:provenance:read',
  'lead:provenance:erase',
] as const;

const identityContracts = {
  nonprod: {
    issuerUrl: 'https://auth.dev.tequity.app',
    audience: 'https://api.dev.tequity.app',
    escEnvironmentRefs: [
      'Tequity/tequity/shared',
      'Tequity/tequity/nonprod',
    ],
  },
  prod: {
    issuerUrl: 'https://auth.tequity.app',
    audience: 'https://api.tequity.app',
    escEnvironmentRefs: [
      'Tequity/tequity/shared',
      'Tequity/tequity/prod',
    ],
  },
} as const;

export interface IdentityProviderSettings {
  googleClientId: string;
  entraClientId: string;
  entraIssuerUrl: string;
}

export function identityDeploymentArgs(
  environment: IdentityEnvironment,
  providers: IdentityProviderSettings,
): VerjsonIdentityDeploymentProfileArgs {
  const contract = identityContracts[environment];
  return {
    environment,
    issuerUrl: contract.issuerUrl,
    audiences: [contract.audience],
    jwks: {
      publicUrl: `${contract.issuerUrl}/.well-known/jwks.json`,
      routePath: '/.well-known/jwks.json',
    },
    vaultSigningKey: {
      uri: `vault://identity/${environment}/session-signing/current#privateKeyPem`,
    },
    escEnvironmentRefs: [...contract.escEnvironmentRefs],
    allowedAlgorithms: ['RS256'],
    token: {
      lifetimeSeconds: 300,
      rotationOverlapSeconds: 600,
    },
    mfa: {
      acr: 'mfa',
      maxAgeSeconds: 300,
      secondFactors: ['totp', 'passkey'],
    },
    upstreamProviders: [
      {
        id: 'google',
        type: 'google',
        issuerUrl: 'https://accounts.google.com',
        clientId: providers.googleClientId,
        clientSecretRef: `vault://identity/${environment}/upstreams/google#clientSecret`,
      },
      {
        id: 'entra',
        type: 'entra',
        issuerUrl: providers.entraIssuerUrl,
        clientId: providers.entraClientId,
        clientSecretRef: `vault://identity/${environment}/upstreams/entra#clientSecret`,
      },
    ],
    subjectResolution: {
      strategy: 'required-immutable-internal-subject',
      resolverId: 'tequity-subject-registry',
    },
    operatorProfiles: [
      {
        subject: initialOperatorSubject,
        permissionProfileId: 'full-platform-operator',
        permissions: [...platformOperatorPermissions],
      },
    ],
    permissionCatalog: {
      version: 'tequity-authz-v2',
      permissions: [...platformOperatorPermissions],
      operatorPermissionProfiles: [
        {
          id: 'full-platform-operator',
          permissions: [...platformOperatorPermissions],
        },
      ],
    },
  };
}

export function deployIdentity(
  environment: IdentityEnvironment,
  providers: IdentityProviderSettings,
): VerjsonIdentityDeploymentProfile {
  return VerjsonIdentityDeploymentProfile.create(
    `tequity-identity-${environment}`,
    identityDeploymentArgs(environment, providers),
  );
}
