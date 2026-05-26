# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

`cargo` is not on the default PowerShell PATH. Prefix Rust commands with:
```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
```

| Task | Command |
|---|---|
| Start dev server (browser mode) | `pnpm dev` |
| Start Tauri desktop app | `pnpm tauri dev` |
| TypeScript type check | `pnpm tsc --noEmit` |
| Run TS tests | `pnpm test -- --run` |
| Run single TS test file | `pnpm test -- --run src/path/to/file.test.ts` |
| Rust format check | `cargo fmt --all --check` |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` |
| Run all Rust tests | `cargo test --workspace` |
| Run single Rust test | `cargo test --package azdo-client test_name` |
| Build desktop app | `pnpm tauri build` |

## Architecture

### Dual runtime: browser dev vs. Tauri

`pnpm dev` launches a pure browser session (no Tauri runtime). `src/lib/azdoCommands.ts` detects this with `isTauriRuntime()` and routes every command to `demoInvoke()` fixture data instead of the real IPC. This is intentional — do not remove it. Without the `demoInvoke` branch, `pnpm dev` crashes on every command because `invoke()` does not exist in a browser context.

When Tauri is running, commands flow: React → `invoke()` → `#[tauri::command]` fn in `src-tauri/src/lib.rs` → domain service → `AdoClient` → Azure DevOps REST.

### IPC contract (four-place rule)

Adding a new command requires changes in exactly four places:
1. `src-tauri/src/lib.rs` — declare the `#[tauri::command]` fn and add it to `generate_handler![]`
2. The relevant domain service in `src-tauri/src/{prs,work_items,commits,orgs,settings}.rs`
3. `src/lib/azdoCommands.ts` — add a Zod schema, typed wrapper fn, and a `demoInvoke` branch
4. The calling component in `src/App.tsx` or relevant feature file

Done when: `pnpm tsc --noEmit` clean + `cargo test --workspace` green + `demoInvoke` branch added with a matching Zod schema.

### ADO web URL construction

Always construct PR browser URLs from known pieces — never trust `pr.url` (REST API endpoint) or `_links.web.href` (absent from reviewer-search responses):
```rust
format!("{}/{}/_git/{}/pullrequest/{}", organization.base_url, proj_name, repo_name, pr.pull_request_id)
```
`organization.base_url` is `https://dev.azure.com/{org}` with no trailing slash. When constructing this inside a struct literal, hoist into a `let web_url = ...` first — fields like `proj_name` and `repo_name` are moved into the struct and cannot be borrowed afterward.

### Rust crate layout

- `src-tauri/src/` — Tauri app. Domain services follow the pattern `XService { db: AppDatabase, secrets: SecretStore }` (`prs.rs`, `work_items.rs`, `commits.rs`, `orgs.rs`); `settings.rs` takes only `db`.
- `crates/azdo-client/` — Independent ADO REST client crate (no Tauri dependency). Tested with `wiremock`. All REST calls go through `AdoClient::get_json` / `post_json`, which handle 401 (Unauthorized), 429 (rate-limited with `Retry-After`), and 5xx (retried). Default: 3 attempts, 250ms base delay.

### Authentication

`auth_provider` in the `organizations` table is either `"pat"` or `"azure_cli"`. The underscore in `"azure_cli"` is load-bearing — it is matched exactly in `client_for_organization()`; the hyphenated form `"azure-cli"` appears only as a keyring credential key suffix. `client_for_organization()` in `src-tauri/src/auth.rs` reads this and constructs the right `AdoCredentialProvider`:
- **PAT**: reads from keyring, sends `Authorization: Basic base64(":{pat}")`
- **Azure CLI**: calls `az account get-access-token --query accessToken --output tsv`, caches bearer token in memory with 5-min TTL (`Duration::from_secs(300)`), never persists

Secrets are stored exclusively in Windows Credential Manager via the `keyring` crate. Service name: `"AzDoDeck"`. Credential keys: `azdodeck:org:{org}:pat` / `azdodeck:org:{org}:azure-cli`. Never store secrets in SQLite or config files.

### Database

SQLite via `rusqlite` (connection-per-call pattern). `AppDatabase` is a path wrapper that implements `Clone`. Migrations use `PRAGMA user_version`; current `SCHEMA_VERSION = 1`. Tables: `app_settings` (key/value), `organizations`. Schema lives in `src-tauri/src/db.rs:migrate()`.

### Error handling

`AppError` in `src-tauri/src/error.rs` serializes to `{ "message": "..." }` JSON for Tauri IPC. Frontend extracts the message with `commandErrorMessage()` from `azdoCommands.ts`. `AppError` converts from `AdoError`, `keyring::Error`, `rusqlite::Error`, and `std::io::Error`.

### React frontend

All UI lives in `src/App.tsx` (single-file). `src/lib/azdoCommands.ts` is the typed IPC layer with runtime Zod validation on every response. TanStack Query manages server state. shadcn/ui components are in `src/components/ui/`.
