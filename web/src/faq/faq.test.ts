/**
 * Infinite-FAQ tests for the SF Property Ledger (run: `npx tsx src/faq/faq.test.ts`).
 *
 * Three threads, same as the hospital-ledger reference port:
 *   a. a grounded question gets an answer citing the site's corpus (stubbed AI);
 *   b. negative control: the prompt carries the "does not cover" rule and the
 *      fallback URL, and empty / over-long questions 400;
 *   c. false record fields never reach the prompt: unknown context keys are
 *      stripped, an unknown record id is ignored, and the record document comes
 *      only from the adapter re-read (never from the request).
 * Plus the measured llama digit-chunk regression (response: 4 as a JSON number).
 */
import { strict as assert } from "node:assert";
import { Hono } from "hono";
import {
  mountInfiniteFaq,
  RecordContextSchema,
  type FaqAi,
  type FaqEnv,
  type FaqModel,
  type InfiniteFaqOptions,
} from "./faq-route.js";
import {
  addressDoc,
  loadFaqCorpus,
  parcelDoc,
  recordContextDoc,
  SF_EXTRA_RULES,
  SITE_NAME,
} from "./faq-corpus.js";

/** A model that answers from a canned SSE frame; captures what the route sent it. */
function stubAi(
  frame: string,
  seen: { model?: string; system?: string; user?: string } = {},
): FaqAi {
  return {
    async run(model: FaqModel, input: Parameters<FaqAi["run"]>[1]) {
      seen.model = model;
      seen.system = input.messages[0]?.content;
      seen.user = input.messages[1]?.content;
      const bytes = new TextEncoder().encode(frame);
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      });
    },
  };
}

const FRAME_OK =
  `data: {"response":"The ledger covers 236,560 parcels."}\n\n` + `data: [DONE]\n\n`;

// Frame shape measured 3/3 on wrangler dev with the real binding (2026-09-18): a token
// that is only digits arrives as a bare JSON number on both fields.
const FRAME_DIGITS =
  `data: {"response":4,"delta":{"content":"7 \\n"}}\n\n` + `data: [DONE]\n\n`;

type TestBindings = { AI: FaqAi };

interface TestEnv extends FaqEnv {
  Bindings: TestBindings;
}

function testApp(
  seen: { model?: string; system?: string; user?: string },
  frame: string,
  contextDoc?: InfiniteFaqOptions<TestEnv>["contextDoc"],
) {
  const app = new Hono<TestEnv>();
  mountInfiniteFaq(app, {
    siteName: SITE_NAME,
    fallbackUrl: "/method",
    corpus: loadFaqCorpus,
    contextDoc,
    extraRules: SF_EXTRA_RULES,
  });

  return async (init: RequestInit) => {
    const res = await app.request("/api/faq/ask", init, {
      AI: stubAi(frame, seen),
    });
    return res;
  };
}

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------- a. grounded

await check("grounded question: prompt carries the corpus and answer cites it", async () => {
  const seen: { system?: string } = {};
  const ask = testApp(seen, FRAME_OK);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "how many parcels does the ledger cover?" }),
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /236,560 parcels/); // the stubbed model's answer cites the corpus number
  assert.ok(seen.system, "system prompt reached the model");
  assert.match(seen.system!, /236,560 parcels/, "corpus grounds the prompt");
  assert.match(seen.system!, /SF Property Ledger/, "site name in the prompt");
});

await check("no-JS form POST answers as text/plain", async () => {
  const seen: { system?: string } = {};
  const ask = testApp(seen, FRAME_OK);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ question: "what are the four tiers?" }).toString(),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  assert.match(await res.text(), /236,560 parcels/);
});

// ---------------------------------------------------------------- b. negative

await check("negative control: the prompt refuses off-corpus topics and names the fallback", async () => {
  const seen: { system?: string } = {};
  const ask = testApp(seen, FRAME_OK);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "who won the world series?" }),
  });
  assert.equal(res.status, 200);
  assert.ok(seen.system, "system prompt reached the model");
  assert.match(seen.system!, /does not cover the question/, "refusal rule in the prompt");
  assert.match(seen.system!, /\/method/, "fallback URL in the prompt");
  assert.match(seen.system!, /never say an address/, "rent-control rule in the prompt");
});

