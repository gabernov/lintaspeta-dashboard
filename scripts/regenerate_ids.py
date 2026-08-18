#!/usr/bin/env python3
"""Regenerate unique feature IDs in the public portal parquet files.

Two datasets in peta.dishubjabar.com have non-unique source identifiers:

1. APJ (maps/apj/data/pju_detail.parquet): each konsultan/UPTD assigned its
   own `Id_Tiang` numbering that collides when the 225 source SHP files were
   merged (same id, different coordinates). We keep the original as
   `Id_Tiang_By_Konsultan` and generate a globally-unique `Id_Tiang` per
   point from our reverse-engineered scheme:
       <4-digit wilayah code><7-digit global sequence>
   (wilayah code is taken from the first 4 digits of the konsultan id when it
   looks valid, else 0000).

2. Rambu (maps/rambu/data/rambu_kelas_jalan.parquet): data rekomendasi has no
   id of its own (`kode_ruas` is the road the sign belongs to). We add a
   unique `rambu_id` per sign point.

The old parquet file is archived to <portal>/maps/archive/<dataset>/release-<N>_<date>/
before being overwritten, so the pre-cleansing data can always be rolled back.

Usage:
    python scripts/regenerate_ids.py --portal <portal-repo-path> [--datasets apj,rambu]
"""

import argparse
import os
import shutil
import sys
from datetime import datetime

import pyarrow as pa
import pyarrow.parquet as pq

DATASETS = {
    "apj": ("maps/apj/data/pju_detail.parquet", "Id_Tiang"),
    "rambu": ("maps/rambu/data/rambu_kelas_jalan.parquet", None),
}


def archive_file(portal, rel, archive_root):
    """Copy <rel> into <archive_root>/<name>/release-<N>_<date>/ keeping its basename."""
    src = os.path.join(portal, rel)
    name = os.path.splitext(os.path.basename(rel))[0]
    date = datetime.now().strftime("%Y-%m-%d")
    base_dir = os.path.join(archive_root, name)
    os.makedirs(base_dir, exist_ok=True)
    existing = [d for d in os.listdir(base_dir) if d.startswith("release-")]
    n = len(existing) + 1
    dest_dir = os.path.join(base_dir, f"release-{n}_{date}")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(rel))
    shutil.copy2(src, dest)
    print(f"  archived -> {dest}")
    return dest


def wilayah_code(raw):
    """Extract a plausible 4-digit wilayah code from a konsultan id, else '0000'."""
    if raw is None:
        return "0000"
    s = str(raw).strip()
    if len(s) >= 14 and s[:4].isdigit():
        return s[:4]
    return "0000"


WJB_BOUNDS = (105.0, 109.5, -8.0, -5.0)  # (lon_min, lon_max, lat_min, lat_max)


def inside_wjb(lat, lon):
    return (
        lat is not None
        and lon is not None
        and WJB_BOUNDS[0] <= lon <= WJB_BOUNDS[1]
        and WJB_BOUNDS[2] <= lat <= WJB_BOUNDS[3]
    )


def clean_wjb_parquet(path, lat_col, lon_col):
    """Drop rows whose lat/lon fall outside the Jawa Barat bbox."""
    t = pq.read_table(path)
    lat = t.column(lat_col).to_pylist()
    lon = t.column(lon_col).to_pylist()
    keep = [i for i in range(t.num_rows) if inside_wjb(lat[i], lon[i])]
    dropped = t.num_rows - len(keep)
    if dropped == 0:
        print(f"  no rows outside Jawa Barat in {path}")
        return False
    new_t = t.take(keep)
    pq.write_table(new_t, path)
    print(f"  cleaned {path}: dropped {dropped} rows outside Jawa Barat, {new_t.num_rows} remain")
    return True


def regenerate_apj(path):
    t = pq.read_table(path)
    cols = t.column_names
    if "Id_Tiang_By_Konsultan" in cols:
        print("  already regenerated (Id_Tiang_By_Konsultan present), skip")
        return False

    old = t.column("Id_Tiang").to_pylist()
    seq = 0
    new_ids = []
    for raw in old:
        w = wilayah_code(raw)
        new_ids.append(f"{w}{seq:07d}")
        seq += 1

    arrays = []
    for c in cols:
        if c == "Id_Tiang":
            continue
        arrays.append(t.column(c))
    arrays.append(pa.array(old, type=t.schema.field("Id_Tiang").type))
    arrays.append(pa.array(new_ids, type=pa.string()))

    new_names = [c for c in cols if c != "Id_Tiang"] + ["Id_Tiang_By_Konsultan", "Id_Tiang"]
    new_t = pa.Table.from_arrays(arrays, names=new_names)
    pq.write_table(new_t, path)
    print(f"  wrote {path}: {new_t.num_rows} rows, Id_Tiang unique={len(set(new_ids)) == len(new_ids)}")
    return True


def regenerate_rambu(path):
    t = pq.read_table(path)
    if "rambu_id" in t.column_names:
        print("  already regenerated (rambu_id present), skip")
        return False

    n = t.num_rows
    ids = [f"RAMBU-{i+1:05d}" for i in range(n)]
    arrays = [t.column(c) for c in t.column_names] + [pa.array(ids, type=pa.string())]
    new_t = pa.Table.from_arrays(arrays, names=t.column_names + ["rambu_id"])
    pq.write_table(new_t, path)
    print(f"  wrote {path}: {new_t.num_rows} rows, rambu_id unique={len(set(ids)) == len(ids)}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True, help="path to lintaspeta-web repo")
    ap.add_argument("--archive", default=os.path.join(os.path.dirname(__file__), "..", "archive"),
                    help="where to archive pre-regeneration parquet files (default: dashboard repo archive/)")
    ap.add_argument("--datasets", default="apj,rambu")
    args = ap.parse_args()

    wanted = {d.strip() for d in args.datasets.split(",") if d.strip()}
    for ds in wanted:
        if ds not in DATASETS:
            print(f"skip unknown dataset: {ds}", file=sys.stderr)
            continue
        rel, _ = DATASETS[ds]
        path = os.path.join(args.portal, rel)
        if not os.path.exists(path):
            print(f"missing {path}, skip {ds}", file=sys.stderr)
            continue
        print(f"=== {ds} ===")
        archive_file(args.portal, rel, args.archive)
        if ds == "apj":
            changed = regenerate_apj(path)
            clean_wjb_parquet(path, "Latitude", "Longitude")
        elif ds == "rambu":
            regenerate_rambu(path)
    print("Done.")


if __name__ == "__main__":
    main()
