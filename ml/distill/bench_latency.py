#!/usr/bin/env python3
"""Inference latency: BioCLIP-2 / BioCLIP 2.5 / WingCLIP, same harness.

Accuracy without speed is half the story, and speed is the entire reason
WingCLIP exists. Measures forward-pass throughput on synthetic batches at each
model's native input resolution, so no data loading is in the timing.

Reports GPU batch-1 latency (the interactive case), GPU batched throughput
(the bulk-eval case), and optionally CPU batch-1, which is the closest proxy
we have here for the on-device story.

Usage:
  python bench_latency.py --device cuda --batch 32
  python bench_latency.py --device cpu --batch 1 --iters 20
"""
import argparse
import json
import os
import time

import torch
import open_clip

MODELS = ["hf-hub:imageomics/bioclip-2",
          "hf-hub:imageomics/bioclip-2.5-vith14",
          "hf-hub:imageomics/bioclip",
          "hf-hub:imageomics/bioclip-vit-b-16-inat-only"]


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def res_of(pp, visual=None):
    """Square input resolution the model actually accepts.

    Reading it off the preprocess is WRONG: open_clip pipelines Resize(248)
    then CenterCrop(224), so the first transform reports the pre-crop size and
    timm asserts on it. Prefer the model's own declared size, and fall back to
    the SMALLEST transform size (the crop, not the resize).
    """
    for attr in ("image_size", "img_size"):
        v = getattr(visual, attr, None)
        if isinstance(v, int):
            return v
        if isinstance(v, (list, tuple)) and v:
            return v[0]
    pe = getattr(visual, "patch_embed", None)
    tv = getattr(pe, "img_size", None)
    if isinstance(tv, (list, tuple)) and tv:
        return tv[0]
    sizes = []
    for t in getattr(pp, "transforms", []):
        sz = getattr(t, "size", None)
        if isinstance(sz, int):
            sizes.append(sz)
        elif isinstance(sz, (list, tuple)) and sz:
            sizes.append(sz[0])
    return min(sizes) if sizes else 224


@torch.no_grad()
def timeit(fn, x, iters, warmup, device):
    for _ in range(warmup):
        fn(x)
    if device == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(iters):
        fn(x)
    if device == "cuda":
        torch.cuda.synchronize()
    return (time.perf_counter() - t0) / iters


def load_student(checkpoint, device):
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from train_student import Student
    ck = torch.load(checkpoint, map_location="cpu", weights_only=False)
    a = ck.get("args", {})
    st = Student(a["arch"], a.get("pretrained", "laion2b_s34b_b88k"))
    sd = ck["model"]
    if any(k.startswith("_orig_mod.") for k in sd):
        sd = {k.replace("_orig_mod.", "", 1): v for k, v in sd.items()}
    st.load_state_dict(sd)
    return st.to(device).eval(), st.preprocess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--iters", type=int, default=30)
    ap.add_argument("--warmup", type=int, default=5)
    ap.add_argument("--checkpoints", nargs="*", default=[])
    ap.add_argument("--timm", nargs="*", default=[],
                    help="timm model ids (supervised heads, e.g. the iNat21 "
                         "EVA02). Timed on the FULL forward pass including the "
                         "classifier head, which is what that model actually "
                         "runs; the CLIP towers are timed to the embedding, "
                         "which is what THEY actually run.")
    ap.add_argument("--out", default="bench_latency.json")
    a = ap.parse_args()
    dev = a.device
    if dev == "cuda" and not torch.cuda.is_available():
        raise SystemExit("cuda requested but unavailable")

    rows = []
    todo = ([("hf", m) for m in MODELS]
            + [("ckpt", c) for c in a.checkpoints]
            + [("timm", t) for t in a.timm])
    for kind, ident in todo:
        if kind == "hf":
            model, _, pp = open_clip.create_model_and_transforms(ident)
            model = model.to(dev).eval()
            visual = model.visual
            fn = model.encode_image
            tag = ident.split("/")[-1]
        elif kind == "timm":
            import timm
            model = timm.create_model(ident, pretrained=True).to(dev).eval()
            cfg = timm.data.resolve_model_data_config(model)
            pp = timm.data.create_transform(**cfg, is_training=False)
            visual = model
            fn = model
            tag = ident.split("/")[-1]
        else:
            model, pp = load_student(ident, dev)
            visual = model
            fn = model
            tag = os.path.basename(ident)
        params = sum(p.numel() for p in visual.parameters()) / 1e6
        r = res_of(pp, visual)
        for bs in sorted({1, a.batch}):
            x = torch.randn(bs, 3, r, r, device=dev)
            try:
                s = timeit(fn, x, a.iters, a.warmup, dev)
            except RuntimeError as e:
                log(f"{tag} bs={bs} FAILED: {e}")
                continue
            row = {"model": tag, "device": dev, "res": r, "batch": bs,
                   "visual_params_M": round(params, 1),
                   "ms_per_batch": round(s * 1000, 2),
                   "ms_per_image": round(s * 1000 / bs, 3),
                   "img_per_s": round(bs / s, 1)}
            rows.append(row)
            log(f"{tag:<26} bs={bs:<4} {r}px  "
                f"{row['ms_per_image']:>8.3f} ms/img  {row['img_per_s']:>8.1f} img/s")
        del model
        if dev == "cuda":
            torch.cuda.empty_cache()

    json.dump(rows, open(a.out, "w"), indent=1)
    log(f"wrote {a.out}")


if __name__ == "__main__":
    main()
