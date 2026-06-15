---
name: release-azdo-dashboard
description: Cut a GitHub release for azdo-dashboard (AzDoDeck Windows x64 installers). Use when asked to release, publish a new version, ship master to GitHub, or diagnose a failed release workflow.
---

Releases are produced by the GitHub Actions workflow `.github/workflows/release.yml`
("Release Windows x64 Installer"). It builds the Tauri NSIS `.exe` and MSI
installers on `windows-latest` and publishes a GitHub Release. The release
tag/version always looks like `vX.Y.Z`.

Releasing means triggering that workflow and verifying the resulting GitHub
Release — you do **not** build installers locally.

## Prerequisites

- `gh` CLI authenticated against the repo (`gh auth status`).
- Push access to `master` and tags (the workflow needs `contents: write`, which
  it already has).
- Releases are cut from `master`. Make sure the work you want to ship is already
  merged into `master` (check with `git log --oneline origin/master`), then
  `git fetch origin --tags` so local tags are current.

## How the workflow decides what to release

Read `release.yml` if behavior is unclear, but the contract is:

- **Triggers**: a `v*` tag push, a daily cron (08:00 JST), or manual
  `workflow_dispatch` (with an optional `force_release` input).
- **Version source**: it takes the latest `vX.Y.Z` tag and bumps the patch
  number for the next release. `package.json`, `src-tauri/tauri.conf.json`, and
  `src-tauri/Cargo.toml` are updated to that version during the run.
- **Tag-push path vs auto path**: when triggered by a pushed tag, the "Create
  release tag" step is **skipped** (the tag already exists) and the version
  commit is skipped if master's version files already match. When triggered by
  cron/dispatch, the workflow computes the next version, commits the version
  bump, and creates the tag itself.
- If `master` has not advanced since the latest tag, an auto/cron run exits
  without releasing unless `force_release=true`.

## Release procedures

Pick based on the situation:

### A. Normal release — let the workflow bump and tag (preferred)

Use when `master` has new commits since the last release and you just want the
next patch version.

```powershell
gh workflow run release.yml --ref master
```

The workflow computes the next `vX.Y.Z`, writes the version files, commits, tags,
builds, and publishes.

### B. Master already carries a version bump but the tag is missing

This happens when a "Release vX.Y.Z" commit landed on `master` (version files
already bumped) but the tag/Release was never created — e.g. a previous workflow
run failed. Tag the exact master commit and push; the tag-push path runs and the
version commit is correctly skipped.

```powershell
git fetch origin --tags
git tag -a vX.Y.Z <master-sha> -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Use the latest `origin/master` SHA (`git rev-parse origin/master`). The local
checkout does not need to be on `master`.

## Watch the run

```powershell
# Find the run (tag push shows the tag as the branch/ref)
gh run list --workflow=release.yml --limit 3

# Poll status
gh run view <run-id> --json status,conclusion -q '.status+" "+(.conclusion//"")'

# Step-by-step progress
gh run view <run-id> --json jobs -q '.jobs[].steps[] | (.conclusion//"running")+" — "+.name'
```

Healthy progression: `Plan release` ✅ → `Create release tag` (skipped on
tag-push path) → `Check frontend` ✅ → `Check Rust` ✅ → **Build and publish
release** (the long step, ~10–15 min) → done. A run that dies in the first
~30 seconds failed in `Plan release` (see Troubleshooting).

## Verify the published release

```powershell
gh release view vX.Y.Z --json name,tagName,isDraft,isPrerelease,publishedAt,url,assets `
  -q '"tag: "+.tagName, "draft: "+(.isDraft|tostring), "prerelease: "+(.isPrerelease|tostring), "url: "+.url, (.assets[] | .name+" ("+(.size|tostring)+" bytes)")'
```

The release is good when:

- `draft: false` and `prerelease: false`.
- Two assets are attached: `AzDoDeck_X.Y.Z_x64-setup.exe` (NSIS) and
  `AzDoDeck_X.Y.Z_x64_en-US.msi` (MSI).

## Troubleshooting

- **Run fails in ~20–30 s**: it died in the `Plan release` step. Read the log:
  `gh run view <run-id> --log-failed`. Historically this was a PowerShell
  non-zero-exit issue in the planning script.
- **"Tag vX.Y.Z already exists, but master has unreleased commits"**: the
  computed next tag collides with an existing tag. Either the version was already
  released, or a stale tag must be deleted, or the next version must be bumped
  manually.
- **Release published but assets missing**: the Tauri build step or
  `tauri-action` upload failed late; re-run the job or inspect
  `Build and publish release` logs.

Do not edit secrets, version files, or the keyring path as part of releasing.
