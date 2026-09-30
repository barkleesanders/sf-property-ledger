/** The Property Ledger — node dev server (Wave 5b/6).
 *
 * Adapter priority: live CLI (authoritative) -> built real-data bundle ->
 * 500-row sample (local-dev fallback only, badged SAMPLE DATA).
 *
 * The Cloudflare Worker entry is src/worker.ts (bundle.json + R2 shards).
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  getAdapter,
  getDetectError,
  getMode,
  initAdapter,
} from "./adapter.js";
import { createApp } from "./app.js";

const app = createApp({ getAdapter, getMode });

// Static assets (node only; Workers use [assets] directory = "./public" in
// wrangler.toml). Both serve public/ledger.css at /ledger.css, and the FAQ
// island's built assets (public/faq.css, public/faq-island.js) at their paths.
app.use("/ledger.css", serveStatic({ root: "./public" }));
app.use("/faq.css", serveStatic({ root: "./public" }));
app.use("/faq-island.js", serveStatic({ root: "./public" }));

const PORT = Number(process.env.PORT ?? 8787);

async function main() {
  const mode = await initAdapter();
  console.log(`[ledger-web] adapter mode: ${mode}`);
  if (mode === "sample") {
    console.log(`[ledger-web] sample reason: ${getDetectError()}`);
  }
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[ledger-web] listening on http://localhost:${info.port} (${mode} mode)`);
  });
}

void main();
