#!/usr/bin/env python3
"""Wave 5 service layer: lazy in-memory store over the compact Wave 5 indexes.

Loads repo/sfledger/indexes/*.idx.json (built once by build_indexes.py) into compact
Python structures. Raises IndexNotBuilt with a clear remediation if the
derived indexes are missing — it never silently re-streams the raw snapshots.

Read-only: this module never writes to data/.
"""

import json
import os
import re
from datetime import datetime, timezone

from sfledger.models import Address, BlockEvidence, LinkedAddress, Parcel

BASE = os.path.expanduser("~/workspace/goals/sf-property-verification-ledger")
REPO_DIR = os.path.join(BASE, "repo")
DATA5 = os.path.join(REPO_DIR, "sfledger", "indexes")

PARCEL_FIELDS = ["blklot", "block_num", "lot_num", "active", "street_name",
                 "street_type", "from_n", "to_n", "zoning_code",
                 "zoning_district", "analysis_neighborhood", "lat", "lon"]
EAS_FIELDS = ["eas_fullid", "eas_baseid", "address", "parcel_number", "block",
              "lot", "tier", "blklot", "parcel_active", "lat", "lon", "is_unit"]


class IndexNotBuilt(Exception):
    pass


def normalize_address(s):
    """Uppercase, collapse whitespace, strip. Deterministic."""
    s = (s or "").upper()
    s = re.sub(r"\s+", " ", s).strip()
    s = s.rstrip(".")
    return s


def normalize_blklot(q):
    """Accept '0189001A', '0189/001A', '1753/001', '1753/1' -> canonical blklot."""
    q = (q or "").strip().upper().replace(" ", "")
    if "/" in q:
        block, lot = q.split("/", 1)
        if block.isdigit():
            block = block.zfill(4)
        if lot and lot[0].isdigit():
            # numeric lots are zero-padded to 3 in the parcel file ('001')
            m = re.match(r"^(\d+)(.*)$", lot)
            if m:
                lot = m.group(1).zfill(3) + m.group(2).upper()
        else:
            lot = lot.upper()
        return block + lot
    return q


