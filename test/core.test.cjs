const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server/server.cjs');
const { Connection, validateTarget, sshArgs, localUsername } = require('../electron/connection.cjs');

test('API 延迟不阻塞健康检查；页面可独立发布', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const started = performance.now();
  const slow = fetch(`${url}/api/report?delay=700`).then(r => r.json());
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.ok, true);
  assert.ok(performance.now() - started < 500);
  assert.match(await (await fetch(url)).text(), /data-version="1"/);
  assert.equal(server.publish(), 2);
  assert.match(await (await fetch(url)).text(), /data-version="2"/);
  assert.equal((await slow).delay, 700);
  assert.ok(performance.now() - started >= 690);
  assert.equal((await fetch(`${url}/secret`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

test('连接控制器支持启动、发布、停止、恢复、断开并清理进程', async t => {
  const connection = new Connection();
  t.after(() => connection.close());
  await connection.connect('local', { path: '/demo' });
  assert.equal(connection.state.status, 'online');
  const originalUrl = connection.state.url;
  const published = once(connection, 'state');
  connection.publish();
  await published;
  assert.equal(connection.state.version, 2);
  await connection.stopService();
  assert.equal(connection.state.status, 'offline');
  await assert.rejects(fetch(`${originalUrl}/health`));
  await connection.connect('local', { path: '/demo' });
  assert.equal(connection.state.status, 'online');
  assert.equal((await (await fetch(`${connection.state.url}/health`)).json()).version, 2);
  await connection.disconnect();
  assert.equal(connection.state.url, '');
  assert.equal(connection.child, null);
});

test('SSH 参数使用严格主机校验、显式端口、仅 loopback 转发并拒绝命令注入', () => {
  for (const host of ['-oProxyCommand=bad', 'a;whoami', 'user@a x', 'a\nfoo', '$(id)', '', '../host'])
    assert.throws(() => validateTarget({ host, port: 8080, path: '/demo' }));
  for (const port of [0, -1, 65536, 'x', 2.5]) assert.throws(() => validateTarget({ host: 'demo@192.0.2.10', port, path: '/demo' }));
  assert.throws(() => validateTarget({ host: 'valid', port: 8080, sshPort: 0, path: '/demo' }));
  const args = sshArgs({ host: 'demo@192.0.2.10', port: 8080, sshPort: 22 }, 49231);
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(args.includes('ExitOnForwardFailure=yes'));
  assert.equal(args[args.indexOf('-p') + 1], '22');
  assert.equal(args[args.indexOf('-L') + 1], '127.0.0.1:49231:127.0.0.1:8080');
  assert.equal(args.at(-1), 'demo@192.0.2.10');
});

test('历史记录持久化、去重、白名单存储；损坏文件可恢复', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { History } = require('../electron/history.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'connections.json');
  const history = new History(file);
  assert.deepEqual(history.records, []);
  const target = { host: 'user@host', path: '/project', sshPort: 22, port: 18765, startService: true, password: 'MUST_NOT_SAVE', privateKey: 'MUST_NOT_SAVE', command: 'MUST_NOT_SAVE' };
  history.remember(target); history.remember(target);
  assert.equal(history.records.length, 1);
  assert.equal(new History(file).records[0].host, 'host');
  assert.equal(new History(file).records[0].user, 'user');
  assert.equal(new History(file).records[0].path, '/project');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /MUST_NOT_SAVE|password|privateKey|command/);
  for (let i = 0; i < 16; i++) history.remember({ ...target, host: `host${i}` });
  assert.equal(new History(file).records.length, 12);
  fs.writeFileSync(file, 'invalid json');
  const recovered = new History(file);
  assert.deepEqual(recovered.records, []);
  recovered.remember(target);
  assert.equal(new History(file).records.length, 1);
});


test('SSH 参数与路径隔离，历史兼容旧格式并区分路径', t => {
  const target = { host: 'my-host', port: 18765, path: '/项目 with spaces/$(id);&?#' };
  assert.equal(sshArgs(target, 40000).at(-1), 'my-host');
  assert.equal(sshArgs({ ...target, user: 'developer' }, 40000).at(-1), 'developer@my-host');
  assert.ok(!sshArgs(target, 40000).some(arg => arg.includes(target.path)));
  assert.equal(validateTarget(target).path, target.path);
  for (const user of ['-bad', 'root@host', 'a;id']) assert.throws(() => validateTarget({ ...target, user }));
  for (const path of [undefined, '', '  ', 42, 'a\n', 'x'.repeat(4097)]) assert.throws(() => validateTarget({ ...target, path }));
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { History } = require('../electron/history.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-path-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'connections.json');
  fs.writeFileSync(file, JSON.stringify([{ host: 'user@my-host', port: 18765, sshPort: 22 }]));
  const history = new History(file);
  assert.equal(history.records[0].user, 'user');
  history.remember(target);
  history.remember({ ...target, path: '/another' });
  assert.equal(new History(file).records.length, 3);
});

test('后端确认原样收到路径，拒绝无效负载；连接会等待确认', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}/api/connection-context`;
  const send = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const path of ['/项目 with spaces/$(id);&?#', '../not-a-real-directory']) {
    assert.deepEqual(await (await send({ path })).json(), { ok: true, path });
  }
  for (const body of [{}, { path: '' }, { path: '  ' }, null, { path: 12 }, { path: 'bad\n' }, { path: 'x'.repeat(4097) }]) assert.equal((await send(body)).status, 400);
  assert.equal((await send({ path: 'x'.repeat(40000) })).status, 413);
  assert.equal((await fetch(url, { method: 'POST', body: 'invalid' })).status, 415);
  const connection = new Connection(); t.after(() => connection.close());
  await connection.connect('local', { host: 'localhost', port: 18765, path: '/项目 with spaces' });
  assert.equal(connection.state.status, 'online');
  assert.equal(connection.state.pathReceived, true);
  await connection.disconnect();
  // A healthy old backend without the receive endpoint must not report success.
  connection.startLocal = async () => {
    const { spawn } = require('node:child_process');
    connection.child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    connection.set({ url: `http://127.0.0.1:${server.address().port}/missing` });
  };
  await connection.connect('local', { host: 'localhost', port: 18765, path: '/unconfirmed' });
  assert.equal(connection.state.status, 'offline');
  assert.equal(connection.state.pathReceived, false);
});


