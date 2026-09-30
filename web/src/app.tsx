/**
 * Shared Hono app factory for the SF property ledger.
 *
 * Both entry points use this:
 *   - src/index.tsx  (node dev server; adapter = CLI -> bundle -> sample)
 *   - src/worker.ts  (Cloudflare Worker; adapter = bundle.json + R2 shards)
 *
 * Route ownership lives here; entries only pick the data adapter and the
 * static-asset strategy.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  CoveragePage,
  GapsPage,
  HomePage,
  Layout,
  MethodPage,
  NotFoundPage,
  ResultPage,
} from "./views.js";
import {
  loadFaqCorpus,
  recordContextDoc,
  SF_EXTRA_RULES,
  type FaqWorkerBindings,
} from "./faq/faq-corpus.js";
import { mountInfiniteFaq } from "./faq/faq-route.js";

export type Mode = "service" | "bundle" | "sample";

/** Structural interface every data adapter satisfies (CLI, bundle, sample). */
export interface LedgerAdapter {
  lookupAddress(q: string): Promise<unknown>;
  lookupParcel(q: string): Promise<unknown>;
  rentControlEvidence(q: string): Promise<unknown>;
  filingGap(neighborhood: string | undefined, limit: number): Promise<unknown>;
  coverageReport(): Promise<unknown>;
  waveStatus(): Promise<unknown>;
  explain(q: string): Promise<unknown>;
}

export interface AppDeps {
  getAdapter: () => LedgerAdapter;
  getMode: () => Mode;
}

function looksLikeParcel(q: string): boolean {
  return /^[0-9]{3,4}[A-Za-z]?[-\/\s]?\d{3,4}[A-Za-z]?$/.test(q.trim());
}

