/**
 * Grounding corpus for the "Ask anything" row on the SF Property Ledger.
 *
 * Two sources, deliberately kept apart (see the infinite-faq integration guide):
 *
 *   1. THIS SITE — a static module (the skill's sourcing option 1: fastest,
 *      versioned with the code). Every number is copied whole from the site's
 *      own pages (src/views.tsx) or the built bundle it renders; when the
 *      ledger does not record a number, the corpus says so instead of giving
 *      one. The figures here are the production figures verified 2026-09-30:
 *      236,560 parcels, 551,358 Rent Board filing rows, 388,619 EAS address
 *      rows, 221,130 crosswalk rows, 1,132 zero-filing blocks.
 *   2. THE RECORD ON SCREEN — a /result page adds ONE more document per
 *      request, through `recordContextDoc()`. The page sends only the record's
 *      id (a parcel block/lot key or an address query); the route re-reads the
 *      record with the page's own adapter (lookupParcel / lookupAddress), so
 *      the fields the model sees are exactly what the page shows and nothing a
 *      request claims.
 *
 * The model is never shown raw request claims: the record document is built
 * from the adapter's response, never from the request body.
 */
import type {
  FaqAi,
  FaqCorpusDoc,
  FaqRateLimiter,
  RecordContext,
} from "./faq-route.js";

export const SITE_ORIGIN = "https://sf-property-ledger.barkleesanders.workers.dev";

export const SITE_NAME = "SF Property Ledger";

/** The Worker's bindings as the FAQ route sees them (src/worker.ts). */
export type FaqWorkerBindings = {
  AI: FaqAi;
  FAQ_RATE_LIMITER?: FaqRateLimiter;
  FAQ_RATE_LIMITER_GLOBAL?: FaqRateLimiter;
};

/**
 * The site's anti-fabrication contract, appended to the prompt's rule list.
 * This is a filing-activity database, so a number the model "completes" is
 * worse than no answer — and a rent-control determination is never the
 * model's to make.
 */
export const SF_EXTRA_RULES = [
  "Rent Board inventory filings are evidence of filing activity only. They are NOT a conclusive legal determination of rent-control applicability: never say an address, parcel, block or neighborhood is or is not rent-controlled; say the ledger cannot determine that.",
  "Numbers, counts and figures must be copied whole and exactly as the reference material states them, or reported as not listed. Never round, complete or estimate a number.",
  "Block-level filing evidence is never attributed to a parcel or an address: describe it as block evidence, naming the block.",
  "The site has no building-age data for zero-filing blocks and no phone numbers or email addresses: when asked for one, say the site does not list it.",
] as const;

/** The site corpus, in prompt order (most-asked first). All copy is the site's own words. */
const CORPUS: FaqCorpusDoc[] = [
  {
    title: "What the ledger is",
    url: `${SITE_ORIGIN}/`,
    text: [
      "The SF Property Ledger links the city's parcel file, its master address list, and the Rent Board's housing inventory, parcel by parcel, block by block, and grades every link.",
      "It covers 236,560 parcels from the assessor file (active and retired), 388,619 address rows from the Enterprise Addressing System, 221,130 address-to-parcel crosswalk rows, and 551,358 rows of Rent Board Housing Inventory annual filings.",
      "Harvested September 2026 from DataSF and verified page by page against full-file hashes. The denominator is every parcel in the assessor file. Retired parcels are kept: splits and merges leave traces, and the ledger keeps them visible.",
      "Public data only. No tracking, no accounts, no ads.",
    ].join("\n"),
  },
  {
    title: "The four confidence tiers",
    url: `${SITE_ORIGIN}/method`,
    text: [
      "Every link gets a grade. No silent merges. Four tiers, applied by evidence, never by assumption.",
      "VERIFIED: Address and parcel agree on the city's own block/lot keys.",
      "REPORTED: Filing activity exists at the block in the Rent Board inventory.",
      "INFERRED: A reasoned link below the verification bar. A lead, not a fact.",
      "GAP: No link could be made from these sources. Counted, not hidden.",
    ].join("\n"),
  },
  {
    title: "The rent-control disclaimer",
    url: `${SITE_ORIGIN}/method`,
    text: [
      "Rent Board inventory filings are evidence of filing activity only. They are NOT a conclusive legal determination of rent-control applicability.",
      "A filing's existence (or absence) does not prove a unit is (or is not) covered by the SF Rent Ordinance. Legal status requires the SF Rent Board or a qualified attorney.",
      "The ledger cannot determine whether any unit is covered by the SF Rent Ordinance.",
    ].join("\n"),
  },
  {
    title: "Block-level filing evidence",
    url: `${SITE_ORIGIN}/method`,
    text: [
      "The Rent Board geo-masks filing addresses to the block. Block-level evidence is labeled as block-level and is never attributed to a parcel or an address.",
      "The ledger measures two separate things: the stock of property, and the propensity to file. They are not the same number.",
      "Absence of filings proves nothing about legal rent-control status.",
    ].join("\n"),
  },
  {
    title: "Filing gaps",
    url: `${SITE_ORIGIN}/gaps`,
    text: [
      "1,132 blocks in the full ledger have parcels and addresses but zero Rent Board inventory filings, ranked by unit-address count, the ledger's proxy for apartment stock.",
      "These are candidate blank zones for outreach, not findings of any legal status.",
      "Method: blocks with zero Rent Board inventory filings, ranked by EAS unit-address count (apartment-stock proxy).",
      "Limitation: building age is not present in the parcel or EAS sources, so 'pre-1979' cannot be verified from the ledger for zero-filing blocks.",
    ].join("\n"),
  },
  {
    title: "Coverage numbers",
    url: `${SITE_ORIGIN}/coverage`,
    text: [
      "EAS parcel numbers are matched exactly against parcel block/lot keys (68.8% of address rows). About 31% of EAS rows carry no parcel keys at all, a city-data caveat, counted as its own queue.",
      "1,029 parcel numbers appear in EAS but in no assessor row; 1,004 of those sit on temporary block 0253T, which has addresses but zero parcels.",
      "Active parcels with a verified address: 91.6%. Independent sample agreement: 96 of 100. Address-map conflict rate: 0.0025. Wave 3 negative controls: passed.",
    ].join("\n"),
  },
  {
    title: "The five waves",
    url: `${SITE_ORIGIN}/method`,
    text: [
      "The ledger was built in waves: harvest (1 and 2), linkage (3), independent audit (4), typed service and this web service (5).",
      "Live wave status is published at /api/wave_status.",
    ].join("\n"),
  },
  {
    title: "How to read a result page",
    url: `${SITE_ORIGIN}/result?q=0189001A`,
    text: [
      "A parcel page shows the block/lot key, block and lot numbers, whether the parcel is active or retired in the assessor file, the neighborhood, the zoning code, the count of addresses and unit rows on the parcel, and block filing evidence.",
      "An address page shows the matched address rows with their linkage tier, the parcel key each links to, and the EAS id.",
      "The filing-evidence section carries a REPORTED stamp and a block note: scope is the block only, and the evidence is never attributed to a specific parcel or address.",
      "Every record carries provenance footnotes naming the source of each field.",
    ].join("\n"),
  },
];

