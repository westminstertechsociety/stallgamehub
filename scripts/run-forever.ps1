# Keeps the hub running all day on Windows: if the process ever exits, it is restarted. Quick repeated
# failures back off (2s, 4s, 8s ... up to 30s) so a real problem is noticed rather than hidden.
# Usage (PowerShell, from the project folder):  powershell -ExecutionPolicy Bypass -File .\scripts\run-forever.ps1
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force -Path logs | Out-Null
$delay = 1
while ($true) {
  $started = Get-Date
  "$(Get-Date -Format HH:mm:ss) starting hub" | Tee-Object -FilePath logs\supervisor.log -Append
  node scripts\start.mjs
  $code = $LASTEXITCODE
  if (((Get-Date) - $started).TotalSeconds -ge 30) { $delay = 1 } else { $delay = [Math]::Min($delay * 2, 30) }
  "$(Get-Date -Format HH:mm:ss) hub exited with code $code, restarting in ${delay}s (see logs\hub.log if this keeps happening)" | Tee-Object -FilePath logs\supervisor.log -Append
  Start-Sleep -Seconds $delay
}
