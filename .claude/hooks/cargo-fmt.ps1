# PostToolUse hook: run `cargo fmt` on the file Claude just edited when it is a
# Rust source file. CI gates on `cargo fmt --all --check`, so formatting on edit
# keeps the workspace from drifting out of fmt compliance.
$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try { $event = $raw | ConvertFrom-Json } catch { exit 0 }

$path = $event.tool_input.file_path
if (-not $path) { exit 0 }
if ($path -notmatch '\.rs$') { exit 0 }
if (-not (Test-Path -LiteralPath $path)) { exit 0 }

$rustfmt = Get-Command rustfmt -ErrorAction SilentlyContinue
if ($rustfmt) {
  $rustfmt = $rustfmt.Source
} else {
  $fallback = Join-Path $env:USERPROFILE '.cargo\bin\rustfmt.exe'
  if (Test-Path $fallback) { $rustfmt = $fallback } else { exit 0 }
}

# Format just the touched file. Running rustfmt directly formats a single file
# without needing the workspace manifest, keeping the hook fast and side-effect
# free for the rest of the tree. Match the project's edition.
& $rustfmt --edition 2021 $path 2>$null | Out-Null
exit 0
