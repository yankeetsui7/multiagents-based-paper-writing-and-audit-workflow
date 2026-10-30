@echo off
rem Run one non-interactive DSH audit pass (audit-headless profile).
rem Usage: Invoke-AuditHeadless.cmd -Prompt "one-line audit instruction" [-Workspace PATH] [-Base HEAD] [-Stage conclusion]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-AuditHeadless.ps1" %*
exit /b %ERRORLEVEL%
