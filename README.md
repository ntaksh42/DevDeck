# AzDoDeck

A Windows desktop dashboard for Azure DevOps. Search pull requests, work items, and commits across every project in your organization from a single window — and jump straight to the browser for anything that needs action.

> **Status**: Pre-release (v0.x). Core search features work; background caching and auto-updates are on the roadmap.

---

## Features

| Area | What you get |
|---|---|
| **Pull Request Search** | Filter by project, repository, and status; sortable grid; keyboard navigation; copy URL with `C` |
| **My Reviews** | PRs assigned to you for review with vote status, stale highlighting, and a local review-result preview panel |
| **Work Item Search** | Filter by project, state, and type; sortable grid with column resize; `C` to copy |
| **My Work Items** | Items currently assigned to you, refreshed on demand |
| **Commit Search** | Filter by project, repository, author, date range, or keyword; sortable grid with column resize |
| **Authentication** | Personal Access Token (PAT) or Azure CLI — credentials stored in Windows Credential Manager |
| **Keyboard shortcuts** | `Alt+1`–`6` for navigation; `↑↓ Home End PageUp/Down` in grids; `Enter` to open; `C` to copy URL; `?` for help |

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

1. Open **Settings** (`Alt+6` or the gear icon in the sidebar).
2. Enter your **Azure DevOps organization name** (the part after `dev.azure.com/`).
3. Choose an authentication method:
   - **PAT**: paste a Personal Access Token. Required scopes: `Code (Read)`, `Work Items (Read)`, `Project and Team (Read)`.
   - **Azure CLI**: requires `az login` completed in a terminal first. AzDoDeck calls `az account get-access-token` automatically.
4. Click **Connect**. AzDoDeck validates the credential before saving it.

Your PAT is stored in **Windows Credential Manager** — never written to disk in plain text.

---

## Using the app

### My Reviews (`Alt+1`)

Shows all pull requests where you are a reviewer. Rows highlighted in orange are older than 3 days.

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection |
| `Enter` | Open PR in Azure DevOps |
| `C` | Copy PR URL to clipboard |
| `1` / `2` / `3` / `4` | Filter: No Vote / Approved / Waiting / All |
| `D` | Toggle draft PRs |
| `R` | Refresh |
| `/` | Focus text filter |

The **Review Preview** panel on the right shows a local HTML file if you configure a **Review result folder** in Settings. AzDoDeck matches files containing the PR number (e.g. `review-PR42.html`).

### Pull Request Search (`Alt+2`)

Search all PRs across projects. Filter by **Project**, **Repository**, and **Status** before clicking **Search**.

All result columns are draggable to resize. Use `↑↓` to navigate rows, `Enter` to open, `C` to copy URL.

### My Work Items (`Alt+3`)

Work items currently assigned to you. Use the text box to filter by title. Click **Refresh** to reload.

### Work Item Search (`Alt+4`)

Search work items by keyword, project, state (New / Active / Resolved / Closed), and type (Bug, Task, User Story, …).

### Commits (`Alt+5`)

Search commits by keyword, project, repository, author, branch, and date range. Use the **7d / 30d / 90d** preset buttons to set a date range quickly.

Columns are resizable. Use `↑↓` to navigate, `Enter` to open in Azure DevOps, `C` to copy URL.

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

Produces an MSI and NSIS installer in `src-tauri/target/release/bundle/`.

### Publishing Windows installers

Release installers are built by GitHub Actions when a version tag is pushed:

```sh
git tag v0.1.1
git push origin v0.1.1
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
    ├── prs.rs / work_items.rs / commits.rs  — domain services
    ├── auth.rs                               — PAT + Azure CLI credential providers
    ├── db.rs                                 — SQLite via rusqlite (app_settings, organizations)
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
- All new Tauri commands must be added in all four places: `lib.rs`, domain service, `azdoCommands.ts`, and `App.tsx` (see `CLAUDE.md` for details).

---

## License

[MIT](LICENSE)
