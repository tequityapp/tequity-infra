import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowsDirectory = resolve(__dirname, '..', '.github', 'workflows');
const workflowFiles = readdirSync(workflowsDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => ({
    name,
    content: readFileSync(resolve(workflowsDirectory, name), 'utf8'),
  }));
const workflow = workflowFiles.find(({ name }) => name === 'ci.yml')!.content;
const lockfile = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package-lock.json'), 'utf8'),
) as { packages: Record<string, unknown> };

const CONTRACT_SHA = '58a82143d28bc84c163d3fed092d8d9425b91a62';
const SCRIPT_PLAN = [
  'scan:secrets',
  'build',
  'test',
  'test:dependencies',
  'test:vault-render',
  'preview:offline',
  'audit:production',
];

function occurrences(value: string): number {
  return workflow.split(value).length - 1;
}

function lockedInternalPackages(): string[] {
  const names = new Set<string>();
  for (const path of Object.keys(lockfile.packages)) {
    const match = path.match(/(?:^|\/)node_modules\/(@(?:tequityapp|verjson)\/[^/]+)$/);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

describe('repository workflow trust boundaries', () => {
  it('never runs pull-request-controlled workflow definitions on self-hosted runners', () => {
    for (const { name, content } of workflowFiles) {
      expect(content, name).not.toContain('pull_request_target:');
      if (/^\s*pull_request:\s*$/m.test(content)) {
        expect(content, name).not.toMatch(/^\s*runs-on:\s*.*self-hosted/m);
      }
    }
  });

  it('pins every external action and reusable workflow to an immutable commit', () => {
    for (const { name, content } of workflowFiles) {
      const uses = [...content.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)];
      for (const [, target] of uses) {
        expect(target, `${name}: ${target}`).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      }
    }
  });
});

describe('canonical secretless Node CI caller', () => {
  it('uses the immutable shared workflow for PR and trusted-ref validation', () => {
    expect(occurrences(
      `uses: Verjson/.github/.github/workflows/node-ci.yml@${CONTRACT_SHA}`,
    )).toBe(2);
    expect(occurrences('node-version: 24.19.0')).toBe(2);
    expect(occurrences('secretless-pr: true')).toBe(1);
    expect(occurrences('secretless-trusted-ref: true')).toBe(1);
    expect(occurrences('packages: read')).toBe(2);
    expect(occurrences('contents: read')).toBe(2);
    expect(occurrences('statuses: read')).toBe(2);
    expect(workflow).toContain('pull_request:');
    expect(workflow).not.toContain('pull_request_target:');
  });

  it('allows exactly the locked internal package under protected policy', () => {
    expect(lockedInternalPackages()).toEqual(['@verjson/infra']);
    expect(workflow.match(/^\s+approved-internal-scopes:\s+"@verjson"\s*$/gm)).toHaveLength(2);
    expect(workflow.match(/^\s+approved-internal-packages:\s+"@verjson\/infra"\s*$/gm))
      .toHaveLength(2);
  });

  it('maps only the package token and keeps all consumer commands in the canonical plan', () => {
    expect(occurrences('NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}')).toBe(2);
    expect(workflow).not.toContain('secrets: inherit');
    expect(workflow).not.toContain('github.token');
    expect(occurrences(`secretless-ci-script-plan: '${JSON.stringify(SCRIPT_PLAN)}'`)).toBe(2);
  });

  it('contains no copied acquisition or consumer execution implementation', () => {
    const jobs = workflow.slice(workflow.indexOf('jobs:'));
    expect(jobs).not.toMatch(/^\s+steps:/m);
    expect(jobs).not.toMatch(/^\s+runs-on:/m);
    expect(jobs).not.toContain('actions/checkout');
    expect(jobs).not.toContain('npm ci');
    expect(jobs).not.toContain('npm.pkg.github.com');
    expect(jobs).not.toContain('upload-artifact');
    expect(jobs).not.toContain('download-artifact');
  });
});
