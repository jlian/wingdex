#!/usr/bin/env python3
"""Do text-only (zero-training-photo) classes actually work?

This is the measurement the floor=50 decision was never tested against. The
2026-07-21 rationale was that sub-floor species "degrade to genus/family via
BioCLIP-2 hierarchical embeddings", i.e. graceful abstention rather than
confident-wrong. But 3,614 photos in the groundtruth draw belong to species
with ZERO training photos, so we can just measure what happens to them.

If text-only classes score near zero, they are dead weight: the floor is
validated, but those 3,612 species are also useless in the app, which is an
argument FOR retraining with a lower floor.
If they score meaningfully, text embeddings transfer and the floor is costing
us working classes.
"""
import json, sys
from collections import Counter
import numpy as np, pandas as pd

D = "/home/jlian/wingdex/ml/distill"
tax = json.load(open("/home/jlian/wingdex/src/lib/taxonomy.json"))
rows = tax if isinstance(tax, list) else tax.get("species", tax.get("rows"))
N = len(rows)
sci = {i: (r[1] if len(r) > 1 else "") for i, r in enumerate(rows) if isinstance(r, list)}
nm = {i: r[0] for i, r in enumerate(rows) if isinstance(r, list)}

tm = pd.read_parquet(f"{D}/train_manifest.parquet", columns=["app_idx"])
cnt = Counter(tm["app_idx"].tolist())
tcount = np.array([cnt.get(i, 0) for i in range(N)])
zero = tcount == 0

print("  training-photo histogram over TRAINED species:")
tr = tcount[~zero]
for lo, hi in ((1,49),(50,99),(100,199),(200,299),(300,399),(400,499),(500,10**9)):
    c = int(((tr>=lo)&(tr<=hi)).sum())
    print(f"    {lo:5d}-{hi if hi<10**9 else 0:<5d} {c:5,} species")

for name, path in (("gt", "/home/jlian/calib_gt_a060.parquet"),
                   ("thin", "/home/jlian/calib_thin_full_a060.parquet")):
    df = pd.read_parquet(path)
    if "true_app_idx" in df.columns:
        df = df.rename(columns={"true_app_idx":"true_idx"})
    n = len(df)
    idxs = np.stack([np.asarray(x) for x in df["cand_idx"]])
    sims = np.stack([np.asarray(x, dtype=np.float32) for x in df["cand_sim"]])
    true = df["true_idx"].to_numpy()
    pred = idxs[np.arange(n), sims.argmax(1)]
    ok = pred == true
    inK = np.array([bool((idxs[i]==true[i]).any()) for i in range(n)])

    tz = zero[true]
    print(f"\n  === {name} (n={n:,}) ===")
    print(f"    photos whose TRUE species is text-only: {int(tz.sum()):,}")
    if tz.sum():
        print(f"      top-1  on those: {100*ok[tz].mean():6.2f}%")
        print(f"      top-25 on those: {100*inK[tz].mean():6.2f}%")
    print(f"    photos whose TRUE species was TRAINED : {int((~tz).sum()):,}")
    print(f"      top-1  : {100*ok[~tz].mean():6.2f}%")
    print(f"      top-25 : {100*inK[~tz].mean():6.2f}%")

    # genus-level credit: does it at least land in the right genus?
    g_true = np.array([sci.get(int(t),"").split(" ")[0] for t in true])
    g_pred = np.array([sci.get(int(p),"").split(" ")[0] for p in pred])
    gok = (g_true == g_pred) & (g_true != "")
    if tz.sum():
        print(f"      GENUS correct on text-only: {100*gok[tz].mean():6.2f}%"
              f"   (vs {100*gok[~tz].mean():.2f}% on trained)")
        print(f"      -> the 'degrades to genus' claim is "
              f"{'SUPPORTED' if gok[tz].mean()>0.5 else 'NOT supported'}")
