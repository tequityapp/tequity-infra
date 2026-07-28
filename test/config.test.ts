import {
  assertLeadCursorBootstrapReceipt,
  assertSharedVaultTlsConnection,
  assertSharedVaultTlsReceipt,
  defaultVersions,
  parseLeadCursorKeyringStage,
  parseSharedVaultTlsStage,
} from '../src/config';

describe('pinned chart versions', () => {
  it('pins every dependency to an explicit version (no floating tags)', () => {
    for (const [name, version] of Object.entries(defaultVersions)) {
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(name).toBeTruthy();
    }
  });
});

describe('shared Vault TLS rollout stage', () => {
  it.each(['disabled', 'bootstrap', 'delivery'] as const)(
    'accepts the explicit %s stage',
    (stage) => {
      expect(parseSharedVaultTlsStage(stage)).toBe(stage);
    },
  );

  it.each(['', 'plaintext', 'enabled', 'true'])(
    'rejects unsafe or ambiguous stage %p',
    (stage) => {
      expect(() => parseSharedVaultTlsStage(stage)).toThrow(/shared Vault TLS stage/i);
    },
  );

  it('requires an issue #10 audit receipt before delivery', () => {
    expect(() =>
      assertSharedVaultTlsReceipt(
        'https://github.com/tequityapp/tequity-infra/issues/10#issuecomment-123456',
      ),
    ).not.toThrow();
    expect(() => assertSharedVaultTlsReceipt('approved')).toThrow(
      /delivery receipt/i,
    );
    expect(() =>
      assertSharedVaultTlsReceipt(
        'https://github.com/tequityapp/tequity-infra/issues/5#issuecomment-123456',
      ),
    ).toThrow(/delivery receipt/i);
  });

  it('rejects malformed or injectable trust-reference names', () => {
    const valid = {
      caConfigMapName: 'approved-vault-ca',
      caConfigMapKey: 'ca.crt',
      tlsSecretName: 'vault-server-tls',
      tlsCertKey: 'tls.crt',
      tlsPrivateKeyKey: 'tls.key',
    };
    expect(() => assertSharedVaultTlsConnection(valid)).not.toThrow();
    expect(() =>
      assertSharedVaultTlsConnection({
        ...valid,
        tlsSecretName: 'vault"\ntls_disable = 1',
      }),
    ).toThrow(/certificate Secret/i);
  });
});

describe('lead cursor keyring rollout stage', () => {
  it.each(['disabled', 'bootstrap', 'delivery'] as const)(
    'accepts the explicit %s stage',
    (stage) => {
      expect(parseLeadCursorKeyringStage(stage)).toBe(stage);
    },
  );

  it.each(['', 'enabled', 'decommission', 'true'])(
    'rejects unsafe or ambiguous stage %p',
    (stage) => {
      expect(() => parseLeadCursorKeyringStage(stage)).toThrow(
        /lead cursor keyring stage/i,
      );
    },
  );

  it('requires a durable issue #5 comment receipt before delivery', () => {
    expect(() =>
      assertLeadCursorBootstrapReceipt(
        'https://github.com/tequityapp/tequity-infra/issues/5#issuecomment-123456',
      ),
    ).not.toThrow();
    expect(() => assertLeadCursorBootstrapReceipt('approved')).toThrow(
      /bootstrap receipt/i,
    );
    expect(() =>
      assertLeadCursorBootstrapReceipt(
        'https://github.com/tequityapp/tequity-infra/issues/4#issuecomment-123456',
      ),
    ).toThrow(/bootstrap receipt/i);
  });
});
