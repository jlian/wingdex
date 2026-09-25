#!/usr/bin/env python3
"""Publication charts for the NABirds benchmark (issue #290).

DESIGN RULES
------------
Charts carry the finding. Everything else belongs in prose. Concretely:

- No legend. No architecture strings under model names. No parameter counts
  printed inside bars unless size IS the subject of that chart. Those are
  reference facts for the table in BENCH290.md, not things a reader decodes
  from a picture.
- Footnotes state only what is needed to trust the number: what dataset, how
  many images, how many classes, and any caveat that changes the reading.
- The headline states the finding; the deck says what is measured.

TYPOGRAPHY. Inter (Inter Display for headlines), from `fonts-inter`.
matplotlib's DejaVu Sans default reads as "a script made this".

SVG. `svg.fonttype = "none"` keeps real <text> elements instead of converting
glyphs to filled paths. Path-converted text cannot be re-flowed, searched, or
restyled, and renders slightly soft. Real text needs Inter available to the
viewer, which is the right trade for a self-hosted blog.
"""
import json
import os
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter, LogLocator

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "charts")
os.makedirs(OUT, exist_ok=True)

_avail = {f.name for f in matplotlib.font_manager.fontManager.ttflist}
SANS = next((f for f in ("Inter", "Roboto", "Liberation Sans", "DejaVu Sans")
             if f in _avail), "sans-serif")
DISPLAY = "Inter Display" if "Inter Display" in _avail else SANS
plt.rcParams.update({
    "font.family": SANS, "font.size": 11, "figure.dpi": 200,
    "savefig.dpi": 200, "text.color": "#1a1a1a",
    "axes.labelcolor": "#5c5c5c", "xtick.color": "#5c5c5c",
    "ytick.color": "#5c5c5c",
    "svg.fonttype": "none",
    "path.simplify": True, "agg.path.chunksize": 0,
})

ACCENT = "#1f6f5c"
ACCENT_LT = "#57a08b"
GEO = "#8fc4b2"          # the geo-prior increment
NEUTRAL = "#d7d5d0"
NEUTRAL_E = "#bdbab3"
SUPER = "#c9c6bf"
INK = "#1a1a1a"
MUTED = "#6b6862"
RULE = "#e2e0dc"

PARAMS = {"bioclip-2": 304.0, "bioclip-2.5": 632.1, "wingclip-0.1": 86.6,
          "wingclip-0.3": 38.7, "bioclip-1": 86.2, "biotrove-clip": 86.2,
          "bioclip-inat-only": 86.2, "clip-vit-b16": 86.2,
          "clip-vit-l14": 304.0, "siglip-b16": 92.9, "eva02-inat21": 313.9}
LABEL = {"bioclip-2": "BioCLIP-2", "bioclip-2.5": "BioCLIP 2.5",
         "wingclip-0.1": "WingCLIP-0.1", "wingclip-0.3": "WingCLIP-0.3",
         "bioclip-1": "BioCLIP", "bioclip-inat-only": "BioCLIP iNat",
         "biotrove-clip": "BioTrove-CLIP", "clip-vit-b16": "CLIP B/16",
         "clip-vit-l14": "CLIP L/14", "siglip-b16": "SigLIP B/16",
         "eva02-inat21": "EVA02 iNat21"}
MINE = ("wingclip-0.1", "wingclip-0.3")
SUPERVISED = ("eva02-inat21",)
# Non-bird baselines and BioTrove are measured and tabulated in BENCH290.md but
# kept OUT of the charts: 18-33 against 70-95 stretches the axis until the
# models a reader actually compares sit in one flat band.
SKIP = ("biotrove-clip", "clip-vit-b16", "clip-vit-l14", "siglip-b16")

LATKEY = {"bioclip-2": "bioclip-2", "bioclip-2.5-vith14": "bioclip-2.5",
          "wise_a0.60.pt": "wingclip-0.3", "wingclip-0.1.pt": "wingclip-0.1",
          "bioclip": "bioclip-1",
          "bioclip-vit-b-16-inat-only": "bioclip-inat-only",
          "eva02_large_patch14_clip_336.merged2b_ft_inat21": "eva02-inat21"}

