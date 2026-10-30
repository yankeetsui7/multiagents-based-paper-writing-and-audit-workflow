@echo off
rem Print the git baseline evidence an audit run needs.
rem Usage: Get-AuditBaseline.cmd [-Workspace PATH]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Get-AuditBaseline.ps1" %*
exit /b %ERRORLEVEL%
