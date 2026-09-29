/**
 * Cloudflare Workers entry point for the SF property ledger.
 *
 * No Python here: the Worker serves the precomputed real-data bundle
 * (src/data/bundle.json, inlined at build time by `npm run build:data`) plus
 * lookup shards from the DATA R2 bucket. The Python CLI stays authoritative —
 * it is the build-time source of the bundle.
 *
 * DO NOT DEPLOY without /ship gates and evidence (per project direction).
 */
import { createApp, type Mode } from "./app.js";
import { WorkerDataAdapter } from "./worker-adapter.js";
import type { BundleJson } from "./data-engine.js";
import bundleData from "./data/bundle.json" with { type: "json" };

/** Minimal R2 bucket surface the Worker needs (avoids a workers-types dep). */
interface R2BucketLike {
  get(key: string): Promise<{ json(): Promise<any> } | null>;
}

interface Env {
  DATA: R2BucketLike;
}

let cachedApp: ReturnType<typeof createApp> | null = null;
let cachedAdapter: WorkerDataAdapter | null = null;

function getApp(env: Env) {
  if (!cachedApp) {
    cachedAdapter = new WorkerDataAdapter(bundleData as BundleJson, env.DATA);
    const adapter = cachedAdapter;
    const mode: Mode = "bundle";
    cachedApp = createApp({
      getAdapter: () => adapter,
      getMode: () => mode,
    });
  }
  return cachedApp;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await getApp(env).fetch(request, env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`ledger worker error: ${msg}`, { status: 500 });
    }
  },
};
