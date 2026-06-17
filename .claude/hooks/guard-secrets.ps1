# PreToolUse hook: block writes that look like they would persist Azure DevOps
# secrets (PATs / Azure CLI tokens) into source, SQLite, config, logs, tests, or
# fixtures. AGENTS.md forbids leaking these outside the keyring-backed path; this
# hook turns that rule into a structural guard.
#
# Output contract: print JSON on stdout to ask Claude to reconsider. A plain
# `exit 0` allows the write.
$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try { $event = $raw | ConvertFrom-Json } catch { exit 0 }

# Note: $input is a reserved automatic variable in PowerShell; use $toolInput.
$toolInput = $event.tool_input
$path = $toolInput.file_path

# Content of the pending write, across Write / Edit shapes.
$content = @(
  $toolInput.content
  $toolInput.new_string
) -join "`n"
if (-not $content) { exit 0 }

# The keyring credential-key prefix is the canonical secret marker. Match it
# alongside contexts that strongly imply a literal token is being embedded.
$patterns = @(
  'azdodeck:org:[^"'']*:(pat|azure-cli)'  # credential key being written somewhere
  '(?i)(pat|personal[_-]?access[_-]?token|access[_-]?token)\s*[:=]\s*["''][^"'']{20,}["'']'
)

$hit = $null
foreach ($p in $patterns) {
  $m = [regex]::Match($content, $p)
  if ($m.Success) { $hit = $m.Value; break }
}
if (-not $hit) { exit 0 }

$reason = @"
This write appears to persist an Azure DevOps secret outside the keyring path.
Matched: $($hit.Substring(0, [Math]::Min(60, $hit.Length)))
File: $path

AGENTS.md forbids storing PATs / Azure CLI tokens in source, SQLite, config,
logs, tests, or fixtures. Secrets must go through Windows Credential Manager via
the keyring crate (service `AzDoDeck`). If this is a placeholder or a key name
only (no real token value), confirm that before proceeding.
"@

$payload = @{
  hookSpecificOutput = @{
    hookEventName            = 'PreToolUse'
    permissionDecision       = 'ask'
    permissionDecisionReason = $reason
  }
}
$payload | ConvertTo-Json -Depth 5 -Compress
exit 0
