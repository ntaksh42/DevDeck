# M0 — Repo init + Tauri scaffold + CI

## Goal

Stand up the AzDoDeck monorepo: Tauri 2 + React/TS scaffold, Cargo workspace with azdo-client stub, CI for lint+test on Rust (Ubuntu+Windows) and TS (Ubuntu), MIT license, minimal README.

## Key decisions

1. **`reqwest` uses `native-tls`, not `rustls-tls`.** Reason: `ring` requires clang on Windows which is not in the default toolchain. Windows-only app so SChannel is appropriate. Revisit if Linux/macOS support is added.
2. **`azdo-client` is a separate crate**, currently a stub. M1 fills it.
3. **Workspace-level `[workspace.dependencies]`** holds cross-cutting libs (serde, tokio, reqwest, chrono, thiserror, etc.). Tauri/rusqlite/keyring intentionally not workspace-shared as they have single consumers.
4. **No eslint config, no CHANGELOG/CODE_OF_CONDUCT/CONTRIBUTING yet.** Will add when needed (M3+ for lint, M8 for community files).
5. **One vitest placeholder test** to keep CI honest.

## Verification done

- `cargo check --workspace`: clean
- `cargo clippy --workspace --all-targets -- -D warnings`: clean
- `cargo fmt --all --check`: clean
- `npx tsc --noEmit`: clean
- `npx vitest --run`: 1 pass
- `pnpm tauri dev`: pending user verification (window should show "AzDoDeck" placeholder)

## Open items for Codex review

- Should `tracing-subscriber` be added at workspace level now or deferred to M1?
- Is the em-dash in `description = "AzDoDeck — Azure DevOps desktop dashboard"` OK in Cargo.toml, or prefer ASCII?
- README is intentionally minimal. Acceptable for M0?

## Known scaffold remnants

- `src/assets/react.svg`, `public/vite.svg`, `public/tauri.svg` — demo assets, kept for now
- `src-tauri/Cargo.lock` — removed (workspace uses root lockfile)
- `src/App.css` — removed (unused after router setup)
