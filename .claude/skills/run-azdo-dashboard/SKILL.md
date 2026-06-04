---
name: run-azdo-dashboard
description: Build, run, and drive azdo-dashboard. Use when asked to start the app, run it, take a screenshot of its UI, test a UI change, interact with the running app, or verify a feature works visually.
---

Azure DevOps dashboard (Tauri + React). In browser dev mode it runs entirely on demo data — no Azure credentials needed. Drive it via `.claude/skills/run-azdo-dashboard/driver.mjs` after starting the Vite dev server separately.

## Prerequisites

`pnpm` and Node.js must be on PATH. Install Playwright's Chromium browser once after cloning:

```powershell
pnpm exec playwright install chromium
```

## Setup

```powershell
pnpm install
```

## Run (agent path)

**Step 1 — start the dev server** in a separate terminal or background job:

```powershell
# PowerShell background job
$job = Start-Job { Set-Location $using:PWD; pnpm dev --host 127.0.0.1 --port 1420 }
# Wait until the port responds (poll, don't sleep)
while (-not (Test-NetConnection 127.0.0.1 -Port 1420 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }
```

Or from Bash tool:

```bash
pnpm dev --host 127.0.0.1 --port 1420 &
timeout 30 bash -c 'until curl -sf http://127.0.0.1:1420 >/dev/null; do sleep 0.5; done'
```

**Step 2 — run the driver:**

```bash
# Screenshot of home page
node .claude/skills/run-azdo-dashboard/driver.mjs screenshot

# Navigate to a specific view and screenshot
node .claude/skills/run-azdo-dashboard/driver.mjs nav workitems
node .claude/skills/run-azdo-dashboard/driver.mjs nav home
node .claude/skills/run-azdo-dashboard/driver.mjs nav prsearch
node .claude/skills/run-azdo-dashboard/driver.mjs nav commits
node .claude/skills/run-azdo-dashboard/driver.mjs nav settings

# Screenshot all views (smoke test)
node .claude/skills/run-azdo-dashboard/driver.mjs smoke

# Navigate to an arbitrary URL
node .claude/skills/run-azdo-dashboard/driver.mjs custom http://127.0.0.1:1420/?scenario=large-data
```

Screenshots land in `os.tmpdir()` — `C:\Users\<user>\AppData\Local\Temp\azdo-<route>.png` on Windows. Pass an explicit path as the last argument to override:

```bash
node .claude/skills/run-azdo-dashboard/driver.mjs nav workitems C:/tmp/wi.png
```

The driver fails fast with a clear message if the server isn't running.

## Run (human path)

```powershell
pnpm dev    # browser opens at http://localhost:1420 — Ctrl-C to stop
```

For the full desktop Tauri app (requires Rust):

```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
pnpm tauri dev
```

## Test

Unit tests (Vitest, fast):

```bash
pnpm test -- --run
```

Browser e2e tests (Playwright — starts dev server automatically):

```bash
pnpm test:e2e
```

Expected result: **2 pass, 1 fail**. The failing test (`lets an agent exercise the main demo-data workflows`, line 61) times out on the "Post comment" button click. This is a pre-existing failure on the current branch — `WorkItemPreviewPanel.tsx` has uncommitted changes that may be causing it.

## Gotchas

- **`pnpm dev` must use `--host 127.0.0.1`** for the driver and e2e tests — the default `localhost` binding behaves differently on some machines.
- **Port 1420 is fixed** (`strictPort: true` in `vite.config.ts`). If something else is already using it, Vite refuses to start. Check with `netstat -ano | findstr :1420`.
- **Demo data only in browser mode.** `isTauriRuntime()` returns `false` without the Tauri runtime, so all IPC calls route to `demoInvoke()` fixture data. The app never contacts Azure DevOps in this mode.
- **`scenario` query param** switches fixture datasets: `/?scenario=rich-text` loads HTML-rich work items, `/?scenario=large-data` loads a large PR set for virtualization testing.
- **Playwright controlled inputs.** Don't use `page.evaluate(() => el.value = …)` for form fields — React's onChange won't fire. Use `fill()` or `type()` through the driver.
