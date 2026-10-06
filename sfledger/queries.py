#!/usr/bin/env python3
"""Wave 5 service layer: the 7 query functions shared by the CLI and MCP server.

Every function returns a JSON-serializable dict (deterministic key order).
Hard rules enforced here, once, for both surfaces:
  - Rent Board filings are EVIDENCE of filing activity, never conclusive legal
    rent-control determinations. rent_control_evidence always carries RC_DISCLAIMER.
  - Block-level filing evidence is never attributed to a specific parcel/address.
  - Wave 3 confidence tiers surface verbatim in outputs.
"""

import json
import os
from datetime import datetime, timezone

from sfledger.models import (BLOCK_LEVEL_NOTE, RC_DISCLAIMER, CoverageStats,
                           to_dict)
from sfledger.store import get_store, normalize_address, normalize_blklot

BASE = os.path.expanduser("~/workspace/goals/sf-property-verification-ledger")

_FRIENDLY = {"parcels": "8jwb-2stv (Parcels - Active and Retired)",
             "eas": "ramy-di5m (SF Addresses with Units)",
             "linkage": "wave3 linkage.jsonl",
             "rentboard": "gdc7-dmcn (Rent Board Housing Inventory)"}


def _provenance(store):
    ds = []
    for key, info in store.build_manifest.get("inputs", {}).items():
        ds.append({"dataset": _FRIENDLY.get(key, key),
                   "snapshot_sha256_16": info["sha256"][:16],
                   "source_path": info["path"]})
    return {"datasets": ds,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "code": "sfledger wave5"}


def _parcel_dict(p):
    return to_dict(p) if p else None


def _linked_dict(la):
    d = {
        "eas_fullid": la.address.eas_fullid,
        "eas_baseid": la.address.eas_baseid,
        "address": la.address.address_text,
        "is_unit": la.address.is_unit,
        "parcel_number": la.address.parcel_number,
        "block": la.address.block,
        "lot": la.address.lot,
        "latitude": la.address.latitude,
        "longitude": la.address.longitude,
        "tier": la.tier,
        "tier_reason": la.tier_reason,
        "parcel_active": la.parcel_active,
        "parcel": _parcel_dict(la.parcel),
    }
    return d


def _resolve(query, store):
    """Resolve a query string to a parcel and/or address matches.

    Returns (kind, parcel, address_matches, block_num). kind is one of
    'parcel', 'address', 'none'.
    """
    parcel = store.find_parcel(query)
    if parcel is not None:
        return "parcel", parcel, [], parcel.block_num
    matches = store.find_addresses(query)
    if matches:
        blocks = {m.address.block for m in matches if m.address.block}
        block = next(iter(blocks)) if len(blocks) == 1 else None
        parcel0 = matches[0].parcel
        if parcel0 is not None and all(
                m.parcel is not None and m.parcel.blklot == parcel0.blklot
                for m in matches):
            return "address", parcel0, matches, parcel0.block_num
        return "address", None, matches, block
    return "none", None, [], None


# ---------------------------------------------------------------- lookups

def lookup_address(address):
    store = get_store()
    matches = store.find_addresses(address)
    if not matches:
        return {"found": False, "query": address,
                "normalized": normalize_address(address),
                "suggestions": store.suggest_addresses(address),
                "note": "No EAS address matched. Suggestions are base addresses "
                        "containing the query tokens.",
                "provenance": _provenance(store)}
    parcels = {m.parcel.blklot for m in matches if m.parcel is not None}
    parcel_summary = None
    if len(parcels) == 1:
        blklot = next(iter(parcels))
        parcel_summary = {
            "blklot": blklot,
            "addresses_on_parcel": store.parcel_addr_count.get(blklot, 0),
            "units_on_parcel": store.parcel_unit_count.get(blklot, 0),
        }
    else:
        from collections import Counter
        parcel_summary = {
            "multiple_parcels": True,
            "parcels_present": dict(Counter(
                m.parcel.blklot for m in matches if m.parcel is not None).most_common(10)),
        }
    tiers = sorted({m.tier for m in matches})
    capped = matches[:100]
    return {
        "found": True,
        "query": address,
        "normalized": normalize_address(address),
        "match_count": len(matches),
        "matches_truncated": len(matches) > 100,
        "tiers_present": tiers,
        "matches": [_linked_dict(m) for m in capped],
        "parcel_summary": parcel_summary,
        "filing_note": ("For filing evidence use rent_control_evidence: "
                        + BLOCK_LEVEL_NOTE),
        "provenance": _provenance(store),
    }


