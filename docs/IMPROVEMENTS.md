# Improvement backlog

Living list for the twice-weekly improvement loop. Check items off as they
land; append new findings at the bottom with dates. Never silently resolve a
disagreement — preserve it as a recorded conflict instead.

## Open

- [ ] **web/ ServiceAdapter (dev-server only)**: per-request CLI spawns reload
  the indexes (~31s measured on the VM 2026-10-03); the 15-min/Infinity
  in-process cache already mitigates repeat hits. Production never uses this
  path (Workers serve the precomputed R2 bundle — see superseded item below),
  so this is local-dev ergonomics only. Optimize (persistent subprocess or
  socket) only if dev iteration latency becomes a bottleneck.
  (2026-10-06 data point: full test_wave5.py CLI leg shows 27–43s per
  `cli/sfledger` invocation, each reloading the 98MB index from disk —
  consistent with the ~31s figure; still dev-only.)

## Landed

- 2026-09-29: initial commit — waves 1–4 harvesters, linkage, audit,
  hash-pinned manifests, CONTRACT.md, research brief.
- 2026-09-29: Wave 1 manifest drift reconciled through the harvester
  (commit 401ac0a) — resume path refreshes `expected_rows` from the live
  count; manifest now 551,358 = 551,358.
- 2026-09-29: Wave 4 audit script defects fixed (commit 401ac0a) —
  parcel block set keyed on `block_num`, anomaly guard catches 7148COMA;
  full audit rerun green.
- 2026-09-29: supervisor nested-logdir test written and passing
  (commit 401ac0a), incl. negative control.
- 2026-09-29: Wave 5a landing (commit 522c136) — typed service layer,
  CLI (7/7 commands), MCP (7 tools), 38/38 tests against real data.
- 2026-09-30: Wave 5b landing (commit 401ac0a) — Hono web app deployed to
  Cloudflare Workers production
  (https://sf-property-ledger.barkleesanders.workers.dev); parity 17/17,
  deterministic builds, R2-backed routes verified live.
- 2026-10-03: web/ ServiceAdapter "optimize before public launch" item
  SUPERSEDED — the public launch (2026-09-30) serves via bundle/R2 mode and
  never spawns the CLI per request (verified: no child_process in the worker
  path; live `/api/mode` returns `{"mode":"bundle"}`). ServiceAdapter is
  dev-server-only; rescoped as a dev-ergonomics item above.
- 2026-10-03: test_wave5.py guards repaired — the collection-time checks had
  been red since the 2026-09-29 REPAIR 1/2 runs (mtime-based "untouched"
  guard tripped by legitimate manifest/audit refreshes; drift assertion
  still expected the pre-repair +114). The drift check now pins the
  reconciled state (551,358 = 551,358, drift 0) and the data guard compares
  content hashes against the index manifest's pinned input sha256s instead
  of mtimes. Full suite green again.
- 2026-10-06: `queries.py` edge-case coverage raised (T-block handling,
  orphan parcel identifiers, retired-parcel relationships) — 7 new checks
  in test_wave5.py using real fixtures (retired parcel 3537059, orphan
  address 1501 GREAT HWY, T-block parcel 0452T044H). Also fixed two
  staleness bugs the new tests caught: (1) `wave_status()` wave-1 note still
  claimed "manifest expected_rows is stale" after REPAIR 1 reconciled it —
  note now states the reconciled history and only warns on live drift;
  (2) `coverage_report()` hardcoded `tblock_0253t_gap_addresses=1004` —
  now derived from the Wave 4 audit's per-T-block coverage table
  (`CoverageStats.tblock_0253t_gap_addresses` widened to Optional[int];
  returns None = could-not-measure if the audit shape changes).
