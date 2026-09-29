# SF Property Ledger

Every property in San Francisco, verified against public records — with
provenance, disagreement, and uncertainty preserved, not smoothed over.

Inspired by the SF Standard's analysis of ~463,000 SF Rent Board records:
filing activity is not the housing stock. This ledger keeps the two separate —
a denominator of every active Assessor parcel, joined against Rent Board
filings, with graded confidence on every link.

## Data sources (all public, via DataSF / Socrata)

| Dataset | Socrata ID | Rows (snapshot) |
|---|---|---|
| Rent Board Housing Inventory | `gdc7-dmcn` | 551,358 filings |
| Assessor Parcels | `8jwb-2stv` | 236,560 parcels (227,957 active) |
| Electronic Addresses (EAS) | `ramy-di5m` | 388,619 addresses |
| Address–Parcel Map | `5mjj-njit` | 221,130 rows |

Snapshots are content-hashed (SHA-256, per-page and full-file). Manifests live
in `manifests/`; the raw snapshots are too large for git and are reproduced by
re-running the harvesters.

## Waves

- **Wave 1** — Rent Board snapshot harvest (`harvest/wave1_rentboard.py`)
- **Wave 2** — Parcels + addresses harvest (`harvest/socrata_harvest.py`)
- **Wave 3** — Record linkage parcel↔address↔filings with confidence tiers
  (`link/link_wave3.py`): verified / reported / inferred / gap
- **Wave 4** — Independent coverage audit (`audit/audit_wave4.py`)
- **Wave 5** — Typed service layer + CLI + MCP server (`sfledger/`, `cli/`,
  `mcp/`), Hono frontend (`web/`)
- **Wave 6** — Release

All harvest/link/audit runs go through `harvest/run_supervised.sh`, which
restarts transient failures and records a `.FAILURE` marker on hard failure.

## Layout

```
harvest/     snapshot harvesters + supervised runner
link/        wave 3 record linkage
audit/       wave 4 coverage audit
sfledger/    typed Python service layer (wave 5a)
cli/         sfledger CLI (wave 5a)
mcp/         MCP server, stdio JSON-RPC (wave 5a)
web/         Hono frontend (wave 5b)
tests/       test suite
manifests/   hash-pinned manifests + audit stats (small files only)
docs/        research briefs, methodology
```

## Reproduce

```bash
python3 harvest/wave1_rentboard.py        # rent board snapshot
python3 harvest/socrata_harvest.py 8jwb-2stv
python3 link/link_wave3.py
python3 audit/audit_wave4.py
```

Each script verifies hashes of what it wrote. See `docs/` for methodology.

## Disclaimer

Rent Board filings measure **filing/reporting activity**, not legal
rent-control status. Nothing in this ledger is a legal determination about
any property. Block-level filing evidence is never attributed to a specific
parcel or address.
