# AzDoDeck Roadmap

This roadmap is intentionally milestone-sized so Codex can resume work without re-planning the product from scratch.

## Product Goal

AzDoDeck helps a developer search and monitor Azure DevOps pull requests, work items, and commits across one or more Azure DevOps Services organizations from a desktop app.

## Non-Goals For Early Milestones

- Azure DevOps Server / on-prem support.
- Full offline mode.
- Organization-wide analytics.
- Team administration.
- OAuth app registration.
- Non-Windows packaging.

## Milestones

### M0 - Repository Foundation

Status: Done.

Tauri 2 + React + TypeScript scaffold, Rust workspace, CI, license, README, and placeholder tests.

### M1 - Azure DevOps Client Core

Status: Done.

`azdo-client` crate with PAT auth, typed `connectionData`, HTTP error handling, and wiremock tests.

### M2 - Local App State And Organization Setup

Status: Done.

Add persistent local configuration, SQLite migrations, secure PAT storage, Tauri commands, and a settings/onboarding UI for adding an Azure DevOps organization.

Key outcome: the app can save an organization, validate credentials with `connectionData`, and show the configured account in the UI.

### M3 - Pull Request Search

Status: Done.

Add Azure DevOps Git pull request search across configured projects and repositories.

Expected scope:

- API models and client methods in `azdo-client`.
- Local cache schema for repositories and pull requests.
- Dashboard tab for PR search and filters.
- Tests for API parsing, command validation, and frontend state.

### M4 - Work Item Search

Status: Done.

Add WIQL-backed work item search and a work item result view.

Expected scope:

- WIQL query command with safe user input handling.
- Work item fields mapping for title, state, type, assigned user, changed date, and URL.
- Cache schema for recent search results.
- Frontend filters for state, type, assigned user, and text query.

### M5 - Commit Search

Status: Done.

Add commit search across repositories with author, date range, branch, and message filters.

Expected scope:

- Azure DevOps Git commits endpoint integration.
- Repository discovery or explicit repository selection.
- Cache schema for commit metadata.
- Frontend result list with open actions.

### M6 - Auth And Reliability Hardening

Status: Next.

Add Azure CLI authentication provider, retry/backoff, throttling behavior, logging, and better diagnostics.

Expected scope:

- `az account get-access-token` integration for Azure DevOps scope.
- Configurable auth provider per organization.
- Retry strategy for 429 and transient 5xx.
- Structured tracing from Tauri commands and client calls.

### M7 - Background Sync

Status: Planned.

Add scheduled refresh, cache freshness indicators, and cancellation.

Expected scope:

- Tauri background task orchestration.
- Sync status model.
- Manual refresh controls.
- Avoid duplicate concurrent syncs.

### M8 - OSS Readiness

Status: Planned.

Prepare the repository for public collaboration.

Expected scope:

- CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue templates.
- Release and packaging workflow.
- User-facing docs and screenshots.
- License review for dependencies and assets.

## Cross-Cutting Standards

- Keep Azure DevOps API logic in `crates/azdo-client`.
- Keep OS integration and persistence commands in `src-tauri`.
- Keep frontend data contracts explicit with TypeScript types and `zod` where external input crosses the boundary.
- Prefer small typed modules over broad utility bags.
- Add tests at the layer where behavior is owned.
