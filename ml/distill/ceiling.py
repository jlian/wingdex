#!/usr/bin/env python3
"""Rank the Guatemala photo's true species, and ask what K would have saved it.

The 25-candidate shortlist is a fixed cost in the app. If the true bird is
absent from top-25 in 14% of thin photos, the question is whether widening K
is cheap enough to matter, or whether those birds are so far down that no
practical K helps.
"""
import argparse
import sys

import numpy as np
import pandas as pd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--manifest", default="")
    ap.add_argument("--thin", type=int, default=10)
    args = ap.parse_args()

    df = pd.read_parquet(args.candidates)
    if "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx": "true_idx"})
    if args.manifest:
        m = pd.read_parquet(args.manifest)
        if "n_cm" in m.columns:
            m = m[["photo_id", "n_cm"]].copy()
            m["photo_id"] = m["photo_id"].astype(str)
            df["photo_id"] = df["photo_id"].astype(str)
            df = df.merge(m, on="photo_id", how="left")

    k = len(np.asarray(df["cand_idx"].iloc[0]))
    print(f"  {len(df):,} photos, shortlist K={k}")

    ranks = np.full(len(df), -1, dtype=np.int32)
    for i, (ti, ci, cs) in enumerate(
            zip(df["true_idx"], df["cand_idx"], df["cand_sim"])):
        ci = np.asarray(ci); cs = np.asarray(cs)
        o = np.argsort(-cs); ci = ci[o]
        h = np.nonzero(ci == ti)[0]
        if len(h):
            ranks[i] = int(h[0])

    absent = ranks < 0
    print(f"\n  absent from top-{k}: {absent.sum():,} "
          f"({100*absent.mean():.2f}%)")
    print("\n  === what the shortlist COSTS us ===")
    print("  Every photo whose true bird is absent is unreachable by any")
    print("  prior, any temperature, any range filter. It is a hard ceiling.")
    print(f"  ceiling on top-1 accuracy with K={k}: "
          f"{100*(1-absent.mean()):.2f}%")

    if "n_cm" in df.columns:
        thin = df["n_cm"].to_numpy() < args.thin
        print(f"    THIN ceiling: {100*(1-absent[thin].mean()):.2f}%")
        print(f"    RICH ceiling: {100*(1-absent[~thin].mean()):.2f}%")

    print("\n  === rank distribution of the ones we DO list ===")
    r = ranks[~absent]
    for c in (1, 2, 3, 5, 10, 15, 20, 25):
        if c <= k:
            print(f"    true bird in top-{c:<3}: "
                  f"{100*(r < c).sum()/len(df):.2f}% of all photos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
