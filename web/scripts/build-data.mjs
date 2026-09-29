#!/usr/bin/env node
/**
 * build:data — generate the Cloudflare Worker data bundle from the REAL
 * Wave 5a indexes (repo/sfledger/indexes/*.idx.json).
 *
 * The Python CLI (repo/cli/sfledger) stays the authoritative backend; this
 * script snapshots its deterministic outputs plus sharded lookup tables so the
 * Worker can serve them without spawning Python at runtime.
 *
 * Outputs:
 *   web/src/data/bundle.json      — coverage, waves, gaps, disclaimer (in Worker script)
 *   web/dist/r2/eas-<cc>.json     — EAS address shards keyed by first 2 chars of normalized address
 *   web/dist/r2/parcels-<cc>.json — parcel shards keyed by first 2 chars of blklot
 *   web/dist/r2/suggest.json      — deduplicated base addresses for suggestions
 *   web/dist/r2/blocks.json       — per-block filing summaries (5,423 blocks)
 *   web/dist/r2/_manifest.json    — key list + sha16, for verification
 *
 * No sample data, no invented metrics: every number derives from the indexes.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url)); // web/scripts/
const WEB = join(ROOT, "..");
const REPO = join(WEB, "..");
const IDX = join(REPO, "sfledger", "indexes");
const CLI = join(REPO, "cli", "sfledger");
const OUT_DATA = join(WEB, "src", "data");
const OUT_R2 = join(WEB, "dist", "r2");

const sha16 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function cli(...args) {
  const out = execFileSync(CLI, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

/** Gaps snapshot via scripts/snapshot-gaps.py (one Python index load).
 * Returns the CLI-identical filing_gap snapshot plus `new_construction_all`
 * (the full list — the CLI hardcodes its sample to [:10], which is not
 * enough for exact neighborhood-filtered counts in the Worker engine). */
