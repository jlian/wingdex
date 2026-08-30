#!/usr/bin/env python3
"""Benchmark the BirdLife range prior on the calibration split.

Same harness as sweep_floor_k.py / adaptive_sweep.py: same parquet, same seed,
same 70/30 split, same LBFGS fit, T and beta refit per arm.

The range data is a SEPARATE signal from the occurrence prior. It answers
"could this bird be here at all" rather than "how often is it recorded here",
so it is applied as an extra multiplicative trust term, exactly as
functions/lib/range-adjust.js already does for the web reverse path:

    score = sim/T + beta*logP_occ + gamma*log(trust_range)

ARMS
  occ_only    the shipped path (baseline)
  range_only  drop the occurrence prior, use range trust alone
  occ_range   both, with gamma fitted alongside T and beta
  occ_range_ring  same, but a species counts as present if it is in the
                  3x3 cell ring, which matters at range edges and coasts
"""
import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F

from ee_port import lonlat_to_ee, xy_to_cell
from occ4 import Occ

CELLS = Path("/home/jlian/wingdex/.tmp/range-priors/cells")
NEG_INF = -np.inf

# Mirrors range-adjust.js exactly.
NEAR_RANGE_TRUST = 0.85
OUT_OF_RANGE_TRUST = 0.65
NH_BREEDING = {4, 5, 6, 7, 8}
NH_NONBREEDING = {10, 11, 12, 1, 2}
NH_PASSAGE = {3, 4, 9, 10}


def presence_trust(p):
    return {1: 1.0, 3: 0.95, 6: 0.9, 4: 0.8}.get(p, 0.9)


def origin_trust(mask):
    if mask & 0b100111:
        return 1.0
    if mask & 0b010000:
        return 0.95
    if mask & 0b001000:
        return 0.85
    return 1.0


def seasonal_trust(mask, month, lat):
    if mask & (1 | 16):
        return 1.0
    if (mask & 2) and (mask & 4):
        return 1.0
    southern = (lat or 0) < 0
    breeding = NH_NONBREEDING if southern else NH_BREEDING
    nonbreeding = NH_BREEDING if southern else NH_NONBREEDING
    if (mask & 2) and month in breeding:
        return 1.0
    if (mask & 4) and month in nonbreeding:
        return 1.0
    if (mask & 8) and month in NH_PASSAGE:
        return 1.0
    return 0.9


_cellcache = {}


def read_cell(row, col):
    key = (row, col)
    if key in _cellcache:
        return _cellcache[key]
    p = CELLS / f"{row}-{col}.bin.gz"
    out = None
    if p.exists():
        d = gzip.open(p, "rb").read()
        out = {}
        for off in range(0, len(d) - 10, 11):
            code = d[off:off + 8].decode("ascii", "replace").rstrip()
            out[code] = (d[off + 8], d[off + 9], d[off + 10])
    if len(_cellcache) < 60000:
        _cellcache[key] = out
    return out


def build_range(lat, lon, month, idxs, codes, ring):
    """(n,K) log(trust) from BirdLife ranges, and a has-data mask."""
    n, K = idxs.shape
    out = np.zeros((n, K), dtype=np.float64)
    has = np.zeros(n, dtype=bool)
    for i in range(n):
        try:
            x, y = lonlat_to_ee(float(lon[i]), float(lat[i]))
            rc = xy_to_cell(x, y)
        except Exception:
            rc = None
        if rc is None:
            continue
        cell = read_cell(rc[0], rc[1])
        if cell is None:
            continue
        has[i] = True
        near = None
        if ring:
            near = {}
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    c2 = read_cell(rc[0] + dr, rc[1] + dc)
                    if c2:
                        for k, v in c2.items():
                            near.setdefault(k, v)
        m = int(month[i])
        for j in range(K):
            code = codes[int(idxs[i, j])]
            e = cell.get(code)
            if e is not None:
                trust = (presence_trust(e[0]) * origin_trust(e[1])
                         * seasonal_trust(e[2], m, lat[i]))
            elif near is not None and code in near:
                e2 = near[code]
                trust = (NEAR_RANGE_TRUST * presence_trust(e2[0])
                         * origin_trust(e2[1]) * seasonal_trust(e2[2], m, lat[i]))
            else:
                trust = OUT_OF_RANGE_TRUST
            out[i, j] = math.log(trust)
    return out, has


def build_occ(occ, lat, lon, month, idxs, k, floor):
    n, K = idxs.shape
    out = np.full((n, K), NEG_INF, dtype=np.float64)
    has = np.zeros(n, dtype=bool)
    cache = {}
    for i in range(n):
        try:
            x, y = lonlat_to_ee(float(lon[i]), float(lat[i]))
            rc = xy_to_cell(x, y)
        except Exception:
            rc = None
        if rc is None:
            continue
        m = int(month[i])
        ck = (rc[0], rc[1], m)
        ent = cache.get(ck)
        if ent is None:
            ent = (occ.cell_priors(rc[0], rc[1], m),
                   occ.cell_pooled(rc[0], rc[1]),
                   occ.total(rc[0], rc[1], m))
            if len(cache) < 40000:
                cache[ck] = ent
        pri, pooled, ncm = ent
        if pri is None:
            continue
        has[i] = True
        ub = pooled is not None and ncm is not None and k > 0
        for j in range(K):
            ix = int(idxs[i, j])
            lp = pri.get(ix)
            if ub:
                nscm = 0.0 if lp is None else math.exp(lp) * ncm
                pp = pooled.get(ix)
                ppv = 0.0 if pp is None else math.exp(pp)
                num = nscm + k * ppv
                out[i, j] = math.log(num / (ncm + k)) if num > 0 else NEG_INF
            else:
                out[i, j] = NEG_INF if lp is None else lp
    return np.maximum(out, math.log(floor)), has


