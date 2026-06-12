param(
  [Parameter(Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string] $Version,

  [switch] $IncludeDirty,
  [switch] $SkipChecks,
  [switch] $SkipE2E,
  [switch] $NoPush,
  [switch] $NoRelease,
  [switch] $NoWatch
)

$ErrorActionPreference = "Stop"

function Run([string] $File, [string[]] $Arguments) {
  $rendered = ($Arguments | ForEach-Object { if ($_ -match '\s') { '"{0}"' -f $_ } else { $_ } }) -join " "
  Write-Host "==> $File $rendered"
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $File $rendered"
  }
}

function Read-Text([string] $Path) {
  return [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path))
}

function Write-Text([string] $Path, [string] $Text) {
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $Path), $Text, $utf8NoBom)
}

function Replace-Once([string] $Path, [string] $Pattern, [string] $Replacement) {
  $text = Read-Text $Path
  $next = [regex]::Replace($text, $Pattern, $Replacement, 1)
  if ($next -eq $text) {
    throw "Pattern not found in ${Path}: $Pattern"
  }
  Write-Text $Path $next
}

function Next-PatchVersion() {
  $latest = git tag --list "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname | Select-Object -First 1
  if (-not $latest) {
    $package = Get-Content package.json -Raw | ConvertFrom-Json
    return $package.version
  }

  if ($latest -notmatch '^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$') {
    throw "Latest tag does not look like vX.Y.Z: $latest"
  }

  $major = [int] $Matches.major
  $minor = [int] $Matches.minor
  $patch = [int] $Matches.patch + 1
  return "$major.$minor.$patch"
}

function Update-VersionFiles([string] $NextVersion) {
  Replace-Once "package.json" '("version"\s*:\s*")[^"]+(")' "`${1}${NextVersion}`$2"
  Replace-Once "src-tauri/tauri.conf.json" '("version"\s*:\s*")[^"]+(")' "`${1}${NextVersion}`$2"
  Replace-Once "src-tauri/Cargo.toml" '(?m)^(version = ")[^"]+(")' "`${1}${NextVersion}`$2"
  Replace-Once "Cargo.lock" '(\[\[package\]\]\r?\nname = "azdo-dashboard"\r?\nversion = ")[^"]+(")' "`${1}${NextVersion}`$2"
}

function Get-Cargo() {
  $cargo = Get-Command cargo -ErrorAction SilentlyContinue
  if ($cargo) {
    return $cargo.Source
  }

  $fallback = Join-Path $env:USERPROFILE ".cargo/bin/cargo.exe"
  if (Test-Path -LiteralPath $fallback) {
    return $fallback
  }

  throw "cargo was not found on PATH or at $fallback"
}

function Wait-ForReleaseRun([string] $Tag) {
  Write-Host "==> Waiting for GitHub Actions release workflow for $Tag"
  $run = $null
  for ($i = 0; $i -lt 18; $i++) {
    $runsJson = gh run list --limit 10 --json databaseId,headBranch,status,conclusion,url
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to list GitHub Actions runs."
    }

    $run = ($runsJson | ConvertFrom-Json | Where-Object { $_.headBranch -eq $Tag } | Select-Object -First 1)
    if ($run) {
      break
    }
    Start-Sleep -Seconds 10
  }

  if (-not $run) {
    throw "Could not find a GitHub Actions run for $Tag."
  }

  while ($run.status -ne "completed") {
    Write-Host "    $($run.url) is $($run.status)"
    Start-Sleep -Seconds 30
    $run = gh run view $run.databaseId --json databaseId,status,conclusion,url | ConvertFrom-Json
  }

  if ($run.conclusion -ne "success") {
    throw "Release workflow failed: $($run.url) ($($run.conclusion))"
  }

  Write-Host "==> Release workflow succeeded: $($run.url)"
}

Run "git" @("fetch", "origin", "--tags")

$branch = (git branch --show-current).Trim()
if ($branch -ne "master") {
  throw "Releases must be cut from master. Current branch: $branch"
}

$local = (git rev-parse master).Trim()
$remote = (git rev-parse origin/master).Trim()
if ($local -ne $remote) {
  throw "Local master is not equal to origin/master. Push or pull before releasing."
}

$dirtyBefore = git status --porcelain
if ($dirtyBefore -and -not $IncludeDirty) {
  throw "Working tree has changes. Commit them first, or rerun with -IncludeDirty to include them in the release commit."
}

if (-not $Version) {
  $Version = Next-PatchVersion
}

$tag = "v$Version"
if (git rev-parse --verify --quiet "refs/tags/$tag") {
  throw "Tag already exists: $tag"
}

Write-Host "==> Preparing release $tag"
Update-VersionFiles $Version

if (-not $SkipChecks) {
  $env:CI = "true"
  $cargo = Get-Cargo
  Run "pnpm" @("install", "--frozen-lockfile")
  Run "pnpm" @("tsc", "--noEmit")
  Run "pnpm" @("test", "--", "--run")
  Run "pnpm" @("build")
  Run $cargo @("fmt", "--all", "--check")
  Run $cargo @("clippy", "--workspace", "--all-targets", "--", "-D", "warnings")
  Run $cargo @("test", "--workspace")
  if (-not $SkipE2E) {
    Run "pnpm" @("test:e2e")
  }
}

Run "git" @("add", "-A")
Run "git" @("commit", "-m", "Release $Version")
Run "git" @("tag", "-a", $tag, "-m", "Release $tag")

if (-not $NoPush) {
  Run "git" @("push", "origin", "master")
  Run "git" @("push", "origin", $tag)
}

if (-not $NoRelease) {
  Run "gh" @("release", "create", $tag, "--title", "AzDoDeck $tag", "--generate-notes", "--latest")
}

if (-not $NoWatch) {
  Wait-ForReleaseRun $tag
  Run "gh" @("release", "view", $tag, "--json", "url,tagName,name,isDraft,isPrerelease,assets")
}

Write-Host "==> Done: $tag"
