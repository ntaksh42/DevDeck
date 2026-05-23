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
- Next milestone:
  - M4: work item search.

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
