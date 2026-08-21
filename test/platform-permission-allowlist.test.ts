import {
  assertPlatformClaimAllowlist,
  platformClaimAllowlist,
  provenancePermissions,
  resolvePlatformPermissions,
  securityControlPopulationId,
  type PlatformClaimAllowlist,
} from '../src/platform-permissions';

const mfaClaim = { acr: 'mfa', authAgeSeconds: 60 };

describe.each(['nonprod', 'prod'] as const)(
  '%s platform claim allowlist',
  (environment) => {
    const allowlist = platformClaimAllowlist(environment);

    it('mints provenance only for the designated security-control population', () => {
      expect(
        resolvePlatformPermissions(allowlist, {
          issuer: allowlist.issuer,
          populationId: securityControlPopulationId,
          ...mfaClaim,
        }),
      ).toEqual(expect.arrayContaining([...provenancePermissions]));
    });

    // The gap tequity-infra#14 exists for: nothing proved that a population OUTSIDE
    // the security-control boundary cannot receive provenance. Each of these is a
    // population that legitimately exists somewhere in the system.
    it.each([
      ['a tenant role', 'tenant-admin'],
      ['a tenant owner', 'tenant-owner'],
      ['a platform read-only operator', 'platform-read-only-operator'],
      ['an unrelated platform operator', 'platform-operator'],
      ['an undeclared population', 'not-a-declared-population'],
      ['a wildcard', '*'],
      ['an empty population', ''],
    ])('never mints provenance for %s', (_label, populationId) => {
      const granted = resolvePlatformPermissions(allowlist, {
        issuer: allowlist.issuer,
        populationId,
        ...mfaClaim,
      });

      for (const permission of provenancePermissions) {
        expect(granted).not.toContain(permission);
      }
    });

    it('grants a declared non-provenance population exactly its own permissions', () => {
      expect(
        resolvePlatformPermissions(allowlist, {
          issuer: allowlist.issuer,
          populationId: 'platform-read-only-operator',
          ...mfaClaim,
        }),
      ).toEqual(['platform:read']);
    });

    it('grants an undeclared population nothing at all', () => {
      expect(
        resolvePlatformPermissions(allowlist, {
          issuer: allowlist.issuer,
          populationId: 'tenant-owner',
          ...mfaClaim,
        }),
      ).toEqual([]);
    });

    // No upstream federated login carries platform claims directly: a Google or Entra
    // assertion is exchanged at the Tequity issuer first.
    it.each([
      ['the Google upstream', 'https://accounts.google.com'],
      [
        'the Entra upstream',
        'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0',
      ],
      ['the other environment', platformClaimAllowlist(
        environment === 'prod' ? 'nonprod' : 'prod',
      ).issuer],
      ['a lookalike host', 'https://auth.tequity.app.attacker.example'],
      ['a subdomain wildcard', 'https://*.tequity.app'],
    ])('mints nothing for a claim issued by %s', (_label, issuer) => {
      expect(
        resolvePlatformPermissions(allowlist, {
          issuer,
          populationId: securityControlPopulationId,
          ...mfaClaim,
        }),
      ).toEqual([]);
    });

    it.each([
      ['no step-up', { acr: 'pwd', authAgeSeconds: 60 }],
      ['an empty acr', { acr: '', authAgeSeconds: 60 }],
      ['a stale authentication', { acr: 'mfa', authAgeSeconds: 301 }],
      ['a negative age', { acr: 'mfa', authAgeSeconds: -1 }],
      ['a non-integer age', { acr: 'mfa', authAgeSeconds: 1.5 }],
      ['an unmeasured age', { acr: 'mfa', authAgeSeconds: Number.NaN }],
    ])('withholds provenance from a session with %s', (_label, claim) => {
      const granted = resolvePlatformPermissions(allowlist, {
        issuer: allowlist.issuer,
        populationId: securityControlPopulationId,
        ...claim,
      });

      for (const permission of provenancePermissions) {
        expect(granted).not.toContain(permission);
      }
      // The rest of the profile survives: step-up gates provenance, not platform access.
      expect(granted).toContain('platform:read');
    });

    it('states the exact issuer, populations, and step-up it enforces', () => {
      expect(assertPlatformClaimAllowlist(allowlist)).toEqual(allowlist);
      expect(allowlist.issuer).toBe(
        environment === 'prod'
          ? 'https://auth.tequity.app'
          : 'https://auth.dev.tequity.app',
      );
      expect(allowlist.provenancePopulationIds).toEqual([
        securityControlPopulationId,
      ]);
      expect(allowlist.requiredAcr).toBe('mfa');
      expect(allowlist.maxAuthAgeSeconds).toBe(300);
      expect(JSON.stringify(allowlist)).not.toMatch(
        /privateKeyPem|clientSecret|credential|ciphertext/i,
      );
    });
  },
);