/** Corpus loader for mountInfiniteFaq: the static module, shared per isolate. */
export async function loadFaqCorpus(): Promise<FaqCorpusDoc[]> {
  return CORPUS;
}

/** Test seam: the corpus byte size the prompt budget is measured against. */
export function corpusChars(): number {
  return CORPUS.reduce((n, d) => n + d.text.length, 0);
}

// ---------------------------------------------------------------------------
// The record on screen, re-read from the site's own store
// ---------------------------------------------------------------------------

/** The slice of a LedgerAdapter the context document needs (src/app.tsx). */
export type FaqLedgerAdapter = {
  lookupParcel(q: string): Promise<unknown>;
  lookupAddress(q: string): Promise<unknown>;
};

/**
 * ceiling: a record doc is ~3 KB, so 64 entries is ~200 KB against a 128 MB isolate.
 * corpus: the pages themselves are public-cacheable, so a doc is never staler than
 *   the page beside it.
 */
export const RECORD_DOC_CACHE_MAX = 64;

export const RECORD_DOC_TTL_MS = 300_000;

/**
 * Unknown ids are remembered separately so that rotating made-up ids (a store read
 * each) cannot push the real records out of their 64 slots.
 */
export const RECORD_MISS_CACHE_MAX = 1024;

const recordDocs = new Map<string, { doc: FaqCorpusDoc; expires: number }>();

const recordMisses = new Map<string, number>();

/** Test seam: the cache keys in eviction order (oldest first). */
export function recordDocKeys(): string[] {
  return [...recordDocs.keys()];
}

function lruSet<V>(map: Map<string, V>, max: number, key: string, value: V) {
  map.delete(key);

  if (map.size >= max) {
    const oldest = map.keys().next().value;

    if (oldest !== undefined) map.delete(oldest);
  }

  map.set(key, value);
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "n/a";
  const n = Number(v);
  if (Number.isFinite(n)) return n.toLocaleString("en-US");
  return esc(v);
}

/**
 * Third-party strings (an address, a block number) come out of the city's own
 * published files. One line, quotes flattened, so a crafted value stays one
 * value in the prompt — the prompt already says these are data, not instructions.
 */
