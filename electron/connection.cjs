const { EventEmitter } = require('node:events');
const { spawn, fork } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { userInfo } = require('node:os');
const userPattern = /^[\p{L}\p{N}_][\p{L}\p{N}_. -]{0,127}$/u;
function localUsername(read = userInfo) {
  try { const name = read().username; return typeof name === 'string' && userPattern.test(name) ? name : ''; }
  catch { return ''; }
}

function validateTarget(target, { requirePath = true } = {}) {
  if (!target || typeof target.host !== 'string') throw new Error('Enter a hostname, IPv4 address, or SSH alias.');
  // Accept legacy user@host records, but always keep the new fields separate.
  const parts = target.host.split('@');
  const host = parts.at(-1);
  const user = target.user ?? (parts.length === 2 ? parts[0] : '');
  if (parts.length > 2 || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host))
    throw new Error('Enter a valid hostname, IPv4 address, or SSH alias.');
  if (typeof user !== 'string' || (user && !userPattern.test(user)) || (parts.length === 2 && parts[0] !== user))
    throw new Error('Enter a valid SSH user, or leave it blank to use your local account.');
  const requestedPath = target.path ?? '';
  if (typeof requestedPath !== 'string' || requestedPath.length > 4096 || /[\u0000-\u001f\u007f]/.test(requestedPath))
    throw new Error('Path must be at most 4096 characters with no control characters.');
  if (requirePath && !requestedPath.trim()) throw new Error('Enter a project path.');
  const port = Number(target.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Service port must be between 1 and 65535.');
  const sshPort = Number(target.sshPort ?? 22);
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error('SSH port must be between 1 and 65535.');
  return { host, user, path: requestedPath, port, sshPort, startService: target.startService === true };
}
function destination(target) { return target.user ? `${target.user}@${target.host}` : target.host; }

