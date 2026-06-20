# AGENTS.md

Guidance for coding agents working in this repository.

## Project Shape

This is a Tauri + React dashboard for Azure DevOps. The frontend can run in a
plain browser during development, while the desktop app uses Tauri IPC to reach
Rust services and the Azure DevOps REST API.

Key areas:

- `src/` contains the React app. Feature areas live under `src/features/`
  (`pull-requests`, `work-items`, `commits`, `code`, `pipelines`, `settings`),
  shared UI under `src/components/`, and cross-cutting helpers under `src/lib/`.
- `src/lib/azdoCommands.ts` is the frontend boundary for all backend commands.
  It validates command results with Zod and provides browser-only demo data
  (backed by `src/lib/azdoDemo.ts`).
- `src-tauri/src/` contains the Tauri application, IPC commands, domain
  services, auth, SQLite access, and error conversion. Domain services are one
  module per area: `prs.rs`, `commits.rs`, `orgs.rs`, `projects.rs`,
  `settings.rs`, `search.rs` (cross-kind command-palette search), `sync.rs`
  (background cache refresh), `pipelines.rs`, `code_search.rs`, `pr_review.rs`
  (PR threads/diffs), and `snooze.rs`. Work items are large enough to be their
  own module directory: `src-tauri/src/work_items/` (`sync`, `mutations`,
  `candidates`, `conversions`, `types`).
- `crates/azdo-client/` is a standalone Azure DevOps REST client crate. Keep it
  free of Tauri-specific dependencies.
- `tests/` contains Playwright coverage for the browser preview.

## Common Commands

Rust tools may be missing from the default PowerShell path. If `cargo` is not
found, add it for the current shell:

```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
```

| Need | Command |
| --- | --- |
| Browser dev server | `pnpm dev` |
| Tauri desktop dev app | `pnpm tauri dev` |
| Type-check TypeScript | `pnpm tsc --noEmit` |
| Run TypeScript tests once | `pnpm test -- --run` |
| Run one TypeScript test file | `pnpm test -- --run src/path/to/file.test.ts` |
| Run Playwright browser tests | `pnpm test:e2e` |
| Build browser app | `pnpm build` |
| Check Rust formatting | `cargo fmt --all --check` |
| Lint Rust strictly | `cargo clippy --workspace --all-targets -- -D warnings` |
| Run Rust tests | `cargo test --workspace` |
| Run one Rust test | `cargo test --package azdo-client test_name` |
| Build desktop app | `pnpm tauri build` |

## Runtime Boundaries

Do not assume Tauri APIs exist when the app is launched with `pnpm dev`. The
browser dev path is intentional: `azdoCommands.ts` checks the runtime with
`isTauriRuntime()` and sends commands to `demoInvoke()` when Tauri is unavailable. Removing that fallback
breaks normal browser development because `invoke()` is only available in the
desktop runtime.

In the desktop app, the command path is:

```text
React component -> azdoCommands.ts -> Tauri invoke()
  -> #[tauri::command] in src-tauri/src/lib.rs
  -> domain service -> AdoClient -> Azure DevOps REST
```

When changing command behavior, keep both runtimes working.

## Adding Or Changing IPC

Treat IPC as a four-part contract:

1. Add or update the `#[tauri::command]` function in `src-tauri/src/lib.rs`, and
   register it in `generate_handler![]`.
2. Put domain logic in the matching service module under `src-tauri/src/`
   (`prs.rs`, `work_items/`, `commits.rs`, `orgs.rs`, `projects.rs`,
   `pipelines.rs`, `code_search.rs`, `pr_review.rs`, `snooze.rs`, `search.rs`,
   or `settings.rs`).
3. Update `src/lib/azdoCommands.ts` with the command wrapper, Zod schema, and
   browser demo branch.
4. Call the wrapper from the relevant React feature/component.

Before calling the work done, make sure TypeScript still type-checks and the
Rust tests pass. For new commands, the demo implementation and schema are part
of the required work, not polish.

## Azure DevOps URLs

For pull request web links, build the browser URL from trusted fields instead
of reusing REST metadata. `pr.url` is an API endpoint, and `_links.web.href` is
not present in every response shape.

Use this shape in Rust:

```rust
format!(
    "{}/{}/_git/{}/pullrequest/{}",
    organization.base_url,
    proj_name,
    repo_name,
    pr.pull_request_id
)
```

`organization.base_url` has no trailing slash and is expected to look like
`https://dev.azure.com/{org}`. If the URL is used inside a struct literal,
compute it in a local `let web_url = ...` first so moved fields are not borrowed
afterward.

## Backend Conventions

Most Tauri services follow this shape:

```rust
XService {
    db: AppDatabase,
    secrets: SecretStore,
}
```

`settings.rs` only needs the database. `AppDatabase` is a cloneable path wrapper that opens SQLite connections per call
via `rusqlite`. Schema migrations live in `src-tauri/src/db.rs:migrate()` and
use `PRAGMA user_version`; the current schema version is the `SCHEMA_VERSION`
constant at the top of `db.rs` (currently `14`). `migrate()` applies each
`if current < N` step in order and must stay repeatable; add a new numbered
step rather than editing an existing one.

`AppError` in `src-tauri/src/error.rs` is the IPC-facing error type. It
serializes to JSON containing a `message`, and the frontend should read that via
`commandErrorMessage()` in `azdoCommands.ts`. `AppError` converts from
`AdoError`, `keyring::Error`, `rusqlite::Error`, and `std::io::Error`.

