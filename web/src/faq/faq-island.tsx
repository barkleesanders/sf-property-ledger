/** @jsxImportSource hono/jsx/dom */
/// <reference lib="dom" />
/**
 * "Ask anything" island (hono/jsx/dom, browser only) — SF Property Ledger copy of
 * the infinite-FAQ drop-in (~/.claude/skills/infinite-faq/template/faq-island.tsx).
 *
 * Built to public/faq-island.js by `npm run build:faq` (esbuild); the built file is
 * committed so a deploy never depends on the build step having run. NEVER import this
 * module from server code: it imports hono/jsx/dom.
 *
 * Mounts on the SSR'd #faq-ask row in the site header (src/faq/faq-section.tsx) and
 * replaces the no-JS form with the live one: type → submit streams the answer inline
 * below the row; a shimmer shows before the first token; Stop aborts the fetch and
 * keeps whatever streamed so far.
 *
 * Wire: POST {action} with JSON {question, context?}; response is text/event-stream
 * where every line is
 *   data: {"type":"text-delta","delta":"..."} | {"type":"error","message":"..."} | {"type":"finish"}
 *   data: [DONE]
 * (the route in faq-route.ts normalises the model's own chunk shape into this).
 *
 * Safety: the answer is rendered by building DOM nodes from a tiny markdown subset —
 * paragraphs, **bold**, `code`, lists and links. Text is never assigned through
 * innerHTML, and only this site's own URLs become links (./faq-links.ts); any other
 * URL the model emits stays visible as plain text. Works under CSP
 * `script-src 'self'`: no inline handlers, no eval.
 */

import type { Child } from "hono/jsx";
import { useEffect, useRef, useState } from "hono/jsx";
import { render } from "hono/jsx/dom";
import { isSiteLink } from "./faq-links.js";

/**
 * ceiling: the reference client (references/foglamp-AskFoggy.pretty.js, `maxLength: 600`) —
 *   the wire has no lower platform cap; the server enforces the same bound in faq-route.ts.
 * corpus: a question about a parcel or an address runs well under 100 chars; 600 refuses
 *   none of them and still fences off pasted documents.
 */
const MAX_QUESTION_CHARS = 600;

const FALLBACK_ERROR = "Hit a snag. Please try again in a moment.";

type Status = "idle" | "loading" | "streaming" | "done" | "error";

type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "error"; message: string }
  | { type: "finish" };

function parseEvent(payload: string): StreamEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || !("type" in raw)) return null;
  const ev = raw as { type: unknown; delta?: unknown; message?: unknown };
  if (ev.type === "text-delta" && typeof ev.delta === "string") {
    return { type: "text-delta", delta: ev.delta };
  }
  if (ev.type === "error") {
    return { type: "error", message: typeof ev.message === "string" ? ev.message : "" };
  }
  if (ev.type === "finish") return { type: "finish" };
  return null;
}

/** Error copy from a non-2xx JSON body ({error: "..."}), else the generic fallback. */
async function errorCopy(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const e = (body as { error: unknown }).error;
      if (typeof e === "string" && e) return e;
    }
  } catch {
    // not JSON — fall through
  }
  return FALLBACK_ERROR;
}

// ---------------------------------------------------------------------------
// Minimal markdown → JSX (text nodes only; never HTML strings)
// ---------------------------------------------------------------------------

/** [label](url), **bold**, `code`, bare http(s) URLs. */
const INLINE_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g;

function renderInline(text: string) {
  const out: Child[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const [whole, label, href, bold, code, bare] = m;
    if (label !== undefined && href !== undefined) {
      out.push(
        isSiteLink(href) ? (
          <a href={href} rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          `${label} (${href})`
        ),
      );
    } else if (bold !== undefined) {
      out.push(<strong>{bold}</strong>);
    } else if (code !== undefined) {
      out.push(<code>{code}</code>);
    } else if (bare !== undefined) {
      out.push(
        isSiteLink(bare) ? (
          <a href={bare} rel="noopener noreferrer">
            {bare}
          </a>
        ) : (
          bare
        ),
      );
    } else {
      out.push(whole);
    }
    last = idx + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

const UL_RE = /^\s*[-*•]\s+/;
const OL_RE = /^\s*\d+[.)]\s+/;

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const line of md.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    const listKind = UL_RE.test(line) ? "ul" : OL_RE.test(line) ? "ol" : null;
    if (listKind) {
      flushPara();
      const item = line.replace(listKind === "ul" ? UL_RE : OL_RE, "").trim();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === listKind) prev.items.push(item);
      else blocks.push({ kind: listKind, items: [item] });
      continue;
    }
    // Strip markdown headings — the answer sits under a question, it needs no titles.
    para.push(trimmed.replace(/^#{1,6}\s+/, ""));
  }
  flushPara();
  return blocks;
}

const Markdown = ({ text }: { text: string }) => (
  <>
    {parseBlocks(text).map((b) =>
      b.kind === "p" ? (
        <p>{renderInline(b.text)}</p>
      ) : b.kind === "ul" ? (
        <ul>
          {b.items.map((it) => (
            <li>{renderInline(it)}</li>
          ))}
        </ul>
      ) : (
        <ol>
          {b.items.map((it) => (
            <li>{renderInline(it)}</li>
          ))}
        </ol>
      ),
    )}
  </>
);

