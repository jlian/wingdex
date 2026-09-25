# NABirds benchmark: what we measured

Measured 2026-09-02 on one RTX 3080. Every number here came out of one harness
on one copy of the data. Raw output: `bench290_results.json`,
`bench_latency.json`, `bench_eva02.json`, `bench_pipeline_geo.json`. Charts:
`plot_charts.py` (see `CHARTS.md`).

This is a "here is what we measured" document, not a leaderboard claim. We ran
other people's published weights through our own protocol. That is a fair
model-to-model comparison and it is **not** a reproduction of anyone's
published result. Where our protocol differs from theirs, it is stated.

---

## 1. Results, zero-shot open-vocabulary

All 48,527 NABirds images. Each model scored with **its own text tower**;
running a foreign image encoder against someone else's text encoder is not
zero-shot.

### Full taxonomy, 11,167 classes — the shipping configuration

| model | visual params | top-1 | top-5 | top5 − top1 |
|---|---|---|---|---|
| BioCLIP 2.5 | 632.1M | **90.31** | 98.06 | +7.75 |
| **WingCLIP-0.1** | 86.6M | **89.90** | 97.86 | +7.96 |
| **WingCLIP-0.3** (ships) | 38.7M | **86.84** | 96.99 | +10.15 |
| BioCLIP-2 | 304.0M | 86.31 | 97.24 | +10.93 |
| BioCLIP iNat-only | 86.2M | 75.94 | 89.65 | +13.71 |
| BioCLIP (v1) | 86.2M | 70.21 | 90.22 | +20.01 |
| CLIP ViT-L/14 | 304.0M | 32.50 | 61.01 | +28.51 |
| SigLIP B/16 | 92.9M | 26.75 | 51.77 | +25.02 |
| CLIP ViT-B/16 | 86.2M | 25.59 | 50.67 | +25.08 |
| BioTrove-CLIP | 86.2M | 17.98 | 34.34 | +16.36 |

### 401 NABirds species

| model | top-1 | top-5 |
|---|---|---|
| BioCLIP 2.5 | **97.56** | 99.91 |
| **WingCLIP-0.1** | 95.69 | 99.62 |
| BioCLIP-2 | 95.48 | 99.77 |
| **WingCLIP-0.3** (ships) | 94.27 | 99.43 |
| BioCLIP iNat-only | 85.76 | 97.48 |
| BioCLIP (v1) | 80.74 | 96.53 |
| CLIP ViT-L/14 | 60.77 | 92.19 |
| SigLIP B/16 | 54.12 | 85.93 |
| CLIP ViT-B/16 | 51.47 | 84.31 |
| BioTrove-CLIP | 33.28 | 56.60 |

### Supervised, reported separately

`eva02_large_patch14_clip_336.merged2b_ft_inat21` is a fixed 10,000-class
iNat21 head, not open-vocabulary, so it answers an easier question than the
models above and cannot be ranked against them directly.

| arm | classes | n | top-1 | top-5 |
|---|---|---|---|---|
| open10k | 10,000 | 46,580 | 94.60 | 99.44 |
| restricted | 384 | 46,580 | 97.06 | 99.80 |

`config.json` ships `label_names` as scientific names, so the join to our
taxonomy is by name: **384 of 401** NABirds species are in its head (95.8%).
The 17 misses are taxonomic renames postdating iNat21 (`Astur cooperii`,
`Nannopterum auritum`, `Urile pelagicus`, `Leuconotopicus villosus`, ...), and
their 1,947 images are excluded.

**Use the open10k number.** The restricted arm hands the model only the 384
NABirds columns, which is help the zero-shot models do not get.

---

## 2. Speed and size

Batch-1 forward pass, RTX 3080, fp32, synthetic batches so no image loading is
timed. 100 iterations after 20 warmup.

| model | visual params | batch-1 | batch-32 | b1 / b32 |
|---|---|---|---|---|
| **WingCLIP-0.3** | 38.7M | 7.40 ms | **1.34 ms** | 5.5x |
| BioCLIP iNat-only | 86.2M | **5.89 ms** | 2.67 ms | 2.2x |
| BioCLIP (v1) | 86.2M | 7.45 ms | 2.69 ms | 2.8x |
| WingCLIP-0.1 | 86.6M | 7.51 ms | 2.69 ms | 2.8x |
| BioCLIP-2 | 304.0M | 17.45 ms | 11.11 ms | 1.6x |
| BioCLIP 2.5 | 632.1M | 33.11 ms | 23.59 ms | 1.4x |
| EVA02 iNat21 | 313.9M | 41.53 ms | 32.86 ms | 1.3x |

