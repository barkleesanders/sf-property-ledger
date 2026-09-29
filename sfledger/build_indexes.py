#!/usr/bin/env python3
"""Wave 5: build compact derived indexes from Wave 1-4 snapshots.

Streams the raw JSONL snapshots ONCE and writes compact positional JSON
indexes to repo/sfledger/indexes/. The service layer (store.py) loads these in seconds
instead of re-streaming ~1.2GB per process.

Outputs (read-only w.r.t. existing data — these are NEW derived files):
  repo/sfledger/indexes/parcels.idx.json   [blklot, block_num, lot_num, active, street_name,
                                 street_type, from_n, to_n, zoning_code,
                                 zoning_district, analysis_neighborhood, lat, lon]
  repo/sfledger/indexes/eas.idx.json       [eas_fullid, eas_baseid, address, parcel_number,
                                 block, lot, tier, blklot, parcel_active,
                                 lat, lon, is_unit]
  repo/sfledger/indexes/blocks.idx.json    {block_num: {filing aggregates + EAS/parcel counts}}
  repo/sfledger/indexes/manifest.json      input sha256s, row counts, timings

stdlib only. Run: python3 repo/sfledger/build_indexes.py
"""

import hashlib
import json
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE = os.path.expanduser("~/workspace/goals/sf-property-verification-ledger")
REPO_DIR = os.path.join(BASE, "repo")
W1 = os.path.join(BASE, "data/wave1")
W2 = os.path.join(BASE, "data/wave2")
W3 = os.path.join(BASE, "data/wave3")
OUT = os.path.join(REPO_DIR, "sfledger", "indexes")

PARCELS = os.path.join(W2, "8jwb-2stv.snapshot.jsonl")
EAS = os.path.join(W2, "ramy-di5m.snapshot.jsonl")
LINKAGE = os.path.join(W3, "linkage.jsonl")
RENTB = os.path.join(W1, "gdc7-dmcn.snapshot.jsonl")

PARCEL_FIELDS = ["blklot", "block_num", "lot_num", "active", "street_name",
                 "street_type", "from_n", "to_n", "zoning_code",
                 "zoning_district", "analysis_neighborhood", "lat", "lon"]
EAS_FIELDS = ["eas_fullid", "eas_baseid", "address", "parcel_number", "block",
              "lot", "tier", "blklot", "parcel_active", "lat", "lon", "is_unit"]


def norm(v):
    return v.strip().upper() if isinstance(v, str) else v