function quoted(s: unknown, max = 120): string {
  const flat = esc(s).replace(/\s+/g, " ").replace(/"/g, "'").trim();

  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** The document for one parcel page — the same fields /result renders, from the re-read record. */
export function parcelDoc(profile: Record<string, any>): FaqCorpusDoc {
  const parcel = (profile.parcel ?? {}) as Record<string, any>;
  const bf = (profile.block_filings ?? {}) as Record<string, any>;
  const addrs = (profile.addresses ?? {}) as Record<string, any>;
  const sample: string[] = addrs.base_addresses_sample ?? [];

  const lines = [
    `The parcel page the visitor is reading on ${SITE_NAME} (this page).`,
    `Parcel key: "${quoted(parcel.blklot, 20) || "not shown"}" (block ${quoted(parcel.block_num, 10)}, lot ${quoted(parcel.lot_num, 10)}).`,
    `Status in the assessor file: ${parcel.active ? "Active" : "Retired"}.`,
    `Neighborhood: ${quoted(parcel.analysis_neighborhood, 60) || "not listed"}. Zoning: ${quoted(parcel.zoning_code, 20) || "not listed"}.`,
    `Addresses on this parcel: ${fmt(addrs.count)} (${fmt(addrs.units)} unit rows).`,
  ];

  if (bf && bf.filing_count !== undefined && bf.filing_count !== null) {
    lines.push(
      `Block filing evidence (block level only, never attributed to this parcel): ${fmt(bf.filing_count)} inventory filings on block ${quoted(bf.block_num, 10)}${bf.submission_years ? `, submission years ${quoted((bf.submission_years as string[]).join(", "), 60)}` : ""}.`,
    );
  } else {
    lines.push(
      "Block filing evidence: the page resolved no block-level filing evidence for this parcel. Absence of filings proves nothing about legal rent-control status.",
    );
  }

  if (sample.length) {
    lines.push(
      `Sample of base addresses on this parcel (the page shows up to 10): ${sample.map((a) => `"${quoted(a, 60)}"`).join(", ")}.`,
    );
  }

  lines.push(
    "The visitor is on this parcel's own page, so do not repeat or link its web address.",
  );

  return {
    title: "This parcel",
    url: `${SITE_ORIGIN}/`,
    text: lines.join("\n"),
  };
}

/** The document for one address page — the same fields /result renders, from the re-read record. */
export function addressDoc(profile: Record<string, any>): FaqCorpusDoc {
  const matches: Array<Record<string, any>> = profile.matches ?? [];
  const tiers: string[] = profile.tiers_present ?? [];

  const lines = [
    `The address page the visitor is reading on ${SITE_NAME} (this page).`,
    `Address as searched: "${quoted(profile.query, 80)}". Normalized: "${quoted(profile.normalized, 80)}".`,
    `Matched EAS rows: ${fmt(profile.match_count)}${profile.matches_truncated ? " (the page truncates at 100)" : ""}.`,
  ];

  if (tiers.length) {
    lines.push(`Linkage tiers present: ${tiers.join(", ")}.`);
  }

  const top = matches.slice(0, 10);

  if (top.length) {
    lines.push(
      "Top matched rows (address, linkage tier, parcel key):",
      ...top.map(
        (m) =>
          `- "${quoted(m.address, 80)}": ${quoted(m.tier, 12)}${m.parcel?.blklot ? `, parcel ${quoted(m.parcel.blklot, 20)}` : ", no parcel key"}`,
      ),
    );
  }

  const ps = (profile.parcel_summary ?? {}) as Record<string, any>;

  if (ps.blklot) {
    lines.push(
      `Parcel summary: ${quoted(ps.blklot, 20)}${ps.multiple_parcels ? " (multiple parcels matched)" : ""}.`,
    );
  }

  lines.push(
    "Filing evidence on an address page is block-level and never attributed to the address. The visitor is on this address's own page, so do not repeat or link its web address.",
  );

  return {
    title: "This address",
    url: `${SITE_ORIGIN}/`,
    text: lines.join("\n"),
  };
}

/**
 * The record a visitor is looking at, as the first corpus document, re-read by id
 * with the page's own adapter. Returns null for an unknown id, so a made-up id
 * cannot put anything into the prompt. Nothing from the request body except the
 * validated {kind, id} reaches the document: the fields come from the adapter.
 */
export async function recordContextDoc(
  getAdapter: () => FaqLedgerAdapter,
  ctx: RecordContext,
): Promise<FaqCorpusDoc | null> {
  const key = `${ctx.kind}:${ctx.id.toLowerCase()}`;
  const now = Date.now();
  const hit = recordDocs.get(key);

  if (hit && hit.expires > now) {
    recordDocs.delete(key);
    recordDocs.set(key, hit);

    return hit.doc;
  }

  const missedAt = recordMisses.get(key);

  if (missedAt !== undefined && missedAt + RECORD_DOC_TTL_MS > now) return null;

  const doc = await loadRecordDoc(getAdapter, ctx);

  if (doc)
    lruSet(recordDocs, RECORD_DOC_CACHE_MAX, key, {
      doc,
      expires: now + RECORD_DOC_TTL_MS,
    });
  else lruSet(recordMisses, RECORD_MISS_CACHE_MAX, key, now);

  return doc;
}

async function loadRecordDoc(
  getAdapter: () => FaqLedgerAdapter,
  ctx: RecordContext,
): Promise<FaqCorpusDoc | null> {
  const adapter = getAdapter();

  try {
    if (ctx.kind === "parcel") {
      const profile = (await adapter.lookupParcel(ctx.id)) as Record<string, any>;

      return profile?.found ? parcelDoc(profile) : null;
    }

    const profile = (await adapter.lookupAddress(ctx.id)) as Record<string, any>;

    return profile?.found ? addressDoc(profile) : null;
  } catch {
    // A store read failure degrades to no record document, never to a half document.
    return null;
  }
}