def fit3(sims, occ_lp, occ_has, rng_lp, rng_has, target, tr, use_occ, use_rng):
    logT = torch.tensor(math.log(0.0076), requires_grad=True)
    params = [logT]
    logb = torch.tensor(math.log(0.56), requires_grad=True)
    logg = torch.tensor(math.log(1.0), requires_grad=True)
    if use_occ:
        params.append(logb)
    if use_rng:
        params.append(logg)
    om = occ_has.unsqueeze(1).float()
    rm = rng_has.unsqueeze(1).float()
    opt = torch.optim.LBFGS(params, lr=0.05, max_iter=300, tolerance_grad=1e-10)

    def closure():
        opt.zero_grad()
        lg = sims[tr] / logT.exp()
        if use_occ:
            lg = lg + logb.exp() * occ_lp[tr] * om[tr]
        if use_rng:
            lg = lg + logg.exp() * rng_lp[tr] * rm[tr]
        t = target[tr]
        v = t >= 0
        loss = F.cross_entropy(lg[v], t[v])
        loss.backward()
        return loss

    opt.step(closure)
    return (float(logT.exp()),
            float(logb.exp()) if use_occ else 0.0,
            float(logg.exp()) if use_rng else 0.0)


def softmax_rows(x):
    m = x.max(axis=1, keepdims=True)
    e = np.exp(x - m)
    return e / e.sum(axis=1, keepdims=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="calib_cands_tiny39_a060.parquet")
    ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--taxonomy", default="/home/jlian/wingdex/src/lib/taxonomy.json")
    ap.add_argument("--floor", type=float, default=3e-5)
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--thin", type=int, default=25)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--out", default="/home/jlian/range_bench.json")
    args = ap.parse_args()

    tax = json.load(open(args.taxonomy))
    codes = [r[2] if len(r) > 2 else "" for r in tax]

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

    print(f"  N={n}  fit={cut}  val={len(va)}  THIN={thin_va.sum()}")
    olp, ohas = build_occ(occ, lat, lon, month, idxs, args.k, args.floor)
    print(f"  occurrence: {ohas.sum():,} rows with a monthly slice")
    sys.stdout.flush()

    print("  reading BirdLife range cells (this is the slow part)...")
    rlp, rhas = build_range(lat, lon, month, idxs, codes, ring=False)
    print(f"  range: {rhas.sum():,} rows with range data "
          f"({100*rhas.mean():.1f}%)")
    in_range = (rlp > math.log(OUT_OF_RANGE_TRUST) + 1e-9)
    print(f"  mean candidates in range, of 25: {in_range[rhas].sum(axis=1).mean():.2f}")
    sys.stdout.flush()

    print("  reading the 3x3 ring variant...")
    rlp_ring, rhas_ring = build_range(lat, lon, month, idxs, codes, ring=True)
    inr = (rlp_ring > math.log(OUT_OF_RANGE_TRUST) + 1e-9)
    print(f"  with ring, mean in range: {inr[rhas_ring].sum(axis=1).mean():.2f}")
    sys.stdout.flush()

    olpt = torch.tensor(olp, dtype=torch.float32)
    ohast = torch.tensor(ohas)
    arms = [
        ("occ_only", olp, ohas, np.zeros_like(rlp), np.zeros(n, bool), True, False),
        ("range_only", np.zeros_like(olp), np.zeros(n, bool), rlp, rhas, False, True),
        ("occ_range", olp, ohas, rlp, rhas, True, True),
        ("occ_range_ring", olp, ohas, rlp_ring, rhas_ring, True, True),
    ]

    print()
    print("  arm              T          beta     gamma    ALL       THIN      RICH")
    print("  " + "-" * 74)
    results = {}
    for name, ol, oh, rl, rh, uo, ur in arms:
        T, b, g = fit3(sims, torch.tensor(ol, dtype=torch.float32), torch.tensor(oh),
                       torch.tensor(rl, dtype=torch.float32), torch.tensor(rh),
                       target, tr, uo, ur)
        logits = sims_np / T
        if uo:
            logits = logits + b * ol * oh[:, None]
        if ur:
            logits = logits + g * rl * rh[:, None]
        p = softmax_rows(logits[va])
        am, tv = p.argmax(axis=1), pos[va]
        correct = ((am == tv) & (tv >= 0)).astype(np.float64)
        results[name] = dict(T=T, beta=b, gamma=g, all=float(correct.mean()),
                             thin=float(correct[thin_va].mean()),
                             rich=float(correct[~thin_va].mean()), correct=correct)
        print(f"  {name:<16} {T:<10.6f} {b:<8.4f} {g:<8.4f} "
              f"{100*correct.mean():6.2f}%  {100*correct[thin_va].mean():6.2f}%  "
              f"{100*correct[~thin_va].mean():6.2f}%")
        sys.stdout.flush()

    base = results["occ_only"]
    print()
    print(f"  deltas vs occ_only, paired bootstrap n={args.boot}  (* = CI excludes 0)")
    print("  " + "-" * 74)
    rngen = np.random.RandomState(0)
    for name, r in results.items():
        if name == "occ_only":
            continue
        line = f"  {name:<16}"
        for label, mask in (("ALL", np.ones(len(va), bool)),
                            ("THIN", thin_va), ("RICH", ~thin_va)):
            bc, ac = base["correct"][mask], r["correct"][mask]
            d = ac.mean() - bc.mean()
            N = len(bc)
            diffs = np.empty(args.boot)
            for bi in range(args.boot):
                s = rngen.randint(0, N, N)
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
