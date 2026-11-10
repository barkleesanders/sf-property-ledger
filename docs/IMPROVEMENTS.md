# Improvement backlog

Living list for the twice-weekly improvement loop. Check items off as they
land; append new findings at the bottom with dates. Never silently resolve a
disagreement — preserve it as a recorded conflict instead.

## Open

- [ ] **Dependabot medium alert #10: @hono/node-server in web/package-lock.json (2026-11-07)**: @hono/node-server >=1.19.10, <2.1.3 — `serveStatic` decodes the request path a second time, bypassing middleware on static paths (GHSA-rmxm-3fg6-px4f); patched in 2.1.3. Locked at 1.19.17 (`^1.14.1` in web/package.json). The patch is a MAJOR version bump (1.x → 2.x), so this needs a compatibility check of the dev-server entry (`web/src/index.tsx` uses @hono/node-server) before landing; production serves via the Worker bundle path, not node-server. Surfaced via the Dependabot API during the 2026-11-07 undici run.

## Landed

- 2026-11-10: **Dependabot high alert #9 resolved (zod)** — `web/package-lock.json` zod 4.6.5 → **4.6.7** (direct runtime dependency; `^4.6.5` in web/package.json unchanged — 4.6.7 is the current latest in range and includes the 4.6.6 patch for GHSA-mrhx-c7xc-m3w5, memory exhaustion validating oversized constrained collections); 3-line lockfile-only diff, no other packages changed. The VM's npm registry route is unreachable (curl to registry.npmjs.org returns 000, proven this run — the known sandbox egress block), so `npm update zod` ran on the Mini clone and the resulting lockfile plus the exact installed 4.6.7 package were synced back to the VM working tree for verification on the real bumped code: `npm run build:data` byte-identical across two consecutive runs AND identical to the pre-bump hashes (bundle.json `f1ccbc54…`, `_manifest.json` `f2087b58…`; 394 R2 objects / 113,521,583 bytes), parity 17/17 against the authoritative Python CLI, web faq tests 12/12, daemon parity 8/8, wide-event tests pass, observability lint pass, `tsc --noEmit` clean, and the canonical Python suite ALL PASS. zod is used only in `web/src/faq/faq-route.ts`; it does not touch the data pipeline or the CLI.