// ---------------------------------------------------------------------------
// The ask row
// ---------------------------------------------------------------------------

/** The record the SSR page put on the host, re-validated; the server re-reads it. */
type RecordContext = { kind: "parcel" | "address"; id: string };

type AskProps = {
  action: string;
  placeholder: string;
  loadingText: string;
  sendLabel: string;
  stopLabel: string;
  context: RecordContext | null;
  initialQuestion: string;
  initialFocus: boolean;
};

const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

const ArrowIcon = () => (
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
);

function AskRow({
  action,
  placeholder,
  loadingText,
  sendLabel,
  stopLabel,
  context,
  initialQuestion,
  initialFocus,
}: AskProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  // Set on the first delta of the current question; a Stop before it means there is
  // nothing to show, so the row goes back to idle, not to an empty panel.
  const received = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);

  // Abort an in-flight stream if the island unmounts.
  useEffect(() => () => controller.current?.abort(), []);

  // Mounting replaced the SSR form; give the caret back if the visitor was typing.
  useEffect(() => {
    if (!initialFocus) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const busy = status === "loading" || status === "streaming";
  const showShimmer = status === "loading";

  // Send turns into Stop in place (same DOM node), so the second click of a
  // double-click, or a held Enter, would cancel the question just asked.
  const stop = (e: MouseEvent) => {
    if (e.detail > 1) return;
    controller.current?.abort();
  };

  const readStream = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let acc = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const ev = parseEvent(payload);
        if (!ev) continue;
        if (ev.type === "text-delta") {
          acc += ev.delta;
          received.current = true;
          setAnswer(acc);
          setStatus("streaming");
        } else if (ev.type === "error") {
          throw new Error(ev.message);
        }
      }
    }
    return acc;
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const ac = new AbortController();
    controller.current = ac;
    received.current = false;
    setAnswer("");
    setError("");
    setStatus("loading");
    try {
      const res = await fetch(action, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(context ? { question: q, context } : { question: q }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const copy = await errorCopy(res);
        // Stop pressed while the error body was being read: a cancel, not a snag.
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        throw new Error(copy);
      }
      const text = await readStream(res.body);
      if (!text.trim()) throw new Error("");
      setStatus("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Stopped by the user: keep the partial answer (no error copy), or go
        // back to idle when nothing had arrived yet.
        setStatus(received.current ? "done" : "idle");
      } else {
        setError(err instanceof Error && err.message ? err.message : FALLBACK_ERROR);
        setStatus("error");
      }
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  };

  return (
    <div>
      <form class="faq-ask-form" onSubmit={submit}>
        <label for="faq-ask-input" class="faq-sr-only">
          {placeholder}
        </label>
        <input
          ref={input}
          id="faq-ask-input"
          class="faq-ask-input"
          type="text"
          value={question}
          onInput={(e: Event) => {
            if (e.target instanceof HTMLInputElement) setQuestion(e.target.value);
          }}
          placeholder={placeholder}
          maxLength={MAX_QUESTION_CHARS}
          autocomplete="off"
        />
        {busy ? (
          <button
            type="button"
            class="faq-ask-btn is-stop"
            aria-label={stopLabel}
            onClick={stop}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.repeat) e.preventDefault();
            }}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            class={question.trim() ? "faq-ask-btn is-ready" : "faq-ask-btn"}
            aria-label={sendLabel}
            disabled={!question.trim()}
          >
            <ArrowIcon />
          </button>
        )}
      </form>
      {status !== "idle" && (
        <div class="faq-answer" aria-live="polite" aria-busy={busy}>
          {showShimmer && <p class="faq-shimmer">{loadingText}</p>}
          {answer && <Markdown text={answer} />}
          {status === "error" && <p class="faq-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The record context faq-section.tsx serialises onto the host: the route's own shape
 * (faq-route.ts RecordContextSchema). The server validates the id and re-reads the
 * record; here we only refuse to forward something that is not a record reference at all.
 */
function contextFrom(el: HTMLElement): RecordContext | null {
  let json: unknown;
  try {
    json = JSON.parse(el.dataset.context ?? "");
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const c = json as { kind?: unknown; id?: unknown };
  if (
    (c.kind === "parcel" || c.kind === "address") &&
    typeof c.id === "string" &&
    c.id
  ) {
    return { kind: c.kind, id: c.id };
  }
  return null;
}

export function mountInfiniteFaq(el: HTMLElement) {
  // The SSR form is live until this script lands; keep what was typed in it.
  const ssrInput = el.querySelector("input[name=question]");
  const typed = ssrInput instanceof HTMLInputElement ? ssrInput : null;

  const props: AskProps = {
    action: el.dataset.action || "/api/faq/ask",
    placeholder: el.dataset.placeholder || "Ask anything",
    loadingText: el.dataset.loading || "Reading the ledger",
    sendLabel: el.dataset.send || "Send",
    stopLabel: el.dataset.stop || "Stop",
    context: contextFrom(el),
    initialQuestion: typed?.value ?? "",
    initialFocus: typed !== null && document.activeElement === typed,
  };

  el.replaceChildren();
  render(<AskRow {...props} />, el);
}

const host = document.getElementById("faq-ask");
if (host) mountInfiniteFaq(host);
