#!/usr/bin/env python3
"""Arrange flat extracted photos into the corpus/<taxon_id>/<photo_id>.<ext>
layout that emit_calib_candidates.py expects.

Uses symlinks rather than copies: the images are already on fast local scratch
and duplicating ~1 GB to satisfy a path convention is waste. Patching the
shared emit script was the alternative, but that file is used by every previous
calibration run and its output feeds the shipped constants, so leaving it
untouched keeps those runs reproducible.

Usage:
  python3 layout_corpus.py --manifest thin_manifest.parquet \
      --flat /mnt/ssdscratch/thin-photos --out /mnt/ssdscratch/thin-corpus
"""
import argparse
import os
import sys
from pathlib import Path

import pandas as pd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--flat", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--copy", action="store_true",
                    help="copy instead of symlink")
    args = ap.parse_args()

    df = pd.read_parquet(args.manifest)
    flat = Path(args.flat)
    root = Path(args.out) / "corpus"
    root.mkdir(parents=True, exist_ok=True)

    linked = missing = 0
    missing_ids = []
    for r in df.itertuples():
        pid = str(r.photo_id)
        # The extension in the manifest can disagree with what was archived,
        # so trust the file on disk.
        src = None
        for ext in (str(r.extension).lower(), "jpg", "jpeg", "png", "gif"):
            p = flat / f"{pid}.{ext}"
            if p.exists() and p.stat().st_size > 1000:
                src = p
                break
        if src is None:
            missing += 1
            missing_ids.append(pid)
            continue
        d = root / str(r.inat_taxon_id)
        d.mkdir(parents=True, exist_ok=True)
        # emit_calib_candidates.py builds the path from the MANIFEST extension,
        # so the link must use that name even when the file on disk differs.
        dest = d / f"{pid}.{str(r.extension).lower()}"
        if dest.exists() or dest.is_symlink():
            dest.unlink()
        if args.copy:
            dest.write_bytes(src.read_bytes())
        else:
            dest.symlink_to(src.resolve())
        linked += 1

    print(f"  laid out {linked:,} photos under {root}")
    print(f"  missing  {missing:,}")
    if missing_ids[:5]:
        print(f"  e.g. {missing_ids[:5]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