def to_num(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def stream(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def dump_compact(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    manifest = {"started_at": datetime.now(timezone.utc).isoformat(), "inputs": {}}
    for name, path in [("parcels", PARCELS), ("eas", EAS),
                       ("linkage", LINKAGE), ("rentboard", RENTB)]:
        manifest["inputs"][name] = {"path": path, "sha256": sha256_file(path)}
        print(f"  hashed {name}", flush=True)

    # ---- Pass 1: parcels ----
    parcel_rows = []
    block_parcels = defaultdict(set)      # block_num -> set(blklot)
    block_nhood = defaultdict(Counter)    # block_num -> Counter(neighborhood)
    n = 0
    for d in stream(PARCELS):
        n += 1
        blk = norm(d.get("blklot"))
        b = norm(d.get("block_num"))
        parcel_rows.append([
            blk, b, norm(d.get("lot_num")), 1 if d.get("active") else 0,
            norm(d.get("street_name")), norm(d.get("street_type")),
            to_num(d.get("from_address_num")), to_num(d.get("to_address_num")),
            norm(d.get("zoning_code")), d.get("zoning_district"),
            d.get("analysis_neighborhood"),
            to_float(d.get("centroid_latitude")),
            to_float(d.get("centroid_longitude")),
        ])
        if b:
            block_parcels[b].add(blk)
            if d.get("analysis_neighborhood"):
                block_nhood[b][d["analysis_neighborhood"]] += 1
        if n % 50000 == 0:
            print(f"  parcels: {n}", flush=True)
    dump_compact(os.path.join(OUT, "parcels.idx.json"),
                 {"fields": PARCEL_FIELDS, "rows": parcel_rows})
    print(f"  parcels.idx.json: {n} rows", flush=True)
    del parcel_rows

    # ---- Pass 2: linkage (fullid -> tier/blklot/parcel_active) ----
    link = {}
    n = 0
    for d in stream(LINKAGE):
        n += 1
        pa = d.get("parcel_active")
        link[d["eas_fullid"]] = (d.get("tier"), d.get("tier_reason"),
                                 d.get("blklot"),
                                 1 if pa is True else (0 if pa is False else -1))
        if n % 100000 == 0:
            print(f"  linkage: {n}", flush=True)
    print(f"  linkage map: {n} rows", flush=True)

    # ---- Pass 3: EAS joined with linkage ----
    eas_rows = []
    block_addr = defaultdict(int)
    block_unit = defaultdict(int)
    n = missed = 0
    for d in stream(EAS):
        n += 1
        fid = d.get("eas_fullid")
        tier, reason, blklot, pa = link.get(fid, (None, None, None, -1))
        if tier is None:
            missed += 1
        addr = d.get("address") or ""
        is_unit = 1 if ("#" in addr or " UNIT " in f" {norm(addr)} ") else 0
        b = norm(d.get("block"))
        eas_rows.append([
            fid, d.get("eas_baseid"), addr,
            norm(d.get("parcel_number")), b, norm(d.get("lot")),
            tier, blklot, pa,
            to_float(d.get("latitude")), to_float(d.get("longitude")),
            is_unit,
        ])
        if b:
            block_addr[b] += 1
            block_unit[b] += is_unit
        if n % 100000 == 0:
            print(f"  eas: {n}", flush=True)
    dump_compact(os.path.join(OUT, "eas.idx.json"),
                 {"fields": EAS_FIELDS, "rows": eas_rows,
                  "tier_reasons": {"verified_parcel_key":
                                   "EAS.parcel_number == parcel.blklot",
                                   "unmatched_no_parcel":
                                   "no parcel keys on EAS row",
                                   "unmatched_orphan":
                                   "parcel_number not in parcel index"}})
    print(f"  eas.idx.json: {n} rows (linkage misses: {missed})", flush=True)
    del eas_rows, link

    # ---- Pass 4: Rent Board per-block filing aggregates ----
    blocks = {}
    n = 0
    for d in stream(RENTB):
        n += 1
        b = norm(d.get("block_num"))
        if not b:
            continue
        e = blocks.get(b)
        if e is None:
            e = blocks[b] = {"filing_count": 0, "years": set(),
                             "case_types": set(), "occ": Counter(),
                             "rent": Counter(), "bed": Counter(),
                             "yb_min": None, "yb_max": None,
                             "yb_pre1979": 0, "yb_post1979": 0,
                             "yb_unknown": 0, "samples": []}
        e["filing_count"] += 1
        if d.get("submission_year"):
            e["years"].add(str(d["submission_year"]))
        if d.get("case_type_name"):
            e["case_types"].add(d["case_type_name"])
        if d.get("occupancy_type"):
            e["occ"][d["occupancy_type"]] += 1
        if d.get("monthly_rent"):
            e["rent"][d["monthly_rent"]] += 1
        if d.get("bedroom_count"):
            e["bed"][d["bedroom_count"]] += 1
        yb = (d.get("year_property_built") or "").strip()
        if yb.isdigit():
            e["yb_min"] = yb if e["yb_min"] is None or yb < e["yb_min"] else e["yb_min"]
            e["yb_max"] = yb if e["yb_max"] is None or yb > e["yb_max"] else e["yb_max"]
            if int(yb) < 1979:
                e["yb_pre1979"] += 1
            else:
                e["yb_post1979"] += 1
        else:
            e["yb_unknown"] += 1
        if len(e["samples"]) < 3:
            e["samples"].append({
                "unique_id": d.get("unique_id"),
                "submission_year": d.get("submission_year"),
                "occupancy_type": d.get("occupancy_type"),
                "monthly_rent": d.get("monthly_rent"),
                "bedroom_count": d.get("bedroom_count"),
                "year_property_built": d.get("year_property_built"),
                "block_address": d.get("block_address"),
            })
        if n % 100000 == 0:
            print(f"  rentboard: {n}", flush=True)
    print(f"  rentboard blocks: {len(blocks)}", flush=True)

    # ---- Pass 5: combine block index ----
    block_idx = {}
    for b in set(blocks) | set(block_parcels) | set(block_addr):
        e = blocks.get(b, {"filing_count": 0, "years": set(), "case_types": set(),
                           "occ": Counter(), "rent": Counter(), "bed": Counter(),
                           "yb_min": None, "yb_max": None, "yb_pre1979": 0,
                           "yb_post1979": 0, "yb_unknown": 0, "samples": []})
        block_idx[b] = {
            "filing_count": e["filing_count"],
            "submission_years": sorted(e["years"]),
            "case_types": sorted(e["case_types"]),
            "block_in_parcel_index": b in block_parcels,
            "occupancy_mix": dict(e["occ"]),
            "rent_buckets": dict(e["rent"]),
            "bedroom_mix": dict(e["bed"]),
            "year_built_min": e["yb_min"], "year_built_max": e["yb_max"],
            "year_built_pre1979": e["yb_pre1979"],
            "year_built_post1979": e["yb_post1979"],
            "year_built_unknown": e["yb_unknown"],
            "sample_filings": e["samples"],
            "address_count": block_addr.get(b, 0),
            "unit_count": block_unit.get(b, 0),
            "parcel_count": len(block_parcels.get(b, ())),
            "neighborhoods": [nh for nh, _ in block_nhood.get(b, Counter()).most_common(3)],
        }
    dump_compact(os.path.join(OUT, "blocks.idx.json"), block_idx)
    print(f"  blocks.idx.json: {len(block_idx)} blocks", flush=True)

    manifest["finished_at"] = datetime.now(timezone.utc).isoformat()
    manifest["elapsed_s"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"BUILD DONE in {manifest['elapsed_s']}s", flush=True)


if __name__ == "__main__":
    main()
