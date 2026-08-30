#!/usr/bin/env python3
"""Extract a photo subset from the packed NAS WebDataset shards.

Why this rather than fetch_manifest.py: the reservoirs are already archived at
/mnt/nas/WingDex-Distill/datasets/ as <photo_id>.jpg plus <photo_id>.json, so
9,958 of a 10,000-photo draw are on local storage. Re-downloading them from
iNaturalist is 10,000 HTTPS round-trips for data we hold, and a few percent of
the oldest photos have been deleted upstream since the shards were packed.

Streams each tar ONCE and pulls only the wanted members, rather than seeking
per photo, because these live on SMB where random access is expensive.

Usage:
  python3 extract_from_shards.py --manifest thin_manifest.parquet \
      --out /mnt/ssdscratch/thin-photos
"""
import argparse
import json
import os
import sys
import tarfile
import time
from pathlib import Path

import pandas as pd

NAS = Path("/mnt/nas/WingDex-Distill/datasets")
DEFAULT_SETS = "ft-gen1-groundtruth,ft-gen2-groundtruth-fresh"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--datasets", default=DEFAULT_SETS)
    ap.add_argument("--nas", default=str(NAS))
    ap.add_argument("--also-json", action="store_true",
                    help="also extract the sidecar .json metadata")
    args = ap.parse_args()

    df = pd.read_parquet(args.manifest)
    want = {str(p) for p in df["photo_id"].tolist()}
    print(f"want {len(want):,} photos", flush=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # Anything already on disk from the aborted fetch counts as done.
    have = set()
    for p in out.iterdir():
        if p.is_file() and p.stat().st_size > 1000:
            have.add(p.stem)
    if have:
        print(f"already present: {len(have):,}", flush=True)

    todo = want - have
    found = 0
    t0 = time.time()
    for ds in args.datasets.split(","):
        root = Path(args.nas) / ds
        shards = sorted(root.glob("shard-*.tar"))
        if not shards:
            print(f"  {ds}: no shards, skipping", flush=True)
            continue
        for si, shard in enumerate(shards):
            if not todo:
                break
            got = 0
            with tarfile.open(shard, "r|") as tf:      # streaming mode
                for m in tf:
                    if not m.isfile():
                        continue
                    stem, _, ext = m.name.rpartition(".")
                    if stem not in todo:
                        continue
                    if ext.lower() in ("jpg", "jpeg", "png", "gif"):
                        data = tf.extractfile(m).read()
                        (out / f"{stem}.{ext.lower()}").write_bytes(data)
                        todo.discard(stem)
                        found += 1
                        got += 1
                    elif args.also_json and ext.lower() == "json":
                        data = tf.extractfile(m).read()
                        (out / f"{stem}.json").write_bytes(data)
            el = time.time() - t0
            print(f"  {ds}/{shard.name}: +{got}  total {found:,}  "
                  f"remaining {len(todo):,}  {el/60:.1f} min", flush=True)

    print(f"\nextracted {found:,} in {(time.time()-t0)/60:.1f} min")
    print(f"still missing: {len(todo):,}")
    if todo:
        miss = out.parent / "thin_missing.json"
        miss.write_text(json.dumps(sorted(todo)))
        print(f"  wrote {miss} -- fetch these with fetch_manifest.py if needed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
