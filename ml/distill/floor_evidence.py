#!/usr/bin/env python3
"""Evidence for or against lowering --min-photos below 50 and retraining.

The floor=50 decision (2026-07-21) rests on one claim: a species with too few
photos becomes a CONFIDENT-WRONG class, and degrading it to genus/family via
BioCLIP-2 hierarchical embeddings is better. That claim was never measured. Two
measurements available today bear on it directly, using data already scored.

  A  DO TEXT-ONLY CLASSES CAUSE HARM? 3,612 of 11,167 species have zero
     training photos and exist only as text embeddings. If they steal rank-1
     from real birds far above their 32.3% share of the taxonomy, then
     "text-only is safe because it degrades gracefully" is false, and the fix
     is either training them or suppressing them -- both retrain-scale.

  B  WOULD A 20-49 PHOTO CLASS BE ANY GOOD? We cannot test 20-49 directly
     because no such class was trained. But we CAN read the accuracy-vs-count
     curve on classes that WERE trained, and see what happens at the weak end
     (50-99, the floor-adjacent band). If 50-99 classes already perform near
     the corpus average, a 20-49 class is plausibly useful. If they collapse,
     the floor is doing real work and lowering it adds noise.

Both are read off existing candidate parquets. No retraining, no GPU.
"""
import argparse
import json
import sys
from collections import Counter

import numpy as np
import pandas as pd

D = "/home/jlian/wingdex/ml/distill"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sets", required=True,
                    help="comma-separated name=path")
    ap.add_argument("--taxonomy",
                    default="/home/jlian/wingdex/src/lib/taxonomy.json")
    ap.add_argument("--train", default=f"{D}/train_manifest.parquet")
    args = ap.parse_args()

    tax = json.load(open(args.taxonomy))
    rows = tax if isinstance(tax, list) else tax.get("species", tax.get("rows"))
    N = len(rows)
    nm = {i: r[0] for i, r in enumerate(rows) if isinstance(r, list)}

    tm = pd.read_parquet(args.train, columns=["app_idx"])
    cnt = Counter(tm["app_idx"].tolist())
    tcount = np.array([cnt.get(i, 0) for i in range(N)])
    zero = tcount == 0
    print(f"  taxonomy {N:,} species")
    print(f"  photo-less (text-only): {int(zero.sum()):,} "
          f"({100*zero.mean():.1f}% of classes)")
    print(f"  trained: {int((~zero).sum()):,}   "
          f"median photos {int(np.median(tcount[~zero]))}")

    bands = [(1, 49, "1-49"), (50, 99, "50-99"), (100, 199, "100-199"),
             (200, 499, "200-499"), (500, 10**9, "500+")]

    for spec in args.sets.split(","):
        name, path = spec.split("=", 1)
        df = pd.read_parquet(path)
        if "true_app_idx" in df.columns:
            df = df.rename(columns={"true_app_idx": "true_idx"})
        n = len(df)
        idxs = np.stack([np.asarray(x) for x in df["cand_idx"]])
        sims = np.stack([np.asarray(x, dtype=np.float32)
                         for x in df["cand_sim"]])
        true = df["true_idx"].to_numpy()
        pred = idxs[np.arange(n), sims.argmax(1)]

        rank = np.full(n, -1, dtype=np.int32)
        for i in range(n):
            o = np.argsort(-sims[i])
            h = np.nonzero(idxs[i][o] == true[i])[0]
            if len(h):
                rank[i] = int(h[0])
        present = rank >= 0
        ok = pred == true

        print(f"\n  ================= {name}  (n={n:,}) =================")

        # --- A: do text-only classes steal rank-1? ---
        wrong = ~ok
        stolen_by_zero = int(zero[pred[wrong]].sum())
        tot_wrong = int(wrong.sum())
        print(f"  A. text-only classes stealing rank-1 (vision only)")
        print(f"     wrong predictions      : {tot_wrong:,}")
        print(f"     of those, predicted a photo-less species: "
              f"{stolen_by_zero:,} ({100*stolen_by_zero/max(tot_wrong,1):.1f}%)")
        print(f"     expected if proportional: {100*zero.mean():.1f}%")
        ratio = (stolen_by_zero / max(tot_wrong, 1)) / max(zero.mean(), 1e-9)
        print(f"     over-representation    : {ratio:.2f}x")
        # how many candidate SLOTS do they occupy?
        slot_zero = zero[idxs].mean()
        print(f"     share of top-25 slots  : {100*slot_zero:.1f}%")
        # ceiling if we simply removed them from the shortlist
        rescued = 0
        for i in np.nonzero(wrong & present)[0]:
            o = np.argsort(-sims[i])
            cand = idxs[i][o]
            keep = cand[~zero[cand]]
            if len(keep) and keep[0] == true[i]:
                rescued += 1
        print(f"     photos rescued by suppressing them: {rescued:,} "
              f"(+{100*rescued/n:.2f} pts)")

        # true labels that are photo-less: can the eval even see the benefit?
        tz = int(zero[true].sum())
        print(f"     eval photos whose TRUE species is photo-less: {tz:,}")

        # --- B: accuracy vs training-photo count ---
        print(f"  B. performance by the true species' training-photo count")
        print(f"     {'band':>9s} {'photos':>8s} {'top1':>7s} {'top25':>7s}")
        for lo, hi, lbl in bands:
            m = (tcount[true] >= lo) & (tcount[true] <= hi)
            c = int(m.sum())
            if c == 0:
                continue
            print(f"     {lbl:>9s} {c:8,} {100*ok[m].mean():6.2f}% "
                  f"{100*present[m].mean():6.2f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