def lookup_parcel(blklot):
    store = get_store()
    parcel = store.find_parcel(blklot)
    if parcel is None:
        return {"found": False, "query": blklot,
                "normalized": normalize_blklot(blklot),
                "note": "No parcel with that blklot. Try block/lot form like '1753/001'.",
                "provenance": _provenance(store)}
    on_parcel = store.addresses_on_parcel(parcel.blklot)
    base = sorted({la.address.address_text for la in on_parcel
                   if not la.address.is_unit})
    tiers = sorted({la.tier for la in on_parcel})
    bev = store.block_evidence(parcel.block_num)
    return {
        "found": True,
        "query": blklot,
        "normalized": normalize_blklot(blklot),
        "parcel": _parcel_dict(parcel),
        "addresses": {
            "count": len(on_parcel),
            "units": sum(1 for la in on_parcel if la.address.is_unit),
            "tiers_present": tiers,
            "base_addresses_sample": base[:10],
        },
        "block_filings": {
            "scope": "block-level only",
            "block_num": parcel.block_num,
            "filing_count": bev.filing_count if bev else 0,
            "submission_years": bev.submission_years if bev else [],
            "note": BLOCK_LEVEL_NOTE,
        },
        "provenance": _provenance(store),
    }


# ------------------------------------------------------- rent control evidence

def rent_control_evidence(query):
    store = get_store()
    kind, parcel, matches, block_num = _resolve(query, store)
    if kind == "none" or not block_num:
        return {"found": False, "query": query,
                "disclaimer": RC_DISCLAIMER,
                "suggestions": store.suggest_addresses(query),
                "provenance": _provenance(store)}
    bev = store.block_evidence(block_num)
    block = {
        "block_num": block_num,
        "scope": "block-level filing evidence only",
        "filing_count": bev.filing_count if bev else 0,
        "submission_years": bev.submission_years if bev else [],
        "case_types": bev.case_types if bev else [],
        "occupancy_mix": bev.occupancy_mix if bev else {},
        "rent_buckets": bev.rent_buckets if bev else {},
        "bedroom_mix": bev.bedroom_mix if bev else {},
        "year_built": {
            "min": bev.year_built_min if bev else None,
            "max": bev.year_built_max if bev else None,
            "filings_pre1979": bev.year_built_pre1979 if bev else 0,
            "filings_post1979": bev.year_built_post1979 if bev else 0,
            "filings_year_unknown": bev.year_built_unknown if bev else 0,
        },
        "sample_filings": bev.sample_filings if bev else [],
        "block_in_parcel_index": bev.block_in_parcel_index if bev else False,
        "note": BLOCK_LEVEL_NOTE,
    }
    resolved = {"kind": kind, "block_num": block_num}
    if kind == "parcel":
        resolved["blklot"] = parcel.blklot
        resolved["parcel_active"] = parcel.active
    else:
        resolved["match_count"] = len(matches)
        resolved["tiers_present"] = sorted({m.tier for m in matches})
        blklots = sorted({m.parcel.blklot for m in matches if m.parcel})
        resolved["blklot_count"] = len(blklots)
        resolved["blklots"] = blklots[:25]
        if len(blklots) > 25:
            resolved["blklots_truncated"] = True
    return {
        "found": True,
        "query": query,
        "disclaimer": RC_DISCLAIMER,
        "tier": "reported",  # contract: filing exists, not proof of legal status
        "resolved": resolved,
        "block": block,
        "provenance": _provenance(store),
    }


# ---------------------------------------------------------------- filing gaps

