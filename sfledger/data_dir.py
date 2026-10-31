#!/usr/bin/env python3
"""Shared resolution of the Wave 1-4 data directory (snapshots + manifests).

The data snapshots (~1.1GB) genuinely live OUTSIDE the repo and are never
committed, so there is no in-repo location to derive them from (unlike the
Wave 5 indexes, which store.py locates inside the repo). Before 2026-10-31
both queries.py and build_indexes.py hardcoded the VM goal root, so on any
other clone (e.g. the Mini canonical clone) the data reads silently
degraded: _load_json swallowed OSError and coverage / wave-status came
back empty instead of failing loudly.

Resolution order (first match wins):
  1. $SFLEDGER_DATA_DIR — explicit override; used even if it does not
     exist yet, so callers can surface the exact missing path.
  2. A sibling ``data/`` directory next to the repo (the VM goal layout:
     <goal-root>/repo + <goal-root>/data; also the natural layout for a
     clone placed beside a data checkout).
  3. The VM default goal-root data directory, if it exists.
  4. Fallback: the sibling ``data/`` path (missing) — returned so error
     messages point at the expected location, with exists=False.

The chosen directory, its source, and whether it exists are surfaced in
query provenance (see queries._provenance) so a degraded read is visible
instead of silent.
"""

import os

# Repo root derived from this file's location (repo/sfledger/data_dir.py),
# same pattern as store.py / tests/test_wave5.py.
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The VM's canonical layout — a fallback only, isolated in this one module
# so no other file needs to embed the VM goal path.
VM_DEFAULT_DATA_DIR = os.path.expanduser(
    "~/workspace/goals/sf-property-verification-ledger/data")


class DataDirNotFound(FileNotFoundError):
    """Raised when a query needs the data directory but it does not exist."""


def data_dir_info(repo_dir=None, environ=None):
    """Return {"data_dir", "source", "exists"} for the resolved data dir."""
    env = os.environ if environ is None else environ
    override = env.get("SFLEDGER_DATA_DIR")
    if override:
        path = os.path.abspath(os.path.expanduser(override))
        return {"data_dir": path, "source": "env:SFLEDGER_DATA_DIR",
                "exists": os.path.isdir(path)}
    repo = repo_dir or REPO_DIR
    sibling = os.path.join(os.path.dirname(repo), "data")
    if os.path.isdir(sibling):
        return {"data_dir": sibling, "source": "sibling:data-next-to-repo",
                "exists": True}
    if os.path.isdir(VM_DEFAULT_DATA_DIR):
        return {"data_dir": VM_DEFAULT_DATA_DIR, "source": "vm-default",
                "exists": True}
    return {"data_dir": sibling, "source": "default:sibling-data",
            "exists": False}


def resolve_data_dir(repo_dir=None, environ=None):
    return data_dir_info(repo_dir=repo_dir, environ=environ)["data_dir"]


def require_data_dir(repo_dir=None, environ=None):
    """Resolved data dir, or DataDirNotFound with remediation if missing."""
    info = data_dir_info(repo_dir=repo_dir, environ=environ)
    if not info["exists"]:
        raise DataDirNotFound(
            f"SF ledger data directory not found: {info['data_dir']} "
            f"(resolved via {info['source']}). The Wave 1-4 snapshots live "
            "outside the repo and are never committed. Point "
            "SFLEDGER_DATA_DIR at a data/ directory containing "
            "wave1/..wave4/, or place data/ next to the repo clone.")
    return info["data_dir"]
