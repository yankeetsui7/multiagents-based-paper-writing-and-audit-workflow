<#
.SYNOPSIS
  Launch the interactive DSH audit profile (web UI) for one audit run.

.DESCRIPTION
  Starts `dsh audit` (dedicated web profile) with the audit environment variables
  the plugin needs. The DSH-side guard allows ONLY audit_diff / audit_read_range /
  audit_search / submit_review, so every other tool call is denied inside this
  session, and submit_review writes at most one review JSON per process.

.PARAMETER Workspace
  Audit root. audit_read_range / audit_search / submit_review are confined to it,
  and it is where .audit\reviews will be written.

.PARAMETER Base
  Git revision the diff is taken from: HEAD (default), a frozen commit SHA, or a tag.

.PARAMETER Stage
  DSH_AUDIT_STAGE. submit_review is only accepted when this is 'conclusion';
  use 'data_audit' for a read-only evidence pass.

.PARAMETER Port
  Web UI port (default 3080). Pass 0 to let the OS pick a free port.

.EXAMPLE
  .\Start-AuditWeb.ps1 -Workspace 'D:\3-4论文\实验文件' -Base 'HEAD'
#>
[CmdletBinding()]
param(
  [string]$Workspace = 'D:\3-4论文\实验文件',
  [string]$Base = 'HEAD',
  [ValidateSet('conclusion', 'data_audit')]
  [string]$Stage = 'conclusion',
  [string]$RunId = ('audit-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
  [int]$Port = 3080,
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
$dsh = 'D:\DS Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $dsh)) { throw "dsh CLI not found: $dsh" }
if (-not (Test-Path -LiteralPath $Workspace)) { throw "workspace not found: $Workspace" }

$env:DSH_AUDIT_WORKSPACE = (Resolve-Path -LiteralPath $Workspace).Path
$env:DSH_AUDIT_BASE = $Base
$env:DSH_AUDIT_STAGE = $Stage
$env:DSH_AUDIT_RUN_ID = $RunId

Write-Host '[audit] DSH audit profile' -ForegroundColor Cyan
Write-Host "  workspace = $env:DSH_AUDIT_WORKSPACE"
Write-Host "  base      = $env:DSH_AUDIT_BASE"
Write-Host "  stage     = $env:DSH_AUDIT_STAGE"
Write-Host "  run_id    = $env:DSH_AUDIT_RUN_ID"
Write-Host '  allowed   = audit_diff, audit_read_range, audit_search, submit_review'
Write-Host '  review    = <workspace>\.audit\reviews\review-<uuid>.json'
Write-Host ''

$cliArgs = @('audit', '--port', "$Port")
if (-not $Open) { $cliArgs += '--no-open' }
& $dsh @cliArgs
exit $LASTEXITCODE
