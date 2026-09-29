#!/usr/bin/env python3
"""Snapshot driver for the Worker bundle's gaps section.

Calls the authoritative queries.filing_gap(limit=...) once (one index load)
and emits the CLI-identical snapshot PLUS the full new-construction block list.

Why the extra list: the CLI hardcodes new_construction_sample to [:10] of all
new-construction blocks. The Worker engine must answer neighborhood-filtered
queries (count + top-10) exactly like the CLI, which needs the full list to
filter. The zero-filing `gaps` array is captured with a huge limit so it is
complete (SF has ~5.4k blocks; the zero-filing subset can never approach it),
making neighborhood-filtered counts exact.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from sfledger import queries  # noqa: E402
from sfledger import store as store_mod  # noqa: E402

LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 100000

snap = queries.filing_gap(limit=LIMIT)

# Full new-construction list, CLI's exact predicate and sort.
st = store_mod.get_store()
nc_all = []
for bnum, bev in st.blocks.items():
    if bev.filing_count > 0 and bev.year_built_pre1979 == 0 and bev.year_built_post1979 > 0:
        nc_all.append({
            "block_num": bnum,
            "neighborhoods": bev.neighborhoods,
            "filing_count": bev.filing_count,
            "year_built_min": bev.year_built_min,
            "year_built_max": bev.year_built_max,
        })
nc_all.sort(key=lambda g: (-g["filing_count"], g["block_num"]))

# Sanity: our full list's head must equal the CLI's 10-sample.
assert [g["block_num"] for g in nc_all[:10]] == [
    g["block_num"] for g in snap["new_construction_sample"]
], "new_construction predicate/sort drifted from the CLI"

snap["new_construction_all"] = nc_all
json.dump(snap, sys.stdout)
sys.stdout.write("\n")
