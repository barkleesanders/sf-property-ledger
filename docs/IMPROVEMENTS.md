# Improvement backlog

Living list for the twice-weekly improvement loop. Check items off as they
land; append new findings at the bottom with dates. Never silently resolve a
disagreement — preserve it as a recorded conflict instead.

## Open

- [ ] **Dependabot alert (2026-10-13)**: GitHub reports 1 high-severity
  vulnerability on the default branch (security/dependabot/1), and this
  run's pull fetched a new `dependabot/npm_and_yarn/web/npm_and_yarn-*`
  branch. Review the alert/PR, verify any bump keeps `npm run build:data`
  deterministic and parity 17/17, then merge or dismiss with a reason.

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
- 2026-10-13: VM test env DECIDED — the direct runner is now the official
  standard, not pytest. Evidence re-verified 2026-10-13 on the VM:
  `python3 -m pytest` → no module; `pip install pytest` → PEP 668
  externally-managed block; `apt-cache policy python3-pytest` → no
  candidate (the apt route the 2026-10-10 item proposed does not exist
  on this VM). New `tests/run_tests.py` is the canonical stdlib-only
  runner (wave5 + supervisor suites, live-streamed, exit 0 only if all
  pass; full run green: wave5 ALL PASS in 236s, supervisor PASS).
  `tests/README.md` documents the suites and rationale; a new
  `tests/conftest.py` guard makes any pytest invocation abort with a
  usage error pointing at the canonical runner instead of collecting
  0 tests from the harness-style suite and looking like a result.
  Also: `test_wave5.py` now derives the repo root from its own file
  location instead of a hardcoded VM path (identical resolution on
  the VM, portable to the Mini clone), and `.pytest_cache/` is
  gitignored. Web tests unchanged (`npm test` 12/12 this run).
- 2026-10-10: web/ ServiceAdapter persistent daemon — new
  `web/scripts/cli-daemon.py` loads the ~98MB Wave 5a indexes once and
  answers newline-delimited JSON requests on stdin (calls the same
  `sfledger.queries` functions as `cli/sfledger`, so outputs are identical
  by construction). `ServiceAdapter` (`web/src/adapter.ts`) now multiplexes
  queries over the single daemon with per-request timeout, auto-respawn,
  one retry on daemon death, and fallback to per-request `execFile` spawns
  when the daemon cannot start (or when SFLEDGER_CLI points at a custom CLI
  binary). Measured 2026-10-10 on the VM: cold `cli/sfledger waves` = 33.9s;
  daemon answers post-warmup queries in milliseconds. Parity proven by new
  `npm run test:daemon` (8 subcommand cases daemon-vs-CLI deep-equal + 3
  protocol-robustness cases, all pass); `tsc --noEmit` clean; faq tests
  12/12; full test_wave5.py suite green. Production untouched — worker.ts
  still serves only the R2 bundle path.
