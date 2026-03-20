#!/usr/bin/env python3
"""
Build per-cell range-prior blobs from BirdLife BOTW GeoPackage.

Rasterizes BirdLife species distribution polygons onto a 27km Equal Earth
grid and produces compact binary blobs for each grid cell. These blobs are
uploaded to Cloudflare R2 and queried at runtime to adjust bird-ID confidence
based on location and season.

Requirements (install into a venv):
    pip install fiona shapely pyproj numpy rasterio

Usage:
    python scripts/build-range-priors.py

    Output goes to tmp/range-priors/cells/
    Upload to local R2: node scripts/upload-range-priors-local.mjs

Blob format (per cell):
    Repeated records, no header, no separators:
      [8-byte ASCII species code (right-padded with spaces)]
      [12 x uint8 monthly occurrence (0-255, maps to 0.0-1.0)]
    Total: 20 bytes per species per cell.

Grid reference:
    CRS: EPSG:8857 (Equal Earth)
    Origin: (-17226000, 8343000) (top-left)
    Cell size: 27000m x 27000m
    Grid dims: 1276 cols x 618 rows
    R2 key: range-priors/{row}-{col}.bin.gz
"""

import gzip
import json
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np

WORKSPACE = Path(__file__).resolve().parent.parent
GPKG_PATH = WORKSPACE / "tmp" / "birdlife-shp" / "BOTW_2025.gpkg"
OUTPUT_DIR = WORKSPACE / "tmp" / "range-priors" / "cells"
MANIFEST_PATH = WORKSPACE / "tmp" / "range-priors" / "manifest.json"
SCRATCH_DIR = WORKSPACE / "tmp" / "range-priors" / "scratch"

# Grid constants (EPSG:8857 Equal Earth, matching the runtime module)
GRID_COLS = 1276
GRID_ROWS = 618
ORIGIN_X = -17226000.0
ORIGIN_Y = 8343000.0
CELL_SIZE = 27000.0

# BirdLife presence value: binary "species is here" encoded as uint8.
# 128/255 ~ 0.50 occurrence, well above FULL_TRUST_AT (0.10) so no penalty.
PRESENCE_VALUE = 128

# BirdLife seasonal codes -> months (0-indexed)
# 1=Resident (year-round), 2=Breeding, 3=Non-breeding, 4=Passage
SEASONAL_MONTHS = {
    1: list(range(12)),           # Resident: all months
    2: [3, 4, 5, 6, 7],          # Breeding: Apr-Aug
    3: [9, 10, 11, 0, 1],        # Non-breeding: Oct-Feb
    4: [2, 3, 8, 9],             # Passage: Mar-Apr + Sep-Oct
}


def load_taxonomy():
    """Build a map of scientific_name (lowercase) -> ebird_code."""
    taxonomy_path = WORKSPACE / "src" / "lib" / "taxonomy.json"
    raw = json.loads(taxonomy_path.read_text())
    sci_to_code = {}
    for entry in raw:
        sci = entry[1].lower() if len(entry) > 1 else None
        code = entry[2] if len(entry) > 2 and entry[2] else None
        if sci and code:
            sci_to_code[sci] = code
    return sci_to_code


