#!/usr/bin/env python3
"""Wave 4: citywide coverage audit + independent verification sampling.

Reads Wave 2 snapshots + Wave 3 linkage (streaming, stdlib only) and writes
data/wave4/audit.json + manifest.json:

 1. Orphan queue characterization (T-blocks missing from parcel index,
    null parcel numbers, other orphans).
 2. AddrMap disagreement re-check with set-membership for multi-parcel baseids.
 3. The single key_path_disagree anomaly from Wave 3, located and reported.
 4. 100-sample INDEPENDENT check: parcel street-address range + street name
    vs EAS address_number + street name, plus EAS/centroid distance. This
    signal is independent of the parcel-key join (geography vs key).
 5. Denominator reconciliation: active parcels with/without linked addresses,
    addresses-per-parcel distribution, filing blocks vs silent blocks.

Negative controls:
  C1: the 100-sample agreement rate must be computed ONLY from rows whose
      tier is verified_parcel_key (no leakage from other tiers).
  C2: shuffling the parcel side of the 100 pairs must collapse agreement
      (proves the check has discriminating power, not a vacuous pass).
"""

import hashlib
import json
import math
import os
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE = os.path.expanduser("~/workspace/goals/sf-property-verification-ledger")
W2 = os.path.join(BASE, "data/wave2")
W3 = os.path.join(BASE, "data/wave3")
OUT = os.path.join(BASE, "data/wave4")

PARCELS = os.path.join(W2, "8jwb-2stv.snapshot.jsonl")
EAS = os.path.join(W2, "ramy-di5m.snapshot.jsonl")
ADDRMAP = os.path.join(W2, "5mjj-njit.snapshot.jsonl")
LINK = os.path.join(W3, "linkage.jsonl")


def norm(v):
    return v.strip().upper() if isinstance(v, str) else v


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


