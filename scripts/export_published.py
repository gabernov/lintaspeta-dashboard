#!/usr/bin/env python3
"""Export Supabase *_published tables to parquet and deploy to the public portal.

The dashboard's publish flow snapshots approved/pending/field drafts into
<dataset>_published. This script turns those snapshots back into the parquet
files peta.dishubjabar.com reads, MERGING with the current parquet so derived
columns that are not managed in the editor (e.g. APJ "Jarak ke Ruas (m)",
sekolah "nearest_road_*") survive edits:

  - For a published row whose source_id exists in the current parquet, the
    merged properties = current parquet properties updated with the published
    properties (published values win, derived columns kept).
  - New rows are appended (derived columns left null).
  - Rows not in the published snapshot are dropped (publish is authoritative).

Before overwriting, the current parquet is archived to <archive>/<name>/
release-<N>_<date>/ so any release can be rolled back. After writing, the
portal is deployed via `wrangler pages deploy`.

Usage:
    python scripts/export_published.py --portal <portal-repo-path> \
        [--datasets apj,sekolah,rambu,ruas_jalan] [--no-deploy] [--limit N]

Env (loaded from .env.local): SUPABASE_URL, SUPABASE_DB_PASSWORD
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
from datetime import datetime

import psycopg2
import pyarrow as pa
import pyarrow.parquet as pq

# dataset -> (parquet rel path, draft table, published table, source_id col)
MAP = {
    "apj": ("maps/apj/data/pju_detail.parquet", "apj_draft", "apj_published", "Id_Tiang"),
    "sekolah": ("maps/sekolah/data/sekolah_merged.parquet", "sekolah_draft", "sekolah_published", "NPSN"),
    "rambu": ("maps/rambu/data/rambu_kelas_jalan.parquet", "rambu_draft", "rambu_published", "rambu_id"),
    "ruas_jalan": ("maps/ruas-jalan/data/ruas_jalan.parquet", "ruas_jalan_draft", "ruas_jalan_published", "id"),
}


def load_env():
    env = {}
    for p in [os.path.join(os.path.dirname(__file__), "..", ".env.local"), ".env.local"]:
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k] = v.strip()
            break
    for k in ("SUPABASE_URL", "SUPABASE_DB_PASSWORD"):
        if k in os.environ:
            env[k] = os.environ[k]
    if "SUPABASE_URL" not in env and "VITE_SUPABASE_URL" in env:
        env["SUPABASE_URL"] = env["VITE_SUPABASE_URL"]
    return env


def connect(env):
    base = env["SUPABASE_URL"]
    ref = base.replace("https://", "").replace(".supabase.co", "")
    pw = env["SUPABASE_DB_PASSWORD"]
    return psycopg2.connect(
        host="aws-0-ap-southeast-1.pooler.supabase.com",
        port=6543,
        dbname="postgres",
        user=f"postgres.{ref}",
        password=pw,
        sslmode="require",
    )


def archive_file(portal, archive_root, name, rel):
    date = datetime.now().strftime("%Y-%m-%d")
    base_dir = os.path.join(archive_root, name)
    os.makedirs(base_dir, exist_ok=True)
    existing = [d for d in os.listdir(base_dir) if d.startswith("release-")]
    n = len(existing) + 1
    dest_dir = os.path.join(base_dir, f"release-{n}_{date}")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(rel))
    shutil.copy2(os.path.join(portal, rel), dest)
    print(f"  archived -> {dest}")
    return dest


def fetch_published(cur, table):
    cur.execute(f"SELECT source_id, ST_AsBinary(geometry), properties FROM public.{table}")
    rows = []
    for sid, wkb, props in cur.fetchall():
        if wkb is None:
            continue
        p = dict(props) if props else {}
        rows.append({"source_id": str(sid), "wkb": bytes(wkb), "properties": p})
    return rows


def row_coords(properties):
    """Return (lat_key, lon_key, lat, lon) for the first lat/lon key pair found
    in properties, else (None, None, None, None)."""
    for latk, lonk in (("Latitude", "Longitude"), ("LINTANG", "BUJUR"), ("latitude", "longitude")):
        if latk in properties and lonk in properties:
            return latk, lonk, properties[latk], properties[lonk]
    return None, None, None, None


def build_table(rows, geom_col):
    """Build a pyarrow Table. Columns = union of all property keys across rows,
    plus the geometry binary column. The geometry column is kept in the same
    position as the baseline parquet convention (last)."""
    prop_cols = sorted({k for r in rows for k in r["properties"]})
    if geom_col in prop_cols:
        prop_cols.remove(geom_col)
    col_vals = {c: [] for c in prop_cols}
    for r in rows:
        merged = dict(r["baseline_props"])
        merged.update(r["properties"])
        for c in prop_cols:
            col_vals[c].append(_coerce(merged.get(c)))
    arrays = [pa.array(col_vals[c], type=_infer_type(c, col_vals[c])) for c in prop_cols]
    arrays.append(pa.array([r["wkb"] for r in rows], type=pa.binary()))
    return pa.Table.from_arrays(arrays, names=prop_cols + [geom_col])


def _infer_type(col, vals):
    if col == "geometry":
        return pa.binary()
    non_null = [v for v in vals if v is not None]
    if non_null and all(isinstance(v, bool) for v in non_null):
        return pa.bool_()
    if non_null and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in non_null):
        if all(isinstance(v, int) for v in non_null):
            return pa.int64()
        return pa.float64()
    return pa.string()


def _coerce(v):
    if isinstance(v, bool):
        return str(v).lower()
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True, help="path to lintaspeta-web repo")
    ap.add_argument("--datasets", default="apj,sekolah,rambu,ruas_jalan")
    ap.add_argument("--no-deploy", action="store_true", help="skip wrangler deploy")
    ap.add_argument("--limit", type=int, default=0, help="cap rows per dataset (0 = all)")
    args = ap.parse_args()

    env = load_env()
    conn = connect(env)
    conn.autocommit = True
    cur = conn.cursor()

    archive_root = os.path.join(os.path.dirname(__file__), "..", "archive")
    wanted = {d.strip() for d in args.datasets.split(",") if d.strip()}

    for ds in wanted:
        if ds not in MAP:
            print(f"skip unknown dataset: {ds}", file=sys.stderr)
            continue
        rel, draft_table, pub_table, src_col = MAP[ds]
        path = os.path.join(args.portal, rel)
        if not os.path.exists(path):
            print(f"missing {path}, skip {ds}", file=sys.stderr)
            continue

        print(f"=== {ds} ===")
        baseline = pq.read_table(path)
        baseline_cols = baseline.column_names
        geom_col = next((c for c in baseline_cols if c in ("geometry", "geom", "wkb_geometry", "shape", "wkb")), None)

        pub = fetch_published(cur, pub_table)
        if args.limit:
            pub = pub[: args.limit]
            print("  LIMIT mode - NOT writing to live parquet (dry-run)")
            continue
        print(f"  published rows: {len(pub)}")
        if not pub:
            print("  published table empty - nothing to export, keeping current parquet")
            continue

        # map baseline by source_id
        bl = {}
        src_vals = baseline.column(src_col).to_pylist()
        for i in range(baseline.num_rows):
            sid = str(src_vals[i])
            row = {c: baseline.column(c).to_pylist()[i] for c in baseline_cols}
            row.pop(geom_col, None)
            bl[sid] = row

        out_rows = []
        for p in pub:
            sid = p["source_id"]
            base = bl.get(sid, {})
            props = dict(p["properties"])
            props[src_col] = sid
            lat_key, lon_key, lat, lon = row_coords(props)
            if lat_key is not None and lon_key is not None:
                props[lat_key] = lat
                props[lon_key] = lon
            out_rows.append({
                "source_id": sid,
                "wkb": p["wkb"],
                "properties": props,
                "baseline_props": base,
            })

        # geometry WKB array + rest via build_table
        prop_cols = sorted({k for r in out_rows for k in r["properties"]})
        table = build_table(out_rows, geom_col)
        # reorder: geometry last, matching baseline convention
        cols = [c for c in table.column_names if c != geom_col] + [geom_col]
        table = table.select(cols)

        archive_file(args.portal, archive_root, os.path.splitext(os.path.basename(rel))[0], rel)
        pq.write_table(table, path)
        print(f"  wrote {path}: {table.num_rows} rows")

    cur.close()
    conn.close()

    if not args.no_deploy:
        print("deploying portal...")
        r = subprocess.run(
            ["npx", "wrangler", "pages", "deploy", ".", "--project-name", "lintaspeta-web",
             "--branch", "main", "--commit-dirty=true"],
            cwd=args.portal, capture_output=True, text=True,
        )
        print(r.stdout[-2000:] if r.stdout else r.stderr[-2000:])
        if r.returncode != 0:
            print("deploy FAILED", file=sys.stderr)
            sys.exit(1)
    print("Done.")


if __name__ == "__main__":
    main()