- 2026-11-07: **Dependabot undici alerts resolved (#3, #5, #6, #7, #8)** — `web/package.json` wrangler devDependency ^4.149.0 → ^4.158.0, pulling miniflare 5.20261006.1-alpha → 5.20261104.0-beta / workerd 1.20261104.1 and undici 7.29.1 → **7.30.1** in `web/package-lock.json`; 11 lockfile packages changed, all inside the wrangler/miniflare chain (transitive dev-side only, like the 2026-10-17 sharp alert). A Dependabot API check during this run found four further open undici alerts beyond the tracked #3 (GHSA-xjj6-f33q-929c) — #5 cache poisoning via cross-origin redirects, #6 TLS renegotiation DoS, #7 WebSocket PONG-buffering DoS (medium), #8 TLS validation bypass — and all five patch at exactly 7.30.1, so this one bump resolves all five. The bump was found already applied in the VM working tree (2026-11-07 09:20, uncommitted) and was verified end-to-end before landing, per the sharp precedent: `npm run build:data` byte-identical across two consecutive runs (bundle.json `f1ccbc54…`, `_manifest.json` `f2087b58…`; 394 R2 objects / 113,521,583 bytes), parity 17/17 against the authoritative Python CLI, web faq tests 12/12, daemon parity 8/8, wide-event tests pass, observability lint pass, `tsc --noEmit` clean, and the canonical Python suite ALL PASS. Neither wrangler nor undici touches the data pipeline, the CLI, or the Worker bundle path, so the alert is resolved with zero product risk.

- 2026-11-03: **link/link_wave3.py and audit/audit_wave4.py data-dir portability fixed** — both wave scripts now derive `REPO_DIR` from their own file location and resolve all Wave 1–4 snapshot inputs/outputs through `sfledger/data_dir.py` (`resolve_data_dir`: `SFLEDGER_DATA_DIR` env -> sibling `data/` -> VM default); `BASE` is kept as the repo's parent for backward compatibility and no longer locates data, and the VM goal path now lives only in `data_dir.py`. On the VM layout the resolved paths are byte-identical to the previously hardcoded ones. Proven end-to-end, not just at import: full Wave 3 rerun exit 0 with tiers identical to baseline (267,348 verified_parcel_key / 120,242 unmatched_no_parcel / 1,029 unmatched_orphan), all four negative controls passed, and `linkage.jsonl` byte-identical to the pre-rerun output; full Wave 4 audit rerun exit 0 with denominator (208,817/227,957 verified), 96% independent-sample agreement, and the single 7148COMA key-path anomaly all matching baseline — the fresh audit.json differs from the prior one only in timestamps, elapsed, and `code_sha256`. `SFLEDGER_DATA_DIR=/tmp/nope-data` override proven in both scripts. Regression checks in `tests/test_wave5.py`: no hardcoded VM goal path in either file, plus module-load checks that each script's `DATA_DIR` / input / output paths derive from the resolved data dir and its `REPO_DIR` is the clone root.
- 2026-10-31: **queries.py / build_indexes.py data-dir portability fixed** — new shared resolver `sfledger/data_dir.py`: `SFLEDGER_DATA_DIR` env override, then a sibling `data/` next to the repo, then the VM default (that string now lives only in data_dir.py), with a missing-dir fallback that surfaces `exists=False`. `queries.py` resolves all Wave 1–4 manifest/audit/stats reads through it, derives the Wave 5 index manifest from `store.REPO_DIR` (was `BASE/repo/...`, wrong on any non-VM clone), surfaces `data_dir` / `data_dir_source` / `data_dir_exists` in every result's provenance, and loads the files its numbers depend on via `_load_json_required` — a missing audit/stats/manifest now raises a named error instead of silently degrading to empty coverage/wave-status. `coverage_report()` / `wave_status()` also call `require_data_dir()` up front. `build_indexes.py` derives `REPO_DIR` from its own file location, resolves its snapshot inputs through the same resolver, records `data_dir` + `data_dir_source` in the build manifest, and preflights all four inputs — a missing snapshot exits 2 naming every missing path and the env remediation (proven with `SFLEDGER_DATA_DIR=/tmp/nope-data` in both import and script modes). On the VM layout the resolved paths are byte-identical to the previously hardcoded ones (sibling route). Regression checks in `tests/test_wave5.py`: no hardcoded VM goal path in either file, resolver env/sibling branches, `require_data_dir` loud failure, build_indexes path derivation, provenance surfacing.

- 2026-10-27: **store.py portability fixed** — `sfledger/store.py` now
  derives `REPO_DIR` from its own file location (`repo/sfledger/store.py`,
  the 2026-10-13 test-file pattern) instead of hardcoding
  `~/workspace/goals/sf-property-verification-ledger`; `DATA5` is the
  in-repo `sfledger/indexes/` under that root, `BASE` is kept as the
  repo's parent (identical value on the VM layout), and the
  IndexNotBuilt remediation message now points at the clone's own
  `build_indexes.py`. Worked by the improvement loop after the Wave
  5a/5b landings were checked off (the landing-paths hold no longer
  applies). Proven three ways: VM paths resolve identically to before;
  a relocated copy of the package under /tmp resolves DATA5 and its
  error message under /tmp; on the Mini clone `store.DATA5` now
  resolves inside ~/projects/sf-property-ledger instead of the VM path.
  Three new regression checks in `tests/test_wave5.py` (REPO_DIR
  derivation, DATA5 in-repo, no hardcoded VM goal path in store.py).
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
- 2026-10-17: **Dependabot high alert merged** — the sharp bump
  (0.35.4 → 0.35.5, transitive via miniflare; wrangler devDependency
  ^4.144.0 → ^4.149.0) was verified on the bumped tree before merging:
  `npm run build:data` byte-identical across two consecutive runs
  (bundle.json `e88d43a4…`, `_manifest.json` `5c457164…`), parity 17/17,
  web tests 12/12 faq + 8/8 daemon-parity, `tsc --noEmit` clean, and the
  canonical Python suite ALL PASS. Neither sharp nor wrangler touches the
  data pipeline, the CLI, or the Worker bundle path, so the alert is
  resolved with zero product risk.
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
