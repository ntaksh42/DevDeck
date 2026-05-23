# M2 - Local App State And Organization Setup

## Goal

Add the first usable setup flow for Azure DevOps Services organizations:

- local SQLite configuration database.
- OS credential store backed PAT persistence.
- Tauri commands for listing and adding organizations.
- React settings/onboarding UI.
- validation through Azure DevOps `connectionData` before persisting an organization.

## Key Decisions

1. **Organization id is the normalized Azure DevOps organization slug.** This keeps M2 simple and deterministic. If multi-account support needs duplicate organization entries later, introduce UUIDs in a migration.
2. **PAT is stored in Windows credential storage through `keyring`.** SQLite stores only `credential_key` and non-secret metadata.
3. **SQLite opens per operation.** The app state stores an `AppDatabase` path wrapper instead of a long-lived connection, avoiding cross-thread connection ownership issues.
4. **Migrations use `PRAGMA user_version`.** M2 has schema version 1 and migration is repeatable.
5. **Frontend command responses are parsed with `zod`.** This keeps the Tauri boundary explicit.
6. **Azure CLI auth remains deferred.** M2 supports PAT only; M6 owns Azure CLI auth and retry/backoff.

## Files Added/Modified

- `src-tauri/Cargo.toml` - added `rusqlite`, `keyring`, `chrono`, `thiserror`, and `tempfile`.
- `src-tauri/src/db.rs` - SQLite schema, migrations, organization repository functions, tests.
- `src-tauri/src/error.rs` - serializable command errors.
- `src-tauri/src/secrets.rs` - OS credential store wrapper.
- `src-tauri/src/orgs.rs` - organization validation and PAT-backed add flow, tests.
- `src-tauri/src/lib.rs` - managed app state and Tauri command registration.
- `src/lib/azdoCommands.ts` - typed Tauri command wrapper with `zod`.
- `src/App.tsx` - settings shell, onboarding form, configured organization list.
- `src/App.test.tsx` - frontend behavior tests.
- `vite.config.ts` - Vitest `jsdom` environment.
- `docs/codex-handoffs/*` - roadmap and handoff documentation.
- `AGENTS.md` - pointer to existing agent guidance and handoffs.

## Verification Done

- `cargo fmt --all --check`: pass.
- `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `cargo test --workspace`: 9 tests pass.
- `npx tsc --noEmit`: pass.
- `npx vitest --run`: 4 tests pass.
- `pnpm build`: pass.
- `Invoke-WebRequest http://127.0.0.1:1420`: HTTP 200 from Vite dev server.

## Manual Verification

- Vite dev server is running at `http://127.0.0.1:1420`.
- Codex in-app browser was unavailable in this environment (`agent.browsers.list()` returned no browsers), so visual browser verification was not completed.
- `pnpm tauri dev` was not run to completion because it opens the desktop app and requires interactive/manual PAT validation.

## Open Questions

- Should M3 introduce active organization selection, or is a single configured organization enough until background sync exists?
- Should the app support removing an organization in M3, or wait until settings are more complete?
- Should `credential_key` include an app-specific namespace with the Tauri identifier instead of `azdodeck:...`?

## Deferred Items

- Azure CLI authentication provider.
- Secret deletion and credential rotation UI.
- Active organization setting.
- PR, WorkItem, and Commit search.
- Retry/backoff and structured diagnostics.
