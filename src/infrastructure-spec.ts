import {
  validateInfrastructureSpec,
  type InfrastructureSpecV1,
  type ResolvedInfrastructureSpecV1,
} from '@verjson/infra';

/**
 * Tequity's declaration of the infrastructure it needs, per environment (ADR-0003).
 *
 * `@verjson/infra` owns HOW each capability is built; this file owns WHAT tequity asks for.
 * That boundary is the point of adopting the module: the three overlapping modules this repo
 * grew — an observability stack, a dependency set, a secrets wiring — are capabilities every
 * verJSON platform needs, whereas `connector-database` and `lead-cursor-keyring` are tequity's
 * own invariants and stay here.
 *
 * The spec is validated by the module's own `validateInfrastructureSpec`, not by hand: it is a
 * versioned contract with a published JSON Schema, so a drifting spec should fail the same way a
 * drifting entity fails `tequity-schema`.
 */

/** The platform slug `@verjson/infra` already reserves for us (`VERJSON_PLATFORM_SLUGS`). */
const PLATFORM_NAME = 'tequity';

/**
 * `platform` covers everything tequity runs except two capabilities, both deliberate:
 *
 *  - `identity` is turned ON. ADR-0022 makes `verjson-authn` the single public perimeter for
 *    unauthenticated ingress and reframes it from an in-process library into a deployed service,
 *    so it is infrastructure here, not a dependency of the api.
 *  - `search` stays OFF. Retrieval runs on pgvector and Apache AGE inside Postgres (ADR-0010),
 *    so an OpenSearch cluster would be an unused, unpatched attack surface rather than a spare.
 */
const CAPABILITY_OVERRIDES = { identity: true, search: false } as const;

export interface TequityEnvironmentInputs {
  /**
   * DigitalOcean region. Required by the contract for the `digitalocean` target, and NOT
   * defaulted for `prod`: production already owns a Spaces bucket whose region is authoritative
   * (ADR-0003), and a guessed value here is how live data gets replaced rather than adopted.
   */
  readonly region: string;
  /** Public hostname this environment serves. */
  readonly domain: string;
}

/** Build and validate the spec for one environment. Throws on anything the contract rejects. */
export function tequityInfrastructureSpec(
  environment: 'nonprod' | 'prod',
  inputs: TequityEnvironmentInputs,
): ResolvedInfrastructureSpecV1 {
  if (typeof inputs.domain !== 'string' || inputs.domain.trim() === '') {
    throw new Error('Tequity infrastructure specification: domain is required.');
  }

  const spec: InfrastructureSpecV1 = {
    schemaVersion: 1,
    name: PLATFORM_NAME,
    environment,
    target: 'digitalocean',
    profile: 'platform',
    region: inputs.region,
    domain: inputs.domain,
    capabilities: CAPABILITY_OVERRIDES,
  };

  return validateInfrastructureSpec(spec);
}

/**
 * The nonprod hostname is fixed here because nonprod is greenfield — there is nothing live to
 * adopt, so a wrong value costs a rebuild rather than data. Prod's hostname is supplied by the
 * caller for the same reason its region is.
 */
export const NONPROD_DOMAIN = 'dev.tequity.app';
export const PROD_DOMAIN = 'tequity.app';
