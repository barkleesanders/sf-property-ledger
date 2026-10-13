#!/usr/bin/env python3
"""Canonical test runner for the SF property ledger (stdlib only).

This is the official way to run the Python test suites:

    python3 tests/run_tests.py            # all suites
    python3 tests/run_tests.py wave5      # only the Wave 5 suite
    python3 tests/run_tests.py supervisor # only the supervisor shell test

Why not pytest? Decided 2026-10-13 (see tests/README.md and
docs/IMPROVEMENTS.md):

- tests/test_wave5.py is a harness-style suite: its checks execute at
  module level through its own check() function and it contains no
  test_* functions, so pytest collects 0 tests from it. A pytest run
  therefore proves nothing about the ledger.
- pytest is not reliably installable in the environments this repo
  runs in: on the VM, `pip install pytest` is blocked by PEP 668
  (externally-managed environment) and `apt-cache policy
  python3-pytest` shows no candidate at all (both verified
  2026-10-13). The repo's harvesters are stdlib-only for the same
  reason; the test runner follows the same rule.
- tests/conftest.py makes any pytest invocation fail loudly with a
  pointer here, instead of collecting nothing.

Exit code is 0 only if every selected suite passes. Suite output is
streamed live (the Wave 5 suite takes ~3-4 minutes: each of its 7 CLI
checks respawns the CLI, which reloads the ~98MB indexes).
"""

import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SUITES = {
    "wave5": [sys.executable, str(REPO / "tests" / "test_wave5.py")],
    "supervisor": ["bash", str(REPO / "harvest" / "tests" / "test_supervisor_logdir.sh")],
}


def main(argv):
    names = argv[1:] or list(SUITES)
    unknown = [n for n in names if n not in SUITES]
    if unknown:
        print(f"unknown suite(s): {', '.join(unknown)}; "
              f"choose from: {', '.join(SUITES)}", file=sys.stderr)
        return 2
    failures = []
    for name in names:
        cmd = SUITES[name]
        print(f"=== suite {name}: {' '.join(cmd)}", flush=True)
        t0 = time.time()
        rc = subprocess.run(cmd, cwd=REPO).returncode
        elapsed = time.time() - t0
        print(f"=== suite {name}: {'PASS' if rc == 0 else 'FAIL'} "
              f"(exit {rc}, {elapsed:.1f}s)\n", flush=True)
        if rc != 0:
            failures.append(name)
    if failures:
        print("FAILING SUITES:", ", ".join(failures))
        return 1
    print("ALL SUITES PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
