#!/usr/bin/env bash
# Opens one screen of the hub in a locked-down Chrome window and reopens it if it is ever closed.
#
#   ./scripts/kiosk.sh display [http://localhost:3000]            on the host laptop (projector)
#   ./scripts/kiosk.sh play P1 http://192.168.1.10:3000            on the left player laptop
#   ./scripts/kiosk.sh play P2 http://192.168.1.10:3000            on the right player laptop
#
# Works on Linux and macOS. Ctrl+C in this terminal stops the loop.
role="${1:-display}"
case "$role" in
  display) seat="D"; origin="${2:-http://localhost:3000}"; url="$origin/display" ;;
  play) seat="${2:-P1}"; origin="${3:-http://localhost:3000}"; url="$origin/play?seat=$seat" ;;
  *) echo "usage: $0 display [http://HOST:3000] | play P1|P2 http://HOST:3000"; exit 1 ;;
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
  # A second launch with the same profile would only open a tab in the first window and exit at once,
  # which would spin this loop. Wait for the existing window instead.
  if pgrep -f -- "user-data-dir=$profile" >/dev/null 2>&1; then
    sleep 5
    continue
  fi
  # Unknown flags are ignored by Chrome, so older and newer versions both work with this list.
  "$chrome" \
    --kiosk "$url" \
    --user-data-dir="$profile" \
    --no-first-run --no-default-browser-check --disable-translate \
    --noerrdialogs --disable-session-crashed-bubble --hide-crash-restore-bubble \
    --overscroll-history-navigation=0 --disable-pinch \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --unsafely-treat-insecure-origin-as-secure="$origin" \
    --start-fullscreen
  echo "browser closed, reopening in 1s"
  sleep 1
done
