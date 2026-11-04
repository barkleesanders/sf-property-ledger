/**
 * Wide-event emitter tests (run: `npx tsx src/wide-event.test.ts`).
 *
 * The emitter is the SF Property Ledger's one-canonical-log-line-per-request
 * contract: a single JSON `http_request` event with the pathname only (the
 * query string — and any token riding in it — never reaches the log), the
 * cf-ray request id, and an outcome derived from status / thrown error.
 */
import { strict as assert } from "node:assert";
import { emitWideEvent } from "./wide-event.js";

const seen: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  seen.push(String(args[0]));
};
try {
  const req = new Request("https://ledger.example/parcel/123?token=secret", {
    headers: { "cf-ray": "ray-123", "user-agent": "tsx-test" },
  });
  emitWideEvent(req, 200, Date.now() - 5);
  emitWideEvent(req, 404, Date.now() - 5);
  emitWideEvent(req, 500, Date.now() - 5, "TypeError");
} finally {
  console.log = origLog;
}

assert.equal(seen.length, 3, "one event per call");

const ok = JSON.parse(seen[0]);
assert.equal(ok.event, "http_request");
assert.equal(ok.method, "GET");
assert.equal(ok.path, "/parcel/123", "pathname only — query string stripped");
assert.equal(ok.status, 200);
assert.equal(ok.outcome, "ok");
assert.equal(ok.request_id, "ray-123");
assert.equal(ok.user_agent, "tsx-test");
assert.equal(typeof ok.duration_ms, "number");
assert.equal(ok.error, undefined);

const clientErr = JSON.parse(seen[1]);
assert.equal(clientErr.outcome, "client_error");

const err = JSON.parse(seen[2]);
assert.equal(err.status, 500);
assert.equal(err.outcome, "error");
assert.equal(err.error, "TypeError");

console.log("wide-event tests passed (3 events asserted)");
