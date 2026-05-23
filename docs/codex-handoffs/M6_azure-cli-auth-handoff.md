# M6 Azure CLI Auth Handoff

## Goal

Allow AzDoDeck to use the locally signed-in Azure CLI account instead of requiring a Personal Access Token for every organization.

## Delivered

- Added `AzureCliProvider` to `azdo-client`.
  - Runs `az account get-access-token` for the Azure DevOps resource.
  - Emits `Bearer` auth headers.
  - Caches the token in memory for a short TTL.
  - Returns actionable auth errors when Azure CLI is missing or not logged in.
- Added Tauri `add_azure_cli_organization` command.
- Persisted Azure CLI organizations with `auth_provider = "azure_cli"` and no stored secret.
- Added a backend auth helper so PR, work item, and commit searches work with both PAT and Azure CLI organizations.
- Added Settings UI support for connecting an organization with Azure CLI.
- Displayed each organization's auth provider in Settings.
- Extended frontend and Rust tests for the new auth path.

## Verification

- `cargo fmt --all --check`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `npx tsc --noEmit`
- `npx vitest --run`
- `pnpm build`

## Deferred

- Interactive verification with a real `az login` session.
- User-facing diagnostics beyond command error text.
- Structured tracing around Tauri command entry/exit.
- Bounded concurrency for project/repository traversal.
