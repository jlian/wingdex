#!/usr/bin/env python3
"""Fetch iNat photos listed in a parquet manifest.

fetch_large.py reads a JSON split and writes to a hardcoded directory, so it
cannot take the thin-cell manifest. Same conventions otherwise: the iNat photo
URL is .../<size>.<ext> with the size as a path segment, requests are
rate-limited and the whole thing is resumable, because an existing non-trivial
file is skipped rather than refetched.

Usage:
  python3 fetch_manifest.py --manifest thin_manifest.parquet \
      --out /mnt/ssdscratch/thin-photos --workers 8 --sleep 0.1
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

USER_AGENT = "WingDex/1.0 (research; contact via github.com/jlian/wingdex)"


def fetch(job):
    pid, ext, size, out, sleep_s = job
    dest = os.path.join(out, "%s.%s" % (pid, ext))
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return ("skip", pid, os.path.getsize(dest))
    url = "https://inaturalist-open-data.s3.amazonaws.com/photos/%s/%s.%s" % (
        pid, size, ext)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        tmp = dest + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
        time.sleep(sleep_s)
        return ("ok", pid, len(data))
    except urllib.error.HTTPError as e:
        return ("http%d" % e.code, pid, 0)
    except Exception as e:
        return ("err:%s" % type(e).__name__, pid, 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="medium",
                    choices=["large", "original", "medium"])
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--sleep", type=float, default=0.1)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    df = pd.read_parquet(a.manifest)
    if a.limit:
        df = df.head(a.limit)
    os.makedirs(a.out, exist_ok=True)

    jobs = [(str(r.photo_id), str(r.extension).lower(), a.size, a.out, a.sleep)
            for r in df.itertuples()]
    print("photos to fetch: %d at size=%s" % (len(jobs), a.size), flush=True)
    print("output: %s" % a.out, flush=True)

    counts = {}
    total = 0
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for status, pid, nbytes in ex.map(fetch, jobs):
            counts[status] = counts.get(status, 0) + 1
            total += nbytes
            done += 1
            if done % 250 == 0:
                el = time.time() - t0
                rate = done / max(el, 1e-9)
                eta = (len(jobs) - done) / max(rate, 1e-9)
                print("  %d/%d  %.1f req/s  %.2f GB  eta %.0f min  %s" % (
                    done, len(jobs), rate, total / 1e9, eta / 60,
                    ", ".join("%s=%d" % kv for kv in sorted(counts.items()))),
                    flush=True)

    el = time.time() - t0
    print("done in %.1f min  %.2f GB  %s" % (
        el / 60, total / 1e9,
        ", ".join("%s=%d" % kv for kv in sorted(counts.items()))), flush=True)
    ok = counts.get("ok", 0) + counts.get("skip", 0)
    print("usable: %d/%d (%.1f%%)" % (ok, len(jobs), 100 * ok / max(len(jobs), 1)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
