# Improvement backlog

Living list for the twice-weekly improvement loop. Check items off as they
land; append new findings at the bottom with dates. Never silently resolve a
disagreement — preserve it as a recorded conflict instead.

## Open

- [ ] **Wave 1 manifest drift**: `manifests/gdc7-dmcn.manifest.json`
  `expected_rows` is 551,244 but the supervised harvester logged 551,358 rows
  (live count grew mid-harvest). Fix through the harvester reconciliation
  logic and rerun — do not hand-edit the manifest.
- [ ] **Wave 4 audit script defect**: `audit/audit_wave4.py` reads a
  nonexistent parcel field `block` instead of `block_num`, falsely marking all
  T-blocks absent; its anomaly logic also returns zero for the `7148COMA`
  split case that Wave 3 correctly counted. Fix the source, rerun through
  `harvest/run_supervised.sh`, regenerate outputs + hashes.
- [ ] **Supervisor mkdir repair untested**: `harvest/run_supervised.sh` was
  patched to create its log directory, but the repair was never exercised
  against a genuinely absent nested log directory. Test it.
- [ ] **Wave 5a landing**: commit `sfledger/`, `cli/`, `mcp/`, `tests/` once the
  Wave 5a worker finishes and passes the evidence gate (all 7 CLI commands
  validated against real data, MCP tools/list + tools/call, legal disclaimer
  on rent-control evidence, block evidence never parcel-attributed).
- [ ] **Wave 5b landing**: commit `web/` (Hono app) once the Wave 5b worker
  finishes and passes the evidence gate (all API + HTML routes 200,
  ServiceAdapter in full-data mode, SAMPLE DATA badge only in fallback,
  mobile 320/375/414/768px checks).
- [ ] **web/ ServiceAdapter performance**: per-request CLI spawns reload
  indexes; acceptable initially, but profile and optimize (persistent
  subprocess or socket) before public launch.
- [ ] **Coverage**: raise test coverage for `queries.py` edge cases —
  T-block handling, orphan parcel identifiers, retired-parcel relationships.

## Landed

- 2026-09-29: initial commit — waves 1–4 harvesters, linkage, audit,
  hash-pinned manifests, CONTRACT.md, research brief.
