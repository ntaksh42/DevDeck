# AzDoDeck

A Windows desktop dashboard for Azure DevOps. Search pull requests, work items, and commits across every project in your organization from a single window — and jump straight to the browser for anything that needs action.

> **Status**: Pre-release (v0.x). Core features work; installers are unsigned and there is no auto-update yet.

---

## Features

| Area | What you get |
|---|---|
| **My Reviews** | PRs assigned to you for review with vote status, merge-conflict badges, stale highlighting, local done/archive triage, and a local review-result preview panel |
| **Pull Request Search** | Filter by project, repository, and status; sortable grid; keyboard navigation; copy URL with `C` |
| **My Work Items / Views** | Items assigned to you plus saved WIQL views with counts, pinning, per-view sort, and preview |
| **Work Item editing** | Stage state / assignee / priority / field changes and apply them in one request; comments with @mentions; field presets |
| **Work Item Search** | Filter by project, state, and type; sortable grid with column resize; `C` to copy |
| **Commit Search** | Filter by project, repository, author, date range, or keyword; sortable grid with column resize |
| **Command palette** | `Ctrl+K` runs commands and searches work items, active PRs, and commits across every organization |
| **Background sync** | Active PRs and work items are cached locally and refreshed in the background, with optional desktop notifications |
| **Authentication** | Personal Access Token (PAT) or Azure CLI — credentials stored in Windows Credential Manager |
| **Keyboard shortcuts** | `G` then a letter to switch views; `↑↓ J/K Home End PageUp/Down` in grids; `C` to copy URL; `?` for the full list |

---

## Installation

