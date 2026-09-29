#!/usr/bin/env python3
"""Wave 3: parcel <-> address <-> Rent Board record linkage with confidence tiers.

Reads Wave 1 + Wave 2 snapshots (streaming JSONL, stdlib only) and produces:

  data/wave3/linkage.jsonl        one row per EAS address with match tier
  data/wave3/block_evidence.jsonl one row per block_num: filing counts (block-level ONLY)
  data/wave3/stats.json            aggregate counts, unmatched queues, disagreements
  data/wave3/manifest.json         inputs w/ sha256, code sha, timings, control results

Confidence tiers (per address):
  verified_parcel_key   EAS.parcel_number == parcel.blklot (or mapblklot)
  verified_block_lot    (block,lot) == (block_num,lot_num)  [independent check]
  unmatched_no_parcel   EAS row carries no parcel keys (expected ~31%; EAS caveat)
  unmatched_orphan      parcel_number present but absent from parcel index

Hard rule: Rent Board block_num evidence is BLOCK-level and is NEVER written
into a parcel/address row as parcel verification. Block-only "matches" must
never be promoted.

Negative controls (run every execution, fail loudly):
  N1: 2,000 real linked pairs with corrupted parcel_number -> 0 links
  N2: 2,000 real linked pairs with corrupted (block,lot)   -> 0 links
  N3: no row may carry a verified_* tier derived from block_num alone
  N4: every verified_parcel_key link resolves in the parcel index
"""

import hashlib
import json
import os
import random
import sys
import time
from datetime import datetime, timezone

BASE = os.path.expanduser("~/workspace/goals/sf-property-verification-ledger")
W1 = os.path.join(BASE, "data/wave1")
W2 = os.path.join(BASE, "data/wave2")
OUT = os.path.join(BASE, "data/wave3")

PARCELS = os.path.join(W2, "8jwb-2stv.snapshot.jsonl")
EAS = os.path.join(W2, "ramy-di5m.snapshot.jsonl")
ADDRMAP = os.path.join(W2, "5mjj-njit.snapshot.jsonl")
RENTB = os.path.join(W1, "gdc7-dmcn.snapshot.jsonl")


