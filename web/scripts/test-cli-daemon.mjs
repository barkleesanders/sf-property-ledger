#!/usr/bin/env node
/**
 * Parity test: web/scripts/cli-daemon.py must return EXACTLY what
 * cli/sfledger prints (parsed as JSON) for every subcommand, and must
 * survive protocol errors without dying.
 *
 * Usage: node scripts/test-cli-daemon.mjs   (run from web/)
 * Exit 0 = all pass. Takes a few minutes: each direct CLI invocation
 * reloads the ~98MB indexes (~30s); the daemon loads them once.
 */
import { spawn, execFile } from "node:child_process";
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(THIS_DIR, "..");
const REPO_DIR = join(WEB_DIR, "..");
const DAEMON = join(THIS_DIR, "cli-daemon.py");
const CLI = process.env.SFLEDGER_CLI || join(REPO_DIR, "cli", "sfledger");

const FAILURES = [];
function check(name, cond, detail = "") {
  console.log(cond ? "PASS" : "FAIL", name, detail);
  if (!cond) FAILURES.push(name);
}

function runCli(argv, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    execFile(CLI, argv, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// --- daemon client (minimal, independent of src/adapter.ts) ---
let nextId = 1;
const pending = new Map();
let buf = "";
const child = spawn(DAEMON, [], { stdio: ["pipe", "pipe", "inherit"] });
child.on("exit", (code) => {
  for (const [, p] of pending) p.reject(new Error(`daemon exited (${code})`));
  pending.clear();
});
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const resp = JSON.parse(line);
    const p = pending.get(resp.id);
    if (p) { pending.delete(resp.id); p.resolve(resp); }
  }
});
function daemonRaw(line) {
  // Raw protocol line (e.g. malformed JSON). The daemon answers with
  // id:null; route it through the same pending-map dispatcher via the
  // null key (normal requests use numeric ids, never null).
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(null);
      reject(new Error("daemon timeout on raw line"));
    }, 180_000);
    pending.set(null, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    child.stdin.write(line + "\n", (err) => {
      if (err) { pending.delete(null); clearTimeout(timer); reject(err); }
    });
  });
}
function daemonCall(cmd, args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`daemon timeout on ${cmd}`));
    }, 180_000);
    pending.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n", (err) => {
      if (err) { pending.delete(id); clearTimeout(timer); reject(err); }
    });
  });
}

// Wall-clock timestamps: both sides stamp "now" into provenance.generated_at,
// so strip them before the deep-equal and assert presence/shape separately.
function stripTimestamps(o) {
  if (Array.isArray(o)) return o.map(stripTimestamps);
  if (o && typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "generated_at") continue;
      out[k] = stripTimestamps(v);
    }
    return out;
  }
  return o;
}
function hasTimestamp(o) {
  if (Array.isArray(o)) return o.some(hasTimestamp);
  if (o && typeof o === "object") {
    return Object.entries(o).some(([k, v]) =>
      k === "generated_at"
        ? typeof v === "string" && !Number.isNaN(Date.parse(v))
        : hasTimestamp(v));
  }
  return false;
}
const CASES = [
  ["address", "address", { address: "329 FULTON ST" }, ["address", "329 FULTON ST"]],
  ["parcel", "parcel", { blklot: "0189001A" }, ["parcel", "0189001A"]],
  ["rc", "rc", { query: "0189" }, ["rc", "0189"]],
  ["gaps", "gaps", { neighborhood: null, limit: 20 }, ["gaps", "--limit", "20"]],
  ["gaps-neighborhood", "gaps", { neighborhood: "Mission", limit: 5 },
    ["gaps", "--limit", "5", "--neighborhood", "Mission"]],
  ["coverage", "coverage", {}, ["coverage"]],
  ["waves", "waves", {}, ["waves"]],
  ["explain", "explain", { query: "1501 GREAT HWY" }, ["explain", "1501 GREAT HWY"]],
];

let ran = 0;
for (const [name, cmd, args, argv] of CASES) {
  ran++;
  try {
    const [dResp, cliOut] = await Promise.all([
      daemonCall(cmd, args),
      runCli(argv),
    ]);
    check(`daemon parity: ${name} ok:true`, dResp.ok === true,
      dResp.ok ? "" : JSON.stringify(dResp.error));
    if (dResp.ok) {
      const cliParsed = JSON.parse(cliOut);
      check(`daemon parity: ${name} timestamps present`,
        hasTimestamp(dResp.result) && hasTimestamp(cliParsed));
      try {
        assert.deepStrictEqual(stripTimestamps(dResp.result), stripTimestamps(cliParsed));
        check(`daemon parity: ${name} deep-equal CLI (modulo timestamps)`, true);
      } catch (e) {
        check(`daemon parity: ${name} deep-equal CLI (modulo timestamps)`, false, e.message.slice(0, 300));
      }
    }
  } catch (e) {
    check(`daemon parity: ${name}`, false, String(e).slice(0, 200));
  }
}

// --- protocol robustness: daemon must survive bad input ---
try {
  const bad1 = await daemonCall("nope", {});
  check("unknown command -> ok:false", bad1.ok === false && /unknown command/.test(bad1.error.message));
} catch (e) { check("unknown command -> ok:false", false, String(e).slice(0, 200)); }

try {
  const bad2 = await daemonRaw("this is not json{");
  check("malformed JSON -> ok:false, id null", bad2.ok === false && bad2.id === null);
} catch (e) { check("malformed JSON -> ok:false, id null", false, String(e).slice(0, 200)); }

try {
  const after = await daemonCall("waves", {});
  check("daemon alive after protocol errors", after.ok === true && Array.isArray(after.result.waves));
} catch (e) { check("daemon alive after protocol errors", false, String(e).slice(0, 200)); }

child.kill();

console.log(`\n${ran} parity cases, ${FAILURES.length} failures`);
if (FAILURES.length) {
  console.log("FAILURES:", FAILURES.join(", "));
  process.exit(1);
}
console.log("ALL DAEMON PARITY CHECKS PASSED");