SUPER_NOTE = ("EVA02 iNat21 is supervised over a fixed 10,000-class head, "
              "not open-vocabulary.")


def color_of(m):
    if m == "wingclip-0.3":
        return ACCENT
    if m == "wingclip-0.1":
        return ACCENT_LT
    if m in SUPERVISED:
        return SUPER
    return NEUTRAL


def hatch_of(m):
    return "///" if m in SUPERVISED else None


def headline(fig, title, deck):
    fig.text(0.012, 0.972, title, ha="left", va="top", fontsize=16.5,
             fontweight="bold", color=INK, family=DISPLAY)
    fig.text(0.012, 0.908, deck, ha="left", va="top", fontsize=10.5,
             color=MUTED, family=SANS)


def footnote(fig, text, width=140):
    fig.text(0.012, 0.020, "\n".join(textwrap.wrap(text, width)), ha="left",
             va="bottom", fontsize=8.5, color="#918e88", family=SANS,
             linespacing=1.45)


# Every accuracy axis in this file uses the SAME range. Charts that each pick
# their own limits cannot be compared by eye, and a reader flipping between
# them will misread a 3-point gap as a 10-point one. 60-100 holds every
# bird-trained model measured, with 5-point gridlines.
Y_MIN, Y_MAX, Y_STEP = 60, 100, 5


def nice_ylim(vals=None, *_a, **_kw):
    """Fixed accuracy range. Args accepted and ignored, for call-site parity."""
    return Y_MIN, Y_MAX, Y_STEP


def load(name):
    p = os.path.join(HERE, name)
    return json.load(open(p)) if os.path.exists(p) else []


def bench_by():
    by = {}
    for r in load("bench290_results.json"):
        by[(r["model"], r["split"], r["labels"])] = r
    ev = load("bench_eva02.json")
    if ev:
        e = ev[-1]
        for labels in ("nabirds555", "full"):
            by[("eva02-inat21", "all", labels)] = {
                "top1": e["open10k_top1"], "top5": e["open10k_top5"],
                "n": e["n"], "n_classes": e["open10k_classes"]}
    return by


def lat_by():
    out = {}
    for r in load("bench_latency.json"):
        k = LATKEY.get(r["model"])
        if k:
            out[(k, r["batch"])] = r
    return out


def geo_gain():
    """The shipped pipeline's geo-prior increment, full-taxonomy arm only.

    The 401-way arm is NOT usable: T and beta were fitted in the 11,167-species
    space, so restricting the label space mis-weights the prior and the 'gain'
    comes out negative. That is a calibration artefact, not a finding.
    """
    for r in load("bench_pipeline_geo.json"):
        if r.get("labels", "full") == "full":
            return r
    return None


