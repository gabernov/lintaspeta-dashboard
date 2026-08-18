#!/usr/bin/env python3
"""Bootstrap-seed the dashboard draft tables from the public portal parquet.

The public portal (peta.dishubjabar.com) is the source of truth for the
baseline geospatial data. This script reads each dataset's parquet (all
columns, full row count) and (re)loads the corresponding *_draft table so the
editor starts from exactly the same data the public map shows.

Geometry is taken from the parquet `geometry` WKB column when present, falling
back to Latitude/Longitude (or LINTANG/BUJUR) columns for point datasets.

Usage:
    python scripts/bootstrap_seed.py --portal <portal-repo-path> \
        [--datasets apj,sekolah,rambu,ruas_jalan] [--limit N] [--drop]

    --drop   TRUNCATE the draft + published tables for each dataset before
             seeding (use when re-seeding from scratch).
    --limit  cap rows per dataset (0 = all) — useful for testing.

Env (loaded from lintaspeta-dashboard/.env.local if not set):
    SUPABASE_URL, SUPABASE_DB_PASSWORD
"""

import argparse
import json
import math
import os
import sys
import struct

import psycopg2
from psycopg2.extras import execute_values

# dataset -> (parquet rel path, draft table, source_id col, region col,
#             lat col, lon col)   (None for lat/lon = no fallback)
MAP = {
    "apj": ("maps/apj/data/pju_detail.parquet", "apj_draft", "Id_Tiang", "UPTD", "Latitude", "Longitude"),
    "sekolah": ("maps/sekolah/data/sekolah_merged.parquet", "sekolah_draft", "NPSN", "KABUPATEN", "LINTANG", "BUJUR"),
    "rambu": ("maps/rambu/data/rambu_kelas_jalan.parquet", "rambu_draft", "rambu_id", None, None, None),
    "ruas_jalan": ("maps/ruas-jalan/data/ruas_jalan.parquet", "ruas_jalan_draft", "id", "unit_kerja_kode", None, None),
}

GEOM_COLS = ["geometry", "geom", "wkb_geometry", "shape", "wkb", "geo_shape"]

# Jawa Barat bounding box: (lon_min, lon_max, lat_min, lat_max).
# Rows whose coordinate falls outside are skipped — this drops corrupt rows
# such as APJ points where Longitude equals Latitude (lon==lat lands in Africa).
WJB_BOUNDS = (105.0, 109.5, -8.0, -5.0)


def inside_wjb(lon, lat):
    return (
        lon is not None
        and lat is not None
        and WJB_BOUNDS[0] <= lon <= WJB_BOUNDS[1]
        and WJB_BOUNDS[2] <= lat <= WJB_BOUNDS[3]
    )


