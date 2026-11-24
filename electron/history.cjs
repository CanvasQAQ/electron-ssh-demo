const fs = require('node:fs');
const path = require('node:path');
const { validateTarget } = require('./connection.cjs');

// Persist a strict allowlist. Never serialize renderer payloads or SSH credentials.
class History {
  constructor(file) { this.file = file; this.records = this.read(); }
  read() {
    try {
      const input = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(input)) return [];
      return input.slice(0, 12).flatMap(record => {
        try {
          const target = validateTarget(record, { requirePath: false });
          return [{ ...target, lastConnected: Number(record.lastConnected) || 0 }];
        } catch { return []; }
      });
    } catch { return []; }
  }
  remember(target) {
    const clean = validateTarget(target);
    const key = entry => JSON.stringify([entry.host, entry.user, entry.sshPort, entry.port, entry.path]);
    const next = [{ ...clean, lastConnected: Date.now() }, ...this.records.filter(entry => key(entry) !== key(clean))].slice(0, 12);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.records = next;
  }
}
module.exports = { History };
