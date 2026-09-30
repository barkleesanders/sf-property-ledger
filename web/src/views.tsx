// SF Property Ledger — view layer.
//
// Presentation follows the hospital-ledger.com sibling design system:
// zinc-950 foundation, Inter body, Instrument Serif display, JetBrains Mono
// data, emerald accents, numbered section rules, dark cards, tabular metrics.
// Data wiring is unchanged: every field here mirrors the service layer.

import type { Child } from "hono/jsx";
import { FaqAskRow } from "./faq/faq-section.js";
import type { RecordContext } from "./faq/faq-route.js";

export type Mode = "service" | "bundle" | "sample";

// esc: coerce unknown values to display-safe strings.
function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "n/a";
  const n = Number(v);
  if (Number.isFinite(n)) return n.toLocaleString("en-US");
  return esc(v);
}

// ------------------------------------------------------------------- chrome

function Topbar({ current, mode, faqContext }: {
  current: string;
  mode: Mode;
  /** The record on the page (a /result page only): the ask row answers about it. */
  faqContext?: RecordContext;
}) {
  const nav: Array<[string, string]> = [
    ["/", "Search"],
    ["/gaps", "Gaps"],
    ["/coverage", "Coverage"],
    ["/method", "Method"],
  ];
  return (
    <>
    <a class="skip" href="#main">Skip to content</a>
    <header class="topbar">
      <div class="topbar__inner">
        <a class="wordmark" href="/">SF Property <em>Ledger</em></a>
        <nav class="sitenav" aria-label="Primary">
          {nav.map(([href, label]) => (
            <a key={href} href={href}
               class={`sitenav__link${current === href ? " sitenav__link--current" : ""}`}
               aria-current={current === href ? "page" : undefined}>
              {label}
            </a>
          ))}
          <span class={`mode-badge mode-badge--${mode === "sample" ? "sample" : "live"}`}
                title={mode === "sample" ? "Local-development sample data only" : "Real ledger data"}>
            {mode === "sample" ? "sample" : mode}
          </span>
        </nav>
        <FaqAskRow context={faqContext} />
      </div>
    </header>
    </>
  );
}

function Colophon() {
  return (
    <footer class="colophon">
      <div class="colophon__inner">
        <div class="colophon__grid">
          <div>
            <h2>The ledger</h2>
            <ul>
              <li><a href="/">Search the ledger</a></li>
              <li><a href="/gaps">Filing-gap explorer</a></li>
              <li><a href="/coverage">Coverage dashboard</a></li>
              <li><a href="/method">Methodology</a></li>
            </ul>
          </div>
          <div>
            <h2>Sources</h2>
            <ul>
              <li><span class="mono">gdc7-dmcn</span>: Rent Board housing inventory</li>
              <li><span class="mono">8jwb-2stv</span>: Assessor parcels</li>
              <li><span class="mono">ramy-di5m</span>: Enterprise Addressing System</li>
              <li><span class="mono">5mjj-njit</span>: Address-to-parcel crosswalk</li>
            </ul>
          </div>
          <div>
            <h2>Machine access</h2>
            <ul>
              <li><a href="/api/coverage_report">coverage_report</a></li>
              <li><a href="/api/filing_gap">filing_gap</a></li>
              <li><a href="/api/wave_status">wave_status</a></li>
            </ul>
          </div>
        </div>
        <p class="colophon__fine">
          SF Property Ledger. A verified public record of San Francisco parcels, addresses,
          and filing evidence. Public data only. No tracking, no accounts, no ads.
          Filing evidence is block level only and is never a legal determination.
        </p>
      </div>
    </footer>
  );
}

