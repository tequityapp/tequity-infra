import { readFileSync } from 'node:fs';

describe('CI package authentication boundary', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

  it('grants only read access to contents and packages', () => {
    expect(workflow).toMatch(
      /^permissions:\n  contents: read\n  packages: read$/m,
    );
    expect(workflow).not.toMatch(/^\s+(contents|packages): write$/m);
  });

  it('never executes pull request head code through pull_request_target', () => {
    expect(workflow).toMatch(/^\s{2}pull_request:$/m);
    expect(workflow).not.toMatch(/pull_request_target/);
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
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
