#!/bin/bash
# run_supervised.sh — keep a harvest going until it finishes or truly fails.
#
# Usage: run_supervised.sh <max_restarts> <logfile> <command...>
#
# Runs the command. On non-zero exit, waits 60s and relaunches (the harvesters
# resume from their page manifests, so restarts never redo completed pages).
# After <max_restarts> consecutive failures, writes a FAILURE marker next to
# the logfile and exits non-zero so the operator gets one clear alert.
#
# Barklee standing instruction 2026-09-29: "always make sure you're fixing and
# keeping this going" — harvests must self-recover from transient/session
# deaths, and only page a human when genuinely stuck.

set -u

MAX_RESTARTS="${1:?max_restarts required}"; shift
LOGFILE="${1:?logfile required}"; shift

if [ "$#" -eq 0 ]; then
  echo "run_supervised.sh: no command given" >&2
  exit 2
fi

# The log directory must exist before the first append (2026-09-29: Wave 3
# linkage died twice on a missing data/wave3/ dir — the redirect failed and
# the loop burned restarts sleeping).
mkdir -p "$(dirname "$LOGFILE")"

restarts=0
while true; do
  echo "=== supervised run attempt $((restarts + 1)) at $(date -u +%FT%TZ) ===" >> "$LOGFILE"
  # shellcheck disable=SC2068
  "$@" >> "$LOGFILE" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "=== supervised run SUCCEEDED at $(date -u +%FT%TZ) after $restarts restarts ===" >> "$LOGFILE"
    exit 0
  fi
  restarts=$((restarts + 1))
  echo "=== attempt failed rc=$rc; restarts used: $restarts/$MAX_RESTARTS ===" >> "$LOGFILE"
  if [ "$restarts" -ge "$MAX_RESTARTS" ]; then
    echo "FAILURE: command failed $MAX_RESTARTS times: $*" > "${LOGFILE}.FAILURE"
    echo "=== supervised run GAVE UP at $(date -u +%FT%TZ); marker: ${LOGFILE}.FAILURE ===" >> "$LOGFILE"
    exit 1
  fi
  sleep 60
done
