# sfledger — MCP + CLI contract (Wave 5 target)

One typed service layer; the CLI and the MCP server are thin shells over it.
All responses are deterministic JSON. Every factual claim carries provenance
(dataset id, row id, retrieved_at, confidence tier).

## Confidence tiers (encode Rao's "stock vs filing propensity" problem)
- `verified` — parcel pinned by assessor record AND corroborated by ≥2 independent sources
- `reported` — appears in Rent Board inventory filings (filing exists, not proof of legal status)
- `inferred` — block-level fuzzy linkage only (block_num / point-in-polygon)
- `gap` — expected record missing (e.g. pre-1979 apartment building with zero filings)

## Tools / commands

| MCP tool | CLI | Input | Output |
|---|---|---|---|
| `lookup_address` | `sfledger address "<addr>"` | free-text SF address | canonical profile: EAS ids, parcel (blklot), unit count, geometry refs, tier per field |
| `lookup_parcel` | `sfledger parcel <blklot>` | block/lot (e.g. `1753/001`) | same profile from the parcel side; active/retired status, zoning |
| `rent_control_evidence` | `sfledger rc <addr\|blklot>` | address or blklot | inventory filing rows (years, occupancy, rent buckets), case-type mix, tier=`reported`; explicit disclaimer: evidence of filing, NOT a legal rent-control determination |
| `filing_gap` | `sfledger gaps [--neighborhood N]` | optional area filter | pre-1979 apartment buildings with zero inventory filings (the "blank zones" Rao found), ranked |
| `coverage_report` | `sfledger coverage` | — | citywide: parcels total/active, % with EAS addresses, % addresses with units, % buildings with ≥1 filing, unmatched-queue sizes |
| `wave_status` | `sfledger waves` | — | per-wave manifest: rows, sha256, retrieved_at, row-count reconciliation vs expected |
| `explain` | `sfledger explain <addr\|blklot>` | address or blklot | why this record is verified / uncertain / unmatched / stale — the provenance narrative |

## Non-goals
- No legal conclusions about rent-control applicability (that needs the Rent Board / a lawyer).
- No owner PII beyond what's in the public assessor roll.
- No writes to any city system. Read-only ledger.

## Status
Contract drafted 2026-09-29. Implementation starts at Wave 5, after the linkage
(Wave 3) and tier assignment (Wave 4) it depends on.