def bar_chart(by, labels, split, title, deck, fname, geo=None, note_extra="",
              show_top5=False):
    data = [(m, by[(m, split, labels)]["top1"], by[(m, split, labels)]["n"],
             by[(m, split, labels)]["n_classes"], by[(m, split, labels)]["top5"])
            for m in PARAMS if m not in SKIP and (m, split, labels) in by]
    if not data:
        return
    tops = [d[1] for d in data] + ([geo["pipeline_top1"]] if geo else [])
    data.sort(key=lambda t: -t[1])
    lo, hi, step = nice_ylim(tops, cap=100)

    w = max(9.0, 1.05 * len(data) + 1.6)
    fig, ax = plt.subplots(figsize=(w, 5.5))
    fig.subplots_adjust(top=0.80, bottom=0.205, left=0.058, right=0.985)
    span = hi - lo
    for i, (m, v, _, _, v5) in enumerate(data):
        if show_top5:
            # Ghost bar to top-5, solid bar to top-1, same width. The solid bar
            # covers the ghost below it, so what remains visible is the SPREAD
            # between the two: how far down the shortlist the right answer sat.
            ax.bar(i, v5 - lo, 0.64, bottom=lo, color=color_of(m), zorder=2,
                   linewidth=0, alpha=0.28)
            ax.text(i, v5 + span * 0.022, f"{v5:.1f}", ha="center", va="bottom",
                    fontsize=9.5, color=MUTED, family=SANS)
        ax.bar(i, v - lo, 0.64, bottom=lo, color=color_of(m), zorder=3,
               linewidth=0, hatch=hatch_of(m), edgecolor="white")
        lab_y = v
        if geo and m == "wingclip-0.3":
            # Stack the geo increment ON TOP of the vision-only bar, hatched,
            # so the reader sees both what the model does alone and what the
            # shipped app does with location and date.
            top = geo["pipeline_top1"]
            ax.bar(i, top - v, 0.64, bottom=v, color=GEO, zorder=3,
                   linewidth=0, hatch="////", edgecolor="white")
            ax.text(i, v - span * 0.045, f"{v:.1f}", ha="center", va="top",
                    fontsize=9.5, color="white", family=SANS)
            lab_y = top
            ax.text(i, (v + top) / 2, f"+{geo['geo_gain_top1']:.1f}",
                    ha="center", va="center", fontsize=10.5,
                    fontweight="bold", color=ACCENT, family=SANS)
        if show_top5:
            # Value sits INSIDE the solid bar; above it is the ghost's territory.
            ax.text(i, lab_y - span * 0.028, f"{lab_y:.1f}", ha="center",
                    va="top", fontsize=11,
                    fontweight="bold" if m in MINE else "normal",
                    color="white", family=SANS)
        else:
            ax.text(i, lab_y + span * 0.03, f"{lab_y:.2f}", ha="center",
                    va="bottom", fontsize=12,
                    fontweight="bold" if m in MINE else "normal",
                    color=ACCENT if m in MINE else INK, family=SANS)

    ax.set_xticks(np.arange(len(data)))
    ax.set_xticklabels([LABEL[m] for m, _, _, _, _ in data], fontsize=10.5,
                       color=INK)
    ax.set_ylim(lo, hi)
    ax.set_yticks(np.arange(lo, hi + 0.01, step))
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, p: f"{v:g}%"))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(NEUTRAL_E)
    ax.tick_params(axis="both", length=0, labelsize=9.5)
    ax.grid(axis="y", color=RULE, linewidth=1, zorder=0)
    ax.set_axisbelow(True)

    zs = [d for d in data if d[0] not in SUPERVISED] or data
    n, k = zs[0][2], zs[0][3]
    headline(fig, title, deck)
    parts = [f"NABirds, {n:,} images, zero-shot over {k:,} classes."]
    if note_extra:
        parts.append(note_extra)
    if any(m in SUPERVISED for m, _, _, _, _ in data):
        parts.append(SUPER_NOTE)
    footnote(fig, "  ".join(parts))
    for ext in ("png", "svg"):
        fig.savefig(os.path.join(OUT, f"{fname}.{ext}"), facecolor="white")
    plt.close(fig)
    print("wrote", fname)