await check("empty question 400s", async () => {
  const ask = testApp({}, FRAME_OK);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "" }),
  });
  assert.equal(res.status, 400);
});

await check("601-char question 400s", async () => {
  const ask = testApp({}, FRAME_OK);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "x".repeat(601) }),
  });
  assert.equal(res.status, 400);
});

await check("malformed context 400s with the page-reference message", async () => {
  const ask = testApp({}, FRAME_OK);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: "anything",
      context: { kind: "parcel", id: "not a parcel key at all!!!" },
    }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /page reference/i);
});

// ---------------------------------------------------------------- c. record context

await check("extra context keys are stripped by the schema", () => {
  const parsed = RecordContextSchema.safeParse({
    kind: "parcel",
    id: "0189001A",
    filing_count: 999999,
    is_rent_controlled: true,
  });
  assert.ok(parsed.success);
  assert.deepEqual(Object.keys(parsed.data).sort(), ["id", "kind"]);
});

await check("unknown record id: no record document, prompt never sees the id", async () => {
  const seen: { system?: string } = {};
  const contextDoc = async (
    _env: TestBindings,
    ctx: { kind: "parcel" | "address"; id: string },
    _req: Request,
  ) => {
    // The site's adapter found nothing, exactly like the real one does.
    const doc = await recordContextDoc(
      () => ({
        lookupParcel: async () => ({ found: false }),
        lookupAddress: async () => ({ found: false }),
      }),
      ctx,
    );
    assert.equal(doc, null);
    return doc;
  };
  const ask = testApp(seen, FRAME_OK, contextDoc);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: "what about this parcel?",
      context: { kind: "parcel", id: "0999001A" },
    }),
  });
  assert.equal(res.status, 200);
  assert.ok(seen.system);
  assert.doesNotMatch(seen.system!, /0999001A/, "the unknown id never enters the prompt");
});

await check("record document comes from the adapter re-read, not the request", async () => {
  // The adapter's record disagrees with the request id; the doc must use the store.
  const doc = await recordContextDoc(
    () => ({
      lookupParcel: async () => ({
        found: true,
        parcel: { blklot: "FROM-THE-STORE", block_num: "0189", lot_num: "001A", active: true },
        addresses: { count: 3, units: 9 },
        block_filings: { filing_count: 12, block_num: "0189" },
      }),
      lookupAddress: async () => ({ found: false }),
    }),
    { kind: "parcel", id: "0189001A" },
  );
  assert.ok(doc);
  assert.match(doc!.text, /FROM-THE-STORE/);
});

await check("address record document lists tiers and rows, never the site's URL", () => {
  const doc = addressDoc({
    found: true,
    query: "1355 Taylor St",
    normalized: "1355 TAYLOR ST",
    match_count: 2,
    matches: [
      { address: "1355 Taylor St #101", tier: "VERIFIED", parcel: { blklot: "0189001A" } },
      { address: "1355 Taylor St", tier: "REPORTED" },
    ],
    tiers_present: ["VERIFIED", "REPORTED"],
  });
  assert.match(doc.text, /VERIFIED/);
  assert.match(doc.text, /1355 Taylor St #101/);
  assert.doesNotMatch(doc.text, /result\?q=/);
});

await check("parcel record document states block evidence is block-level only", () => {
  const doc = parcelDoc({
    found: true,
    parcel: { blklot: "0189001A", block_num: "0189", lot_num: "001A", active: true },
    addresses: { count: 4, units: 18 },
    block_filings: { filing_count: 42, block_num: "0189", submission_years: ["2023", "2024"] },
  });
  assert.match(doc.text, /never attributed to this parcel/);
  assert.match(doc.text, /42/);
});

// ------------------------------------------------- digit chunk regression

await check("a digits-only token arrives as a JSON number, never a dropped frame", async () => {
  const seen: { system?: string } = {};
  const ask = testApp(seen, FRAME_DIGITS);
  const res = await ask({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "how many?" }),
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  // The frame carries {"response":4,"delta":{"content":"7 \n"}}: the delta wins and the
  // numeric response copy does not lose the token's whitespace or get dropped.
  assert.match(body, /7 \\n/);
  assert.doesNotMatch(body, /"4",/, "a bare 4 as response would not shadow the delta");
});

console.log(`\n${passed} checks passed`);
