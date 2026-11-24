const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
async function launch(profile) {
  fs.mkdirSync(profile, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env, RELAY_USER_DATA: profile, ELECTRON_RUN_AS_NODE: '' } });
  try {
    await expect.poll(() => app.windows().find(p => p.url().endsWith('/shell.html'))).toBeTruthy();
    const shell = app.windows().find(p => p.url().endsWith('/shell.html'));
    await expect(shell.locator('#host')).toHaveValue(/.+/);
    await expect.poll(() => app.windows().find(p => p.url().endsWith('/floating.html'))).toBeTruthy();
    const floating = app.windows().find(p => p.url().endsWith('/floating.html'));
    await expect.poll(() => app.windows().find(p => !p.url().startsWith('file:'))).toBeTruthy();
    const business = app.windows().find(p => !p.url().startsWith('file:'));
    return { app, shell, floating, business };
  } catch (error) { await app.close(); throw error; }
}
const state = shell => shell.evaluate(() => window.relay.action('state'));
async function ready(shell) {
  await expect.poll(async () => {
    const value = await state(shell);
    return [value.screen, value.phase, value.status, value.busy];
  }, { timeout: 30000 }).toEqual(['workspace', 'ready', 'online', false]);
}
async function expand(floating) {
  if (await floating.locator('#launcher').isVisible()) await floating.locator('#launcher').click();
  await expect(floating.locator('#card')).toBeVisible();
}
async function nativeLayout(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { size: win.getContentSize(), children: win.contentView.children.map(view => ({ url: view.webContents?.getURL(), bounds: view.getBounds(), visible: view.getVisible() })) };
  });
}
module.exports = { launch, state, ready, nativeLayout, expand, expect };
