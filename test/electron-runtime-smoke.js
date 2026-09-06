'use strict';

// Optional integration test. It uses local pages and an isolated temporary
// profile, and keeps capture windows minimized.
const path = require('node:path');
const fs = require('node:fs');

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-runtime-smoke-'));
  const js = path.join(root, 'fixture.js');
  const css = path.join(root, 'fixture.css');
  fs.writeFileSync(js, 'window.captureSmokeInjected = true;');
  fs.writeFileSync(css, 'body { --capture-smoke: loaded; }');
  const env = { ...process.env, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(root, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [
    __filename, '--multiinstance', '--minimized', '--no-node', '--nodpi',
    '--url=data:text/html,<body>First smoke page</body>', `--js=${js}`, `--css=${css}`,
  ], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', timeout: 25000, windowsHide: true });
  const lifecycleError = /uncaughtException|MaxListenersExceededWarning|Object has been destroyed/.test(result.stdout + result.stderr);
  const passed = result.status === 0 && result.stdout.includes('RUNTIME_SMOKE_PASSED') && !lifecycleError;
  if (!passed) {
    console.error(result.error || `Electron exited with ${result.status}`);
    console.error(result.stdout);
    console.error(result.stderr);
  }
  console.log(`Electron runtime smoke ${passed ? 'passed' : 'failed'}; temporary profile: ${root}`);
  process.exitCode = passed ? 0 : 1;
} else {
  const { app, BrowserWindow } = require('electron');
  const assert = require('node:assert/strict');
  const waitFor = async predicate => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for runtime smoke condition');
  };
  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1);
      const first = BrowserWindow.getAllWindows()[0];
      const pageReady = async (window, expected) => {
        if (window.webContents.isLoading()) return false;
        return window.webContents.executeJavaScript(`document.body?.textContent === ${JSON.stringify(expected)} && window.captureSmokeInjected === true && getComputedStyle(document.body).getPropertyValue('--capture-smoke').trim() === 'loaded'`);
      };
      await waitFor(() => pageReady(first, 'First smoke page'));
      assert.ok(first.webContents.getURL().startsWith('data:'), 'the real app must preserve the requested URL scheme');
      const secondURL = 'data:text/html,<body>Second smoke page</body>';
      app.emit('second-instance', {}, [], process.cwd(), {
        ...first.args, url: secondURL, u: secondURL, title: 'Second smoke window', t: 'Second smoke window',
        min: true, minimized: true,
      });
      await waitFor(() => BrowserWindow.getAllWindows().length === 2);
      const second = BrowserWindow.getAllWindows().find(window => window !== first);
      await waitFor(() => pageReady(second, 'Second smoke page'));
      first.reload();
      await waitFor(() => pageReady(first, 'First smoke page'));
      first.close();
      await waitFor(() => first.isDestroyed());
      assert.equal(second.isDestroyed(), false, 'closing one capture must preserve the other');
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      console.log('RUNTIME_SMOKE_PASSED');
      app.quit();
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