def main():
    import fiona
    from pyproj import Transformer
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds
    from shapely.geometry import shape
    from shapely.ops import transform as shapely_transform

    if not GPKG_PATH.exists():
        print(f"BirdLife GeoPackage not found at {GPKG_PATH}")
        print("Download from https://datazone.birdlife.org/contact-us/request-our-data")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    sci_to_code = load_taxonomy()
    print(f"Taxonomy: {len(sci_to_code)} species with eBird codes")

    # Transformer from WGS84 to Equal Earth for polygon reprojection
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:8857", always_xy=True)

    # Rasterio transform for the target grid (EPSG:8857)
    grid_transform = from_bounds(
        ORIGIN_X, ORIGIN_Y - GRID_ROWS * CELL_SIZE,  # left, bottom
        ORIGIN_X + GRID_COLS * CELL_SIZE, ORIGIN_Y,   # right, top
        GRID_COLS, GRID_ROWS,
    )

    # Phase 1: Read GPKG and group polygons by (species_code, seasonal)
    print(f"Reading {GPKG_PATH.name}...")
    t0 = time.time()

    # species_polys: {code: [(projected_geom, seasonal), ...]}
    species_polys: dict[str, list] = {}
    matched = 0
    unmatched = 0
    skipped = 0

    with fiona.open(GPKG_PATH, layer="all_species") as src:
        total = len(src)
        for i, feat in enumerate(src):
            props = feat["properties"]

            if props.get("presence", 0) not in (1, 2):
                skipped += 1
                continue
            if props.get("origin", 0) not in (1, 2):
                skipped += 1
                continue

            sci_name = (props.get("sci_name") or "").lower().strip()
            code = sci_to_code.get(sci_name)
            if not code:
                unmatched += 1
                continue

            seasonal = props.get("seasonal", 1)
            geom = shape(feat["geometry"])
            if geom.is_empty:
                continue

            try:
                proj_geom = shapely_transform(transformer.transform, geom)
            except Exception:
                continue

            species_polys.setdefault(code, []).append((proj_geom, seasonal))
            matched += 1

            if (i + 1) % 2000 == 0:
                print(f"  Read {i+1}/{total} features, {len(species_polys)} species...")

    elapsed = time.time() - t0
    print(f"Read {total} features in {elapsed:.0f}s")
    print(f"  Matched: {matched}, Unmatched: {unmatched}, Skipped: {skipped}")
    print(f"  Unique species: {len(species_polys)}")

    # Phase 2: Rasterize each species and append records to per-cell scratch files.
    # This avoids holding all cell data in memory (which can exceed 50 GB).
    print(f"\nRasterizing {len(species_polys)} species (streaming to disk)...")
    t1 = time.time()

    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    # Clean scratch dir from any previous run
    for old in SCRATCH_DIR.iterdir():
        old.unlink()

    cells_touched: set[tuple[int, int]] = set()
    processed = 0

    for code, polys in species_polys.items():
        padded_code = code.ljust(8)[:8].encode("ascii")

        # Group polygons by seasonal type and rasterize each season
        by_season: dict[int, list] = {}
        for proj_geom, seasonal in polys:
            by_season.setdefault(seasonal, []).append(proj_geom)

        # Build a per-species 12-month accumulator only for the cells this species touches.
        # Key = (row, col), value = bytearray(12)
        species_cells: dict[tuple[int, int], bytearray] = {}

        for seasonal, geoms in by_season.items():
            months = SEASONAL_MONTHS.get(seasonal, SEASONAL_MONTHS[1])

            shapes = [(g, 1) for g in geoms]
            try:
                mask = rasterize(
                    shapes,
                    out_shape=(GRID_ROWS, GRID_COLS),
                    transform=grid_transform,
                    fill=0,
                    dtype=np.uint8,
                    all_touched=False,
                )
            except Exception:
                continue

            rows, cols = np.where(mask == 1)
            for r, c in zip(rows.tolist(), cols.tolist()):
                key = (r, c)
                if key not in species_cells:
                    species_cells[key] = bytearray(12)
                for m in months:
                    species_cells[key][m] = max(species_cells[key][m], PRESENCE_VALUE)

        # Append this species' 20-byte records to per-cell scratch files
        for (r, c), monthly in species_cells.items():
            cells_touched.add((r, c))
            scratch_path = SCRATCH_DIR / f"{r}-{c}.bin"
            with open(scratch_path, "ab") as f:
                f.write(padded_code + bytes(monthly))

        processed += 1
        if processed % 500 == 0:
            elapsed = time.time() - t1
            print(f"  {processed}/{len(species_polys)} species rasterized, {len(cells_touched)} cells, {elapsed:.0f}s")

    elapsed = time.time() - t1
    print(f"Rasterized {processed} species in {elapsed:.0f}s")
    print(f"Grid cells with data: {len(cells_touched)}")

    # Phase 3: Compress scratch files into final gzipped blobs
    print(f"\nWriting cell blobs to {OUTPUT_DIR}/...")
    total_bytes = 0
    cells_written = 0

    for (r, c) in sorted(cells_touched):
        scratch_path = SCRATCH_DIR / f"{r}-{c}.bin"
        raw = scratch_path.read_bytes()
        blob = gzip.compress(raw, compresslevel=6)
        out_path = OUTPUT_DIR / f"{r}-{c}.bin.gz"
        out_path.write_bytes(blob)
        total_bytes += len(blob)
        cells_written += 1
        scratch_path.unlink()  # Free disk space as we go

    print(f"Total output: {total_bytes / 1024 / 1024:.1f} MB in {cells_written:,} files")

    # Write manifest
    manifest = {
        "source": "BirdLife BOTW 2025",
        "crs": "EPSG:8857",
        "originX": ORIGIN_X,
        "originY": ORIGIN_Y,
        "cellSize": CELL_SIZE,
        "gridCols": GRID_COLS,
        "gridRows": GRID_ROWS,
        "totalCells": cells_written,
        "speciesCount": processed,
        "matchedPolygons": matched,
        "unmatchedPolygons": unmatched,
        "recordSize": 20,
        "presenceValue": PRESENCE_VALUE,
        "format": "8-byte code + 12x uint8 monthly occurrence",
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Manifest: {MANIFEST_PATH}")
    print(f"\nUpload to local R2: node scripts/upload-range-priors-local.mjs")


if __name__ == "__main__":
    main()
