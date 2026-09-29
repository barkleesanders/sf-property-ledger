#!/usr/bin/env python3
"""Generic DataSF Socrata harvester -> JSONL snapshot + manifest.

Resumable, per-page SHA-256, stdlib only. Canonical host: data.sf.gov
(data.sfgov.org 403s from this VM as of 2026-09-29).

Usage:
    socrata_harvest.py <dataset_id> --out DIR [--order col] [--page 5000] [--probe]
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

HOST = "https://data.sf.gov"
USER_AGENT = "SFPropertyLedger/1.0 (socrata-harvest)"
MAX_RETRIES = 40
MAX_BACKOFF_S = 300  # VM egress flaps for minutes at a time; be patient (2026-09-29)


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


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--out", required=True)
    ap.add_argument("--order", default=":id")
    ap.add_argument("--page", type=int, default=5000)
    ap.add_argument("--probe", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    snap = os.path.join(args.out, f"{args.dataset}.snapshot.jsonl")
    mpath = os.path.join(args.out, f"{args.dataset}.manifest.json")
    if args.probe:
        snap = os.path.join(args.out, f"{args.dataset}.sample.jsonl")
        mpath = os.path.join(args.out, f"{args.dataset}.sample.manifest.json")

    expected = int(fetch_json(
        f"{HOST}/resource/{args.dataset}.json?$select=count(*)")[0]["count"])
    print(f"dataset={args.dataset} expected_rows={expected}", flush=True)

    manifest = {
        "dataset_id": args.dataset, "source_host": HOST,
        "source_url": f"{HOST}/resource/{args.dataset}.json",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "expected_rows": expected, "page_size": args.page, "order": args.order,
        "pages": [],
    }
    if os.path.exists(mpath) and not args.probe:
        with open(mpath) as f:
            manifest = json.load(f)
        print(f"resuming: {len(manifest['pages'])} pages done", flush=True)

    done = {p["offset"] for p in manifest["pages"]}
    limit = 100 if args.probe else args.page
    offsets = [0] if args.probe else list(range(0, expected, args.page))

    with open(snap, "ab" if os.path.exists(snap) and not args.probe else "wb") as out:
        for offset in offsets:
            if offset in done:
                continue
            url = (f"{HOST}/resource/{args.dataset}.json?$limit={limit}"
                   f"&$offset={offset}&$order={args.order}")
            rows = fetch_json(url)
            if not rows:
                print(f"offset={offset}: empty page, stopping", flush=True)
                break
            blob = "".join(json.dumps(r, sort_keys=True) + "\n" for r in rows).encode()
            out.write(blob)
            out.flush()
            ph = hashlib.sha256(blob).hexdigest()
            manifest["pages"].append({"offset": offset, "rows": len(rows), "sha256": ph})
            print(f"offset={offset} rows={len(rows)} sha256={ph[:12]}…", flush=True)
            with open(mpath + ".tmp", "w") as mf:
                json.dump(manifest, mf, indent=2)
            os.replace(mpath + ".tmp", mpath)
            if args.probe:
                break

    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    manifest["total_pages"] = len(manifest["pages"])
    manifest["total_rows_written"] = sum(p["rows"] for p in manifest["pages"])
    manifest["file_sha256"] = sha256_file(snap)
    with open(mpath, "w") as mf:
        json.dump(manifest, mf, indent=2)
    print(f"DONE rows_written={manifest['total_rows_written']} "
          f"expected={expected} sha256={manifest['file_sha256'][:16]}…")
    if manifest["total_rows_written"] != expected and not args.probe:
        print("WARNING: row count mismatch — investigate before linkage", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
