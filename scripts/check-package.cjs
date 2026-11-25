// Inspect the actual archive, not only the builder configuration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.join(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const expected = ['package.json', ...['electron', 'server'].flatMap(dir => files(path.join(root, dir)))
  .filter(file => /\.(cjs|js|css|html)$/.test(file)).map(file => path.relative(root, file).split(path.sep).join('/'))].sort();
const archives = files(path.join(root, 'dist')).filter(file => file.endsWith(`${path.sep}app.asar`));
assert.ok(archives.length, 'No packaged app.asar found.');
for (const archive of archives) {
  const actual = asar.listPackage(archive).map(file => file.replace(/^[/\\]/, '')).filter(file => !asar.statFile(archive, file).files).map(file => file.split(path.sep).join('/')).sort();
  assert.deepEqual(actual, expected, 'Archive differs from the runtime source allowlist.');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(metadata.main, 'electron/main.cjs');
  assert.ok(!metadata.devDependencies, 'Development dependencies must not ship.');
  console.log(`PASS packaged source allowlist: ${actual.length} files`);
}
