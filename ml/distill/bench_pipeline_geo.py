#!/usr/bin/env python3
"""WingDex PRODUCTION pipeline on NABirds, with and without geo.

WHAT THIS MEASURES
------------------
The shipping ranker, not a research approximation:

    score = sim / T + beta * log P(species | cell, month)

with the SHIPPED constants read out of src/lib/bird-id-local-adapter.ts and
src/lib/rank.ts at runtime, the SHIPPED v4 occurrence blob, and the SHIPPED
Equal Earth cell math (ee_port.py). Constants are parsed rather than retyped
for the same reason probe_e2e_fixture.py parses them: a hand-copied number that
drifts makes the benchmark assert its own mistake.

GEO SOURCE. NABirds carries no coordinates. Mac Aodha et al.'s geo-prior release
ships `nabirds_with_loc_2019.json`, eBird-derived lat/lon/date/user_id for all
24,633 test images. That is the standard geo-prior protocol for this dataset.
NABirds is Cornell/eBird, NOT iNaturalist, so there is no photo-id overlap with
our training corpus by construction and no exclusion pass is required.

  date is a FRACTION OF YEAR in [0,1]; month = floor(date*12)+1.
  Coordinates are eBird-derived, not photographer EXIF: a realistic proxy.

WHAT IS DELIBERATELY NOT RUN
----------------------------
The bird/not-bird probe gate. Its Platt constants are fitted in WingCLIP's int8
embedding space and NABirds is 100% birds, so the gate can only subtract
accuracy here (measured at -0.27 pp). Running it would report a number about
abstention, not about geo. Species ranking is the question.

CALIBRATION SCOPE. T and beta shipped for WingCLIP-0.3 and are used verbatim.
Any OTHER checkpoint needs its own fit: T sets the scale on which similarity
trades against the prior, so reusing 0.3's T on another model silently
mis-weights the prior. Pass --temperature/--beta to override, and say in the
writeup that you did.

Usage:
  python bench_pipeline_geo.py --images ~/nabirds_flat \
      --geo-json ~/geoprior/geo_prior_data/data/nabirds/nabirds_with_loc_2019.json
"""
import argparse
import json
import math
import os
import re
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ee_port import lonlat_to_ee, xy_to_cell  # noqa: E402
from occ_port_v4 import OccV4 as Occ  # noqa: E402
import shipped_model as SM  # noqa: E402

TOPK = 25  # shortlist size the client scores, bird-id-local.ts


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def read_client_constants(repo_root):
    """Parse the SHIPPED scalars out of the TS source. Never retype them."""
    ad = os.path.join(repo_root, "src", "lib", "bird-id-local-adapter.ts")
    rk = os.path.join(repo_root, "src", "lib", "rank.ts")
    a, r = open(ad).read(), open(rk).read()
    m = re.search(r"calibration:\s*\{\s*temperature:\s*([0-9.eE+-]+)\s*,"
                  r"\s*beta:\s*([0-9.eE+-]+)", a)
    if not m:
        raise SystemExit("could not parse temperature/beta from " + ad)
    T, beta = float(m.group(1)), float(m.group(2))
    m = re.search(r"OCC_FLOOR\s*=\s*Math\.log\(([0-9.eE+-]+)\)", r)
    if not m:
        raise SystemExit("could not parse OCC_FLOOR from " + rk)
    floor = math.log(float(m.group(1)))
    m = re.search(r"OCC_BACKOFF_K\s*=\s*([0-9.eE+-]+)", r)
    if not m:
        raise SystemExit("could not parse OCC_BACKOFF_K from " + rk)
    k = float(m.group(1))
    m = re.search(r'occurrence\.([0-9a-f]+)\.bin\.gz', a)
    blob = m.group(1) if m else None
    log(f"shipped constants: T={T} beta={beta} floor=log({math.exp(floor):g}) "
        f"k={k} blob={blob}")
    return T, beta, floor, k, blob


def month_of(frac):
    """Fraction-of-year -> 1..12, or None when absent.

    222 of the 24,633 test rows carry NaN for lat, lon AND date: eBird had no
    metadata for those photos. NaN must NOT be coerced to a month. rank.ts
    documents exactly this hazard (`validMonth`): bitwise-OR turns NaN into 0,
    so a NaN month silently becomes January and applies January's distribution
    to an unknown-date photo. The shipped client returns null and degrades to
    vision-only ranking, so that is what this does.

    Clamped at 12 because date == 1.0 would otherwise yield month 13.
    """
    if frac is None or not math.isfinite(frac):
        return None
    return min(12, max(1, int(frac * 12) + 1))


