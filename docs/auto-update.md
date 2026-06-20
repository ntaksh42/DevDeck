# Auto-update (opt-in)

The desktop app ships with the Tauri updater wired up (Settings → **Software
update** → *Check for updates*), but it is **inert until a maintainer enables
signed release artifacts**. Until then, *Check for updates* simply reports that
the app is up to date (or skips safely on error).

The pieces already in place:

- `tauri-plugin-updater` / `tauri-plugin-process` plugins + `updater:default` /
  `process:default` capability permissions.
- A `plugins.updater` block in `src-tauri/tauri.conf.json` whose `endpoints`
  point at the GitHub Releases `latest.json`.
- The `Software update` settings panel (`checkForUpdate` /
  `installUpdateAndRelaunch`), guarded so it is a no-op in the browser runtime.
- `release.yml` reads `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from secrets (a no-op while artifacts are
  off).

To turn it on:

1. Generate a signing keypair once:
   ```sh
   pnpm tauri signer generate -w ~/.tauri/azdodeck.key
   ```
2. Put the **public** key in `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey` (replacing `REPLACE_WITH_TAURI_SIGNING_PUBLIC_KEY`).
3. Add repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the private key file
   contents) and, if you set one, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Enable updater artifacts so a signed `latest.json` is published with each
   release — set `"createUpdaterArtifacts": true` under `bundle` in
   `src-tauri/tauri.conf.json` (and ensure the release adds the `updater`
   bundle).

Never commit the private key. Keep the rollout opt-in (manual check) while the
installers remain unsigned, per the project's current distribution policy.
