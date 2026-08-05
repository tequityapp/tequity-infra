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

  it('scopes a cross-organization token to the private package install step', () => {
    expect(workflow).toContain('registry-url: https://npm.pkg.github.com');
    expect(workflow).toContain("scope: '@verjson'");
    // github.token alone cannot read another org's packages: @verjson/* lives in
    // the Verjson org and GITHUB_TOKEN 403s there. The org PAT supplies cross-org
    // read:packages, with github.token kept as the same-org fallback.
    expect(workflow).toMatch(
      /- run: npm ci\n        env:\n          NODE_AUTH_TOKEN: \$\{\{ secrets\.NODE_AUTH_TOKEN \|\| github\.token \}\}/,
    );
    // Still exactly one step may see it — count env keys, not the expression's
    // own reference to the secret of the same name.
    expect(workflow.match(/^\s+NODE_AUTH_TOKEN:/gm)).toHaveLength(1);
  });
});
