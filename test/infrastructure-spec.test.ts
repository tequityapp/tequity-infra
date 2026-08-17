import { INFRASTRUCTURE_CONTRACT_VERSION, VERJSON_PLATFORM_SLUGS } from '@verjson/infra';
import {
  NONPROD_DOMAIN,
  PROD_DOMAIN,
  tequityInfrastructureSpec,
} from '../src/infrastructure-spec';

/**
 * The spec is a contract with `@verjson/infra`, so these assert the CONTRACT holds — not that a
 * literal object matches another literal. A test that only compared the spec to itself would stay
 * green through a major bump that redefined a capability underneath it.
 */
describe('tequity infrastructure spec', () => {
  it('is written against the contract version this repo depends on', () => {
    // A contract bump is a deliberate migration, not something to discover in a `pulumi up`.
    expect(INFRASTRUCTURE_CONTRACT_VERSION).toBe(1);
  });

  it('uses the platform slug the module already reserves', () => {
    expect(VERJSON_PLATFORM_SLUGS).toContain('tequity');
    expect(tequityInfrastructureSpec('nonprod', {
      region: 'nyc3',
      domain: NONPROD_DOMAIN,
    }).name).toBe('tequity');
  });

  it.each([
    ['nonprod', NONPROD_DOMAIN],
    ['prod', PROD_DOMAIN],
  ] as const)('resolves %s onto DigitalOcean at its own hostname', (environment, domain) => {
    const spec = tequityInfrastructureSpec(environment, { region: 'nyc3', domain });

    expect(spec.target).toBe('digitalocean');
    expect(spec.environment).toBe(environment);
    expect(spec.domain).toBe(domain);
  });

  it('asks for every capability tequity runs', () => {
    const spec = tequityInfrastructureSpec('nonprod', { region: 'nyc3', domain: NONPROD_DOMAIN });

    // Each of these has a running counterpart in docker-compose today, so a capability silently
    // dropping to false is a service that exists locally and not in the cloud.
    for (const capability of [
      'networking',
      'cluster',
      'edge',
      'observability',
      'secrets',
      'postgres',
      'eventTransport',
      'objectStorage',
    ] as const) {
      expect(spec.capabilities[capability]).toBe(true);
    }
  });

  it('turns identity ON, because the perimeter is a deployed service (ADR-0022)', () => {
    // `platform` leaves identity off by default. verjson-authn being the single public
    // perimeter makes it infrastructure here rather than a library the api imports.
    expect(tequityInfrastructureSpec('prod', {
      region: 'nyc3',
      domain: PROD_DOMAIN,
    }).capabilities.identity).toBe(true);
  });

  it('leaves search OFF, because retrieval runs inside Postgres', () => {
    // pgvector + Apache AGE (ADR-0010). An OpenSearch cluster nobody queries is an unpatched
    // attack surface, not a spare.
    expect(tequityInfrastructureSpec('prod', {
      region: 'nyc3',
      domain: PROD_DOMAIN,
    }).capabilities.search).toBe(false);
  });

  it.each(['', '   '])('refuses to build a spec with region %p', (region) => {
    // The contract requires a region for the digitalocean target. Production's region is fixed
    // by the Spaces bucket that already exists (ADR-0003), so failing closed here is what stops
    // a guessed value reaching an import.
    expect(() => tequityInfrastructureSpec('prod', { region, domain: PROD_DOMAIN }))
      .toThrow(/region/i);
  });

  it.each([
    ['nonprod', undefined],
    ['nonprod', ''],
    ['nonprod', '   '],
    ['prod', undefined],
    ['prod', ''],
    ['prod', '   '],
  ] as const)('refuses a %s spec with domain %p', (environment, domain) => {
    expect(() => tequityInfrastructureSpec(environment, {
      region: 'nyc3',
      domain: domain as string,
    })).toThrow(/domain/i);
  });

  it('does not let an unknown environment through', () => {
    expect(() => tequityInfrastructureSpec(
      'staging' as unknown as 'nonprod',
      { region: 'nyc3', domain: NONPROD_DOMAIN },
    )).toThrow();
  });
});
