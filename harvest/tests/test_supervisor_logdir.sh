#!/bin/bash
# test_supervisor_logdir.sh — proves run_supervised.sh auto-creates a missing
# nested log directory before first use, and that the supervised command's
# output lands in the log.
#
# Case 1 (positive): a deeply nested nonexistent log path + a trivial command
#   -> supervisor exits 0, the directory tree exists, the log file exists and
#   contains both the attempt header and the command's output.
# Case 2 (negative): a failing command (max_restarts=1, so no 60s sleeps)
#   -> supervisor exits non-zero, but the log and attempt header are still
#   written, and a .FAILURE marker appears next to the log.
#
# This test CAN fail: if the mkdir -p line is removed from run_supervised.sh,
# case 1 exits non-zero with no log file (the first >> redirect dies on the
# missing directory).
set -u

SUP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/run_supervised.sh"
[ -x "$SUP" ] || { echo "FAIL: supervisor not found at $SUP" >&2; exit 1; }

fail() { echo "FAIL: $1" >&2; exit 1; }

TS=$(date +%s)
ROOT="/tmp/sup-test-${TS}"
[ -e "$ROOT" ] && fail "precondition violated: $ROOT already exists"
trap 'rm -rf "$ROOT"' EXIT

# ---------- case 1: missing nested dir, successful command ----------
LOG="$ROOT/a/b/c/run.log"
bash "$SUP" 2 "$LOG" echo "hello-from-supervised"
rc=$?
[ "$rc" -eq 0 ] || fail "case 1: expected exit 0, got $rc"
[ -f "$LOG" ] || fail "case 1: log file was not created at $LOG"
grep -q "hello-from-supervised" "$LOG" || fail "case 1: command output missing from log"
grep -q "supervised run attempt 1" "$LOG" || fail "case 1: attempt header missing from log"
grep -q "SUCCEEDED" "$LOG" || fail "case 1: success marker missing from log"
echo "PASS case 1: nested log dir auto-created; output + headers in log"

# ---------- case 2 (negative): failing command still logs ----------
LOG2="$ROOT/d/e/f/fail.log"
bash "$SUP" 1 "$LOG2" bash -c 'echo boom-to-log; exit 3'
rc=$?
[ "$rc" -ne 0 ] || fail "case 2: expected non-zero exit for failing command, got 0"
[ -f "$LOG2" ] || fail "case 2: log file was not created for failing command"
grep -q "boom-to-log" "$LOG2" || fail "case 2: failing command output missing from log"
grep -q "supervised run attempt 1" "$LOG2" || fail "case 2: attempt header missing from failing log"
grep -q "GAVE UP" "$LOG2" || fail "case 2: give-up marker missing from failing log"
[ -f "${LOG2}.FAILURE" ] || fail "case 2: FAILURE marker not written next to log"
echo "PASS case 2: failing command still produces log + attempt header + FAILURE marker"

echo "ALL SUPERVISOR TESTS PASSED"