const sshOptions = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2'];
function sshArgs(target, localPort) {
  const clean = validateTarget(target, { requirePath: false });
  const { port, sshPort } = clean;
  return [...sshOptions, '-p', String(sshPort), '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `127.0.0.1:${localPort}:127.0.0.1:${port}`, destination(clean)];
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}
class Connection extends EventEmitter {
  constructor() {
    super();
    this.state = { mode: 'local', status: 'idle', detail: 'Local demo · Disconnected', url: '', version: 1 };
    this.target = null; this.child = null; this.epoch = 0; this.checkingEpoch = null;
    this.starting = false;
    this.timer = setInterval(() => { if (!this.starting) this.check(); }, 1500);
  }
  set(patch) { Object.assign(this.state, patch); this.emit('state', { ...this.state }); }
  async disconnect() {
    this.epoch++; this.set({ status: 'idle', detail: 'Disconnected. Connection controls remain available.', url: '' });
    const child = this.child; this.child = null;
    await terminate(child);
  }
  async connect(mode = 'local', target) {
    if (!['local', 'ssh'].includes(mode)) throw new Error('Unknown connection mode.');
    target = validateTarget(mode === 'local'
      ? { host: 'localhost', port: 18765, path: target?.path ?? '' }
      : target);
    if (mode === 'ssh' && !target.user) target.user = localUsername();
    await this.disconnect();
    this.target = target; this.starting = true;
    this.set({ pathReceived: false });
    this.set({ mode, status: 'connecting', detail: mode === 'local' ? 'Starting local service…' : 'Connecting over SSH…' });
    try {
      if (mode === 'local') await this.startLocal();
      else await this.startSSH(target);
      const response = await fetch(`${this.state.url}/api/connection-context`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target.path }), signal: AbortSignal.timeout(5000)
      });
      const received = await response.json().catch(() => null);
      if (!response.ok || received?.ok !== true || received.path !== target.path)
        throw new Error('The server did not acknowledge the path. Update the server and retry.');
      this.set({ pathReceived: true });
      await this.check();
    } catch (error) {
      const child = this.child; this.child = null;
      await terminate(child);
      this.set({ status: 'offline', detail: error.message, url: '' });
    }
    this.starting = false;
    return { ...this.state };
  }
  startLocal() {
    return new Promise((resolve, reject) => {
      const child = fork(path.join(__dirname, '../server/server.cjs'), [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '0', DEMO_VERSION: String(this.state.version) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });
      this.child = child;
      const timer = setTimeout(() => reject(new Error('Local service timed out.')), 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (this.child === child) { this.child = null; this.set({ status: 'offline', detail: 'Local service stopped. Reconnect to restore it.' }); }
        reject(new Error('Local service failed to start.'));
      });
      child.on('message', message => {
        if (message.type === 'ready') { clearTimeout(timer); this.set({ url: `http://127.0.0.1:${message.port}` }); resolve(); }
        if (message.type === 'published') this.set({ version: message.version, detail: `Published v${message.version}. Refresh to view it.` });
      });
    });
  }
  async startSSH(target) {
    if (target.startService) {
      this.set({ detail: 'Checking remote service…' });
      await new Promise((resolve, reject) => {
        const child = spawn('ssh', [...sshOptions, '-p', String(target.sshPort), destination(target), 'systemctl --user is-active --quiet relay-demo.service || systemctl --user start relay-demo.service']);
        this.child = child;
        let errorText = '';
        child.stderr.on('data', data => { errorText = (errorText + data).slice(-1500); });
        const timer = setTimeout(() => { child.kill(); reject(new Error('Remote service check timed out.')); }, 15000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(errorText || 'Remote service failed to start.')); });
      });
    }
    const port = await freePort();
    const child = spawn('ssh', sshArgs(target, port));
    this.child = child;
    let errorText = '';
    let failure = null;
    child.stderr.on('data', data => { errorText = (errorText + data).slice(-1500); });
    child.once('error', error => { failure = error; });
    child.once('exit', () => {
      failure = new Error(errorText || 'SSH tunnel closed.');
      if (this.child === child) this.set({ status: 'offline', detail: failure.message });
    });
    this.set({ url: `http://127.0.0.1:${port}` });
    for (let i = 0; i < 24; i++) {
      if (failure) throw failure;
      try {
        const res = await fetch(`${this.state.url}/health`, { signal: AbortSignal.timeout(500) });
        if (res.ok && (await res.json()).ok === true) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw failure || new Error('SSH or the server is not ready. Check host trust, keys, and the service.');
  }
  async check() {
    if (this.checkingEpoch === this.epoch || !this.state.url || !this.child || this.state.status === 'idle') return;
    const epoch = this.epoch;
    this.checkingEpoch = epoch;
    try {
      const res = await fetch(`${this.state.url}/health`, { signal: AbortSignal.timeout(1000) });
      const data = await res.json();
      if (!res.ok || data.ok !== true) throw new Error('health');
      if (epoch === this.epoch && this.state.status !== 'online') this.set({ status: 'online', detail: this.state.mode === 'local' ? 'Local demo connected' : 'SSH and server are ready.' });
    } catch {
      if (epoch === this.epoch) this.set({ status: 'offline', detail: 'Server is not responding. Connection controls remain available.' });
    } finally { if (this.checkingEpoch === epoch) this.checkingEpoch = null; }
  }
  async stopService() {
    if (this.state.mode !== 'local') throw new Error('This action is only available in the local demo.');
    this.epoch++;
    const child = this.child; this.child = null;
    await terminate(child);
    this.set({ status: 'offline', detail: 'Local demo stopped. Reconnect to restore it.' });
  }
  publish() {
    if (this.state.mode !== 'local' || !this.child || !this.child.connected) throw new Error('Connect to the local demo first.');
    this.child.send({ type: 'publish' });
  }
  async close() { clearInterval(this.timer); await this.disconnect(); }
}
module.exports = { Connection, validateTarget, sshArgs, destination, localUsername };
