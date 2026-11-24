// Publish a visible page revision without restarting Electron or the web server.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../version.txt');
const current = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 1;
if (!Number.isSafeInteger(current) || current < 1) throw new Error('Invalid version.txt');
fs.writeFileSync(`${file}.tmp`, `${current + 1}\n`);
fs.renameSync(`${file}.tmp`, file);
console.log(`已发布业务页面 v${current + 1}，刷新客户端业务页面即可查看。`);
