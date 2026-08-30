#!/usr/bin/env python3
"""Which confusions SURVIVE the occurrence prior? That is the actionable list.

Vision-only rank-1 is 61-72% and its worst confusions are geographically absurd:
Barau's Petrel (Indian Ocean) and Knobbed Hornbill (Sulawesi) winning rank-1 on
American photos. The occurrence prior exists to kill exactly those, and it does.

So the vision-only attractor list is NOT the fix list; it is mostly noise the
prior already handles. The species worth acting on are the ones that still win
AFTER the prior, because those are morphological confusions between birds that
genuinely co-occur -- which is what #355 turned out to be.

Reuses adaptive_sweep.build() rather than reimplementing the prior, so this
scores through the same code path as every other benchmark.
"""
import argparse, json, sys
from collections import Counter
import numpy as np, pandas as pd, torch

sys.path.insert(0, "/home/jlian/wingdex/ml/distill")
from occ4 import Occ
import math
from adaptive_sweep import build

FLOOR = math.log(3e-5)   # build() returns LOG priors; clamp in log space


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--occ", default="/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz")
    ap.add_argument("--taxonomy", default="/home/jlian/wingdex/src/lib/taxonomy.json")
    ap.add_argument("--T", type=float, default=0.010359)
    ap.add_argument("--beta", type=float, default=1.3133)
    ap.add_argument("--k", type=float, default=0.3)
    ap.add_argument("--top", type=int, default=25)
    args = ap.parse_args()

    tax = json.load(open(args.taxonomy))
    rows = tax if isinstance(tax, list) else tax.get("species", tax.get("rows"))
    nm = {i: (r[0], r[2]) for i, r in enumerate(rows)
          if isinstance(r, list) and len(r) >= 3}

    df = pd.read_parquet(args.candidates)
    if "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx": "true_idx"})
    n = len(df)
    idxs = np.stack([np.asarray(x) for x in df["cand_idx"]])
    sims = np.stack([np.asarray(x, dtype=np.float64) for x in df["cand_sim"]])
    true = df["true_idx"].to_numpy()
    lat = df["latitude"].values; lon = df["longitude"].values
    month = df["month"].values

    occ = Occ(args.occ)
    rl, has, _ = build(occ, lat, lon, month, idxs, args.k, "month1", 0)
    lp = np.maximum(rl, FLOOR)

    pred_v = idxs[np.arange(n), sims.argmax(1)]
    logits = sims / args.T
    logits[has] += args.beta * lp[has]
    pred_p = idxs[np.arange(n), logits.argmax(1)]

    ok_v = pred_v == true
    ok_p = pred_p == true
    print(f"  {n:,} photos")
    print(f"  vision-only rank-1 : {100*ok_v.mean():.2f}%")
    print(f"  after prior        : {100*ok_p.mean():.2f}%")
    print(f"  fixed by the prior : {int((~ok_v & ok_p).sum()):,}")
    print(f"  BROKEN by the prior: {int((ok_v & ~ok_p).sum()):,}")

    surv = Counter()
    for i in range(n):
        if not ok_p[i]:
            surv[(int(true[i]), int(pred_p[i]))] += 1
    print(f"\n  === confusions that SURVIVE the prior (top {args.top}) ===")
    print("  these co-occur locally, so the prior cannot separate them")
    for (t, p), c in surv.most_common(args.top):
        tn, _ = nm.get(t, ("?", "?")); pn, _ = nm.get(p, ("?", "?"))
        print(f"  {c:5d}  {tn[:34]:<34s} -> {pn}")

    # Same-genus share: decides whether hard negatives should be genus-scoped.
    same = tot = 0
    sci = {i: r[1] for i, r in enumerate(rows) if isinstance(r, list) and len(r) > 1}
    for (t, p), c in surv.items():
        gt = sci.get(t, "").split(" ")[0]; gp = sci.get(p, "").split(" ")[0]
        tot += c
        if gt and gt == gp:
            same += c
    print(f"\n  same-genus share of surviving errors: {100*same/max(tot,1):.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
