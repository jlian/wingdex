#!/usr/bin/env python3
"""Fit beta as a smooth function of cell density, instead of one global beta.

Motivation, from issue #355. The shipped reranker applies ONE beta (1.1634) to
log(prior) regardless of how much evidence the cell holds. In the Guatemala
photo the August slice has 9 observations, so the prior is weak evidence, yet it
carries exactly the same weight it would in a 5,000-observation cell. Replaying
that photo through the real code path, the prior already ranks the correct bird
FIRST among the five candidates; it simply loses to vision by 0.934 logits at
beta=1.1634 and wins at beta=2.0.

Every previous attempt widened the DATA (3-month window, pooled, adaptive by
threshold) and lost. This changes the WEIGHT instead, and does it as a fitted
function rather than hand-picked tiers, because hand-picked thresholds are
exactly what adapt10/25/50 were and they all lost.

    beta(n) = beta_inf * n / (n + n0)

A saturating (Michaelis-Menten) curve: beta -> 0 as evidence vanishes, and
beta -> beta_inf once the cell is well sampled. Two free parameters, no
thresholds, fitted jointly with T by the same LBFGS + cross-entropy procedure
window_sweep.fit uses, on the same fit/val split.

NOTE this is the opposite sign from the naive intuition. Down-weighting the
prior in thin cells makes the RANKING more vision-driven there, which would not
have fixed #355 on its own; what fixes #355 is beta being HIGHER than 1.1634
where the prior is informative. The fit decides which effect dominates, which is
the entire point of fitting rather than asserting.

Arms:
  const      shipped: one global beta                        (baseline)
  satur      beta(n) = beta_inf * n/(n+n0)                   (2 params)
  logscale   beta(n) = b0 + b1*log1p(n)                      (2 params, no cap)

Usage:
  python fit_beta_density.py --candidates calib_thin_full_a060.parquet
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


def fit_const(sims, logp, has, target, tr, T0=0.0076, b0=1.0):
    logT = torch.tensor(math.log(T0), requires_grad=True)
    logb = torch.tensor(math.log(b0), requires_grad=True)
    hm = has.unsqueeze(1).float()
    opt = torch.optim.LBFGS([logT, logb], lr=0.05, max_iter=300,
                            tolerance_grad=1e-10)

    def closure():
        opt.zero_grad()
        lg = sims[tr] / logT.exp() + logb.exp() * logp[tr] * hm[tr]
        t = target[tr]
        v = t >= 0
        loss = F.cross_entropy(lg[v], t[v])
        loss.backward()
        return loss

    opt.step(closure)
    return {"T": float(logT.exp()), "beta": float(logb.exp())}


def fit_satur(sims, logp, has, ncm, target, tr, T0=0.0076, binf=1.5, n00=50.0):
    """beta(n) = beta_inf * n / (n + n0), both positive via exp."""
    logT = torch.tensor(math.log(T0), requires_grad=True)
    logB = torch.tensor(math.log(binf), requires_grad=True)
    logN = torch.tensor(math.log(n00), requires_grad=True)
    hm = has.unsqueeze(1).float()
    nn = ncm.unsqueeze(1).float()
    opt = torch.optim.LBFGS([logT, logB, logN], lr=0.05, max_iter=300,
                            tolerance_grad=1e-10)

    def closure():
        opt.zero_grad()
        b = logB.exp() * nn[tr] / (nn[tr] + logN.exp())
        lg = sims[tr] / logT.exp() + b * logp[tr] * hm[tr]
        t = target[tr]
        v = t >= 0
        loss = F.cross_entropy(lg[v], t[v])
        loss.backward()
        return loss

    opt.step(closure)
    return {"T": float(logT.exp()), "beta_inf": float(logB.exp()),
            "n0": float(logN.exp())}


def fit_logscale(sims, logp, has, ncm, target, tr, T0=0.0076):
    """beta(n) = softplus(a + c*log1p(n)); unbounded, so it can exceed beta_inf."""
    logT = torch.tensor(math.log(T0), requires_grad=True)
    a = torch.tensor(0.0, requires_grad=True)
    c = torch.tensor(0.2, requires_grad=True)
    hm = has.unsqueeze(1).float()
    ln = torch.log1p(ncm.unsqueeze(1).float())
    opt = torch.optim.LBFGS([logT, a, c], lr=0.05, max_iter=300,
                            tolerance_grad=1e-10)

    def closure():
        opt.zero_grad()
        b = F.softplus(a + c * ln[tr])
        lg = sims[tr] / logT.exp() + b * logp[tr] * hm[tr]
        t = target[tr]
        v = t >= 0
        loss = F.cross_entropy(lg[v], t[v])
        loss.backward()
        return loss

    opt.step(closure)
    return {"T": float(logT.exp()), "a": float(a), "c": float(c)}


def acc_of(sims, logp, has, ncm, target, va, params, arm):
    hm = has.unsqueeze(1).float()
    nn = ncm.unsqueeze(1).float()
    if arm == "const":
        b = torch.tensor(params["beta"])
    elif arm == "satur":
        b = params["beta_inf"] * nn / (nn + params["n0"])
    else:
        b = F.softplus(torch.tensor(params["a"])
                       + params["c"] * torch.log1p(nn))
    lg = sims / params["T"] + b * logp * hm
    pred = lg.argmax(1)
    corr = (pred == target).numpy()
    return corr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--occ",
                    default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--floor", type=float, default=3e-5)
    ap.add_argument("--thin", type=int, default=10)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    df = pd.read_parquet(args.candidates)
    if "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx": "true_idx"})
    n = len(df)
    idxs = np.stack([np.asarray(x) for x in df["cand_idx"]])
    sims_np = np.stack([np.asarray(x, dtype=np.float32)
                        for x in df["cand_sim"]])
    true = df["true_idx"].to_numpy()
    lat = df["latitude"].values
    lon = df["longitude"].values
    month = df["month"].values

    # target = position of the true species within the shortlist, -1 if absent
    target_np = np.full(n, -1, dtype=np.int64)
    for i in range(n):
        h = np.nonzero(idxs[i] == true[i])[0]
        if len(h):
            target_np[i] = int(h[0])

    occ = Occ(args.occ)
    rl, has_np, _ = build(occ, lat, lon, month, idxs, args.k, "month1", 0)
    logp_np = np.maximum(rl, math.log(args.floor))

    ncm_np = np.zeros(n, dtype=np.float32)
    for i in range(n):
        rc = cell_of(lat[i], lon[i])
        if rc is not None:
            ncm_np[i] = occ.total(rc[0], rc[1], int(month[i])) or 0

    sims = torch.tensor(sims_np)
    logp = torch.tensor(logp_np, dtype=torch.float32)
    has = torch.tensor(has_np)
    ncm = torch.tensor(ncm_np)
    target = torch.tensor(target_np)

    g = torch.Generator().manual_seed(args.seed)
    perm = torch.randperm(n, generator=g)
    cut = int(n * 0.7)
    tr, va = perm[:cut], perm[cut:].numpy()
    thin_va = ncm_np[va] < args.thin

    print(f"  N={n:,}  fit={cut:,}  val={len(va):,}")
    print(f"  THIN (n_cm < {args.thin}): {int(thin_va.sum()):,} val photos")
    print(f"  n_cm  median {np.median(ncm_np):.0f}  "
          f"p90 {np.percentile(ncm_np, 90):.0f}  max {ncm_np.max():.0f}")
    print()

    res = {}
    corrs = {}
    for arm in ("const", "satur", "logscale"):
        if arm == "const":
            p = fit_const(sims, logp, has, target, tr)
        elif arm == "satur":
            p = fit_satur(sims, logp, has, ncm, target, tr)
        else:
            p = fit_logscale(sims, logp, has, ncm, target, tr)
        c = acc_of(sims, logp, has, ncm, target, va, p, arm)
        res[arm] = p
        corrs[arm] = c
        a_all = 100 * c[va].mean()
        a_thin = 100 * c[va][thin_va].mean() if thin_va.sum() else float("nan")
        a_rich = (100 * c[va][~thin_va].mean()
                  if (~thin_va).sum() else float("nan"))
        ps = "  ".join(f"{k}={v:.4f}" for k, v in p.items())
        print(f"  {arm:9s} ALL {a_all:6.2f}%  THIN {a_thin:6.2f}%  "
              f"RICH {a_rich:6.2f}%   {ps}")

    # what beta does the fitted curve actually give at various densities?
    print("\n  === fitted beta(n) ===")
    print(f"  {'n_cm':>7s}  {'const':>7s}  {'satur':>7s}  {'logscale':>8s}")
    for nv in (1, 5, 9, 25, 50, 100, 500, 2000, 10000):
        bs = res["satur"]["beta_inf"] * nv / (nv + res["satur"]["n0"])
        bl = float(F.softplus(torch.tensor(res["logscale"]["a"]
                                           + res["logscale"]["c"]
                                           * math.log1p(nv))))
        print(f"  {nv:7d}  {res['const']['beta']:7.4f}  {bs:7.4f}  {bl:8.4f}")

    print(f"\n  === paired bootstrap vs const, n={args.boot} ===")
    rng = np.random.RandomState(args.seed)
    base = corrs["const"][va]
    for arm in ("satur", "logscale"):
        d = corrs[arm][va].astype(float) - base.astype(float)
        for label, m in (("ALL", np.ones(len(va), bool)),
                         ("THIN", thin_va), ("RICH", ~thin_va)):
            if m.sum() == 0:
                continue
            dm = d[m]
            bs = np.array([dm[rng.randint(0, len(dm), len(dm))].mean()
                           for _ in range(args.boot)])
            lo, hi = np.percentile(bs, [2.5, 97.5])
            star = "*" if (lo > 0 or hi < 0) else " "
            print(f"    {arm:9s} {label:4s} {100*dm.mean():+6.2f}"
                  f"[{100*lo:+6.2f},{100*hi:+6.2f}]{star}")

    if args.out:
        json.dump({k: v for k, v in res.items()}, open(args.out, "w"), indent=2)
        print(f"\n  wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
