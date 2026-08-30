#!/usr/bin/env python3
"""Is Blacksmith Thrush a confusion ATTRACTOR, or was #355 one unlucky photo?

The vision tower preferred Turdus subalaris (SE Brazil) over Catharus mexicanus
on a Guatemala photo. Two very different bugs could produce that:

  A  ONE-OFF: these two birds simply look alike and this photo was hard.
     Nothing systematic to fix; the answer is better fine-tuning generally.

  B  ATTRACTOR: slathr3's embedding sits somewhere that pulls in lots of
     unrelated photos, so it is a false top-1 far more often than its true
     frequency justifies. That is a specific, fixable defect -- usually bad or
     too-few training photos for that class, or a degenerate text embedding.

Distinguishing them decides whether #355 is "improve the model" (vague, slow)
or "fix this species" (narrow, testable).

Metric: for each species, false_top1 = times predicted rank-1 while wrong,
against support = times it is the true label. A ratio >> 1 means the class
attracts photos that are not it.
"""
import argparse
import json
import sys
from collections import Counter

import numpy as np
import pandas as pd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--taxonomy", default="/home/jlian/wingdex/src/lib/taxonomy.json")
    ap.add_argument("--train-manifest",
                    default="/home/jlian/wingdex/ml/distill/train_manifest.parquet")
    ap.add_argument("--focus", default="slathr3,bhnthr1,whtrob1",
                    help="eBird codes to report in detail")
    ap.add_argument("--top", type=int, default=20)
    args = ap.parse_args()

    tax = json.load(open(args.taxonomy))
    rows = tax if isinstance(tax, list) else tax.get("species", tax.get("rows"))
    name = {}      # app_idx -> (common, sci, code)
    code_to_idx = {}
    for i, r in enumerate(rows):
        if isinstance(r, list) and len(r) >= 3:
            name[i] = (r[0], r[1], r[2])
            code_to_idx[r[2]] = i

    df = pd.read_parquet(args.candidates)
    if "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx": "true_idx"})
    n = len(df)

    pred = np.empty(n, dtype=np.int64)
    for i, (ci, cs) in enumerate(zip(df["cand_idx"], df["cand_sim"])):
        ci = np.asarray(ci); cs = np.asarray(cs)
        pred[i] = int(ci[int(np.argmax(cs))])
    true = df["true_idx"].to_numpy()

    correct = pred == true
    print(f"  {n:,} photos, vision-only rank-1 = {100*correct.mean():.2f}%")

    support = Counter(true.tolist())
    false_top1 = Counter(pred[~correct].tolist())
    true_top1 = Counter(pred[correct].tolist())

    # Training photo counts, the usual root cause of an attractor.
    tcount = {}
    try:
        tm = pd.read_parquet(args.train_manifest, columns=["app_idx"])
        tcount = Counter(tm["app_idx"].tolist())
    except Exception as e:
        print(f"  (no train counts: {e})")

    print(f"\n  === top {args.top} confusion ATTRACTORS ===")
    print("  species that win rank-1 while being the WRONG answer, "
          "relative to their own support")
    print(f"  {'code':10s} {'false':>6s} {'supp':>6s} {'ratio':>7s} "
          f"{'train':>7s}  name")
    scored = []
    for idx, f in false_top1.items():
        s = support.get(idx, 0)
        ratio = f / max(s, 1)
        scored.append((f, ratio, idx, s))
    scored.sort(key=lambda t: -t[0])
    for f, ratio, idx, s in scored[:args.top]:
        c, sci, code = name.get(idx, ("?", "?", "?"))
        tc = tcount.get(idx, 0)
        print(f"  {code:10s} {f:6d} {s:6d} {ratio:7.2f} {tc:7d}  {c}")

    print(f"\n  === focus species ===")
    for code in args.focus.split(","):
        idx = code_to_idx.get(code)
        if idx is None:
            print(f"  {code}: not in taxonomy")
            continue
        c, sci, _ = name[idx]
        s = support.get(idx, 0)
        f = false_top1.get(idx, 0)
        t = true_top1.get(idx, 0)
        tc = tcount.get(idx, 0)
        print(f"  {code:10s} {c} ({sci})")
        print(f"      true label on      : {s:6d} photos")
        print(f"      correctly rank-1   : {t:6d}"
              + (f"   ({100*t/s:.1f}% recall)" if s else ""))
        print(f"      FALSE rank-1 on    : {f:6d} photos"
              + (f"   ratio {f/max(s,1):.2f}" if True else ""))
        print(f"      training photos    : {tc:6d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
