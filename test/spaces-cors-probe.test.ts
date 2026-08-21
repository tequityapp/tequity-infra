import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `scripts/spaces-cors-probe.sh` is the credentialed half of the tequity-infra#13
 * evidence: it is run once by an operator against the authoritative bucket and its
 * transcript is attached to the issue. That means it gets exactly one attempt with a
 * production credential, so a silently wrong request signature would burn the session
 * and produce a misleading 403 rather than the CORS answer the issue asks for.
 *
 * The golden signatures below were produced by an INDEPENDENT SigV4 implementation
 * (botocore 1.34.46 `SigV4Auth`, s3/nyc3, clock frozen to the fixed date) using the
 * documented AWS example credentials, which are public and authorize nothing. All four
 * request shapes the probe issues agreed with it exactly. Pinning them here turns that
 * one-off cross-check into a standing regression guard without adding a dependency.
 */

const probe = resolve(__dirname, '..', 'scripts', 'spaces-cors-probe.sh');
const source = readFileSync(probe, 'utf8');

const fixedDate = '20260821T000000Z';
const exampleKey = 'AKIDEXAMPLE';
const exampleSecret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

function sign(method: string, conditional: 'yes' | 'no', body: string): string {
  return execFileSync('bash', [probe], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SPACES_PROBE_SIGN_ONLY: '1',
      SPACES_PROBE_FIXED_DATE: fixedDate,
      SPACES_KEY: exampleKey,
      SPACES_SECRET: exampleSecret,
      SPACES_PROBE_KEY: 'probe/object.txt',
      SPACES_PROBE_METHOD: method,
      SPACES_PROBE_CONDITIONAL: conditional,
      SPACES_PROBE_BODY: body,
    },
  }).trim();
}

describe('Spaces upload-CORS probe', () => {
  it.each([
    [
      'the create-only PUT',
      'PUT',
      'yes',
      'first-writer-wins',
      'host;if-none-match;x-amz-content-sha256;x-amz-date',
      'a3a72038ce904b229d5f048426db257b452a9eadd77663a4db3523d15fdd58d9',
    ],
    [
      'the rejected second PUT',
      'PUT',
      'yes',
      'second-writer-must-not-land',
      'host;if-none-match;x-amz-content-sha256;x-amz-date',
      'e973d9587775b3b10ea32e3ceb8599ec1e0ad65d0bd0eb000800b2cacc6e8756',
    ],
    [
      'the signed read-back',
      'GET',
      'no',
      '',
      'host;x-amz-content-sha256;x-amz-date',
      '52ef3ae37e334eff3f06c48fb3df70218568a9899fffb8d2e5f7488fd7f388d6',
    ],
    [
      'the cleanup delete',
      'DELETE',
      'no',
      '',
      'host;x-amz-content-sha256;x-amz-date',
      '7a66050591f406bab0ae57b483e442f115a55999f0652a8333909a75ae7288de',
    ],
  ] as const)(
    'signs %s exactly as an independent SigV4 implementation does',
    (_label, method, conditional, body, signedHeaders, signature) => {
      expect(sign(method, conditional, body)).toBe(
        `AWS4-HMAC-SHA256 Credential=${exampleKey}/20260821/nyc3/s3/aws4_request, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      );
    },
  );

  it('signs a different payload differently', () => {
    expect(sign('PUT', 'yes', 'first-writer-wins')).not.toBe(
      sign('PUT', 'yes', 'second-writer-must-not-land'),
    );
  });

  it('refuses to run without credentials rather than sending an unsigned request', () => {
    expect(() =>
      execFileSync('bash', [probe], {
        encoding: 'utf8',
        env: { ...process.env, SPACES_KEY: '', SPACES_SECRET: '', PATH: process.env.PATH! },
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('asserts the create-only semantics the issue asks it to evidence', () => {
    // First conditional PUT succeeds, the second is refused, and the stored bytes
    // are compared through a SIGNED read-back -- an unsigned GET against a private
    // bucket returns a 403 body, which would report a false change.
    expect(source).toContain("If-None-Match: *");
    expect(source).toMatch(/status.*=.*'200'.*\|\|.*fail/s);
    expect(source).toContain("[ \"$status\" = '412' ] || fail");
    expect(source).toContain('the stored bytes changed after the rejected PUT');
    expect(source).toContain('signed_request GET "$key" \'\' no');
  });

  it('checks the exact origin allowlist in both directions', () => {
    expect(source).toContain('the approved origin was not echoed by the preflight');
    expect(source).toContain('the bucket answered with a wildcard origin');
    expect(source).toContain('was answered');
    expect(source).toContain('SPACES_UNAPPROVED_ORIGIN');
  });

  it('cleans up the object it created, even on an early failure', () => {
    expect(source).toContain('trap finish EXIT');
    expect(source).toContain('signed_request DELETE "$key"');
    expect(source).toContain('could not delete the probe object');
  });

  it('never echoes a credential and is never run by CI', () => {
    expect(source).not.toMatch(/echo .*SPACES_SECRET|printf .*SPACES_SECRET/);
    const workflows = resolve(__dirname, '..', '.github', 'workflows');
    const referenced = execFileSync(
      'bash',
      ['-c', `grep -rl spaces-cors-probe ${workflows} || true`],
      { encoding: 'utf8' },
    ).trim();
    expect(referenced).toBe('');
  });
});
