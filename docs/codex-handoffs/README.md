# Codex Handoffs

This folder is the working handoff area for future Codex sessions.

## Current State

- Product: AzDoDeck, a Windows-first Tauri desktop dashboard for Azure DevOps Services.
- Frontend: React 19, TypeScript, Vite, Tailwind CSS.
- Backend: Rust workspace with Tauri app plus `azdo-client` crate.
- Completed milestones:
  - [M0](M0_codex-handoff.md): repository scaffold, Tauri app, CI, minimal README.
  - [M1](M1_codex-handoff.md): Azure DevOps REST client core, PAT auth, `connectionData`, wiremock tests.
  - [M2](M2_codex-handoff.md): local configuration, SQLite migrations, secure PAT storage, organization setup UI.
  - [M3](M3_codex-handoff.md): pull request search across projects and repositories.
  - [M4](M4_codex-handoff.md): work item search with WIQL and batch field loading.
  - [M5](M5_codex-handoff.md): commit search across projects and repositories.
  - [M5 Result Actions](M5_result-actions_codex-handoff.md): open Azure DevOps web URLs from result rows.
- Next milestone:
  - M6: auth and reliability hardening. Retry/backoff is implemented in [M6 Retry](M6_retry-handoff.md), Azure CLI auth is implemented in [M6 Azure CLI Auth](M6_azure-cli-auth-handoff.md), and backend tracing is implemented in [M6 Tracing](M6_tracing-handoff.md). Traversal scaling remains next.

## How To Resume

1. Read `AGENTS.md` at the repository root for project conventions.
2. Read the latest completed milestone handoff.
3. Read [ROADMAP.md](ROADMAP.md) for milestone ordering.
4. Start from [ROADMAP.md](ROADMAP.md) and the latest milestone handoff unless a newer milestone plan exists.
5. Before editing, run:

```sh
git status --short --branch
cargo test --workspace
pnpm test -- --run
```

If the test commands cannot run in the current environment, record the reason in the next handoff.

## Handoff Rule

At the end of each milestone:

- Add or update a milestone handoff file in this folder.
- Include goal, key decisions, files changed, verification done, and deferred items.
- Keep user-owned unrelated changes intact.
- Commit only when the user asks or the milestone flow explicitly includes committing.
