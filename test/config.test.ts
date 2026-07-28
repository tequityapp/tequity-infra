import {
  assertLeadCursorBootstrapReceipt,
  defaultVersions,
  parseLeadCursorKeyringStage,
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
