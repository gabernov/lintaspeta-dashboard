#!/usr/bin/env python3
"""Seed dashboard draft tables from the portal's existing parquet files.

Reads each dataset's parquet (the ones already used by peta.dishubjabar.com)
and inserts rows into the corresponding *_draft table so the dashboard starts
with real data.

Usage:
    python scripts/seed_draft.py --portal <portal-repo-path> [--datasets apj]
Env:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import json
import os
import sys
import urllib.request

import pyarrow.parquet as pq

# dataset -> (parquet path relative to portal, draft table, source_id column, region column)
MAP = {
    "apj": ("maps/apj/data/pju_detail.parquet", "apj_draft", "Id_Tiang", "UPTD"),
    "sekolah": ("maps/sekolah/data/sekolah_merged.parquet", "sekolah_draft", "NPSN", "KABUPATEN"),
    "rambu": ("maps/rambu/data/rambu_kelas_jalan.parquet", "rambu_draft", "kode_ruas", None),
    "ruas_jalan": ("maps/ruas-jalan/data/ruas_jalan.parquet", "ruas_jalan_draft", "id", "unit_kerja_kode"),
}

# columns that carry WKB geometry
GEOMETRY_COLS = ["geometry", "geom", "wkb_geometry", "shape", "wkb"]


def read_geometry_bytes(table, col):
    """Extract the first geometry binary value from a parquet column."""
    chunk = table[col].to_pylist()
    for v in chunk:
        if isinstance(v, (bytes, bytearray)):
            return bytes(v)
    return None


def fetch_region(table, col, i):
    if col is None:
        return ""
    v = table[col].to_pylist()[i]
    return "" if v is None else str(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True)
    ap.add_argument("--datasets", default="apj,sekolah,rambu,ruas_jalan")
    ap.add_argument("--limit", type=int, default=0, help="max rows per dataset (0 = all)")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    wanted = {d.strip() for d in args.datasets.split(",") if d.strip()}
    for ds in wanted:
        if ds not in MAP:
            print(f"skip unknown dataset: {ds}", file=sys.stderr)
            continue
        rel, table, src_col, region_col = MAP[ds]
        path = os.path.join(args.portal, rel)
        if not os.path.exists(path):
            print(f"missing {path}, skip {ds}", file=sys.stderr)
            continue

        t = pq.read_table(path)
        names = t.column_names
        geom_col = next((c for c in names if c in GEOMETRY_COLS), None)
        props_cols = [c for c in names if c != geom_col]
        n = t.num_rows
        if args.limit:
            n = min(n, args.limit)
        print(f"seeding {ds}: {n} rows from {rel}")

        rows = []
        for i in range(n):
            props = {c: t.column(c).to_pylist()[i] for c in props_cols}
            props = {k: v for k, v in props.items() if v is not None}
            src_id = str(props.get(src_col) or props.get("id") or f"{ds}-{i}")
            region = fetch_region(t, region_col, i)
            rows.append({
                "source_id": src_id,
                "properties": props,
                "region": region,
                "status": "approved",
                "source_type": "master",
                "created_by": None,
                "updated_by": None,
            })

        # batch insert via PostgREST (service role bypasses RLS)
        url = f"{base}/rest/v1/{table}"
        batch = 500
        inserted = 0
        for start in range(0, len(rows), batch):
            chunk = rows[start:start + batch]
            req = urllib.request.Request(url, data=json.dumps(chunk).encode(), method="POST", headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            })
            try:
                with urllib.request.urlopen(req) as resp:
                    inserted += len(chunk)
            except urllib.error.HTTPError as e:
                body = e.read().decode()[:200]
                print(f"  error at {start}: {e.code} {body}", file=sys.stderr)
                # geometry column present but null -> would fail; skip gracefully
                break
        print(f"  inserted {inserted}/{len(rows)} rows")


if __name__ == "__main__":
    main()
