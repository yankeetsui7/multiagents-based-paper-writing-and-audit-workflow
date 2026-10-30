@echo off
rem Launch the interactive DSH audit profile (web UI).
rem Wrapper so the .ps1 runs even when the machine execution policy blocks scripts.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AuditWeb.ps1" %*
exit /b %ERRORLEVEL%
