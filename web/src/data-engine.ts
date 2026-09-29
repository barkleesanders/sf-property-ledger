/**
 * Shared bundle+R2 lookup logic.
 *
 * The Python CLI (repo/cli/sfledger) stays authoritative. `npm run build:data`
 * snapshots its deterministic outputs into src/data/bundle.json (embedded in
 * the Worker) plus sharded lookup tables in R2 (or dist/r2/ for local dev).
 * This module re-implements the CLI's read-only query shapes over that
 * precomputed data so the Worker serves them without spawning Python.
 *
 * Compact row layouts (must match scripts/build-data.mjs):
 *   EAS:    [fullid, baseid, address, parcel_number, block, lot, tier, blklot,
 *            parcel_active, lat, lon, is_unit]
 *   Parcel: [blklot, block_num, lot_num, active, street_name, street_type,
 *            from_n, to_n, zoning_code, zoning_district, neighborhood, lat, lon,
 *            addr_count, unit_count, tiers, base_addresses]
 *   base_addresses: sorted unique non-unit address strings on the parcel
 *   Block (bundle.blocks): {f,y,o,r,b,n,p,a,u,c,yb,ybp,inidx,s}
 */

export interface BundleJson {
  meta: Record<string, any>;
  disclaimer: string;
  tier_reasons: Record<string, string>;
  coverage: any;
  waves: any;
  gaps: any;
}

export interface ShardSource {
  /** Fetch and parse one R2/dist object by key (e.g. "eas-3.json"). Null if absent. */
  getObject(key: string): Promise<any | null>;
}

const EAS_POS = {
  fullid: 0, baseid: 1, address: 2, parcel_number: 3, block: 4, lot: 5,
  tier: 6, blklot: 7, parcel_active: 8, lat: 9, lon: 10, is_unit: 11,
} as const;
const P_POS = {
  blklot: 0, block_num: 1, lot_num: 2, active: 3, street_name: 4, street_type: 5,
  from_n: 6, to_n: 7, zoning_code: 8, zoning_district: 9, neighborhood: 10,
  lat: 11, lon: 12, addr_count: 13, unit_count: 14, tiers: 15, base_addresses: 16,
} as const;

export function normAddr(s: string): string {
  s = (s || "").toUpperCase().replace(/\s+/g, " ").trim();
  return s.replace(/\.$/, "");
}

export function normBlklot(q: string): string {
  q = (q || "").trim().toUpperCase().replace(/ /g, "");
  if (q.includes("/")) {
    const [blockRaw, lotRaw] = q.split("/", 2);
    let block = blockRaw;
    let lot = lotRaw || "";
    if (/^\d+$/.test(block)) block = block.padStart(4, "0");
    const m = lot.match(/^(\d+)(.*)$/);
    if (m) lot = m[1].padStart(3, "0") + m[2].toUpperCase();
    else lot = lot.toUpperCase();
    return block + lot;
  }
  return q;
}

function shardKeyAddr(n: string): string {
  const chars = (n.match(/[A-Z0-9]/g) || []).slice(0, 2);
  while (chars.length < 2) chars.push("_");
  return chars.join("");
}

function shardKeyParcel(blklot: string): string {
  const chars = (blklot.match(/[A-Z0-9]/g) || []).slice(0, 2);
  while (chars.length < 2) chars.push("_");
  return chars.join("");
}

export function looksLikeParcel(q: string): boolean {
  const n = normBlklot(q);
  return /^[0-9A-Z]{4,}[0-9][A-Z0-9]*$/.test(n) && !/[ ]/.test(q.trim());
}

const BLOCK_LEVEL_NOTE =
  "Filing addresses are geo-masked to the block by the Rent Board. " +
  "Block-level filing evidence is never attributed to a specific parcel or address.";

export class BundleQueryEngine {
  bundle: BundleJson;
  src: ShardSource;
  private cache = new Map<string, any>();

