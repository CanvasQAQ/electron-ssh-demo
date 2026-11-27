const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server/server.cjs');

async function start(t) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('testbench entry points and resources retain same-origin security headers', async t => {
  const origin = await start(t);
  const resources = [
    ['/testbench/', 'text/html'],
    ['/testbench/index.html', 'text/html'],
    ['/testbench/style.css', 'text/css'],
    ['/testbench/app.js', 'text/javascript'],
    ['/testbench/model.js', 'text/javascript']
  ];
  for (const [pathname, contentType] of resources) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('content-type').split(';')[0], contentType, pathname);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', pathname);
    assert.equal(response.headers.get('cache-control'), 'no-store', pathname);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /(?:^|;\s*)script-src 'self'(?:;|$)/, pathname);
    assert.match(csp, /(?:^|;\s*)style-src 'self'(?:;|$)/, pathname);
    assert.match(csp, /(?:^|;\s*)connect-src 'self'(?:;|$)/, pathname);
    assert.match(csp, /(?:^|;\s*)frame-ancestors 'none'(?:;|$)/, pathname);
    assert.ok((await response.text()).trim().length > 0, pathname);
  }
  const root = await fetch(origin);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /data-version="1"/);
});

test('testbench routes reject unlisted files and non-GET requests', async t => {
  const origin = await start(t);
  for (const pathname of [
    '/testbench/missing.js',
    '/testbench/server.cjs',
    '/testbench/.env',
    '/testbench/%2e%2e%2fserver.cjs'
  ]) {
    assert.equal((await fetch(`${origin}${pathname}`)).status, 404, pathname);
  }
  assert.equal((await fetch(`${origin}/testbench/`, { method: 'POST' })).status, 405);
});
