# M5 - Commit Search

## Goal

Add Azure DevOps commit search across configured projects and repositories.

## What Shipped

- `azdo-client` now supports Git commits API:
  - repository-scoped commit listing.
  - author, branch, from date, to date, and top query criteria.
- Tauri backend now has `search_commits`.
- The command:
  - resolves the selected organization.
  - loads its PAT from the OS credential store.
  - traverses projects and repositories.
  - queries commits with Azure DevOps search criteria.
  - filters locally by message, author, repository, project, and SHA.
  - returns up to 100 newest results.
- React UI now has a Commits dashboard with:
  - organization selector.
  - message/repository/SHA search.
  - author filter.
  - branch filter.
  - result list with short SHA, message, repo, author, and date.
- Browser preview mode includes commit demo data.

## Key Decisions

1. **M5 uses live repository traversal.** This matches M3 and M4; cache/background sync remain later milestones.
2. **Author and branch are sent to Azure DevOps criteria.** General text query is applied locally to returned commit metadata.
3. **Date fields are supported in backend input but not exposed in UI yet.** This leaves room for a compact date-range control without blocking M5.
4. **Result open actions are still deferred.** PR, work item, and commit rows all carry URLs now, but opening can be implemented consistently later.

## Files Added/Modified

- `crates/azdo-client/src/git.rs` - commit models and `list_commits`.
- `crates/azdo-client/src/lib.rs` - commit exports.
- `src-tauri/src/commits.rs` - commit search service, mapping, filtering, tests.
- `src-tauri/src/lib.rs` - command registration and app state wiring.
- `src/lib/azdoCommands.ts` - typed commit command wrapper and browser preview demo data.
- `src/App.tsx` - Commits navigation, search form, and result list.
- `src/App.test.tsx` - commit search UI coverage.
- `docs/codex-handoffs/README.md` and `ROADMAP.md` - milestone status updates.

## Verification Done

- `cargo fmt --all --check`: pass.
- `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `cargo test --workspace`: 21 tests pass.
- `npx tsc --noEmit`: pass.
- `npx vitest --run`: 8 tests pass.
- `pnpm build`: pass.
- `pnpm tauri build --debug`: pass, produced debug exe and Windows bundles.
- `target/debug/azdo-dashboard.exe`: starts and remains alive for 5 seconds.

## Manual Verification

- Real Azure DevOps commit search was not manually verified because it requires a valid organization PAT in the local credential store.
- UI visual verification was covered by browser-preview test and production build, not by an interactive browser screenshot.

## Open Questions

- Should M6 prioritize open-in-browser row actions before auth/retry hardening?
- Should commit search expose date range controls immediately?
- Should repository/project traversal become cached before organizations with many repositories are tested?

## Deferred Items

- Commit cache.
- Date range UI.
- Repository/project filters.
- Opening result URLs.
- Bounded concurrency and retry/backoff.