  constructor(bundle: BundleJson, src: ShardSource) {
    this.bundle = bundle;
    this.src = src;
  }

  private async obj(key: string): Promise<any | null> {
    if (this.cache.has(key)) return this.cache.get(key);
    const v = await this.src.getObject(key);
    if (v !== null && v !== undefined) this.cache.set(key, v);
    return v;
  }

  private provenance() {
    return {
      datasets: (this.bundle.coverage.provenance?.datasets) || [],
      generated_at: this.bundle.meta.built_at,
      code: "sfledger wave5 (worker bundle)",
    };
  }

  private tierReason(tier: string): string {
    return this.bundle.tier_reasons[tier] || "";
  }

  /** CLI-exact parcel shape (sfledger.models.Parcel dataclass fields). */
  private parcelDict(r: any[]): any {
    return {
      blklot: r[P_POS.blklot],
      block_num: r[P_POS.block_num],
      lot_num: r[P_POS.lot_num],
      active: r[P_POS.active],
      street_name: r[P_POS.street_name],
      street_type: r[P_POS.street_type],
      from_address_num: r[P_POS.from_n],
      to_address_num: r[P_POS.to_n],
      zoning_code: r[P_POS.zoning_code],
      zoning_district: r[P_POS.zoning_district],
      analysis_neighborhood: r[P_POS.neighborhood],
      centroid_lat: r[P_POS.lat],
      centroid_lon: r[P_POS.lon],
    };
  }

  private async findParcel(blklot: string): Promise<any[] | null> {
    const key = normBlklot(blklot);
    if (!key) return null;
    const rows = (await this.obj(`parcels-${shardKeyParcel(key)}.json`)) as any[] | null;
    if (!rows) return null;
    return rows.find((r) => r[P_POS.blklot] === key) || null;
  }

  private async findAddresses(query: string): Promise<any[][]> {
    const nq = normAddr(query);
    const rows = ((await this.obj(`eas-${shardKeyAddr(nq)}.json`)) as any[] | null) || [];
    let hits = rows.filter((r) => normAddr(r[EAS_POS.address]) === nq);
    if (!hits.length && nq.includes("#")) {
      const base = nq.split("#")[0].trim();
      hits = rows.filter((r) => normAddr(r[EAS_POS.address]) === base);
    }
    return hits;
  }

