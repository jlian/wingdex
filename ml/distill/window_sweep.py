#!/usr/bin/env python3
"""Variant sweep for issue #355: does widening the temporal window help?

Reuses sweep_floor_k.py's harness EXACTLY (same parquet, same split, same seed,
same LBFGS fit, same metrics) so the arms are comparable to the shipped number.
The only thing that changes is how logP is built.

ARMS
  month1     the shipped path: monthly slice, Dirichlet backoff toward pooled
  month3     the same, but n_scm and n_cm are summed over month-1, month, month+1
  pooled     month-agnostic P(s|c); "no temporal adjustment"
  fallback   month1, except when NO candidate has a monthly count, use pooled

T and beta are refit for every arm, because both change the scale of logP and
the shipped comment is explicit that the constants are not independently
adjustable.
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

NEG_INF = -np.inf


def cell_of(lat, lon):
    try:
        x, y = lonlat_to_ee(float(lon), float(lat))
        return xy_to_cell(x, y)
    except Exception:
        return None


def build_logp(occ, lat, lon, month, idxs, k, arm):
    """(n,K) raw logP with -inf for absent, plus a per-row has-prior mask."""
    n, K = idxs.shape
    out = np.full((n, K), NEG_INF, dtype=np.float64)
    has = np.zeros(n, dtype=bool)
    stats = {"fallback_rows": 0, "window_rows": 0}
    cache = {}

    for i in range(n):
        rc = cell_of(lat[i], lon[i])
        if rc is None:
            continue
        m = int(month[i])
        key = (rc[0], rc[1], m, arm)
        ent = cache.get(key)
        if ent is None:
            pri = occ.cell_priors(rc[0], rc[1], m)
            pooled = occ.cell_pooled(rc[0], rc[1]) if occ.version >= 4 else None
            ncm = occ.total(rc[0], rc[1], m) if occ.version >= 4 else None

            if arm == "month3":
                # Sum n_scm and n_cm over a centred 3-month window, wrapping
                # the year. Keeps seasonality, triples the denominator.
                agg = {}
                tot = 0
                any_slice = False
                for dm in (-1, 0, 1):
                    mm = ((m - 1 + dm) % 12) + 1
                    p2 = occ.cell_priors(rc[0], rc[1], mm)
                    if p2 is None:
                        continue
                    any_slice = True
                    n2 = occ.total(rc[0], rc[1], mm) or 0
                    tot += n2
                    for ix, lp in p2.items():
                        agg[ix] = agg.get(ix, 0.0) + math.exp(lp) * n2
                ent = (agg if any_slice else None, pooled, tot, "counts")
            elif arm == "pooled":
                ent = (pooled, None, None, "logp")
            else:
                ent = (pri, pooled, ncm, "logp")
            if len(cache) < 30000:
                cache[key] = ent

        pri, pooled, ncm, kind = ent
        if pri is None:
            continue
        has[i] = True
        row = idxs[i]

        if arm == "pooled":
            for j in range(K):
                lp = pri.get(int(row[j]))
                out[i, j] = NEG_INF if lp is None else lp
            continue

        if arm == "month3":
            stats["window_rows"] += 1
            den = (ncm or 0) + k
            for j in range(K):
                ix = int(row[j])
                nscm = pri.get(ix, 0.0)
                pp = pooled.get(ix) if pooled else None
                ppv = 0.0 if pp is None else math.exp(pp)
                num = nscm + k * ppv
                out[i, j] = math.log(num / den) if num > 0 and den > 0 else NEG_INF
            continue

        # month1 and fallback share the shipped path
        use_pooled_only = False
        if arm == "fallback":
            # No candidate carries a monthly count: the monthly slice tells us
            # nothing about THIS shortlist, so the pooled slice is strictly
            # more informative.
            if not any(pri.get(int(row[j])) is not None for j in range(K)):
                use_pooled_only = True
                stats["fallback_rows"] += 1

        if use_pooled_only and pooled is not None:
            for j in range(K):
                lp = pooled.get(int(row[j]))
                out[i, j] = NEG_INF if lp is None else lp
            continue

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
    return out, has, stats


def fit(sims, logp, has, target, tr, T0=0.0076, b0=0.56):
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
    return float(logT.exp()), float(logb.exp())


def ece(conf, corr, bins=15):
    if len(conf) == 0:
        return float("nan")
    edges = np.linspace(0.0, 1.0, bins + 1)
    tot = 0.0
    n = len(conf)
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        m = (conf >= lo) & (conf <= hi) if i == 0 else (conf > lo) & (conf <= hi)
        c = int(m.sum())
        if c:
            tot += (c / n) * abs(conf[m].mean() - corr[m].mean())
    return tot


def softmax_rows(x):
    m = x.max(axis=1, keepdims=True)
    e = np.exp(x - m)
    return e / e.sum(axis=1, keepdims=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="calib_cands_tiny39_a060.parquet")
    ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--floor", type=float, default=3e-5)
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--arms", default="month1,month3,pooled,fallback")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--out", default="/home/jlian/window_sweep.json")
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

    # IDENTICAL split to sweep_floor_k.py: same seed, same 70/30 cut.
    torch.manual_seed(0)
    perm = torch.randperm(n)
    cut = int(n * 0.7)
    tr = perm[:cut]
    va = perm[cut:].numpy()
    print(f"  N={n}  fit={cut}  val={len(va)}")

    occ = Occ(args.occ)
    print(f"  blob v{occ.version}  cells={occ.n_cells}")
    print(f"  floor={args.floor}  k={args.k}")
    lat, lon, month = df["latitude"].values, df["longitude"].values, df["month"].values

    rows = []
    print()
    print("  arm         T          beta      top1      d(top1)   meanconf  ECE     absent%")
    base_correct = None
    for arm in args.arms.split(","):
        rl, has, st = build_logp(occ, lat, lon, month, idxs, args.k, arm)
        absent = float(np.isinf(rl[has]).mean()) if has.any() else float("nan")
        lp = np.maximum(rl, FLOOR)
        lpt = torch.tensor(lp, dtype=torch.float32)
        T, b = fit(sims, lpt, torch.tensor(has), target, tr)

        hm = has[:, None].astype(np.float64)
        logits = sims_np / T + b * lp * hm
        lv = logits[va]
        p = softmax_rows(lv)
        am, conf = p.argmax(axis=1), p.max(axis=1)
        tv = pos[va]
        correct = ((am == tv) & (tv >= 0)).astype(np.float64)
        top1 = float(correct.mean())
        if base_correct is None:
            base_correct = correct
            d = 0.0
        else:
            d = top1 - float(base_correct.mean())
        rows.append(dict(arm=arm, T=T, beta=b, top1=top1, delta=d,
                         meanconf=float(conf.mean()), ece=ece(conf, correct),
                         absent_frac=absent, correct=correct.tolist(), **st))
        print(f"  {arm:<11} {T:<10.6f} {b:<9.4f} {100*top1:6.2f}%   "
              f"{100*d:+6.2f}    {100*conf.mean():5.1f}%   {ece(conf,correct):.4f}  {100*absent:5.1f}%")
        sys.stdout.flush()

    # Paired bootstrap against month1, because the arms share a validation set.
    print()
    print("  paired bootstrap vs month1 (n=%d):" % args.boot)
    rng = np.random.RandomState(0)
    base = np.array(rows[0]["correct"])
    N = len(base)
    for r in rows[1:]:
        arm = np.array(r["correct"])
        diffs = np.empty(args.boot)
        for bi in range(args.boot):
            s = rng.randint(0, N, N)
            diffs[bi] = arm[s].mean() - base[s].mean()
        lo, hi = np.percentile(diffs, [2.5, 97.5])
        sig = "SIGNIFICANT" if (lo > 0 or hi < 0) else "not significant"
        r["ci95"] = [float(lo), float(hi)]
        print(f"    {r['arm']:<11} {100*r['delta']:+6.2f} pts   "
              f"95% CI [{100*lo:+.2f}, {100*hi:+.2f}]   {sig}")

    for r in rows:
        r.pop("correct", None)
    json.dump(dict(floor=args.floor, k=args.k, arms=rows),
              open(args.out, "w"), indent=1)
    print(f"\n  wrote {args.out}")


if __name__ == "__main__":
    main()
