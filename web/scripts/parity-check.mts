#!/usr/bin/env npx tsx
/**
 * parity-check: prove the Worker data path (BundleAdapter over bundle.json +
 * dist/r2 shards) returns the same answers as the authoritative Python CLI.
 *
 * Usage: npx tsx scripts/parity-check.mts
 * Exit 0 = all cases match (after normalization), 1 = diffs found.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { BundleAdapter } from "../src/data-adapter.js";

const WEB = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// ---- normalization: drop volatile/meta-only fields before comparing ----
function normalize(v: any): any {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const o: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "mode") continue;
      if (k === "generated_at") continue;
      if (k === "shown" || k === "total" || k === "filter") continue; // engine extras on filing_gap
      if (k === "provenance" && val && typeof val === "object") {
        const p = val as Record<string, any>;
        o[k] = { datasets: normalize(p.datasets) };
        continue;
      }
      o[k] = normalize(val);
    }
    return o;
  }
  return v;
}

function diff(a: any, b: any, path: string, out: string[]): void {
  const na = normalize(a);
  const nb = normalize(b);
  const sa = JSON.stringify(na);
  const sb = JSON.stringify(nb);
  if (sa === sb) return;
  // Drill in for a readable path.
  if (na && nb && typeof na === "object" && typeof nb === "object" &&
      !Array.isArray(na) && !Array.isArray(nb)) {
    const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
    for (const k of keys) {
      if (!(k in na)) { out.push(`${path}.${k}: missing in CLI`); continue; }
      if (!(k in nb)) { out.push(`${path}.${k}: missing in bundle`); continue; }
      diff(na[k], nb[k], `${path}.${k}`, out);
      if (out.length > 8) return;
    }
    return;
  }
  if (Array.isArray(na) && Array.isArray(nb)) {
    out.push(`${path}: array length ${na.length} vs ${nb.length}`);
    const n = Math.min(na.length, nb.length);
    for (let i = 0; i < n && out.length <= 8; i++) diff(na[i], nb[i], `${path}[${i}]`, out);
    return;
  }
  const pa = sa.length > 220 ? sa.slice(0, 220) + "…" : sa;
  const pb = sb.length > 220 ? sb.slice(0, 220) + "…" : sb;
  out.push(`${path}:\n  CLI:    ${pa}\n  bundle: ${pb}`);
}

async function main() {
  console.log("[parity] running CLI driver (one index load, ~30s) ...");
  const raw = execFileSync("python3", [join(WEB, "scripts", "parity-driver.py")],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const cases = JSON.parse(raw) as Array<[string, any]>;
  console.log(`[parity] CLI returned ${cases.length} cases`);

  const adapter = new BundleAdapter();
  const runners: Record<string, () => Promise<any>> = {
    addr_hudson: () => adapter.lookupAddress("890 HUDSON AVE"),
    addr_fulton: () => adapter.lookupAddress("329 FULTON ST"),
    addr_missing: () => adapter.lookupAddress("ZZZ NOT REAL ST 999"),
    addr_unit: () => adapter.lookupAddress("329 FULTON ST #101"),
    parcel_taylor: () => adapter.lookupParcel("0189001A"),
    parcel_slash: () => adapter.lookupParcel("1753/001"),
    parcel_missing: () => adapter.lookupParcel("9999/999"),
    rc_hudson: () => adapter.rentControlEvidence("890 HUDSON AVE"),
    rc_taylor: () => adapter.rentControlEvidence("0189001A"),
    rc_missing: () => adapter.rentControlEvidence("ZZZ NOT REAL ST 999"),
    gaps20: () => adapter.filingGap(undefined, 20),
    gaps_mission: () => adapter.filingGap("Mission", 10),
    coverage: () => adapter.coverageReport(),
    waves: () => adapter.waveStatus(),
    explain_taylor: () => adapter.explain("0189001A"),
    explain_hudson: () => adapter.explain("890 HUDSON AVE"),
    explain_missing: () => adapter.explain("ZZZ NOT REAL ST 999"),
  };

  let pass = 0;
  let fail = 0;
  for (const [name, cliResult] of cases) {
    const run = runners[name];
    if (!run) { console.log(`  ? ${name}: no runner`); continue; }
    let mine: any;
    try {
      mine = await run();
    } catch (e) {
      console.log(`  FAIL ${name}: bundle threw: ${e instanceof Error ? e.message : e}`);
      fail++;
      continue;
    }
    const diffs: string[] = [];
    diff(cliResult, mine, name, diffs);
    if (!diffs.length) {
      pass++;
      console.log(`  ok ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name} (${diffs.length} diffs):`);
      for (const d of diffs.slice(0, 4)) console.log("   " + d.split("\n").join("\n   "));
    }
  }
  console.log(`[parity] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

void main();