test('跨平台本机用户读取、失败回退及 SSH 用户优先级', async t => {
  for (const name of ['localuser', 'Windows User', '用户']) assert.equal(localUsername(() => ({ username: name })), name);
  assert.equal(localUsername(() => { throw new Error('unavailable'); }), '');
  assert.equal(localUsername(() => ({ username: '-invalid' })), '');
  assert.equal(localUsername(), require('node:os').userInfo().username);
  const connection = new Connection(); t.after(() => connection.close());
  const users = [];
  connection.startSSH = async target => { users.push(target.user); throw new Error('test: skip network'); };
  await connection.connect('ssh', { host: 'example', user: '', path: '/demo', port: 18765 });
  await connection.connect('ssh', { host: 'example', user: 'override', path: '/demo', port: 18765 });
  assert.deepEqual(users, [localUsername(), 'override']);
  await assert.rejects(connection.connect('ssh', { host: 'example', path: ' ', port: 18765 }), /project path/);
  assert.equal(users.length, 2);
});


test('Theme preferences persist only valid values and recover from damaged files', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { Preferences } = require('../electron/preferences.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-theme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preferences.json');
  const preferences = new Preferences(file);
  assert.equal(preferences.theme, 'system');
  preferences.setTheme('light');
  assert.equal(new Preferences(file).theme, 'light');
  assert.throws(() => preferences.setTheme('invalid'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { theme: 'light' });
  fs.writeFileSync(file, 'broken');
  assert.equal(new Preferences(file).theme, 'system');
});
