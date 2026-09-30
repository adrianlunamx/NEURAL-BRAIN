# neural-brain - start backend (:8000) + frontend (:5173) in two windows.
# Runs setup first if needed, waits for the API, then opens the browser.
# Stop both with .\scripts\stop.ps1
# (keep this file ASCII: Windows PowerShell 5.1 reads BOM-less scripts as ANSI)
Set-Location (Join-Path $PSScriptRoot "..")
$root = Get-Location
$pidFile = Join-Path $root ".neural-brain.pids"
$api = "http://127.0.0.1:8000"
$ui = "http://localhost:5173"

function Test-Api {
  try { Invoke-WebRequest "$api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Path "backend\.venv") -or -not (Test-Path "frontend\node_modules")) {
  Write-Host "> first run: installing dependencies" -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "setup.ps1")
  if (-not $?) { Write-Host "x setup failed" -ForegroundColor Red; exit 1 }
}

if (Test-Api) {
  Write-Host "> the brain is already running: $ui  (stop it with .\scripts\stop.ps1)" -ForegroundColor Yellow
  Start-Process $ui
  exit 0
}

$backend = Start-Process powershell -PassThru -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; `$host.UI.RawUI.WindowTitle = 'neural-brain API'; .\backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 127.0.0.1 --port 8000"
$frontend = Start-Process powershell -PassThru -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; `$host.UI.RawUI.WindowTitle = 'neural-brain UI'; npm run dev"
"$($backend.Id)`n$($frontend.Id)" | Set-Content -Encoding ascii $pidFile

# the first start downloads the embedding model (~90 MB): allow a few minutes
Write-Host "> waiting for the API" -NoNewline -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(5)
while (-not (Test-Api)) {
  if ($backend.HasExited -or (Get-Date) -gt $deadline) {
    Write-Host ""
    Write-Host "x the API did not start: look at the 'neural-brain API' window" -ForegroundColor Red
    exit 1
  }
  Write-Host "." -NoNewline
  Start-Sleep -Milliseconds 500
}
Write-Host " ok" -ForegroundColor Green

Start-Process $ui
Write-Host "> NEURAL//BRAIN  UI -> $ui   API -> $api/docs" -ForegroundColor Cyan
Write-Host "  stop it with .\scripts\stop.ps1"
