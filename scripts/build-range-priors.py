#!/usr/bin/env python3
"""
Build per-cell range-prior blobs from BirdLife BOTW GeoPackage.

Rasterizes BirdLife species distribution polygons onto a 27 km Equal Earth
grid and produces compact binary blobs for each grid cell. These blobs are
uploaded to Cloudflare R2 and queried at runtime to adjust bird-ID confidence
based on whether a species is known to occur at a given location.

Requirements (install into a venv):
    pip install fiona shapely pyproj numpy rasterio

Usage:
    python scripts/build-range-priors.py

    Output goes to .tmp/range-priors/cells/
    Upload to local R2: node scripts/upload-range-priors-local.mjs

Blob format (per cell):
    Repeated records, no header, no separators:
      [8-byte ASCII species code (right-padded with spaces)]
      [1 byte  presence   -- best (lowest) across all polygons hitting this cell]
      [1 byte  origin     -- bitmask, bit N-1 for each origin code present]
      [1 byte  seasonal   -- bitmask, bit N-1 for each seasonal code present]
    Total: 11 bytes per species per cell.

    BirdLife attribute codes stored verbatim (see data-attributes.md):
      Presence: 1=Extant, 3=Possibly Extant, 4=Possibly Extinct,
                6=Presence Uncertain (only 5=Extinct excluded at build time)
      Origin:   1=Native, 2=Reintroduced, 3=Introduced, 4=Vagrant,
                5=Origin Uncertain, 6=Assisted Colonisation
      Seasonal: 1=Resident, 2=Breeding, 3=Non-breeding, 4=Passage,
                5=Seasonal Occurrence Uncertain

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
import sys
import time
from pathlib import Path

import numpy as np

WORKSPACE = Path(__file__).resolve().parent.parent
GPKG_PATH = WORKSPACE / ".tmp" / "birdlife-shp" / "BOTW_2025.gpkg"
OUTPUT_DIR = WORKSPACE / ".tmp" / "range-priors" / "cells"
MANIFEST_PATH = WORKSPACE / ".tmp" / "range-priors" / "manifest.json"

# Grid constants (EPSG:8857 Equal Earth, matching the runtime module)
GRID_COLS = 1276
GRID_ROWS = 618
ORIGIN_X = -17226000.0
ORIGIN_Y = 8343000.0
CELL_SIZE = 27000.0


def load_taxonomy():
    """Build a map of scientific_name (lowercase) -> ebird_code.

    Uses eBird taxonomy as the primary source, then layers on a crosswalk
    from AviList (via build-birdlife-crosswalk.py) to recover BirdLife-only
    names that map to eBird codes via protonym matching.
    """
    taxonomy_path = WORKSPACE / "src" / "lib" / "taxonomy.json"
    crosswalk_path = WORKSPACE / ".tmp" / "birdlife-shp" / "birdlife-crosswalk.json"

    raw = json.loads(taxonomy_path.read_text())
    sci_to_code = {}
    for entry in raw:
        sci = entry[1].lower() if len(entry) > 1 else None
        code = entry[2] if len(entry) > 2 and entry[2] else None
        if sci and code:
            sci_to_code[sci] = code

    # Layer on crosswalk for BirdLife-only names (don't overwrite eBird entries)
    if crosswalk_path.exists():
        crosswalk = json.loads(crosswalk_path.read_text())
        added = 0
        for sci, code in crosswalk.items():
            if sci not in sci_to_code:
                sci_to_code[sci] = code
                added += 1
        print(f"Crosswalk: added {added} BirdLife-to-eBird mappings")
    else:
        print("Warning: no crosswalk found, run scripts/build-birdlife-crosswalk.py first")

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

    # Grid extent in EPSG:8857
    grid_left = ORIGIN_X
    grid_top = ORIGIN_Y
    grid_right = ORIGIN_X + GRID_COLS * CELL_SIZE
    grid_bottom = ORIGIN_Y - GRID_ROWS * CELL_SIZE

    # Single-pass streaming: read each feature, project, rasterize immediately,
    # accumulate only the compact cell records in memory (~300 MB).
    # Geometries are discarded after each feature - no 24 GB memory spike.
    print(f"Reading and rasterizing {GPKG_PATH.name}...")
    t0 = time.time()

    # Per-cell per-species accumulator: {(row,col): {code: [min_presence, origin_mask, seasonal_mask]}}
    cell_species: dict[tuple[int, int], dict[str, list]] = {}
    species_seen: set[str] = set()
    matched = 0
    unmatched = 0
    skipped = 0

    with fiona.open(GPKG_PATH, layer="all_species") as src:
        total = len(src)
        for i, feat in enumerate(src):
            props = feat["properties"]

            presence = props.get("presence", 0)
            if presence == 5:
                skipped += 1
                continue

            origin = props.get("origin", 0)
            if origin < 1 or origin > 6:
                skipped += 1
                continue

            seasonal = props.get("seasonal", 0)
            if seasonal < 1 or seasonal > 5:
                skipped += 1
                continue

            sci_name = (props.get("sci_name") or "").lower().strip()
            code = sci_to_code.get(sci_name)
            if not code:
                unmatched += 1
                continue

            geom = shape(feat["geometry"])
            if geom.is_empty:
                continue

            try:
                proj_geom = shapely_transform(transformer.transform, geom)
            except Exception:
                continue

            # Rasterize this single feature immediately using bounding-box sub-grid
            b = proj_geom.bounds  # (minx, miny, maxx, maxy)
            minx = max(b[0], grid_left)
            miny = max(b[1], grid_bottom)
            maxx = min(b[2], grid_right)
            maxy = min(b[3], grid_top)

            if minx >= maxx or miny >= maxy:
                matched += 1
                species_seen.add(code)
                continue

            col_lo = max(0, int((minx - grid_left) / CELL_SIZE))
            col_hi = min(GRID_COLS, int((maxx - grid_left) / CELL_SIZE) + 1)
            row_lo = max(0, int((grid_top - maxy) / CELL_SIZE))
            row_hi = min(GRID_ROWS, int((grid_top - miny) / CELL_SIZE) + 1)

            sub_cols = col_hi - col_lo
            sub_rows = row_hi - row_lo
            if sub_cols <= 0 or sub_rows <= 0:
                matched += 1
                species_seen.add(code)
                continue

            sub_left = grid_left + col_lo * CELL_SIZE
            sub_top = grid_top - row_lo * CELL_SIZE
            sub_transform = from_bounds(
                sub_left, sub_top - sub_rows * CELL_SIZE,
                sub_left + sub_cols * CELL_SIZE, sub_top,
                sub_cols, sub_rows,
            )

            try:
                mask = rasterize(
                    [(proj_geom, 1)],
                    out_shape=(sub_rows, sub_cols),
                    transform=sub_transform,
                    fill=0,
                    dtype=np.uint8,
                    all_touched=False,
                )
            except Exception:
                matched += 1
                species_seen.add(code)
                continue

            origin_bit = 1 << (origin - 1)
            seasonal_bit = 1 << (seasonal - 1)

            rows, cols = np.where(mask == 1)
            for r, c in zip(rows.tolist(), cols.tolist()):
                rc = (r + row_lo, c + col_lo)
                cell_dict = cell_species.get(rc)
                if cell_dict is None:
                    cell_dict = {}
                    cell_species[rc] = cell_dict
                prev = cell_dict.get(code)
                if prev is None:
                    cell_dict[code] = [presence, origin_bit, seasonal_bit]
                else:
                    prev[0] = min(prev[0], presence)
                    prev[1] |= origin_bit
                    prev[2] |= seasonal_bit

            matched += 1
            species_seen.add(code)

            if (i + 1) % 500 == 0:
                elapsed = time.time() - t0
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (total - i - 1) / rate if rate > 0 else 0
                print(f"  {i+1}/{total} features, {len(species_seen)} species, {len(cell_species)} cells, {elapsed:.0f}s ({rate:.1f} feat/s, ~{eta/60:.0f}m left)")

    elapsed = time.time() - t0
    print(f"Processed {total} features in {elapsed:.0f}s")
    print(f"  Matched: {matched}, Unmatched: {unmatched}, Skipped: {skipped}")
    print(f"  Unique species: {len(species_seen)}, Grid cells: {len(cell_species)}")

    # Phase 2: Serialize cell dicts into gzipped blobs
    print(f"\nWriting cell blobs to {OUTPUT_DIR}/...")
    t1 = time.time()
    total_bytes = 0
    cells_written = 0

    for (r, c) in sorted(cell_species):
        parts = []
        for code, (pres, omask, smask) in cell_species[(r, c)].items():
            parts.append(code.ljust(8)[:8].encode("ascii") + bytes([pres, omask, smask]))
        raw = b"".join(parts)
        blob = gzip.compress(raw, compresslevel=6)
        out_path = OUTPUT_DIR / f"{r}-{c}.bin.gz"
        out_path.write_bytes(blob)
        total_bytes += len(blob)
        cells_written += 1

    elapsed = time.time() - t1
    print(f"Wrote {cells_written:,} files ({total_bytes / 1024 / 1024:.1f} MB) in {elapsed:.0f}s")
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
        "speciesCount": len(species_seen),
        "matchedPolygons": matched,
        "unmatchedPolygons": unmatched,
        "recordSize": 11,
        "format": "8-byte code + uint8 presence + uint8 origin_mask + uint8 seasonal_mask",
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Manifest: {MANIFEST_PATH}")
    print(f"\nUpload to local R2: node scripts/upload-range-priors-local.mjs")


if __name__ == "__main__":
    main()
