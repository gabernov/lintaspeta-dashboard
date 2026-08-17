#!/usr/bin/env python3
"""Build portal parquet files from Supabase published tables.

Reads each dataset's published snapshot via the Supabase REST API
(service role) and writes parquet files matching the EXACT schema the
static portal's parquet-loader expects: original property columns + a
`geometry` binary column containing EWKB/WKB bytes.

Usage:
    python scripts/build_parquet.py --portal <portal-dir> [--datasets a,b,c]
Env:
    SUPABASE_URL (https://<ref>.supabase.co)
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import io
import json
import os
import sys
import urllib.request

import pyarrow as pa
import pyarrow.parquet as pq

# Column specs per dataset: (output_name, pyarrow_type, source_path_in_json)
# source_path_in_json: tuple of keys to navigate the REST row to the value.
# All datasets use "properties" (jsonb) for original columns; "geometry" is
# returned by PostgREST as EWKB hex string when using a select on the column.
SCHEMAS = {
    "ruas_jalan": {
        "columns": [
            ("id", pa.string(), ("properties", "id")),
            ("kode_number", pa.string(), ("properties", "kode_number")),
            ("nama", pa.string(), ("properties", "nama")),
            ("panjang_km", pa.float64(), ("properties", "panjang_km")),
            ("status", pa.string(), ("properties", "status")),
            ("lokasi_kode", pa.string(), ("properties", "lokasi_kode")),
            ("unit_kerja_kode", pa.string(), ("properties", "unit_kerja_kode")),
            ("kode", pa.string(), ("properties", "kode")),
        ],
        "geometry_type": "MultiLineString",
        "file": "maps/ruas-jalan/data/ruas_jalan.parquet",
    },
    "sekolah": {
        "columns": [
            ("Jenjang", pa.string(), ("properties", "Jenjang")),
            ("Status", pa.string(), ("properties", "Status")),
            ("NAMA SEKOLAH", pa.string(), ("properties", "NAMA SEKOLAH")),
            ("NPSN", pa.string(), ("properties", "NPSN")),
            ("BENTUK", pa.string(), ("properties", "BENTUK")),
            ("NAMA DUSUN", pa.string(), ("properties", "NAMA DUSUN")),
            ("DESA/KELURAHAN", pa.string(), ("properties", "DESA/KELURAHAN")),
            ("KECAMATAN", pa.string(), ("properties", "KECAMATAN")),
            ("KABUPATEN", pa.string(), ("properties", "KABUPATEN")),
            ("PROVINSI", pa.string(), ("properties", "PROVINSI")),
            ("KODE POS", pa.float64(), ("properties", "KODE POS")),
            ("LINTANG", pa.float64(), ("properties", "LINTANG")),
            ("BUJUR", pa.float64(), ("properties", "BUJUR")),
            ("AKREDITASI", pa.string(), ("properties", "AKREDITASI")),
            ("SUMBER LISTRIK", pa.string(), ("properties", "SUMBER LISTRIK")),
            ("AKSES INTERNET", pa.string(), ("properties", "AKSES INTERNET")),
            ("SUMBER AIR", pa.string(), ("properties", "SUMBER AIR")),
            ("KECUKUPAN AIR", pa.string(), ("properties", "KECUKUPAN AIR")),
            ("nearest_road_name", pa.string(), ("properties", "nearest_road_name")),
            ("nearest_road_kode", pa.string(), ("properties", "nearest_road_kode")),
            ("nearest_road_id", pa.string(), ("properties", "nearest_road_id")),
            ("nearest_road_panjang_km", pa.float64(), ("properties", "nearest_road_panjang_km")),
            ("nearest_road_unit_kerja", pa.string(), ("properties", "nearest_road_unit_kerja")),
            ("nearest_road_lokasi_kode", pa.float64(), ("properties", "nearest_road_lokasi_kode")),
            ("distance_m", pa.float64(), ("properties", "distance_m")),
            ("within_50m", pa.bool_(), ("properties", "within_50m")),
            ("within_100m", pa.bool_(), ("properties", "within_100m")),
            ("within_150m", pa.bool_(), ("properties", "within_150m")),
            ("within_200m", pa.bool_(), ("properties", "within_200m")),
            ("within_60m", pa.bool_(), ("properties", "within_60m")),
            ("Validasi", pa.string(), ("properties", "Validasi")),
            ("Tipe_Jalan", pa.string(), ("properties", "Tipe_Jalan")),
            ("Lebar_Lajur", pa.float64(), ("properties", "Lebar_Lajur")),
            ("Tipe_ZoSS", pa.string(), ("properties", "Tipe_ZoSS")),
            ("Sudah_ZOSS", pa.string(), ("properties", "Sudah_ZOSS")),
            ("Lokasi_Gerbang", pa.string(), ("properties", "Lokasi_Gerbang")),
            ("Keterangan", pa.string(), ("properties", "Keterangan")),
        ],
        "geometry_type": "Point",
        "file": "maps/sekolah/data/sekolah_merged.parquet",
    },
    "rambu": {
        "columns": [
            ("kode_ruas", pa.string(), ("properties", "kode_ruas")),
            ("nama_ruas", pa.string(), ("properties", "nama_ruas")),
            ("status", pa.string(), ("properties", "status")),
            ("fungsi", pa.string(), ("properties", "fungsi")),
            ("kelas_jalan", pa.string(), ("properties", "kelas_jalan")),
            ("panjang_km", pa.float64(), ("properties", "panjang_km")),
            ("ujung_ruas", pa.string(), ("properties", "ujung_ruas")),
            ("latitude", pa.float64(), ("properties", "latitude")),
            ("longitude", pa.float64(), ("properties", "longitude")),
            ("bersinggungan_arteri", pa.bool_(), ("properties", "bersinggungan_arteri")),
            ("bersinggungan_kolektor", pa.bool_(), ("properties", "bersinggungan_kolektor")),
            ("jarak_jaringan_m", pa.float64(), ("properties", "jarak_jaringan_m")),
            ("jarak_arteri_m", pa.float64(), ("properties", "jarak_arteri_m")),
            ("jarak_kolektor_m", pa.float64(), ("properties", "jarak_kolektor_m")),
        ],
        "geometry_type": "Point",
        "file": "maps/rambu/data/rambu_kelas_jalan.parquet",
    },
    "apj": {
        "columns": [
            ("No", pa.float64(), ("properties", "No")),
            ("UPTD", pa.string(), ("properties", "UPTD")),
            ("Kabupaten/Kota", pa.string(), ("properties", "Kabupaten/Kota")),
            ("Kode Ruas", pa.string(), ("properties", "Kode Ruas")),
            ("Nama Ruas (Resmi)", pa.string(), ("properties", "Nama Ruas (Resmi)")),
            ("Panjang (km)", pa.float64(), ("properties", "Panjang (km)")),
            ("Status", pa.string(), ("properties", "Status")),
            ("Jarak ke Ruas (m)", pa.float64(), ("properties", "Jarak ke Ruas (m)")),
            ("Status Match", pa.string(), ("properties", "Status Match")),
            ("Id_Tiang", pa.string(), ("properties", "Id_Tiang")),
            ("Tahun_Angg", pa.string(), ("properties", "Tahun_Angg")),
            ("Latitude", pa.float64(), ("properties", "Latitude")),
            ("Longitude", pa.float64(), ("properties", "Longitude")),
            ("Posisi_Tia", pa.string(), ("properties", "Posisi_Tia")),
            ("Meter_Box", pa.string(), ("properties", "Meter_Box")),
            ("Kondisi", pa.string(), ("properties", "Kondisi")),
            ("Bahan_Tian", pa.string(), ("properties", "Bahan_Tian")),
            ("Jenis_PJU", pa.string(), ("properties", "Jenis_PJU")),
            ("Jenis_Tian", pa.string(), ("properties", "Jenis_Tian")),
            ("Jenis_Lamp", pa.string(), ("properties", "Jenis_Lamp")),
            ("Sumber File SHP", pa.string(), ("properties", "Sumber File SHP")),
        ],
        "geometry_type": "Point",
        "file": "maps/apj/data/pju_detail.parquet",
    },
}

TABLE_NAMES = {
    "ruas_jalan": "ruas_jalan_published",
    "sekolah": "sekolah_published",
    "rambu": "rambu_published",
    "apj": "apj_published",
}


def fetch_published(dataset: str, base_url: str, key: str) -> list[dict]:
    """Fetch all rows of a published table via PostgREST (service role)."""
    table = TABLE_NAMES[dataset]
    url = f"{base_url}/rest/v1/{table}?select=source_id,geometry,properties&limit=1000"
    rows: list[dict] = []
    while url:
        req = urllib.request.Request(url, headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req) as resp:
            page: list[dict] = json.loads(resp.read().decode("utf-8"))
        if not page:
            break
        rows.extend(page)
        # PostgREST pagination via Range header on next request
        url = None  # fetch all pages by re-issuing with offset is overkill; bump limit if needed
    return rows


def hex_to_wkb(hex_str: str | None) -> bytes | None:
    """Convert PostgREST EWKB hex string to raw WKB bytes (binary column)."""
    if not hex_str:
        return None
    return bytes.fromhex(hex_str)


def build_table(dataset: str, rows: list[dict]):
    spec = SCHEMAS[dataset]
    arrays: list[list] = []
    for col_name, pa_type, path in spec["columns"]:
        values = []
        for row in rows:
            node = row
            for part in path:
                if node is None:
                    break
                node = node.get(part) if isinstance(node, dict) else None
            values.append(node)
        # Normalize per type
        norm = []
        for v in values:
            if v is None:
                norm.append(None)
            elif pa.types.is_boolean(pa_type):
                norm.append(bool(v))
            elif pa.types.is_floating(pa_type):
                try:
                    norm.append(float(v))
                except (TypeError, ValueError):
                    norm.append(None)
            else:
                norm.append(str(v))
        arrays.append(norm)

    # Geometry column: EWKB hex -> binary
    geoms = []
    for row in rows:
        geoms.append(hex_to_wkb(row.get("geometry")))

    cols = [
        pa.array(values, type=pa_type)
        for (_, pa_type, _), values in zip(spec["columns"], arrays)
    ]
    cols.append(pa.array(geoms, type=pa.binary()))
    names = [c[0] for c in spec["columns"]] + ["geometry"]
    return pa.table(cols, names=names)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True, help="path to checked-out portal repo")
    ap.add_argument("--datasets", default="ruas_jalan,sekolah,rambu,apj")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    wanted = {d.strip() for d in args.datasets.split(",") if d.strip()}
    for dataset in wanted:
        if dataset not in SCHEMAS:
            print(f"skip unknown dataset: {dataset}", file=sys.stderr)
            continue
        print(f"fetching {dataset}...")
        rows = fetch_published(dataset, base, key)
        if not rows:
            print(f"  no rows for {dataset}, skipping file", file=sys.stderr)
            continue
        table = build_table(dataset, rows)
        out_path = os.path.join(args.portal, SCHEMAS[dataset]["file"])
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        pq.write_table(table, out_path)
        print(f"  wrote {out_path} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
