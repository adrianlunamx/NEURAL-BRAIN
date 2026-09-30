# neural-brain - stop the API and UI started by run.ps1 (their windows too).
# (keep this file ASCII: Windows PowerShell 5.1 reads BOM-less scripts as ANSI)
Set-Location (Join-Path $PSScriptRoot "..")
$pidFile = ".neural-brain.pids"
$stopped = 0

if (Test-Path $pidFile) {
  foreach ($id in Get-Content $pidFile) {
    if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
      taskkill /T /F /PID $id | Out-Null  # /T: the window plus uvicorn / node inside it
      $stopped++
    }
  }
  Remove-Item $pidFile
}

# Started some other way: stop whatever python/node still listens on our ports.
foreach ($port in 8000, 5173) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $owners) {
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match '^(python|uvicorn|node)$') {
      taskkill /T /F /PID $id | Out-Null
      $stopped++
    }
  }
}

if ($stopped) { Write-Host "OK neural-brain stopped" -ForegroundColor Green }
else { Write-Host "> neural-brain was not running" -ForegroundColor Yellow }
