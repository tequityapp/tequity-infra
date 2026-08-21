import type { CloudEnvironment } from './config';

/**
 * The authoritative allowlist for platform-only exact-permission claims
 * (tequity-infra#14, ADR-0055).
 *
 * `@verjson/infra` already refuses an operator profile whose permissions do not
 * match its named catalog profile. What it has no concept of is WHICH issuer may
 * mint a platform claim and WHICH operator population may hold the provenance
 * permissions. That is the boundary this module owns, and it is enforced rather
 * than documented: every decision here fails closed on any input it cannot fully
 * model.
 */

export const platformPermissions = [
  'platform:read',
  'tenant:provision',
  'tenant:setBilling',
  'billing:admin',
  'lead:provenance:read',
  'lead:provenance:erase',
] as const;

export type PlatformPermission = (typeof platformPermissions)[number];

/** Reading or erasing pre-account lead provenance (ADR-0038). */
export const provenancePermissions = [
  'lead:provenance:read',
  'lead:provenance:erase',
] as const;

/** The one population that may hold the provenance permissions. */
export const securityControlPopulationId = 'security-control-operator';

/**
 * Upstream federated issuers. A Google or Entra assertion is exchanged at the
 * Tequity issuer before it can carry platform claims; it never carries them
 * directly, so neither may ever be the platform issuer.
 */
export const upstreamIssuers = [
  'https://accounts.google.com',
  'https://login.microsoftonline.com',
] as const;

/** Mirrors the identity profile's step-up contract; provenance may not be looser. */
const maxStepUpAgeSeconds = 300;
const requiredStepUpAcr = 'mfa';

export interface OperatorPopulation {
  readonly id: string;
  readonly permissions: readonly PlatformPermission[];
}

export interface PlatformClaimAllowlist {
  readonly issuer: string;
  readonly populations: readonly OperatorPopulation[];
  readonly provenancePopulationIds: readonly string[];
  readonly requiredAcr: string;
  readonly maxAuthAgeSeconds: number;
}

export interface PlatformClaim {
  readonly issuer: string;
  readonly populationId: string;
  readonly acr: string;
  readonly authAgeSeconds: number;
}

const platformIssuers: Record<CloudEnvironment, string> = {
  nonprod: 'https://auth.dev.tequity.app',
  prod: 'https://auth.tequity.app',
};

const populations: readonly OperatorPopulation[] = [
  { id: 'platform-read-only-operator', permissions: ['platform:read'] },
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
    permissions: [...platformPermissions],
  },
];

export function platformClaimAllowlist(
  environment: CloudEnvironment,
): PlatformClaimAllowlist {
  return assertPlatformClaimAllowlist({
    issuer: platformIssuers[environment],
    populations,
    provenancePopulationIds: [securityControlPopulationId],
    requiredAcr: requiredStepUpAcr,
    maxAuthAgeSeconds: maxStepUpAgeSeconds,
  });
}

export function assertPlatformClaimAllowlist(
  allowlist: PlatformClaimAllowlist,
): PlatformClaimAllowlist {
  assertCanonicalIssuer(allowlist.issuer);

  const known = new Set<string>(platformPermissions);
  const seen = new Set<string>();
  for (const population of allowlist.populations) {
    if (!population.id) {
      throw new TypeError('Every operator population must carry an id');
    }
    if (seen.has(population.id)) {
      throw new TypeError(`Duplicate operator population: ${population.id}`);
    }
    seen.add(population.id);
    for (const permission of population.permissions) {
      if (!known.has(permission)) {
        throw new TypeError(
          `Population ${population.id} holds an unknown permission: ${permission}`,
        );
      }
    }
  }

  if (allowlist.provenancePopulationIds.length === 0) {
    throw new TypeError(
      'At least one population must be designated to hold lead provenance permissions',
    );
  }
  const designated = new Set(allowlist.provenancePopulationIds);
  for (const id of designated) {
    if (!seen.has(id)) {
      throw new TypeError(
        `Provenance population ${id} is not a declared operator population`,
      );
    }
  }
  for (const population of allowlist.populations) {
    if (designated.has(population.id)) continue;
    for (const permission of provenancePermissions) {
      if (population.permissions.includes(permission)) {
        throw new TypeError(
          `Population ${population.id} may not hold ${permission}`,
        );
      }
    }
  }

  if (allowlist.requiredAcr !== requiredStepUpAcr) {
    throw new TypeError(
      `Platform provenance claims require acr ${requiredStepUpAcr}`,
    );
  }
  if (
    !Number.isInteger(allowlist.maxAuthAgeSeconds)
    || allowlist.maxAuthAgeSeconds < 1
    || allowlist.maxAuthAgeSeconds > maxStepUpAgeSeconds
  ) {
    throw new TypeError(
      `maxAuthAgeSeconds must be a positive integer no greater than ${maxStepUpAgeSeconds}`,
    );
  }

  return allowlist;
}

