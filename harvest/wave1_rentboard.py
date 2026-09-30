#!/usr/bin/env python3
"""Wave 1 harvest: SF Rent Board Housing Inventory (gdc7-dmcn) -> JSONL snapshot.

Raw, unmodified snapshot. Resumable: the manifest records the last completed
offset; re-running continues where it stopped. Per-page SHA-256 hashes make
every chunk independently verifiable. Stdlib only (no pandas dependency).

Usage:
    wave1_rentboard.py [--probe] [--out DIR]

--probe fetches only the first page (100 rows) to validate schema/connectivity.
"""
import argparse
import hashlib
import http.client
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

HOST = "https://data.sf.gov"          # data.sfgov.org 403s from this VM (2026-09-29)
DATASET = "gdc7-dmcn"                  # Rent Board Housing Inventory
PAGE_SIZE = 5000
MAX_RETRIES = 40
MAX_BACKOFF_S = 300  # VM egress flaps for minutes at a time; be patient (2026-09-29)

USER_AGENT = "SFPropertyLedger/1.0 (wave1-harvest; contact: barklee)"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        # NB: catch HTTPException too — IncompleteRead escapes urlopen unwrapped
        # (like RemoteDisconnected did before the OSError widening, 2026-09-29).
        except (urllib.error.URLError, OSError, http.client.HTTPException,
                json.JSONDecodeError) as e:
            wait = min(2 ** attempt, MAX_BACKOFF_S)
            print(f"  retry {attempt + 1}/{MAX_RETRIES} after {wait}s: {e}", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"fetch failed after {MAX_RETRIES} retries: {url}")


def row_count():
    url = f"{HOST}/resource/{DATASET}.json?$select=count(*)"
    return int(fetch_json(url)[0]["count"])


def fetch_page(offset, limit):
    url = f"{HOST}/resource/{DATASET}.json?$limit={limit}&$offset={offset}&$order=unique_id"
    return fetch_json(url)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--out", default=os.path.expanduser(
        "~/workspace/goals/sf-property-verification-ledger/data/wave1"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    snap_path = os.path.join(args.out, f"{DATASET}.snapshot.jsonl")
    manifest_path = os.path.join(args.out, f"{DATASET}.manifest.json")
    if args.probe:
        # Probe writes a standalone sample; never touches the real snapshot.
        snap_path = os.path.join(args.out, f"{DATASET}.sample.jsonl")
        manifest_path = os.path.join(args.out, f"{DATASET}.sample.manifest.json")

    expected = row_count()
    print(f"dataset={DATASET} expected_rows={expected}", flush=True)

    manifest = {
        "dataset_id": DATASET,
        "source_host": HOST,
        "source_url": f"{HOST}/resource/{DATASET}.json",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "expected_rows": expected,
        "page_size": PAGE_SIZE if not args.probe else 100,
        "pages": [],
    }
    if os.path.exists(manifest_path) and not args.probe:
        with open(manifest_path) as f:
            manifest = json.load(f)
        print(f"resuming: {len(manifest['pages'])} pages already done", flush=True)
        # FIX 2026-09-29: refresh the expected count on resume. The live
        # source can grow between runs (Wave 1: 551,244 -> 551,358 mid-harvest);
        # the stale value carried in the reloaded manifest would otherwise
        # never reconcile with the actual row count.
        manifest["expected_rows"] = expected

    done_offsets = {p["offset"] for p in manifest["pages"]}
    limit = 100 if args.probe else PAGE_SIZE
    offsets = [0] if args.probe else list(range(0, expected, PAGE_SIZE))

    mode = "ab" if os.path.exists(snap_path) and not args.probe else "wb"
    total_new = 0
    with open(snap_path, mode) as out:
        for offset in offsets:
            if offset in done_offsets:
                continue
            rows = fetch_page(offset, limit)
            if not rows:
                print(f"offset={offset}: empty page, stopping", flush=True)
                break
            page_bytes = "".join(json.dumps(r, sort_keys=True) + "\n" for r in rows).encode()
            out.write(page_bytes)
            out.flush()
            page_hash = hashlib.sha256(page_bytes).hexdigest()
            manifest["pages"].append({
                "offset": offset, "rows": len(rows), "sha256": page_hash})
            total_new += len(rows)
            print(f"offset={offset} rows={len(rows)} sha256={page_hash[:12]}…", flush=True)
            with open(manifest_path + ".tmp", "w") as mf:
                json.dump(manifest, mf, indent=2)
            os.replace(manifest_path + ".tmp", manifest_path)
            if args.probe:
                break

    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    manifest["total_pages"] = len(manifest["pages"])
    manifest["total_rows_written"] = sum(p["rows"] for p in manifest["pages"])
    manifest["file_sha256"] = sha256_file(snap_path)
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf, indent=2)

    print(f"DONE rows_written={manifest['total_rows_written']} "
          f"expected={expected} file_sha256={manifest['file_sha256'][:16]}…")
    if manifest["total_rows_written"] != expected and not args.probe:
        print("WARNING: row count mismatch vs expected — investigate before Wave 3",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