export function Layout({ title, current, mode, children, faqContext }: {
  title: string; current: string; mode: Mode; children: Child;
  /** The record on the page (a /result page only): the header ask row answers about it. */
  faqContext?: RecordContext;
}) {
  // Canonical URL for the rendered page. Query-bearing pages (e.g. /result)
  // canonicalize to their path so crawlers don't index per-query URLs.
  const canonical = `https://sf-property-ledger.barkleesanders.workers.dev${current}`;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Every parcel in San Francisco, accounted for: verified addresses, parcels, and Rent Board filing evidence from the city's own records." />
        <meta name="theme-color" content="#09090b" />
        <link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CjxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjE0IiBmaWxsPSIjMDkwOTBiIi8+CjxyZWN0IHg9IjYiIHk9IjYiIHdpZHRoPSI1MiIgaGVpZ2h0PSI1MiIgcng9IjEwIiBmaWxsPSJub25lIiBzdHJva2U9IiMxMGI5ODEiIHN0cm9rZS13aWR0aD0iMi41Ii8+Cjx0ZXh0IHg9IjMyIiB5PSI0MSIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjI2IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iI2Y0ZjRmNSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+U0Y8L3RleHQ+CjxyZWN0IHg9IjE0IiB5PSI0OCIgd2lkdGg9IjM2IiBoZWlnaHQ9IjMiIHJ4PSIxLjUiIGZpbGw9IiMxMGI5ODEiLz4KPC9zdmc+Cg==" />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="SF Property Ledger" />
        <meta property="og:title" content={`${title} · SF Property Ledger`} />
        <meta property="og:description" content="Every parcel in San Francisco, accounted for: verified addresses, parcels, and Rent Board filing evidence from the city's own records." />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content="https://sf-property-ledger.barkleesanders.workers.dev/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${title} · SF Property Ledger`} />
        <meta name="twitter:description" content="Every parcel in San Francisco, accounted for: verified addresses, parcels, and Rent Board filing evidence from the city's own records." />
        <meta name="twitter:image" content="https://sf-property-ledger.barkleesanders.workers.dev/og.png" />
        <title>{title} · SF Property Ledger</title>
        <link rel="stylesheet" href="/ledger.css" />
        <link rel="stylesheet" href="/faq.css" />
        <script type="module" src="/faq-island.js"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Topbar current={current} mode={mode} faqContext={faqContext} />
        <main id="main">{children}</main>
        <Colophon />
      </body>
    </html>
  );
}

// -------------------------------------------------------------- primitives

export function Stamp({ tier, big }: { tier: string; big?: boolean }) {
  const t = tier.toLowerCase();
  const label: Record<string, string> = {
    verified: "Verified",
    reported: "Reported",
    inferred: "Inferred",
    gap: "Gap",
  };
  return <span class={`stamp stamp--${t}${big ? " stamp--big" : ""}`}>{label[t] ?? tier}</span>;
}

function SectionRule({ num, label }: { num: string; label: string }) {
  return (
    <div class="section-rule" aria-hidden="true">
      <span class="num">{num}</span>
      <span class="label">{label}</span>
      <span class="line" />
    </div>
  );
}

function Kpi({ label, value, sub, plain }: { label: string; value: string; sub?: string; plain?: boolean }) {
  return (
    <div class="kpi">
      <div class="kpi__label">{label}</div>
      <div class={`kpi__value tab-num${plain ? " kpi__value--plain" : ""}`}>{value}</div>
      {sub && <div class="kpi__sub">{sub}</div>}
    </div>
  );
}

function DisclaimerBox() {
  return (
    <aside class="disclaimer" role="note" aria-label="Rent-control disclaimer">
      <p class="disclaimer__kicker">Legal disclaimer</p>
      <p><strong>Rent Board inventory filings are evidence of filing activity only. They are NOT a conclusive legal determination of rent-control applicability.</strong></p>
      <p>A filing's existence (or absence) does not prove a unit is (or is not) covered by the SF Rent Ordinance. Legal status requires the SF Rent Board or a qualified attorney.</p>
    </aside>
  );
}

// --------------------------------------------------------------------- home

