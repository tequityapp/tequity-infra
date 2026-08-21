import {
  VerjsonIdentityDeploymentProfile,
  validateIdentityDeploymentProfile,
  type VerjsonIdentityDeploymentProfileArgs,
} from '@verjson/infra';
import * as pulumi from '@pulumi/pulumi';
import { identityDeploymentArgs } from '../src/identity';
import { securityControlPopulationId } from '../src/platform-permissions';

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => {
    return { id: `${args.name}-id`, state: args.inputs };
  },
  call: () => ({}),
});

const providers = {
  googleClientId: 'tequity-google-client',
  entraClientId: 'tequity-entra-client',
  entraIssuerUrl:
    'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0',
};

const expectedInitialOperatorSubject =
  '5fc54cd0-5f6c-41bf-a44c-cd9e0a6439b1';
const expectedPlatformOperatorPermissions = [
  'platform:read',
  'tenant:provision',
  'tenant:setBilling',
  'billing:admin',
  'lead:provenance:read',
  'lead:provenance:erase',
] as const;

describe.each([
  [
    'nonprod',
    'https://auth.dev.tequity.app',
    'https://api.dev.tequity.app',
    ['Tequity/tequity/shared', 'Tequity/tequity/nonprod'],
  ],
  [
    'prod',
    'https://auth.tequity.app',
    'https://api.tequity.app',
    ['Tequity/tequity/shared', 'Tequity/tequity/prod'],
  ],
] as const)(
  '%s identity deployment',
  (environment, issuerUrl, audience, escEnvironmentRefs) => {
    it('normalizes the exact Tequity trust and operator contract', () => {
      const normalized = validateIdentityDeploymentProfile(
        identityDeploymentArgs(environment, providers),
      );

      expect(normalized).toMatchObject({
        environment,
        issuerUrl,
        audiences: [audience],
        jwks: {
          publicUrl: `${issuerUrl}/.well-known/jwks.json`,
          routePath: '/.well-known/jwks.json',
        },
        escEnvironmentRefs,
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
        subjectResolution: {
          strategy: 'required-immutable-internal-subject',
          resolverId: 'tequity-subject-registry',
        },
        operatorProfiles: [
          {
            subject: expectedInitialOperatorSubject,
            permissionProfileId: securityControlPopulationId,
            permissions: expectedPlatformOperatorPermissions,
          },
        ],
      });
      expect(normalized.upstreamProviders).toEqual([
        {
          id: 'google',
          type: 'google',
          issuerUrl: 'https://accounts.google.com',
          clientId: providers.googleClientId,
        },
        {
          id: 'entra',
          type: 'entra',
          issuerUrl: providers.entraIssuerUrl,
          clientId: providers.entraClientId,
        },
      ]);
      expect(normalized.operatorProfiles).toEqual([
        {
          subject: expectedInitialOperatorSubject,
          permissionProfileId: securityControlPopulationId,
          permissions: expectedPlatformOperatorPermissions,
        },
      ]);
      // The catalog now publishes the three operator populations, and only the
      // designated security-control one carries lead provenance (tequity-infra#14).
      expect(normalized.permissionCatalog).toEqual({
        version: 'tequity-authz-v2',
        permissions: expectedPlatformOperatorPermissions,
        operatorPermissionProfiles: [
          {
            id: 'platform-read-only-operator',
            permissions: ['platform:read'],
          },
          {
            id: 'platform-operator',
            permissions: [
              'platform:read',
              'tenant:provision',
              'tenant:setBilling',
              'billing:admin',
            ],
          },
          {
            id: securityControlPopulationId,
            permissions: expectedPlatformOperatorPermissions,
          },
        ],
      });
      for (const profile of normalized.permissionCatalog
        .operatorPermissionProfiles) {
        if (profile.id === securityControlPopulationId) continue;
        expect(profile.permissions).not.toContain('lead:provenance:read');
        expect(profile.permissions).not.toContain('lead:provenance:erase');
      }
      expect(normalized.operatorProfiles[0]?.permissions).toHaveLength(6);
      expect(normalized.permissionCatalog.permissions).toHaveLength(6);
      expect(JSON.stringify(normalized)).not.toMatch(
        /privateKeyPem|clientSecretRef|credential|ciphertext/i,
      );
    });

    it('registers only a secret-free protected profile in production', async () => {
      const profile = VerjsonIdentityDeploymentProfile.create(
        `tequity-identity-${environment}`,
        identityDeploymentArgs(environment, providers),
      );
      const configuration = await outputValue(profile.configuration);

      expect(JSON.stringify(configuration)).not.toMatch(
        /privateKeyPem|clientSecret|credential|ciphertext/i,
      );
      if (environment === 'prod') {
        expect((profile as unknown as { __protect: boolean }).__protect).toBe(
          true,
        );
      }
    });
  },
);