def _load_idx(name):
    path = os.path.join(DATA5, name)
    if not os.path.exists(path):
        raise IndexNotBuilt(
            f"{path} is missing. Build the derived indexes once with: "
            "python3 ~/workspace/goals/sf-property-verification-ledger/repo/sfledger/build_indexes.py"
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class LedgerStore:
    def __init__(self):
        t0 = datetime.now(timezone.utc)
        p = _load_idx("parcels.idx.json")
        e = _load_idx("eas.idx.json")
        b = _load_idx("blocks.idx.json")

        self.parcels = {}            # blklot -> Parcel
        self.parcels_by_block = {}   # block_num -> [blklot]
        for row in p["rows"]:
            d = dict(zip(PARCEL_FIELDS, row))
            parcel = Parcel(
                blklot=d["blklot"], block_num=d["block_num"], lot_num=d["lot_num"],
                active=bool(d["active"]), street_name=d["street_name"] or "",
                street_type=d["street_type"] or "",
                from_address_num=d["from_n"], to_address_num=d["to_n"],
                zoning_code=d["zoning_code"] or "",
                zoning_district=d["zoning_district"] or "",
                analysis_neighborhood=d["analysis_neighborhood"] or "",
                centroid_lat=d["lat"], centroid_lon=d["lon"])
            self.parcels[d["blklot"]] = parcel
            self.parcels_by_block.setdefault(d["block_num"], []).append(d["blklot"])

        self.linked = []             # list[LinkedAddress], index-aligned with eas rows
        self.addr_index = {}         # normalized address -> [idx]
        self.by_fullid = {}
        for i, row in enumerate(e["rows"]):
            d = dict(zip(EAS_FIELDS, row))
            addr = Address(
                eas_fullid=d["eas_fullid"], eas_baseid=d["eas_baseid"] or "",
                address_text=d["address"] or "",
                parcel_number=d["parcel_number"] or None,
                block=d["block"] or None, lot=d["lot"] or None,
                latitude=d["lat"], longitude=d["lon"],
                is_unit=bool(d["is_unit"]))
            parcel = self.parcels.get(d["blklot"]) if d["blklot"] else None
            pa = d["parcel_active"]
            la = LinkedAddress(
                address=addr, tier=d["tier"] or "unmatched_no_parcel",
                tier_reason=e.get("tier_reasons", {}).get(d["tier"], ""),
                parcel=parcel,
                parcel_active=True if pa == 1 else (False if pa == 0 else None))
            self.linked.append(la)
            self.by_fullid[d["eas_fullid"]] = i
            key = normalize_address(d["address"])
            if key:
                self.addr_index.setdefault(key, []).append(i)

        self.blocks = {}             # block_num -> BlockEvidence
        for bnum, bd in b.items():
            self.blocks[bnum] = BlockEvidence(
                block_num=bnum, filing_count=bd["filing_count"],
                submission_years=bd["submission_years"],
                case_types=bd["case_types"],
                block_in_parcel_index=bd["block_in_parcel_index"],
                occupancy_mix=bd["occupancy_mix"], rent_buckets=bd["rent_buckets"],
                bedroom_mix=bd["bedroom_mix"],
                year_built_min=bd["year_built_min"],
                year_built_max=bd["year_built_max"],
                year_built_pre1979=bd["year_built_pre1979"],
                year_built_post1979=bd["year_built_post1979"],
                year_built_unknown=bd["year_built_unknown"],
                sample_filings=bd["sample_filings"],
                address_count=bd["address_count"], unit_count=bd["unit_count"],
                parcel_count=bd["parcel_count"],
                neighborhoods=bd["neighborhoods"])

        try:
            with open(os.path.join(DATA5, "manifest.json"),
                      encoding="utf-8") as f:
                self.build_manifest = json.load(f)
        except OSError:
            self.build_manifest = {}
        self.loaded_at = t0.isoformat()

        # parcel -> address counts (one pass over linked addresses)
        self.parcel_addr_count = {}
        self.parcel_unit_count = {}
        self.tier_counts = {}
        for la in self.linked:
            self.tier_counts[la.tier] = self.tier_counts.get(la.tier, 0) + 1
            if la.parcel is not None:
                b = la.parcel.blklot
                self.parcel_addr_count[b] = self.parcel_addr_count.get(b, 0) + 1
                if la.address.is_unit:
                    self.parcel_unit_count[b] = self.parcel_unit_count.get(b, 0) + 1

    # ---- lookups ----
    def find_addresses(self, query):
        """Exact normalized match; falls back to base-address (strip unit)."""
        key = normalize_address(query)
        idxs = self.addr_index.get(key, [])
        if not idxs and "#" in key:
            idxs = self.addr_index.get(key.split("#")[0].strip(), [])
        return [self.linked[i] for i in idxs]

    def suggest_addresses(self, query, limit=5):
        """Rank base addresses by how many query tokens they contain.

        At least one token must hit; ties break toward shorter addresses.
        Deterministic: iteration order follows the index build order.
        """
        tokens = [t for t in normalize_address(query).split() if len(t) >= 3]
        if not tokens:
            return []
        import re
        pats = [(t, re.compile(r"\b" + re.escape(t))) for t in tokens]
        scored = []
        seen = set()
        for la in self.linked:
            if la.address.is_unit:
                continue
            a = normalize_address(la.address.address_text)
            if a in seen:
                continue
            seen.add(a)
            hits = 0
            for t, pat in pats:
                if pat.search(a):
                    hits += 2        # token starts at a word boundary
                elif t in a:
                    hits += 1        # token embedded mid-word
            if hits:
                scored.append((hits, len(a), a))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [a for _, _, a in scored[:limit]]

    def find_parcel(self, query):
        return self.parcels.get(normalize_blklot(query))

    def addresses_on_parcel(self, blklot, include_units=True):
        return [la for la in self.linked
                if la.parcel is not None and la.parcel.blklot == blklot
                and (include_units or not la.address.is_unit)]

    def block_evidence(self, block_num):
        return self.blocks.get((block_num or "").strip().upper())


_store = None


def get_store():
    global _store
    if _store is None:
        _store = LedgerStore()
    return _store