def filing_gap(neighborhood=None, limit=20):
    store = get_store()
    gaps = []
    new_construction = []
    for bnum, bev in store.blocks.items():
        if neighborhood:
            nh = [n for n in bev.neighborhoods
                  if neighborhood.lower() in n.lower()]
            if not nh:
                continue
        if bev.filing_count == 0 and bev.parcel_count > 0:
            gaps.append({
                "block_num": bnum,
                "tier": "gap",  # contract tier: expected record missing
                "neighborhoods": bev.neighborhoods,
                "parcels": bev.parcel_count,
                "addresses": bev.address_count,
                "units": bev.unit_count,
                "filing_count": 0,
                "gap_score": bev.unit_count,  # apartment-stock proxy
            })
        elif (bev.filing_count > 0 and bev.year_built_pre1979 == 0
                and bev.year_built_post1979 > 0):
            new_construction.append({
                "block_num": bnum,
                "neighborhoods": bev.neighborhoods,
                "filing_count": bev.filing_count,
                "year_built_min": bev.year_built_min,
                "year_built_max": bev.year_built_max,
            })
    gaps.sort(key=lambda g: (-g["gap_score"], g["block_num"]))
    new_construction.sort(key=lambda g: (-g["filing_count"], g["block_num"]))
    return {
        "disclaimer": RC_DISCLAIMER,
        "method": ("Blocks with zero Rent Board inventory filings, ranked by "
                   "EAS unit-address count (apartment-stock proxy). "
                   "New-construction list: blocks with filings where every "
                   "reported year-built is >= 1979."),
        "limitation": ("Building age is not present in the parcel or EAS sources, "
                       "so 'pre-1979' cannot be verified from the ledger for "
                       "zero-filing blocks. These are candidate blank zones, "
                       "not determinations of rent-control status."),
        "neighborhood_filter": neighborhood,
        "zero_filing_blocks_total": len(gaps),
        "gaps": gaps[:limit],
        "new_construction_blocks_total": len(new_construction),
        "new_construction_sample": new_construction[:10],
        "provenance": _provenance(store),
    }


# ------------------------------------------------------------- coverage report

def _load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return {}


def _tblock_gap_addresses(audit):
    """EAS address count on the zero-parcel T-block (the 0253T coverage gap).

    Derived live from the Wave 4 audit's per-T-block coverage table instead of
    a hardcoded constant: if the audit is ever re-run and the gap moves, this
    follows it. Returns None when the audit records no zero-parcel T-block
    (could not measure — investigate, don't invent a number).
    """
    tc = audit.get("orphans", {}).get("tblock_coverage", {})
    zero = [(b, v.get("eas_addresses")) for b, v in tc.items()
            if isinstance(v, dict) and v.get("parcels") == 0
            and isinstance(v.get("eas_addresses"), int)]
    if not zero:
        return None
    return max(zero, key=lambda z: z[1])[1]


def coverage_report():
    store = get_store()
    audit = _load_json(os.path.join(BASE, "data/wave4/audit.json"))
    parcels_total = len(store.parcels)
    active = sum(1 for p in store.parcels.values() if p.active)
    active_with = sum(1 for b, p in store.parcels.items()
                      if p.active and store.parcel_addr_count.get(b))
    addrs_total = len(store.linked)
    with_key = store.tier_counts.get("verified_parcel_key", 0)
    unit_rows = sum(1 for la in store.linked if la.address.is_unit)
    parcel_blocks = {p.block_num for p in store.parcels.values() if p.block_num}
    blocks_with_filings = sum(1 for b in parcel_blocks
                              if store.blocks.get(b) and
                              store.blocks[b].filing_count > 0)
    denom = audit.get("denominator", {})
    indep = audit.get("independent_sample", {})
    conflicts = audit.get("addrmap_conflicts", {})
    stats = CoverageStats(
        parcels_total=parcels_total,
        parcels_active=active,
        parcels_retired=parcels_total - active,
        pct_active_with_verified_address=round(100 * active_with / active, 2) if active else 0,
        addresses_total=addrs_total,
        addresses_with_parcel_key=with_key,
        pct_addresses_with_parcel_key=round(100 * with_key / addrs_total, 2),
        unit_rows=unit_rows,
        pct_unit_rows=round(100 * unit_rows / addrs_total, 2),
        parcel_blocks_total=len(parcel_blocks),
        blocks_with_filings=blocks_with_filings,
        pct_blocks_with_filings=round(100 * blocks_with_filings / len(parcel_blocks), 2)
        if parcel_blocks else 0,
        unmatched_no_parcel_key=store.tier_counts.get("unmatched_no_parcel", 0),
        unmatched_orphan_parcel_numbers=store.tier_counts.get("unmatched_orphan", 0),
        tblock_0253t_gap_addresses=_tblock_gap_addresses(audit),
        independent_sample_agreement=indep.get("agreement_rate"),
        addrmap_conflict_rate=conflicts.get("conflict_rate"),
        negative_controls_passed=_load_json(
            os.path.join(BASE, "data/wave3/stats.json")).get("negative_controls", {}).get("passed"),
    )
    return {
        "parcels": {
            "total": stats.parcels_total, "active": stats.parcels_active,
            "retired": stats.parcels_retired,
            "pct_active_with_verified_address": stats.pct_active_with_verified_address,
        },
        "addresses": {
            "total": stats.addresses_total,
            "with_parcel_key": stats.addresses_with_parcel_key,
            "pct_with_parcel_key": stats.pct_addresses_with_parcel_key,
            "unit_rows": stats.unit_rows,
            "pct_unit_rows": stats.pct_unit_rows,
        },
        "blocks": {
            "parcel_blocks_total": stats.parcel_blocks_total,
            "with_filings": stats.blocks_with_filings,
            "pct_with_filings": stats.pct_blocks_with_filings,
        },
        "unmatched_queues": {
            "no_parcel_key": stats.unmatched_no_parcel_key,
            "orphan_parcel_numbers": stats.unmatched_orphan_parcel_numbers,
            "tblock_0253T_gap_addresses": stats.tblock_0253t_gap_addresses,
        },
        "verification": {
            "independent_sample_agreement": stats.independent_sample_agreement,
            "addrmap_conflict_rate": stats.addrmap_conflict_rate,
            "wave3_negative_controls_passed": stats.negative_controls_passed,
        },
        "denominator_crosscheck": {
            "audit_active_with_address": denom.get("active_parcels_with_verified_address"),
            "store_active_with_address": active_with,
            "agree": denom.get("active_parcels_with_verified_address") == active_with,
        },
        "provenance": _provenance(store),
    }


