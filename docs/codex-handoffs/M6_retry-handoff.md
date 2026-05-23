# M6 Retry Handoff

## Goal

Harden Azure DevOps REST calls against transient throttling and server failures.

## Delivered

- Added `RetryPolicy` to `azdo-client`.
- Enabled default retry behavior for all `AdoClient` GET and POST JSON calls:
  - up to 3 attempts,
  - exponential backoff for transient 5xx responses,
  - `Retry-After` handling for 429 responses with a local cap,
  - retry for connection and timeout errors.
- Added structured `tracing::warn!` events for retried requests without logging credentials.
- Kept unauthorized responses non-retriable.
- Added tests covering:
  - existing no-retry 401/429/500 behavior,
  - GET retry after transient 500,
  - POST retry after 429.

## Verification

- `cargo fmt --all --check`
- `cargo test -p azdo-client`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`

## Deferred

- Azure CLI authentication provider.
- Frontend auth provider selection.
- User-visible diagnostics beyond the current command error messages.
- Bounded concurrency for broad project/repository traversal.
