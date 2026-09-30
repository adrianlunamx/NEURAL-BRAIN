# neural-brain · one-shot setup (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "▸ neural-brain setup" -ForegroundColor Cyan
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }

Write-Host "▸ backend: virtualenv + dependencies (first run downloads PyTorch)" -ForegroundColor Cyan
Push-Location backend
if (-not (Test-Path .venv)) { & $py -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip | Out-Null
& .\.venv\Scripts\pip.exe install -r requirements.txt
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "  created backend\.env -> put your ANTHROPIC_API_KEY there" -ForegroundColor Yellow
}
Pop-Location

Write-Host "▸ frontend: npm install" -ForegroundColor Cyan
Push-Location frontend
npm install --no-audit --no-fund
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Pop-Location

Write-Host "✓ setup complete" -ForegroundColor Green
Write-Host "  1. edit backend\.env and set ANTHROPIC_API_KEY=sk-ant-..."
Write-Host "  2. .\scripts\run.ps1   -> http://localhost:5173"
