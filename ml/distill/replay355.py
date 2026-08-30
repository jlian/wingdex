#!/usr/bin/env python3
"""Replay the #355 Guatemala photo through every arm. CORRECTED.

An earlier version of this script treated occ4's values as COUNTS and applied
add-k smoothing to them. They are already LOG-PROBABILITIES (occ4._decode
returns -(q/OCC_SCALE)). Everything below uses them as such.

Ground truth: Black-headed Nightingale-Thrush, Catharus mexicanus (bhnthr1).
Photo: 15.2158 N, 90.2196 W, August, Baja Verapaz, Guatemala.
App showed: Blacksmith 28, White-throated 12, Black-headed 11, Dagua 6, Austral 6.
"""
import json, math, sys
import numpy as np
sys.path.insert(0, "/home/jlian/wingdex/ml/distill")
from occ4 import Occ
from adaptive_sweep import cell_of

OCC = "/home/jlian/v4build/occ_v4.4f5c1a15.bin.gz"
TAX = "/home/jlian/wingdex/src/lib/taxonomy.json"
LAT, LON, MONTH = 15.2158, -90.2196, 8
LOG_FLOOR = math.log(3e-5)
CODES = ["slathr3", "whtrob1", "bhnthr1", "whtthr2", "austhr1"]
PCT = [28.0, 12.0, 11.0, 6.0, 6.0]
TRUE = "bhnthr1"
BETA = 1.1634

tax = json.load(open(TAX))
rows = tax if isinstance(tax, list) else tax.get("species", tax.get("rows"))
idx_of = {r[2]: i for i, r in enumerate(rows) if isinstance(r, list) and len(r) >= 3}
idxs = [idx_of[c] for c in CODES]
occ = Occ(OCC)
rc = cell_of(LAT, LON)
print(f"  cell {rc}  month {MONTH}")
print(f"  n_cm(Aug)={occ.total(rc[0],rc[1],MONTH)}  pooled={occ.total(rc[0],rc[1])}")

def lp_for(mode):
    if mode == "month1":
        d = occ.cell_priors(rc[0], rc[1], MONTH) or {}
    elif mode == "pooled":
        d = occ.cell_pooled(rc[0], rc[1]) or {}
    elif mode == "month3":
        # log-sum-exp across the three monthly slices, then renormalise
        acc = {}
        for m in (MONTH-1, MONTH, MONTH+1):
            mm = ((m-1) % 12) + 1
            for k, v in (occ.cell_priors(rc[0], rc[1], mm) or {}).items():
                acc.setdefault(k, []).append(v)
        d = {}
        for k, vs in acc.items():
            mx = max(vs)
            d[k] = mx + math.log(sum(math.exp(v-mx) for v in vs) / 3.0)
    else:
        raise ValueError(mode)
    return np.array([d.get(i, LOG_FLOOR) for i in idxs]), len(d)

p = np.array(PCT) / 100.0
post = np.log(p / p.sum())
lp1, _ = lp_for("month1")
vision = post - BETA * lp1          # arm-invariant vision part

print("\n  log-priors per arm (order slathr3, whtrob1, bhnthr1, whtthr2, austhr1):")
for mode in ("month1", "month3", "pooled"):
    lp, ns = lp_for(mode)
    print(f"    {mode:8s} species_in_cell={ns:3d}  {np.round(lp,2).tolist()}")

ti = CODES.index(TRUE)
print("\n  === does any arm flip this photo? ===")
for mode in ("month1", "month3", "pooled"):
    lp, _ = lp_for(mode)
    s = vision + BETA * lp
    w = int(np.argmax(s))
    print(f"    {mode:8s} winner={CODES[w]:9s} true_gap={s[ti]-s.max():+.3f}"
          + ("   FLIPS TO CORRECT" if w == ti else ""))

print("\n  === how much beta would month1 need? ===")
for b in (1.16, 2, 3, 5, 8, 12, 20):
    s = vision + b * lp1
    w = int(np.argmax(s))
    print(f"    beta={b:5.2f}  winner={CODES[w]:9s} gap={s[ti]-s.max():+.3f}")