def bar_grouped(by, labels, split, title, deck, fname):
    """Top-1 and top-5 as adjacent bars, one pair per model.

    The overlay version (`show_top5=True`) draws top-5 as a ghost behind
    top-1, so the visible remainder IS the spread. That is the better picture
    of "how far down the shortlist the answer sat". This one is the better
    picture of the two numbers themselves: equal weight, easy to read across
    models, no occlusion.
    """
    data = [(m, by[(m, split, labels)]["top1"], by[(m, split, labels)]["top5"],
             by[(m, split, labels)]["n"], by[(m, split, labels)]["n_classes"])
            for m in PARAMS if m not in SKIP and (m, split, labels) in by]
    if not data:
        return
    data.sort(key=lambda t: -t[1])
    lo, hi, step = nice_ylim([d[1] for d in data], cap=100)

    w = max(9.4, 1.15 * len(data) + 1.6)
    fig, ax = plt.subplots(figsize=(w, 5.7))
    fig.subplots_adjust(top=0.80, bottom=0.205, left=0.058, right=0.985)
    span = hi - lo
    bw = 0.36
    for i, (m, v1, v5, _, _) in enumerate(data):
        c = color_of(m)
        ax.bar(i - bw / 2, v1 - lo, bw, bottom=lo, color=c, zorder=3,
               linewidth=0, hatch=hatch_of(m), edgecolor="white")
        # Top-5 in the same hue at lower weight: same model, weaker claim.
        ax.bar(i + bw / 2, v5 - lo, bw, bottom=lo, color=c, zorder=3,
               linewidth=0, alpha=0.42, hatch=hatch_of(m), edgecolor="white")
        ax.text(i - bw / 2, v1 + span * 0.025, f"{v1:.1f}", ha="center",
                va="bottom", fontsize=10.5,
                fontweight="bold" if m in MINE else "normal",
                color=ACCENT if m in MINE else INK, family=SANS)
        ax.text(i + bw / 2, v5 + span * 0.025, f"{v5:.1f}", ha="center",
                va="bottom", fontsize=10.5, color=MUTED, family=SANS)

    ax.set_xticks(np.arange(len(data)))
    ax.set_xticklabels([LABEL[m] for m, _, _, _, _ in data], fontsize=10.5,
                       color=INK)
    ax.set_ylim(lo, hi)
    ax.set_yticks(np.arange(lo, hi + 0.01, step))
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, p: f"{v:g}%"))
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.spines["bottom"].set_color(NEUTRAL_E)
    ax.tick_params(axis="both", length=0, labelsize=9.5)
    ax.grid(axis="y", color=RULE, linewidth=1, zorder=0)
    ax.set_axisbelow(True)

    # Name the pair once instead of a legend. Put it on OUR model, where the
    # solid fill gives white text real contrast; on the leading bar the fill
    # may be the pale supervised grey and the label vanishes.
    anchor_i = next((i for i, d in enumerate(data) if d[0] == "wingclip-0.3"), 0)
    ax.annotate("top-1", (anchor_i - bw / 2, lo + span * 0.04), ha="center",
                va="bottom", fontsize=8.5, color="white", family=SANS)
    ax.annotate("top-5", (anchor_i + bw / 2, lo + span * 0.04), ha="center",
                va="bottom", fontsize=8.5, color="white", family=SANS)

    zs = [d for d in data if d[0] not in SUPERVISED] or data
    n, k = zs[0][3], zs[0][4]
    headline(fig, title, deck)
    parts = [f"NABirds, {n:,} images, zero-shot over {k:,} classes."]
    if any(m in SUPERVISED for m, _, _, _, _ in data):
        parts.append(SUPER_NOTE)
    footnote(fig, "  ".join(parts))
    for ext in ("png", "svg"):
        fig.savefig(os.path.join(OUT, f"{fname}.{ext}"), facecolor="white")
    plt.close(fig)
    print("wrote", fname)


