# Changelog

All notable changes to AzDoDeck are documented here.

## [Unreleased]

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
