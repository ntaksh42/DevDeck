# azdo-dashboard review guidelines

Project-specific things to check when reviewing a PR in this repo. These come
from the repository's `AGENTS.md` and are the rules a generic reviewer would
miss. Check the diff against the relevant sections below; ignore sections that
the diff doesn't touch.

The repo is a **Tauri + React dashboard for Azure DevOps**. The frontend runs
both in a plain browser (dev) and in the Tauri desktop app, which reaches a Rust
backend and the Azure DevOps REST API.

Layout:
- `src/` — React app, features, shared UI, typed command layer.
- `src/lib/azdoCommands.ts` — the frontend boundary for all backend commands
  (Zod validation + browser demo data).
- `src-tauri/src/` — Tauri app, IPC commands, domain services, auth, SQLite.
- `crates/azdo-client/` — standalone Azure DevOps REST client crate.
- `tests/` — Playwright coverage for the browser preview.

## 1. IPC contract (highest-signal — check first)

IPC is a **four-part contract**. If a PR adds or changes a backend command,
*all four* parts must be present. A missing part is a **blocking** finding —
the runtime will break or a runtime will silently diverge.

1. `#[tauri::command]` function added/updated in `src-tauri/src/lib.rs`, **and
   registered in `generate_handler![]`**. A command not in `generate_handler!`
   fails at `invoke()` time — easy to miss, high impact.
2. Domain logic in the matching service module under `src-tauri/src/`
   (`prs.rs`, `work_items.rs`, `commits.rs`, `orgs.rs`, `settings.rs`) — not
   inline in `lib.rs`.
3. `src/lib/azdoCommands.ts` updated with the command wrapper, **Zod schema**,
   and the **browser demo branch**. The demo implementation and schema are
   required work, not polish.
4. The wrapper is called from the relevant React feature/component (not raw
   `invoke()` in a component).

Also flag: TypeScript no longer type-checks, or Rust tests would fail, for an
IPC change.

## 2. Runtime boundaries (browser + desktop must both work)

- The browser dev path is intentional. `azdoCommands.ts` checks
  `isTauriRuntime()` and routes to `demoInvoke()` when Tauri is unavailable.
  **Removing or bypassing that fallback is blocking** — it breaks `pnpm dev`,
  because `invoke()` only exists in the desktop runtime.
- A command change that updates only one runtime (e.g. real backend but no demo
  branch, or vice versa) is a defect. Both runtimes must stay working.
- Components must not call Tauri `invoke()` directly — command calls go through
  `src/lib/azdoCommands.ts`.

## 3. Secrets and auth (zero-tolerance)

- Secrets are stored **only** through Windows Credential Manager via the
  `keyring` crate. Service name `AzDoDeck`. Moving secrets out of the
  keyring-backed path is **blocking**.
- **Never** persist PATs or Azure CLI tokens in SQLite, config files, logs,
  tests, or demo fixtures. A token in any of those is a blocking leak.
- Credential key forms: `azdodeck:org:{org}:pat`,
  `azdodeck:org:{org}:azure-cli`.
- `auth_provider` values are exactly `pat` or `azure_cli` (underscore).
  `client_for_organization()` in `auth.rs` matches the underscore form exactly;
  the hyphenated `azure-cli` is only used inside a credential key. Flag any code
  that confuses these two forms.
- PAT auth sends `Authorization: Basic base64(":{pat}")`. Azure CLI shells out
  to `az account get-access-token ...` and caches the bearer token in memory for
  five minutes.

## 4. azdo-client crate independence

- `crates/azdo-client/` must stay a reusable REST client, **free of
  Tauri-specific dependencies**. A Tauri import landing in this crate is a
  blocking design violation.
- HTTP calls should route through `AdoClient::get_json` / `post_json` so retry,
  401 handling, 429 `Retry-After`, and 5xx retries stay consistent (default: 3
  attempts, 250ms base delay). Flag a hand-rolled `reqwest` call that bypasses
  this.
- REST behavior changes should be covered by `wiremock`-based tests in
  `crates/azdo-client/`.

