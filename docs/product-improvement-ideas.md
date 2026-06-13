# AzDoDeck Product Improvement Ideas

This backlog summarizes ideas from a quick review of adjacent tools such as
Azure DevOps Boards, GitHub Issues and Projects, Jira, Linear, YouTrack,
Trello, GitLab, and GitKraken.

## Implemented Or In Progress

- Keyboard shortcut help with `?` / `F1`.
- Command palette with `Ctrl+K`.
- Grid-first keyboard navigation with `J` / `K`, arrows, `Enter`, and `Esc`.
- Inline Work Item editing for state, assignee, and priority.
- Work Item Views with saved WIQL, counts, result grid, preview, pinning,
  manual ordering, per-view sort, and per-view preview visibility.
- Work Item Grid virtualization for large result sets.
- Settings cache controls for data cache and layout cache.
- Built-in Work Item Views for Assigned to me, Following, Mentioned, and My Activity.
- `state:Doing assignee:me` style My Work Items filtering and filter helper chips.
- Recent Work Item local tracking for selected/opened items.
- Long comment folding with quick expand.
- Image lightbox previews for rich Work Item description and comment images.
- Clear image load failure state for Azure DevOps attachment auth/permission issues.
- Work Item type specific fields such as Severity, Points, and Remaining Work.
- WIQL macro insertion helpers for `@Me`, `@Today`, `@CurrentIteration`, and `@Follows`.
- Command palette ranking based on recently used commands.
- Adjacent Work Item preview prefetch and visible cache age.
- Work Item Grid column visibility customization, saved per grid/view.
- WIQL editor completions and lightweight validation.
- Bulk Work Item state, assignee, and priority updates with failure details.
- Staged Work Item edits applied as one JSON Patch request, with 10-second undo.
- Field presets for re-staging common Work Item changes.
- Local done/archive triage for My Reviews and My Work Items.
- Reviewer-action sections and merge-conflict badges in My Reviews.
- Command palette cross-entity search across organizations with recent items.
- GitHub-style two-key navigation (`G` then a view key).

## Requires Azure DevOps API Expansion

These remain product ideas because they need additional Azure DevOps endpoints,
data modeling, or event history support beyond the current command surface.

### Work Item Views

- View folders and shared/team view grouping.
- Recently commented Work Items.
- Unread comment and unread mention indicators.
- Follow and unfollow actions from the preview header.

### Preview And Comments

- Comment editing.
- Timeline events for state changes, assignee changes, and comments.
- Relation sections for parent, children, related work, linked PRs, branches, and commits.
- Shared Azure DevOps query folder import.

## Pull Request Review

- Add review inbox states for waiting on me, waiting on author, updated since last view, and CI failed.
- Show unresolved thread count, policy status, build status, and reviewer vote in the grid.
- Add preview summary for changed files and risk markers.
- Add keyboard actions for approve, reject, and wait for author.
- Highlight files or commits changed since the last time the PR was viewed.

## Navigation And Keyboard

- Show only context-relevant shortcuts in a compact status bar.
- Teach shortcuts opportunistically after mouse actions.
- Add back and forward history with `Alt+Left` and `Alt+Right`.

## Scale And Reliability

- Add paged or incremental query result fetching for very large WIQL results.
- Keep the last successful list visible during API failures.
- Add background bulk operation progress for long-running multi-project updates.
- Centralize retry and backoff display for throttling and transient Azure DevOps errors.

## Azure DevOps Integration

- Move "Open in Azure DevOps" into a compact icon or context menu where possible.
