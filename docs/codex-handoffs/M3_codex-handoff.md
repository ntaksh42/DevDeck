# M3 - Pull Request Search

## Goal

Add pull request search across configured Azure DevOps Services organizations.

## What Shipped

- `azdo-client` now has typed APIs for:
  - listing team projects.
  - listing Git repositories per project.
  - listing pull requests per repository with status filters.
- Tauri backend now has `search_pull_requests`.
- The command:
  - resolves a configured organization.
  - loads its PAT from the OS credential store.
  - queries projects, repositories, and pull requests.
  - filters results locally by title, project, repository, author, source branch, and target branch.
  - returns up to 100 newest results.
- React UI now has:
  - Dashboard / Settings navigation.
  - Pull Requests dashboard.
  - organization selector.
  - status selector for active/completed/abandoned/all.
  - search box and result list.

## Key Decisions

1. **M3 uses live Azure DevOps queries, not cache.** The roadmap originally mentioned cache, but a live end-to-end PR search is a better first vertical slice. Cache can be added with background sync in M7.
2. **Search is broad and local after fetch.** Azure DevOps PR list APIs are repository-scoped and not full-text search APIs, so M3 fetches PRs by status and filters result metadata locally.
3. **Project and repository traversal is sequential.** This keeps rate-limit behavior predictable for the first version. M6 should add concurrency limits, retries, and diagnostics.
4. **The first configured organization is the default.** Active organization selection remains a future settings feature.
5. **No web-open action yet.** Result rows include `webUrl` in the command response, but the UI does not open it yet.

## Files Added/Modified

- `crates/azdo-client/src/git.rs` - project, repository, and pull request API models and methods.
- `crates/azdo-client/src/lib.rs` - Git API exports.
- `src-tauri/src/prs.rs` - PR search service and command response model.
- `src-tauri/src/lib.rs` - command registration and app state wiring.
- `src-tauri/src/db.rs` - organization lookup helper.
- `src-tauri/src/secrets.rs` - PAT read helper.
- `src/lib/azdoCommands.ts` - typed PR search command wrapper.
- `src/App.tsx` - dashboard navigation and PR search UI.
- `src/App.test.tsx` - PR search UI test coverage.

## Verification Done

- `cargo fmt --all --check`: pass.
- `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `cargo test --workspace`: 14 tests pass.
- `npx tsc --noEmit`: pass.
- `npx vitest --run`: 5 tests pass.
- `pnpm build`: pass.

## Manual Verification

- Real Azure DevOps PR search was not manually verified because it requires a valid organization PAT in the local credential store.
- Codex in-app browser was unavailable earlier in this session, so visual browser verification was not completed.

## Open Questions

- Should M4 add a result row action to open PRs using the Tauri opener plugin?
- Should M6 introduce bounded concurrency for project/repository traversal before larger organizations become slow?
- Should M7 persist repository/project discovery results to avoid repeated full traversal?

## Deferred Items

- SQLite cache for projects, repositories, and pull requests.
- Repository/project filters.
- Opening result web URLs.
- Pagination beyond the first 100 returned summaries.
- Parallel traversal with throttling.
- Retry/backoff for 429 and transient 5xx.
