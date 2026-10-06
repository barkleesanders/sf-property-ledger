"""Wave 5 shared service layer: typed models for the SF property ledger.

Tiers use the Wave 3 linkage vocabulary (verified_parcel_key /
unmatched_no_parcel / unmatched_orphan) — see repo/link/link_wave3.py.
Rent Board filings are EVIDENCE of filing activity, never conclusive legal
rent-control determinations.
"""

from dataclasses import asdict, dataclass, field
from typing import List, Optional

# Shown on every rent_control_evidence response. Non-negotiable.
RC_DISCLAIMER = (
    "Rent Board inventory filings are evidence of filing activity only. "
    "They are NOT a conclusive legal determination of rent-control applicability. "
    "A filing's existence (or absence) does not prove a unit is (or is not) "
    "covered by the SF Rent Ordinance. Legal status requires the SF Rent Board "
    "or a qualified attorney."
)

BLOCK_LEVEL_NOTE = (
    "Filing addresses are geo-masked to the block by the Rent Board. "
    "Block-level filing evidence is never attributed to a specific parcel or address."
)


@dataclass
class Parcel:
    blklot: str
    block_num: str
    lot_num: str
    active: bool
    street_name: str
    street_type: str
    from_address_num: Optional[int]
    to_address_num: Optional[int]
    zoning_code: str
    zoning_district: str
    analysis_neighborhood: str
    centroid_lat: Optional[float]
    centroid_lon: Optional[float]


@dataclass
class Address:
    eas_fullid: str
    eas_baseid: str
    address_text: str
    parcel_number: Optional[str]
    block: Optional[str]
    lot: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    is_unit: bool


@dataclass
class LinkedAddress:
    address: Address
    tier: str  # verified_parcel_key | unmatched_no_parcel | unmatched_orphan
    tier_reason: str
    parcel: Optional[Parcel]
    parcel_active: Optional[bool]


@dataclass
class BlockEvidence:
    block_num: str
    filing_count: int
    submission_years: List[str]
    case_types: List[str]
    block_in_parcel_index: bool
    occupancy_mix: dict
    rent_buckets: dict
    bedroom_mix: dict
    year_built_min: Optional[str]
    year_built_max: Optional[str]
    year_built_pre1979: int
    year_built_post1979: int
    year_built_unknown: int
    sample_filings: List[dict]
    address_count: int = 0
    unit_count: int = 0
    parcel_count: int = 0
    neighborhoods: List[str] = field(default_factory=list)


@dataclass
class CoverageStats:
    parcels_total: int
    parcels_active: int
    parcels_retired: int
    pct_active_with_verified_address: float
    addresses_total: int
    addresses_with_parcel_key: int
    pct_addresses_with_parcel_key: float
    unit_rows: int
    pct_unit_rows: float
    parcel_blocks_total: int
    blocks_with_filings: int
    pct_blocks_with_filings: float
    unmatched_no_parcel_key: int
    unmatched_orphan_parcel_numbers: int
    tblock_0253t_gap_addresses: Optional[int]
    independent_sample_agreement: Optional[float]
    addrmap_conflict_rate: Optional[float]
    negative_controls_passed: Optional[bool]


@dataclass
class Provenance:
    datasets: List[dict]  # [{dataset_id, snapshot_sha256_16, rows}]
    generated_at: str
    code: str = "sfledger wave5"


def to_dict(obj):
    return asdict(obj)
