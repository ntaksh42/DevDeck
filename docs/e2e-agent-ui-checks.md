# Agent UI Checks

Use Playwright for browser-preview UI verification. This runs against `pnpm dev` and the app's demo-data fallback, so no PAT, Azure CLI login, or Tauri WebView is required.

## Commands

```sh
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:ui
```

Run the install command once per machine. `pnpm test:e2e` starts Vite on `http://127.0.0.1:1420`, opens Chromium, and exercises the main UI workflows.

## What This Covers

- Pull Request search.
- My Reviews grid, filters, vote tabs, draft toggle, and status bar.
- Work Item search.
- Commit search.
- Settings organization display.

## Notes

- This is a UI automation harness for Agent-driven checks, not a live Azure DevOps integration test.
- Live integration still requires running the Tauri app with a valid PAT or an `az login` session.