describe('fail-closed allowlist validation', () => {
  const valid = platformClaimAllowlist('prod');
  const change = (
    patch: Partial<PlatformClaimAllowlist>,
  ): PlatformClaimAllowlist => ({ ...valid, ...patch });

  it.each([
    ['a wildcard issuer', { issuer: 'https://*.tequity.app' }],
    ['a plaintext issuer', { issuer: 'http://auth.tequity.app' }],
    ['a trailing-slash issuer', { issuer: 'https://auth.tequity.app/' }],
    ['a path-bearing issuer', { issuer: 'https://auth.tequity.app/realms/x' }],
    ['a query-bearing issuer', { issuer: 'https://auth.tequity.app?a=b' }],
    ['a fragment-bearing issuer', { issuer: 'https://auth.tequity.app#f' }],
    ['a credentialed issuer', { issuer: 'https://u:p@auth.tequity.app' }],
    ['an explicit-port issuer', { issuer: 'https://auth.tequity.app:443' }],
    ['an uppercase issuer', { issuer: 'https://AUTH.TEQUITY.APP' }],
    ['an uppercase scheme', { issuer: 'HTTPS://auth.tequity.app' }],
    ['a backslash issuer', { issuer: 'https:\\\\auth.tequity.app' }],
    ['a percent-encoded issuer', { issuer: 'https://auth%2Etequity.app' }],
    ['an empty issuer', { issuer: '' }],
  ] satisfies Array<[string, Partial<PlatformClaimAllowlist>]>)(
    'rejects %s',
    (_label, patch) => {
      expect(() => assertPlatformClaimAllowlist(change(patch))).toThrow(
        /issuer/i,
      );
    },
  );

  it('rejects an issuer that is also an upstream federated provider', () => {
    expect(() =>
      assertPlatformClaimAllowlist(
        change({ issuer: 'https://accounts.google.com' }),
      ),
    ).toThrow(/upstream/i);
  });

  it('rejects a provenance population that is not declared', () => {
    expect(() =>
      assertPlatformClaimAllowlist(
        change({ provenancePopulationIds: ['ghost-operator'] }),
      ),
    ).toThrow(/declared/i);
  });

  it('rejects provenance held outside the designated population', () => {
    expect(() =>
      assertPlatformClaimAllowlist(
        change({
          populations: valid.populations.map((population) =>
            population.id === 'platform-operator'
              ? {
                  ...population,
                  permissions: [...population.permissions, 'lead:provenance:read'],
                }
              : population,
          ),
        }),
      ),
    ).toThrow(/lead:provenance:read/);
  });

  it('rejects a wildcard or unknown permission in any population', () => {
    for (const permission of ['*', 'lead:provenance:*', 'platform:write']) {
      expect(() =>
        assertPlatformClaimAllowlist(
          change({
            populations: [
              ...valid.populations,
              { id: 'rogue-operator', permissions: [permission] as never },
            ],
          }),
        ),
      ).toThrow(/permission/i);
    }
  });

  it('rejects duplicate population ids', () => {
    expect(() =>
      assertPlatformClaimAllowlist(
        change({ populations: [...valid.populations, valid.populations[0]!] }),
      ),
    ).toThrow(/duplicate/i);
  });

  it('rejects step-up requirements weaker than the identity profile enforces', () => {
    expect(() =>
      assertPlatformClaimAllowlist(change({ requiredAcr: 'pwd' })),
    ).toThrow(/acr/i);
    expect(() =>
      assertPlatformClaimAllowlist(change({ maxAuthAgeSeconds: 301 })),
    ).toThrow(/maxAuthAgeSeconds/i);
    expect(() =>
      assertPlatformClaimAllowlist(change({ maxAuthAgeSeconds: 0 })),
    ).toThrow(/maxAuthAgeSeconds/i);
  });

  it('rejects an allowlist with no provenance population at all', () => {
    expect(() =>
      assertPlatformClaimAllowlist(change({ provenancePopulationIds: [] })),
    ).toThrow(/provenance/i);
  });
});
