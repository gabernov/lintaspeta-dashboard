import argparse
import base64
import json
import os

import psycopg2
from psycopg2.extras import execute_values

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")

PROPERTY_KEYS = [
    "id", "kode_number", "id_ruas_jalan", "nama", "nama_lama", "kode", "lokasi_kode",
    "unit_kerja_kode", "wil_uptd", "kab_kota", "KABUPATEN", "nm_sppjj", "sta_awal",
    "sta_akhir", "panjang_km", "panjang_km_lama", "status", "kelas_jalan", "legacy_match",
]


def connect():
    values = {}
    with open(ENV_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            values[key.strip()] = val.strip().strip('"').strip("'")
    ref = values["VITE_SUPABASE_URL"].rstrip("/").split("//")[-1].split(".")[0]
    return psycopg2.connect(
        host="aws-0-ap-southeast-1.pooler.supabase.com",
        port=5432,
        dbname="postgres",
        user=f"postgres.{ref}",
        password=values["SUPABASE_DB_PASSWORD"],
        connect_timeout=30,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--status", default="approved")
    args = ap.parse_args()

    rows = json.load(open(args.rows, encoding="utf-8"))
    payload = [
        (
            row["id"],
            base64.b64decode(row["_wkb"]),
            json.dumps({k: row[k] for k in PROPERTY_KEYS if k in row}, ensure_ascii=False),
            row["unit_kerja_kode"],
        )
        for row in rows
    ]

    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("alter table public.ruas_jalan_draft disable trigger audit_ruas_jalan")
        cur.execute("delete from public.ruas_jalan_draft")
        execute_values(
            cur,
            "insert into public.ruas_jalan_draft (source_id, geometry, properties, region, status, source_type) values %s",
            [(sid, wkb, props, region, args.status, "master") for sid, wkb, props, region in payload],
            template="(%s, ST_GeomFromWKB(%s, 4326), %s::jsonb, %s, %s, %s)",
            page_size=100,
        )
        cur.execute("delete from public.ruas_jalan_published")
        execute_values(
            cur,
            "insert into public.ruas_jalan_published (source_id, geometry, properties, published_at, published_by) values %s",
            [(sid, wkb, props) for sid, wkb, props, _ in payload],
            template="(%s, ST_GeomFromWKB(%s, 4326), %s::jsonb, now(), null)",
            page_size=100,
        )
        cur.execute("alter table public.ruas_jalan_draft enable trigger audit_ruas_jalan")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    conn = connect()
    cur = conn.cursor()
    for table in ("ruas_jalan_draft", "ruas_jalan_published"):
        cur.execute(f"select count(*) from public.{table}")
        print(f"{table}: {cur.fetchone()[0]} rows")
    cur.execute("select distinct region from public.ruas_jalan_draft order by 1")
    print("regions:", [r[0] for r in cur.fetchall()])
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
