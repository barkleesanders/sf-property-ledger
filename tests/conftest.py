"""Pytest guard: fail loudly instead of collecting nothing.

tests/test_wave5.py is a harness-style suite — its checks run at module
level via its own check() function and it defines no test_* functions,
so pytest collects 0 tests from it and a pytest run would prove
nothing. The canonical runner is stdlib-only (pytest is not
installable on the VM: PEP 668 blocks pip, apt has no candidate —
verified 2026-10-13; see tests/README.md).

This file is only ever loaded by pytest; the canonical runner ignores
it. If a real pytest suite is ever added, remove this guard in the
same commit that adds the first test_* functions.
"""

import pytest


def pytest_configure(config):
    raise pytest.UsageError(
        "This repo has no pytest suite: tests/test_wave5.py is a "
        "harness-style suite with no test_* functions, so pytest "
        "collects 0 tests. Run the canonical stdlib-only runner "
        "instead: python3 tests/run_tests.py (see tests/README.md)."
    )
