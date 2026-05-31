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

## Work Item Views

- Add fixed built-in views for Assigned to me, Following, Mentioned, and My Activity.
- Add view favorites, folders, and shared/team view grouping.
- Add `state:Doing assignee:me tag:foo` style filter syntax on top of WIQL views.
- Add filter suggestions for state, type, project, assignee, area, iteration, and tag.
- Add recently opened and recently commented Work Items.
- Add unread comment and unread mention indicators.
- Add follow and unfollow actions from the preview header.

## Preview And Comments

- Add comment editing.
- Add saved replies for frequently used comments.
- Add long comment folding with quick expand.
- Add timeline events for state changes, assignee changes, and comments.
- Add relation sections for parent, children, related work, linked PRs, branches, and commits.
- Add image lightbox previews for description and comment attachments.
- Add clear image load failure states for auth, permission, and expired URL cases.
- Add Work Item type specific field sets, such as Severity for Bugs and Remaining Work for Tasks.

## Pull Request Review

- Add review inbox states for waiting on me, waiting on author, updated since last view, and CI failed.
- Show unresolved thread count, policy status, build status, and reviewer vote in the grid.
- Add preview summary for changed files and risk markers.
- Add keyboard actions for approve, reject, and wait for author.
- Highlight files or commits changed since the last time the PR was viewed.

## Navigation And Keyboard

- Add GitHub-style two-key navigation such as `g i` for Work Items and `g r` for reviews.
- Show only context-relevant shortcuts in a compact status bar.
- Teach shortcuts opportunistically after mouse actions.
- Add back and forward history with `Alt+Left` and `Alt+Right`.
- Add command palette ranking based on recently used commands.

## Scale And Reliability

- Add paged or incremental query result fetching for very large WIQL results.
- Prefetch adjacent Work Item previews after the selected row stabilizes.
- Show cache age, such as "data from 5 minutes ago".
- Keep the last successful list visible during API failures.
- Add background bulk operation progress with per-row failure reporting.
- Centralize retry and backoff display for throttling and transient Azure DevOps errors.

## Azure DevOps Integration

- Import shared Azure DevOps query folders into Work Item Views.
- Add WIQL editor completion and validation.
- Add UI helpers to insert Azure DevOps macros such as `@Me`, `@Today`,
  `@CurrentIteration`, and `@Follows`.
- Move "Open in Azure DevOps" into a compact icon or context menu where possible.