def build_text_classifier(taxo, device, model_name="hf-hub:imageomics/bioclip-2"):
    import open_clip
    model, _, _ = open_clip.create_model_and_transforms(model_name)
    tok = open_clip.get_tokenizer(model_name)
    model = model.to(device).eval()
    prompts = [f"a photo of {c}, {s}, a species of bird." for c, s in
               ((r[0], r[1]) for r in taxo)]
    out = []
    with torch.no_grad():
        for i in range(0, len(prompts), 256):
            tf = model.encode_text(tok(prompts[i:i + 256]).to(device))
            out.append(F.normalize(tf.float(), dim=-1).cpu())
    del model
    if device == "cuda":
        torch.cuda.empty_cache()
    T = torch.cat(out)
    log(f"text classifier {tuple(T.shape)}")
    return T.to(device)


def load_student(checkpoint, device):
    from train_student import Student
    ck = torch.load(checkpoint, map_location="cpu", weights_only=False)
    a = ck.get("args", {})
    st = Student(a["arch"], a.get("pretrained", "laion2b_s34b_b88k"))
    sd = ck["model"]
    if any(k.startswith("_orig_mod.") for k in sd):
        sd = {k.replace("_orig_mod.", "", 1): v for k, v in sd.items()}
    st.load_state_dict(sd)
    log(f"student {a.get('arch')} from {checkpoint}")
    return st.to(device).eval(), st.preprocess