def bubble(by, lat, fname, batch=1):
    """Accuracy vs latency, bubble area = visual-tower parameters.

    WHICH BATCH SIZE TO SHOW
    ------------------------
    Batch 1 is the interactive case: one photo, one answer. But on a desktop
    GPU it is largely kernel-launch bound, so a 38.7M model and three 86M
    models all land within 1.6 ms of each other and the picture says nothing
    about size. Batch 32 saturates the GPU and the same models separate
    cleanly: 1.34 ms against 2.67-2.69 ms.

    So batch 32 shows the ARCHITECTURE and batch 1 shows one user's wait.
    Neither is what the app delivers, which is int8 ONNX in a browser tab on
    the user's own hardware.
    """
    pts = []
    for m in PARAMS:
        if m in SKIP or (m, "all", "full") not in by:
            continue
        l = lat.get((m, batch))
        if not l:
            continue
        pts.append((m, l["ms_per_image"], by[(m, "all", "full")]["top1"],
                    PARAMS[m]))
    if not pts:
        print("skip bubble: no latency")
        return

    fig, ax = plt.subplots(figsize=(9.6, 6.4))
    fig.subplots_adjust(top=0.80, bottom=0.235, left=0.062, right=0.975)

    # Area proportional to parameters, so a 632M bubble is 16x the area of a
    # 39M one. Encoding size as RADIUS would exaggerate it four-fold.
    smax = 4200.0
    pmax = max(p[3] for p in pts)
    for m, x, y, prm in pts:
        s = smax * (prm / pmax)
        ax.scatter(x, y, s=s, color=color_of(m), edgecolor="white",
                   linewidth=2, zorder=4 if m in MINE else 3,
                   hatch=hatch_of(m), alpha=0.95)
    xs = [p[1] for p in pts]
    # Several models sit within a millisecond of each other. Alternating
    # above/below by index still collides, because two points in one cluster
    # can be close in y as well as x. Decide by POSITION instead: within a
    # cluster the lowest point labels downward and every other labels upward,
    # so the text always moves away from its neighbours.
    span_ratio = max(xs) / min(xs)
    use_log = span_ratio >= 10
    if use_log:
        pos = lambda v: np.log10(v)
        xlo, xhi = pos(min(xs) * 0.62), pos(max(xs) * 1.55)
    else:
        pos = lambda v: v
        xlo, xhi = -max(xs) * 0.05, max(xs) * 1.18
    gap = 0.16 * (xhi - xlo)
    order = sorted(range(len(pts)), key=lambda i: pts[i][1])
    cluster_of, cid, prev_x = {}, 0, None
    for i in order:
        x = pos(pts[i][1])
        if prev_x is not None and abs(x - prev_x) >= gap:
            cid += 1
        cluster_of[i] = cid
        prev_x = x
    lowest = {}
    for i, c in cluster_of.items():
        if c not in lowest or pts[i][2] < pts[lowest[c]][2]:
            lowest[c] = i

    for i in order:
        m, x, y, prm = pts[i]
        mine = m in MINE
        radius_pts = np.sqrt(smax * (prm / pmax) / np.pi)
        siblings = [j for j in cluster_of if cluster_of[j] == cluster_of[i]]
        in_cluster = len(siblings) > 1
        below = lowest[cluster_of[i]] == i and in_cluster
        # A vertical offset alone still crosses a neighbour when two cluster
        # members are close in y. The leftmost member of a cluster has open
        # space to its left, so put its label there and centre the rest.
        leftmost = in_cluster and x == min(pts[j][1] for j in siblings)
        frac = (pos(x) - xlo) / (xhi - xlo)
        if leftmost and frac > 0.06:
            dx, dy = -(radius_pts + 10), 0
            ha, va = "right", "center"
        else:
            dx = 0
            clear = radius_pts + 11
            # A nearby bubble can reach into this label's space even across a
            # cluster boundary, so clear the largest radius among points within
            # a fifth of the axis, not merely our own.
            near = [j for j in range(len(pts))
                    if abs(pos(pts[j][1]) - pos(x)) < 0.20 * (xhi - xlo)]
            if near:
                big = max(np.sqrt(smax * (pts[j][3] / pmax) / np.pi)
                          for j in near)
                clear = max(clear, big + 13)
            dy = -clear if below else clear
            va = "top" if below else "bottom"
            ha = "left" if frac < 0.06 else ("right" if frac > 0.94 else "center")
        ax.annotate(LABEL[m], (x, y), textcoords="offset points",
                    xytext=(dx, dy), ha=ha, va=va, fontsize=10,
                    fontweight="bold" if mine else "normal",
                    color=ACCENT if mine else INK, family=SANS)

    # Scale chosen by SPAN, not by habit. Batch 1 spans 7x (5.9-41.5 ms) and a
    # linear axis reads honestly. Batch 32 spans 24x (1.34-32.9 ms): on a
    # linear axis the four fastest models occupy 3% of the width and collapse
    # into one another, so the chart hides the difference it exists to show.
    # A log axis gives them 22%.
    span_ratio = max(xs) / min(xs)
    use_log = span_ratio >= 10
    if use_log:
        ax.set_xscale("log")
        ax.set_xlim(min(xs) * 0.62, max(xs) * 1.55)
        decades = [1, 2, 5, 10, 20, 50]
        ticks = [t for t in decades
                 if min(xs) * 0.62 <= t <= max(xs) * 1.55]
        ax.set_xticks(ticks)
        ax.xaxis.set_minor_locator(LogLocator(subs=[]))
        ax.xaxis.set_minor_formatter(FuncFormatter(lambda v, p: ""))
    else:
        ax.set_xlim(-max(xs) * 0.05, max(xs) * 1.18)
        tick = 10 if max(xs) > 20 else 5
        ax.set_xticks(np.arange(0, max(xs) * 1.18, tick))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, p: f"{v:g} ms"))
    lo, hi, step = nice_ylim([p[2] for p in pts], 0.42, 0.42, cap=100)
    ax.set_ylim(lo, hi)
    ax.set_yticks(np.arange(lo, hi + 0.01, step))
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, p: f"{v:g}%"))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(NEUTRAL_E)
    ax.tick_params(axis="both", length=0, labelsize=9.5)
    ax.grid(axis="y", color=RULE, linewidth=1, zorder=0)
    ax.set_axisbelow(True)
    ax.set_xlabel("time per photo" + (", batched" if batch > 1 else "")
                  + (" (log scale)" if use_log else ""),
                  fontsize=10, color=MUTED, labelpad=6)

    headline(fig, "WingCLIP-0.3 is the fastest, and beats its own teacher",
             "NABirds top-1 over 11,167 species against latency; "
             "bubble area is model size")
    footnote(fig, f"Forward pass at batch {batch} on an RTX 3080, fp32, "
                  "synthetic batches so no image loading is timed. Left is "
                  "faster, up is more accurate, smaller is lighter.  "
                  + SUPER_NOTE)
    for ext in ("png", "svg"):
        fig.savefig(os.path.join(OUT, f"{fname}.{ext}"), facecolor="white")
    plt.close(fig)
    print("wrote", fname)


