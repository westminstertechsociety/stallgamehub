# Opens one screen of the hub in a locked-down Chrome/Edge window on Windows and reopens it if closed.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\kiosk.ps1 display
#   powershell -ExecutionPolicy Bypass -File .\scripts\kiosk.ps1 play P1 http://192.168.1.10:3000
#   powershell -ExecutionPolicy Bypass -File .\scripts\kiosk.ps1 play P2 http://192.168.1.10:3000
param(
  [string]$Role = 'display',
  [string]$Seat = 'P1',
  [string]$Origin = 'http://localhost:3000'
)
if ($Role -eq 'display' -and $Seat -like 'http*') { $Origin = $Seat; $Seat = 'D' }
$url = if ($Role -eq 'display') { "$Origin/display" } else { "$Origin/play?seat=$Seat" }
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Write-Error 'No Chrome or Edge found.'; exit 1 }
$profileDir = Join-Path $env:TEMP "hub-kiosk-$Role-$Seat"
$flags = @(
  '--kiosk', $url,
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run', '--no-default-browser-check', '--disable-translate',
  '--noerrdialogs', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
  '--overscroll-history-navigation=0', '--disable-pinch',
  '--autoplay-policy=no-user-gesture-required',
  "--unsafely-treat-insecure-origin-as-secure=$Origin",
  '--start-fullscreen'
)
while ($true) {
  $running = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" }
  if ($running) { Start-Sleep -Seconds 5; continue }
  Start-Process -FilePath $browser -ArgumentList $flags -Wait
  Write-Host 'browser closed, reopening in 1s'
  Start-Sleep -Seconds 1
}
