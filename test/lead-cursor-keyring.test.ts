import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LEAD_CURSOR_KEYRING,
  buildLeadCursorExternalSecretArgs,
  buildLeadCursorSecretStoreArgs,
  buildLeadCursorServiceAccountArgs,
  buildLeadCursorVaultAuthRoleArgs,
  buildLeadCursorVaultMountArgs,
  buildLeadCursorVaultPolicyArgs,
  leadCursorVaultPolicy,
} from '../src/lead-cursor-keyring';

describe('lead cursor keyring IAM', () => {
  it('binds the exact read-only Vault path only to the API workload identity', () => {
    const role = buildLeadCursorVaultAuthRoleArgs('tequity');

    expect(leadCursorVaultPolicy).toBe(
      'path "tequity-api-leads-cursor/data/keyring" {\n  capabilities = ["read"]\n}',
    );
    expect(buildLeadCursorVaultMountArgs()).toEqual({
      path: 'tequity-api-leads-cursor',
      type: 'kv-v2',
      description: 'API-only lead cursor HMAC keyring',
      listingVisibility: 'hidden',
    });
    expect(buildLeadCursorVaultPolicyArgs()).toEqual({
      name: LEAD_CURSOR_KEYRING.vaultPolicyName,
      policy: leadCursorVaultPolicy,
    });
    expect(role.boundServiceAccountNames).toEqual(['tequity-api']);
    expect(role.boundServiceAccountNamespaces).toEqual(['tequity']);
    expect(role.tokenPolicies).toEqual([LEAD_CURSOR_KEYRING.vaultPolicyName]);
    expect(role.tokenNoDefaultPolicy).toBe(true);
    expect(role.tokenType).toBe('batch');
    expect(role.tokenTtl).toBe(600);
    expect(role.tokenMaxTtl).toBe(600);
    expect(role.tokenExplicitMaxTtl).toBe(600);
    expect(JSON.stringify(role)).not.toMatch(/\b(worker|ui)\b|\*/i);
    expect(leadCursorVaultPolicy).not.toMatch(/\b(create|delete|list|patch|sudo|update)\b/i);
  });

  it('uses a non-automounted API service account for Vault authentication', () => {
    const serviceAccount = buildLeadCursorServiceAccountArgs('tequity');
    const store = buildLeadCursorSecretStoreArgs('tequity');
    const vaultAuth = (store.spec as any).provider.vault.auth.kubernetes;

    expect(serviceAccount.metadata).toMatchObject({
      name: LEAD_CURSOR_KEYRING.apiServiceAccountName,
      namespace: 'tequity',
    });
    expect(serviceAccount.automountServiceAccountToken).toBe(false);
    expect(vaultAuth).toEqual({
      mountPath: LEAD_CURSOR_KEYRING.vaultAuthBackend,
      role: LEAD_CURSOR_KEYRING.vaultAuthRoleName,
      serviceAccountRef: {
        name: LEAD_CURSOR_KEYRING.apiServiceAccountName,
        audiences: ['vault'],
      },
    });
  });
});

describe('lead cursor keyring secret flow', () => {
  it('serializes only a Vault reference and one dedicated API Secret key', () => {
    const externalSecret = buildLeadCursorExternalSecretArgs('tequity');
    const spec = externalSecret.spec as any;
    const serialized = JSON.stringify([
      buildLeadCursorVaultPolicyArgs(),
      buildLeadCursorVaultMountArgs(),
      buildLeadCursorVaultAuthRoleArgs('tequity'),
      buildLeadCursorServiceAccountArgs('tequity'),
      buildLeadCursorSecretStoreArgs('tequity'),
      externalSecret,
    ]);

    expect(spec.secretStoreRef).toEqual({
      kind: 'SecretStore',
      name: LEAD_CURSOR_KEYRING.secretStoreName,
    });
    expect(spec.target.name).toBe(LEAD_CURSOR_KEYRING.kubernetesSecretName);
    expect(spec.data).toEqual([
      {
        secretKey: 'LEADS_CURSOR_KEYS_JSON',
        remoteRef: {
          key: 'keyring',
          property: 'LEADS_CURSOR_KEYS_JSON',
        },
      },
    ]);
    expect(serialized).not.toContain('activeKid');
    expect(serialized).not.toMatch(/"keys"\s*:/);
    expect(serialized).not.toMatch(/"secret"\s*:/);
    expect(serialized).not.toContain('tequity-secrets');
    expect(serialized).not.toContain('"path":"secret"');
    expect(serialized).not.toMatch(/\b(worker|ui)\b/i);
  });

  it('retains the target during staged, non-destructive Vault rotation', () => {
    const spec = buildLeadCursorExternalSecretArgs('tequity').spec as any;

    expect(spec.refreshInterval).toBe('1m');
    expect(spec.target.creationPolicy).toBe('Owner');
    expect(spec.target.deletionPolicy).toBe('Retain');
    expect(spec.data).toHaveLength(1);
  });

  it('does not export keyring material as a Pulumi stack output', () => {
    const stack = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');

    expect(stack).not.toMatch(/export\s+(const|let|var)\s+.*(cursor|keyring|secret)/i);
    expect(stack).not.toMatch(/pulumi\.(secret|output)\s*\(/i);
  });

  it('documents additive rotation, bounded retention, emergency invalidation, and auditing', () => {
    const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');

    expect(readme).toContain('Add the new key');
    expect(readme).toContain('longest cursor TTL');
    expect(readme).toContain('later audited deployment');
    expect(readme).toContain('Emergency compromise');
    expect(readme).toContain('invalidates outstanding cursors');
  });
});
