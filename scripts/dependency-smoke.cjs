const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(
  fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
);

const packagePaths = Object.keys(lock.packages);
const bracePaths = packagePaths.filter((entry) =>
  /(^|\/)node_modules\/brace-expansion$/.test(entry),
);
const jsYamlPaths = packagePaths.filter((entry) =>
  /(^|\/)node_modules\/js-yaml$/.test(entry),
);
const minimatchPaths = packagePaths.filter((entry) =>
  /(^|\/)node_modules\/minimatch$/.test(entry),
);
const globPaths = packagePaths.filter((entry) =>
  /(^|\/)node_modules\/glob$/.test(entry),
);

assert.ok(bracePaths.length > 0, 'expected brace-expansion in dependency tree');
assert.ok(jsYamlPaths.length > 0, 'expected js-yaml in dependency tree');
assert.ok(minimatchPaths.length > 0, 'expected minimatch in dependency tree');
assert.ok(globPaths.length > 0, 'expected glob in dependency tree');

for (const entry of bracePaths) {
  const metadata = lock.packages[entry];
  assert.equal(
    metadata.version,
    '5.0.9',
    `${entry} must resolve outside GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895`,
  );
}

for (const entry of jsYamlPaths) {
  const metadata = lock.packages[entry];
  assert.equal(
    metadata.version,
    '4.3.1',
    `${entry} must resolve outside GHSA-5p4m-2wfm-xmqj`,
  );
}

for (const entry of minimatchPaths) {
  const modulePath = path.join(root, entry);
  const { braceExpand } = require(modulePath);
  assert.deepEqual(braceExpand('infra/{dev,prod}.yaml'), [
    'infra/dev.yaml',
    'infra/prod.yaml',
  ]);
}

for (const entry of globPaths) {
  const modulePath = path.join(root, entry);
  const { globSync } = require(modulePath);
  assert.deepEqual(
    globSync('{package.json,tsconfig.json}', { cwd: root }).sort(),
    ['package.json', 'tsconfig.json'],
  );
}

console.log(
  `Dependency smoke passed (${bracePaths.length} brace-expansion, ` +
    `${jsYamlPaths.length} js-yaml, ` +
    `${minimatchPaths.length} minimatch, ${globPaths.length} glob instances).`,
);
