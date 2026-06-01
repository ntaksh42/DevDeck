# Demo Harness

The browser development path uses `demoInvoke()` instead of Tauri IPC. The demo
harness can switch fixture behavior without connecting to Azure DevOps.

Use a URL query parameter:

```text
http://127.0.0.1:1420/?scenario=rich-text
```

Or persist a scenario in local storage:

```js
localStorage.setItem("azdodeck:demo:scenario", "large-data");
```

URL parameters take precedence over local storage.

## Scenarios

| Scenario | Purpose |
| --- | --- |
| `default` | Normal demo data used by the browser preview and smoke tests. |
| `empty` | Empty PR and work item lists. |
| `large-data` | Hundreds of PRs, review PRs, work items, comments, and long rich fields. |
| `rich-text` | Azure DevOps-like HTML with mentions, tables, images, links, blockquotes, and code blocks. |
| `api-errors` | Selected commands throw errors to exercise error handling and rollback paths. |
| `slow-network` | Adds extra latency to every demo command. |

## Intended Use

- Use `rich-text` before touching work item preview rendering, comments,
  mentions, image fetching, or HTML sanitization.
- Use `large-data` before changing grids, filters, preview panes, virtualized
  lists, or keyboard navigation.
- Use `api-errors` before changing mutations such as comment posting, assignee
  updates, or bulk work item changes.
- Keep `default` stable because it backs the main Playwright smoke workflow.
