#!/usr/bin/env python3
"""Where does the TRUE species sit in the shortlist, before any prior?

Issue #355 has ruled out every reweighting of the geographic prior: blanket
3-month, pooled, adaptive-by-density, and BirdLife range all lose. That leaves
two hypotheses that the prior work cannot separate:

  H1  VISION: the true bird is in the candidate list but similarity-ranked
      badly, so no defensible prior can rescue it. Fix belongs in the tower.
  H2  RECALL: the true bird is not in the top-K at all, so the ranking stage
      never had a chance. Fix belongs in the shortlist / K.

These are different bugs with different owners, and the fix for one does
nothing for the other. This measures which we actually have.

Also answers a question the accuracy numbers hide: when the prior DOES flip a
photo, how far did it have to move it? If wins are all rank 2->1, the prior is
doing fine work and the failures are simply out of its reach.

Reads the same candidate parquet as the other benchmarks. No GPU.
"""
import argparse
import json
import sys

import numpy as np
import pandas as pd


def load(path):
    df = pd.read_parquet(path)
    # emit_calib_candidates.py writes true_app_idx; older sets used true_idx.
    if "true_idx" not in df.columns and "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx": "true_idx"})
    need = {"true_idx", "cand_idx", "cand_sim"}
    missing = need - set(df.columns)
    if missing:
        sys.exit(f"missing columns: {missing}\nhave: {list(df.columns)}")
    return df


def attach_ncm(df, manifest):
    """n_cm is not in the candidate parquet; join it from the draw manifest."""
    if not manifest:
        return df
    m = pd.read_parquet(manifest)
    if "n_cm" not in m.columns:
        return df
    m = m[["photo_id", "n_cm"]].copy()
    m["photo_id"] = m["photo_id"].astype(str)
    df = df.copy()
    df["photo_id"] = df["photo_id"].astype(str)
    return df.merge(m, on="photo_id", how="left")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--thin", type=int, default=10,
                    help="n_cm below this counts as THIN")
    ap.add_argument("--manifest", default="",
                    help="draw manifest carrying n_cm, for the thin split")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    df = attach_ncm(load(args.candidates), args.manifest)
    n = len(df)
    print(f"  {n:,} photos")

    has_ncm = "n_cm" in df.columns
    if has_ncm:
        thin_mask = df["n_cm"].to_numpy() < args.thin
        print(f"  THIN (n_cm < {args.thin}): {thin_mask.sum():,}")
    else:
        thin_mask = np.zeros(n, dtype=bool)
        print("  no n_cm column; skipping the thin split")

    true_idx = df["true_idx"].to_numpy()
    ranks = np.full(n, -1, dtype=np.int32)       # -1 = absent from shortlist
    sim_gap = np.full(n, np.nan)                 # top1_sim - true_sim

    for i, (ti, ci, cs) in enumerate(
            zip(true_idx, df["cand_idx"], df["cand_sim"])):
        ci = np.asarray(ci)
        cs = np.asarray(cs)
        order = np.argsort(-cs)                  # candidates may be unsorted
        ci = ci[order]
        cs = cs[order]
        hit = np.nonzero(ci == ti)[0]
        if len(hit):
            r = int(hit[0])
            ranks[i] = r
            sim_gap[i] = float(cs[0] - cs[r])

    present = ranks >= 0
    k = len(np.asarray(df["cand_idx"].iloc[0]))

    def block(label, m):
        if m.sum() == 0:
            return
        tot = int(m.sum())
        pres = present & m
        npres = int(pres.sum())
        print(f"\n  === {label}  (n={tot:,}) ===")
        print(f"    true species in top-{k}: {npres:,} ({100*npres/tot:.2f}%)")
        print(f"    ABSENT from top-{k}:     {tot-npres:,} "
              f"({100*(tot-npres)/tot:.2f}%)   <- H2 ceiling")
        r = ranks[pres]
        for cut in (1, 2, 3, 5, 10, 25):
            if cut <= k:
                c = int((r < cut).sum())
                print(f"      rank < {cut:<3}: {c:6,}  ({100*c/tot:.2f}% of all)")
        # Of the ones the vision tower gets WRONG but still lists, how far down?
        wrong = pres & (ranks != 0)
        if wrong.sum():
            rw = ranks[wrong]
            gw = sim_gap[wrong]
            print(f"    of {int(wrong.sum()):,} listed-but-not-top1:")
            print(f"      rank    median {np.median(rw)+1:.0f}  "
                  f"p90 {np.percentile(rw,90)+1:.0f}")
            print(f"      sim gap median {np.median(gw):.4f}  "
                  f"p90 {np.percentile(gw,90):.4f}")
            for thr in (0.01, 0.02, 0.05):
                c = int((gw < thr).sum())
                print(f"      gap < {thr:.2f}: {c:6,} "
                      f"({100*c/tot:.2f}% of all) reachable by a prior")

    block("ALL", np.ones(n, dtype=bool))
    if has_ncm:
        block(f"THIN n_cm<{args.thin}", thin_mask)
        block(f"RICH n_cm>={args.thin}", ~thin_mask)

    if args.out:
        json.dump({
            "n": int(n), "k": int(k),
            "in_topk": float(present.mean()),
            "rank1": float((ranks == 0).mean()),
            "median_rank_when_wrong":
                float(np.median(ranks[present & (ranks != 0)]) + 1)
                if (present & (ranks != 0)).sum() else None,
        }, open(args.out, "w"), indent=2)
        print(f"\n  wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
