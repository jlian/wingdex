#!/usr/bin/env python3
"""Stratify the window arms by how well-sampled the cell is.

Aggregate top-1 hides the effect: the calibration set has median n_cm = 217
while the global blob median is 6, so photos in thin cells are only ~6% of the
validation split. Report each arm SEPARATELY on thin and rich cells.
"""
import argparse
import json
import math
import sys

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F

from ee_port import lonlat_to_ee, xy_to_cell
from occ4 import Occ
from window_sweep import build_logp, fit, softmax_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="calib_cands_tiny39_a060.parquet")
    ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--floor", type=float, default=3e-5)
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--arms", default="month1,month3,pooled,fallback")
    ap.add_argument("--thin", type=int, default=25)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--out", default="/home/jlian/window_strat.json")
    args = ap.parse_args()

    FLOOR = math.log(args.floor)
    df = pd.read_parquet(args.candidates)
    n = len(df)
    sims_np = np.stack(df["cand_sim"].values).astype(np.float64)
    sims = torch.tensor(sims_np, dtype=torch.float32)
    idxs = np.stack(df["cand_idx"].values)
    true = df["true_app_idx"].values
    pos = np.full(n, -1, dtype=np.int64)
    for i in range(n):
        h = np.where(idxs[i] == true[i])[0]
        if len(h):
            pos[i] = h[0]
    target = torch.tensor(pos)

    torch.manual_seed(0)
    perm = torch.randperm(n)
    cut = int(n * 0.7)
    tr, va = perm[:cut], perm[cut:].numpy()

    occ = Occ(args.occ)
    lat, lon, month = df["latitude"].values, df["longitude"].values, df["month"].values

    # n_cm per row, for stratification
    ncm = np.zeros(n, dtype=np.int64)
    for i in range(n):
        try:
            x, y = lonlat_to_ee(float(lon[i]), float(lat[i]))
            rc = xy_to_cell(x, y)
        except Exception:
            rc = None
        if rc is not None:
            ncm[i] = occ.total(rc[0], rc[1], int(month[i])) or 0

    thin_va = ncm[va] < args.thin
    print(f"  N={n}  val={len(va)}")
    print(f"  thin (n_cm < {args.thin}): {thin_va.sum():,} of {len(va):,} "
          f"({100*thin_va.mean():.1f}%)")
    print(f"  rich:                     {(~thin_va).sum():,}")
    print()
    print("  arm         T          beta      ALL       THIN      RICH")
    print("  " + "-" * 62)

    results = {}
    for arm in args.arms.split(","):
        rl, has, st = build_logp(occ, lat, lon, month, idxs, args.k, arm)
        lp = np.maximum(rl, FLOOR)
        T, b = fit(sims, torch.tensor(lp, dtype=torch.float32),
                   torch.tensor(has), target, tr)
        hm = has[:, None].astype(np.float64)
        logits = sims_np / T + b * lp * hm
        p = softmax_rows(logits[va])
        am, tv = p.argmax(axis=1), pos[va]
        correct = ((am == tv) & (tv >= 0)).astype(np.float64)
        a_all = correct.mean()
        a_thin = correct[thin_va].mean()
        a_rich = correct[~thin_va].mean()
        results[arm] = dict(T=T, beta=b, all=float(a_all), thin=float(a_thin),
                            rich=float(a_rich), correct=correct)
        print(f"  {arm:<11} {T:<10.6f} {b:<9.4f} {100*a_all:6.2f}%  "
              f"{100*a_thin:6.2f}%  {100*a_rich:6.2f}%")
        sys.stdout.flush()

    base = results["month1"]
    print()
    print(f"  deltas vs month1, paired bootstrap n={args.boot}")
    print("  " + "-" * 62)
    rng = np.random.RandomState(0)
    for arm, r in results.items():
        if arm == "month1":
            continue
        line = f"  {arm:<11}"
        for label, mask in (("ALL", np.ones(len(va), bool)),
                            ("THIN", thin_va), ("RICH", ~thin_va)):
            bc, ac = base["correct"][mask], r["correct"][mask]
            d = ac.mean() - bc.mean()
            N = len(bc)
            diffs = np.empty(args.boot)
            for bi in range(args.boot):
                s = rng.randint(0, N, N)
                diffs[bi] = ac[s].mean() - bc[s].mean()
            lo, hi = np.percentile(diffs, [2.5, 97.5])
            star = "*" if (lo > 0 or hi < 0) else " "
            line += f"  {label} {100*d:+6.2f}[{100*lo:+.2f},{100*hi:+.2f}]{star}"
        print(line)

    for r in results.values():
        r.pop("correct", None)
    json.dump(dict(thin_threshold=args.thin, arms=results),
              open(args.out, "w"), indent=1)
    print(f"\n  wrote {args.out}   (* = 95% CI excludes zero)")


if __name__ == "__main__":
    main()
