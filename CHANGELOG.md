# Changelog

All notable changes to AzDoDeck are documented here.

## [Unreleased]

## [0.1.13] — 2026-06-10

### Fixed
- Mention and assignee pickers no longer come up empty in single-member organizations: the signed-in user is shown at the end of the candidate list again instead of being removed entirely (regression introduced when self was filtered out of both pickers).

### Changed
- The @mention candidate list auto-scrolls to keep the highlighted entry visible while navigating with the arrow keys.

## [0.1.12] — 2026-06-10

### Fixed
- **Mentions are no longer deleted from posted comments.** Azure DevOps only resolves `@<id>` markdown mentions when the id is the identity's storage-key GUID; identity-picker candidates previously carried `aad.…` subject descriptors, so the whole mention was silently dropped from the comment. Candidates now prefer the GUID (`localId`), mention-history entries without a usable GUID are skipped, and as a last resort the comment keeps the plain `@Name` text instead of losing it.
- PR sync now isolates per-project/per-repository errors: one inaccessible project or repository no longer stops the whole organization's PR and review sync, and cached rows of failing repositories are preserved. Skipped items are surfaced as a sync warning.
- Commit links no longer fall back to the REST API endpoint URL when `remoteUrl` is missing; a proper `_git/...` browser URL is constructed instead.
- PR web links now percent-encode project and repository names (spaces, Japanese characters).

## [0.1.11] — 2026-06-10

### Fixed
- Work item sync no longer fails on large projects: WIQL sync queries now cap results with `$top` (most recently changed 2,000 items per project), avoiding Azure DevOps' VS402337 20,000-item limit.
- A failed sync pass no longer erases the "last synced" timestamp.
- Work item sync no longer wipes cached "my work items" for a project whose assigned-items query returns 404.
- Desktop notifications no longer report old work items as newly assigned when they re-enter the 200-item snapshot window.
- Mention and assignee pickers keep namesakes (same display name, different e-mail) as separate candidates, both in ranking and in the self-exclusion filter. The signed-in user's e-mail is now stored per organization (re-add or update the organization to populate it).
- Frequently mentioned people are suggested again: mention history is read when building @mention candidates (it had become write-only).
- Mentions followed by punctuation or Japanese text (e.g. `@田中さん`) are now converted to real Azure DevOps mentions instead of being posted as plain text.
- @mention search accepts one space so "姓 名" style full names can be filtered.
- Work item search falls back to substring matching when full-text search cannot tokenize the query (Japanese substrings now match).
- Azure CLI auth: the access token cache is shared across commands and the `az` call runs off the async runtime, removing a per-command shell-out and UI stalls.

## [0.1.8] — 2026-06-06

### Changed
- Work Item preview panel redesigned: compact layout, cleaner section boundaries with border separators, improved focus ring visibility across all preview panels.

## [0.1.7] — 2026-06-05

### Added
- Work Item mentions now use an identity picker for consistent assignee lookup.

### Changed
- Grid view state (column widths, sort order) is now persisted across sessions.

## [0.1.6] — 2026-06-04

### Fixed
- Work item view restores focus correctly after refresh.
- Azure DevOps assignee candidates lookup broadened to match more user identity fields.
- Organization name matching is now case-insensitive for WIT image URLs.

## [0.1.5] — 2026-06-04

### Added
- Pull Request grids now support per-column filters for review and search
  workflows.

### Fixed
- Bulk Work Item assignment now shows default assignee candidates as soon as
  the picker opens.

## [0.1.4] — 2026-06-02

### Fixed
- Work Item assignee lookup now searches broader identity fields for better
  Azure DevOps user matching.

## [0.1.3] — 2026-06-02

### Added
- Work Item preview fields can be customized and persisted per device.

### Changed
- Work Item grid cells truncate long values to keep dense rows stable.
- README installer output paths now match the root Cargo target directory.

## [0.1.2] — 2026-06-02

### Fixed
- Release workflow artifact archive step now reads installers from the root
  Cargo target directory used by Tauri.

## [0.1.1] — 2026-06-02

### Added
- GitHub Release workflow publishes Windows x64 NSIS and MSI installers.
- Demo harness scenarios for rich text, large data, empty data, slow network, and API errors.

### Changed
- Work Item preview and PR list rendering hardened for large datasets and Azure DevOps rich text.
- Windows installer WebView2 bootstrapper handling is explicit in Tauri configuration and documentation.

### Added
- Help menu with embedded HTML user guide (sidebar button)
- Work Item preview panel shows posted comments

### Changed
- Compact Work Item filter bar with denser grid columns
- Work Item preview panel collapsed to single compact header: badges and title shown immediately on row selection; iframe drops duplicate h1, tighter CSS spacing, comment count in section heading

## [0.1.0] — 2026-05-28

### Added
- My Reviews view: grid with vote status, stale highlighting (>3 days), column resize, keyboard navigation (`↑↓ Home End PageUp/Down Enter C`), vote filter tabs (`1–4`), text filter (`/`), draft toggle (`D`), refresh (`R`)
- Pull Request Search: filter by project, repository, and status; resizable grid; keyboard navigation; `C` to copy URL
- My Work Items view: items assigned to you with text filter and refresh
- Work Item Search: filter by project, state, and type; resizable sortable grid; `C` to copy URL
- Commit Search: filter by project, repository, author, branch, and date range; resizable sortable grid; preset date range buttons (7d/30d/90d)
- Review Preview panel: local HTML file matched by PR number, configurable folder in Settings
- Organization management: add via PAT or Azure CLI; credentials stored in Windows Credential Manager; multiple organizations supported
- Context-aware error messages: distinct UI for auth failures, rate limiting, and network errors with recovery hints
- Global keyboard shortcuts: `Alt+1–6` for navigation, `?` for shortcut help, `Esc` to close dialogs
- Resizable sidebar
- Column widths persisted in `localStorage` per-grid

### Changed
- Commit results displayed in resizable sortable grid (was card list)