1. Go to the [latest GitHub Release](../../releases/latest) and download the Windows x64 `.exe` or `.msi` installer.
2. Run the installer. On first launch Windows may show a SmartScreen prompt — click **More info → Run anyway** (see [SmartScreen note](#windows-smartscreen) below).
3. Connect an Azure DevOps organization on the Settings screen.

### Windows SmartScreen

Because AzDoDeck is not yet code-signed, Windows Defender SmartScreen shows a warning the first time you run the installer. This is expected for unsigned apps distributed outside the Microsoft Store.

**To bypass the warning:**
1. Click **More info** (below the warning text).
2. Click **Run anyway**.

Code signing is tracked in issue [#1](../../issues/1).

---

## First-time setup

1. Open **Settings** (`Alt+,` or the gear icon in the sidebar).
2. Enter your **Azure DevOps organization name** (the part after `dev.azure.com/`).
3. Choose an authentication method:
   - **PAT**: paste a Personal Access Token. Required scopes: `Code (Read)`, `Work Items (Read)`, `Project and Team (Read)`.
   - **Azure CLI**: requires `az login` completed in a terminal first. AzDoDeck calls `az account get-access-token` automatically.
4. Click **Connect**. AzDoDeck validates the credential before saving it.

Your PAT is stored in **Windows Credential Manager** — never written to disk in plain text.

---

## Using the app

Switch views with a `G` key chain: press `G`, then `R` (My Reviews), `P` (PR Search), `W` (My Work Items), `I` (Work Item Search), `V` (Work Item Views), `C` (Commits), or `S` (Settings). Press `?` or `F1` for the full in-app shortcut list.

### My Reviews (`G` `R`)

Shows all pull requests where you are a reviewer. Rows highlighted in orange are older than 3 days.

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection |
| `Enter` | Focus the preview panel |
| `Ctrl+Enter` | Open PR in Azure DevOps |
| `C` | Copy PR URL to clipboard |
| `1` / `2` / `3` / `4` | Filter: No Vote / Waiting Author / Approved / All |
| `D` | Toggle draft PRs |
| `E` | Mark done locally / restore |
| `/` | Focus text filter |

The **Review Preview** panel on the right shows a local HTML file if you configure a **Review result folder** in Settings. AzDoDeck matches files containing the PR number (e.g. `review-PR42.html`).

### Pull Request Search (`G` `P`)

Search all PRs across projects. Filter by **Project**, **Repository**, and **Status** before clicking **Search**.

All result columns are draggable to resize. Use `↑↓` to navigate rows, `Enter` to open, `C` to copy URL.

### My Work Items (`G` `W`) and Work Item Views (`G` `V`)

My Work Items lists items currently assigned to you. Work Item Views are saved WIQL queries with result counts; views can be pinned to the sidebar, reordered, and given per-view sort and columns.

In any work item grid you can stage changes (`S` state, `A` assignee, `P` priority, `F` cycles through the custom fields shown in the preview), apply them with `Ctrl+S`, and post comments with @mentions (`M`, then `Ctrl+Enter`).

### Work Item Search (`G` `I`)

Search work items by keyword, project, state (New / Active / Resolved / Closed), and type (Bug, Task, User Story, …).

### Commits (`G` `C`)

Search commits by keyword, project, repository, author, branch, and date range. Use the **7d / 30d / 90d** preset buttons to set a date range quickly.

Columns are resizable. Use `↑↓` to navigate, `Enter` to open in Azure DevOps, `C` to copy URL.

### Command palette (`Ctrl+K`)

Type to run commands or search work items, active pull requests, and commits across every configured organization. Prefix with `wi:`, `pr:`, or `c:` to limit the result kind; `Enter` opens the result inside the app, `Ctrl+Enter` opens it in Azure DevOps.

---

## Multiple organizations

You can add more than one organization in Settings. Use the Organization selector in each search form to switch between them.

---

## Development

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | ≥ 11 |
| Rust | stable (latest) |
| Windows | 10 or 11 |

### Running locally

```sh
# Install JS dependencies
pnpm install

# Start the full Tauri app (recommended)
pnpm tauri dev

# Browser-only preview with demo data (no Tauri, no real API calls)
pnpm dev
```

`pnpm dev` opens a browser with fixture data so you can iterate on UI without a real Azure DevOps connection.

### Running tests

```sh
# TypeScript type check
pnpm tsc --noEmit

# Rust tests (all crates)
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
cargo test --workspace

# Rust lint
cargo clippy --workspace --all-targets -- -D warnings
```

### Building a release binary

```sh
pnpm tauri build
```

Produces an MSI and NSIS installer in `target/release/bundle/`.

### Publishing Windows installers

Release installers are built by GitHub Actions when a version tag is pushed. Use
the release helper to update version files, run checks, commit, tag, push,
create the GitHub Release, and wait for the installer workflow:

```powershell
pnpm release -- 0.1.8
```

By default the helper stops if the working tree already has changes. To include
current uncommitted work in the release commit:

```powershell
pnpm release -- 0.1.8 -IncludeDirty
```

The release workflow builds Windows x64 only and publishes both installer
formats to the GitHub Release:

- `.exe` NSIS installer for normal interactive installs.
- `.msi` installer for managed Windows environments.

The installers are intentionally small because AzDoDeck uses the system
Microsoft Edge WebView2 runtime instead of bundling a browser engine. If WebView2
is missing, the installer downloads and installs the WebView2 bootstrapper
silently during setup.

---

## Architecture

```
React + Vite + TypeScript (src/)
    ↓  Tauri IPC invoke()
Rust backend (src-tauri/)
    ├── prs.rs / work_items.rs / commits.rs / search.rs — domain services
    ├── sync.rs                               — background sync loop + sync:updated events
    ├── orgs.rs / projects.rs / settings.rs   — organizations, project directory, app settings
    ├── auth.rs                               — PAT + Azure CLI credential providers
    ├── db.rs                                 — SQLite cache via rusqlite (schema migrations)
    └── secrets.rs                            — keyring (Windows Credential Manager)
         ↓
crates/azdo-client/                           — independent ADO REST client
    Azure DevOps REST 7.1
```

The `azdo-client` crate is independent of Tauri, making it easy to test with `wiremock`.

Credentials are stored exclusively in **Windows Credential Manager** via the `keyring` crate. They are never written to SQLite or config files.

---

## Contributing

Pull requests are welcome. Please open an issue first for significant changes.

- Rust code: `cargo fmt` + `cargo clippy -D warnings` must pass.
- TypeScript: `pnpm tsc --noEmit` must pass.
- All new Tauri commands must be added in all four places: `lib.rs`, the domain service, `azdoCommands.ts` (wrapper, Zod schema, and browser demo branch), and the calling React feature (see `AGENTS.md` for details).

---

## License

[MIT](LICENSE)