/**
 * The permissions a presented claim may carry. Anything this function cannot
 * positively justify resolves to nothing.
 */
export function resolvePlatformPermissions(
  allowlist: PlatformClaimAllowlist,
  claim: PlatformClaim,
): PlatformPermission[] {
  if (!isExactIssuer(allowlist.issuer, claim.issuer)) return [];

  const population = allowlist.populations.find(
    (candidate) => candidate.id === claim.populationId,
  );
  if (!population) return [];

  if (mayMintProvenance(allowlist, claim)) return [...population.permissions];

  return population.permissions.filter(
    (permission) =>
      !(provenancePermissions as readonly string[]).includes(permission),
  );
}

export function mayMintProvenance(
  allowlist: PlatformClaimAllowlist,
  claim: PlatformClaim,
): boolean {
  if (!isExactIssuer(allowlist.issuer, claim.issuer)) return false;
  if (!allowlist.provenancePopulationIds.includes(claim.populationId)) {
    return false;
  }
  const population = allowlist.populations.find(
    (candidate) => candidate.id === claim.populationId,
  );
  if (!population) return false;
  if (
    !provenancePermissions.every((permission) =>
      population.permissions.includes(permission),
    )
  ) {
    return false;
  }
  if (claim.acr !== allowlist.requiredAcr) return false;
  return (
    Number.isInteger(claim.authAgeSeconds)
    && claim.authAgeSeconds >= 0
    && claim.authAgeSeconds <= allowlist.maxAuthAgeSeconds
  );
}

function isExactIssuer(expected: string, presented: string): boolean {
  if (typeof presented !== 'string' || presented !== expected) return false;
  try {
    assertCanonicalIssuer(presented);
    return true;
  } catch {
    return false;
  }
}

// A canonical issuer is an exact https origin and nothing else. The parsed URL
// and the raw string must agree, so any shape the parser would normalize --
// a trailing slash, an uppercase host, a default port, a percent-encoded label,
// a backslash separator -- is rejected instead of silently accepted.
const canonicalHost = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function assertCanonicalIssuer(value: string): string {
  const invalid = (): never => {
    throw new TypeError(
      'Platform issuer must be an exact canonical https origin',
    );
  };

  if (typeof value !== 'string' || value === '') invalid();
  if (!value.startsWith('https://')) invalid();

  const host = value.slice('https://'.length);
  if (!canonicalHost.test(host)) invalid();

  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    return invalid();
  }
  if (
    issuer.protocol !== 'https:'
    || issuer.username !== ''
    || issuer.password !== ''
    || issuer.port !== ''
    || issuer.search !== ''
    || issuer.hash !== ''
    || issuer.pathname !== '/'
    || issuer.hostname !== host
    || issuer.origin !== value
  ) {
    invalid();
  }

  for (const upstream of upstreamIssuers) {
    if (value === upstream || value.startsWith(`${upstream}/`)) {
      throw new TypeError(
        `Platform issuer must not be the upstream federated issuer ${upstream}`,
      );
    }
  }

  return value;
}
