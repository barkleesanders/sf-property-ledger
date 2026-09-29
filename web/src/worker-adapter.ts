/**
 * Worker-safe bundle/R2 adapter.
 *
 * This file is imported by src/worker.ts, which bundles for Cloudflare
 * Workers — so it MUST NOT import any node: modules. The node filesystem
 * adapter (BundleAdapter) lives in src/data-adapter.ts instead.
 */
import { BundleQueryEngine, type BundleJson, type ShardSource } from "./data-engine.js";

/** R2-backed shard source for the Worker. Responses are cached per isolate. */
export class R2ShardSource implements ShardSource {
  constructor(private bucket: { get(key: string): Promise<{ json(): Promise<any> } | null> }) {}
  async getObject(key: string): Promise<any | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return obj.json();
  }
}

export class WorkerDataAdapter extends BundleQueryEngine {
  constructor(
    bundle: BundleJson,
    bucket: { get(key: string): Promise<{ json(): Promise<any> } | null> },
  ) {
    super(bundle, new R2ShardSource(bucket));
  }
}
