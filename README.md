# AzDoDeck

Azure DevOps desktop dashboard built with Tauri 2, React, and TypeScript. Browse pull requests, work items, and commits across your organization in a single app with local SQLite caching and background sync.

> **Status**: Under active development (pre-release).

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 11
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain
- Windows 10/11

## Getting Started

```sh
pnpm install
pnpm tauri dev
```

Use `pnpm tauri dev` for the real desktop app. It starts Vite and opens the Tauri WebView, where backend commands, SQLite, and secure PAT storage are available.

For frontend-only layout checks, `pnpm dev` opens a browser preview with demo data. Azure DevOps calls and credential storage are not available in that mode.

## Project Planning

Codex handoff notes, roadmap, and next milestone plans are in [docs/codex-handoffs](docs/codex-handoffs).

## License

[MIT](LICENSE)
