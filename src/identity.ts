import {
  VerjsonIdentityDeploymentProfile,
  type VerjsonIdentityDeploymentProfileArgs,
} from '@verjson/infra';
import type { CloudEnvironment } from './config';
import {
  assertPlatformClaimAllowlist,
  platformClaimAllowlist,
  platformPermissions,
  securityControlPopulationId,
} from './platform-permissions';

export type IdentityEnvironment = CloudEnvironment;

export const initialOperatorSubject =
  '5fc54cd0-5f6c-41bf-a44c-cd9e0a6439b1';
export const platformOperatorPermissions = platformPermissions;

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

const entraTenantId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const entraIssuerUrl = validateEntraIssuerUrl(providers.entraIssuerUrl);
  const allowlist = assertPlatformClaimAllowlist(
    platformClaimAllowlist(environment),
  );
  if (allowlist.issuer !== contract.issuerUrl) {
    throw new TypeError(
      'Platform claim allowlist issuer must be this environment\'s own issuer',
    );
  }
  const securityControlPopulation = allowlist.populations.find(
    (population) => population.id === securityControlPopulationId,
  );
  if (!securityControlPopulation) {
    throw new TypeError(
      `Allowlist declares no ${securityControlPopulationId} population`,
    );
  }
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
      acr: allowlist.requiredAcr,
      maxAgeSeconds: allowlist.maxAuthAgeSeconds,
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
        issuerUrl: entraIssuerUrl,
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
        permissionProfileId: securityControlPopulationId,
        permissions: [...securityControlPopulation.permissions],
      },
    ],
    // The catalog is DERIVED from the allowlist rather than restated, so a
    // population added or widened there cannot reach a deployment without passing
    // the provenance boundary assertPlatformClaimAllowlist enforces. The catalog
    // version is unchanged: the emitted permission vocabulary is the same six
    // exact permissions, and what this adds is a minting-side constraint on who
    // may hold two of them, not a new claim for a consumer to understand.
    permissionCatalog: {
      version: 'tequity-authz-v2',
      permissions: [...platformPermissions],
      operatorPermissionProfiles: allowlist.populations.map((population) => ({
        id: population.id,
        permissions: [...population.permissions],
      })),
    },
  };
}

function validateEntraIssuerUrl(value: string): string {
  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    throw new TypeError('Entra issuer must be an exact tenant-specific HTTPS URL');
  }

  const tenantId = issuer.pathname.split('/')[1] ?? '';
  const canonicalIssuerUrl =
    `https://login.microsoftonline.com/${tenantId.toLowerCase()}/v2.0`;
  if (
    issuer.origin !== 'https://login.microsoftonline.com'
    || issuer.username !== ''
    || issuer.password !== ''
    || issuer.search !== ''
    || issuer.hash !== ''
    || !entraTenantId.test(tenantId)
    || issuer.pathname !== `/${tenantId}/v2.0`
    || value !== canonicalIssuerUrl
  ) {
    throw new TypeError('Entra issuer must be an exact tenant-specific HTTPS URL');
  }

  return value;
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
