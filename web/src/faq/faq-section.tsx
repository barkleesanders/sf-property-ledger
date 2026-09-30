/** @jsxImportSource hono/jsx */
/**
 * "Ask anything" row — the server-rendered half of the infinite-FAQ drop-in
 * (~/.claude/skills/infinite-faq). Placement on this site:
 *
 *   header — the site header (src/views.tsx Topbar), on EVERY page. On a
 *            /result page it also carries the record's {kind, id} as a hidden
 *            `context`, so the answer is about THAT parcel or address
 *            (src/faq/faq-corpus.ts recordContextDoc re-reads it from the
 *            bundle/R2).
 *
 * The markup is a real <form method="post"> so it works with JavaScript off:
 * POST /api/faq/ask answers a form submit as text/plain. With JS on,
 * public/faq-island.js (built from src/faq/faq-island.tsx) finds #faq-ask and
 * replaces the form with the streaming version, reading its copy from the
 * data-* attributes.
 */

import type { FC } from "hono/jsx";
import type { RecordContext } from "./faq-route.js";

export const FAQ_ASK_ACTION = "/api/faq/ask";

export const FAQ_ASK_HOST_ID = "faq-ask";

export type FaqAskRowProps = {
  /** The record on the page, as the /result route names it. Header-only otherwise. */
  context?: RecordContext;
};

const PLACEHOLDER = "Ask anything about the ledger";
const LOADING = "Reading the ledger";

/** The #faq-ask host + no-JS form. Link /faq.css and load /faq-island.js on the page. */
export const FaqAskRow: FC<FaqAskRowProps> = ({ context }) => {
  // Only a record the page itself put here travels with the question; the route
  // validates the shape again and re-reads the record from the store.
  const ctx = context ? JSON.stringify({ kind: context.kind, id: context.id }) : "";

  return (
    <div
      id={FAQ_ASK_HOST_ID}
      class="faq-ask faq-ask--header"
      data-action={FAQ_ASK_ACTION}
      data-placeholder={PLACEHOLDER}
      data-loading={LOADING}
      data-send="Send"
      data-stop="Stop"
      data-context={ctx || undefined}
    >
      <form class="faq-ask-form" method="post" action={FAQ_ASK_ACTION}>
        <label for="faq-ask-input" class="faq-sr-only">
          {PLACEHOLDER}
        </label>
        <input
          id="faq-ask-input"
          class="faq-ask-input"
          type="text"
          name="question"
          placeholder={PLACEHOLDER}
          maxlength={600}
          autocomplete="off"
          required
        />
        {ctx ? <input type="hidden" name="context" value={ctx} /> : null}
        <button type="submit" class="faq-ask-btn is-ready" aria-label="Send">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
};
