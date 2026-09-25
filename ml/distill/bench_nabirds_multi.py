#!/usr/bin/env python3
"""Multi-model NABirds benchmark on ONE harness (issue #290).

Why this exists
---------------
eval_nabirds.py answers "how much of the teacher did the student keep". It is
hardwired to BioCLIP-2 as BOTH the image teacher and the text tower, and it
only scores the 24,633-image test split. That is the right tool for
distillation retention and the wrong tool for a leaderboard claim.

This script scores ANY open_clip / hf-hub open-vocabulary model, plus our own
checkpoints, under the same evaluator, and makes the two axes that were
previously conflated explicit:

  --split   test (24,633) | all (48,562)   <- image protocol
  --labels  nabirds555 | full              <- label space

BioCLIP 2 and BioCLIP 2.5 publish "555 visual categories of 48,640 images",
i.e. --split all --labels nabirds555. Our historical model-card numbers are
--split test --labels full (zero-shot over the whole 10,994-species taxonomy),
which is a HARDER label space and a DIFFERENT image set. Neither number was
ever comparable to theirs. Run both and say which is which.

Our students emit BioCLIP-2 embeddings, so they are always scored against the
BioCLIP-2 text tower. Every other model is scored with its OWN text tower;
using someone else's text encoder on a foreign image encoder is not zero-shot,
it is nonsense.

Supervised fixed-head models (e.g. eva02 ..._ft_inat21) are NOT open-vocabulary
and are deliberately out of scope here. They belong in a separate table.

Usage:
  python bench_nabirds_multi.py --images ~/nabirds_flat \
      --model hf-hub:imageomics/bioclip-2 \
      --split all --labels nabirds555
  python bench_nabirds_multi.py --images ~/nabirds_flat \
      --checkpoint runs/ft_tiny39_fresh/wise_a0.60.pt --split all
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F
import open_clip
from PIL import Image

BIOCLIP2 = "hf-hub:imageomics/bioclip-2"


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def load_meta(meta_dir):
    relpath, cls, split = {}, {}, {}
    for line in open(os.path.join(meta_dir, "images.txt")):
        i, p = line.split()
        relpath[i] = p
    for line in open(os.path.join(meta_dir, "image_class_labels.txt")):
        i, c = line.split()
        cls[i] = int(c)
    for line in open(os.path.join(meta_dir, "train_test_split.txt")):
        i, s = line.split()
        split[i] = int(s)
    return relpath, cls, split


def load_samples(images_dir, meta_dir, nb_to_taxo, split_mode):
    """Resolve NABirds ids to FLAT files (<uuid-no-dashes>.jpg from the shards).

    The Cornell webdataset shards are flat and keyed by the dash-free uuid,
    while images.txt carries a 'NNNN/<uuid>.jpg' relative path. Match on
    basename so the same metadata drives either layout.
    """
    relpath, cls, split = load_meta(meta_dir)
    samples, missing = [], 0
    for i, cid in cls.items():
        if split_mode == "test" and split.get(i, 0) != 0:
            continue
        taxo_idx = nb_to_taxo.get(str(cid))
        if taxo_idx is None:
            continue
        p = os.path.join(images_dir, os.path.basename(relpath[i]))
        if not os.path.exists(p):
            missing += 1
            continue
        samples.append((p, taxo_idx))
    if missing:
        log(f"WARNING: {missing} images referenced by metadata are absent")
    return samples


def build_text(model_name, taxo, label_idx, device, batch=256, pretrained=None):
    """Zero-shot classifier over label_idx, using THIS model's own text tower.

    `pretrained` is a SEPARATE argument, not a "name:tag" string. open_clip
    only accepts the colon form for hf-hub ids; for built-in architectures
    ("ViT-B-16" + "openai") it raises "Model config not found in built-ins".
    """
    model, _, pp = open_clip.create_model_and_transforms(model_name,
                                                         pretrained=pretrained)
    tok = open_clip.get_tokenizer(model_name)
    model = model.to(device).eval()
    prompts = [f"a photo of {taxo[j][0]}, {taxo[j][1]}, a species of bird."
               for j in label_idx]
    feats = []
    with torch.no_grad():
        for i in range(0, len(prompts), batch):
            tf = model.encode_text(tok(prompts[i:i + batch]).to(device))
            feats.append(F.normalize(tf.float(), dim=-1).cpu())
    T = torch.cat(feats).to(device)
    log(f"text classifier {tuple(T.shape)} from {model_name}")
    return T, model, pp


def load_student(checkpoint, device):
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from train_student import Student
    ckpt = torch.load(checkpoint, map_location="cpu")
    a = ckpt.get("args", {})
    if not a.get("arch"):
        raise SystemExit(f"{checkpoint} has no args['arch']")
    st = Student(a["arch"], a.get("pretrained", "laion2b_s34b_b88k"))
    sd = ckpt["model"]
    if any(k.startswith("_orig_mod.") for k in sd):
        sd = {k.replace("_orig_mod.", "", 1): v for k, v in sd.items()}
    st.load_state_dict(sd)
    st = st.to(device).eval()
    log(f"student {a.get('arch')} epoch {ckpt.get('epoch','?')}")
    return st, st.preprocess


@torch.no_grad()
def embed(paths, pp, fn, device, batch, workers):
    """Decode+preprocess in a DataLoader; the GPU is never the bottleneck here."""
    class DS(torch.utils.data.Dataset):
        def __len__(self):
            return len(paths)

        def __getitem__(self, i):
            try:
                return pp(Image.open(paths[i]).convert("RGB")), i
            except Exception:
                return torch.zeros(3, 224, 224), -1

    dl = torch.utils.data.DataLoader(DS(), batch_size=batch, num_workers=workers,
                                     pin_memory=True)
    embs, keep, t0, done = [], [], time.time(), 0
    for x, idx in dl:
        embs.append(fn(x.to(device, non_blocking=True)).float().cpu())
        keep.append(idx)
        done += len(idx)
        if done % (batch * 40) == 0:
            log(f"  {done}/{len(paths)}  {done/(time.time()-t0):.0f} img/s")
    return torch.cat(embs), torch.cat(keep)


def score(E, labs, T, tag, n_classes):
    E = F.normalize(E, dim=-1)
    sims = E @ T.T
    conf = (sims * 100).softmax(-1).max(-1).values.cpu().numpy()
    top5 = sims.topk(5, -1).indices.cpu().numpy()
    lab = np.asarray(labs)
    ok1 = top5[:, 0] == lab
    ok5 = (top5 == lab[:, None]).any(1)
    gated = [{"thr": t, "coverage": round(100 * (conf >= t).mean(), 1),
              "acc_on_kept": round(100 * ok1[conf >= t].mean(), 2)
              if (conf >= t).any() else 0.0}
             for t in (0.0, 0.3, 0.5, 0.7, 0.9)]
    return {"model": tag, "n": int(len(lab)), "n_classes": n_classes,
            "top1": round(100 * ok1.mean(), 2),
            "top5": round(100 * ok5.mean(), 2), "abstention": gated}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="flat dir of NABirds jpgs")
    ap.add_argument("--meta", default="nabirds_meta")
    ap.add_argument("--nb-map", default="nabirds_to_taxo.json")
    ap.add_argument("--taxonomy", default="taxonomy.json")
    ap.add_argument("--model", default="", help="open_clip / hf-hub model id")
    ap.add_argument("--pretrained", default=None,
                    help="open_clip pretrained tag for built-in archs, "
                         "e.g. --model ViT-B-16 --pretrained openai")
    ap.add_argument("--checkpoint", default="", help="our student checkpoint")
    ap.add_argument("--split", choices=["test", "all"], default="all")
    ap.add_argument("--labels", choices=["nabirds555", "full"],
                    default="nabirds555")
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tag", default="")
    ap.add_argument("--out", default="bench_nabirds_multi.json")
    a = ap.parse_args()
    if bool(a.model) == bool(a.checkpoint):
        raise SystemExit("pass exactly one of --model / --checkpoint")

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    if dev == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    taxo = json.load(open(a.taxonomy))
    nb_to_taxo = json.load(open(a.nb_map))

    samples = load_samples(a.images, a.meta, nb_to_taxo, a.split)
    if a.limit:
        samples = samples[:a.limit]
    log(f"split={a.split} samples={len(samples)}")
    if not samples:
        raise SystemExit("no samples resolved; check --images / --meta")

    # Label space. nabirds555 = the categories NABirds actually contains, which
    # is what the BioCLIP cards report. full = our whole taxonomy, much harder.
    if a.labels == "nabirds555":
        label_idx = sorted(set(nb_to_taxo.values()))
    else:
        label_idx = list(range(len(taxo)))
    remap = {t: k for k, t in enumerate(label_idx)}
    log(f"label space={a.labels} classes={len(label_idx)}")

    # Our students live in BioCLIP-2's embedding space, so they are scored with
    # the BioCLIP-2 text tower. Foreign models use their own.
    text_src = BIOCLIP2 if a.checkpoint else a.model
    T, txt_model, txt_pp = build_text(text_src, taxo, label_idx, dev,
                                      pretrained=(a.pretrained
                                                  if a.model else None))

    if a.checkpoint:
        net, pp = load_student(a.checkpoint, dev)
        fn = lambda x: net(x)
        tag = a.tag or os.path.basename(a.checkpoint)
        del txt_model
    else:
        net, pp = txt_model, txt_pp
        fn = lambda x: net.encode_image(x)
        tag = a.tag or a.model
    if dev == "cuda":
        torch.cuda.empty_cache()

    paths = [p for p, _ in samples]
    labs = [remap[l] for _, l in samples]
    E, keep = embed(paths, pp, fn, dev, a.batch, a.workers)
    good = keep.numpy() >= 0
    if (~good).any():
        log(f"dropped {int((~good).sum())} undecodable images")
    E = E[good]
    labs = [labs[i] for i in keep.numpy()[good]]

    r = score(E.to(dev), labs, T, tag, len(label_idx))
    r.update(split=a.split, labels=a.labels, text_tower=text_src,
             pretrained=a.pretrained)
    log(json.dumps(r, indent=1))
    prev = json.load(open(a.out)) if os.path.exists(a.out) else []
    prev.append(r)
    json.dump(prev, open(a.out, "w"), indent=1)
    log(f"appended -> {a.out}")


if __name__ == "__main__":
    main()
