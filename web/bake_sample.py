#!/usr/bin/env python3
"""Bake ~500 REAL rows from the immutable snapshots into sample_data.json.

Stratified by linkage tier so the sample UI exercises every state:
  400 verified_parcel_key + 80 unmatched_no_parcel + 20 unmatched_orphan.

Every row is copied verbatim from a snapshot; nothing is invented.
Gap blocks are real parcel blocks with zero filing evidence (computed, not made up).
Run: python3 bake_sample.py   (writes sample_data.json next to this file)
"""
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # goals/sf-property-verification-ledger
DATA = os.path.join(ROOT, "data")

WANT = {"verified_parcel_key": 400, "unmatched_no_parcel": 80, "unmatched_orphan": 20}


def stream_jsonl(path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main():
    # 1. stratified linkage sample (deterministic: first-N per tier)
    got = Counter()
    sample_link = []
    for row in stream_jsonl(os.path.join(DATA, "wave3", "linkage.jsonl")):
        t = row.get("tier")
        if t in WANT and got[t] < WANT[t]:
            sample_link.append(row)
            got[t] += 1
        if all(got[t] >= WANT[t] for t in WANT):
            break
    print("linkage sample:", dict(got))

    want_fullids = {r["eas_fullid"] for r in sample_link}
    want_blklots = {r["blklot"] for r in sample_link if r.get("blklot")}
    want_blocks = {r["block"] for r in sample_link if r.get("block")}

    # 2. EAS rows for sampled addresses
    eas = {}
    for row in stream_jsonl(os.path.join(DATA, "wave2", "ramy-di5m.snapshot.jsonl")):
        if row.get("eas_fullid") in want_fullids:
            eas[row["eas_fullid"]] = row
            if len(eas) >= len(want_fullids):
                break
    print("eas rows:", len(eas))

    # 3. parcel rows for sampled blklots
    parcels = {}
    for row in stream_jsonl(os.path.join(DATA, "wave2", "8jwb-2stv.snapshot.jsonl")):
        if row.get("blklot") in want_blklots:
            parcels[row["blklot"]] = row
            if len(parcels) >= len(want_blklots):
                break
    print("parcel rows:", len(parcels))

    # 4. block evidence for sampled blocks
    block_ev = {}
    for row in stream_jsonl(os.path.join(DATA, "wave3", "block_evidence.jsonl")):
        if row.get("block_num") in want_blocks:
            block_ev[row["block_num"]] = row
    print("block evidence rows:", len(block_ev))

    # 5. filing rows: up to 3 real filings per sampled block, cap 600
    filings = []
    per_block = Counter()
    for row in stream_jsonl(os.path.join(DATA, "wave1", "gdc7-dmcn.snapshot.jsonl")):
        b = row.get("block_num")
        if b in want_blocks and per_block[b] < 3:
            filings.append(row)
            per_block[b] += 1
            if len(filings) >= 600:
                break
    print("filing rows:", len(filings))

    # 6. gap blocks: real parcel blocks with zero filing evidence
    ev_blocks = set()
    for row in stream_jsonl(os.path.join(DATA, "wave3", "block_evidence.jsonl")):
        ev_blocks.add(row.get("block_num"))
    parcel_blocks = Counter()
    block_nhood = {}
    for row in stream_jsonl(os.path.join(DATA, "wave2", "8jwb-2stv.snapshot.jsonl")):
        b = row.get("block_num")
        if not b:
            continue
        parcel_blocks[b] += 1
        if b not in block_nhood and row.get("analysis_neighborhood"):
            block_nhood[b] = row["analysis_neighborhood"]
    gap_blocks_all = [b for b in parcel_blocks if b not in ev_blocks]
    total_gap_blocks = len(gap_blocks_all)
    print("total gap blocks (real):", total_gap_blocks)

    # example addresses for gap blocks, from the sampled EAS rows
    eas_by_block = {}
    for fid, erow in eas.items():
        b = erow.get("block")
        if b:
            eas_by_block.setdefault(b, erow.get("address"))
    gap_blocks = []
    for b in sorted(gap_blocks_all)[:30]:
        gap_blocks.append({
            "block_num": b,
            "parcel_count": parcel_blocks[b],
            "neighborhood": block_nhood.get(b),
            "example_address": eas_by_block.get(b),
        })
    print("gap block samples:", len(gap_blocks))

    # 7. coverage numbers (real, from the audit)
    audit = json.load(open(os.path.join(DATA, "wave4", "audit.json")))
    coverage = {
        "active_parcels": audit["denominator"]["active_parcels"],
        "active_parcels_with_verified_address": audit["denominator"]["active_parcels_with_verified_address"],
        "active_parcels_silent": audit["denominator"]["active_parcels_silent"],
        "retired_parcels_with_verified_address": audit["denominator"]["retired_parcels_with_verified_address"],
        "eas_addresses_total": audit["denominator"]["eas_addresses_total"],
        "eas_verified_parcel_key": audit["denominator"]["eas_verified_parcel_key"],
        "addresses_per_parcel": audit["denominator"]["addresses_per_parcel"],
        "independent_sample_agree": audit["independent_sample"]["agree"],
        "independent_sample_n": audit["independent_sample"]["n"],
        "independent_sample_note": audit["independent_sample"]["note"],
        "orphans_total": audit["orphans"]["total"],
        "orphans_note": audit["orphans"]["note"],
        "true_conflicts": audit["addrmap_conflicts"]["true_conflicts"],
        "conflict_rate": audit["addrmap_conflicts"]["conflict_rate"],
        "filings_total": 551358,
        "blocks_with_filings": 4288,
        "blocks_zero_filings": total_gap_blocks,
    }

    # 8. wave status from manifests (tolerant of shape differences)
    def wave_summary(path, wave):
        try:
            m = json.load(open(path))
        except OSError:
            return {"wave": wave, "status": "missing"}
        rows = m.get("total_rows_written") or m.get("rows") or m.get("total_rows")
        sha = m.get("file_sha256") or m.get("stats_sha256")
        retrieved = m.get("retrieved_at") or m.get("completed_at")
        expected = m.get("expected_rows")
        reconciled = (rows == expected) if (rows is not None and expected is not None) else None
        return {
            "wave": wave,
            "dataset": m.get("dataset_id"),
            "rows": rows,
            "expected_rows": expected,
            "reconciled": reconciled,
            "sha256": sha[:16] + "…" if sha else None,
            "retrieved_at": retrieved,
        }

    waves = [
        wave_summary(os.path.join(DATA, "wave1", "gdc7-dmcn.manifest.json"), 1),
        wave_summary(os.path.join(DATA, "wave2", "8jwb-2stv.manifest.json"), 2),
        wave_summary(os.path.join(DATA, "wave3", "manifest.json"), 3),
        wave_summary(os.path.join(DATA, "wave4", "manifest.json"), 4),
    ]

    sample = {
        "baked_at": "2026-09-29",
        "note": "Stratified sample of REAL snapshot rows. Not full coverage.",
        "linkage": sample_link,
        "eas": eas,
        "parcels": parcels,
        "block_evidence": block_ev,
        "filings": filings,
        "gap_blocks": gap_blocks,
        "total_gap_blocks": total_gap_blocks,
        "coverage": coverage,
        "waves": waves,
    }
    out = os.path.join(HERE, "sample_data.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(sample, f, separators=(",", ":"))
    print("wrote", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
