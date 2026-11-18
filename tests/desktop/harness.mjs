import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remote } from 'webdriverio';
import { startFakeAdo } from '../../scripts/fake-ado/server.mjs';
import * as scenario from '../../scripts/fake-ado/scenarios/inbox.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

export async function desktopHarness(t) {
  if (process.platform !== 'win32') throw new Error('Desktop E2E currently supports Windows only.');
  const application = path.resolve(process.env.DEVDECK_E2E_APP ?? path.join(
    process.env.CARGO_TARGET_DIR ?? path.join(root, 'target'), 'debug', 'azdo-dashboard.exe',
  ));
  if (!existsSync(application)) throw new Error(`Build first: pnpm tauri build --debug --no-bundle (${application})`);
  const artifactRoot = path.resolve(root, 'test-results/desktop');
  mkdirSync(artifactRoot, { recursive: true });
  const artifacts = mkdtempSync(path.join(artifactRoot, 'run-'));
  const org = `e2e-${path.basename(artifacts).toLowerCase()}`;
  console.log(`Desktop E2E artifacts: ${artifacts}`);
  let driver;
  let browser;
  let server;
  let driverError;
  let failed = false;
  const logPath = path.join(artifacts, 'driver.log');
  const logs = [];
  const log = (line) => { logs.push(String(line)); appendFileSync(logPath, String(line)); };
  t.after(async () => {
    try {
      if (browser && failed) {
        await browser.saveScreenshot(path.join(artifacts, 'failure.png')).catch(() => {});
        const source = await browser.getPageSource().catch(() => 'Page source unavailable');
        writeFileSync(path.join(artifacts, 'failure.html'), source);
        const diagnostic = await browser.execute(async () => {
          return await Promise.all(['list_organizations', 'list_sync_states', 'list_my_review_pull_requests'].map(async (command) => {
            try { return [command, await window.__TAURI_INTERNALS__.invoke(command, { input: {} })]; }
            catch (error) { return [command, String(error)]; }
          }));
        }).catch(String);
        writeFileSync(path.join(artifacts, 'backend.json'), JSON.stringify(diagnostic, null, 2));
      }
      if (browser) {
        // Cleanup uses the real backend so Credential Manager loses only this run's fake PAT.
        await browser.execute(async (id) => {
          return await window.__TAURI_INTERNALS__.invoke('delete_organization', { id })
            .then(() => null, (error) => String(error));
        }, org).then((error) => {
          if (error) throw new Error(`Credential cleanup failed for ${org}: ${error}`);
        });
      }
    } finally {
      if (browser) await browser.deleteSession().catch(() => {});
      if (driver?.pid && driver.exitCode === null) {
        try { execFileSync('taskkill', ['/PID', String(driver.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
        catch { /* The driver may have already exited after deleting the session. */ }
      }
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      writeFileSync(path.join(artifacts, 'driver.log'), logs.join(''));
    }
  });
  server = await startFakeAdo({ scenario, org, port: 0, options: {}, log: (line) => log(`${line}\n`) });
  server.prependListener('request', (request) => log(`${request.method} ${request.url}\n`));
  const port = await freePort();
  const nativePort = await freePort();
  const args = ['--port', String(port), '--native-port', String(nativePort)];
  if (process.env.DEVDECK_E2E_NATIVE_DRIVER) args.push('--native-driver', process.env.DEVDECK_E2E_NATIVE_DRIVER);
  driver = spawn(process.env.DEVDECK_E2E_DRIVER ?? 'tauri-driver', args, {
    windowsHide: true,
    env: {
      ...process.env,
      DEVDECK_DATA_DIR: path.join(artifacts, 'data'),
      DEVDECK_ADO_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(artifacts, 'webview'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  driver.on('error', (error) => { driverError = error; });
  driver.stdout.on('data', log);
  driver.stderr.on('data', log);
  const deadline = Date.now() + 15_000;
  while (true) {
    if (driverError) throw new Error('Cannot start tauri-driver. Install: cargo install tauri-driver --locked', { cause: driverError });
    if (driver.exitCode !== null) throw new Error(`tauri-driver exited: ${logs.join('')}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* Wait until the driver binds its port. */ }
    if (Date.now() > deadline) throw new Error(`tauri-driver startup timeout: ${logs.join('')}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await remote({
    hostname: '127.0.0.1', port, logLevel: 'error',
    connectionRetryCount: 0, connectionRetryTimeout: 60_000,
    capabilities: { 'tauri:options': { application } },
    waitforTimeout: 30_000,
  });
  await browser.setTimeout({ script: 15_000 });
  return { browser, org, artifacts, fail: () => { failed = true; } };
}