def decode_wkb_point(b):
    """Return (lon, lat) if b is a valid WKB Point, else None."""
    try:
        bo = b[0]
        little = bo == 1
        gtype = struct.unpack("<I" if little else ">I", b[1:5])[0]
        has_srid = (gtype & 0x20000000) != 0
        has_z = (gtype & 0x80000000) != 0 or (gtype % 1000) >= 1000
        base = (gtype & 0x0FFFFFFF) % 1000
        off = 9 if has_srid else 5
        if base != 1:
            return None
        fmt = "<d" if little else ">d"
        x = struct.unpack(fmt, b[off : off + 8])[0]
        y = struct.unpack(fmt, b[off + 8 : off + 16])[0]
        return (x, y)
    except Exception:
        return None


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True, help="path to lintaspeta-web repo")
    ap.add_argument("--datasets", default="apj,sekolah,rambu,ruas_jalan")
    ap.add_argument("--limit", type=int, default=0, help="max rows per dataset (0 = all)")
    ap.add_argument("--drop", action="store_true", help="TRUNCATE draft+published before seeding")
    args = ap.parse_args()

    env = load_env()
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_DB_PASSWORD"):
        print("Missing SUPABASE_URL / SUPABASE_DB_PASSWORD", file=sys.stderr)
        sys.exit(1)

    conn = connect(env)
    conn.autocommit = False
    cur = conn.cursor()
    wanted = {d.strip() for d in args.datasets.split(",") if d.strip()}

    for ds in wanted:
        if ds not in MAP:
            print(f"skip unknown dataset: {ds}", file=sys.stderr)
            continue
        rel, table, src_col, region_col, lat_col, lon_col = MAP[ds]
        path = os.path.join(args.portal, rel)
        if not os.path.exists(path):
            print(f"missing {path}, skip {ds}", file=sys.stderr)
            continue

        import pyarrow.parquet as pq

        t = pq.read_table(path)
        names = t.column_names
        geom_col = next((c for c in names if c in GEOM_COLS), None)
        props_cols = [c for c in names if c != geom_col]
        n = t.num_rows
        if args.limit:
            n = min(n, args.limit)

        if args.drop:
            cur.execute(f"TRUNCATE TABLE public.{table}")
            print(f"  truncated {table}")

        print(f"seeding {ds}: up to {n} rows from {rel} (geom_col={geom_col})")

        props_data = {c: t.column(c).to_pylist() for c in props_cols}
        geom_data = t.column(geom_col).to_pylist() if geom_col else None
        lat_data = t.column(lat_col).to_pylist() if lat_col else None
        lon_data = t.column(lon_col).to_pylist() if lon_col else None

        rows = []
        skipped_geom = 0
        for i in range(n):
            props = {}
            for c in props_cols:
                v = props_data[c][i]
                if v is not None:
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                        continue
                    props[c] = v

            wkb_hex = None
            lon = lat = None
            if geom_data is not None:
                raw = geom_data[i]
                if raw is not None:
                    b = bytes(raw)
                    wkb_hex = b.hex()
                    pt = decode_wkb_point(b)
                    if pt:
                        lon, lat = pt
            if wkb_hex is None and lat_data is not None and lon_data is not None:
                lat = lat_data[i]
                lon = lon_data[i]

            if lon is not None and lat is not None:
                if not inside_wjb(lon, lat):
                    skipped_geom += 1
                    continue
            elif wkb_hex is None:
                skipped_geom += 1
                continue

            sid = str(props.get(src_col) or f"{ds}-{i}")
            region = str(props.get(region_col)) if region_col and props.get(region_col) is not None else ""
            rows.append((sid, region, "approved", "master", wkb_hex, lon, lat, json.dumps(props, default=str)))

        # dedupe by source_id keeping first
        seen = set()
        dedup = []
        for r in rows:
            if r[0] in seen:
                continue
            seen.add(r[0])
            dedup.append(r)
        rows = dedup

        BATCH = 1000
        inserted = 0
        for start in range(0, len(rows), BATCH):
            batch = rows[start : start + BATCH]
            point_rows = [(r[0], r[1], r[2], r[3], r[6], r[5], r[7]) for r in batch if r[4] is None]
            wkb_rows = [(r[0], r[1], r[2], r[3], r[4], r[7]) for r in batch if r[4] is not None]
            if point_rows:
                execute_values(
                    cur,
                    f"INSERT INTO public.{table} (source_id, region, status, source_type, geometry, properties) VALUES %s",
                    point_rows,
                    template="(%s,%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),%s::jsonb)",
                )
            if wkb_rows:
                execute_values(
                    cur,
                    f"INSERT INTO public.{table} (source_id, region, status, source_type, geometry, properties) VALUES %s",
                    wkb_rows,
                    template="(%s,%s,%s,%s,ST_GeomFromWKB(decode(%s,'hex'),4326),%s::jsonb)",
                )
            inserted += len(batch)
        print(f"  inserted {inserted} rows (skipped {skipped_geom} w/o geometry, deduped)")
        conn.commit()

    cur.close()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
