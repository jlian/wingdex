#!/usr/bin/env python3
"""Score the iNat21 EVA02 model on NABirds (issue #290, supervised arm).

WHY THIS IS A SEPARATE SCRIPT
-----------------------------
`eva02_large_patch14_clip_336.merged2b_ft_inat21` is NOT open-vocabulary. It is
a supervised classifier with a fixed 10,000-way iNat21 head, so it cannot be
scored by `bench_nabirds_multi.py`, which builds a text classifier over an
arbitrary species list. Putting it in the same table as the zero-shot models
without saying so would be the exact apples-to-oranges the issue warns about.

HOW THE LABEL SPACES ARE JOINED
-------------------------------
config.json ships `label_names` as scientific names, and taxonomy.json carries
scientific names, so the join is by name. 384 of our 401 NABirds species are in
the head (95.8%). The 17 misses are taxonomic renames and splits postdating
iNat21: `Astur cooperii` (was `Accipiter cooperii`), `Nannopterum auritum`
(was `Phalacrocorax auritus`), `Urile pelagicus`, `Leuconotopicus villosus`,
and similar.

TWO ARMS, because a single number would flatter or punish it unfairly:

  restricted  argmax over ONLY the 384 mapped columns, on the images whose true
              species is one of those 384. This is GENEROUS: the model is told
              the answer is a North American bird, which the zero-shot models
              are not told. It is the fairest read of the visual tower.

  open10k     argmax over all 10,000 iNat21 classes, on the same images. This is
              the honest "what would this model actually say" number, and it is
              still easier than our 11,167-way zero-shot task in one respect
              (a fixed supervised head) and harder in another (10k classes
              spanning all of life, not just birds).

Report BOTH, and report that 17 species are unscoreable either way.

Usage:
  python bench_eva02_inat.py --images ~/nabirds_flat
"""
import argparse
import json
import os
import time

import numpy as np
import timm
import torch
from PIL import Image

MODEL = "hf_hub:timm/eva02_large_patch14_clip_336.merged2b_ft_inat21"


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--meta", default="nabirds_meta")
    ap.add_argument("--nb-map", default="nabirds_to_taxo.json")
    ap.add_argument("--taxonomy", default="taxonomy.json")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default="bench_eva02.json")
    a = ap.parse_args()

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    taxo = json.load(open(a.taxonomy))
    nb = json.load(open(a.nb_map))

    log(f"loading {MODEL}")
    model = timm.create_model(MODEL, pretrained=True).to(dev).eval()
    cfg = timm.data.resolve_model_data_config(model)
    pp = timm.data.create_transform(**cfg, is_training=False)
    names = model.pretrained_cfg.get("label_names")
    if not names:
        import urllib.request
        url = ("https://huggingface.co/timm/"
               "eva02_large_patch14_clip_336.merged2b_ft_inat21/raw/main/"
               "config.json")
        names = json.load(urllib.request.urlopen(url))["label_names"]
    log(f"head classes {len(names)}  input {cfg['input_size']}")

    head = {n.strip().lower(): k for k, n in enumerate(names)}
    # taxonomy index -> head column, for the NABirds species that exist there
    nb_idx = sorted(set(nb.values()))
    tax2head = {i: head[taxo[i][1].strip().lower()]
                for i in nb_idx if taxo[i][1].strip().lower() in head}
    cols = sorted(set(tax2head.values()))
    col_pos = {c: j for j, c in enumerate(cols)}
    log(f"mapped {len(tax2head)}/{len(nb_idx)} NABirds species into the head")

    relpath, cls, split = {}, {}, {}
    for line in open(os.path.join(a.meta, "images.txt")):
        i, p = line.split()
        relpath[i] = p
    for line in open(os.path.join(a.meta, "image_class_labels.txt")):
        i, c = line.split()
        cls[i] = int(c)

    samples, unscoreable = [], 0
    for i, cid in cls.items():
        tx = nb.get(str(cid))
        if tx is None:
            continue
        p = os.path.join(a.images, os.path.basename(relpath[i]))
        if not os.path.exists(p):
            continue
        if tx not in tax2head:
            unscoreable += 1
            continue
        samples.append((p, tx))
    if a.limit:
        samples = samples[:a.limit]
    log(f"samples={len(samples)}  unscoreable(species not in head)={unscoreable}")

    class DS(torch.utils.data.Dataset):
        def __len__(self):
            return len(samples)

        def __getitem__(self, i):
            try:
                return pp(Image.open(samples[i][0]).convert("RGB")), i
            except Exception:
                return torch.zeros(3, *cfg["input_size"][1:]), -1

    dl = torch.utils.data.DataLoader(DS(), batch_size=a.batch,
                                     num_workers=a.workers, pin_memory=True)
    ok_r1 = ok_r5 = ok_o1 = ok_o5 = n = 0
    t0, done = time.time(), 0
    with torch.no_grad():
        for x, ii in dl:
            logits = model(x.to(dev, non_blocking=True)).float().cpu()
            sub = logits[:, cols]
            for row_full, row_sub, si in zip(logits, sub, ii.tolist()):
                if si < 0:
                    continue
                tx = samples[si][1]
                gold_col = tax2head[tx]
                n += 1
                t5 = row_sub.topk(5).indices.tolist()
                if cols[t5[0]] == gold_col:
                    ok_r1 += 1
                if gold_col in [cols[t] for t in t5]:
                    ok_r5 += 1
                o5 = row_full.topk(5).indices.tolist()
                if o5[0] == gold_col:
                    ok_o1 += 1
                if gold_col in o5:
                    ok_o5 += 1
            done += len(ii)
            if done % (a.batch * 40) == 0:
                log(f"  {done}/{len(samples)}  {done/(time.time()-t0):.0f} img/s")

    params = sum(p.numel() for p in model.parameters()) / 1e6
    res = {"model": "eva02-L-inat21", "supervised": True,
           "visual_params_M": round(params, 1),
           "n": n, "unscoreable": unscoreable,
           "species_mapped": len(tax2head), "species_total": len(nb_idx),
           "restricted_top1": round(100 * ok_r1 / n, 2),
           "restricted_top5": round(100 * ok_r5 / n, 2),
           "restricted_classes": len(cols),
           "open10k_top1": round(100 * ok_o1 / n, 2),
           "open10k_top5": round(100 * ok_o5 / n, 2),
           "open10k_classes": len(names)}
    log(json.dumps(res, indent=1))
    prev = json.load(open(a.out)) if os.path.exists(a.out) else []
    prev.append(res)
    json.dump(prev, open(a.out, "w"), indent=1)
    log(f"appended -> {a.out}")


if __name__ == "__main__":
    main()
