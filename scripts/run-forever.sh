#!/usr/bin/env bash
# Keeps the hub running all day: if the process ever exits, it is restarted after a second.
# Usage: ./scripts/run-forever.sh      (from the project folder; Ctrl+C stops the loop)
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
trap 'echo "stopping"; exit 0' INT TERM
while true; do
  echo "$(date '+%H:%M:%S') starting hub" | tee -a logs/supervisor.log
  node scripts/start.mjs
  code=$?
  echo "$(date '+%H:%M:%S') hub exited with code $code, restarting in 1s" | tee -a logs/supervisor.log
  sleep 1
done
