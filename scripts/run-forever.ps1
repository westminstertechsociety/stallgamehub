# Keeps the hub running all day on Windows: if the process ever exits, it is restarted after a second.
# Usage (PowerShell, from the project folder):  .\scripts\run-forever.ps1
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force -Path logs | Out-Null
while ($true) {
  "$(Get-Date -Format HH:mm:ss) starting hub" | Tee-Object -FilePath logs\supervisor.log -Append
  node scripts\start.mjs
  "$(Get-Date -Format HH:mm:ss) hub exited with code $LASTEXITCODE, restarting in 1s" | Tee-Object -FilePath logs\supervisor.log -Append
  Start-Sleep -Seconds 1
}
