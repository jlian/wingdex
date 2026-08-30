#!/usr/bin/env python3
"""Fit on 70% of the groundtruth draw, evaluate on the held-out 30% + thin set.

John's design, and it is the right one: fit on a LARGE corpus that still has
full density range (unlike the thin set, max n_cm=24) and more photos than
calib-11k (11,070). Then check generalisation on data the fit never saw.

The thin set was excluded from this draw at sampling time, so both evaluation
sets are genuinely out of sample.
"""
import argparse, math, sys, json
import numpy as np, pandas as pd, torch, torch.nn.functional as F
sys.path.insert(0, "/home/jlian/wingdex/ml/distill")
from cross_fit import prep, _fit, evaluate
from occ4 import Occ

ap = argparse.ArgumentParser()
ap.add_argument("--fit-on", default="/home/jlian/calib_gt_a060.parquet")
ap.add_argument("--eval-on", default="")
ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
ap.add_argument("--k", type=float, default=0.3)
ap.add_argument("--thin", type=int, default=10)
ap.add_argument("--boot", type=int, default=2000)
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()

occ = Occ(a.occ)
d = prep(a.fit_on, occ, a.k)
n = d["n"]
nc = d["ncm_np"]
print(f"  corpus {a.fit_on}")
print(f"    n={n:,}  n_cm median {np.median(nc):.0f}  p90 {np.percentile(nc,90):.0f}  max {nc.max():.0f}")

g = torch.Generator().manual_seed(a.seed)
perm = torch.randperm(n, generator=g)
cut = int(n*0.7)
tr, va = perm[:cut], perm[cut:].numpy()
print(f"    fit={cut:,}  heldout30={len(va):,}")

fits = {}
for arm in ("const","satur","logscale"):
    fits[arm] = _fit(d, arm, tr)
    ps = "  ".join(f"{k}={v:.4f}" for k,v in fits[arm].items())
    print(f"    {arm:9s} {ps}")

print("\n  === fitted beta(n) ===")
print(f"  {'n_cm':>7s} {'const':>8s} {'logscale':>9s}")
for nv in (1,5,9,25,100,1000,10000):
    bl = float(F.softplus(torch.tensor(fits["logscale"]["a"] + fits["logscale"]["c"]*math.log1p(nv))))
    print(f"  {nv:7d} {fits['const']['beta']:8.4f} {bl:9.4f}")

rng = np.random.RandomState(a.seed)
def report(name, dd, mask=None):
    thin = dd["ncm_np"] < a.thin
    if mask is None: mask = np.ones(dd["n"], bool)
    print(f"\n  === EVAL {name} (n={int(mask.sum()):,}, thin={int((thin&mask).sum()):,}) ===")
    cs = {arm: evaluate(dd, arm, fits[arm]) for arm in fits}
    for arm in ("const","satur","logscale"):
        c = cs[arm][mask]; t = thin[mask]
        at = 100*c[t].mean() if t.sum() else float("nan")
        ar = 100*c[~t].mean() if (~t).sum() else float("nan")
        print(f"    {arm:9s} ALL {100*c.mean():6.2f}%  THIN {at:6.2f}%  RICH {ar:6.2f}%")
    base = cs["const"][mask].astype(float)
    for arm in ("satur","logscale"):
        dv = cs[arm][mask].astype(float) - base
        t = thin[mask]
        for lb, m in (("ALL", np.ones(len(dv),bool)), ("THIN", t), ("RICH", ~t)):
            if m.sum()==0: continue
            dm = dv[m]
            bs = np.array([dm[rng.randint(0,len(dm),len(dm))].mean() for _ in range(a.boot)])
            lo,hi = np.percentile(bs,[2.5,97.5])
            star = "*" if (lo>0 or hi<0) else " "
            print(f"      {arm:9s} {lb:4s} {100*dm.mean():+6.2f}[{100*lo:+6.2f},{100*hi:+6.2f}]{star}")

m = np.zeros(n, bool); m[va] = True
report("heldout 30%", d, m)
for spec in [s for s in a.eval_on.split(",") if s]:
    nm, path = spec.split("=",1)
    report(nm, prep(path, occ, a.k))