export function createApp(deps: AppDeps): Hono<{ Bindings: FaqWorkerBindings }> {
  const { getAdapter, getMode } = deps;
  // The FAQ route (mounted below) reads c.env.AI and the FAQ_* rate limiters;
  // on the node dev server c.env is empty and the route degrades gracefully.
  const app = new Hono<{ Bindings: FaqWorkerBindings }>();

  // Strict security headers on every response. The site is SSR HTML + CSS plus
  // one same-origin module script (/faq-island.js) driving the header's "Ask
  // anything" row — no inline scripts, no inline styles, no inline event
  // handlers — so the CSP stays tight: only Google Fonts leave 'self'.
  // connect-src 'self' covers the island's POST to /api/faq/ask, form-action
  // 'self' covers its no-JS fallback form, and img-src keeps data: for the
  // inline SVG favicon. Keep in sync with views.tsx: any new external host or
  // inline style/script here must be allow-listed or it silently breaks rendering.
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  function apiError(c: Context, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: "adapter_error", message: msg, mode: getMode() }, 502);
  }

  // ------------------------------------------------------------------ API

  app.get("/api/lookup_address", async (c) => {
    try {
      return c.json(await getAdapter().lookupAddress(c.req.query("q") ?? ""));
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/lookup_parcel", async (c) => {
    try {
      return c.json(await getAdapter().lookupParcel(c.req.query("q") ?? ""));
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/rent_control_evidence", async (c) => {
    try {
      return c.json(await getAdapter().rentControlEvidence(c.req.query("q") ?? ""));
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/filing_gap", async (c) => {
    try {
      const neighborhood = c.req.query("neighborhood") || undefined;
      const limit = Number(c.req.query("limit")) || 20;
      return c.json(await getAdapter().filingGap(neighborhood, limit));
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/coverage_report", async (c) => {
    try {
      return c.json(await getAdapter().coverageReport());
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/wave_status", async (c) => {
    try {
      return c.json(await getAdapter().waveStatus());
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/explain", async (c) => {
    try {
      return c.json(await getAdapter().explain(c.req.query("q") ?? ""));
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.get("/api/mode", (c) => c.json({ mode: getMode() }));

  // "Ask anything" row in the site header (src/faq/). The record context the
  // header carries comes from the page (see /result below); the route re-reads
  // the record with this same adapter, so the model only ever sees what the
  // page itself shows. On the node dev server there is no AI binding: the
  // handler degrades to 503, the header row stays a working no-JS form.
  mountInfiniteFaq(app, {
    siteName: "SF Property Ledger",
    fallbackUrl: "/method",
    corpus: loadFaqCorpus,
    contextDoc: (_env, ctx) => recordContextDoc(getAdapter, ctx),
    rateLimiter: (env) => env.FAQ_RATE_LIMITER,
    globalRateLimiter: (env) => env.FAQ_RATE_LIMITER_GLOBAL,
    extraRules: [...SF_EXTRA_RULES],
  });

  // ----------------------------------------------------------------- pages

  async function page(c: Context, render: (mode: Mode, adapter: LedgerAdapter) => any) {
    try {
      return c.html(await render(getMode(), getAdapter()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.html(
        Layout({
          title: "Something went wrong",
          mode: getMode(),
          current: "/",
          children: (
            <section class="hero">
              <div class="hero__inner">
                <p class="eyebrow eyebrow--accent">Ledger error</p>
                <h1>The ledger could not answer.</h1>
                <p class="lede mono">{msg}</p>
                <p>
                  <a class="btn btn--ghost" href="/">Back to search</a>{" "}
                  <a class="btn btn--ghost" href={c.req.path}>Try again</a>
                </p>
              </div>
            </section>
          ),
        }),
        500,
      );
    }
  }

  app.get("/", (c) =>
    page(c, async (mode, a) => {
      const coverage = (await a.coverageReport()) as Record<string, any>;
      // Real lookups, verified against the ledger.
      const samples: Array<[string, string]> = [
        ["890 HUDSON AVE", "890 HUDSON AVE"],
        ["Parcel 0189001A", "0189001A"],
        ["329 FULTON ST", "329 FULTON ST"],
      ];
      return Layout({
        title: "San Francisco property ledger",
        mode,
        current: "/",
        children: HomePage({ coverage, mode, samples }),
      });
    }),
  );

  app.get("/result", (c) =>
    page(c, async (mode: Mode, a: LedgerAdapter) => {
      const q = (c.req.query("q") ?? "").trim();
      if (!q) {
        const coverage = (await a.coverageReport()) as Record<string, any>;
        return Layout({
          title: "Search",
          mode,
          current: "/",
          children: HomePage({ coverage, mode, samples: [] }),
        });
      }
      const kind = looksLikeParcel(q) ? "parcel" : "address";
      const [profile, rc, expl] = await Promise.all([
        (kind === "parcel" ? a.lookupParcel(q) : a.lookupAddress(q)) as Promise<Record<string, any>>,
        a.rentControlEvidence(q).catch(() => null) as Promise<Record<string, any> | null>,
        a.explain(q).catch(() => null) as Promise<Record<string, any> | null>,
      ]);
      return Layout({
        title: q,
        mode,
        current: "/",
        faqContext: { kind, id: q },
        children: ResultPage({ q, profile, rc, expl, mode, kind }),
      });
    }),
  );

  app.get("/gaps", (c) =>
    page(c, async (mode, a) => {
      const neighborhood = (c.req.query("neighborhood") ?? "").trim();
      const data = (await a.filingGap(neighborhood || undefined, 30)) as Record<string, any>;
      return Layout({
        title: "Filing gaps",
        mode,
        current: "/gaps",
        children: GapsPage({ data, mode, neighborhood }),
      });
    }),
  );

  app.get("/coverage", (c) =>
    page(c, async (mode, a) => {
      const data = (await a.coverageReport()) as Record<string, any>;
      return Layout({
        title: "Coverage",
        mode,
        current: "/coverage",
        children: CoveragePage({ data, mode }),
      });
    }),
  );

  app.get("/method", (c) =>
    page(c, (mode) => Layout({ title: "Methodology", mode, current: "/method", children: MethodPage({ mode }) })),
  );

  app.notFound((c) =>
    c.html(Layout({ title: "Not found", mode: getMode(), current: "/", children: NotFoundPage() }), 404),
  );

  return app;
}
