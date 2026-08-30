#!/usr/bin/env python3
"""Draw a THIN-CELL calibration manifest from the untouched reservoir.

WHY THIS EXISTS
---------------
Four ranking changes have now been benchmarked and all four came back
inconclusive on the same stratum: the current calibration split holds only 456
validation photos in cells with n_cm < 25, and 216 with n_cm < 10. That cannot
resolve a one-point effect, so every result reads "no significant change"
regardless of whether the change was good.

The reservoir fixes this without a new download of metadata. Both
groundtruth_heldout and groundtruth_fresh_v2 carry latitude, longitude and
observed_on, and both are untouched by distillation, so a geo-stratified draw
is a filter rather than a fetch.

LEAK SAFETY
-----------
Excludes, in this order:
  - any photo_id in the training manifest
  - any observation_uuid in the training manifest, because one iNat
    observation is often several photos of the same bird from the same moment,
    and photo-level splitting was measured to leak 56.5% through shared
    observations
  - any photo already in the existing calibration parquet, so the two sets can
    be compared without overlap

Then keeps ONE photo per observation, for the same independence reason.

Usage:
  python3 sample_thin_calib.py --n 10000 --max-ncm 25 --out thin_manifest.parquet
"""
import argparse
import sys

import numpy as np
import pandas as pd

from ee_port import lonlat_to_ee, xy_to_cell
from occ4 import Occ

D = "/home/jlian/wingdex/ml/distill/"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--train", default=D + "train_manifest.parquet")
    ap.add_argument("--exclude", default=D + "calib_cands_tiny39_a060.parquet")
    ap.add_argument("--reservoirs", default=(D + "groundtruth_heldout.parquet,"
                                             + D + "groundtruth_fresh_v2.parquet"))
    ap.add_argument("--n", type=int, default=10000)
    ap.add_argument("--max-ncm", type=int, default=25,
                    help="keep photos whose cell-month has FEWER than this many "
                         "observations; 25 matches the THIN stratum used in the "
                         "existing benchmarks")
    ap.add_argument("--max-per-species", type=int, default=8,
                    help="cap per species so a few common birds cannot dominate")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=D + "thin_manifest.parquet")
    args = ap.parse_args()

    train = pd.read_parquet(args.train, columns=["photo_id", "observation_uuid"])
    tr_pid = set(train["photo_id"].tolist())
    tr_obs = set(train["observation_uuid"].tolist())
    ex_pid = set(pd.read_parquet(args.exclude, columns=["photo_id"])["photo_id"].tolist())

    frames = []
    for p in args.reservoirs.split(","):
        d = pd.read_parquet(p)
        d["src"] = p.rsplit("/", 1)[-1].replace(".parquet", "")
        frames.append(d)
    res = pd.concat(frames, ignore_index=True)
    n0 = len(res)

    res = res[~res["photo_id"].isin(tr_pid)]
    res = res[~res["observation_uuid"].isin(tr_obs)]
    res = res[~res["photo_id"].isin(ex_pid)]
    res = res.drop_duplicates(subset="observation_uuid", keep="first")
    print(f"  reservoir {n0:,} -> {len(res):,} after leak filter and dedupe")

    res = res.copy()
    res["month"] = pd.to_datetime(res["observed_on"], errors="coerce").dt.month
    res = res[res["month"].notna()]
    res["month"] = res["month"].astype(int)

    occ = Occ(args.occ)
    lat = res["latitude"].values
    lon = res["longitude"].values
    mon = res["month"].values
    ncm = np.full(len(res), -1, dtype=np.int64)
    cache = {}
    for i in range(len(res)):
        try:
            x, y = lonlat_to_ee(float(lon[i]), float(lat[i]))
            rc = xy_to_cell(x, y)
        except Exception:
            rc = None
        if rc is None:
            continue
        key = (rc[0], rc[1], int(mon[i]))
        v = cache.get(key)
        if v is None:
            v = occ.total(rc[0], rc[1], int(mon[i])) or 0
            if len(cache) < 250000:
                cache[key] = v
        ncm[i] = v
    res["n_cm"] = ncm

    thin = res[(res["n_cm"] >= 0) & (res["n_cm"] < args.max_ncm)]
    print(f"  thin pool (n_cm < {args.max_ncm}): {len(thin):,} photos, "
          f"{thin['app_idx'].nunique():,} species")

    # Cap per species so the draw is not dominated by a handful of common birds.
    rng = np.random.RandomState(args.seed)
    thin = thin.sample(frac=1.0, random_state=args.seed)
    thin = thin.groupby("app_idx", group_keys=False).head(args.max_per_species)
    print(f"  after per-species cap of {args.max_per_species}: {len(thin):,}")

    if len(thin) > args.n:
        thin = thin.sample(n=args.n, random_state=args.seed)
    thin = thin.sort_values("photo_id").reset_index(drop=True)

    print(f"  drawn: {len(thin):,} photos, {thin['app_idx'].nunique():,} species")
    print(f"  n_cm  median {thin['n_cm'].median():.0f}  mean {thin['n_cm'].mean():.1f}")
    for t in (5, 10, 25):
        print(f"    n_cm < {t:>3}: {(thin['n_cm'] < t).sum():,}")

    cols = ["photo_id", "extension", "license", "observer_id", "observation_uuid",
            "inat_taxon_id", "app_idx", "scientific", "common",
            "latitude", "longitude", "observed_on", "n_cm", "src"]
    thin[[c for c in cols if c in thin.columns]].to_parquet(args.out, index=False)
    print(f"  wrote {args.out}")
    print()
    print("  next: fetch_large.py --manifest " + args.out)
    print("        emit_calib_candidates.py --manifest " + args.out + " ...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
