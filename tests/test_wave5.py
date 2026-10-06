#!/usr/bin/env python3
"""Wave 5 tests — run against the REAL ledger indexes (no mocks).

Usage:  python3 repo/tests/test_wave5.py
Exit 0 = all pass. The store loads once (~17s); keep additions cheap.
"""

import hashlib
import json
import os
import subprocess
import sys
import time

REPO = os.path.join(os.path.expanduser("~"),
                    "workspace/goals/sf-property-verification-ledger/repo")
sys.path.insert(0, REPO)

from sfledger import queries  # noqa: E402
from sfledger.models import RC_DISCLAIMER  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("PASS" if cond else "FAIL"), name, detail)
    if not cond:
        FAILURES.append(name)


def prov_ok(d):
    p = d.get("provenance", {})
    ds = p.get("datasets", [])
    return (len(ds) == 4 and all("snapshot_sha256_16" in x for x in ds)
            and bool(p.get("generated_at")))


# ------------------------------------------------------------- known fixtures

t0 = time.time()
r = queries.lookup_address("329 FULTON ST")
check("address t-block found", r["found"])
check("address tiers wave3", r["tiers_present"] == ["verified_parcel_key"],
      str(r["tiers_present"]))
blklots = {m["parcel"]["blklot"] for m in r["matches"] if m["parcel"]}
check("address t-block parcels", all(b.startswith("0792T") for b in blklots),
      f"{len(blklots)} blklots")
check("address provenance", prov_ok(r))

r = queries.lookup_parcel("0189001A")
p = r["parcel"]
check("parcel found", r["found"] and p["blklot"] == "0189001A")
check("parcel active", p["active"] is True)
check("parcel neighborhood", p["analysis_neighborhood"] == "Nob Hill")
check("parcel address", r["addresses"]["base_addresses_sample"] == ["1355 TAYLOR ST"],
      str(r["addresses"]["base_addresses_sample"]))
check("parcel block filings labeled", r["block_filings"]["scope"] == "block-level only"
      and r["block_filings"]["filing_count"] == 452)
check("parcel provenance", prov_ok(r))

# slash-form normalization resolves the same parcel
r2 = queries.lookup_parcel("0189/001A")
check("parcel slash form", r2["found"] and r2["parcel"]["blklot"] == "0189001A")

# ------------------------------------------------------- hard semantic rules

r = queries.rent_control_evidence("329 FULTON ST")
check("rc disclaimer verbatim", r.get("disclaimer") == RC_DISCLAIMER)
check("rc tier reported", r.get("tier") == "reported")
check("rc block scope", r["block"]["scope"] == "block-level filing evidence only")
blk = r["block"]
check("rc block payload has no parcel/address keys",
      not any(k in blk for k in ("blklot", "parcel_number", "eas_fullid", "address")))
check("rc provenance", prov_ok(r))

r = queries.rent_control_evidence("0189001A")
check("rc parcel query", r["found"] and r["resolved"]["blklot"] == "0189001A"
      and r["disclaimer"] == RC_DISCLAIMER)

g = queries.filing_gap(limit=5)
check("gaps total sane", g["zero_filing_blocks_total"] > 1000,
      str(g["zero_filing_blocks_total"]))
check("gaps tier gap", all(x["tier"] == "gap" for x in g["gaps"]))
check("gaps ranked desc", all(g["gaps"][i]["gap_score"] >= g["gaps"][i + 1]["gap_score"]
                              for i in range(len(g["gaps"]) - 1)))
check("gaps limitation honest", "pre-1979" in g["limitation"] and "cannot be verified"
      in g["limitation"])
check("gaps disclaimer", g["disclaimer"] == RC_DISCLAIMER)

gn = queries.filing_gap(neighborhood="Nob Hill", limit=3)
check("gaps neighborhood filter",
      all(any("nob hill" in n.lower() for n in x["neighborhoods"]) for x in gn["gaps"]),
      str([x["block_num"] for x in gn["gaps"]]))

c = queries.coverage_report()
check("coverage crosscheck agrees", c["denominator_crosscheck"]["agree"] is True)
check("coverage pct sane",
      abs(c["parcels"]["pct_active_with_verified_address"] - 91.6) < 0.05)
check("coverage tiers present",
      c["unmatched_queues"]["no_parcel_key"] == 120242
      and c["unmatched_queues"]["orphan_parcel_numbers"] == 1029)
check("0253T gap derived from audit (not hardcoded)",
      c["unmatched_queues"]["tblock_0253T_gap_addresses"] == 1004)

# ---- edge cases: retired parcels, orphan identifiers, T-blocks ----
rt = queries.lookup_parcel("3537059")
check("retired parcel found+inactive",
      rt["found"] is True and rt["parcel"]["active"] is False
      and rt["parcel"]["blklot"] == "3537059")
re_ = queries.explain("3537059")
check("retired parcel explain caveat",
      any("Retired parcels" in x for x in re_["caveats"]),
      str(re_["caveats"]))

oa = queries.lookup_address("1501 GREAT HWY")
check("orphan parcel_number tier",
      oa["found"] is True and "unmatched_orphan" in oa["tiers_present"],
      str(oa["tiers_present"]))

