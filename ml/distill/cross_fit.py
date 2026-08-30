#!/usr/bin/env python3
"""Fit calibration on ONE set, evaluate on OTHERS. Cross-set generalisation.

Two problems with how this has been measured so far, both raised by John.

1. FITTING ON THE THIN SET IS DEGENERATE. calib_thin_full has max n_cm = 24, so
   fitting a density-dependent beta there asks the optimiser to find a curve
   using almost no density range. calib-11k spans n_cm 0..18,856 (median 184),
   which is where such a curve can actually be identified.

2. THE 3,322 "HELDOUT" IS NOT HELD OUT from calib-11k. Verified: all 3,322 ids
   are a strict SUBSET of the 11,070 calibration ids, re-downloaded at higher
   resolution. Evaluating calib-fitted parameters on it measures resolution
   sensitivity, NOT generalisation. The genuinely disjoint sets are the ones
   drawn from the groundtruth reservoirs.

So: fit on calib-11k, evaluate on the reservoir draws, and report whether a
density-scaled beta beats the shipped constant OUT OF SAMPLE.

Arms are the same three as fit_beta_density.py: const, satur, logscale.
"""
import argparse
import json
import math
import sys

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F

sys.path.insert(0, "/home/jlian/wingdex/ml/distill")
from occ4 import Occ                       # noqa: E402
from adaptive_sweep import build, cell_of  # noqa: E402

FLOOR_LOG = math.log(3e-5)


def prep(path, occ, k):
    df = pd.read_parquet(path)
    if "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx": "true_idx"})
    n = len(df)
    idxs = np.stack([np.asarray(x) for x in df["cand_idx"]])
    sims = np.stack([np.asarray(x, dtype=np.float32) for x in df["cand_sim"]])
    true = df["true_idx"].to_numpy()
    lat = df["latitude"].values
    lon = df["longitude"].values
    month = df["month"].values

    target = np.full(n, -1, dtype=np.int64)
    for i in range(n):
        h = np.nonzero(idxs[i] == true[i])[0]
        if len(h):
            target[i] = int(h[0])

    rl, has, _ = build(occ, lat, lon, month, idxs, k, "month1", 0)
    logp = np.maximum(rl, FLOOR_LOG)
    ncm = np.zeros(n, dtype=np.float32)
    for i in range(n):
        rc = cell_of(lat[i], lon[i])
        if rc is not None:
            ncm[i] = occ.total(rc[0], rc[1], int(month[i])) or 0

    return {
        "sims": torch.tensor(sims),
        "logp": torch.tensor(logp, dtype=torch.float32),
        "has": torch.tensor(has),
        "ncm": torch.tensor(ncm),
        "target": torch.tensor(target),
        "ncm_np": ncm,
        "n": n,
    }


def _fit(d, arm, idx, T0=0.0076):
    sims, logp, has, ncm, target = (d["sims"], d["logp"], d["has"],
                                    d["ncm"], d["target"])
    hm = has.unsqueeze(1).float()
    nn = ncm.unsqueeze(1).float()
    logT = torch.tensor(math.log(T0), requires_grad=True)
    if arm == "const":
        p2 = torch.tensor(math.log(1.0), requires_grad=True)
        params = [logT, p2]
    elif arm == "satur":
        p2 = torch.tensor(math.log(1.5), requires_grad=True)
        p3 = torch.tensor(math.log(50.0), requires_grad=True)
        params = [logT, p2, p3]
    else:
        p2 = torch.tensor(1.0, requires_grad=True)
        p3 = torch.tensor(0.0, requires_grad=True)
        params = [logT, p2, p3]

    opt = torch.optim.LBFGS(params, lr=0.05, max_iter=300,
                            tolerance_grad=1e-10)

    def beta_of(sub):
        if arm == "const":
            return p2.exp()
        if arm == "satur":
            return p2.exp() * nn[sub] / (nn[sub] + p3.exp())
        return F.softplus(p2 + p3 * torch.log1p(nn[sub]))

    def closure():
        opt.zero_grad()
        lg = sims[idx] / logT.exp() + beta_of(idx) * logp[idx] * hm[idx]
        t = target[idx]
        v = t >= 0
        loss = F.cross_entropy(lg[v], t[v])
        loss.backward()
        return loss

    opt.step(closure)
    out = {"T": float(logT.exp())}
    if arm == "const":
        out["beta"] = float(p2.exp())
    elif arm == "satur":
        out["beta_inf"] = float(p2.exp())
        out["n0"] = float(p3.exp())
    else:
        out["a"] = float(p2)
        out["c"] = float(p3)
    return out


