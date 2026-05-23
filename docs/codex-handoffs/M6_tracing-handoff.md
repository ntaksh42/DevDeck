# M6 Tracing Handoff

## Goal

Add structured tracing points around Azure DevOps command and search execution without exposing secrets.

## Delivered

- Added `tracing` to the Tauri backend crate.
- Instrumented Tauri commands with `#[tracing::instrument]`.
- Skipped PAT-bearing command inputs in tracing fields.
- Added backend events for:
  - Azure DevOps client creation by auth provider,
  - organization credential validation,
  - PR, work item, and commit search completion with result counts.

## Verification

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`

## Deferred

- Installing a concrete log sink/subscriber for persisted logs.
- User-visible diagnostics view.
- Bounded concurrency for broad project/repository traversal.
