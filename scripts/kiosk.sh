#!/usr/bin/env bash
# Opens one screen of the hub in a locked-down Chrome window and reopens it if it is ever closed.
#
#   ./scripts/kiosk.sh display                      on the host laptop (projector)
#   ./scripts/kiosk.sh play P1 http://192.168.1.10:3000   on the left player laptop
#   ./scripts/kiosk.sh play P2 http://192.168.1.10:3000   on the right player laptop
#
# Works on Linux and macOS. Ctrl+C in this terminal stops the loop.
role="${1:-display}"
seat="${2:-P1}"
origin="${3:-http://localhost:3000}"
case "$role" in
  display) url="http://localhost:3000/display" ;;
  play) url="$origin/play?seat=$seat" ;;
  *) echo "usage: $0 display | play P1|P2 http://HOST:3000"; exit 1 ;;
esac

chrome=""
for c in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then chrome="$c"; break; fi
done
if [ -z "$chrome" ]; then echo "No Chrome, Chromium or Edge found."; exit 1; fi

profile="${TMPDIR:-/tmp}/hub-kiosk-$role-$seat"
trap 'echo "stopping"; exit 0' INT TERM
while true; do
  "$chrome" \
    --kiosk "$url" \
    --user-data-dir="$profile" \
    --no-first-run --no-default-browser-check --disable-translate --disable-infobars \
    --noerrdialogs --disable-session-crashed-bubble --disable-features=TranslateUI \
    --overscroll-history-navigation=0 --disable-pinch \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --unsafely-treat-insecure-origin-as-secure="$origin" \
    --start-fullscreen
  echo "browser closed, reopening in 1s"
  sleep 1
done
