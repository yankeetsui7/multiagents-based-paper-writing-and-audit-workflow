<#
.SYNOPSIS
  Run one non-interactive DSH audit pass and print the model's answer.

.DESCRIPTION
  Uses the dedicated `audit-headless` profile (dsh-base + dsh-headless + this plugin).
  The headless bundle disables the account/credentials rows by default; this profile
  re-enables them so the deepseek-account route can read the existing sign-in grant.

  The prompt is collapsed to a single line on purpose: the DSH CLI treats a
  multi-line prompt ambiguously (only the first line reached the agent in testing),
  so keep -Prompt as one dense sentence, or read instructions from a file and paste
  them as a single line.

.PARAMETER Prompt
  The full audit instruction, one line.

.PARAMETER Workspace
  Audit root (same meaning as in the web profile).

.PARAMETER Base
  Git revision the diff is taken from: HEAD (default) or a frozen commit SHA.

.PARAMETER Stage
  DSH_AUDIT_STAGE; 'conclusion' is required for submit_review.

.EXAMPLE
  .\Invoke-AuditHeadless.ps1 -Prompt 'Call audit_diff, then audit_read_range on audit_subject.md 1-200, then submit_review with the sha256 it printed and verdict Fail.'

.EXAMPLE
  $p = (Get-Content .\handoff\weekly-audit.md -Raw) -replace '\s+', ' '
  .\Invoke-AuditHeadless.ps1 -Prompt $p -Workspace 'D:\3-4论文\实验文件'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Prompt,
  [string]$Workspace = 'D:\3-4论文\实验文件',
  [string]$Base = 'HEAD',
  [ValidateSet('conclusion', 'data_audit')]
  [string]$Stage = 'conclusion',
  [string]$RunId = ('audit-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
)

$ErrorActionPreference = 'Stop'
$dsh = 'D:\DS Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $dsh)) { throw "dsh CLI not found: $dsh" }
if (-not (Test-Path -LiteralPath $Workspace)) { throw "workspace not found: $Workspace" }

$env:DSH_AUDIT_WORKSPACE = (Resolve-Path -LiteralPath $Workspace).Path
$env:DSH_AUDIT_BASE = $Base
$env:DSH_AUDIT_STAGE = $Stage
$env:DSH_AUDIT_RUN_ID = $RunId

$oneLine = ($Prompt -replace '\s+', ' ').Trim()
Write-Host "[audit] headless run $RunId | base=$Base stage=$Stage" -ForegroundColor Cyan
Write-Host "[audit] workspace = $env:DSH_AUDIT_WORKSPACE"

& $dsh --profile audit-headless $oneLine
$code = $LASTEXITCODE

$reviews = Join-Path $env:DSH_AUDIT_WORKSPACE '.audit\reviews'
if (Test-Path -LiteralPath $reviews) {
  Write-Host ''
  Write-Host '[audit] reviews in this workspace:' -ForegroundColor Cyan
  Get-ChildItem -LiteralPath $reviews -Filter 'review-*.json' | Sort-Object LastWriteTime |
    ForEach-Object { Write-Host ('  ' + $_.FullName + '  (' + $_.Length + ' B)') }
}
exit $code