def evaluate(d, arm, p):
    nn = d["ncm"].unsqueeze(1).float()
    hm = d["has"].unsqueeze(1).float()
    if arm == "const":
        b = torch.tensor(p["beta"])
    elif arm == "satur":
        b = p["beta_inf"] * nn / (nn + p["n0"])
    else:
        b = F.softplus(torch.tensor(p["a"]) + p["c"] * torch.log1p(nn))
    lg = d["sims"] / p["T"] + b * d["logp"] * hm
    return (lg.argmax(1) == d["target"]).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fit-on", required=True)
    ap.add_argument("--eval-on", required=True,
                    help="comma-separated name=path pairs")
    ap.add_argument("--occ",
                    default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--thin", type=int, default=10)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    occ = Occ(args.occ)
    print(f"  fitting on {args.fit_on}")
    fitd = prep(args.fit_on, occ, args.k)
    nc = fitd["ncm_np"]
    print(f"    n={fitd['n']:,}  n_cm median {np.median(nc):.0f}  "
          f"p90 {np.percentile(nc,90):.0f}  max {nc.max():.0f}")

    allidx = torch.arange(fitd["n"])
    fits = {}
    for arm in ("const", "satur", "logscale"):
        fits[arm] = _fit(fitd, arm, allidx)
        ps = "  ".join(f"{k}={v:.4f}" for k, v in fits[arm].items())
        print(f"    {arm:9s} {ps}")

    print("\n  === fitted beta(n) ===")
    print(f"  {'n_cm':>7s} {'const':>8s} {'satur':>8s} {'logscale':>9s}")
    for nv in (1, 5, 9, 25, 100, 500, 5000):
        bs = fits["satur"]["beta_inf"] * nv / (nv + fits["satur"]["n0"])
        bl = float(F.softplus(torch.tensor(
            fits["logscale"]["a"] + fits["logscale"]["c"] * math.log1p(nv))))
        print(f"  {nv:7d} {fits['const']['beta']:8.4f} {bs:8.4f} {bl:9.4f}")

    rng = np.random.RandomState(args.seed)
    for spec in args.eval_on.split(","):
        name, path = spec.split("=", 1)
        d = prep(path, occ, args.k)
        thin = d["ncm_np"] < args.thin
        print(f"\n  === EVAL on {name}  (n={d['n']:,}, "
              f"thin={int(thin.sum()):,}) ===")
        cs = {a: evaluate(d, a, fits[a]) for a in fits}
        for a in ("const", "satur", "logscale"):
            c = cs[a]
            at = 100 * c[thin].mean() if thin.sum() else float("nan")
            ar = 100 * c[~thin].mean() if (~thin).sum() else float("nan")
            print(f"    {a:9s} ALL {100*c.mean():6.2f}%  "
                  f"THIN {at:6.2f}%  RICH {ar:6.2f}%")
        base = cs["const"].astype(float)
        for a in ("satur", "logscale"):
            dd = cs[a].astype(float) - base
            for lb, m in (("ALL", np.ones(d["n"], bool)),
                          ("THIN", thin), ("RICH", ~thin)):
                if m.sum() == 0:
                    continue
                dm = dd[m]
                bs = np.array([dm[rng.randint(0, len(dm), len(dm))].mean()
                               for _ in range(args.boot)])
                lo, hi = np.percentile(bs, [2.5, 97.5])
                star = "*" if (lo > 0 or hi < 0) else " "
                print(f"      {a:9s} {lb:4s} {100*dm.mean():+6.2f}"
                      f"[{100*lo:+6.2f},{100*hi:+6.2f}]{star}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
