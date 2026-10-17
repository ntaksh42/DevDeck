# Changelog

All notable changes to DevDeck (formerly AzDoDeck) are documented here.

## [Unreleased]

### Added
- **UI scale.** The whole app can be zoomed from Settings and with keyboard shortcuts (#724).
- Inbox items can be marked and moved to Done or snoozed in bulk (#726).

## [0.2.30] — 2026-10-17

### Added
- Pasting an Azure DevOps PR or work item URL into the command palette opens it inside the app (#718).
- My Pull Requests renders from the synchronized cache; the Inbox can regenerate decision notes, and the palette gains an `inbox:` prefix (#716).
- Inbox items are grouped per conversation, and items for completed PRs / closed work items move to Done automatically (#714).

### Fixed
- The app no longer fails to start when the global hotkey cannot be registered (#717).
- Filled remaining gaps in the IME composition guard (#715).
- Compact work item views are left-aligned to their content width, and `↑` / `↓` move to the nearest card in the adjacent row.
- The column picker now includes organization fields.

## [0.2.29] — 2026-10-16

### Fixed
- Work item queries have a bounded wait and can be retried after a stall.

## [0.2.28] — 2026-10-14

### Added
- Inbox preview starts with the comments, adds a Claude-written decision note, and supports reply + Resolve in one step.

### Fixed
- Decision notes are limited to items from synchronized organizations and use the full thread for PR items (#712).
- Agent requests run in the background without opening a console window.
- The work item preview focus ring stays at the pane edge while scrolling.

## [0.2.27] — 2026-10-13

### Added
- Actionable Inbox: context display, auto-advance after handling an item, and undo (#709).

### Changed
- The Agent panel is closed by default and the list/preview split defaults to 50/50.

### Fixed
- Panes containing a grid no longer draw an outer focus ring (#711).

## [0.2.26] — 2026-10-12

### Added
- Per-request choice of agent (Claude / Codex) and model in the Agent panel, with defaults configurable in Settings (#707).
- Per-thread reply boxes in the Agent panel and item-type labels in the Inbox (#706).
- Note instructions are also installed as Claude Code / Codex skills.

### Changed
- Unified look and keyboard behavior across all views: consistent toolbar heights, focus trapping in dialogs, `Esc` handling, single Tab stop for grids, and pane navigation from the keyboard (#707).
- Simplified Agent panel conversations and request controls (#705).

### Fixed
- Dock resize handles follow pane borders after panes are rearranged.
- Removed excess space below Agent conversations.

## [0.2.25] — 2026-10-12

### Added
- **Agent panel.** Ask an agent for help from any view.

## [0.2.24] — 2026-10-11

### Added
- **Inbox view** listing the things that need your action.
- The Agent can be docked, and work item comments can be replied to in place from the Inbox.

### Fixed
- Column auto-fit no longer over-expands, and dark mode, Help, and Tags rendering glitches are fixed.

## [0.2.23] — 2026-10-10

### Added
- The "show drafts" checkbox is always visible next to the PR search/filter box.

### Removed
- **Breaking:** the Commits / Files changed tabs in the PR preview.

## [0.2.22] — 2026-10-09

### Removed
- **Breaking:** the Code and Commits views, to reduce load on the Azure DevOps API.

### Fixed
- My Work Items sync no longer fails because of a `StateCategory` reference in its WIQL (#704).

## [0.2.21] — 2026-10-08

### Changed
- Fewer steady-state requests: repository lists are cached and comment fetch limits are unified (#701).

### Fixed
- Several causes of PRs missing from My Reviews (#702).
- Requests are throttled after the cache is cleared to avoid bursts against Azure DevOps (#700).

## [0.2.20] — 2026-10-04

### Added
- Read-only views of project teams, service connections, and service hooks in Settings.
- Branches tab: branch list with last update, ahead/behind and related PRs; branch create/delete; tag create/list/delete; branch policies; create a pull request from a branch.
- PR labels (view, add, remove) and adding reviewers (Add / Add me) from the review panel.
- Pipelines: rerun only failed stages, and a test result summary with the list of failed tests.
- Wiki page search in the palette (`wiki:`) with in-app preview.
- Commits: related work items, branches/tags containing a commit, author vs. committer, relative dates, side-by-side diffs with syntax highlighting, and an Unlinked filter/badge for commits without a work item or PR.
- Code: compare any two revisions, side-by-side compare with whitespace-ignore and wrap options, Markdown rendering, fuzzy file name filter (`T`), line range selection / permalinks / line copy, file history to commit diff, Raw/Download toggle.
- Follow/Unfollow a work item from the preview.
- Quiet hours for desktop notifications.
- Line-ending-only changes are flagged, with an EOL badge on PR file headers.
- Adding an organization accepts a pasted Azure DevOps URL.
- Keyboard navigation for code search results and pipeline timelines.

### Fixed
- Clicking a summary notification brings the app to the front and opens the list; the summary shows the untruncated count.
- First review request / assignment after zero pending items is notified.
- IME composition `Enter` / `Escape` is ignored in search, filter, mention inputs and the command palette.
- Project and branch lists are fully paged.
- Sync no longer deletes cached rows when a snapshot was truncated at its limit, and only warns when the 2,000-item cap is actually hit.
- Manual refresh skips the shared-cache freshness check and always calls the API.
- Per-repository commit fetch failures are reported as warnings without advancing the delta cursor.
- Heatmap and date filters use local calendar days; date range searches no longer miss items created in the last second of the day.
- Table copy guards against spreadsheet formula injection and falls back to TSV.
- Link ID input is validated strictly and self-links are rejected.
- Cancelled code queries also cancel backend work; large files skip syntax highlighting.
- Notification rule inputs accept names with spaces; result-folder HTML matching is stricter.
- Past custom snooze times are rejected; remaining `window.confirm` calls use the in-app dialog.
- Removing an organization also clears its rows in the shared cache.
- Failure toasts are shown even when retry toasts are disabled.

## [0.2.19] — 2026-10-04

### Added
- Pipelines list and run detail redesign.
- `Ctrl+C` copies selected grid rows as a table suitable for pasting into e-mail.
- Section bands in commit/pipeline previews and colored priority dots for work items.
- PR "Email a link", "Convert to draft", and Markdown link copy from My PRs (#542).

### Changed
- View controls moved to the preview tab strip and comments are visually lighter (#673).
- Scheduled releases run twice a day, at 0:00 and 6:30 JST (#690).

### Fixed
- Selection no longer jumps to a different item after sync or sort (#665).
- Focus is no longer lost when `Ctrl+K` / `F1` are pressed repeatedly (#676).
- Result HTML is decoded with charset detection (Shift_JIS etc.) and files over 5 MiB are not displayed (#672).
- The PR toolbar folds into a menu when the tab strip is narrow (#675).
- My Work Items sync excludes completed items (#674).
- Live PR fetch tolerates per-project failures (#671).
- Notification rule project/repository matching is case-insensitive (#618).
- The right pane of the dock is no longer clipped in narrow windows (#638).

## [0.2.18] — 2026-10-02

### Fixed
- A stale undo completion is ignored after the selection changes.
- The range selection anchor resets when its row disappears.

## [0.2.17] — 2026-10-01

### Changed
- Light-blue section bands in previews and a full-width PR title with a branch line.

### Fixed
- Azure CLI token fetch has a timeout, and credentials are refreshed on 401.
- Markdown images load even when the effect re-runs during fetch.

## [0.2.16] — 2026-09-30

### Fixed
- Linked PRs open from the Work Item Views preview (#636).
- `az` invocation on Windows, agent command quoting, retries, and an undo race.
- Inline Markdown ordering, stale-apply guard, and the "az missing" message.

## [0.2.15] — 2026-09-29

### Fixed
- Agent note anchors survive the result document being swapped or reloaded (#635).

## [0.2.14] — 2026-09-27

### Added
- Agent notes: "needs you" state, drafts, undo, grid badges, and a card UI (#633).

### Changed
- Visual audit fixes: dark mode, column auto-fit, and a unified search bar (#634).

## [0.2.13] — 2026-09-27

### Added
- Work item preview sections can be rearranged like VS Code views (#632).

### Changed
- Compact PR header with status badges on the meta line (#631).

### Fixed
- Reopened agent notes keep focus and note parsing is hardened (#630).
- The collapsed Work Items dock opens to half its column; the preview focus ring draws above the comments column.

## [0.2.12] — 2026-09-27

### Added
- **Agent notes.** Leave inline notes for the investigating agent on work items (#623) and PR review results (#624), with reply threads, an auto-placed `AGENTS.md` (#627), and You / @AgentName labels (#629).
- Settings screen sections and a filter (#626).

### Changed
- Unified comment input UI across PRs, work items, and agent notes (#628).
- Rarely used controls are folded away and screen density is tightened (#625).

## [0.2.11] — 2026-09-24

### Added
- Snooze in Work Item Views and Work Item Search.

## [0.2.10] — 2026-09-23

### Added
- Add field columns from the work item grid Columns menu.
- Resizable file list in the PR Files tab.

### Changed
- Improved visibility across grids and previews (#622).

### Fixed
- Removed the result cap on My Work Items.

## [0.2.9] — 2026-09-22

### Changed
- Polished dock resize affordances.

## [0.2.8] — 2026-09-21

### Added
- Import Azure DevOps project queries into a View, with a filterable query picker (#621).

## [0.2.7] — 2026-09-20

### Changed
- Removed wasted whitespace.

## [0.2.6] — 2026-09-19

### Added
- Draft pull requests are distinguished in work item views.

## [0.2.5] — 2026-09-17

Maintenance release (test fixture fix only).

## [0.2.4] — 2026-09-17

### Fixed
- Docks can be resized vertically.

## [0.2.3] — 2026-09-13

### Changed
- Improved preview panel readability, consistent PR link behavior, and the zoom control moved into the preview header.

### Fixed
- Dock drag and drop works in the WebView2 desktop runtime.
- Panel border dragging is unified on a single resize handle, and empty space below the preview is removed.

## [0.2.2] — 2026-09-10

### Fixed
- Unstable preview/grid width adjustment (#619).

## [0.2.1] — 2026-09-08

### Fixed
- Views with large data sets render all grid rows (#614).

## [0.2.0] — 2026-09-07

### Changed
- **Docking layout.** The grid/preview split and existing tabs moved to dockview-based dockable panes (#613).

## [0.1.53] — 2026-09-05

### Added
- Investigation result HTML associated with a work item ID is shown in the preview.
- Zoom controls and keyboard shortcuts for the preview panel.

### Fixed
- The Project column in work item views shows the item's actual project.

## [0.1.52] — 2026-09-03

### Changed
- Grid rows and PR file diff sections are memoized to cut unnecessary re-renders (#612).

## [0.1.51] — 2026-08-30

### Added
- A neutral shared Azure DevOps cache (`%APPDATA%\AzDoSharedCache\cache.db`) synchronized with waypoint so both apps avoid duplicate API calls.
- Active related-PR badge in View grids.

### Fixed
- 400 error caused by sending `fields` together with `$expand=Relations`.

## [0.1.50] — 2026-08-06

### Added
- **Analyze view** combining query trends and branch commits (#608).
- Choose the export destination for work item views (#607).
- Experimental features section with a master switch: cross-organization summary view, diagnostics export, retry toasts, and local usage statistics.

### Changed
- Grid/preview ratios adapt to the available width (#609).

## [0.1.49] — 2026-08-04

### Added
- Multi-row selection with Shift/Ctrl and bulk URL copy with `Ctrl+C` (#606).

## [0.1.48] — 2026-07-30

### Changed
- Denser View screens and a better WIQL editing experience (#604).

### Fixed
- Batch of bugs found in an app-wide review, including snooze not reviving at the deadline and GitHub PR search filters being ignored (#603).

## [0.1.47] — 2026-07-29

### Changed
- Removed the WIQL query result cap (#601).

### Fixed
- Hydrated attachment images no longer fall back to alt text (#602).

## [0.1.46] — 2026-07-26

### Fixed
- Batch of bugs found in an app-wide review, including shortcuts acting on hidden snoozed PRs and URLs breaking on `#` / `?` in project or repository names (#599).

## [0.1.45] — 2026-07-25

### Fixed
- Authenticated attachment images render instead of alt text (#598).

## [0.1.44] — 2026-07-18

### Added
- Bulk snooze and a one-month preset (#596).

### Fixed
- Comment input heights are persisted (#597).

## [0.1.43] — 2026-07-16

### Fixed
- Work item comment attachment images render (#594).

## [0.1.42] — 2026-07-15

### Added
- @mention suggestions when editing a posted work item comment (#593).

### Changed
- Better font scaling on wide screens (#590).

### Fixed
- Voting preserves the required reviewer flag (#592).
- Preview attachment image rendering (#591).

## [0.1.41] — 2026-07-12

### Changed
- Comment inputs are resizable (#589).

## [0.1.40] — 2026-07-11

### Changed
- Notifications moved to the bottom sidebar group with Help/Settings (#587).

## [0.1.39] — 2026-07-10

### Added
- **Notifications inbox** view with notification history (#586).
- Multi-select target branch filter (#582) and a text filter in Work Item Views (#581).

### Changed
- Default Go-to-view keys: Pipelines → `P`, PR Search → `Q` (#585).

### Fixed
- `Escape` leaves search/filter inputs on every screen (#583).

## [0.1.38] — 2026-07-09

### Fixed
- PR comment @mention candidates and in-comment images (#579).
- Overlapping filter controls (#580).

## [0.1.37] — 2026-07-05

### Fixed
- Image Markdown for attachment URLs containing spaces renders instead of raw text (#578).

## [0.1.36] — 2026-07-04

### Fixed
- Sidebar badges follow the active connection, and connection switches reset scoped state and saved filters (#577).

## [0.1.35] — 2026-07-03

### Added
- Create and duplicate work item dialogs (#574).
- Pipelines: running-state visualization, branch picker, and definition editing (#576).

### Fixed
- Screen-reader-only labels no longer stretch the window scroll area (#575).

## [0.1.34] — 2026-07-02

### Added
- Files view: keyboard navigation, image preview, recursive filter, browsing at a commit, and more (#566).
- Tags column in the work item grid (#569); running pipelines highlighted on the watched board (#567).

### Changed
- PR Files tab shows a continuous diff like Azure DevOps (#573).
- Search text is cleared when switching views (#572).

### Fixed
- Focus returns to the preview after posting a comment with `Ctrl+Enter` (#570).
- PR attachment images in the PR preview (#571).

## [0.1.33] — 2026-07-01

### Added
- Branch name suggestions in the PR search target-branch filter (#563).
- Copy as Markdown link, share a work item by e-mail, reactivate a PR (#565).
- Commit diff line-count stats, multi-parent selection, and keyboard navigation (#559).

## [0.1.32] — 2026-06-30

### Added
- Commit/Files search, paging, and richer previews (#509); streamlined commit search form that remembers its scope (#504).
- Keyboard-operable reaction picker with clear applied state (#507).

### Fixed
- GitHub: no 422 on review votes and PR descriptions are no longer wiped (#503).
- Authenticated attachment images in the PR preview (#505).

## [0.1.31] — 2026-06-28

### Added
- **Renamed to DevDeck**, with GitHub support through a provider abstraction (#500).
- Files view modeled on Azure DevOps Repos (#496).
- The left sidebar can be collapsed entirely (#497).

## [0.1.30] — 2026-06-27

### Added
- **My Pull Requests** view for PRs you authored (#495).
- PR management: edit title/description (#407), reviewers with required toggle and removal (#408), auto-complete enable/cancel (#414), and transitioning linked work items on completion (#415).
- Work items: add/remove links from the preview (#411), inline title editing, section order changes and full classification paths (#489, #490), conditional row colors (#405), smart-search filter for search results (#466).
- Pipelines: queue a run with branch and parameters (#412), approve/reject pending approvals (#419), list and download build artifacts (#409).
- Commit search `path:` filter (#404), My Reviews filter value autocomplete (#406), per-project/repository notification mute (#381).
- Sidebar entries can be reordered by drag or keyboard (#492); comment thread counts in the PR preview header (#494).
- Multi-select filters and a blue accent theme (#487).

### Changed
- Focus/sync/settings shortcut defaults switched to `Ctrl` (#401).
- Removed the redundant sidebar header (#486).

### Fixed
- Bulk optimistic updates match fully-qualified keys (#362); focus restores after closing the PR comment editor (#364) and column filter dropdown (#365).
- Failed vs. empty pipeline timelines are distinguished (#461).

## [0.1.29] — 2026-06-26

### Added
- List and download work item attachments (#413); bulk add/remove tags (#471).
- Non-active statuses in PR search (#483).
- Pipeline definition panel with triggers and variables (#484).
- In-app confirm dialog for removing an organization (#467).

### Fixed
- Shortcut capture is armed on click/Enter instead of focus (#468); focus is restored when the palette/help closes (#469).
- Column resizing across grids (#485).

## [0.1.28] — 2026-06-25

### Added
- Preview panel for the work item board view (#470).
- Notifications when watched pipelines start or finish (#482).

### Changed
- Banded PR review section headers (#478) and a more readable work item preview (#477).

## [0.1.27] — 2026-06-25

Maintenance release (test fix only).

## [0.1.26] — 2026-06-24

### Added
- Code search inline preview of matching lines (#424) and code search in the palette (#426).
- Approve/reject a PR from the palette (#427); bulk and keyboard toggle for viewed files (#428); open a PR file diff in Azure DevOps (#455).
- Pipelines: highlight and filter error/warning log lines (#462); branch/result/my-runs filters for run history (#463).
- Area/iteration path tree picker (#418); emoji reactions on work item comments (#422).
- Retry / open-settings actions on error states (#456); keyboard support for the Columns menu (#465).

### Changed
- Azure CLI tokens are cached until their reported expiry instead of a fixed 5 minutes (#458).
- Reviewer vote label shortened to "Waiting" (#429).

### Fixed
- Dropped or raw-id @mentions in comment previews (#459).
- The selected pipeline log tail refreshes live while a run is in progress (#460).
- Commit search truncation is surfaced (#453); a toast appears when a quick vote fails (#452).
- The Resolve toggle is kept for status-less PR threads (#454); preview focus is kept during background sync (#430).

## [0.1.25] — 2026-06-23

Maintenance release (CI fix only).

## [0.1.24] — 2026-06-22

### Added
- `Ctrl+Enter` on a watched pipeline run opens it in the browser (#380).
- "Uncheck all" in PR Search and My Reviews column filters (#377).

### Removed
- The Release Notes feature (#379).

### Fixed
- Keyboard focus stays on the selected row across data updates (#378).
- Commit-to-PR lookup uses the Pull Request Query API (#376).
- Votes and required flags resolve for reviewers added through a group/team (#371).
- Comment edit/delete optimistic updates, undo of assignment changes, and snooze deadline checks (#361, #366, #367).
- Sidebar count badges are announced to screen readers (#363).

## [0.1.23] — 2026-06-21

### Changed
- Background sync runs in parallel and commits sync incrementally (#375); PR comment threads are fetched concurrently (#370).
- Unified header sync control, improved command palette focus state, and a refreshed logo (#372, #373).

### Removed
- PR saved views and the comment preview tab.

### Fixed
- PR review notifications and snooze are keyed by (repository, id) (#374).

## [0.1.22] — 2026-06-20

### Added
- **Kanban board** display for Work Item Views (#268) and work item templates (#256).
- Command palette: recently opened items (#246) and running registered pipelines (#264).
- Saved views for My Reviews (#269), a sortable Review age column (#340), and highlighting PRs returned to you after an author push (#331).
- Work items: duplicate as new (#260), edit posted comments (#328), unread markers (#335), stale Active highlighting (#275), smart search prefixes (#244), bulk selection summary (#242).
- Commits: activity heatmap (#265), column visibility (#274), open changed files in Azure DevOps diff (#261).
- PR ↔ work item jump links (#250) and changed-file overlap detection across selected PRs (#258).
- Notification rules (#276), sync status in the header (#280), back/forward view history (#281), sidebar count badges (#343), a row-shortcut legend (#344), last-updated time in grid status bars (#239), and unified filter count / Clear filters (#240).
- Cancellable code search (#341) and opt-in auto-update (#342).

### Changed
- Smaller binary and deferred non-critical startup JS (#290).
- Sync backs off and notifies after consecutive failures (#259).

### Removed
- The My Commits view (#347).

### Fixed
- PAT and bearer tokens are zeroized on drop (#216); Azure CLI token acquisition is single-flight (#243).
- Markdown links and images are hardened against tabnabbing and tracking (#186).
- CRLF is normalized before diffing (#220) and word-level highlights apply to commit diffs (#213).
- Many smaller fixes to notifications, shortcuts, storage quota handling, FTS search, palette grouping, and pipeline polling.

## [0.1.21] — 2026-06-19

### Added
- User-configurable keyboard shortcuts (#266).
- Related PRs for a commit with two-way jumps (#267).
- Configurable stale review threshold (#263) and a CI status column in My Reviews (#270).

## [0.1.20] — 2026-06-19

### Added
- **Snooze** for pull requests and work items.
- "Uncheck all" in work item grid column filters (#230).
- AzDoDeck branding across the app shell (#172).

### Fixed
- POST requests are not retried on 5xx (#196); `Retry-After` HTTP-date form is parsed (#179); structured API error bodies are parsed (#189).
- Reviewer PR query and commit sync are paginated (#205, #208).
- Rich work item HTML is sanitized before iframe rendering (#188).
- Azure CLI token resource is configurable for national clouds (#187).
- Organization delete and auth-provider switch no longer leave stale credentials (#201, #210).
- Toast clicks open the notification target (#198); WAL journal mode is re-applied on every open (#199).
- Bulk work item changes are reflected optimistically (#206) and the candidate cache lock is released during HTTP fetches (#202).

## [0.1.19] — 2026-06-17

### Changed
- Redesigned app icon (#169).

## [0.1.18] — 2026-06-16

### Added
- Watched pipelines board with filterable pickers (#104) and a resizable run preview panel (#105).
- Commit search on a specific branch runs live (#161).

### Fixed
- `list_pull_requests` uses `$top` to avoid silent truncation (#156); JSON decode failures are classified as parse errors (#155).
- Notification send results are aggregated and early events are replayed (#157, #158).
- Work item comment-load failures, reassignment, and read-only mode during bulk operations (#162).
- Review result files open again with inline preview (#103).

## [0.1.17] — 2026-06-15

### Added
- Review result HTML opens in the browser (#102).

### Fixed
- Bugs found by the review loop across pipelines, code search, and work items (#101).

## [0.1.16] — 2026-06-15

### Added
- **In-app PR review**: tabbed review panel with vote dropdown, comments (Markdown preview, @mention autocomplete, edit/delete your own), inline diff comments, split/unified/whole-file diffs with chunk expanders, a folder tree of changed files, per-file Viewed tracking, and a commits tab.
- **Pipelines view**, commit diffs, PR actions, and code search with repository/branch/path filters.
- Dark mode with a Light / Dark / System selector (#96).
- Desktop notifications for pull requests (#94).
- Quick-vote shortcuts and column show/hide in My Reviews; PR and commit previews in the search views; column show/hide in PR Search.
- Unified grid ↔ preview keyboard navigation across search views.
- Custom fields shown in the work item preview can now be edited from the keyboard: `F` opens the first custom field's value picker and pressing it again moves to the next one. Also available as "Change selected work item custom field" in the command palette.
- Field presets: save pending work item changes under a name and re-stage them later with the digit shortcuts shown in the preview panel.
- Pinned work item views are nested under the Views nav item (#95).

### Changed
- **Startup and rendering performance.** Views other than the default My Reviews grid are code-split and lazy-loaded; the comment composer no longer re-renders with the preview panel; only the newest work item comments mount by default; neighbor preview prefetch waits until the selection settles; and the post-apply preview is served straight from the mutation response instead of a refetch.
- **Less backend traffic.** Active pull requests sync per project instead of per repository, the organization project directory is cached with a short TTL, work item attachment images are cached in the frontend, and mention/assignee candidates derived from work item updates are cached.
- Decluttered chrome: the header Sync button and the comment Post button are icon-only (hover for the tooltip), and the inline `F1` / `Alt+,` / `Alt+G` / `Alt+P` shortcut chips are gone — `?` still opens the full shortcut reference.

### Removed
- Saved replies for work item comments (the "Save reply" button and the saved-replies dropdown).
- The unreachable embedded HTML user guide dialog (the sidebar Help button has opened the keyboard shortcut reference for a while) and the unused per-field work item update commands that were superseded by the single JSON Patch apply in 0.1.15.

### Fixed
- The keyboard shortcut help now lists the actual My Reviews vote filter tabs (No Vote / Waiting Author / Approved / All).

## [0.1.15] — 2026-06-12

### Added
- **Staged work item editing.** Property changes (state, assignee, priority, custom fields) are staged locally and applied together with `Ctrl+S` as a single JSON Patch request, so transition rules see the whole change set at once. `Ctrl+Enter` posts a comment and applies pending changes in one step, and an apply can be undone for 10 seconds with `U`.
- Linear-style `G` key chains for view navigation (`G` then `R/P/W/I/V/C/S`).
- Local done/archive triage (`E`) for My Reviews and My Work Items rows.
- Command palette search covers every configured organization, and an empty query lists recently opened items.
- My Reviews rows are grouped into reviewer-action sections and show merge-conflict badges.

### Changed
- The pending/applied banners became a compact chip inline in the preview header row.
- Preview panes can be resized without the previous practical width cap.
- Mention and assignee candidate search is scoped to the organization, with usability improvements for both pickers.
- Horizontal grid scrollbars are hidden.

## [0.1.14] — 2026-06-11

### Added
- **Cross-entity search in the command palette (Ctrl+K).** Typing a query now searches work items, active pull requests, and commits from the local cache and shows them grouped under the command actions. Filter by kind with `wi:` / `pr:` / `c:`, press Enter to open the result inside the app (the target tab is opened with the item selected), or Ctrl+Enter to open it in Azure DevOps. "Show all N …" rows carry the query into the full search tab.
- Numeric queries match IDs: work item search matches work item IDs (exact match first, then prefix) and PR search matches pull request numbers by prefix.

### Changed
- **Performance.** Database-backed commands now run off the main thread, so the UI no longer stalls while searching or loading cached data. SQLite connections use `busy_timeout` and `synchronous=NORMAL`, removing spurious "database is busy" failures when a background sync overlaps a read.
- **Sync writes far less.** Cache updates skip rows that have not changed (full-text index churn is eliminated), and work item sync only fetches items changed since the last sync, with a full reconcile at most every 24 hours. Note: work items deleted in Azure DevOps can remain visible for up to 24 hours until the next full sync.
- Pull request search and commit search grids are virtualized and scroll inside the results pane, keeping large result sets smooth.
- Command palette search keeps the previous results visible while typing instead of flashing empty, and background sync no longer refetches data while the window is hidden (it refreshes on focus).

### Fixed
- Command palette arrow keys now move the selection regardless of where focus is inside the palette, the highlighted row scrolls into view, and Tab focus stays in sync with the Enter target.
- The work item preview focus ring no longer draws over comment cards, and the comment box no longer shows the `Alt+M` / `Ctrl+Enter` badges.

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
- Help menu with embedded HTML user guide (sidebar button)
- Work Item preview panel shows posted comments

### Changed
- Work Item preview and PR list rendering hardened for large datasets and Azure DevOps rich text.
- Windows installer WebView2 bootstrapper handling is explicit in Tauri configuration and documentation.
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