# ----------------------------------------------------------------- wave status

def wave_status():
    def man(path):
        return _load_json(path)

    def ds_entry(m, title):
        pages = m.get("pages", [])
        rows = sum(p.get("rows", 0) for p in pages)
        expected = m.get("expected_rows")
        return {
            "dataset_id": m.get("dataset_id"), "title": title,
            "pages": len(pages), "rows": rows,
            "expected_rows": expected,
            "rows_match_expected": (rows == expected) if expected else None,
            "row_drift": (rows - expected) if expected else None,
            "file_sha256_16": str(m.get("file_sha256", ""))[:16],
            "source_host": m.get("source_host"),
            "retrieved_at": m.get("retrieved_at"),
            "completed_at": m.get("completed_at"),
        }

    w1 = man(os.path.join(BASE, "data/wave1/gdc7-dmcn.manifest.json"))
    w1e = ds_entry(w1, "Rent Board Housing Inventory")
    w1_note = ("2026-09-29 harvest: live row count grew +114 mid-harvest "
               "(551,244 -> 551,358); reconciled through the harvester resume "
               "path — manifest expected_rows now matches the snapshot.")
    if w1e["row_drift"]:
        w1_note += (f" CURRENT DRIFT: {w1e['row_drift']:+d} rows vs manifest "
                    "(rows=%d expected=%d) — re-harvest advised before "
                    "trusting wave-1 freshness."
                    % (w1e["rows"], w1e["expected_rows"]))
    waves = [{
        "wave": 1, "title": "Rent Board Housing Inventory harvest",
        "datasets": [w1e],
        "status": "complete" if w1.get("completed_at") else "incomplete",
        "note": w1_note,
    }]
    w2sets = []
    for dsid, title in [("8jwb-2stv", "Parcels - Active and Retired"),
                        ("ramy-di5m", "SF Addresses with Units"),
                        ("5mjj-njit", "Addresses with Parcel Number")]:
        w2sets.append(ds_entry(
            man(os.path.join(BASE, f"data/wave2/{dsid}.manifest.json")), title))
    waves.append({
        "wave": 2, "title": "Parcel + address harvest",
        "datasets": w2sets,
        "status": "complete" if all(d["completed_at"] for d in
                                    [man(os.path.join(BASE, f"data/wave2/{d}.manifest.json"))
                                     for d in ("8jwb-2stv", "ramy-di5m", "5mjj-njit")])
        else "incomplete",
    })
    w3stats = man(os.path.join(BASE, "data/wave3/stats.json"))
    waves.append({
        "wave": 3, "title": "Record linkage parcel<->address",
        "linkage_rows": w3stats.get("eas", {}).get("rows"),
        "tiers": w3stats.get("eas", {}).get("tiers"),
        "negative_controls_passed": w3stats.get("negative_controls", {}).get("passed"),
        "block_evidence_blocks": w3stats.get("rentboard", {}).get("distinct_blocks"),
        "completed_at": w3stats.get("finished_at"),
        "status": "complete",
    })
    audit = man(os.path.join(BASE, "data/wave4/audit.json"))
    waves.append({
        "wave": 4, "title": "Coverage audit + independent verification",
        "independent_sample_agreement": audit.get("independent_sample", {}).get("agreement_rate"),
        "orphans_total": audit.get("orphans", {}).get("total"),
        "addrmap_conflict_rate": audit.get("addrmap_conflicts", {}).get("conflict_rate"),
        "completed_at": audit.get("finished_at"),
        "status": "complete",
    })
    bman = man(os.path.join(BASE, "repo/sfledger/indexes/manifest.json"))
    waves.append({
        "wave": 5, "title": "Typed service layer + CLI + MCP",
        "derived_indexes": ["parcels.idx.json", "eas.idx.json", "blocks.idx.json"],
        "index_inputs_sha256_16": {k: v["sha256"][:16]
                                   for k, v in bman.get("inputs", {}).items()},
        "build_started_at": bman.get("started_at"),
        "build_finished_at": bman.get("finished_at"),
        "status": "complete" if bman.get("finished_at") else "incomplete",
    })
    return {"waves": waves,
            "provenance": _provenance(get_store())}


