# Charts: how to regenerate and tweak

All chart code is **`ml/distill/plot_charts.py`**. Run it from that directory:

```bash
cd ml/distill
python3 plot_charts.py
```

Writes PNG + SVG into `ml/distill/charts/`. No arguments, no config file: it
reads the result JSONs sitting beside it and rewrites every chart.

## Inputs

| file | produced by | holds |
|---|---|---|
| `bench290_results.json` | `bench_nabirds_multi.py` | zero-shot top-1/top-5 per model, split, label space |
| `bench_latency.json` | `bench_latency.py` | ms/image at batch 1 and 32 |
| `bench_eva02.json` | `bench_eva02_inat.py` | the supervised iNat21 arm |
| `bench_pipeline_geo.json` | `bench_pipeline_geo.py` | the shipped pipeline's geo-prior gain |

A missing file degrades gracefully: the chart that needs it is skipped, the
rest still render.

## Chart list

| file | what it shows |
|---|---|
| `headline_full` | top-1 over 11,167 species, with the geo increment hatched on WingCLIP-0.3 |
| `headline_401` | top-1 over the 401 NABirds species |
| `headline_top5` | top-1 solid, top-5 as a ghost behind it: visible remainder is the spread |
| `headline_top5_grouped` | top-1 and top-5 as adjacent bars: the two numbers, equal weight |
| `bubble_speed_size` | accuracy vs batch-1 latency, bubble area = params |
| `bubble_speed_size_b32` | same at batch 32, the one to publish |

`headline_top5` and `headline_top5_grouped` are two encodings of one pair.
The overlay makes the SPREAD the visible object, which is the better picture of
"how far down the shortlist the answer sat". The grouped bars make the two
numbers directly comparable across models. Pick one for the post; shipping
both would be repetition.

## The knobs you will actually want

Everything below is a module-level constant near the top of the file.

**Accuracy axis, shared by every chart.** One range so charts can be compared
by eye:
```python
Y_MIN, Y_MAX, Y_STEP = 60, 100, 5
```

**Colours.**
```python
ACCENT    = "#1f6f5c"   # WingCLIP-0.3, the shipped model
ACCENT_LT = "#57a08b"   # WingCLIP-0.1
GEO       = "#8fc4b2"   # the hatched geo-prior increment
NEUTRAL   = "#d7d5d0"   # every other model
SUPER     = "#c9c6bf"   # supervised (hatched)
```

**Which models appear.** `SKIP` removes a model from every chart while leaving
it in the results file:
```python
SKIP = ("biotrove-clip", "clip-vit-b16", "clip-vit-l14", "siglip-b16")
```
`MINE` decides who gets the accent colour, `SUPERVISED` decides who gets
hatched, `LABEL` sets display names, `PARAMS` sets bubble areas.

**Headlines and decks** are the last block in the file, in `__main__`. The
headline states the finding; the deck says what is measured.

**Fonts.** Inter, installed with `sudo apt install fonts-inter`. If it is
absent the file falls back to Roboto, then Liberation Sans, then DejaVu, so it
still runs on a clean machine. Headlines use Inter Display.

## Adding a model

1. Score it: `python3 bench_nabirds_multi.py --model <hf-hub-id> --tag <name> --split all --labels full` (and again with `--labels nabirds555`).
2. Time it: add it to `MODELS` in `bench_latency.py`, rerun.
3. In `plot_charts.py` add `<name>` to `PARAMS` and `LABEL`.
4. `python3 plot_charts.py`.

## Notes on the choices, so they are not undone by accident

- **Bubble-chart x scale is chosen by span, not by habit.** `bubble()` goes
  logarithmic when max/min latency is 10x or more, linear below that. Batch 1
  spans 7x (5.9-41.5 ms) and reads honestly on a linear axis. Batch 32 spans
  24x (1.34-32.9 ms), and on a linear axis the four fastest models occupy 3% of
  the width and collapse into each other; a log axis gives them 22%. The rule
  is the same one that made the batch-1 chart linear: pick the scale that shows
  the gap the chart exists to show.
- **Two bubble charts, batch 1 and batch 32.** `bubble_speed_size` is the
  interactive case; `bubble_speed_size_b32` is the one to publish. At batch 1 a
  single 224px pass on a desktop GPU is largely kernel-launch bound, so a 38.7M
  model and three 86M models land within 1.6 ms and the picture says nothing
  about size. Batch 32 saturates the device and the models separate cleanly.
- **Bubble area, not radius, encodes parameters.** Radius would exaggerate a
  16x size difference into a 4x-too-large picture.
- **`svg.fonttype = "none"`** keeps real `<text>` in the SVG: editable,
  searchable, sharp at any zoom, and about 7x smaller. It does mean the viewer
  needs Inter, which is the right trade for a self-hosted post.
- **Bubble labels are model names only.** Accuracy is already the y position
  and size is already the area.
- **The 401-way geo number is deliberately not plotted.** `T` and `beta` were
  fitted in the 11,167-species space, so restricting the label space
  mis-weights the prior and the "gain" comes out negative. That is a
  calibration artefact, not a result.
