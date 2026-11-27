const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function createServer({ version = 1 } = {}) {
  let currentVersion = version;
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  for (const [file, type] of [['index.html', 'text/html; charset=utf-8'], ['style.css', 'text/css'], ['app.js', 'text/javascript'], ['model.js', 'text/javascript']]) {
    files[`/testbench/${file}`] = [`testbench/${file}`, type];
  }
  files['/testbench/'] = files['/testbench/index.html'];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (process.env.DEMO_VERSION_FILE) {
      try {
        const published = Number(fs.readFileSync(process.env.DEMO_VERSION_FILE, 'utf8'));
        if (Number.isSafeInteger(published) && published > 0) currentVersion = published;
      } catch {}
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    // Receive and acknowledge only. Never resolve, access, execute or persist this path.
    if (url.pathname === '/api/connection-context' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
        res.writeHead(415).end(JSON.stringify({ error: 'Expected JSON' })); return;
      }
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) { res.writeHead(413).end(); return; }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || typeof input.path !== 'string' || !input.path.trim() || input.path.length > 4096 || /[\u0000-\u001f\u007f]/.test(input.path)) {
          res.writeHead(400).end(JSON.stringify({ error: 'Invalid path' })); return;
        }
        res.end(JSON.stringify({ ok: true, path: input.path }));
      } catch { if (!res.destroyed) res.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON' })); }
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, version: currentVersion, hostname: require('node:os').hostname(), platform: process.platform }));
    } else if (url.pathname === '/api/report') {
      const delay = Math.min(10000, Math.max(0, Number(url.searchParams.get('delay')) || 0));
      const requestedVersion = currentVersion;
      await new Promise(resolve => setTimeout(resolve, delay));
      if (res.destroyed) return;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ delay, version: requestedVersion, jobs: 128, uptime: process.uptime(), at: new Date().toISOString() }));
    } else if (files[url.pathname]) {
      const [file, type] = files[url.pathname];
      res.setHeader('Content-Type', type);
      res.end(fs.readFileSync(path.join(__dirname, 'public', file), 'utf8').replaceAll('__VERSION__', String(currentVersion)));
    } else res.writeHead(404).end('Not found');
  });
  server.publish = () => ++currentVersion;
  return server;
}

if (require.main === module) {
  const server = createServer({ version: Number(process.env.DEMO_VERSION) || 1 });
  server.listen(Number(process.env.PORT ?? 8080), '127.0.0.1', () => {
    const port = server.address().port;
    console.log(`业务服务 http://127.0.0.1:${port}（仅监听本机）`);
    process.send?.({ type: 'ready', port });
  });
  process.on('message', message => {
    if (message?.type === 'publish') process.send?.({ type: 'published', version: server.publish() });
  });
  const stop = () => { server.close(); server.closeAllConnections(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('disconnect', stop);
}
module.exports = { createServer };