**Report batch 32, not batch 1.** At batch 1 a 38.7M model and three 86M
models land within 1.6 ms of each other, because a single 224px forward pass on
a desktop GPU is largely kernel-launch bound rather than compute bound: the
small models never fill the device, so their advantage does not appear. The
tell is the b1/b32 ratio, which falls monotonically with size, from 5.5x for
the smallest model to 1.3x for the largest. Small models have the most headroom
precisely because batch 1 wastes the most of their capacity.

At batch 32 the ordering matches the architecture: WingCLIP-0.3 at 1.34 ms
against 2.67-2.69 ms for the 86M models and 23.59 ms for BioCLIP 2.5. That is
**2.0x faster than the other small models and 17.6x faster than BioCLIP 2.5**,
for 3.5 points of top-1.

Neither number is what the app delivers. WingDex runs an int8 ONNX tower in a
browser tab on the user's own hardware; these are fp32 PyTorch on an RTX 3080
and are useful for comparing models to each other, not for predicting a phone.

An earlier run at 30 iterations produced 6.56 ms and 10.89 ms for WingCLIP-0.1
on identical hardware. That spread is GPU clock state, not signal. The numbers
above are the 100-iteration re-run.

---

## 3. The shipped pipeline, with location

WingDex does not ship a bare encoder. It ships
`score = sim/T + beta * log P(species | cell, month)` with the constants in
`src/lib/bird-id-local-adapter.ts` and `src/lib/rank.ts`, the v4 occurrence
blob, and Equal Earth cell math. `bench_pipeline_geo.py` parses those
constants out of the TypeScript at runtime rather than retyping them.

Measured on the 24,615 NABirds test images that carry location metadata:

| | top-1 | top-5 |
|---|---|---|
| vision only | 86.90 | 96.93 |
| + location and month | **90.30** | **98.33** |
| gain | **+3.40** | +1.40 |

That takes a 38.7M model to within 0.01 of BioCLIP 2.5's 90.31, using
information the encoder does not have.

**The coordinates are simulated.** NABirds has no GPS. Mac Aodha et al.'s
geo-prior release pairs each image with an eBird observation *of that species*,
so the location was chosen because the species occurs there. That is
circular for our purposes and the number should be read as an upper bound, not
a field measurement. Dates are fraction-of-year floats; 222 rows carry NaN for
lat, lon and date and degrade to vision-only, as the client does.

**The 401-way geo number is not reported.** It comes out at −2.46, because `T`
and `beta` were fitted in the 11,167-species space and restricting the label
space mis-weights the prior. That is a calibration artefact, not a finding.

---

## 4. Protocol, and why these are not the BioCLIP card's numbers

The BioCLIP 2 and 2.5 cards report "555 visual categories of 48,640 images".
That is not the protocol in any table above, for two reasons.

**555 categories are not 555 species.** Their eval file
(`data/annotation/nabirds/metadata.csv` in Imageomics/bioclip-2) holds 555
unique class strings, of which **289 carry sex, age or plumage markers**:
`Allen's Hummingbird (Adult Male)` against `(Female/immature)`,
`American Goldfinch (Breeding Male)` against `(Female/Nonbreeding Male)`,
`Dark-eyed Junco (White-winged)` at 13 images. Collapse the parentheticals and
555 strings become 404 base common names. Our taxonomy maps NABirds to 401
species, which is the same resolution reached independently.

**A taxonomic text tower cannot represent those distinctions.** BioCLIP's text
encoder is trained on taxonomic strings plus common name. "Adult male" is not
taxonomy, so the two Allen's Hummingbird prompts embed to nearly the same
point. Their `zero_shot_iid.py` feeds the raw strings, parentheses included,
through the 80-prompt `openai_imagenet_template` ensemble. Roughly 150
near-unresolvable pairs therefore sit under their published figure as a
built-in error floor.

We use a single prompt, `"a photo of {common}, {scientific}, a species of
bird."`, not the 80-template ensemble, and report top-1/top-5 where they report
top-1/top-3/top-5.

**Do not place our 95.48 beside their published NABirds number.**

### What the label space is worth

BioCLIP-2 on the same 48,527 images: **95.48** over 401 species, **86.31** over
11,167. The image split is worth almost nothing by comparison (86.40 on the
24,615-image test split against 86.31 on all images). Any comparison that does
not state the label space is meaningless, and the image count, which is the
number model cards usually quote, barely matters.

---

## 5. Reading the top-5 column

The four leading bird models sit within **1.1 points on top-5** while spanning
**4 points on top-1**. They are all finding the right species; they disagree
about how to order the shortlist. That is the premise WingDex is built on: the
app reranks a 25-candidate shortlist with the geographic prior, which only
works because the answer is reliably in the shortlist.

