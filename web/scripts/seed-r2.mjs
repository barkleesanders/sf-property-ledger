#!/usr/bin/env node
/**
 * seed:r2 — upload dist/r2/*.json shard files to the sf-ledger-data R2 bucket.
 * Local dev state for `wrangler dev` by default; --remote only when a deploy
 * is authorized through /ship.
 *
 * Local miniflare state is a single sqlite file: parallel `wrangler r2 object
 * put --local` processes contend on it and 500 (verified 2026-09-29), so local
 * seeds run at CONCURRENCY=2 with per-file retries and a resume state file.
 *
 * Usage: npm run seed:r2 [-- --remote]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const R2DIR = join(WEB, "dist", "r2");
const remote = process.argv.includes("--remote");
const CONCURRENCY = remote ? 8 : 2;
const MAX_RETRIES = remote ? 8 : 4;
const STATE = join(WEB, "dist", "r2", remote ? ".seed-remote.json" : ".seed-local.json");

const files = readdirSync(R2DIR).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
let seeded = new Set();
try {
  if (existsSync(STATE)) seeded = new Set(JSON.parse(readFileSync(STATE, "utf8")));
} catch { /* start fresh */ }
const pending = files.filter((f) => !seeded.has(f));
console.log(`[seed:r2] uploading ${pending.length}/${files.length} objects to sf-ledger-data ${remote ? "(remote)" : "(local)"} ...`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function putOnce(f) {
  return new Promise((resolve, reject) => {
    const args = ["wrangler", "r2", "object", "put", `sf-ledger-data/${f}`, "--file", join(R2DIR, f)];
    args.push(remote ? "--remote" : "--local");
    execFile("npx", args, { cwd: WEB, timeout: 180000 }, (err) => (err ? reject(err) : resolve(f)));
  });
}

async function put(f) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await putOnce(f);
      return;
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      await sleep(2000 * attempt);
    }
  }
}

let done = 0;
const queue = [...pending];
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    await put(f);
    seeded.add(f);
    done++;
    if (done % 25 === 0 || done === pending.length) {
      writeFileSync(STATE, JSON.stringify([...seeded]));
      console.log(`[seed:r2] ${done}/${pending.length}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(STATE, JSON.stringify([...seeded]));
console.log(`[seed:r2] DONE ${done}/${pending.length} (total tracked ${seeded.size}/${files.length})`);
