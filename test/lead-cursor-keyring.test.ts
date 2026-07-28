import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LEAD_CURSOR_KEYRING,
  LEAD_CURSOR_BOOTSTRAP_LIFECYCLE,
  LEAD_CURSOR_MOUNT_LIFECYCLE,
  assertLeadCursorVaultConnection,
  buildLeadCursorExternalSecretArgs,
  buildLeadCursorSecretStoreArgs,
  buildLeadCursorServiceAccountArgs,
  buildLeadCursorVaultAuthRoleArgs,
  buildLeadCursorVaultMountArgs,
  buildLeadCursorVaultPolicyArgs,
  buildLeadCursorVaultProviderArgs,
  leadCursorVaultPolicy,
} from '../src/lead-cursor-keyring';

const trustedVault = {
  server: 'https://vault.test.invalid:8200',
  caConfigMapName: 'approved-vault-ca',
  caConfigMapKey: 'ca.crt',
  caCertFile: '/approved/trust/vault-ca.pem',
};

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

  it('protects the mount history and bootstrap IAM from config rollback', () => {
    expect(LEAD_CURSOR_MOUNT_LIFECYCLE).toEqual({
      protect: true,
      retainOnDelete: true,
      deleteBeforeReplace: false,
    });
    expect(LEAD_CURSOR_BOOTSTRAP_LIFECYCLE).toEqual({
      protect: true,
      deleteBeforeReplace: false,
    });
  });

  it('uses a non-automounted API service account for Vault authentication', () => {
    const serviceAccount = buildLeadCursorServiceAccountArgs('tequity');
    const store = buildLeadCursorSecretStoreArgs('tequity', trustedVault);
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
  it('requires HTTPS with explicit trust references for provider and ESO traffic', () => {
    expect(() => assertLeadCursorVaultConnection(trustedVault)).not.toThrow();
    const provider = buildLeadCursorVaultProviderArgs(trustedVault);
    expect(provider).toMatchObject({
      address: trustedVault.server,
      caCertFile: trustedVault.caCertFile,
      skipTlsVerify: false,
      maxLeaseTtlSeconds: 1_200,
    });
    expect(provider).not.toHaveProperty('token');

    for (const server of [
      'http://vault.tequity:8200',
      'https://user:pass@vault.example:8200',
      'https://vault.example:8200/path',
      'https://127.0.0.1:8200',
      'https://localhost:8200',
    ]) {
      expect(() =>
        assertLeadCursorVaultConnection({ ...trustedVault, server }),
      ).toThrow(/trusted HTTPS Vault/i);
    }
  });

  it('serializes only a Vault reference and one dedicated API Secret key', () => {
    const externalSecret = buildLeadCursorExternalSecretArgs('tequity');
    const spec = externalSecret.spec as any;
    const serialized = JSON.stringify([
      buildLeadCursorVaultPolicyArgs(),
      buildLeadCursorVaultMountArgs(),
      buildLeadCursorVaultAuthRoleArgs('tequity'),
      buildLeadCursorServiceAccountArgs('tequity'),
      buildLeadCursorSecretStoreArgs('tequity', trustedVault),
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

    const vault = (buildLeadCursorSecretStoreArgs('tequity', trustedVault).spec as any)
      .provider.vault;
    expect(vault.server).toBe(trustedVault.server);
    expect(vault.caProvider).toEqual({
      type: 'ConfigMap',
      name: trustedVault.caConfigMapName,
      key: trustedVault.caConfigMapKey,
    });
  });

  it('retains the target during staged, non-destructive Vault rotation', () => {
    const spec = buildLeadCursorExternalSecretArgs('tequity').spec as any;

    expect(spec.refreshInterval).toBe('1m');
    expect(spec.target.creationPolicy).toBe('Orphan');
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

    expect(readme).toContain('Stage 1 — protected bootstrap');
    expect(readme).toContain('Stage 2 — audited operator write');
    expect(readme).toContain('Stage 3 — delivery');
    expect(readme).toContain('Do not switch directly');
    expect(readme).toContain('Explicit decommission');
    expect(readme).toContain('retain-on-delete');
    expect(readme).toContain('Add the new key');
    expect(readme).toContain('longest cursor TTL');
    expect(readme).toContain('later audited deployment');
    expect(readme).toContain('Emergency compromise');
    expect(readme).toContain('invalidates outstanding cursors');
  });
});