## Background Sync

`sync.rs` runs a Tokio loop (`SyncRunner`) that periodically refreshes active
PRs, review PRs, work items, and commits into the SQLite cache, then emits
Tauri events the frontend subscribes to: `sync:updated` after each cache write,
plus `notifications:pull-requests` / `notifications:work-items` for desktop
notifications. Read-only feature screens (My Reviews, My Work Items) render from
the cache and react to `sync:updated`; they do not call the REST API directly.
Use the `subscribeTauriEvent` helper in `src/lib/tauriEvents.ts` to subscribe and
invalidate the relevant TanStack Query keys. Search/edit screens still issue
on-demand commands that hit the API.

The `azdo-client` crate should remain a reusable REST client. Route HTTP calls
through `AdoClient::get_json` and `post_json` so retry behavior, 401 handling,
429 `Retry-After`, and 5xx retries stay consistent. Default: 3 attempts, 250ms
base delay.

## Authentication And Secrets

Organizations use `auth_provider` values of exactly `pat` or `azure_cli`.
Preserve the underscore form: `client_for_organization()` in
`src-tauri/src/auth.rs` matches it exactly. The hyphenated `azure-cli` string
is only used as part of a credential key.

Secret rules:

- Store secrets only through Windows Credential Manager via the `keyring` crate.
- Service name: `AzDoDeck`.
- Credential key forms:
  - `azdodeck:org:{org}:pat`
  - `azdodeck:org:{org}:azure-cli`
- Never persist PATs or Azure CLI tokens in SQLite, config files, logs, tests,
  or demo fixtures.

PAT auth sends `Authorization: Basic base64(":{pat}")`. Azure CLI auth shells
out to `az account get-access-token --query accessToken --output tsv`, then
caches the bearer token in memory for five minutes.

## Frontend Conventions

The UI uses React, TanStack Query, Tailwind, and hand-rolled shared components
under `src/components/`. Prefer the existing feature structure under
`src/features` for new work. Keep command calls behind `src/lib/azdoCommands.ts`;
components should not call Tauri IPC directly.

Server state should go through TanStack Query. When a backend mutation changes
data already shown on screen, update or invalidate the relevant query keys
rather than relying on incidental rerenders.

Keep the app usable for keyboard-heavy workflows. When adding or changing
shortcuts, make them discoverable in the UI, avoid stealing focus during normal
row navigation, and preserve the expected tab order for grids, preview panes,
filters, and comment editors.

Keyboard operability is a hard requirement, not a nice-to-have: every
interactive element must have a complete keyboard path, and you should always
build one when adding UI. A feature that can only be driven by the mouse is
incomplete. Concretely, for any new popover, menu, or dialog:

- Open it focused on a sensible first control, and let the user move between all
  controls and activate them with the keyboard alone (arrow keys to move,
  Enter/Space to confirm, Escape to cancel).
- Contain navigation keys within the popup so the underlying grid does not also
  react (e.g. stop arrow/Enter propagation).
- On close — whether confirmed, cancelled, or dismissed — return focus to the
  element that owned it (typically the originating grid) so keyboard navigation
  resumes without being stranded on the preview pane or `<body>`.

Verify new keyboard flows end to end, not just that the click path works.

Prefer dense, work-focused screens. Avoid large unused panels and decorative
spacing in operational views; use available height for grids, previews,
comments, and relevant metadata. Long lists should be virtualized with the
existing local windowing pattern used by the grids instead of rendering all
rows.

When rendering Azure DevOps rich text, sanitize and normalize the HTML before
displaying it. Mentions, comments, images, and links should display like the web
UI as much as practical, while never leaking raw service HTML into the visible
text.

Pull request views currently work from locally synchronized active PR data.
Do not add UI options that imply unsupported backend coverage, such as "all
statuses", unless the service and cache layer are updated at the same time.

## Working Safely

- Keep browser demo mode healthy when touching command code.
- Keep the standalone `azdo-client` crate independent from the Tauri app.
- Avoid broad refactors unless they are needed for the requested change.
- Do not move secrets out of the keyring-backed path.
- When changing REST behavior, prefer tests in `crates/azdo-client/` using
  `wiremock`.
- When changing user-visible flows, add or update focused frontend tests or
  Playwright coverage when the behavior is risky enough to warrant it.

## Keeping The Spec Current

`docs/spec-overview.md` is the current-state specification of the app
(architecture, IPC contract, views, auth, sync, data model, settings,
keyboard, constraints). When a change diverges from what that document
describes, update `docs/spec-overview.md` as part of the same change so the
spec and the code never drift apart. Treat the spec update as part of the
work, not a follow-up: adding or changing a view, command, setting, sync
scope, schema version, or keyboard shortcut should land together with its
spec edit.

## Verification Checklist

Choose checks based on the files touched:

- Frontend/type changes: `pnpm tsc --noEmit`
- React unit behavior: `pnpm test -- --run`
- Browser workflow changes: `pnpm test:e2e`
- Rust service/client changes: `cargo test --workspace`
- Rust lint-sensitive changes: `cargo clippy --workspace --all-targets -- -D warnings`
- Release/build confidence: `pnpm tauri build`

If a check is skipped, note why in the handoff.
