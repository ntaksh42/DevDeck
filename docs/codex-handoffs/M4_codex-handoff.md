# M4 - Work Item Search

## Goal

Add Azure DevOps work item search across configured projects.

## What Shipped

- `azdo-client` now supports:
  - `POST _apis/wit/wiql` for WIQL queries.
  - `POST _apis/wit/workitemsbatch` for fetching work item fields.
- Tauri backend now has `search_work_items`.
- The command:
  - resolves the selected organization.
  - loads its PAT from the OS credential store.
  - lists projects.
  - runs project-scoped WIQL.
  - fetches work item details in batch.
  - returns up to 100 newest results.
- React UI now has a Work Items dashboard with:
  - organization selector.
  - title search.
  - state filter.
  - work item type text filter.
  - result list with id, type, state, changed date, project, and assignee.

## Key Decisions

1. **M4 uses live WIQL, not cache.** This matches M3 and keeps the product moving with end-to-end search before background sync exists.
2. **Search text maps to `System.Title CONTAINS`.** This avoids trying to search every field before field selection and query UX are designed.
3. **State and type are WIQL filters.** This reduces returned result volume before batch fetch.
4. **Project traversal is sequential.** M6 should introduce bounded concurrency and retry/backoff.
5. **Result URL is included but not opened.** UI actions for opening Azure DevOps web URLs remain deferred.

## Files Added/Modified

- `crates/azdo-client/src/client.rs` - added internal `post_json`.
- `crates/azdo-client/src/work_items.rs` - WIQL and work item batch API models/methods/tests.
- `crates/azdo-client/src/lib.rs` - work item exports.
- `src-tauri/src/work_items.rs` - work item search service, WIQL construction, result mapping, tests.
- `src-tauri/src/lib.rs` - command registration and app state wiring.
- `src/lib/azdoCommands.ts` - typed work item command wrapper.
- `src/App.tsx` - Work Items navigation, search form, and result list.
- `src/App.test.tsx` - work item search UI coverage.
- `docs/codex-handoffs/README.md` and `ROADMAP.md` - milestone status updates.

## Verification Done

- `cargo fmt --all --check`: pass.
- `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `cargo test --workspace`: 18 tests pass.
- `npx tsc --noEmit`: pass.
- `npx vitest --run`: 6 tests pass.
- `pnpm build`: pass.

## Manual Verification

- Real Azure DevOps work item search was not manually verified because it requires a valid organization PAT in the local credential store.
- Visual browser verification was not completed in this session.

## Open Questions

- Should work item type become a predefined dropdown after process templates are discovered?
- Should M5 add open-in-browser actions for PRs, work items, and commits together?
- Should M6 add cancellation for long project traversal?

## Deferred Items

- Work item cache.
- Rich field selection.
- Assigned-to filter.
- Area/iteration filters.
- Opening result URLs.
- Bounded concurrency and retry/backoff.