def cell_priors(occ, lat, lon, month, use_backoff, k):
    """Port of rankCandidates' prior lookup. Returns (map, pooled, n_cm)."""
    x, y = lonlat_to_ee(lon, lat)
    cell = xy_to_cell(x, y)
    if not cell:
        return None, None, None
    row, col = cell
    pri = occ.cell(row, col, month)
    if pri is None:
        return None, None, None
    pooled, n_cm = None, None
    if use_backoff and occ.version >= 4:
        pooled = occ.cell_pooled(row, col)
        n_cm = occ.total(row, col, month)
    return pri, pooled, n_cm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--geo-json", required=True)
    ap.add_argument("--meta", default="nabirds_meta")
    ap.add_argument("--nb-map", default="nabirds_to_taxo.json")
    ap.add_argument("--taxonomy", default="taxonomy.json")
    ap.add_argument("--labels", choices=["full", "nabirds401"],
                    default="full",
                    help="full = the 11,167-species space PROD actually "
                         "scores; nabirds401 = restrict to the 401 "
                         "NABirds species, comparable to the 401-way "
                         "vision benchmark")
    ap.add_argument("--checkpoint", default="")
    ap.add_argument("--blob", default="")
    ap.add_argument("--temperature", type=float, default=None)
    ap.add_argument("--beta", type=float, default=None)
    ap.add_argument("--tag", default="")
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default="bench_pipeline_geo.json")
    a = ap.parse_args()

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    repo = SM.REPO_ROOT
    T, beta, FLOOR, K, blob_hash = read_client_constants(repo)
    if a.temperature is not None:
        log(f"OVERRIDE temperature {T} -> {a.temperature}")
        T = a.temperature
    if a.beta is not None:
        log(f"OVERRIDE beta {beta} -> {a.beta}")
        beta = a.beta
    ckpt = a.checkpoint or SM.SHIPPED_CHECKPOINT
    tag = a.tag or os.path.basename(ckpt)

    blob = a.blob or os.path.join(repo, "public", "priors",
                                  f"occurrence.{blob_hash}.bin.gz")
    occ = Occ(blob)
    use_backoff = occ.version >= 4 and K > 0
    log(f"blob v{occ.version} backoff={'on' if use_backoff else 'off'}")

    taxo = json.load(open(a.taxonomy))
    nb_to_taxo = json.load(open(a.nb_map))
    geo = json.load(open(a.geo_json))

    # NABirds class_id in the geo file indexes its own 555-entry class list;
    # our nabirds_to_taxo.json is keyed by the ORIGINAL NABirds class id from
    # image_class_labels.txt. Join on image path, which both share.
    relpath_cls = {}
    for line in open(os.path.join(a.meta, "images.txt")):
        i, p = line.split()
        relpath_cls[os.path.basename(p)] = i
    cls = {}
    for line in open(os.path.join(a.meta, "image_class_labels.txt")):
        i, c = line.split()
        cls[i] = int(c)

    samples = []
    skipped_nomap = skipped_noimg = 0
    for r in geo["test"]:
        base = os.path.basename(r["im_path"])
        path = os.path.join(a.images, base)
        if not os.path.exists(path):
            skipped_noimg += 1
            continue
        iid = relpath_cls.get(base)
        tx = nb_to_taxo.get(str(cls.get(iid))) if iid else None
        if tx is None:
            skipped_nomap += 1
            continue
        em = r["ebird_meta"]
        lat, lon = em["lat"], em["lon"]
        if not (math.isfinite(lat) and math.isfinite(lon)):
            lat = lon = None  # no location -> vision-only, same as the client
        samples.append((path, tx, lat, lon, month_of(em["date"])))
    if a.limit:
        samples = samples[:a.limit]
    log(f"samples={len(samples)} (no-image={skipped_noimg} "
        f"unmapped={skipped_nomap})")
    if not samples:
        raise SystemExit("no samples")

    if a.labels == "nabirds401":
        # Restrict the classifier to the NABirds species pool. The candidate
        # indices coming out of topk are then POSITIONS in that pool, so the
        # true label must be remapped into the same space or every comparison
        # silently fails.
        label_idx = sorted(set(nb_to_taxo.values()))
        remap = {t: k for k, t in enumerate(label_idx)}
        taxo_used = [taxo[i] for i in label_idx]
        samples = [(p_, remap[t], la, lo, mo) for (p_, t, la, lo, mo) in samples]
        # The occurrence blob is keyed by FULL taxonomy index, so the prior
        # lookup needs the original index back.
        pool_to_taxo = {k: t for t, k in remap.items()}
        log(f"label space: nabirds401 ({len(label_idx)} species)")
    else:
        taxo_used = taxo
        pool_to_taxo = None
        log(f"label space: full ({len(taxo)} species)")

    text = build_text_classifier(taxo_used, dev)
    net, pp = load_student(ckpt, dev)

    class DS(torch.utils.data.Dataset):
        def __len__(self):
            return len(samples)

        def __getitem__(self, i):
            try:
                return pp(Image.open(samples[i][0]).convert("RGB")), i
            except Exception:
                return torch.zeros(3, 224, 224), -1

    dl = torch.utils.data.DataLoader(DS(), batch_size=a.batch,
                                     num_workers=a.workers, pin_memory=True)
    sims_all, idx_all = [], []
    t0, done = time.time(), 0
    with torch.no_grad():
        for x, ii in dl:
            e = F.normalize(net(x.to(dev, non_blocking=True)).float(), dim=-1)
            s = e @ text.T
            top = s.topk(min(TOPK, s.shape[1]), -1)
            sims_all.append(torch.stack([top.values.cpu(),
                                         top.indices.cpu().float()], -1))
            idx_all.append(ii)
            done += len(ii)
            if done % (a.batch * 60) == 0:
                log(f"  {done}/{len(samples)}  {done/(time.time()-t0):.0f} img/s")
    S = torch.cat(sims_all).numpy()
    II = torch.cat(idx_all).numpy()

    n = ok_v1 = ok_v5 = ok_g1 = ok_g5 = 0
    no_cell = no_meta = 0
    for row, si in zip(S, II):
        if si < 0:
            continue
        _, true_idx, lat, lon, month = samples[si]
        cand_sim = row[:, 0]
        cand_idx = row[:, 1].astype(np.int64)
        n += 1
        order_v = np.argsort(-cand_sim)
        if cand_idx[order_v[0]] == true_idx:
            ok_v1 += 1
        if true_idx in cand_idx[order_v[:5]]:
            ok_v5 += 1

        if lat is None or lon is None or month is None:
            pri = pooled = n_cm = None
            no_meta += 1
        else:
            pri, pooled, n_cm = cell_priors(occ, lat, lon, month,
                                            use_backoff, K)
        if pri is None:
            no_cell += 1
            score = cand_sim / T
        else:
            logP = np.empty(len(cand_idx))
            for j, ci in enumerate(cand_idx):
                # Blob keys are FULL taxonomy indices; under nabirds401 the
                # candidate index is a position in the restricted pool.
                gi = int(ci) if pool_to_taxo is None else pool_to_taxo[int(ci)]
                lp = pri.get(gi)
                if pooled is not None and n_cm is not None:
                    nscm = 0.0 if lp is None else math.exp(lp) * n_cm
                    pv = pooled.get(gi)
                    ppv = 0.0 if pv is None else math.exp(pv)
                    num = nscm + K * ppv
                    logP[j] = math.log(num / (n_cm + K)) if num > 0 else FLOOR
                else:
                    logP[j] = FLOOR if lp is None else lp
            logP = np.maximum(logP, FLOOR)
            score = cand_sim / T + beta * logP
        order_g = np.argsort(-score)
        if cand_idx[order_g[0]] == true_idx:
            ok_g1 += 1
        if true_idx in cand_idx[order_g[:5]]:
            ok_g5 += 1

    res = {"model": tag, "labels": a.labels, "n": n,
           "no_cell_data": no_cell,
           "no_metadata": no_meta,
           "temperature": T, "beta": beta, "occ_floor": FLOOR,
           "backoff_k": K, "blob_version": occ.version,
           "vision_only_top1": round(100 * ok_v1 / n, 2),
           "vision_only_top5": round(100 * ok_v5 / n, 2),
           "pipeline_top1": round(100 * ok_g1 / n, 2),
           "pipeline_top5": round(100 * ok_g5 / n, 2)}
    res["geo_gain_top1"] = round(res["pipeline_top1"] - res["vision_only_top1"], 2)
    log(json.dumps(res, indent=1))
    prev = json.load(open(a.out)) if os.path.exists(a.out) else []
    prev.append(res)
    json.dump(prev, open(a.out, "w"), indent=1)
    log(f"appended -> {a.out}")


if __name__ == "__main__":
    main()
