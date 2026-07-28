const { scanText } = require('../scripts/secret-scan.cjs') as {
  scanText: (path: string, text: string) => Array<{ rule: string }>;
};

describe('deterministic secret scanner', () => {
  it.each([
    ['GitHub token', `gh${'p_'}${'a'.repeat(36)}`],
    ['AWS access key', `AK${'IA'}${'A'.repeat(16)}`],
    ['private key', `-----BEGIN ${'PRIVATE KEY'}-----`],
    ['live payment key', `sk_${'live_'}${'a'.repeat(24)}`],
    ['JWT', `${'a'.repeat(24)}.${'b'.repeat(24)}.${'c'.repeat(24)}`],
    ['generic secret assignment', `api_secret = "${'z9'.repeat(20)}"`],
  ])('flags %s without echoing the credential', (_name, candidate) => {
    const findings = scanText('fixture.txt', candidate);

    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings)).not.toContain(candidate);
  });

  it('allows references, placeholders, hashes, and Pulumi policy metadata', () => {
    const safe = [
      'LEADS_CURSOR_KEYS_JSON',
      'remoteRef: { key: "keyring" }',
      'capabilities = ["read"]',
      'sha256:07e36c59f1c4cf99191981b5d2bac68064000f9a18e78d736dc294ecfd31fb9d',
      '${{ secrets.APPROVED_TOKEN }}',
    ].join('\n');

    expect(scanText('fixture.txt', safe)).toEqual([]);
  });
});