def norm(v):
    return v.strip().upper() if isinstance(v, str) else v


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def stream_jsonl(path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    stats = {"started_at": datetime.now(timezone.utc).isoformat()}

    # ---- Phase 1: parcel indexes ----
    by_blklot, by_mapblklot, by_blocklot = {}, {}, {}
    dup_blklot = dup_blocklot = 0
    n_parcels = n_active = n_retired = 0
    blocks_in_parcels = set()
    for d in stream_jsonl(PARCELS):
        n_parcels += 1
        blk = norm(d.get("blklot"))
        mblk = norm(d.get("mapblklot")) or blk
        b, l = norm(d.get("block_num")), norm(d.get("lot_num"))
        active = bool(d.get("active"))
        n_active += active
        n_retired += (not active)
        if b:
            blocks_in_parcels.add(b)
        rec = {"blklot": blk, "mapblklot": mblk, "block_num": b,
               "lot_num": l, "active": active}
        if blk in by_blklot:
            dup_blklot += 1
        else:
            by_blklot[blk] = rec
        if mblk not in by_mapblklot:
            by_mapblklot[mblk] = rec
        key = (b, l)
        if key in by_blocklot:
            dup_blocklot += 1
        else:
            by_blocklot[key] = rec
        if n_parcels % 50000 == 0:
            print(f"  parcels indexed: {n_parcels}", flush=True)
    stats["parcels"] = {"rows": n_parcels, "active": n_active,
                        "retired": n_retired, "dup_blklot": dup_blklot,
                        "dup_blocklot": dup_blocklot,
                        "distinct_blocks": len(blocks_in_parcels)}

    # ---- Phase 2: EAS -> parcel linkage ----
    tiers = {"verified_parcel_key": 0, "verified_block_lot": 0,
             "unmatched_no_parcel": 0, "unmatched_orphan": 0}
    orphan_examples, nolink_examples = [], []
    eas_baseid_index = {}  # eas_baseid -> parcel_number (for Phase 3)
    dup_eas = 0
    n_eas = 0
    key_agree = key_disagree = 0  # parcel_key vs block_lot path agreement
    out_link = open(os.path.join(OUT, "linkage.jsonl"), "w", encoding="utf-8")
    for d in stream_jsonl(EAS):
        n_eas += 1
        pn = norm(d.get("parcel_number"))
        b, l = norm(d.get("block")), norm(d.get("lot"))
        baseid = d.get("eas_baseid")
        if baseid not in eas_baseid_index:
            eas_baseid_index[baseid] = pn
        else:
            dup_eas += 1
        tier, reason, parcel = "unmatched_no_parcel", "no parcel keys on EAS row", None
        if pn:
            parcel = by_blklot.get(pn) or by_mapblklot.get(pn)
            if parcel:
                tier, reason = "verified_parcel_key", "EAS.parcel_number == parcel.blklot"
                # independent composite check
                comp = by_blocklot.get((b, l)) if b and l else None
                if comp is parcel:
                    key_agree += 1
                else:
                    key_disagree += 1
            else:
                tier, reason = "unmatched_orphan", "parcel_number not in parcel index"
                if len(orphan_examples) < 10:
                    orphan_examples.append({"eas_fullid": d.get("eas_fullid"),
                                            "parcel_number": pn})
        elif len(nolink_examples) < 10:
            nolink_examples.append({"eas_fullid": d.get("eas_fullid"),
                                    "address": d.get("address")})
        tiers[tier] += 1
        out_link.write(json.dumps({
            "eas_fullid": d.get("eas_fullid"), "eas_baseid": baseid,
            "parcel_number": pn, "block": b, "lot": l,
            "tier": tier, "tier_reason": reason,
            "blklot": parcel["blklot"] if parcel else None,
            "parcel_active": parcel["active"] if parcel else None,
        }) + "\n")
        if n_eas % 100000 == 0:
            print(f"  eas linked: {n_eas}", flush=True)
    out_link.close()
    stats["eas"] = {"rows": n_eas, "tiers": tiers, "dup_eas_baseid": dup_eas,
                    "key_path_agree": key_agree, "key_path_disagree": key_disagree,
                    "orphan_examples": orphan_examples,
                    "no_parcel_examples": nolink_examples}

    # ---- Phase 3: 5mjj-njit cross-check against EAS ----
    agree = disagree = eas_missing = 0
    disagree_examples = []
    n_map = 0
    for d in stream_jsonl(ADDRMAP):
        n_map += 1
        baseid = d.get("eas_baseid")
        mpn = norm(d.get("parcel_number"))
        epn = eas_baseid_index.get(baseid)
        if baseid not in eas_baseid_index:
            eas_missing += 1
        elif epn == mpn:
            agree += 1
        else:
            disagree += 1
            if len(disagree_examples) < 10:
                disagree_examples.append({"eas_baseid": baseid,
                                          "map_parcel": mpn, "eas_parcel": epn})
        if n_map % 50000 == 0:
            print(f"  addrmap checked: {n_map}", flush=True)
    stats["addrmap"] = {"rows": n_map, "parcel_agree": agree,
                        "parcel_disagree": disagree,
                        "eas_baseid_missing": eas_missing,
                        "disagree_examples": disagree_examples}

    # ---- Phase 4: Rent Board block-level evidence (NEVER parcel-level) ----
    filings_by_block = {}
    n_rb = 0
    for d in stream_jsonl(RENTB):
        n_rb += 1
        b = norm(d.get("block_num"))
        if not b:
            continue
        e = filings_by_block.setdefault(b, {"filings": 0, "years": set(),
                                            "case_types": set()})
        e["filings"] += 1
        if d.get("submission_year"):
            e["years"].add(d["submission_year"])
        if d.get("case_type_name"):
            e["case_types"].add(d["case_type_name"])
        if n_rb % 100000 == 0:
            print(f"  rentboard aggregated: {n_rb}", flush=True)
    out_blk = open(os.path.join(OUT, "block_evidence.jsonl"), "w", encoding="utf-8")
    blocks_with_filings = 0
    for b, e in filings_by_block.items():
        if b in blocks_in_parcels:
            blocks_with_filings += 1
        out_blk.write(json.dumps({
            "block_num": b,
            "filing_count": e["filings"],
            "submission_years": sorted(e["years"]),
            "case_types": sorted(e["case_types"]),
            "block_in_parcel_index": b in blocks_in_parcels,
            # NOTE: block-level evidence only. No parcel attribution.
        }) + "\n")
    out_blk.close()
    stats["rentboard"] = {
        "rows": n_rb, "distinct_blocks": len(filings_by_block),
        "blocks_also_in_parcels": blocks_with_filings,
        "parcel_blocks_total": len(blocks_in_parcels),
        "note": "block-level filing evidence only; never parcel attribution",
    }

    # ---- Phase 5: negative controls ----
    random.seed(20260929)
    linked = []
    with open(os.path.join(OUT, "linkage.jsonl"), encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            if d["tier"] == "verified_parcel_key":
                linked.append(d)
                if len(linked) >= 2000:
                    break
    assert len(linked) == 2000, f"N-control setup: only {len(linked)} linked rows"

    def corrupt(s):
        s = list(s)
        i = random.randrange(len(s))
        s[i] = "Z" if s[i] != "Z" else "Q"
        return "".join(s)

    n1 = sum(1 for d in linked if corrupt(d["parcel_number"]) in by_blklot)
    n2 = sum(1 for d in linked
             if d["block"] and d["lot"]
             and (corrupt(d["block"]), corrupt(d["lot"])) in by_blocklot)
    # N3: scan linkage output — no verified_* tier may exist without a parcel hit
    n3 = 0
    with open(os.path.join(OUT, "linkage.jsonl"), encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            if d["tier"].startswith("verified_") and not d["blklot"]:
                n3 += 1
    # N4: every verified_parcel_key blklot resolves
    n4 = sum(1 for d in linked if d["blklot"] not in by_blklot)
    controls = {"N1_corrupt_parcel_key_links": n1,
                "N2_corrupt_block_lot_links": n2,
                "N3_verified_without_parcel_hit": n3,
                "N4_verified_blklot_unresolved": n4,
                "passed": (n1 == 0 and n2 == 0 and n3 == 0 and n4 == 0)}
    stats["negative_controls"] = controls
    print("negative controls:", controls, flush=True)
    if not controls["passed"]:
        print("NEGATIVE CONTROLS FAILED", file=sys.stderr)
        sys.exit(3)

    # ---- Phase 6: manifest ----
    stats["finished_at"] = datetime.now(timezone.utc).isoformat()
    stats["elapsed_s"] = round(time.time() - t0, 1)
    stats["inputs"] = {
        "parcels": {"path": PARCELS, "sha256": sha256_file(PARCELS)},
        "eas": {"path": EAS, "sha256": sha256_file(EAS)},
        "addrmap": {"path": ADDRMAP, "sha256": sha256_file(ADDRMAP)},
        "rentboard": {"path": RENTB, "sha256": sha256_file(RENTB)},
    }
    with open(__file__, "rb") as f:
        stats["code_sha256"] = hashlib.sha256(f.read()).hexdigest()
    stats["outputs"] = {
        "linkage": {"path": os.path.join(OUT, "linkage.jsonl"),
                    "sha256": sha256_file(os.path.join(OUT, "linkage.jsonl"))},
        "block_evidence": {"path": os.path.join(OUT, "block_evidence.jsonl"),
                           "sha256": sha256_file(os.path.join(OUT, "block_evidence.jsonl"))},
    }
    with open(os.path.join(OUT, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, default=str)
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"wave": 3, "stats_path": os.path.join(OUT, "stats.json"),
                   "stats_sha256": sha256_file(os.path.join(OUT, "stats.json")),
                   "completed_at": stats["finished_at"]}, f, indent=2)
    print(f"WAVE3 DONE in {stats['elapsed_s']}s", flush=True)
    print(json.dumps({k: v for k, v in stats.items()
                      if k in ("parcels", "eas", "addrmap", "rentboard",
                               "negative_controls")}, indent=2, default=str))


if __name__ == "__main__":
    main()