if __name__ == "__main__":
    print(f"headline font: {DISPLAY} / body: {SANS}")
    by, lat, geo = bench_by(), lat_by(), geo_gain()

    bar_chart(by, "full", "all",
              "WingCLIP-0.3 ships at 39M parameters and beats BioCLIP-2",
              "Top-1 accuracy, zero-shot over the full 11,167-species taxonomy",
              "headline_full", geo=geo,
              note_extra=("Hatched increment: the shipped WingDex pipeline, "
                          "same model plus the photo's location and month "
                          "(24,615 images with metadata)." if geo else ""))
    bar_chart(by, "nabirds555", "all",
              "Restricted to the 401 species NABirds covers",
              "Top-1 accuracy, zero-shot, same images and same harness",
              "headline_401")
    bar_chart(by, "full", "all",
              "Every bird model finds the species; they disagree on the order",
              "Solid bar is top-1, pale bar is top-5, over 11,167 species",
              "headline_top5", show_top5=True)
    bar_grouped(by, "full", "all",
                "Every bird model finds the species; they disagree on the order",
                "Top-1 and top-5, zero-shot over 11,167 species",
                "headline_top5_grouped")
    bubble(by, lat, "bubble_speed_size", batch=1)
    bubble(by, lat, "bubble_speed_size_b32", batch=32)

    # Matplotlib writes path data with a space before each newline. It is valid
    # SVG but fails `git diff --check` as trailing whitespace. Normalize every
    # generated SVG so rerunning the chart script leaves a clean repository.
    from pathlib import Path
    for svg in Path(OUT).glob("*.svg"):
        normalized = "\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n"
        svg.write_text(normalized)
