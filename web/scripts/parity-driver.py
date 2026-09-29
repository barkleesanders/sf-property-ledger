#!/usr/bin/env python3
"""Parity driver: run many sfledger queries in ONE process (one index load)
and print a JSON array of [name, result]. Used by parity-check.mts."""
import json
import sys
import os

# web/scripts/ -> web/ -> repo/ ; `sfledger` lives at the repo root.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from sfledger import queries  # noqa: E402

CASES = [
    ("addr_hudson", lambda: queries.lookup_address("890 HUDSON AVE")),
    ("addr_fulton", lambda: queries.lookup_address("329 FULTON ST")),
    ("addr_missing", lambda: queries.lookup_address("ZZZ NOT REAL ST 999")),
    ("addr_unit", lambda: queries.lookup_address("329 FULTON ST #101")),
    ("parcel_taylor", lambda: queries.lookup_parcel("0189001A")),
    ("parcel_slash", lambda: queries.lookup_parcel("1753/001")),
    ("parcel_missing", lambda: queries.lookup_parcel("9999/999")),
    ("rc_hudson", lambda: queries.rent_control_evidence("890 HUDSON AVE")),
    ("rc_taylor", lambda: queries.rent_control_evidence("0189001A")),
    ("rc_missing", lambda: queries.rent_control_evidence("ZZZ NOT REAL ST 999")),
    ("gaps20", lambda: queries.filing_gap(limit=20)),
    ("gaps_mission", lambda: queries.filing_gap(neighborhood="Mission", limit=10)),
    ("coverage", lambda: queries.coverage_report()),
    ("waves", lambda: queries.wave_status()),
    ("explain_taylor", lambda: queries.explain("0189001A")),
    ("explain_hudson", lambda: queries.explain("890 HUDSON AVE")),
    ("explain_missing", lambda: queries.explain("ZZZ NOT REAL ST 999")),
]

out = []
for name, fn in CASES:
    try:
        out.append([name, fn()])
    except Exception as e:  # noqa: BLE001
        out.append([name, {"error": type(e).__name__, "message": str(e)}])
json.dump(out, sys.stdout)
sys.stdout.write("\n")