tb = queries.lookup_parcel("0452T044H")
check("t-block parcel found",
      tb["found"] is True and tb["parcel"]["block_num"] == "0452T")
tbrc = queries.rent_control_evidence("0452T044H")
check("t-block rc resolves block-level",
      tbrc["found"] is True
      and tbrc["resolved"]["block_num"] == "0452T"
      and tbrc["block"]["scope"] == "block-level filing evidence only")

w = queries.wave_status()
w1 = w["waves"][0]["datasets"][0]
# 2026-09-29 REPAIR 1 reconciled the +114 drift through the harvester
# (expected_rows 551244 -> 551358); the honest post-repair state is zero
# drift, matched. Pin it so any future drift regression is caught.
check("wave1 drift reconciled honestly",
      w1["rows_match_expected"] is True and w1["row_drift"] == 0
      and w1["rows"] == 551358 and w1["expected_rows"] == 551358,
      f"rows={w1['rows']} expected={w1['expected_rows']}")
check("wave1 note reflects reconciled state",
      "expected_rows is stale" not in w["waves"][0]["note"]
      and "reconciled" in w["waves"][0]["note"]
      and "CURRENT DRIFT" not in w["waves"][0]["note"],
      w["waves"][0]["note"][:90])
check("wave2 reconciled",
      all(d["rows_match_expected"] for d in w["waves"][1]["datasets"]))
check("wave5 complete", w["waves"][4]["status"] == "complete"
      and bool(w["waves"][4]["build_finished_at"]))

e = explain_ = queries.explain("1000 PINE ST #3052 O")
check("explain orphan caveat",
      any("0253T" in x for x in explain_["caveats"]),
      str(explain_["caveats"]))
check("explain disclaimer", explain_["disclaimer"] == RC_DISCLAIMER)

r = queries.lookup_address("ZZZQQQ NOT A STREET 999")
check("not-found shape",
      r["found"] is False and isinstance(r["suggestions"], list))

print(f"query tests took {time.time() - t0:.1f}s (incl. store load)")

# ------------------------------------------------------------- CLI: all seven

CLI = os.path.join(REPO, "cli", "sfledger")
CMDS = [
    ["address", "329 FULTON ST"],
    ["parcel", "0189001A"],
    ["rc", "329 FULTON ST"],
    ["gaps", "--limit", "3"],
    ["coverage"],
    ["waves"],
    ["explain", "0189001A"],
]
for cmd in CMDS:
    t0 = time.time()
    pr = subprocess.run([CLI] + cmd, capture_output=True, text=True, timeout=180)
    try:
        d = json.loads(pr.stdout)
        ok = pr.returncode == 0 and isinstance(d, dict)
    except json.JSONDecodeError:
        ok = False
    check("cli " + " ".join(cmd[:2]), ok, f"{time.time() - t0:.0f}s rc={pr.returncode}")

# ------------------------------------------------------------- MCP: list+call

t0 = time.time()
frames = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
     "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "t", "version": "0"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
     "params": {"name": "rent_control_evidence",
                "arguments": {"query": "0189001A"}}},
]
inp = "".join(json.dumps(f) + "\n" for f in frames)
pr = subprocess.run([sys.executable, os.path.join(REPO, "mcp", "server.py")],
                    input=inp, capture_output=True, text=True, timeout=240)
outs = {}
for line in pr.stdout.splitlines():
    try:
        m = json.loads(line)
    except json.JSONDecodeError:
        continue
    if "id" in m and "result" in m:
        outs[m["id"]] = m["result"]
tools = [t["name"] for t in outs.get(2, {}).get("tools", [])]
check("mcp tools/list 7 tools", len(tools) == 7, str(tools))
d = json.loads(outs[3]["content"][0]["text"])
check("mcp rc call", d["found"] and d["disclaimer"] == RC_DISCLAIMER
      and d["block"]["scope"] == "block-level filing evidence only")
print(f"mcp test took {time.time() - t0:.0f}s")

# ------------------------------------------------------------- read-only data

# Wave 5 must never rewrite the Waves 1-4 snapshots it reads: the snapshot
# bytes hashed at index-build time must be unchanged. Content-hash, not
# mtime — the 2026-09-29 REPAIR 1 (wave1 manifest refresh) and REPAIR 2
# (wave4 audit rerun) legitimately touched manifests/logs after the index
# build without changing any snapshot row the indexes were built from; an
# mtime guard cannot tell a legitimate repair from a silent rewrite.
bm = queries.get_store().build_manifest
for name, spec in sorted(bm.get("inputs", {}).items()):
    h = hashlib.sha256()
    with open(spec["path"], "rb") as f:
        for chunk in iter(lambda: f.read(8 << 20), b""):
            h.update(chunk)
    check(f"input snapshot unchanged: {name}", h.hexdigest() == spec["sha256"],
          f"{spec['path']} pinned={spec['sha256'][:16]}...")

print()
if FAILURES:
    print("FAILURES:", FAILURES)
    sys.exit(1)
print("ALL WAVE5 TESTS PASS")
