import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultVersions, type Settings } from '../src/config';
import {
  buildSharedVaultReleaseArgs,
  buildSharedVaultReleaseArgsForStage,
  SHARED_VAULT_LIFECYCLE,
} from '../src/dependencies';
import { buildSharedVaultStoreArgs } from '../src/secrets';

const settings: Settings = {
  environment: 'test',
  kubeContext: 'test',
  appNamespace: 'tequity',
  leadCursorKeyringStage: 'disabled',
  sharedVaultTlsStage: 'delivery',
  sharedVaultTls: {
    caConfigMapName: 'approved-vault-ca',
    caConfigMapKey: 'ca.crt',
    tlsSecretName: 'vault-server-tls',
    tlsCertKey: 'tls.crt',
    tlsPrivateKeyKey: 'tls.key',
  },
  sharedVaultTlsReceipt:
    'https://github.com/tequityapp/tequity-infra/issues/10#issuecomment-123456',
  versions: defaultVersions,
};

describe('shared Vault TLS boundary', () => {
  it('configures a TLS-only listener from a referenced Kubernetes Secret', () => {
    const args = buildSharedVaultReleaseArgs(settings);
    const rendered = JSON.stringify(args);

    expect(rendered).toContain('tls_disable = 0');
    expect(rendered).toContain('/vault/userconfig/vault-server-tls/tls.crt');
    expect(rendered).toContain('/vault/userconfig/vault-server-tls/tls.key');
    expect(rendered).not.toContain('tls_disable = 1');
    expect(rendered).not.toMatch(/BEGIN (CERTIFICATE|PRIVATE KEY)/);
    expect(rendered).not.toMatch(/"data"\s*:/);
  });

  it('sets chart-wide TLS and trusted-CA health checks without bypasses', () => {
    const values = buildSharedVaultReleaseArgs(settings).values as any;
    expect(values.global.tlsDisable).toBe(false);
    expect(values.injector.enabled).toBe(false);
    expect(values.server.extraEnvironmentVars).toEqual({
      VAULT_ADDR: 'https://vault.tequity:8200',
      VAULT_CACERT: '/vault/tls/ca/ca.crt',
    });
    expect(values.server.readinessProbe.enabled).toBe(false);
    expect(values.server.livenessProbe.execCommand).toEqual([
      '/bin/sh',
      '-ec',
      'vault status',
    ]);
    expect(values.server.extraContainers[0].readinessProbe.exec.command).toEqual([
      '/bin/sh',
      '-ec',
      'vault status',
    ]);
    expect(JSON.stringify(values)).not.toContain('tls-skip-verify');
  });

  it('keeps the pinned Helm render fixture identical to Pulumi values', () => {
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), 'test/fixtures/vault-tls-values.json'),
        'utf8',
      ),
    );
    expect(buildSharedVaultReleaseArgs(settings).values).toEqual(fixture);
  });

  it('does not deploy a plaintext Vault release for disabled/local stacks', () => {
    expect(
      buildSharedVaultReleaseArgsForStage({
        ...settings,
        sharedVaultTlsStage: 'disabled',
        sharedVaultTls: undefined,
        sharedVaultTlsReceipt: undefined,
      }),
    ).toBeUndefined();
  });

  it('pins the store to HTTPS and an explicit public CA provider', () => {
    const args = buildSharedVaultStoreArgs(settings);
    const vault = (args.spec as any).provider.vault;

    expect(vault.server).toBe('https://vault.tequity:8200');
    expect(vault.caProvider).toEqual({
      type: 'ConfigMap',
      namespace: 'tequity',
      name: 'approved-vault-ca',
      key: 'ca.crt',
    });
    expect(vault).not.toHaveProperty('skipTlsVerify');
    expect(JSON.stringify(args)).not.toContain('http://');
  });

  it('protects and retains the Vault release during migration or rollback', () => {
    expect(SHARED_VAULT_LIFECYCLE).toMatchObject({
      protect: true,
      retainOnDelete: true,
      deleteBeforeReplace: false,
    });
  });

  it('rejects deployment builders without reviewed trust references', () => {
    const untrusted: Settings = {
      ...settings,
      sharedVaultTls: undefined,
    };
    expect(() => buildSharedVaultReleaseArgs(untrusted)).toThrow(/trusted TLS/i);
    expect(() => buildSharedVaultStoreArgs(untrusted)).toThrow(/trusted TLS/i);
  });

  it('contains no plaintext URL or TLS verification bypass in tracked source', () => {
    const source = [
      buildSharedVaultReleaseArgs.toString(),
      buildSharedVaultStoreArgs.toString(),
    ].join('\n');
    expect(source).not.toContain('http://');
    expect(source).not.toMatch(/skipTlsVerify\s*:\s*true/);
  });
});