The **top5 − top1 gap is a usable proxy for calibration**. BioCLIP 2.5 is
tightest at +7.75; WingCLIP-0.3 sits at +10.15; general-purpose CLIP and SigLIP
run +25 to +33.

---

## 6. Caveats worth stating before anyone else does

**BioTrove-CLIP at 17.98 is probably our fault.** It is far enough below every
other bird-trained model that a prompt-format or preprocessing mismatch in our
harness is the likelier explanation. Reported for completeness, excluded from
the charts, flagged here rather than quietly dropped.

**Generic CLIP was initially understated.** open_clip warns "QuickGELU mismatch
... pretrained tag 'openai' (quick_gelu=True)" and then builds the wrong
activation. ViT-B/16 read 44.88 before the fix and 51.47 after. The stale rows
were removed from the results file; the backup is `.json.bak`.

**Supervised bird models are out of scope.** The birder-project family,
`Bird-Species-Classifier-526` and similar are fixed-head models over their own
label sets, and several were trained on NABirds subsets, so scoring them on
NABirds test would measure memorisation. Published supervised numbers for
context: Token Injection Transformer 93.2, DBMFNet 92.4.

**We could not run the TinyCLIP base.** WingCLIP-0.3 is distilled from
`vit_medium_patch16_clip_224.tinyclip_yfcc15m`, and a before/after on the same
weights would be the most informative row in this document. timm ships only the
visual tower, and the original `wkcn/TinyCLIP-ViT-39M-16-Text-19M-YFCC15M` has
no `open_clip_config.json`, so open_clip cannot load it. Zero-shot needs the
text side. Open.

**35 images** referenced by NABirds metadata are absent from the Cornell
webdataset shards, so 48,527 of 48,562 resolve.

---

## 7. Reproducing

```bash
cd ml/distill
# zero-shot, any open_clip or hf-hub model
python3 bench_nabirds_multi.py --images ~/nabirds_flat \
    --model hf-hub:imageomics/bioclip-2 --tag bioclip-2 \
    --split all --labels full
# built-in architectures need --pretrained separately
python3 bench_nabirds_multi.py --images ~/nabirds_flat \
    --model ViT-B-16-quickgelu --pretrained openai --tag clip-vit-b16 \
    --split all --labels full
# our checkpoints
python3 bench_nabirds_multi.py --images ~/nabirds_flat \
    --checkpoint runs/ft_tiny39_fresh/wise_a0.60.pt --split all --labels full
# supervised iNat21 arm
python3 bench_eva02_inat.py --images ~/nabirds_flat
# latency
python3 bench_latency.py --device cuda --batch 32 --iters 100 --warmup 20 \
    --checkpoints runs/ft_tiny39_fresh/wise_a0.60.pt
# shipped pipeline with location
python3 bench_pipeline_geo.py --images ~/nabirds_flat \
    --geo-json ~/geoprior/geo_prior_data/data/nabirds/nabirds_with_loc_2019.json
# charts
python3 plot_charts.py
```

Images come from the Cornell NABirds webdataset shards on the NAS
(`WingDex-Distill/datasets/eval-nabirds-cornell`), unpacked flat. Geo metadata
is `nabirds_with_loc_2019.json` from the Mac Aodha et al. geo-prior release
(`data.caltech.edu/records/s2fbb-qb406`, 22.3 GB).

---

## 8. A correction to the record

`ml/distill/occ_port_v4.py` exists because the older `Occ` class in
`eval_prior_shortlist.py` computes `payload_start = idx_start + (n_cells+1)*8`.
A v4 blob inserts an `n_cells * 4` totals table between the index and the
payload, so that offset lands mid-table and decodes garbage. It also has no
pooled or totals accessor, so the shipped Dirichlet-multinomial backoff cannot
be reproduced with it at all. The new port mirrors `parseOccurrence` /
`findSlot` / `decodeSlot` / `occCell` / `occCellPooled` / `occTotal` exactly and
was verified: per-cell-month probabilities sum to 0.998-1.013 across Seattle,
Guatemala City and Miami.

## 9. Prior art

The score WingDex ships,
`sim/T + beta * log P(species | cell, month)`, is the same idea as
Mac Aodha, Cole and Perona, *Presence-Only Geographical Priors for Fine-Grained
Image Classification* (ICCV 2019), arrived at independently and implemented
differently: they train a neural spatio-temporal prior with a presence-only
loss that also models photographer bias, while WingDex uses a precomputed
discrete lookup over Equal Earth cells with Dirichlet-multinomial backoff. The
paper deserves the citation either way, and its NABirds geo metadata is what
section 3 is measured on.