describe('fail-closed identity profile validation', () => {
  const valid = identityDeploymentArgs('nonprod', providers);

  it.each([
    ['non-canonical audience', { audiences: ['https://api.dev.tequity.app/'] }],
    ['wildcard audience', { audiences: ['https://*.dev.tequity.app'] }],
    ['unsupported algorithm', { allowedAlgorithms: ['HS256' as 'RS256'] }],
    ['stale MFA', { mfa: { acr: 'mfa', maxAgeSeconds: 301, secondFactors: ['totp'] } }],
    ['missing TOTP', { mfa: { acr: 'mfa', maxAgeSeconds: 300, secondFactors: ['passkey'] } }],
    ['wrong subject', {
      operatorProfiles: [{
        ...valid.operatorProfiles[0],
        subject: 'operator@example.com',
      }],
    }],
    ['an operator assigned to an undeclared population', {
      operatorProfiles: [{
        ...valid.operatorProfiles[0],
        permissionProfileId: 'tenant-owner',
      }],
    }],
    ['provenance granted to the read-only population', {
      operatorProfiles: [{
        ...valid.operatorProfiles[0],
        permissionProfileId: 'platform-read-only-operator',
      }],
    }],
    ['partial permissions', {
      operatorProfiles: [{
        ...valid.operatorProfiles[0],
        permissions: expectedPlatformOperatorPermissions.slice(0, -1),
      }],
    }],
    ['wildcard permission', {
      operatorProfiles: [{
        ...valid.operatorProfiles[0],
        permissions: [...expectedPlatformOperatorPermissions.slice(0, -1), '*'],
      }],
    }],
    ['wrong ESC order', {
      escEnvironmentRefs: [
        'Tequity/tequity/nonprod',
        'Tequity/tequity/shared',
      ],
    }],
  ] satisfies Array<
    [string, Partial<VerjsonIdentityDeploymentProfileArgs>]
  >)('rejects %s', (_name, change) => {
    expect(() =>
      validateIdentityDeploymentProfile({ ...valid, ...change }),
    ).toThrow();
  });

  it('rejects duplicate, sparse, or excess audience configuration', () => {
    expect(() =>
      validateIdentityDeploymentProfile({
        ...valid,
        audiences: [valid.audiences[0]!, valid.audiences[0]!],
      }),
    ).toThrow(/duplicate/i);

    const sparse = new Array<string>(1);
    expect(() =>
      validateIdentityDeploymentProfile({ ...valid, audiences: sparse }),
    ).toThrow(/sparse/i);

    expect(() =>
      validateIdentityDeploymentProfile({
        ...valid,
        unexpected: true,
      } as VerjsonIdentityDeploymentProfileArgs),
    ).toThrow(/unknown field/i);
  });

  it.each([
    'https://attacker.example/00000000-0000-4000-8000-000000000000/v2.0',
    'https://login.microsoftonline.com/common/v2.0',
    'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000//v2.0',
    'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0/',
    'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000//v2.0//',
    'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/./v2.0',
    'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/%2e/v2.0',
    'https://login.microsoftonline.com\\00000000-0000-4000-8000-000000000000\\v2.0',
    'https://login.microsoftonline.com:443/00000000-0000-4000-8000-000000000000/v2.0',
    'https://LOGIN.MICROSOFTONLINE.COM/00000000-0000-4000-8000-000000000000/v2.0',
    'HTTPS://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0',
    'https://login%2Emicrosoftonline.com/00000000-0000-4000-8000-000000000000/v2.0',
    'https://login.microsoftonline.com/ABCDEF12-3456-4ABC-8DEF-ABCDEF123456/v2.0',
  ])('rejects non-tenant or non-canonical Entra issuer %s', (entraIssuerUrl) => {
    expect(() =>
      validateIdentityDeploymentProfile(
        identityDeploymentArgs('nonprod', { ...providers, entraIssuerUrl }),
      ),
    ).toThrow(/Entra issuer/i);
  });
});

function outputValue<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => output.apply(resolve));
}