## 5. Azure DevOps URLs

For PR web links, build the browser URL from trusted fields — don't reuse REST
metadata. `pr.url` is an API endpoint, and `_links.web.href` isn't present in
every response shape. Correct shape:

```rust
format!(
    "{}/{}/_git/{}/pullrequest/{}",
    organization.base_url, proj_name, repo_name, pr.pull_request_id
)
```

`organization.base_url` has no trailing slash (`https://dev.azure.com/{org}`).
Inside a struct literal, compute it in a local `let web_url = ...` first so
moved fields aren't borrowed afterward. Flag use of `pr.url` /
`_links.web.href` for a user-facing link.

## 6. Backend conventions

- Service shape is usually `XService { db: AppDatabase, secrets: SecretStore }`
  (`settings.rs` needs only `db`).
- SQLite is opened per-call via `rusqlite` through the cloneable `AppDatabase`
  path wrapper. Schema migrations live in `src-tauri/src/db.rs:migrate()` using
  `PRAGMA user_version`. A schema change must add a migration and bump the
  version — flag a schema change without a migration.
- `AppError` (`src-tauri/src/error.rs`) is the IPC-facing error type; it
  serializes to JSON with a `message`, read on the frontend via
  `commandErrorMessage()`. It converts from `AdoError`, `keyring::Error`,
  `rusqlite::Error`, `std::io::Error`. Flag a new error path that doesn't flow
  through `AppError`.

## 7. Frontend conventions

- Stack: React, TanStack Query, Tailwind, hand-rolled shared components under
  `src/components/`. New work belongs in the `src/features` structure.
- **Server state goes through TanStack Query.** When a mutation changes data
  already on screen, the relevant query keys must be updated or invalidated —
  relying on incidental rerenders is a defect. Flag mutations that don't
  invalidate/update their query keys.
- Rendering Azure DevOps rich text: sanitize and normalize the HTML before
  display. Mentions, comments, images, links should look like the web UI;
  **raw service HTML must never leak into visible text.** Flag unsanitized
  `dangerouslySetInnerHTML` of service-provided HTML.
- PR views work from locally synchronized **active** PR data. Don't add UI that
  implies unsupported backend coverage (e.g. an "all statuses" option) unless
  the service and cache layer are updated in the same PR.
- Prefer dense, work-focused screens. Long lists must be virtualized with the
  existing local windowing pattern, not rendered all at once. Flag a new
  unvirtualized long list.

## 8. Keyboard operability (hard requirement)

Keyboard operability is a **hard requirement, not a nice-to-have**. A new
interactive element reachable only by mouse is an **incomplete feature** —
treat it as blocking. For any new popover, menu, or dialog, check:

- Opens focused on a sensible first control; user can move between all controls
  and activate them with the keyboard alone (arrows to move, Enter/Space to
  confirm, Escape to cancel).
- Navigation keys are **contained** within the popup so the underlying grid
  doesn't also react (arrow/Enter propagation stopped).
- On close (confirm, cancel, or dismiss) focus **returns to the element that
  owned it** (typically the originating grid), so keyboard nav resumes and the
  user isn't stranded on the preview pane or `<body>`.
- New shortcuts are discoverable in the UI, don't steal focus during normal row
  navigation, and preserve tab order for grids, preview panes, filters, and
  comment editors.

## 9. Scope and safety

- Changes should be surgical — broad refactors of untouched code, drive-by
  reformatting, or "improvements" to adjacent code are out of scope and worth a
  comment. Match existing style.
- Unused imports/variables/functions introduced by the change should be removed.

## 10. Verification expectations

The PR's changes imply which checks should have been run; flag when an obviously
relevant one is missing:

- Frontend/type changes → `pnpm tsc --noEmit`
- React unit behavior → `pnpm test -- --run`
- Browser workflow changes → `pnpm test:e2e`
- Rust service/client changes → `cargo test --workspace`
- Rust lint-sensitive changes → `cargo clippy --workspace --all-targets -- -D warnings`
