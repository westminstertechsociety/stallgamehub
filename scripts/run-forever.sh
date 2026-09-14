#!/usr/bin/env bash
# Keeps the hub running all day: if the process ever exits, it is restarted. Quick repeated failures back off
# (2s, 4s, 8s ... up to 30s) and are logged loudly so a real problem (port in use, missing build) is noticed.
# Usage: ./scripts/run-forever.sh      (from the project folder; Ctrl+C stops the loop)
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
trap 'echo "stopping"; exit 0' INT TERM
delay=1
while true; do
  started=$(date +%s)
  echo "$(date '+%H:%M:%S') starting hub" | tee -a logs/supervisor.log
  node scripts/start.mjs
  code=$?
  if [ $(( $(date +%s) - started )) -ge 30 ]; then delay=1; else delay=$(( delay * 2 )); [ $delay -gt 30 ] && delay=30; fi
  echo "$(date '+%H:%M:%S') hub exited with code $code, restarting in ${delay}s (see logs/hub.log if this keeps happening)" | tee -a logs/supervisor.log
  sleep "$delay"
done