function snapshotGaps() {
  const driver = join(ROOT, "snapshot-gaps.py");
  const out = execFileSync("python3", [driver, "100000"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function normAddr(s) {
  s = (s || "").toUpperCase().replace(/\s+/g, " ").trim();
  return s.replace(/\.$/, "");
}

function shardKeyAddr(normed) {
  const chars = (normed.match(/[A-Z0-9]/g) || []).slice(0, 2);
  while (chars.length < 2) chars.push("_");
  return chars.join("");
}

function shardKeyParcel(blklot) {
  const chars = (blklot.match(/[A-Z0-9]/g) || []).slice(0, 2);
  while (chars.length < 2) chars.push("_");
  return chars.join("");
}

function loadIdx(name) {
  return JSON.parse(readFileSync(join(IDX, name), "utf8"));
}

console.log("[build:data] reading indexes from", IDX);
const parcelsIdx = loadIdx("parcels.idx.json"); // {fields, rows}
const easIdx = loadIdx("eas.idx.json");         // {fields, rows, tier_reasons}
const blocksIdx = loadIdx("blocks.idx.json");   // {block_num: {...}}
const idxManifest = JSON.parse(readFileSync(join(IDX, "manifest.json"), "utf8"));

const P = Object.fromEntries(parcelsIdx.fields.map((f, i) => [f, i]));
const E = Object.fromEntries(easIdx.fields.map((f, i) => [f, i]));
console.log(`[build:data] parcels=${parcelsIdx.rows.length} eas=${easIdx.rows.length} blocks=${Object.keys(blocksIdx).length}`);

// ---- parcel address/unit counts + per-parcel compact address lists ----
const addrCount = new Map();   // blklot -> total linked rows
const unitCount = new Map();   // blklot -> unit rows
const parcelTiers = new Map(); // blklot -> Set of tiers
const parcelBase = new Map();  // blklot -> Set of non-unit base addresses
for (const r of easIdx.rows) {
  const blklot = r[E.blklot];
  if (!blklot) continue;
  addrCount.set(blklot, (addrCount.get(blklot) || 0) + 1);
  if (r[E.is_unit]) unitCount.set(blklot, (unitCount.get(blklot) || 0) + 1);
  let ts = parcelTiers.get(blklot);
  if (!ts) { ts = new Set(); parcelTiers.set(blklot, ts); }
  ts.add(r[E.tier]);
  if (!r[E.is_unit]) {
    let bs = parcelBase.get(blklot);
    if (!bs) { bs = new Set(); parcelBase.set(blklot, bs); }
    bs.add(r[E.address]);
  }
}

// ---- parcel shards: [blklot, block_num, lot_num, active, street_name, street_type,
//      from_n, to_n, zoning_code, zoning_district, neighborhood, lat, lon,
//      addr_count, unit_count, tiers, base_addresses] ----
const parcelShards = new Map();
for (const r of parcelsIdx.rows) {
  const blklot = r[P.blklot];
  const compact = [
    blklot, r[P.block_num], r[P.lot_num], !!r[P.active],
    r[P.street_name], r[P.street_type], r[P.from_n], r[P.to_n],
    r[P.zoning_code], r[P.zoning_district], r[P.analysis_neighborhood],
    r[P.lat], r[P.lon],
    addrCount.get(blklot) || 0, unitCount.get(blklot) || 0,
    [...(parcelTiers.get(blklot) || [])].sort(),
    [...(parcelBase.get(blklot) || [])].sort(),
  ];
  const k = shardKeyParcel(blklot);
  let s = parcelShards.get(k);
  if (!s) { s = []; parcelShards.set(k, s); }
  s.push(compact);
}

// ---- eas shards: [eas_fullid, eas_baseid, address, parcel_number, block, lot,
//      tier, blklot, parcel_active, lat, lon, is_unit] ----
const easShards = new Map();
const seenBase = new Set();
const suggest = [];
for (const r of easIdx.rows) {
  const addr = r[E.address] || "";
  const n = normAddr(addr);
  const compact = [
    r[E.eas_fullid], r[E.eas_baseid], addr, r[E.parcel_number],
    r[E.block], r[E.lot], r[E.tier], r[E.blklot],
    r[E.parcel_active] === true || r[E.parcel_active] === 1, r[E.lat], r[E.lon],
    !!r[E.is_unit],
  ];
  const k = shardKeyAddr(n);
  let s = easShards.get(k);
  if (!s) { s = []; easShards.set(k, s); }
  s.push(compact);
  if (!r[E.is_unit] && !seenBase.has(n)) { seenBase.add(n); suggest.push(n); }
}
// Insertion order preserved (matches CLI suggest_addresses iteration order).

// ---- block summaries (compact) for the bundle ----
const blocks = {};
for (const [bnum, b] of Object.entries(blocksIdx)) {
  blocks[bnum] = {
    f: b.filing_count,
    y: b.submission_years,
    o: b.occupancy_mix,
    r: b.rent_buckets,
    b: b.bedroom_mix,
    n: b.neighborhoods,
    p: b.parcel_count, a: b.address_count, u: b.unit_count,
    c: b.case_types,
    yb: [b.year_built_min, b.year_built_max],
    ybp: [b.year_built_pre1979, b.year_built_post1979, b.year_built_unknown],
    inidx: b.block_in_parcel_index,
    s: (b.sample_filings || []).slice(0, 3).map((sf) => ({
      id: sf.unique_id, yr: sf.submission_year, occ: sf.occupancy_type,
      rent: sf.monthly_rent, br: sf.bedroom_count, yb: sf.year_property_built,
      addr: sf.block_address,
    })),
  };
}

// ---- authoritative CLI snapshots (the Python service stays canonical) ----
console.log("[build:data] snapshotting CLI: coverage (slow, ~25s) ...");
const coverage = cli("coverage");
console.log("[build:data] snapshotting CLI: waves ...");
const waves = cli("waves");
console.log("[build:data] snapshotting CLI: gaps (full zero-filing + new-construction lists) ...");
const gaps = snapshotGaps();

// Determinism: the CLI snapshots stamp provenance.generated_at with wall-clock
// time. Snapshot timing is build metadata, not data — the bundle's authoritative
// build time is meta.built_at (from the index manifest). Strip them so two
// builds from the same indexes are byte-identical.
for (const snap of [coverage, waves, gaps]) {
  if (snap && snap.provenance && typeof snap.provenance === "object") {
    delete snap.provenance.generated_at;
  }
}

const bundle = {
  meta: {
    // Deterministic: the authoritative index-build completion time, not wall clock.
    // Rebuilding from the same indexes yields byte-identical meta.
    built_at: idxManifest.finished_at,
    generator: "web/scripts/build-data.mjs",
    indexes: {
      parcels_sha256: idxManifest.inputs.parcels.sha256,
      eas_sha256: idxManifest.inputs.eas.sha256,
      linkage_sha256: idxManifest.inputs.linkage.sha256,
      rentboard_sha256: idxManifest.inputs.rentboard.sha256,
      built_finished_at: idxManifest.finished_at,
    },
  },
  disclaimer: coverage.disclaimer || gaps.disclaimer,
  tier_reasons: easIdx.tier_reasons || {},
  coverage,
  waves,
  gaps,
};

mkdirSync(OUT_DATA, { recursive: true });
mkdirSync(OUT_R2, { recursive: true });

const payloadManifest = { files: [] };
function writeR2(key, obj) {
  const body = JSON.stringify(obj);
  writeFileSync(join(OUT_R2, key), body);
  payloadManifest.files.push({ key, bytes: Buffer.byteLength(body), sha16: sha16(body) });
}

for (const [k, rows] of [...parcelShards.entries()].sort()) writeR2(`parcels-${k}.json`, rows);
for (const [k, rows] of [...easShards.entries()].sort()) writeR2(`eas-${k}.json`, rows);
writeR2("suggest.json", suggest);
writeR2("blocks.json", blocks);
// Manifest aggregates: files[] covers the payload objects only; the manifest
// itself is the (payload_count + 1)th object. Aggregates are computed from the
// payload list, so there is no self-size circularity.
const payloadBytes = payloadManifest.files.reduce((s, f) => s + f.bytes, 0);
writeR2("_manifest.json", {
  payload_count: payloadManifest.files.length,
  payload_bytes: payloadBytes,
  object_count: payloadManifest.files.length + 1,
  files: payloadManifest.files,
});

const bundleBody = (() => {
  // Fixpoint: bundle_bytes must describe the final file, including itself.
  // Two passes converge (digit count of the length is stable); third is belt.
  let body = "";
  for (let i = 0; i < 3; i++) {
    bundle.meta.payload_files = payloadManifest.files.length;
    bundle.meta.bundle_bytes = Buffer.byteLength(body);
    body = JSON.stringify(bundle);
  }
  return body;
})();
writeFileSync(join(OUT_DATA, "bundle.json"), bundleBody);
const writtenBytes = statSync(join(OUT_DATA, "bundle.json")).size;
if (writtenBytes !== Buffer.byteLength(bundleBody)) {
  throw new Error(`bundle byte-count drift: meta=${bundle.meta.bundle_bytes} file=${writtenBytes}`);
}

console.log("[build:data] bundle.json bytes:", writtenBytes);
console.log("[build:data] r2 objects:", payloadManifest.files.length,
  "total bytes:", payloadManifest.files.reduce((s, f) => s + f.bytes, 0));
console.log("[build:data] eas shards:", easShards.size, "parcel shards:", parcelShards.size,
  "suggest entries:", suggest.length);
console.log("[build:data] DONE");