# --------------------------------------------------------------------- explain

def explain(query):
    store = get_store()
    kind, parcel, matches, block_num = _resolve(query, store)
    narrative = []
    caveats = []
    if kind == "none":
        narrative.append(f"Could not resolve '{query}' to any parcel or EAS address.")
        return {"found": False, "query": query,
                "suggestions": store.suggest_addresses(query),
                "narrative": narrative, "caveats": caveats,
                "provenance": _provenance(store)}
    if kind == "parcel":
        narrative.append(
            f"Resolved '{query}' to parcel blklot {parcel.blklot} "
            f"(block {parcel.block_num}, lot {parcel.lot_num}).")
        narrative.append(
            f"Parcel is {'ACTIVE' if parcel.active else 'RETIRED'} in the assessor file. "
            f"Zoning {parcel.zoning_code or 'unknown'}; neighborhood "
            f"{parcel.analysis_neighborhood or 'unknown'}.")
        if not parcel.active:
            caveats.append("Retired parcels may have been split/merged; "
                           "addresses can persist on retired parcels.")
        on_parcel = store.addresses_on_parcel(parcel.blklot)
        narrative.append(
            f"{len(on_parcel)} EAS address rows link to this parcel "
            f"({sum(1 for la in on_parcel if la.address.is_unit)} unit rows).")
    else:
        tiers = sorted({m.tier for m in matches})
        narrative.append(
            f"Resolved '{query}' to {len(matches)} EAS address row(s) "
            f"(linkage tiers present: {', '.join(tiers)}).")
        for m in matches[:5]:
            narrative.append(
                f"  - {m.address.address_text} [{m.address.eas_fullid}]: "
                f"tier={m.tier} ({m.tier_reason}); "
                f"parcel={m.parcel.blklot if m.parcel else 'none'}")
        if len(matches) > 5:
            narrative.append(f"  ... and {len(matches) - 5} more rows.")
        for m in matches:
            if m.tier == "unmatched_no_parcel":
                caveats.append(
                    "EAS carries no parcel keys for this address (city-data caveat; "
                    "~31% of EAS rows). It cannot be pinned to a parcel from these sources.")
                break
        for m in matches:
            pn = m.address.parcel_number or ""
            if m.tier == "unmatched_orphan" and pn.startswith("0253T"):
                caveats.append(
                    "Parcel number is on temporary block 0253T, which has 1,004 EAS "
                    "addresses but zero parcels in the assessor file — a quantified "
                    "coverage gap (Wave 4 audit).")
                break
    if block_num:
        bev = store.block_evidence(block_num)
        n = bev.filing_count if bev else 0
        narrative.append(
            f"Block {block_num}: {n} Rent Board inventory filing(s) "
            f"({', '.join(bev.submission_years) if bev and bev.submission_years else 'no years'}). "
            "This is block-level evidence only — filings are geo-masked and never "
            "attributed to a specific parcel or address.")
        if n == 0:
            caveats.append(
                "Zero filings on this block: either no covered units, non-filing "
                "stock, or a filing gap. Absence of filings proves nothing about "
                "legal rent-control status.")
    return {
        "found": True, "query": query,
        "disclaimer": RC_DISCLAIMER,
        "narrative": narrative,
        "caveats": caveats,
        "provenance": _provenance(store),
    }