  private async suggest(query: string, limit = 5): Promise<string[]> {
    const tokens = normAddr(query).split(" ").filter((t) => t.length >= 3);
    if (!tokens.length) return [];
    const list = (await this.obj("suggest.json")) as string[] | null;
    if (!list) return [];
    const pats = tokens.map((t) => ({ t, re: new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
    const scored: Array<[number, number, string]> = [];
    for (const a of list) {
      let hits = 0;
      for (const { t, re } of pats) {
        if (re.test(a)) hits += 2;
        else if (a.includes(t)) hits += 1;
      }
      if (hits) scored.push([hits, a.length, a]);
    }
    scored.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
    return scored.slice(0, limit).map((s) => s[2]);
  }

  private async linkedDict(row: any[]): Promise<any> {
    const blklot = row[EAS_POS.blklot];
    const prow = blklot ? await this.findParcel(blklot) : null;
    return {
      eas_fullid: row[EAS_POS.fullid],
      eas_baseid: row[EAS_POS.baseid],
      address: row[EAS_POS.address],
      is_unit: !!row[EAS_POS.is_unit],
      parcel_number: row[EAS_POS.parcel_number],
      block: row[EAS_POS.block],
      lot: row[EAS_POS.lot],
      latitude: row[EAS_POS.lat],
      longitude: row[EAS_POS.lon],
      tier: row[EAS_POS.tier],
      tier_reason: this.tierReason(row[EAS_POS.tier]),
      parcel_active: !!row[EAS_POS.parcel_active],
      parcel: prow ? this.parcelDict(prow) : null,
    };
  }

  private async resolve(query: string): Promise<{ kind: string; parcel: any[] | null; matches: any[][]; blockNum: string | null }> {
    const prow = await this.findParcel(query);
    if (prow) return { kind: "parcel", parcel: prow, matches: [], blockNum: prow[P_POS.block_num] };
    const matches = await this.findAddresses(query);
    if (matches.length) {
      const blocks = new Set(matches.map((r) => r[EAS_POS.block]).filter(Boolean));
      const block = blocks.size === 1 ? [...blocks][0] : null;
      const blklots = matches.map((r) => r[EAS_POS.blklot]).filter(Boolean);
      const first = blklots[0];
      if (first && blklots.every((b) => b === first)) {
        const p = await this.findParcel(first);
        return { kind: "address", parcel: p, matches, blockNum: p ? p[P_POS.block_num] : block };
      }
      return { kind: "address", parcel: null, matches, blockNum: block };
    }
    return { kind: "none", parcel: null, matches: [], blockNum: null };
  }

  // Parcel profile block summary: EXACT CLI shape from queries.py
  // (scope "block-level only", five keys — no rc-path extras).
  private async parcelBlockDict(blockNum: string): Promise<any> {
    const all = ((await this.obj("blocks.json")) as Record<string, any> | null) || {};
    const b = all[blockNum];
    return {
      scope: "block-level only",
      block_num: blockNum,
      filing_count: b?.f ?? 0,
      submission_years: b?.y ?? [],
      note: BLOCK_LEVEL_NOTE,
    };
  }

  private async blockDict(blockNum: string): Promise<any> {
    const all = ((await this.obj("blocks.json")) as Record<string, any> | null) || {};
    const b = all[blockNum];
    const empty = {
      block_num: blockNum, scope: "block-level filing evidence only",
      filing_count: 0, submission_years: [], case_types: [],
      occupancy_mix: {}, rent_buckets: {}, bedroom_mix: {},
      year_built: { min: null, max: null, filings_pre1979: 0, filings_post1979: 0, filings_year_unknown: 0 },
      sample_filings: [], block_in_parcel_index: false, note: BLOCK_LEVEL_NOTE,
    };
    if (!b) return empty;
    return {
      block_num: blockNum, scope: "block-level filing evidence only",
      filing_count: b.f, submission_years: b.y, case_types: b.c || [],
      occupancy_mix: b.o, rent_buckets: b.r, bedroom_mix: b.b,
      year_built: {
        min: b.yb?.[0] ?? null, max: b.yb?.[1] ?? null,
        filings_pre1979: b.ybp?.[0] ?? 0, filings_post1979: b.ybp?.[1] ?? 0,
        filings_year_unknown: b.ybp?.[2] ?? 0,
      },
      sample_filings: (b.s || []).map((sf: any) => ({
        unique_id: sf.id, submission_year: sf.yr, occupancy_type: sf.occ,
        monthly_rent: sf.rent, bedroom_count: sf.br,
        year_property_built: sf.yb, block_address: sf.addr,
      })),
      block_in_parcel_index: !!b.inidx, note: BLOCK_LEVEL_NOTE,
    };
  }

  // ------------------------------------------------------------ public API

  async lookupAddress(address: string): Promise<any> {
    const matches = await this.findAddresses(address);
    const nq = normAddr(address);
    if (!matches.length) {
      return {
        found: false, query: address, normalized: nq,
        suggestions: await this.suggest(address),
        note: "No EAS address matched. Suggestions are base addresses containing the query tokens.",
        provenance: this.provenance(),
      };
    }
    const blklots = new Set(matches.map((r) => r[EAS_POS.blklot]).filter(Boolean));
    let parcelSummary: any;
    if (blklots.size === 1) {
      const blklot = [...blklots][0];
      const prow = await this.findParcel(blklot);
      parcelSummary = {
        blklot,
        addresses_on_parcel: prow ? prow[P_POS.addr_count] : 0,
        units_on_parcel: prow ? prow[P_POS.unit_count] : 0,
      };
    } else {
      const counts: Record<string, number> = {};
      for (const r of matches) {
        const b = r[EAS_POS.blklot];
        if (b) counts[b] = (counts[b] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      parcelSummary = { multiple_parcels: true, parcels_present: Object.fromEntries(top) };
    }
    const tiers = [...new Set(matches.map((r) => r[EAS_POS.tier]))].sort();
    const capped = matches.slice(0, 100);
    return {
      found: true, query: address, normalized: nq,
      match_count: matches.length, matches_truncated: matches.length > 100,
      tiers_present: tiers,
      matches: await Promise.all(capped.map((r) => this.linkedDict(r))),
      parcel_summary: parcelSummary,
      filing_note: "For filing evidence use rent_control_evidence: " + BLOCK_LEVEL_NOTE,
      provenance: this.provenance(),
    };
  }

  async lookupParcel(blklot: string): Promise<any> {
    const prow = await this.findParcel(blklot);
    const nq = normBlklot(blklot);
    if (!prow) {
      return {
        found: false, query: blklot, normalized: nq,
        note: "No parcel with that blklot. Try block/lot form like '1753/001'.",
        provenance: this.provenance(),
      };
    }
    const base = prow[P_POS.base_addresses] as string[];
    return {
      found: true, query: blklot, normalized: nq,
      parcel: this.parcelDict(prow),
      addresses: {
        count: prow[P_POS.addr_count],
        units: prow[P_POS.unit_count],
        tiers_present: prow[P_POS.tiers],
        base_addresses_sample: base.slice(0, 10), // CLI truncates the sample to 10
      },
      block_filings: await this.parcelBlockDict(prow[P_POS.block_num]),
      provenance: this.provenance(),
    };
  }

  async rentControlEvidence(query: string): Promise<any> {
    const { kind, parcel, matches, blockNum } = await this.resolve(query);
    if (kind === "none" || !blockNum) {
      return {
        found: false, query,
        disclaimer: this.bundle.disclaimer,
        suggestions: await this.suggest(query),
        provenance: this.provenance(),
      };
    }
    const resolved: any = { kind, block_num: blockNum };
    if (kind === "parcel" && parcel) {
      resolved.blklot = parcel[P_POS.blklot];
      resolved.parcel_active = !!parcel[P_POS.active];
    } else {
      const tiers = [...new Set(matches.map((r) => r[EAS_POS.tier]))].sort();
      const blklots = [...new Set(matches.map((r) => r[EAS_POS.blklot]).filter(Boolean))].sort();
      resolved.match_count = matches.length;
      resolved.tiers_present = tiers;
      resolved.blklot_count = blklots.length;
      resolved.blklots = blklots.slice(0, 25);
      if (blklots.length > 25) resolved.blklots_truncated = true;
    }
    return {
      found: true, query,
      disclaimer: this.bundle.disclaimer,
      tier: "reported",
      resolved,
      block: await this.blockDict(blockNum),
      provenance: this.provenance(),
    };
  }

  /** CLI-exact filing_gap: filter the FULL block lists by neighborhood, then
   * count and slice — the same order the CLI computes in (filter, then sort,
   * then total = len, slice). The bundle carries complete zero-filing and
   * new-construction lists (see scripts/snapshot-gaps.py), so filtered totals
   * are exact, not snapshot-truncated. */
  async filingGap(neighborhood?: string, limit = 20): Promise<any> {
    const g = this.bundle.gaps;
    const match = (x: any) =>
      !neighborhood ||
      (x.neighborhoods || []).some((h: string) =>
        h.toLowerCase().includes(neighborhood.toLowerCase()));
    // Snapshot order already equals the CLI's sort ((-gap_score, block_num)
    // for gaps; (-filing_count, block_num) for new construction); filtering
    // preserves relative order, matching filter-then-sort.
    const gaps = (g.gaps as any[]).filter(match);
    const ncAll = ((g as any).new_construction_all || g.new_construction_sample || []) as any[];
    const nc = ncAll.filter(match);
    return {
      disclaimer: g.disclaimer,
      method: g.method,
      limitation: g.limitation,
      neighborhood_filter: neighborhood || null,
      zero_filing_blocks_total: gaps.length,
      gaps: gaps.slice(0, limit),
      new_construction_blocks_total: nc.length,
      new_construction_sample: nc.slice(0, 10),
      provenance: g.provenance,
    };
  }

  async coverageReport(): Promise<any> {
    return this.bundle.coverage;
  }

  async waveStatus(): Promise<any> {
    return this.bundle.waves;
  }

  async explain(query: string): Promise<any> {
    const { kind, parcel, matches, blockNum } = await this.resolve(query);
    const narrative: string[] = [];
    const caveats: string[] = [];
    if (kind === "none") {
      narrative.push(`Could not resolve '${query}' to any parcel or EAS address.`);
      return {
        found: false, query,
        suggestions: await this.suggest(query),
        narrative, caveats, provenance: this.provenance(),
      };
    }
    if (kind === "parcel" && parcel) {
      const p = this.parcelDict(parcel);
      narrative.push(`Resolved '${query}' to parcel blklot ${p.blklot} (block ${p.block_num}, lot ${p.lot_num}).`);
      narrative.push(
        `Parcel is ${p.active ? "ACTIVE" : "RETIRED"} in the assessor file. ` +
        `Zoning ${p.zoning_code || "unknown"}; neighborhood ${p.analysis_neighborhood || "unknown"}.`);
      if (!p.active) {
        caveats.push("Retired parcels may have been split/merged; addresses can persist on retired parcels.");
      }
      narrative.push(
        `${parcel[P_POS.addr_count]} EAS address rows link to this parcel ` +
        `(${parcel[P_POS.unit_count]} unit rows).`);
    } else {
      const tiers = [...new Set(matches.map((r) => r[EAS_POS.tier]))].sort();
      narrative.push(`Resolved '${query}' to ${matches.length} EAS address row(s) (linkage tiers present: ${tiers.join(", ")}).`);
      for (const r of matches.slice(0, 5)) {
        const m = await this.linkedDict(r);
        narrative.push(
          `  - ${m.address} [${m.eas_fullid}]: tier=${m.tier} (${m.tier_reason}); ` +
          `parcel=${m.parcel ? m.parcel.blklot : "none"}`);
      }
      if (matches.length > 5) narrative.push(`  ... and ${matches.length - 5} more rows.`);
      if (matches.some((r) => r[EAS_POS.tier] === "unmatched_no_parcel")) {
        caveats.push(
          "EAS carries no parcel keys for this address (city-data caveat; ~31% of EAS rows). " +
          "It cannot be pinned to a parcel from these sources.");
      }
      if (matches.some((r) => r[EAS_POS.tier] === "unmatched_orphan" && (r[EAS_POS.parcel_number] || "").startsWith("0253T"))) {
        caveats.push(
          "Parcel number is on temporary block 0253T, which has 1,004 EAS addresses but zero parcels " +
          "in the assessor file — a quantified coverage gap (Wave 4 audit).");
      }
    }
    if (blockNum) {
      const b = await this.blockDict(blockNum);
      narrative.push(
        `Block ${blockNum}: ${b.filing_count} Rent Board inventory filing(s) ` +
        `(${(b.submission_years || []).join(", ") || "no years"}). ` +
        "This is block-level evidence only — filings are geo-masked and never attributed to a specific parcel or address.");
      if (b.filing_count === 0) {
        // CLI puts the zero-filing reading in caveats, not narrative.
        caveats.push(
          "Zero filings on this block: either no covered units, non-filing " +
          "stock, or a filing gap. Absence of filings proves nothing about " +
          "legal rent-control status.");
      }
    }
    return {
      found: true, query,
      disclaimer: this.bundle.disclaimer,
      narrative, caveats, provenance: this.provenance(),
    };
  }
}
