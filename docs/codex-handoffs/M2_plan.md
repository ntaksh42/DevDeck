# M2 Plan - Local App State And Organization Setup

## Goal

Implement the first usable local setup flow:

- Store app configuration in SQLite.
- Store PAT secrets in the OS credential store, not SQLite.
- Let the user add an Azure DevOps Services organization from the frontend.
- Validate credentials by calling `connectionData`.
- Show the configured organization and authenticated user after setup.

## Acceptance Criteria

- A fresh app can create its local database automatically.
- Migrations are versioned and repeatable.
- A PAT is written to the OS credential store through the Tauri backend.
- SQLite stores only non-secret metadata and keyring lookup identifiers.
- The frontend can submit organization name + PAT.
- The backend validates the PAT with Azure DevOps `connectionData` before saving the organization as active.
- On restart, the app can load saved organization metadata without exposing the PAT.
- Rust tests cover migration behavior and command/service validation where practical.
- Frontend tests cover the setup form state and success/error rendering.

## Suggested Data Model

SQLite tables:

```sql
app_settings(
  key text primary key,
  value text not null,
  updated_at text not null
)

organizations(
  id text primary key,
  name text not null,
  display_name text,
  base_url text not null,
  auth_provider text not null,
  credential_key text not null,
  authenticated_user_id text,
  authenticated_user_display_name text,
  created_at text not null,
  updated_at text not null
)
```

Notes:

- `name` is the Azure DevOps organization slug.
- `base_url` is normally `https://dev.azure.com/{organization}`.
- `auth_provider` starts with `pat`; later M6 can add `azure_cli`.
- `credential_key` should be deterministic enough to reload but not include the secret, for example `azdodeck:org:{id}:pat`.

## Rust Implementation Plan

1. Add dependencies in `src-tauri/Cargo.toml`:
   - `rusqlite` with bundled SQLite if needed.
   - `keyring`.
   - `chrono` from workspace if timestamps are needed.
   - `thiserror` or `anyhow` depending on the local command error style.
2. Add `src-tauri/src/db.rs`:
   - open app database path.
   - run migrations in order.
   - expose repository functions for settings and organizations.
3. Add `src-tauri/src/secrets.rs`:
   - save PAT by credential key.
   - load PAT by credential key.
   - delete PAT when organization is removed in future scope.
4. Add `src-tauri/src/orgs.rs`:
   - validate organization slug.
   - build Azure DevOps base URL.
   - call `azdo-client` with `PatProvider`.
   - persist organization after successful validation.
5. Add Tauri commands:
   - `list_organizations()`.
   - `add_pat_organization(input)`.
   - optionally `get_active_organization()`.
6. Wire state in `src-tauri/src/lib.rs` using `tauri::Manager` and managed app state.

## Frontend Implementation Plan

1. Replace the placeholder `App.tsx` with a real application shell:
   - left navigation or top tab area for Dashboard and Settings.
   - main panel showing onboarding when no organization exists.
2. Add organization setup form:
   - organization slug input.
   - PAT input with password visibility toggle.
   - submit/loading/error/success states.
3. Add a small Tauri API wrapper:
   - typed command calls.
   - `zod` validation for command responses if responses are not trivial.
4. Add tests for:
   - empty state renders setup form.
   - validation blocks empty organization/PAT.
   - backend error renders a useful message.

## Important Decisions To Preserve

- Do not store PATs in SQLite or frontend local storage.
- Keep the initial scope to Azure DevOps Services at `dev.azure.com`.
- Do not add Azure CLI auth in M2; reserve it for M6.
- Do not implement PR/WorkItem/Commit search in M2.
- Keep the first UI practical and app-like, not a marketing page.

## Verification Checklist

Run before marking M2 done:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm build
pnpm test -- --run
```

Manual check:

```sh
pnpm tauri dev
```

Confirm the app opens, setup form renders, invalid input is rejected, and a valid PAT can add an organization.

## Handoff Template For M2 Completion

Create `M2_codex-handoff.md` with:

- Goal.
- Key decisions.
- Files added/modified.
- Verification done.
- Manual verification result.
- Open questions.
- Deferred items.
