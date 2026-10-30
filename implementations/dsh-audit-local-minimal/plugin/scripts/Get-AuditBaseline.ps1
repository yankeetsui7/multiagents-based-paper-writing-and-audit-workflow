<#
.SYNOPSIS
  Print the git evidence an audit run needs: repo presence, HEAD SHA, dirty and untracked files.

.DESCRIPTION
  audit_diff diffs DSH_AUDIT_BASE (default HEAD) against the working tree and also
  lists untracked files, so a non-git workspace makes audit_diff return
  status:'unavailable'. Run this before handing a workspace to the auditor, and put
  the printed SHA into the handoff package as the frozen baseline.

.PARAMETER Workspace
  Directory to inspect (default: the plugin's default audit workspace).

.EXAMPLE
  .\Get-AuditBaseline.ps1 -Workspace 'D:\3-4论文\实验文件'
#>
[CmdletBinding()]
param(
  [string]$Workspace = 'D:\3-4论文\实验文件'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Workspace)) { throw "workspace not found: $Workspace" }
$root = (Resolve-Path -LiteralPath $Workspace).Path
$git = 'git'

Push-Location -LiteralPath $root
try {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  & $git rev-parse --is-inside-work-tree 2>$null | Out-Null
  $isRepo = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $previousPreference

  if (-not $isRepo) {
    Write-Host "[baseline] NOT a git repository: $root" -ForegroundColor Yellow
    Write-Host '  audit_diff will answer status:"unavailable" for this workspace.'
    Write-Host '  Options: (1) git init + commit a frozen baseline here, or'
    Write-Host '           (2) point DSH_AUDIT_WORKSPACE at the git research repo that holds the frozen versions.'
    exit 2
  }

  $head = (& $git rev-parse HEAD).Trim()
  $branch = (& $git rev-parse --abbrev-ref HEAD).Trim()
  $short = (& $git rev-parse --short HEAD).Trim()
  $dirty = @(& $git status --porcelain)
  $trackedChanges = @($dirty | Where-Object { $_ -notmatch '^\?\?' })
  $untracked = @($dirty | Where-Object { $_ -match '^\?\?' })

  Write-Host "[baseline] repo    = $root" -ForegroundColor Cyan
  Write-Host "[baseline] branch  = $branch"
  Write-Host "[baseline] HEAD    = $head  ($short)"
  Write-Host "[baseline] changed = $($trackedChanges.Count) tracked, $($untracked.Count) untracked"

  if ($trackedChanges.Count -gt 0) {
    Write-Host ''
    Write-Host '[baseline] tracked changes vs HEAD:' -ForegroundColor Cyan
    $trackedChanges | ForEach-Object { Write-Host "  $_" }
  }
  if ($untracked.Count -gt 0) {
    Write-Host ''
    Write-Host '[baseline] untracked files (audit_diff lists these too):' -ForegroundColor Cyan
    $untracked | ForEach-Object { Write-Host "  $_" }
  }

  Write-Host ''
  Write-Host 'Handoff hints:' -ForegroundColor Cyan
  Write-Host "  - frozen baseline to record : $head"
  Write-Host '  - DSH_AUDIT_BASE=HEAD       : audit only the uncommitted delta (default)'
  Write-Host '  - DSH_AUDIT_BASE=<frozen>   : audit everything since the frozen commit'
  if ($trackedChanges.Count -eq 0 -and $untracked.Count -eq 0) {
    Write-Host '  - warning: the working tree is clean, so a HEAD baseline diff will be empty;' -ForegroundColor Yellow
    Write-Host '    set DSH_AUDIT_BASE to the frozen commit SHA instead ("empty diff is not proof").' -ForegroundColor Yellow
  }
}
finally {
  Pop-Location
}
