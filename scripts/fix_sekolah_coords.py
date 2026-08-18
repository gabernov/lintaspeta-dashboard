#!/usr/bin/env python3
"""Fix sekolah rows with coordinates outside Jawa Barat.

700 rows in sekolah_merged.parquet have lat=0/lon=0 (or out-of-bounds). All of
them have a valid KABUPATEN. We assign each such row the centroid of its
kabupaten (computed from the valid rows) so the schools are placed inside
Jawa Barat, then update both LINTANG/BUJUR and the geometry WKB column, and
reseed the Supabase draft table.

Usage:
    python scripts/fix_sekolah_coords.py --portal <portal-repo-path> [--dry-run]
"""

import argparse
import os
import shutil
import struct
import sys
from datetime import datetime
from collections import defaultdict

import pyarrow as pa
import pyarrow.parquet as pq

WJB = (105.0, 109.5, -8.0, -5.0)
FALLBACK = (107.6, -6.9)  # Jawa Barat center


def wkb_point(lon, lat, srid=4326):
    """Build an EWKB Point with SRID (little-endian), matching the parquet convention."""
    b = bytearray()
    b += struct.pack("<B", 1)                      # byte order: little
    b += struct.pack("<I", 0x20000001)             # SRID flag + Point
    b += struct.pack("<I", srid)                   # SRID
    b += struct.pack("<d", float(lon))
    b += struct.pack("<d", float(lat))
    return bytes(b)


def inside(lon, lat):
    return (
        lon is not None
        and lat is not None
        and WJB[0] <= lon <= WJB[1]
        and WJB[2] <= lat <= WJB[3]
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True, help="path to lintaspeta-web repo")
    ap.add_argument("--dry-run", action="store_true", help="report only, do not write")
    args = ap.parse_args()

    rel = "maps/sekolah/data/sekolah_merged.parquet"
    path = os.path.join(args.portal, rel)
    if not os.path.exists(path):
        print(f"missing {path}", file=sys.stderr)
        sys.exit(1)

    t = pq.read_table(path)
    names = t.column_names
    lat_col = "LINTANG"
    lon_col = "BUJUR"
    kab_col = "KABUPATEN"
    geom_col = next((c for c in names if c in ("geometry", "geom", "wkb_geometry")), None)
    if not geom_col:
        print("no geometry column found", file=sys.stderr)
        sys.exit(1)

    lat = t.column(lat_col).to_pylist()
    lon = t.column(lon_col).to_pylist()
    kab = t.column(kab_col).to_pylist()
    geom = t.column(geom_col).to_pylist()

    # centroids from valid rows
    centroids = defaultdict(lambda: [0.0, 0.0, 0])
    for i in range(t.num_rows):
        if inside(lon[i], lat[i]):
            k = str(kab[i])
            centroids[k][0] += lon[i]
            centroids[k][1] += lat[i]
            centroids[k][2] += 1
    centroid_of = {
        k: (c[0] / c[2], c[1] / c[2]) for k, c in centroids.items() if c[2] > 0
    }
    print(f"kabupaten centroids: {len(centroid_of)}")

    new_lat = list(lat)
    new_lon = list(lon)
    new_geom = list(geom)
    fixed = 0
    for i in range(t.num_rows):
        if inside(lon[i], lat[i]):
            continue
        k = str(kab[i])
        clon, clat = centroid_of.get(k, FALLBACK)
        new_lon[i] = clon
        new_lat[i] = clat
        new_geom[i] = wkb_point(clon, clat)
        fixed += 1
        if fixed <= 5 or args.dry_run:
            print(f"  fix idx={i} kab={k!r} ({lon[i]},{lat[i]}) -> ({clon:.5f},{clat:.5f})")

    print(f"\nrows fixed: {fixed} / {t.num_rows}")
    if args.dry_run:
        print("dry-run: not writing")
        return

    # archive current parquet
    date = datetime.now().strftime("%Y-%m-%d")
    base_dir = os.path.join(os.path.dirname(__file__), "..", "archive", "sekolah_merged")
    os.makedirs(base_dir, exist_ok=True)
    existing = [d for d in os.listdir(base_dir) if d.startswith("release-")]
    n = len(existing) + 1
    dest_dir = os.path.join(base_dir, f"release-{n}_{date}")
    os.makedirs(dest_dir, exist_ok=True)
    shutil.copy2(path, os.path.join(dest_dir, os.path.basename(rel)))
    print(f"archived -> {os.path.join(dest_dir, os.path.basename(rel))}")

    # write updated columns
    arrays = []
    new_names = []
    for c in names:
        if c == lat_col:
            arrays.append(pa.array(new_lat, type=t.schema.field(lat_col).type))
            new_names.append(c)
        elif c == lon_col:
            arrays.append(pa.array(new_lon, type=t.schema.field(lon_col).type))
            new_names.append(c)
        elif c == geom_col:
            arrays.append(pa.array(new_geom, type=t.schema.field(geom_col).type))
            new_names.append(c)
        else:
            arrays.append(t.column(c))
            new_names.append(c)
    new_t = pa.Table.from_arrays(arrays, names=new_names)
    pq.write_table(new_t, path)
    print(f"wrote {path}: {new_t.num_rows} rows")


if __name__ == "__main__":
    main()
