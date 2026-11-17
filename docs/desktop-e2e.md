# Windows desktop E2E

`pnpm test:e2e:desktop` uses Node's test runner, WebdriverIO and `tauri-driver`
to launch the actual Tauri executable. It does not use the browser demo or mock
Tauri IPC. The bundled fake Azure DevOps server supplies deterministic PR data.

## Prerequisites

Use an interactive Windows desktop with WebView2, a Node version satisfying
WebdriverIO's engines (for example 22.23.4+ on the Node 22 line), and the normal
Tauri build prerequisites installed.

```powershell
pnpm install --frozen-lockfile
cargo install tauri-driver --locked
```

Install Microsoft Edge WebDriver matching the installed WebView2 runtime version
(the first three version components must match). Put `msedgedriver.exe` on PATH,
or set `DEVDECK_E2E_NATIVE_DRIVER` to its absolute path. `tauri-driver` must also
be on PATH, or use `DEVDECK_E2E_DRIVER` for its absolute path. Driver downloads
are explicit; dependency installation does not download browser drivers.

References: [Tauri WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/),
[Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/).

## Run

```powershell
pnpm tauri build --debug --no-bundle
pnpm test:e2e:desktop
```

Wait for the build to finish before running the tests. A binary produced by
`tauri dev` expects a running Vite server; use `tauri build` for these tests.
The default executable is `target/debug/azdo-dashboard.exe`; `CARGO_TARGET_DIR`
is respected, or set `DEVDECK_E2E_APP` to an explicit executable. Rebuild after
application changes: the test command does not build automatically.

The smoke test registers a fresh fake organization through the UI, submits
the form using Tab/Enter, opens My Reviews, requests sync with Ctrl+E and checks
that PR 101 (`Retry policy for the gateway client`) appears inside the grid.

Each run starts its own loopback fake server and WebDriver ports and gets a
unique data directory and organization name. The fake PAT goes through the
normal Windows Credential Manager path. Teardown deletes only that run's
organization and credential via the real backend, ends the WebDriver session
and stops the driver/server. A forcibly killed test cannot guarantee teardown;
use the organization name in `driver.log` to identify its leftover credential
(`AzDoDeck`, `azdodeck:org:<organization>:pat`).

Artifacts remain in `test-results/desktop/run-*`: a successful PR screenshot,
driver and fake-server request logs, isolated SQLite data, and a failure
screenshot/page source/backend diagnostic when available. These files are
ignored by Git. Browser E2E remains `pnpm test:e2e`.

For the fake-server pagination regression test alone:

```powershell
node --test scripts/fake-ado/server.test.mjs
```

This initial suite targets local Windows runs. CI, other operating systems,
native dialogs, real Azure DevOps credentials and installed release bundles
are outside its coverage.
