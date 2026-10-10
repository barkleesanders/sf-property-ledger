#!/usr/bin/env python3
"""Persistent sfledger query daemon for the web dev server (Wave 5b).

The Wave 5a CLI reloads the ~98MB Wave 5 indexes on every invocation
(~30s cold). This daemon loads them ONCE and answers newline-delimited
JSON requests on stdin, so the dev server's ServiceAdapter pays the load
cost a single time per dev-server lifetime instead of on every cache miss.

Protocol (one JSON object per line, UTF-8):
  request:  {"id": <int>, "cmd": "<subcommand>", "args": {...}}
  response: {"id": <int>, "ok": true, "result": {...}}
            {"id": <int>, "ok": false, "error": {"type": ..., "message": ...}}

Commands mirror cli/sfledger exactly (address, parcel, rc, gaps, coverage,
waves, explain). Results are the same objects the CLI emits — the CLI is a
thin shell over sfledger.queries, and this daemon calls the same functions
directly, so outputs are identical by construction. web/scripts/
test-cli-daemon.mjs verifies this parity explicitly.

Lifecycle: exits quietly on stdin EOF (the parent's death closes the
pipe, so no orphaned daemon). Prints "READY" to stderr once the store is
warm. A request that raises returns ok:false; the daemon keeps serving.

Read-only: never writes to data/. Dev-server only — production Workers
serve the precomputed R2 bundle and never touch this file.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", ".."))

from sfledger import queries  # noqa: E402
from sfledger.store import get_store  # noqa: E402


def handle(cmd, args):
    """Dispatch one request. Mirrors cli/sfledger's argparse defaults."""
    if cmd == "address":
        return queries.lookup_address(args["address"])
    if cmd == "parcel":
        return queries.lookup_parcel(args["blklot"])
    if cmd == "rc":
        return queries.rent_control_evidence(args["query"])
    if cmd == "gaps":
        return queries.filing_gap(neighborhood=args.get("neighborhood"),
                                  limit=int(args.get("limit", 20)))
    if cmd == "coverage":
        return queries.coverage_report()
    if cmd == "waves":
        return queries.wave_status()
    if cmd == "explain":
        return queries.explain(args["query"])
    raise ValueError("unknown command: %r" % (cmd,))


def respond(req_id, ok, payload):
    if ok:
        resp = {"id": req_id, "ok": True, "result": payload}
    else:
        resp = {"id": req_id, "ok": False, "error": payload}
    sys.stdout.write(json.dumps(resp) + "\n")
    sys.stdout.flush()


def main():
    # Warm the store before taking requests so the first request is fast.
    # (Same ~30s one-time cost the CLI pays per invocation.)
    get_store()
    sys.stderr.write("cli-daemon READY\n")
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:  # noqa: BLE001 — malformed line, stay alive
            respond(None, False,
                    {"type": type(e).__name__, "message": "invalid JSON: %s" % e})
            continue
        req_id = req.get("id")
        try:
            result = handle(req["cmd"], req.get("args", {}))
        except Exception as e:  # noqa: BLE001 — per-request errors stay in-band
            respond(req_id, False,
                    {"type": type(e).__name__, "message": str(e)})
        else:
            respond(req_id, True, result)
    # stdin EOF: parent is gone; exit quietly.
    return 0


if __name__ == "__main__":
    sys.exit(main())
