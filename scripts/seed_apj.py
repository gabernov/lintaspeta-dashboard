#!/usr/bin/env python3
"""Seed dashboard draft tables from portal parquet using psycopg2."""
import argparse, json, os, sys

import pyarrow.parquet as pq
import psycopg2
from psycopg2.extras import execute_values

DASH_TABLES = {
    "apj": ("apj_draft", "Id_Tiang", "UPTD"),
    "sekolah": ("sekolah_draft", "NPSN", "KABUPATEN"),
    "rambu": ("rambu_draft", "kode_ruas", None),
    "ruas_jalan": ("ruas_jalan_draft", "id", "unit_kerja_kode"),
}

PARQUET = {
    "apj": "maps/apj/data/pju_detail.parquet",
    "sekolah": "maps/sekolah/data/sekolah_merged.parquet",
    "rambu": "maps/rambu/data/rambu_kelas_jalan.parquet",
    "ruas_jalan": "maps/ruas-jalan/data/ruas_jalan.parquet",
}

# point datasets: (lat_col, lon_col)
POINTS = {
    "apj": ("Latitude", "Longitude"),
    "sekolah": ("LINTANG", "BUJUR"),
}


def seed_points(portal, dataset, project_ref, db_password, limit=0, status="approved"):
    table, src_col, region_col = DASH_TABLES[dataset]
    path = os.path.join(portal, PARQUET[dataset])
    t = pq.read_table(path)
    n = t.num_rows
    if limit:
        n = min(n, limit)
    lat_col, lon_col = POINTS[dataset]
    lat = t.column(lat_col).to_pylist()[:n]
    lon = t.column(lon_col).to_pylist()[:n]
    skip = {lat_col, lon_col}
    prop_cols = [c for c in t.column_names if c not in skip]
    props_data = {c: t.column(c).to_pylist()[:n] for c in prop_cols}

    # dedupe by source_id (keep first occurrence)
    seen = set()
    keep_idx = []
    for i in range(n):
        sid = str(props_data.get(src_col, [None]*n)[i] or f"{dataset}-{i}")
        if sid in seen:
            continue
        seen.add(sid)
        keep_idx.append(i)
    print(f"  after dedupe: {len(keep_idx)}/{n}")
    n = len(keep_idx)

    conn = psycopg2.connect(
        host="aws-0-ap-southeast-1.pooler.supabase.com",
        port=6543, dbname="postgres",
        user=f"postgres.{project_ref}", password=db_password,
        sslmode="require",
    )
    conn.autocommit = False
    cur = conn.cursor()
    print(f"Truncating {table}...")
    cur.execute(f"TRUNCATE TABLE public.{table}")
    print(f"Inserting {n} rows...")
    BATCH = 1000
    inserted = 0
    for start in range(0, n, BATCH):
        end = min(start + BATCH, n)
        batch = []
        for ki in keep_idx[start:end]:
            la = lat[ki]; lo = lon[ki]
            if la is None or lo is None:
                continue
            sid = str(props_data.get(src_col, [None]*n)[ki] or f"{dataset}-{ki}")
            region = str(props_data.get(region_col, [None]*n)[ki] or "") if region_col else ""
            props_dict = {c: props_data[c][ki] for c in prop_cols if props_data[c][ki] is not None}
            batch.append((sid, region, status, "master", lo, la, json.dumps(props_dict, default=str)))
        execute_values(cur,
            f"INSERT INTO public.{table} (source_id, region, status, source_type, geometry, properties) VALUES %s",
            batch,
            template="(%s,%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),%s::jsonb)"
        )
        inserted += len(batch)
        if inserted % 10000 == 0 or inserted == n:
            print(f"  {inserted}/{n}")
    conn.commit()
    cur.close(); conn.close()
    print(f"Done. Inserted {inserted} rows into {table}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True)
    ap.add_argument("--dataset", default="apj", choices=list(DASH_TABLES.keys()))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    db_pw = os.environ.get("SUPABASE_DB_PASSWORD", "")
    if not base or not db_pw:
        print("Missing SUPABASE_URL / SUPABASE_DB_PASSWORD", file=sys.stderr); sys.exit(1)
    project_ref = base.replace("https://", "").replace(".supabase.co", "")
    if args.dataset in POINTS:
        seed_points(args.portal, args.dataset, project_ref, db_pw, args.limit)
    else:
        print(f"{args.dataset}: not yet supported")


if __name__ == "__main__":
    main()
