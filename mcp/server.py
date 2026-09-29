#!/usr/bin/env python3
"""sfledger MCP server — stdio JSON-RPC 2.0, thin shell over repo/sfledger.

Speaks newline-delimited JSON-RPC over stdin/stdout (MCP stdio transport).
Methods: initialize, notifications/initialized, tools/list, tools/call, ping.
The ledger store loads lazily on the first tools/call; load progress goes to
stderr so stdout stays pure protocol. Read-only: never writes to data/.
"""

import json
import os
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

SERVER_INFO = {"name": "sfledger", "version": "5.0.0"}

TOOLS = [
    {"name": "lookup_address",
     "description": "Look up a San Francisco address: EAS ids, linked parcel "
                    "(blklot), unit counts, and the Wave 3 confidence tier per match.",
     "inputSchema": {"type": "object",
                     "properties": {"address": {"type": "string",
                                               "description": "Free-text SF address, e.g. '329 FULTON ST'"}},
                     "required": ["address"]}},
    {"name": "lookup_parcel",
     "description": "Look up an assessor parcel: active/retired status, zoning, "
                    "neighborhood, linked addresses, and block-level filing counts.",
     "inputSchema": {"type": "object",
                     "properties": {"blklot": {"type": "string",
                                               "description": "blklot like '0189001A' or block/lot like '1753/001'"}},
                     "required": ["blklot"]}},
    {"name": "rent_control_evidence",
     "description": "Rent Board inventory filing evidence for an address or parcel. "
                    "Returns block-level filing rows (years, occupancy, rent buckets) "
                    "with an explicit disclaimer: evidence of filing activity, NOT a "
                    "legal rent-control determination.",
     "inputSchema": {"type": "object",
                     "properties": {"query": {"type": "string",
                                             "description": "SF address or blklot"}},
                     "required": ["query"]}},
    {"name": "filing_gap",
     "description": "Blocks with zero Rent Board inventory filings, ranked by "
                    "unit density (apartment-stock proxy). Optional neighborhood filter.",
     "inputSchema": {"type": "object",
                     "properties": {"neighborhood": {"type": "string"},
                                    "limit": {"type": "integer", "default": 20}}}},
    {"name": "coverage_report",
     "description": "Citywide coverage: parcels, addresses, blocks, unmatched queues, "
                    "and verification stats.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "wave_status",
     "description": "Per-wave build status: rows, sha256, retrieved_at, and "
                    "row-count reconciliation vs expected.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "explain",
     "description": "Provenance narrative for an address or parcel: why the record "
                    "is verified, uncertain, unmatched, or stale.",
     "inputSchema": {"type": "object",
                     "properties": {"query": {"type": "string",
                                             "description": "SF address or blklot"}},
                     "required": ["query"]}},
]


def _dispatch(name, args):
    from sfledger import queries
    args = args or {}
    if name == "lookup_address":
        return queries.lookup_address(args["address"])
    if name == "lookup_parcel":
        return queries.lookup_parcel(args["blklot"])
    if name == "rent_control_evidence":
        return queries.rent_control_evidence(args["query"])
    if name == "filing_gap":
        return queries.filing_gap(neighborhood=args.get("neighborhood"),
                                  limit=args.get("limit", 20))
    if name == "coverage_report":
        return queries.coverage_report()
    if name == "wave_status":
        return queries.wave_status()
    if name == "explain":
        return queries.explain(args["query"])
    raise ValueError(f"unknown tool: {name}")


def _ok(mid, result):
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _err(mid, code, message):
    return {"jsonrpc": "2.0", "id": mid,
            "error": {"code": code, "message": message}}


def main():
    stdin = sys.stdin
    stdout = sys.stdout
    tool_names = {t["name"] for t in TOOLS}
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue  # not a frame; ignore
        mid = msg.get("id")
        method = msg.get("method", "")
        try:
            if method == "initialize":
                stdout.write(json.dumps(_ok(mid, {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": SERVER_INFO})) + "\n")
            elif method == "notifications/initialized":
                pass  # notification: no response
            elif method == "ping":
                stdout.write(json.dumps(_ok(mid, {})) + "\n")
            elif method == "tools/list":
                stdout.write(json.dumps(_ok(mid, {"tools": TOOLS})) + "\n")
            elif method == "tools/call":
                params = msg.get("params", {})
                name = params.get("name")
                if name not in tool_names:
                    stdout.write(json.dumps(
                        _err(mid, -32602, f"unknown tool: {name}")) + "\n")
                else:
                    try:
                        result = _dispatch(name, params.get("arguments"))
                        stdout.write(json.dumps(_ok(mid, {
                            "content": [{"type": "text",
                                         "text": json.dumps(result, indent=2)}]})) + "\n")
                    except Exception as e:  # noqa: BLE001
                        traceback.print_exc(file=sys.stderr)
                        stdout.write(json.dumps(_ok(mid, {
                            "content": [{"type": "text",
                                         "text": json.dumps(
                                             {"error": type(e).__name__,
                                              "message": str(e)})}],
                            "isError": True})) + "\n")
            else:
                if mid is not None:
                    stdout.write(json.dumps(
                        _err(mid, -32601, f"method not found: {method}")) + "\n")
        except Exception as e:  # noqa: BLE001 — never break the stdio loop
            traceback.print_exc(file=sys.stderr)
            if mid is not None:
                stdout.write(json.dumps(
                    _err(mid, -32603, f"{type(e).__name__}: {e}")) + "\n")
        stdout.flush()


if __name__ == "__main__":
    main()
