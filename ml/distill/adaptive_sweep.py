#!/usr/bin/env python3
"""Adaptive temporal window for issue #355.

Widen the month window ONLY when the cell-month is thin. Rich cells keep the
monthly slice, so the -0.63 pt loss month3 took on rich cells should not
appear, while thin cells get the extra counts.

Reuses window_sweep.build_logp's conventions and sweep_floor_k's harness
exactly: same parquet, same seed, same 70/30 split, same LBFGS fit, same
metrics. T and beta are refit per arm.

ARMS
  month1              shipped baseline
  adapt<N>            if n_cm < N use the 3-month window, else the monthly slice
  adapt<N>_pooled     if n_cm < N use the pooled slice, else the monthly slice
"""
import argparse
import json
import math
import sys

import numpy as np
import pandas as pd
import torch

from ee_port import lonlat_to_ee, xy_to_cell
from occ4 import Occ
from window_sweep import fit, softmax_rows, ece

NEG_INF = -np.inf


def cell_of(lat, lon):
    try:
        x, y = lonlat_to_ee(float(lon), float(lat))
        return xy_to_cell(x, y)
    except Exception:
        return None


def build(occ, lat, lon, month, idxs, k, mode, thresh):
    """mode: 'month1' | 'window' | 'pooled'.

    thresh: widen only when n_cm < thresh. thresh=0 means never widen, which
    reproduces month1; thresh=inf means always widen.
    """
    n, K = idxs.shape
    out = np.full((n, K), NEG_INF, dtype=np.float64)
    has = np.zeros(n, dtype=bool)
    widened = 0
    cache = {}

    for i in range(n):
        rc = cell_of(lat[i], lon[i])
        if rc is None:
            continue
        m = int(month[i])
        ck = (rc[0], rc[1], m)
        ent = cache.get(ck)
        if ent is None:
            pri = occ.cell_priors(rc[0], rc[1], m)
            pooled = occ.cell_pooled(rc[0], rc[1])
            ncm = occ.total(rc[0], rc[1], m)
            ent = (pri, pooled, ncm)
            if len(cache) < 40000:
                cache[ck] = ent
        pri, pooled, ncm = ent
        if pri is None:
            continue
        has[i] = True
        row = idxs[i]
        thin = (ncm or 0) < thresh

        if thin and mode == "pooled" and pooled is not None:
            widened += 1
            for j in range(K):
                lp = pooled.get(int(row[j]))
                out[i, j] = NEG_INF if lp is None else lp
            continue

        if thin and mode == "window":
            widened += 1
            wk = (rc[0], rc[1], m, "w")
            went = cache.get(wk)
            if went is None:
                agg, tot = {}, 0
                for dm in (-1, 0, 1):
                    mm = ((m - 1 + dm) % 12) + 1
                    p2 = occ.cell_priors(rc[0], rc[1], mm)
                    if p2 is None:
                        continue
                    n2 = occ.total(rc[0], rc[1], mm) or 0
                    tot += n2
                    for ix, lp in p2.items():
                        agg[ix] = agg.get(ix, 0.0) + math.exp(lp) * n2
                went = (agg, tot)
                if len(cache) < 40000:
                    cache[wk] = went
            agg, tot = went
            den = tot + k
            for j in range(K):
                ix = int(row[j])
                nscm = agg.get(ix, 0.0)
                pp = pooled.get(ix) if pooled else None
                ppv = 0.0 if pp is None else math.exp(pp)
                num = nscm + k * ppv
                out[i, j] = math.log(num / den) if num > 0 and den > 0 else NEG_INF
            continue

        # Shipped monthly path with Dirichlet backoff.
        ub = (pooled is not None) and (ncm is not None) and k > 0
        for j in range(K):
            ix = int(row[j])
            lp = pri.get(ix)
            if ub:
                nscm = 0.0 if lp is None else math.exp(lp) * ncm
                pp = pooled.get(ix)
                ppv = 0.0 if pp is None else math.exp(pp)
                num = nscm + k * ppv
                out[i, j] = math.log(num / (ncm + k)) if num > 0 else NEG_INF
            else:
                out[i, j] = NEG_INF if lp is None else lp
    return out, has, widened


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="calib_cands_tiny39_a060.parquet")
    ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--floor", type=float, default=3e-5)
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--thresholds", default="10,25,50,100")
    ap.add_argument("--thin", type=int, default=25)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--out", default="/home/jlian/adaptive_sweep.json")
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

    ncm_all = np.zeros(n, dtype=np.int64)
    for i in range(n):
        rc = cell_of(lat[i], lon[i])
        if rc is not None:
            ncm_all[i] = occ.total(rc[0], rc[1], int(month[i])) or 0
    thin_va = ncm_all[va] < args.thin

    print(f"  N={n}  fit={cut}  val={len(va)}")
    print(f"  THIN stratum (n_cm < {args.thin}): {thin_va.sum():,} val photos")
    print(f"  floor={args.floor}  k={args.k}")
    print()
    print("  arm                T          beta      ALL       THIN      RICH    widened")
    print("  " + "-" * 76)

    arms = [("month1", "month1", 0)]
    for t in [int(x) for x in args.thresholds.split(",")]:
        arms.append((f"adapt{t}", "window", t))
    for t in [int(x) for x in args.thresholds.split(",")]:
        arms.append((f"adapt{t}_pool", "pooled", t))

    results = {}
    for name, mode, thresh in arms:
        rl, has, widened = build(occ, lat, lon, month, idxs, args.k, mode, thresh)
        lp = np.maximum(rl, FLOOR)
        T, b = fit(sims, torch.tensor(lp, dtype=torch.float32),
                   torch.tensor(has), target, tr)
        hm = has[:, None].astype(np.float64)
        p = softmax_rows((sims_np / T + b * lp * hm)[va])
        am, tv = p.argmax(axis=1), pos[va]
        correct = ((am == tv) & (tv >= 0)).astype(np.float64)
        conf = p.max(axis=1)
        results[name] = dict(T=T, beta=b, all=float(correct.mean()),
                             thin=float(correct[thin_va].mean()),
                             rich=float(correct[~thin_va].mean()),
                             ece=ece(conf, correct), widened=widened,
                             correct=correct)
        print(f"  {name:<18} {T:<10.6f} {b:<9.4f} {100*correct.mean():6.2f}%  "
              f"{100*correct[thin_va].mean():6.2f}%  "
              f"{100*correct[~thin_va].mean():6.2f}%  {widened:>7,}")
        sys.stdout.flush()

    base = results["month1"]
    print()
    print(f"  deltas vs month1, paired bootstrap n={args.boot}   (* = CI excludes 0)")
    print("  " + "-" * 76)
    rng = np.random.RandomState(0)
    for name, r in results.items():
        if name == "month1":
            continue
        line = f"  {name:<18}"
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
            line += f" {label} {100*d:+5.2f}[{100*lo:+.2f},{100*hi:+.2f}]{star}"
        print(line)

    for r in results.values():
        r.pop("correct", None)
    json.dump(dict(floor=args.floor, k=args.k, thin=args.thin, arms=results),
              open(args.out, "w"), indent=1)
    print(f"\n  wrote {args.out}")


if __name__ == "__main__":
    main()
