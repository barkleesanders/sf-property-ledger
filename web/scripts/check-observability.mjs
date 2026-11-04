// Observability lint rule (native observability rollout, 2026-11-04).
//
// Dylan-style enforcement, Cloudflare-native: this Worker must never ship
// without the platform observability that feeds Workers Logs, Workers
// Traces, and Cloudflare Issues — and the wide-event wrap must stay wired
// into the Worker entry (src/worker.ts). Run via `npm run lint:observability`.
import { readFileSync } from 'node:fs';

const failures = [];

const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const topBlock = /\[observability\]([^[]*)/.exec(wrangler)?.[1] ?? '';
if (!/enabled\s*=\s*true/.test(topBlock)) {
  failures.push('wrangler.toml: [observability] must exist with enabled = true');
}
for (const section of ['observability.logs', 'observability.traces']) {
  const block = new RegExp(`\\[${section}\\]([^[]*)`).exec(wrangler)?.[1] ?? '';
  if (!/enabled\s*=\s*true/.test(block)) {
    failures.push(`wrangler.toml: [${section}] must exist with enabled = true`);
  }
  if (!/persist\s*=\s*true/.test(block)) {
    failures.push(`wrangler.toml: [${section}] must exist with persist = true`);
  }
}

const entry = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
if (!entry.includes('from "./wide-event.js"') || !entry.includes('emitWideEvent')) {
  failures.push('src/worker.ts: wide-event wrap is not wired into the Worker entry');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('observability check passed: logs + traces enabled, wideEvent wired');
