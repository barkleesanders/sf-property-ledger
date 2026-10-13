# Tests

## Canonical runner (the standard, decided 2026-10-13)

```bash
python3 tests/run_tests.py              # all Python suites (~3-4 min)
python3 tests/run_tests.py wave5        # Wave 5 suite only
python3 tests/run_tests.py supervisor   # supervisor log-dir shell test only
```

Exit 0 means every selected suite passed. The runner is stdlib-only
and streams each suite's output live.

Suites:

- `wave5` — `tests/test_wave5.py`: harness-style checks against the
  real ledger indexes (no mocks): query semantics, all 7 CLI
  subcommands (each respawn reloads the ~98MB indexes, which is why
  the suite takes minutes), MCP list+call, and a content-hash guard
  that the Wave 1–4 snapshots are unchanged. It can also be run
  directly: `python3 tests/test_wave5.py`.
- `supervisor` — `harvest/tests/test_supervisor_logdir.sh`: proves
  `harvest/run_supervised.sh` creates a missing nested log directory,
  including the negative/failure-marker case.

Web tests are separate and unchanged: `cd web && npm test`
(faq suite) and `npm run test:daemon` (daemon parity).

## Why not pytest

`python3 -m pytest tests/ -q` is **not** a valid gate for this repo:

- `test_wave5.py` defines no `test_*` functions — its checks execute
  at module level through its own `check()` harness — so pytest
  collects 0 tests and its verdict proves nothing.
- pytest is not reliably available where this repo runs. Verified
  2026-10-13 on the VM: `python3 -m pytest` → "No module named
  pytest"; `pip install pytest` → blocked by PEP 668
  (externally-managed environment); `apt-cache policy
  python3-pytest` → no candidate. (The Mini happens to have pytest
  9.1.1 for its Python 3.13 — an environment accident, not a repo
  guarantee.)
- The repo is stdlib-only by design (same rule as the harvesters),
  so the test standard is too.

`tests/conftest.py` enforces this: any pytest invocation aborts with
a usage error pointing at the canonical runner, rather than
collecting nothing and looking like a result. Remove that guard only
in a commit that adds real `test_*` functions.