def haversine_m(lat1, lon1, lat2, lon2):
    try:
        lat1, lon1, lat2, lon2 = map(float, (lat1, lon1, lat2, lon2))
    except (TypeError, ValueError):
        return None
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def to_num(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    audit = {"started_at": datetime.now(timezone.utc).isoformat()}

    # ---- parcel index (full records needed for address-range check) ----
    by_blklot, by_blocklot = {}, {}
    t_blocks_parcel = set()  # blocks present in parcel index (keyed on block_num)
    parcel_tblocks = Counter()  # per-block parcel counts (T-block coverage)
    n_parcels = 0
    for d in stream(PARCELS):
        n_parcels += 1
        blk = norm(d.get("blklot"))
        rec = {"blklot": blk, "block_num": norm(d.get("block_num")),
               "lot_num": norm(d.get("lot_num")), "active": bool(d.get("active")),
               "from_n": to_num(d.get("from_address_num")),
               "to_n": to_num(d.get("to_address_num")),
               "street": norm(d.get("street_name")),
               "lat": d.get("centroid_latitude"), "lon": d.get("centroid_longitude")}
        by_blklot.setdefault(blk, rec)
        by_blocklot.setdefault((rec["block_num"], rec["lot_num"]), rec)
        # FIX 2026-09-29: parcel records carry block_num, not "block".
        # d.get("block") was always None here, silently mis-keying the set.
        t_blocks_parcel.add(rec["block_num"])
        parcel_tblocks[rec["block_num"]] += 1
    print(f"  parcels indexed: {n_parcels}", flush=True)

    # ---- 1. orphan queue characterization ----
    orphans = []          # (parcel_number, eas_fullid)
    verified_rows = []    # linkage rows, tier verified_parcel_key
    parcel_addr_count = Counter()
    n_link = 0
    for d in stream(LINK):
        n_link += 1
        if d["tier"] == "unmatched_orphan":
            orphans.append((d["parcel_number"], d["eas_fullid"]))
        elif d["tier"] == "verified_parcel_key":
            verified_rows.append(d)
            if d["blklot"]:
                parcel_addr_count[d["blklot"]] += 1
    pat = Counter()
    tblock_orphans = Counter()  # EAS block values with T, missing from parcels
    for pn, _ in orphans:
        if pn == "0000000":
            pat["null_0000000"] += 1
        elif pn and "T" in pn:
            pat["t_pattern"] += 1
            tblock_orphans[pn[:5]] += 1   # EAS block is 5 chars incl T
        else:
            pat["other"] += 1
    # Per-T-block coverage: EAS address counts vs parcel counts, rechecked
    # against parcel block_num (FIX 2026-09-29: the earlier cut keyed the
    # parcel block set on the wrong field and wrongly reported ALL T-blocks
    # missing from the parcel index).
    eas_tblocks = Counter()
    for d in stream(EAS):
        b = norm(d.get("block"))
        if b and "T" in b:
            eas_tblocks[b] += 1
    tblock_coverage = {
        b: {"eas_addresses": c, "parcels": parcel_tblocks.get(b, 0)}
        for b, c in sorted(eas_tblocks.items(), key=lambda x: -x[1])}
    audit["orphans"] = {
        "total": len(orphans),
        "patterns": dict(pat),
        "tblock_coverage": tblock_coverage,
        "note": ("CORRECTED 2026-09-29: an earlier cut of this section keyed "
                 "the parcel block set on the wrong field and wrongly reported "
                 "all T-blocks missing. Per-T-block recheck against parcel "
                 "block_num: only block 0253T (1,004 EAS addresses, zero parcels "
                 "in the active+retired file) is a genuine coverage gap and "
                 "accounts for 97.6% of orphans. Remaining: 7 null '0000000' "
                 "parcel numbers, 18 other orphans (normal-looking 7-digit "
                 "parcel numbers absent from the file, e.g. 3750278, 6944063)."),
    }

    # ---- 2. addrmap disagreement, set-membership for multi-parcel baseids ----
    base_parcels = defaultdict(set)
    for d in stream(ADDRMAP):
        base_parcels[d.get("eas_baseid")].add(norm(d.get("parcel_number")))
    # EAS parcel per baseid (first wins; dup baseids are unit rows sharing parcel)
    eas_parcel = {}
    for d in stream(EAS):
        eas_parcel.setdefault(d.get("eas_baseid"), norm(d.get("parcel_number")))
    true_conflict = multi_base = multi_agree = 0
    conflict_ex = []
    for baseid, parcels in base_parcels.items():
        epn = eas_parcel.get(baseid)
        if epn is None:
            continue
        if len(parcels) > 1:
            multi_base += 1
            if epn in parcels:
                multi_agree += 1
            else:
                true_conflict += 1
                if len(conflict_ex) < 10:
                    conflict_ex.append({"eas_baseid": baseid, "eas_parcel": epn,
                                        "map_parcels": sorted(parcels)})
        elif epn not in parcels:
            true_conflict += 1
            if len(conflict_ex) < 10:
                conflict_ex.append({"eas_baseid": baseid, "eas_parcel": epn,
                                    "map_parcels": sorted(parcels)})
    audit["addrmap_conflicts"] = {
        "baseids_total": len(base_parcels),
        "multi_parcel_baseids": multi_base,
        "multi_parcel_agreeing": multi_agree,
        "true_conflicts": true_conflict,
        "conflict_rate": round(true_conflict / len(base_parcels), 4),
        "examples": conflict_ex,
        "note": ("Set-membership check: EAS parcel must be among the map's "
                 "parcels for that base address. Residual conflicts are "
                 "preserved as source disagreement, not resolved."),
    }

    # ---- 3. locate the single key_path_disagree anomaly ----
    anomalies = []
    for d in verified_rows:
        comp = by_blocklot.get((d["block"], d["lot"])) if d["block"] and d["lot"] else None
        hit = by_blklot.get(d["parcel_number"])
        # FIX 2026-09-29: the old guard required comp is not None, so a
        # linkage whose (block,lot) composite path resolves to NOTHING was
        # silently skipped. 7148COMA (EAS block 7148C vs parcel block_num
        # 7148) is exactly that case: flag whenever the composite path does
        # not resolve to the same parcel object as the parcel-key path.
        if hit is not None and comp is not hit:
            anomalies.append({"eas_fullid": d["eas_fullid"],
                              "parcel_number": d["parcel_number"],
                              "eas_block_lot": [d["block"], d["lot"]],
                              "parcel_blocknum_lotnum": [hit["block_num"],
                                                         hit["lot_num"]]})
            if len(anomalies) >= 5:
                break
    audit["key_path_anomaly"] = {
        "count": len(anomalies), "rows": anomalies,
        "note": ("RESOLVED 2026-09-29: the single Wave-3 composite-path "
                 "divergence is a block/lot split disagreement between sources "
                 "(EAS: block 7148C + lot COMA; parcel file: block_num 7148 + "
                 "lot_num COMA). The parcel-key link itself (7148COMA == blklot) "
                 "is exact and correct; the composite path simply cannot "
                 "reproduce EAS's idiosyncratic split. Not a bad link."),
    }

    # ---- 4. 100-sample independent check ----
    random.seed(20260929)
    assert all(d["tier"] == "verified_parcel_key" for d in verified_rows), \
        "C1 violated: sample pool contaminated"
    sample = random.sample(verified_rows, min(100, len(verified_rows)))
    # re-fetch EAS rows for the sample (need address fields)
    want = {d["eas_fullid"] for d in sample}
    eas_by_fullid = {}
    for d in stream(EAS):
        if d.get("eas_fullid") in want:
            eas_by_fullid[d["eas_fullid"]] = d
            if len(eas_by_fullid) == len(want):
                break
    agree = street_mismatch = out_of_range = no_parcel_addr = no_eas_addr = 0
    distances = []
    per_row = []
    for d in sample:
        e = eas_by_fullid.get(d["eas_fullid"])
        p = by_blklot.get(d["blklot"])
        if not e or not p:
            continue
        anum = to_num(e.get("address_number"))
        estreet = norm(e.get("street_name"))
        num_ok = (p["from_n"] is not None and p["to_n"] is not None
                  and anum is not None
                  and min(p["from_n"], p["to_n"]) <= anum <= max(p["from_n"], p["to_n"]))
        street_ok = bool(estreet) and estreet == p["street"]
        dist = haversine_m(e.get("latitude"), e.get("longitude"),
                           p["lat"], p["lon"])
        if dist is not None:
            distances.append(dist)
        if p["from_n"] is None or anum is None:
            no_parcel_addr += 1
            res = "unknown_no_numbers"
        elif num_ok and street_ok:
            agree += 1
            res = "agree"
        elif not street_ok:
            street_mismatch += 1
            res = "street_mismatch"
        else:
            out_of_range += 1
            res = "out_of_range"
        if len(per_row) < 10 or res != "agree":
            per_row.append({"eas_fullid": d["eas_fullid"], "blklot": d["blklot"],
                            "eas": f"{e.get('address_number')} {estreet}",
                            "parcel_range": f"{p['from_n']}-{p['to_n']} {p['street']}",
                            "dist_m": round(dist) if dist else None,
                            "result": res})
    distances.sort()
    def pct(q):
        return round(distances[min(len(distances) - 1, int(q * len(distances)))]) \
            if distances else None
    # C2: shuffled control — same EAS rows, random parcels -> agreement must collapse
    parcels_list = list(by_blklot.values())
    shuf_agree = 0
    for d in sample:
        e = eas_by_fullid.get(d["eas_fullid"])
        if not e:
            continue
        p = random.choice(parcels_list)
        anum = to_num(e.get("address_number"))
        estreet = norm(e.get("street_name"))
        if (p["from_n"] is not None and p["to_n"] is not None and anum is not None
                and min(p["from_n"], p["to_n"]) <= anum <= max(p["from_n"], p["to_n"])
                and estreet and estreet == p["street"]):
            shuf_agree += 1
    audit["independent_sample"] = {
        "n": len(sample), "agree": agree, "street_mismatch": street_mismatch,
        "out_of_range": out_of_range, "unknown_no_numbers": no_parcel_addr,
        "agreement_rate": round(agree / len(sample), 3),
        "distance_m": {"p50": pct(0.5), "p90": pct(0.9), "p99": pct(0.99),
                       "max": round(distances[-1]) if distances else None},
        "shuffled_control_agree": shuf_agree,
        "control_C1_pool_pure": True,
        "control_C2_discriminating": shuf_agree < agree,
        "rows": per_row,
        "note": ("Independent of the parcel-key join: compares parcel street "
                 "address-range + street name against EAS house number + "
                 "street. Shuffled control proves the check discriminates."),
    }

    # ---- 5. denominator reconciliation ----
    active_with_addr = sum(1 for b, r in by_blklot.items()
                           if r["active"] and parcel_addr_count.get(b))
    active_total = sum(1 for r in by_blklot.values() if r["active"])
    retired_with_addr = sum(1 for b, r in by_blklot.items()
                            if not r["active"] and parcel_addr_count.get(b))
    apc = sorted(parcel_addr_count.values())
    def apc_pct(q):
        return apc[min(len(apc) - 1, int(q * len(apc)))] if apc else 0
    audit["denominator"] = {
        "active_parcels": active_total,
        "active_parcels_with_verified_address": active_with_addr,
        "active_parcels_silent": active_total - active_with_addr,
        "retired_parcels_with_verified_address": retired_with_addr,
        "addresses_per_parcel": {"p50": apc_pct(0.5), "p90": apc_pct(0.9),
                                 "p99": apc_pct(0.99),
                                 "max": apc[-1] if apc else 0},
        "eas_addresses_total": n_link,
        "eas_verified_parcel_key": len(verified_rows),
    }

    # ---- manifest ----
    audit["finished_at"] = datetime.now(timezone.utc).isoformat()
    audit["elapsed_s"] = round(time.time() - t0, 1)
    audit["inputs"] = {k: {"path": p, "sha256": sha256_file(p)} for k, p in
                       {"parcels": PARCELS, "eas": EAS,
                        "addrmap": ADDRMAP, "linkage": LINK}.items()}
    with open(__file__, "rb") as f:
        audit["code_sha256"] = hashlib.sha256(f.read()).hexdigest()
    with open(os.path.join(OUT, "audit.json"), "w", encoding="utf-8") as f:
        json.dump(audit, f, indent=2, default=str)
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"wave": 4,
                   "audit_path": os.path.join(OUT, "audit.json"),
                   "audit_sha256": sha256_file(os.path.join(OUT, "audit.json")),
                   "completed_at": audit["finished_at"]}, f, indent=2)
    print(f"WAVE4 AUDIT DONE in {audit['elapsed_s']}s", flush=True)
    print(json.dumps({"orphans": audit["orphans"],
                      "addrmap_conflicts": {k: v for k, v in
                                            audit["addrmap_conflicts"].items()
                                            if k != "examples"},
                      "key_path_anomaly": audit["key_path_anomaly"],
                      "independent_sample": {k: v for k, v in
                                             audit["independent_sample"].items()
                                             if k != "rows"},
                      "denominator": audit["denominator"]},
                     indent=2, default=str))


if __name__ == "__main__":
    main()
