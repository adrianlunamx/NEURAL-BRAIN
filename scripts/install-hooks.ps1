# neural-brain - install the hooks so Claude Code (or Cursor) shows up live in the brain.
#   .\scripts\install-hooks.ps1                 Claude Code, every session
#   .\scripts\install-hooks.ps1 --cursor        Cursor
#   .\scripts\install-hooks.ps1 --uninstall     remove them (add --cursor for Cursor)
# (keep this file ASCII: Windows PowerShell 5.1 reads BOM-less scripts as ANSI)
Set-Location (Join-Path $PSScriptRoot "..")
$py = "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "x run .\scripts\setup.ps1 first" -ForegroundColor Red; exit 1 }
& $py scripts\install_hooks.py @args
exit $LASTEXITCODE
