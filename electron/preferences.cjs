const fs = require('node:fs');
const path = require('node:path');
const themes = new Set(['system', 'light', 'dark']);
class Preferences {
  constructor(file) {
    this.file = file;
    this.theme = 'system';
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (themes.has(saved.theme)) this.theme = saved.theme;
    } catch {}
  }
  setTheme(theme) {
    if (!themes.has(theme)) throw new Error('Unknown theme.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ theme }), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.theme = theme;
  }
}
module.exports = { Preferences };
