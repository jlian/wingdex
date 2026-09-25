#!/usr/bin/env python3
"""Faithful Python port of src/lib/occurrence.ts, v4-aware.

WHY THIS EXISTS RATHER THAN REUSING eval_prior_shortlist.Occ
------------------------------------------------------------
That class predates the v4 blob and is WRONG for one:

  payload_start = idx_start + (n_cells + 1) * 8

v4 inserts an n_cells * 4 totals table between the index and the payload
(occurrence.ts: totalsStart = idxStart + (nCells+1)*8, then
payloadStart = totalsStart + totalsBytes). Reading a v4 blob with the old
offset lands mid-table and decodes garbage varints. It also has no
cell_pooled / total, so the shipped Dirichlet-multinomial backoff cannot be
reproduced with it at all.

This port mirrors parseOccurrence / findSlot / decodeSlot / occCell /
occCellPooled / occTotal exactly, so offline numbers correspond to what the
app actually computes.
"""
import gzip
import struct

import numpy as np

OCC_SCALE = 2.5
MONTH_BITS = 4
POOLED_MONTH_CODE = 12
GRID_COLS = 1276


class OccV4:
    def __init__(self, path):
        with gzip.open(path, "rb") as fh:
            raw = fh.read()
        if raw[0:4].decode("ascii", "replace") != "WDOP":
            raise SystemExit("bad magic in " + path)
        self.raw = raw
        self.version = raw[4]
        self.qbits = raw[5]
        hash_len = 8 if self.version >= 2 else 0
        self.n_cells = struct.unpack_from("<I", raw, 8 + hash_len)[0]
        self.idx_start = 12 + hash_len
        self.totals_start = self.idx_start + (self.n_cells + 1) * 8
        totals_bytes = self.n_cells * 4 if self.version >= 4 else 0
        self.payload_start = self.totals_start + totals_bytes

        n = self.n_cells + 1
        arr = np.frombuffer(raw, dtype="<u4", count=2 * n, offset=self.idx_start)
        self.keys = arr[0::2][:self.n_cells]
        self.offs = arr[1::2]
        if self.version >= 4:
            self.totals = np.frombuffer(raw, dtype="<u4", count=self.n_cells,
                                        offset=self.totals_start)
        else:
            self.totals = None

    def _slot(self, key):
        i = np.searchsorted(self.keys, key)
        if i >= len(self.keys) or self.keys[i] != key:
            return -1
        return int(i)

    def _decode(self, slot):
        start = self.payload_start + int(self.offs[slot])
        end = self.payload_start + int(self.offs[slot + 1])
        buf = self.raw[start:end]
        out = {}
        p = sp = 0
        while p < len(buf):
            shift = d = 0
            while True:
                b = buf[p]; p += 1
                d |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            sp += d
            shift = q = 0
            while True:
                b = buf[p]; p += 1
                q |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            out[sp] = -(q / OCC_SCALE)
        return out

    def cell(self, row, col, month):
        if self.version >= 3:
            if month is None or not (1 <= month <= 12):
                return None
            key = ((row * GRID_COLS + col) << MONTH_BITS) | (month - 1)
        else:
            key = row * GRID_COLS + col
        s = self._slot(key)
        return None if s < 0 else self._decode(s)

    def cell_pooled(self, row, col):
        if self.version < 4:
            return None
        key = ((row * GRID_COLS + col) << MONTH_BITS) | POOLED_MONTH_CODE
        s = self._slot(key)
        return None if s < 0 else self._decode(s)

    def total(self, row, col, month=None):
        if self.version < 4:
            return None
        cell = row * GRID_COLS + col
        if month is None:
            key = (cell << MONTH_BITS) | POOLED_MONTH_CODE
        else:
            if not (1 <= month <= 12):
                return None
            key = (cell << MONTH_BITS) | (month - 1)
        s = self._slot(key)
        return None if s < 0 else int(self.totals[s])
