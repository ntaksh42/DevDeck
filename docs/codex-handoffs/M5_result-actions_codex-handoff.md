# M5 Result Actions Handoff

## Goal

Make search results directly usable by opening Azure DevOps web URLs from pull request, work item, and commit rows.

## Delivered

- Added a shared Tauri runtime detector in `src/lib/runtime.ts`.
- Added `openExternalUrl` in `src/lib/openExternal.ts`.
  - Uses Tauri opener `openUrl` inside the desktop app.
  - Uses `window.open` in browser preview mode.
  - Allows only `http` and `https` URLs.
- Added Open buttons to PR, work item, and commit result rows when a `webUrl` exists.
- Extended frontend tests to verify Tauri opener calls and browser preview fallback behavior.

## Verification

- `npx tsc --noEmit`
- `npx vitest --run`

## Deferred

- Copy-to-clipboard actions remain unimplemented. (Since shipped: `C` copies the row URL in the PR, work item, and commit grids.)
- Real Azure DevOps link opening was not manually verified because it requires an interactive desktop session.
