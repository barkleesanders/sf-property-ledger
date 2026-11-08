#!/usr/bin/env python3
"""Filing canonical-ID tests (fleet id-census C-3) — fixture-based.

Proves, against tiny synthetic snapshots run through the REAL builder
(sfledger/build_indexes.py), that a Rent Board filing's canonical
unique_id now survives the pipeline:

  - every filing with a unique_id is retained in filings.idx.json,
    keyed by that unique_id (ingest -> index), including a filing whose
    block_num is missing;
  - the store loads the index and find_filing / queries.filing_by_id
    retrieve a filing by its ID (index -> store -> read);
  - the per-block sample is a deterministic function of the filings'
    unique_ids (the SAMPLE_N smallest), identical for two different
    harvest stream orders of the same snapshot — not a position-chosen
    first-3 (the two orders below preserve only the relative order of
    the duplicate-id pair and of the unidentified rows, whose
    resolution rules are explicitly stream-relative: first duplicate
    wins; unidentified fill in stream order);
  - a duplicate unique_id keeps the first occurrence and is counted;
    filings without a unique_id are counted, stay in the block
    aggregates, and fill sample slots only when fewer than SAMPLE_N
    identified filings exist for the block.

Usage:  python3 repo/tests/test_filing_ids.py
Exit 0 = all pass.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FAILURES = []


def check(name, cond, detail=""):
    print(("PASS" if cond else "FAIL"), name, detail)
    if not cond:
        FAILURES.append(name)


def F(uid, block, year, **kw):
    d = {"unique_id": uid, "block_num": block, "submission_year": year,
         "case_type_name": "Inventory", "occupancy_type": "Residential",
         "monthly_rent": "1000-1499", "bedroom_count": "2",
         "year_property_built": "1920", "block_address": "1 MAIN ST"}
    d.update(kw)
    return d


# 13 filings. Block 0001 has 6 distinct ids + 1 duplicate + 1 unidentified;
# block 0002 one filing; block 0003 one identified + two unidentified;
# one identified filing has no block at all.
R = {
    "105": F("105", "0001", "2020"), "9": F("9", "0001", "2021"),
    "42a": F("42", "0001", "2022"), "1000": F("1000", "0001", "2023"),
    "77": F("77", "0001", "2024"), "42b": F("42", "0001", "1999"),
    "ZZ": F("ZZ-9", "0001", "2019"), "noid1": F(None, "0001", "2018"),
    "5": F("5", "0002", "2020"), "3": F("3", "0003", "2020"),
    "u1": F(None, "0003", "2017"), "u2": F(None, "0003", "2016"),
    "nb": F("7777", "", "2020"),
}
ORDER_A = ["105", "9", "42a", "1000", "77", "42b", "ZZ", "noid1",
           "5", "3", "u1", "u2", "nb"]
ORDER_B = ["nb", "u1", "3", "u2", "5", "ZZ", "42a", "77", "9", "42b",
           "noid1", "1000", "105"]

PARCELS = [{"blklot": "0001001", "block_num": "0001", "lot_num": "001",
            "active": True, "street_name": "MAIN", "street_type": "ST",
            "from_address_num": "1", "to_address_num": "99",
            "zoning_code": "RH-1", "zoning_district": "Residential",
            "analysis_neighborhood": "Testville",
            "centroid_latitude": "37.7", "centroid_longitude": "-122.4"}]
EAS = [{"eas_fullid": "E1", "eas_baseid": "B1", "address": "1 MAIN ST",
        "parcel_number": "0001001", "block": "0001", "lot": "001",
        "latitude": "37.7", "longitude": "-122.4"}]
LINKAGE = [{"eas_fullid": "E1", "tier": "verified_parcel_key",
            "tier_reason": "fixture", "blklot": "0001001",
            "parcel_active": True}]


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def build_tree(tmp):
    tmprepo = os.path.join(tmp, "repo")
    shutil.copytree(os.path.join(REPO, "sfledger"),
                    os.path.join(tmprepo, "sfledger"),
                    ignore=shutil.ignore_patterns("indexes", "__pycache__"))
    data = os.path.join(tmp, "data")
    write_jsonl(os.path.join(data, "wave2", "8jwb-2stv.snapshot.jsonl"), PARCELS)
    write_jsonl(os.path.join(data, "wave2", "ramy-di5m.snapshot.jsonl"), EAS)
    write_jsonl(os.path.join(data, "wave3", "linkage.jsonl"), LINKAGE)
    return tmprepo, data


def run_builder(tmprepo, data):
    env = dict(os.environ, SFLEDGER_DATA_DIR=data)
    return subprocess.run(
        [sys.executable, os.path.join(tmprepo, "sfledger", "build_indexes.py")],
        capture_output=True, text=True, env=env)


def load_idx(tmprepo, name):
    with open(os.path.join(tmprepo, "sfledger", "indexes", name),
              encoding="utf-8") as f:
        return json.load(f)


def main():
    tmp = tempfile.mkdtemp(prefix="sfpl-filingids-")
    try:
        tmprepo, data = build_tree(tmp)
        rentb = os.path.join(data, "wave1", "gdc7-dmcn.snapshot.jsonl")

        write_jsonl(rentb, [R[k] for k in ORDER_A])
        p = run_builder(tmprepo, data)
        check("builder runs on fixtures (order A)", p.returncode == 0,
              p.stderr.strip().splitlines()[-1] if p.returncode else "")
        if p.returncode != 0:
            return 1
        blocks_a = load_idx(tmprepo, "blocks.idx.json")
        filings_a = load_idx(tmprepo, "filings.idx.json")
        manifest_a = load_idx(tmprepo, "manifest.json")

        write_jsonl(rentb, [R[k] for k in ORDER_B])
        p = run_builder(tmprepo, data)
        check("builder runs on fixtures (order B)", p.returncode == 0,
              p.stderr.strip().splitlines()[-1] if p.returncode else "")
        if p.returncode != 0:
            return 1
        blocks_b = load_idx(tmprepo, "blocks.idx.json")
        filings_b = load_idx(tmprepo, "filings.idx.json")

        # ---- filings index: every identified filing survives, keyed by id
        check("filings index keyed by unique_id",
              set(filings_a) == {"105", "9", "42", "1000", "77", "ZZ-9",
                                 "5", "3", "7777"},
              f"{len(filings_a)} entries")
        check("duplicate unique_id keeps first occurrence",
              filings_a["42"][1] == "2022", str(filings_a["42"]))
        check("block-less filing still indexed by unique_id",
              filings_a["7777"][0] == "", str(filings_a["7777"]))
        check("filing row carries its block",
              filings_a["9"][0] == "0001" and filings_a["5"][0] == "0002")

        # ---- manifest stats make the losses visible, not silent
        rb = manifest_a.get("rentboard", {})
        check("manifest rentboard stats",
              rb.get("rows") == 13 and rb.get("filings_indexed") == 9
              and rb.get("filings_without_unique_id") == 3
              and rb.get("duplicate_unique_ids") == 1
              and rb.get("filings_without_block") == 1
              and "unique_id" in rb.get("sample_rule", ""),
              json.dumps(rb))

        # ---- deterministic sample: smallest unique_ids, order-independent
        check("blocks identical across stream orders", blocks_a == blocks_b)
        check("filings identical across stream orders", filings_a == filings_b)
        s1 = [sf["unique_id"] for sf in blocks_a["0001"]["sample_filings"]]
        check("block 0001 sample = 3 smallest unique_ids", s1 == ["9", "42", "77"],
              str(s1))
        check("block 0001 aggregate counts all 8 filings",
              blocks_a["0001"]["filing_count"] == 8)
        s3 = [(sf["unique_id"], sf["submission_year"])
              for sf in blocks_a["0003"]["sample_filings"]]
        check("block 0003 sample fills with unidentified filings",
              s3 == [("3", "2020"), (None, "2017"), (None, "2016")], str(s3))
        check("block 0002 sample is its only filing",
              [sf["unique_id"] for sf in blocks_a["0002"]["sample_filings"]] == ["5"])

        # ---- store + queries: the ID is a working read path
        snippet = (
            "import json, os, sys\n"
            "sys.path.insert(0, os.getcwd())\n"
            "from sfledger.store import LedgerStore\n"
            "from sfledger import queries\n"
            "s = LedgerStore()\n"
            "assert s.filings_index_loaded\n"
            "f = s.find_filing('42')\n"
            "assert f and f['block_num'] == '0001' "
            "and f['submission_year'] == '2022', f\n"
            "assert s.find_filing(9)['unique_id'] == '9'\n"
            "assert s.find_filing('nope') is None\n"
            "assert s.find_filing(None) is None\n"
            "r = queries.filing_by_id('77')\n"
            "assert r['found'] and r['filing']['block_num'] == '0001', r\n"
            "assert len(r['provenance']['datasets']) == 4\n"
            "assert not queries.filing_by_id('nope')['found']\n"
            "bev = s.block_evidence('0001')\n"
            "assert [x['unique_id'] for x in bev.sample_filings] "
            "== ['9', '42', '77']\n"
            "print('STORE-OK')\n"
        )
        env = dict(os.environ, SFLEDGER_DATA_DIR=data)
        p = subprocess.run([sys.executable, "-c", snippet], cwd=tmprepo,
                           capture_output=True, text=True, env=env)
        check("store find_filing + queries.filing_by_id round-trip",
              p.returncode == 0 and "STORE-OK" in p.stdout,
              (p.stderr.strip().splitlines() or [""])[-1])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
