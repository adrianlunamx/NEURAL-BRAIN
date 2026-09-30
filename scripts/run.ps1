# neural-brain - start backend (:8000) + frontend (:5173) in two windows
Set-Location (Join-Path $PSScriptRoot "..")
$root = Get-Location

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; .\backend\.venv\Scripts\uvicorn.exe backend.app.main:app --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev"

Write-Host "> NEURAL//BRAIN  UI -> http://localhost:5173   API -> http://localhost:8000/docs" -ForegroundColor Cyan