export function HomePage({ coverage, mode, samples }: {
  coverage: Record<string, any>; mode: Mode; samples: Array<[string, string]>;
}) {
  const p = (coverage?.parcels ?? {}) as Record<string, any>;
  const a = (coverage?.addresses ?? {}) as Record<string, any>;
  const b = (coverage?.blocks ?? {}) as Record<string, any>;
  return (
    <>
      <section class="hero">
        <div class="hero__inner">
          <div class="hero__status">
            <span class="pulse-dot" aria-hidden="true" />
            <span>Free forever</span>
            <span class="sep">·</span>
            <span>No signup</span>
            <span class="sep">·</span>
            <span class="dim">No tracking · Public records</span>
          </div>
          <h1>Every parcel in San Francisco, <em>accounted for</em>.</h1>
          <p class="lede">
            The Property Ledger links the city&rsquo;s parcel file, its master address list,
            and the Rent Board&rsquo;s housing inventory, parcel by parcel, block by block,
            and <span class="hl">grades every link</span>. Look up an address or a parcel and see
            exactly what the city&rsquo;s records say, and what they don&rsquo;t.
          </p>
          <form class="searchform" action="/result" method="get" role="search">
            <label class="searchform__label" for="q">Address or parcel key</label>
            <div class="searchform__row">
              <input id="q" name="q" type="search" autocomplete="off" spellcheck={false}
                placeholder="890 Hudson Ave or 0189001A" required minlength={2} />
              <button class="btn btn--primary" type="submit">Look up</button>
            </div>
            <p class="searchform__hint">Try a street address, or a block/lot key like <span class="mono">0189001A</span>.</p>
          </form>
          {mode === "sample" && (
            <div class="sample-banner" role="alert">
              <strong>SAMPLE DATA</strong>: this build serves the 500-row development sample,
              not the full ledger. Production builds never render this banner.
            </div>
          )}
          <div class="kpis" role="list" aria-label="Ledger coverage">
            <Kpi label="Parcels" value={fmt(p.total ?? 236560)} sub={`${fmt(p.active)} active · ${fmt(p.retired)} retired`} />
            <Kpi label="Active parcels with verified address" value={`${fmt(p.pct_active_with_verified_address ?? 91.6)}%`} />
            <Kpi label="Address rows" value={fmt(a.total ?? 388619)} sub={`${fmt(a.with_parcel_key)} with exact parcel key`} />
            <Kpi label="Inventory filings" value={fmt(551358)} sub={`${fmt(b.with_filings)} blocks with filings`} />
          </div>
        </div>
      </section>

      <div class="wrap">
        <section class="page-section" aria-label="Verification tiers">
          <SectionRule num="01" label="How links are graded" />
          <h2 class="section-title">Every link gets a grade. No silent merges.</h2>
          <p class="section-sub">Four tiers, applied by evidence, never by assumption. The method page states exactly what each tier takes.</p>
          <div class="tier-legend">
            <div class="tier-legend__item"><Stamp tier="verified" big /><div><strong>Verified.</strong><p>Address and parcel agree on the city&rsquo;s own keys.</p></div></div>
            <div class="tier-legend__item"><Stamp tier="reported" big /><div><strong>Reported.</strong><p>Filing activity exists at the block; the city published it.</p></div></div>
            <div class="tier-legend__item"><Stamp tier="inferred" big /><div><strong>Inferred.</strong><p>A reasoned link below the verification bar. Treat as a lead.</p></div></div>
            <div class="tier-legend__item"><Stamp tier="gap" big /><div><strong>Gap.</strong><p>No link could be made. The record is incomplete, and we say so.</p></div></div>
          </div>
        </section>

        <section class="page-section" aria-label="Sample lookups">
          <SectionRule num="02" label="Open the ledger" />
          <h2 class="section-title">Start with a real record.</h2>
          <p class="section-sub">Live pages from the ledger: each one carries its provenance footnotes.</p>
          <ul class="openlist">
            {samples.map(([label, q]) => (
              <li>
                <a href={`/result?q=${encodeURIComponent(q)}`}>
                  <span class="mono">{label}</span>
                  <span class="arrow" aria-hidden="true">&rarr;</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section class="page-section" aria-label="Read before you rely">
          <SectionRule num="03" label="Read before you rely on it" />
          <DisclaimerBox />
          <p class="section-sub">
            Filing locations are masked to the block. Block-level evidence is never attributed
            to a parcel or an address. The <a href="/method">method page</a> states the tiers,
            the sources, and what this ledger cannot tell you.
          </p>
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------- result

function DetailHead({ eyebrow, title, mono, sub, stamps, extra }: {
  eyebrow: string; title: string; mono?: boolean; sub?: string;
  stamps?: Child; extra?: Child;
}) {
  return (
    <header class="detail-head">
      <div class="detail-head__inner">
        <div class="detail-head__top">
          <a class="back-link" href="/">&larr; All records</a>
          {extra}
        </div>
        <p class="eyebrow eyebrow--accent">{eyebrow}</p>
        <h1 class={mono ? "mono" : undefined}>{title}</h1>
        {sub && <p class="detail-head__sub">{sub}</p>}
        {stamps && <div class="detail-head__stamps">{stamps}</div>}
      </div>
    </header>
  );
}

function AddressProfile({ data }: { data: Record<string, any> }) {
  const matches: Array<Record<string, any>> = data.matches ?? [];
  const top = matches[0];
  const topTier = top ? String(top.tier) : "gap";
  return (
    <>
      <DetailHead
        eyebrow="Address record"
        title={esc(data.query)}
        sub={`normalized: ${esc(data.normalized)} · ${fmt(data.match_count)} EAS row(s)${data.matches_truncated ? " (truncated at 100)" : ""}`}
        stamps={<Stamp tier={topTier} big />}
      />
      <div class="wrap">
        {(data.tiers_present ?? []).length > 0 && (
          <p class="fineprint fineprint--spaced">
            Linkage tiers present: {(data.tiers_present as string[]).map((t) => <> <Stamp tier={t} /></>)}
          </p>
        )}
        <section class="page-section">
          <SectionRule num="01" label="Matched address rows" />
          <div class="tablewrap">
            <table class="ruled">
              <thead>
                <tr><th>Address</th><th>Tier</th><th>Parcel key</th><th>EAS id</th></tr>
              </thead>
              <tbody>
                {matches.slice(0, 25).map((m) => (
                  <tr>
                    <td>{esc(m.address)}</td>
                    <td><Stamp tier={String(m.tier)} /></td>
                    <td class="mono">{m.parcel ? <a href={`/result?q=${encodeURIComponent(String(m.parcel.blklot))}`}>{esc(m.parcel.blklot)}</a> : "n/a"}</td>
                    <td class="mono">{esc(m.eas_fullid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.parcel_summary && !data.parcel_summary.multiple_parcels && data.parcel_summary.blklot && (
            <p>Parcel summary: <a class="mono" href={`/result?q=${encodeURIComponent(String(data.parcel_summary.blklot))}`}>{esc(data.parcel_summary.blklot)}</a></p>
          )}
        </section>
      </div>
    </>
  );
}

function ParcelProfile({ data }: { data: Record<string, any> }) {
  const parcel = (data.parcel ?? {}) as Record<string, any>;
  const bf = (data.block_filings ?? {}) as Record<string, any>;
  return (
    <>
      <DetailHead
        eyebrow="Parcel record"
        title={esc(parcel.blklot)}
        mono
        sub={`Block ${esc(parcel.block_num)} · Lot ${esc(parcel.lot_num)} · ${parcel.active ? "Active" : "Retired"} in the assessor file`}
        stamps={<Stamp tier="verified" big />}
      />
      <div class="wrap">
        <section class="page-section">
          <SectionRule num="01" label="Parcel facts" />
          <dl class="facts">
            <div><dt>Neighborhood</dt><dd>{esc(parcel.analysis_neighborhood ?? "n/a")}</dd></div>
            <div><dt>Zoning</dt><dd class="mono">{esc(parcel.zoning_code ?? "n/a")}</dd></div>
            <div><dt>Addresses on parcel</dt><dd class="num">{fmt(data.addresses?.count)} ({fmt(data.addresses?.units)} unit rows)</dd></div>
            <div><dt>Block filing evidence</dt><dd class="num">{fmt(bf.filing_count)} filings, block {esc(bf.block_num)}: block level only</dd></div>
          </dl>
          {(data.addresses?.base_addresses_sample ?? []).length > 0 && (
            <>
              <SectionRule num="02" label="Base addresses on this parcel" />
              <ul class="addrlist">
                {(data.addresses.base_addresses_sample as string[]).map((a) => (
                  <li><a href={`/result?q=${encodeURIComponent(a)}`}>{esc(a)}</a></li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function EvidenceSection({ rc }: { rc: Record<string, any>; q: string }) {
  if (!rc?.found) {
    return (
      <div class="wrap">
        <section class="page-section" aria-label="Filing evidence">
          <SectionRule num="03" label="Filing evidence" />
          <DisclaimerBox />
          <p class="section-sub">No block-level filing evidence resolved for this query. Absence of filings proves nothing about legal rent-control status.</p>
        </section>
      </div>
    );
  }
  const b = (rc.block ?? {}) as Record<string, any>;
  const yb = (b.year_built ?? {}) as Record<string, any>;
  const occ = (b.occupancy_mix ?? {}) as Record<string, number>;
  const buckets = (b.rent_buckets ?? {}) as Record<string, number>;
  const samples: Array<Record<string, any>> = b.sample_filings ?? [];
  return (
    <div class="wrap">
      <section class="page-section" aria-label="Filing evidence">
        <div class="detail-head__stamps detail-head__stamps--flush">
          <Stamp tier="reported" big />
        </div>
        <SectionRule num="03" label="Filing evidence" />
        <DisclaimerBox />
        <p class="blocknote">
          Scope: <strong>block {esc(b.block_num)} only</strong>. The Rent Board geo-masks filing
          addresses to the block. This evidence is never attributed to a specific parcel or address.
        </p>
        <div class="kpis">
          <Kpi label="Inventory filings on block" value={fmt(b.filing_count)} />
          <Kpi label="Submission years" value={(b.submission_years as string[] ?? []).join(", ") || "n/a"} plain />
          <Kpi label="Filings, pre-1979 construction" value={fmt(yb.filings_pre1979)} />
          <Kpi label="Filings, post-1979 construction" value={fmt(yb.filings_post1979)} />
        </div>
        {Object.keys(occ).length > 0 && (
          <>
            <h3 class="section-title section-title--lg">Occupancy mix (as filed)</h3>
            <div class="tablewrap"><table class="ruled"><tbody>
              {Object.entries(occ).map(([k, v]) => <tr><td>{esc(k)}</td><td class="mono num">{fmt(v)}</td></tr>)}
            </tbody></table></div>
          </>
        )}
        {Object.keys(buckets).length > 0 && (
          <>
            <h3 class="section-title section-title--lg">Rent buckets (as filed)</h3>
            <div class="tablewrap"><table class="ruled"><tbody>
              {Object.entries(buckets).map(([k, v]) => <tr><td>{esc(k)}</td><td class="mono num">{fmt(v)}</td></tr>)}
            </tbody></table></div>
          </>
        )}
        {samples.length > 0 && (
          <>
            <h3 class="section-title section-title--lg">Sample filings (block level)</h3>
            <div class="tablewrap"><table class="ruled">
              <thead><tr><th>Block address</th><th>Year</th><th>Units</th><th>Year built</th></tr></thead>
              <tbody>
                {samples.map((f) => (
                  <tr>
                    <td>{esc(f.block_address ?? f.block_num)}</td>
                    <td class="mono">{esc(f.submission_year ?? f.year)}</td>
                    <td class="mono num">{fmt(f.unit_count ?? f.units)}</td>
                    <td class="mono">{esc(f.year_built ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </section>
    </div>
  );
}

function ExplainSection({ expl }: { expl: Record<string, any> }) {
  if (!expl) return null;
  const narrative: string[] = expl.narrative ?? [];
  const caveats: string[] = expl.caveats ?? [];
  if (!narrative.length && !caveats.length) return null;
  return (
    <div class="wrap">
      <section class="page-section" aria-label="Provenance narrative">
        <SectionRule num="04" label="How this record was built" />
        <ol class="narrative">
          {narrative.map((n) => <li>{esc(n)}</li>)}
        </ol>
        {caveats.length > 0 && (
          <>
            <h3 class="section-title section-title--md">Caveats</h3>
            <ul class="caveats">
              {caveats.map((c) => <li>{esc(c)}</li>)}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ProvenanceFootnotes({ provenance }: { provenance: Record<string, any> | undefined }) {
  if (!provenance) return null;
  return (
    <div class="wrap">
      <section class="page-section footnotes" aria-label="Provenance">
        <SectionRule num="05" label="Footnotes" />
        <ol>
          {Object.entries(provenance).map(([k, v]) => (
            <li><span class="mono">{esc(k)}</span>: {esc(typeof v === "object" ? JSON.stringify(v) : v)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function ResultPage({ q, profile, rc, expl, mode, kind }: {
  q: string; profile: Record<string, any>; rc: Record<string, any> | null;
  expl: Record<string, any> | null; mode: Mode; kind: "address" | "parcel";
}) {
  if (!profile?.found) {
    return (
      <>
        <DetailHead eyebrow="No record" title={esc(q)}
          sub={`The ledger has no ${kind === "parcel" ? "parcel" : "address"} matching this query${mode === "sample" ? " in the 500-row sample" : ""}.`}
          stamps={<Stamp tier="gap" big />} />
        <div class="wrap">
          <section class="page-section missing">
            {profile?.note && <p class="fineprint">{esc(profile.note)}</p>}
            {(profile?.suggestions as string[] ?? []).length > 0 && (
              <>
                <SectionRule num="01" label="Nearby in the ledger" />
                <ul class="addrlist">
                  {(profile.suggestions as string[]).slice(0, 8).map((s) => (
                    <li><a href={`/result?q=${encodeURIComponent(s)}`}>{esc(s)}</a></li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </>
    );
  }
  return (
    <>
      {kind === "parcel" ? <ParcelProfile data={profile} /> : <AddressProfile data={profile} />}
      {rc && <EvidenceSection rc={rc} q={q} />}
      {expl && <ExplainSection expl={expl} />}
      <ProvenanceFootnotes provenance={profile.provenance} />
    </>
  );
}

// --------------------------------------------------------------------- gaps

export function GapsPage({ data, mode, neighborhood }: { data: Record<string, any>; mode: Mode; neighborhood: string }) {
  const gaps: Array<Record<string, any>> = data.gaps ?? [];
  return (
    <>
      <section class="hero">
        <div class="hero__inner">
          <div class="hero__status">
            <span class="pulse-dot" aria-hidden="true" />
            <span>Filing-gap explorer</span>
            <span class="sep">·</span>
            <span class="dim">Candidate blank zones, not findings</span>
          </div>
          <h1>Blocks where the <em>inventory is silent</em>.</h1>
          <p class="lede">
            These blocks have parcels and addresses but <span class="hl">zero</span> Rent Board
            inventory filings. Ranked by unit-address count: the ledger&rsquo;s proxy for
            apartment stock. Candidate blank zones for outreach, not findings of any legal status.
          </p>
          <form class="searchform searchform--inline" action="/gaps" method="get">
            <label class="searchform__label" for="n">Filter by neighborhood</label>
            <div class="searchform__row">
              <input id="n" name="neighborhood" type="search" value={neighborhood} placeholder="e.g. Mission" />
              <button class="btn btn--ghost" type="submit">Filter</button>
            </div>
          </form>
        </div>
      </section>
      <div class="wrap">
        <section class="page-section">
          <DisclaimerBox />
          <p class="fineprint">
            {fmt(data.zero_filing_blocks_total)} zero-filing blocks in the full ledger
            {mode === "sample" ? "; showing the 30-block sample" : `; showing ${gaps.length}`}.
          </p>
          <div class="tablewrap">
            <table class="ruled">
              <thead>
                <tr><th>Block</th><th>Neighborhoods</th><th class="num">Parcels</th><th class="num">Addresses</th><th class="num">Unit rows</th><th class="num">Filings</th></tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr>
                    <td class="mono">{esc(g.block_num)}</td>
                    <td>{esc((g.neighborhoods as string[] ?? []).join(", ") || "n/a")}</td>
                    <td class="mono num">{fmt(g.parcels ?? g.parcel_count)}</td>
                    <td class="mono num">{fmt(g.addresses ?? g.address_count)}</td>
                    <td class="mono num">{fmt(g.units ?? g.unit_count)}</td>
                    <td class="mono num">0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="methodnote">
            <SectionRule num="01" label="Method and limits" />
            <p>{esc(data.method ?? "")}</p>
            <p><strong>Limitation.</strong> {esc(data.limitation ?? "")}</p>
          </div>
        </section>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- coverage

export function CoveragePage({ data, mode }: { data: Record<string, any>; mode: Mode }) {
  const p = (data.parcels ?? {}) as Record<string, any>;
  const a = (data.addresses ?? {}) as Record<string, any>;
  const b = (data.blocks ?? {}) as Record<string, any>;
  const u = (data.unmatched_queues ?? {}) as Record<string, any>;
  const v = (data.verification ?? {}) as Record<string, any>;
  return (
    <>
      <section class="hero">
        <div class="hero__inner">
          <div class="hero__status">
            <span class="pulse-dot" aria-hidden="true" />
            <span>Coverage dashboard</span>
            <span class="sep">·</span>
            <span class="dim">Measured against the full assessor file</span>
          </div>
          <h1>How much of the city the <em>ledger covers</em>.</h1>
          <p class="lede">
            The denominator is every parcel in the assessor file: active and retired. Every
            figure below is measured against it. Where the ledger cannot link a record, the gap
            is counted, not hidden.
          </p>
          {mode === "sample" && (
            <div class="sample-banner" role="alert">
              <strong>SAMPLE DATA</strong>: {esc((data as Record<string, any>).sample_note ?? "")}
            </div>
          )}
        </div>
      </section>
      <div class="wrap">
        <section class="page-section">
          <SectionRule num="01" label="Parcels" />
          <div class="kpis">
            <Kpi label="Total parcels" value={fmt(p.total)} />
            <Kpi label="Active" value={fmt(p.active)} />
            <Kpi label="Retired" value={fmt(p.retired)} plain />
            <Kpi label="Active with verified address" value={`${fmt(p.pct_active_with_verified_address)}%`} />
          </div>
        </section>
        <section class="page-section">
          <SectionRule num="02" label="Addresses" />
          <div class="kpis">
            <Kpi label="EAS address rows" value={fmt(a.total)} />
            <Kpi label="With exact parcel key" value={fmt(a.with_parcel_key)} />
            <Kpi label="Share with exact key" value={`${fmt(a.pct_with_parcel_key)}%`} />
            <Kpi label="Unit rows" value={fmt(a.unit_rows)} plain />
          </div>
        </section>
        <section class="page-section">
          <SectionRule num="03" label="Blocks and filings" />
          <div class="kpis">
            <Kpi label="Parcel blocks" value={fmt(b.parcel_blocks_total)} />
            <Kpi label="Blocks with inventory filings" value={fmt(b.with_filings)} />
            <Kpi label="Share of blocks with filings" value={`${fmt(b.pct_with_filings)}%`} />
            <Kpi label="Inventory filings (snapshot)" value="551,358" plain />
          </div>
        </section>
        <section class="page-section">
          <SectionRule num="04" label="Unmatched queues" />
          <div class="kpis">
            <Kpi label="Addresses with no parcel key (~31%)" value={fmt(u.no_parcel_key)} />
            <Kpi label="Orphan parcel numbers" value={fmt(u.orphan_parcel_numbers)} />
            <Kpi label="Addresses on temporary block 0253T" value={fmt(u.tblock_0253T_gap_addresses)} plain />
          </div>
        </section>
        <section class="page-section">
          <SectionRule num="05" label="Verification" />
          <div class="kpis">
            <Kpi label="Independent sample agreement" value={`${fmt((v.independent_sample_agreement ?? 0) * 100)} of 100`} />
            <Kpi label="Address-map conflict rate" value={fmt(v.addrmap_conflict_rate)} plain />
            <Kpi label="Wave 3 negative controls passed" value={String(v.wave3_negative_controls_passed)} plain />
          </div>
          <ProvenanceFootnotes provenance={data.provenance} />
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------- method

export function MethodPage({ mode }: { mode: Mode }) {
  return (
    <>
      <section class="hero">
        <div class="hero__inner">
          <div class="hero__status">
            <span class="pulse-dot" aria-hidden="true" />
            <span>Methodology</span>
          </div>
          <h1>What the ledger is, <em>and what it is not</em>.</h1>
        </div>
      </section>
      <div class="wrap">
        <section class="page-section">
          <div class="prose">
            <h2>The question</h2>
            <p>
              For every parcel in San Francisco: what do the city&rsquo;s own records say about it,
              how sure are we, and where do the records disagree? The ledger answers with graded
              links and footnotes, never with a single confident number that hides the seams.
            </p>
            <h2>The tiers</h2>
            <div class="tablewrap">
              <table class="ruled">
                <thead><tr><th>Mark</th><th>Meaning</th><th>Example</th></tr></thead>
                <tbody>
                  <tr><td><Stamp tier="verified" /></td><td>Address and parcel agree on the city&rsquo;s own block/lot keys.</td><td class="mono">890 Hudson Ave &rarr; 4630002</td></tr>
                  <tr><td><Stamp tier="reported" /></td><td>Filing activity exists at the block in the Rent Board inventory.</td><td class="mono">94 filings, block 1753</td></tr>
                  <tr><td><Stamp tier="inferred" /></td><td>A reasoned link below the verification bar. A lead, not a fact.</td><td class="mono">fuzzy street-name match</td></tr>
                  <tr><td><Stamp tier="gap" /></td><td>No link could be made from these sources. Counted, not hidden.</td><td class="mono">1,029 orphan parcel numbers</td></tr>
                </tbody>
              </table>
            </div>
            <h2>The sources</h2>
            <div class="tablewrap">
              <table class="ruled">
                <thead><tr><th>Dataset</th><th>What it is</th><th>Rows</th></tr></thead>
                <tbody>
                  <tr><td class="mono">gdc7-dmcn</td><td>Rent Board Housing Inventory, annual filings</td><td class="mono num">551,358</td></tr>
                  <tr><td class="mono">8jwb-2stv</td><td>Assessor parcels, active and retired</td><td class="mono num">236,560</td></tr>
                  <tr><td class="mono">ramy-di5m</td><td>Enterprise Addressing System, addresses with units</td><td class="mono num">388,619</td></tr>
                  <tr><td class="mono">5mjj-njit</td><td>Address to parcel-number crosswalk</td><td class="mono num">221,130</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Harvested September 2026 from DataSF and verified page by page against full-file hashes.
              The denominator is every parcel in the assessor file. Retired parcels are kept: splits and merges leave traces, and the ledger keeps them visible.
            </p>
            <h2>Linkage</h2>
            <p>
              EAS parcel numbers are matched exactly against parcel block/lot keys (68.8% of address
              rows). About 31% of EAS rows carry no parcel keys at all, a city-data caveat,
              counted as its own queue. 1,029 parcel numbers appear in EAS but in no assessor row;
              1,004 of those sit on temporary block 0253T, which has addresses but zero parcels.
            </p>
            <h2>The filings rule</h2>
            <DisclaimerBox />
            <p>
              The Rent Board geo-masks filing addresses to the block. Block-level evidence is labeled
              as block-level and is never attributed to a parcel or an address. The ledger measures
              two separate things: the stock of property, and the propensity to file. They are not
              the same number.
            </p>
            <h2>What the ledger cannot do</h2>
            <ul>
              <li>Determine whether any unit is covered by the SF Rent Ordinance.</li>
              <li>Verify building age for zero-filing blocks: age is absent from the parcel and EAS sources.</li>
              <li>Resolve corner-lot frontage mismatches (4 of 100 in the independent sample).</li>
            </ul>
            <h2>Waves</h2>
            <p>
              Built in waves: harvest (1–2), linkage (3), independent audit (4), typed service
              and this web service (5). Live wave status is published at{" "}
              <a class="mono" href="/api/wave_status">/api/wave_status</a>.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- not found

export function NotFoundPage() {
  return (
    <>
      <DetailHead eyebrow="Not in the ledger" title="404"
        sub="No page at this address."
        stamps={<Stamp tier="gap" big />} />
      <div class="wrap">
        <section class="page-section missing">
          <p><a class="btn btn--ghost" href="/">Back to the search desk</a></p>
        </section>
      </div>
    </>
  );
}
