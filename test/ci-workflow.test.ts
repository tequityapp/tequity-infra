import { readFileSync } from 'node:fs';

describe('CI package authentication boundary', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

  it('grants only read access to contents and packages', () => {
    expect(workflow).toMatch(
      /^permissions:\n  contents: read\n  packages: read$/m,
    );
    expect(workflow).not.toMatch(/^\s+(contents|packages): write$/m);
  });

  it('scopes the automatic token to the private package install step', () => {
    expect(workflow).toContain('registry-url: https://npm.pkg.github.com');
    expect(workflow).toContain("scope: '@verjson'");
    expect(workflow).toMatch(
      /- run: npm ci\n        env:\n          NODE_AUTH_TOKEN: \$\{\{ github\.token \}\}/,
    );
    expect(workflow.match(/NODE_AUTH_TOKEN/g)).toHaveLength(1);
  });
});
