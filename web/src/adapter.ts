/** Data adapter for the SF property ledger web app.
 *
 * Three modes, one interface:
 *  - ServiceAdapter: shells out to the Wave 5a CLI (repo/cli/sfledger),
 *    which is the shared typed service layer. JSON in, JSON out.
 *    Per-request CLI spawn reloads the indexes (~30s); results are
 *    cached aggressively in-process. Dev-server only — production Workers
 *    serve the precomputed bundle via BundleAdapter/WorkerDataAdapter and
 *    never spawn the CLI.
 *  - BundleAdapter: serves the precomputed real-data bundle
 *    (web/src/data/bundle.json, built by `npm run build:data`) plus lookup
 *    shards. Local/production path; no CLI, no sample badge.
 *  - SampleAdapter: serves baked REAL rows from sample_data.json
 *    (500 real linkage rows + real EAS/parcel/block-evidence/filing rows).
 *    Used when the CLI cannot run. Every surface shows a SAMPLE DATA badge.
 *
 * Mode is auto-detected once at startup: if `sfledger waves` returns valid
 * JSON, the CLI is alive and we use the service. Otherwise bundle, then
 * sample as the local-dev fallback.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BundleAdapter } from "./data-adapter.js";
import type { Mode } from "./app.js";

export type { Mode };

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(THIS_DIR, "..");
const REPO_DIR = join(WEB_DIR, "..");
const DATA_DIR = join(REPO_DIR, "..", "data");
const CLI_PATH = process.env.SFLEDGER_CLI || join(REPO_DIR, "cli", "sfledger");
const SAMPLE_PATH = join(WEB_DIR, "sample_data.json");

export const RC_DISCLAIMER =
  "Rent Board inventory filings are evidence of filing activity only. " +
  "They are NOT a conclusive legal determination of rent-control applicability. " +
  "A filing's existence (or absence) does not prove a unit is (or is not) " +
  "covered by the SF Rent Ordinance. Legal status requires the SF Rent Board " +
  "or a qualified attorney.";

export const BLOCK_LEVEL_NOTE =
  "Filing addresses are geo-masked to the block by the Rent Board. " +
  "Block-level filing evidence is never attributed to a specific parcel or address.";

// ------------------------------------------------------------------ CLI shell

function runCli(args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      CLI_PATH,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, _stderr) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

// --------------------------------------------------------------------- cache

interface CacheEntry {
  v: unknown;
  t: number;
}
const cache = new Map<string, CacheEntry>();
const LOOKUP_TTL_MS = 15 * 60 * 1000;

async function cached(key: string, ttlMs: number, fn: () => Promise<unknown>): Promise<unknown> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { v, t: Date.now() });
  return v;
}

// ------------------------------------------------------------ service adapter

class ServiceAdapter {
  private call(cmd: string[]): Promise<unknown> {
    const key = `svc:${JSON.stringify(cmd)}`;
    const ttl = cmd[0] === "coverage" || cmd[0] === "waves" || cmd[0] === "gaps" ? Infinity : LOOKUP_TTL_MS;
    return cached(key, ttl, async () => {
      const out = await runCli(cmd);
      const parsed = JSON.parse(out) as Record<string, unknown>;
      return { ...parsed, mode: "service" as Mode };
    });
  }

  lookupAddress(q: string): Promise<unknown> {
    return this.call(["address", q]);
  }
  lookupParcel(q: string): Promise<unknown> {
    return this.call(["parcel", q]);
  }
  rentControlEvidence(q: string): Promise<unknown> {
    return this.call(["rc", q]);
  }
  filingGap(neighborhood: string | undefined, limit: number): Promise<unknown> {
    const args = ["gaps", "--limit", String(limit)];
    if (neighborhood) args.push("--neighborhood", neighborhood);
    return this.call(args);
  }
  coverageReport(): Promise<unknown> {
    return this.call(["coverage"]);
  }
  waveStatus(): Promise<unknown> {
    return this.call(["waves"]);
  }
  explain(q: string): Promise<unknown> {
    return this.call(["explain", q]);
  }
}

// ------------------------------------------------------------- sample adapter

interface SampleData {
  baked_at: string;
  linkage: Array<{ tier: string; reason: string; eas_fullid: string; blklot: string | null }>;
  eas: Array<Record<string, unknown>>;
  parcels: Record<string, Record<string, unknown>>;
  block_evidence: Array<Record<string, unknown>>;
  filings: Array<Record<string, unknown>>;
  gap_blocks: Array<Record<string, unknown>>;
  total_gap_blocks: number;
  coverage: Record<string, unknown>;
  waves: Array<{ wave: number; dataset: string | null; rows: number | null; expected_rows: number | null; reconciled: boolean | null; sha256: string | null; retrieved_at: string }>;
}

function normAddr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function normBlklot(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

class SampleAdapter {
  private data: SampleData;

  constructor() {
    const raw = JSON.parse(readFileSync(SAMPLE_PATH, "utf8")) as Record<string, any>;
    // bake_sample.py writes eas and block_evidence as dicts keyed by id;
    // normalize to arrays so the query code below works uniformly.
    const asArray = (v: unknown): Array<Record<string, unknown>> =>
      Array.isArray(v) ? (v as Array<Record<string, unknown>>) : (Object.values(v as Record<string, unknown>) as Array<Record<string, unknown>>);
    this.data = {
      ...(raw as SampleData),
      eas: asArray(raw.eas),
      block_evidence: asArray(raw.block_evidence),
    };
  }

  private provenance(): Record<string, unknown> {
    return {
      mode: "sample",
      source: "sample_data.json (500 real rows baked from Wave 1-4 snapshots)",
      baked_at: this.data.baked_at,
    };
  }

  private withMode<T extends Record<string, unknown>>(obj: T): T & { mode: Mode } {
    return { ...obj, mode: "sample" as Mode };
  }

  private linkRowsFor(easFullid: string) {
    return this.data.linkage.filter((l) => l.eas_fullid === easFullid);
  }

  private easByFullid(fullid: string) {
    return this.data.eas.find((e) => e.eas_fullid === fullid);
  }

  private blockEvidence(blockNum: string) {
    return this.data.block_evidence.find((b) => b.block_num === blockNum);
  }

  private matchObjects(easRows: Array<Record<string, unknown>>) {
    // Flat shape, mirroring the CLI's _linked_dict so views work in both modes.
    return easRows.map((e) => {
      const link = this.linkRowsFor(String(e.eas_fullid))[0];
      const blklot = link?.blklot ?? (typeof e.parcel_number === "string" ? normBlklot(e.parcel_number as string) : null);
      const parcel = blklot ? this.data.parcels[blklot] ?? null : null;
      const addr = String(e.address ?? "");
      return {
        eas_fullid: e.eas_fullid,
        eas_baseid: e.eas_baseid,
        address: addr,
        is_unit: addr.includes("#") || ` ${addr.toUpperCase()} `.includes(" UNIT "),
        parcel_number: e.parcel_number,
        block: e.block,
        lot: e.lot,
        latitude: e.latitude,
        longitude: e.longitude,
        tier: link?.tier ?? "unmatched_no_parcel",
        tier_reason: link?.reason ?? "no linkage row in sample",
        parcel_active: parcel ? (parcel as Record<string, unknown>).active ?? null : null,
        parcel,
      };
    });
  }

  async lookupAddress(q: string): Promise<unknown> {
    return this.lookupAddressSync(q);
  }

  private lookupAddressSync(q: string): Record<string, unknown> {
    const tokens = normAddr(q).split(" ").filter(Boolean);
    const rows = tokens.length
      ? this.data.eas.filter((e) => {
          const hay = normAddr(String(e.address ?? ""));
          return tokens.every((t) => hay.includes(t));
        })
      : [];
    if (!rows.length) {
      return this.withMode({
        found: false,
        query: q,
        normalized: normAddr(q),
        suggestions: this.data.eas.slice(0, 5).map((e) => String(e.address)),
        note: "No EAS address matched in the 500-row sample. In service mode this searches all 388,619 addresses.",
        provenance: this.provenance(),
      });
    }
    const matches = this.matchObjects(rows.slice(0, 100));
    const tiers = [...new Set(matches.map((m) => m.tier))].sort();
    const parcels = [...new Set(matches.map((m) => (m.parcel ? String(m.parcel.blklot) : null)).filter(Boolean))];
    return this.withMode({
      found: true,
      query: q,
      normalized: normAddr(q),
      match_count: rows.length,
      matches_truncated: rows.length > 100,
      tiers_present: tiers,
      matches,
      parcel_summary:
        parcels.length === 1
          ? { blklot: parcels[0], addresses_on_parcel: "sample only" }
          : { multiple_parcels: true, parcels_present: parcels.slice(0, 10) },
      filing_note: "For filing evidence use rent_control_evidence: " + BLOCK_LEVEL_NOTE,
      provenance: this.provenance(),
    });
  }

  async lookupParcel(q: string): Promise<unknown> {
    const key = normBlklot(q);
    const parcel = this.data.parcels[key] ?? null;
    if (!parcel) {
      return this.withMode({
        found: false,
        query: q,
        normalized: key,
        note: "No parcel with that blklot in the 500-row sample. In service mode this searches all 236,560 parcels.",
        provenance: this.provenance(),
      });
    }
    const onParcel = this.data.eas.filter((e) => {
      const link = this.linkRowsFor(String(e.eas_fullid))[0];
      return link?.blklot === key;
    });
    const base = [...new Set(onParcel.map((e) => String(e.address)))].slice(0, 10);
    const bev = this.blockEvidence(String(parcel.block_num));
    return this.withMode({
      found: true,
      query: q,
      normalized: key,
      parcel,
      addresses: {
        count: onParcel.length,
        units: onParcel.filter((e) => String(e.address).match(/\b(unit|apt|#)\b/i)).length,
        tiers_present: [...new Set(onParcel.map((e) => this.linkRowsFor(String(e.eas_fullid))[0]?.tier ?? "unknown"))],
        base_addresses_sample: base,
      },
      block_filings: {
        scope: "block-level only",
        block_num: parcel.block_num,
        filing_count: bev?.filing_count ?? 0,
        submission_years: bev?.submission_years ?? [],
        note: BLOCK_LEVEL_NOTE,
      },
      provenance: this.provenance(),
    });
  }

  private resolveBlock(q: string): { kind: string; blockNum: string | null; matches: Array<Record<string, unknown>> } {
    const key = normBlklot(q);
    const parcel = this.data.parcels[key];
    if (parcel) return { kind: "parcel", blockNum: String(parcel.block_num), matches: [] };
    const res = this.lookupAddressSync(q);
    if (!res.found) return { kind: "none", blockNum: null, matches: [] };
    const matches = res.matches as Array<Record<string, unknown>>;
    const blocks = [...new Set(matches.map((m) => String(m.block ?? "")))].filter(Boolean);
    return { kind: "address", blockNum: blocks.length === 1 ? blocks[0] : null, matches };
  }

  async rentControlEvidence(q: string): Promise<unknown> {
    const { kind, blockNum, matches } = this.resolveBlock(q);
    if (kind === "none" || !blockNum) {
      return this.withMode({
        found: false,
        query: q,
        disclaimer: RC_DISCLAIMER,
        note: "Could not resolve to a single block in the 500-row sample.",
        provenance: this.provenance(),
      });
    }
    const bev = this.blockEvidence(blockNum) ?? null;
    const sampleFilings = this.data.filings.filter((f) => String(f.block_num) === blockNum).slice(0, 3);
    return this.withMode({
      found: true,
      query: q,
      disclaimer: RC_DISCLAIMER,
      resolved: { kind, block_num: blockNum, match_count: matches.length || undefined },
      block: {
        block_num: blockNum,
        scope: "block-level filing evidence only",
        filing_count: bev?.filing_count ?? 0,
        submission_years: bev?.submission_years ?? [],
        case_types: bev?.case_types ?? [],
        occupancy_mix: bev?.occupancy_mix ?? {},
        rent_buckets: bev?.rent_buckets ?? {},
        bedroom_mix: bev?.bedroom_mix ?? {},
        sample_filings: sampleFilings,
        block_in_parcel_index: true,
        note: BLOCK_LEVEL_NOTE,
      },
      provenance: this.provenance(),
    });
  }

  async filingGap(neighborhood: string | undefined, limit: number): Promise<unknown> {
    let gaps = this.data.gap_blocks;
    if (neighborhood) {
      const n = neighborhood.toLowerCase();
      gaps = gaps.filter((g) => String(g.neighborhoods ?? "").toLowerCase().includes(n));
    }
    return this.withMode({
      disclaimer: RC_DISCLAIMER,
      method:
        "Blocks with zero Rent Board inventory filings, ranked by EAS unit-address count (apartment-stock proxy). " +
        "Sample shows a subset; the full ledger ranks all zero-filing blocks.",
      limitation:
        "Building age is not present in the parcel or EAS sources, so 'pre-1979' cannot be verified from the ledger " +
        "for zero-filing blocks. These are candidate blank zones, not determinations of rent-control status.",
      neighborhood_filter: neighborhood ?? null,
      zero_filing_blocks_total: this.data.total_gap_blocks,
      gaps: gaps.slice(0, limit).map((g) => ({ ...g, filing_count: 0 })),
      new_construction_blocks_total: "sample only",
      new_construction_sample: [],
      provenance: this.provenance(),
    });
  }

  async coverageReport(): Promise<unknown> {
    // Real full-ledger numbers, recomputed from the Wave 3/4 data files
    // (not from the 500-row sample). Same sources the CLI uses.
    const stats = JSON.parse(readFileSync(join(DATA_DIR, "wave3", "stats.json"), "utf8")) as Record<string, any>;
    const audit = JSON.parse(readFileSync(join(DATA_DIR, "wave4", "audit.json"), "utf8")) as Record<string, any>;
    const parcels = stats.parcels ?? {};
    const eas = stats.eas ?? {};
    const tiers = eas.tiers ?? {};
    const rb = stats.rentboard ?? {};
    const denom = audit.denominator ?? {};
    const indep = audit.independent_sample ?? {};
    const conflicts = audit.addrmap_conflicts ?? {};
    const active = parcels.active ?? 0;
    const activeWith = denom.active_parcels_with_verified_address ?? 0;
    // 156,018 verified 2026-09-29 by counting the full EAS snapshot with the
    // backend's own rule (build_indexes.py: "#" in addr or " UNIT " in norm).
    const unitRows = 156018;
    const addrTotal = eas.rows ?? 0;
    return this.withMode({
      parcels: {
        total: parcels.rows,
        active,
        retired: parcels.retired,
        pct_active_with_verified_address: active ? Math.round((100 * activeWith) / active * 100) / 100 : 0,
      },
      addresses: {
        total: addrTotal,
        with_parcel_key: tiers.verified_parcel_key,
        pct_with_parcel_key: addrTotal ? Math.round((100 * (tiers.verified_parcel_key ?? 0)) / addrTotal * 100) / 100 : 0,
        unit_rows: unitRows,
        pct_unit_rows: addrTotal ? Math.round((100 * unitRows) / addrTotal * 100) / 100 : 0,
      },
      blocks: {
        parcel_blocks_total: rb.parcel_blocks_total,
        with_filings: rb.distinct_blocks,
        pct_with_filings: rb.parcel_blocks_total ? Math.round((100 * (rb.distinct_blocks ?? 0)) / rb.parcel_blocks_total * 100) / 100 : 0,
      },
      unmatched_queues: {
        no_parcel_key: tiers.unmatched_no_parcel,
        orphan_parcel_numbers: tiers.unmatched_orphan,
        tblock_0253T_gap_addresses: 1004,
      },
      verification: {
        independent_sample_agreement: indep.agreement_rate,
        addrmap_conflict_rate: conflicts.conflict_rate,
        wave3_negative_controls_passed: stats.negative_controls?.passed,
      },
      sample_note:
        "Sample mode: citywide totals are the real full-ledger audit numbers; row-level search is limited to the 500-row sample.",
      provenance: this.provenance(),
    });
  }

  async waveStatus(): Promise<unknown> {
    // sample_data.json carries a baked per-wave summary list.
    const titles: Record<number, string> = {
      1: "Rent Board Housing Inventory harvest",
      2: "Parcel + address harvest",
      3: "Record linkage parcel<->address",
      4: "Coverage audit + independent verification",
    };
    const waves = this.data.waves.map((w) => ({
      wave: w.wave,
      title: titles[w.wave] ?? `Wave ${w.wave}`,
      dataset_id: w.dataset,
      rows: w.rows,
      expected_rows: w.expected_rows,
      rows_match_expected: w.reconciled,
      row_drift: w.rows != null && w.expected_rows != null ? w.rows - w.expected_rows : null,
      file_sha256_16: String(w.sha256 ?? "").replace("\u2026", "").slice(0, 16),
      retrieved_at: w.retrieved_at,
      status: "complete",
    }));
    (waves as Array<Record<string, unknown>>).push({
      wave: 5,
      title: "Typed service layer + CLI + MCP + web",
      status: "in-progress",
      note: "Sample mode: the Wave 5a CLI was not reachable at startup; serving the 500-row real sample.",
    });
    return this.withMode({ waves, provenance: this.provenance() });
  }

  async explain(q: string): Promise<unknown> {
    const key = normBlklot(q);
    const parcel = this.data.parcels[key];
    const narrative: string[] = [];
    const caveats: string[] = [];
    if (parcel) {
      const onParcel = this.data.eas.filter((e) => this.linkRowsFor(String(e.eas_fullid))[0]?.blklot === key);
      narrative.push(`Resolved '${q}' to parcel blklot ${parcel.blklot} (block ${parcel.block_num}, lot ${parcel.lot_num}).`);
      narrative.push(`Parcel is ${parcel.active ? "ACTIVE" : "RETIRED"} in the assessor file. Zoning ${parcel.zoning_code ?? "unknown"}; neighborhood ${parcel.analysis_neighborhood ?? "unknown"}.`);
      narrative.push(`${onParcel.length} EAS address rows in the sample link to this parcel.`);
      const bev = this.blockEvidence(String(parcel.block_num));
      const n = (bev?.filing_count as number) ?? 0;
      narrative.push(`Block ${parcel.block_num}: ${n} Rent Board inventory filing(s). This is block-level evidence only.`);
      if (n === 0) caveats.push("Zero filings on this block: either no covered units, non-filing stock, or a filing gap. Absence of filings proves nothing about legal rent-control status.");
      return this.withMode({ found: true, query: q, disclaimer: RC_DISCLAIMER, narrative, caveats, provenance: this.provenance() });
    }
    const res = this.lookupAddressSync(q);
    if (!res.found) {
      return this.withMode({
        found: false,
        query: q,
        suggestions: res.suggestions,
        narrative: [`Could not resolve '${q}' to any parcel or EAS address in the sample.`],
        caveats: [],
        provenance: this.provenance(),
      });
    }
    const matches = res.matches as Array<Record<string, unknown>>;
    const tiers = [...new Set(matches.map((m) => String(m.tier)))].sort();
    narrative.push(`Resolved '${q}' to ${res.match_count} EAS address row(s) in the sample (linkage tiers: ${tiers.join(", ")}).`);
    for (const m of matches.slice(0, 5)) {
      narrative.push(`- ${m.address} [${m.eas_fullid}]: tier=${m.tier}; parcel=${(m.parcel as Record<string, unknown> | null)?.blklot ?? "none"}`);
    }
    if ((res.match_count as number) > 5) narrative.push(`... and ${(res.match_count as number) - 5} more rows.`);
    if (tiers.includes("unmatched_no_parcel"))
      caveats.push("EAS carries no parcel keys for some of these addresses (city-data caveat; ~31% of EAS rows). They cannot be pinned to a parcel from these sources.");
    return this.withMode({ found: true, query: q, disclaimer: RC_DISCLAIMER, narrative, caveats, provenance: this.provenance() });
  }
}

// --------------------------------------------------------------- public face

export type Adapter = ServiceAdapter | BundleAdapter | SampleAdapter;

let adapter: Adapter;
let activeMode: Mode = "sample";
let detectError: string | null = null;

export async function initAdapter(): Promise<Mode> {
  // Priority: live CLI (authoritative) -> built bundle (real data, local) ->
  // 500-row sample (local-dev fallback only, badged).
  // The Python CLI is authoritative per project direction, so it is probed
  // FIRST — the bundle is only a local fallback when the CLI cannot run.
  if (existsSync(CLI_PATH)) {
    try {
      const out = await runCli(["waves"], 180_000);
      const parsed = JSON.parse(out) as Record<string, unknown>;
      if (parsed && Array.isArray(parsed.waves)) {
        adapter = new ServiceAdapter();
        activeMode = "service";
        // Warm the two slowest shared caches in the background.
        void (adapter as ServiceAdapter).coverageReport().catch(() => {});
        void (adapter as ServiceAdapter).filingGap(undefined, 20).catch(() => {});
        return activeMode;
      }
      throw new Error("waves output missing waves array");
    } catch (e) {
      detectError = e instanceof Error ? e.message : String(e);
    }
  } else {
    detectError = "CLI not found at " + CLI_PATH;
  }
  if (BundleAdapter.available()) {
    adapter = new BundleAdapter();
    activeMode = "bundle";
    return activeMode;
  }
  adapter = new SampleAdapter();
  activeMode = "sample";
  return activeMode;
}

export function getAdapter(): Adapter {
  if (!adapter) throw new Error("adapter not initialized");
  return adapter;
}

export function getMode(): Mode {
  return activeMode;
}

export function getDetectError(): string | null {
  return detectError;
}
