import argparse
import base64
import json
import os
import re
import struct
import sys
import urllib.request
import uuid
from collections import Counter
from difflib import SequenceMatcher

import pyarrow as pa
import pyarrow.parquet as pq

API_URL = "https://tj.temanjabar.net/api/map/geojson/ruas_jalan_propinsi"
BUNDLE_URL = "https://tj.temanjabar.net/status-jalan/main.bundle.js"

UPTD_ROMAN = {1: "UPTD-I", 2: "UPTD-II", 3: "UPTD-III", 4: "UPTD-IV", 5: "UPTD-V", 6: "UPTD-VI"}

BPS_BY_SLUG = {
    "kab_bogor": "3201", "kab_sukabumi": "3202", "kab_cianjur": "3203",
    "kab_bandung": "3204", "kab_garut": "3205", "kab_tasikmalaya": "3206",
    "kab_kuningan": "3208", "kab_cirebon": "3209", "kab_majalengka": "3210",
    "kab_sumedang": "3211", "kab_indramayu": "3212", "kab_subang": "3213",
    "kab_purwakarta": "3214", "kab_karawang": "3215", "kab_bekasi": "3216",
    "kab_bandungbarat": "3217", "kab_pangandaran": "3218",
    "kota_bogor": "3271", "kota_sukabumi": "3272", "kota_bandung": "3273",
    "kota_cirebon": "3274", "kota_bekasi": "3275", "kota_depok": "3276",
    "kota_cimahi": "3277", "kota_tasikmalaya": "3278", "kota_banjar": "3279",
}

LEGACY_ALIAS_TARGET = {
    "22.00.398.1": "CIKADU KEBON MUNCANG BTS KAB BANDUNG CIANJUR",
    "22.00.392.1": "CIBUTUN BALEWER",
}

DISHUB_UPTD_BY_KAB = {
    "UPTD-I": ["kota_depok", "kab_bekasi", "kota_bekasi", "kab_bogor", "kota_bogor",
               "kab_karawang", "kab_sukabumi", "kota_sukabumi"],
    "UPTD-II": ["kota_bandung", "kab_bandung", "kab_bandungbarat", "kota_cimahi",
                "kab_purwakarta", "kab_sumedang", "kab_cianjur"],
    "UPTD-III": ["kab_garut", "kab_tasikmalaya", "kota_tasikmalaya", "kab_ciamis",
                 "kota_banjar", "kab_pangandaran"],
    "UPTD-IV": ["kota_cirebon", "kab_cirebon", "kab_indramayu", "kab_kuningan",
                "kab_majalengka", "kab_subang"],
}
DISHUB_UPTD_BY_SLUG = {slug: uptd for uptd, slugs in DISHUB_UPTD_BY_KAB.items() for slug in slugs}

COPY_LAYOUT = {
    r"maps\ruas-jalan\data\ruas_jalan.parquet": ("canonical",),
    r"maps\sekolah\data\ruas_jalan.parquet": ("canonical",),
    r"maps\pengawasan-angkutanbarang\data\ruas_jalan.parquet": ("canonical", "kelas_jalan"),
    r"maps\rambu\data\ruas_jalan.parquet": ("canonical", "kelas_jalan"),
    r"maps\apj\data\ruas_apj.parquet": ("apj",),
}

CANONICAL_COLUMNS = ["id", "kode", "kode_number", "id_ruas_jalan", "nama", "nama_lama",
                     "lokasi_kode", "panjang_km", "status", "unit_kerja_kode"]
APJ_COLUMNS = ["id", "kode", "nama", "panjang_km", "status", "unit_kerja_kode", "lokasi_kode"]


def fetch(url, cache_path, force):
    if force or not os.path.exists(cache_path):
        req = urllib.request.Request(url, headers={"User-Agent": "lintaspeta-importer/1.0"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = resp.read()
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "wb") as fh:
            fh.write(data)
    with open(cache_path, "rb") as fh:
        return fh.read()


def norm(value):
    text = (value or "").upper()
    for ch in ".-(),/":
        text = text.replace(ch, " ")
    return " ".join(text.split())


def squash(value):
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def tidy_name(value):
    if not value:
        return ""
    text = re.sub(r"\s+", " ", value).strip()
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"(\S)-(\s)", r"\1 - ", text)
    text = re.sub(r"(\s)-(\S)", r" - \2", text)
    text = text.replace("INDRMAYU", "INDRAMAYU")
    return re.sub(r"\s+", " ", text).strip()


def merge_word_boundaries(pu, sk):
    if not pu or not sk:
        return pu
    pu_positions = [i for i, ch in enumerate(pu) if ch.isalnum()]
    pu_alnum = [ch for ch in pu.lower() if ch.isalnum()]
    sk_alnum = [ch for ch in sk.lower() if ch.isalnum()]
    if pu_alnum != sk_alnum:
        return pu
    boundaries = []
    count = 0
    tokens = sk.split()
    for token in tokens:
        count += len([ch for ch in token if ch.isalnum()])
        boundaries.append(count)
    boundaries = boundaries[:-1]
    inserts = set()
    for boundary in boundaries:
        if boundary <= 0 or boundary >= len(pu_positions):
            continue
        prev = pu_positions[boundary - 1]
        nxt = pu_positions[boundary]
        if pu[prev + 1:nxt] != "":
            continue
        inserts.add(nxt)
    if not inserts:
        return pu
    all_caps = pu.isupper()
    out = []
    for idx, ch in enumerate(pu):
        if idx in inserts:
            out.append(" ")
            if not all_caps and ch.islower():
                ch = ch.upper()
        out.append(ch)
    return "".join(out)


def code_candidates(kode):
    base = str(kode).replace("22.00.", "")
    parts = base.split(".")
    out = ["".join(parts)]
    if len(parts) >= 2:
        out.append(parts[0] + parts[1].zfill(3))
        out.append(parts[0] + parts[1].zfill(2) + "".join(parts[2:]))
        out.append("".join(parts) + "0")
    if len(parts) == 1:
        out.append(parts[0] + "000")
    return out


def slug_for_kabkota(raw):
    slug = norm(raw).lower().replace(" ", "_")
    if slug.startswith("kabupaten_"):
        slug = "kab_" + slug[len("kabupaten_"):]
    elif slug.startswith("kota_"):
        slug = "kota_" + slug[len("kota_"):]
    return {"kab_bandung_barat": "kab_bandungbarat"}.get(slug, slug)


def extract_embedded_geometry(bundle_text):
    marker = bundle_text.find("const Gr=[")
    if marker < 0:
        marker = bundle_text.find("Gr=[")
    if marker < 0:
        raise RuntimeError("embedded propinsi geometry array not found")
    start = bundle_text.find("[", marker)
    depth = 0
    in_str = False
    esc = False
    end = -1
    for idx in range(start, len(bundle_text)):
        ch = bundle_text[idx]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = idx
                break
    if end < 0:
        raise RuntimeError("unterminated geometry array")
    quoted = re.sub(r'([{,])([A-Za-z_][A-Za-z0-9_]*):', r'\1"\2":', bundle_text[start:end + 1])
    return json.loads(quoted)


def multilinestring_wkb(rings):
    parts = [
        b"\x01" + struct.pack("<II", 2, len(ring))
        + b"".join(struct.pack("<dd", point[0], point[1]) for point in ring)
        for ring in rings
    ]
    return b"\x01" + struct.pack("<II", 5, len(parts)) + b"".join(parts)


def wkb_to_rings(data):
    offset = 1
    raw_type = struct.unpack_from("<I", data, offset)[0]
    offset += 4
    if raw_type & 0x20000000:
        offset += 4
        raw_type &= ~0x20000000
    has_z = bool(raw_type & 0x80000000) or raw_type >= 1000
    has_m = bool(raw_type & 0x40000000)
    base = raw_type - 1000 if raw_type >= 1000 else raw_type
    base &= 0xFFFF

    def read_ring(at):
        order = data[at]
        at += 1
        sub_type = struct.unpack_from("<I", data, at)[0]
        at += 4
        if sub_type & 0x20000000:
            at += 4
            sub_type &= ~0x20000000
        sub_z = bool(sub_type & 0x80000000) or sub_type >= 1000
        sub_m = bool(sub_type & 0x40000000)
        count = struct.unpack_from("<I", data, at)[0]
        at += 4
        points = []
        for _ in range(count):
            x, y = struct.unpack_from("<dd", data, at)
            at += 16
            if sub_z:
                at += 8
            if sub_m:
                at += 8
            points.append([x, y])
        return points, at

    if base == 5:
        parts = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        rings = []
        for _ in range(parts):
            ring, offset = read_ring(offset)
            rings.append(ring)
        return rings
    ring, _ = read_ring(offset)
    return [ring]


def centroid(rings):
    points = [p for ring in rings for p in ring]
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def build_legacy_map(legacy_rows, name_index, official_ids):
    mapping = {}
    modes = {}
    for row in legacy_rows:
        kode = str(row["kode_number"])
        alias = LEGACY_ALIAS_TARGET.get(kode)
        if alias and norm(alias) in name_index:
            mapping[kode] = name_index[norm(alias)]
            modes[kode] = "alias"
            continue
        hit = None
        mode = None
        for cand in code_candidates(kode):
            if cand in official_ids:
                hit, mode = cand, "code"
                break
        if not hit:
            key = norm(row["nama"])
            if key in name_index:
                hit, mode = name_index[key], "name"
        if not hit:
            key = norm(row["nama"])
            best, score = None, 0.0
            for oname, oid in name_index.items():
                ratio = SequenceMatcher(None, key, oname).ratio()
                if ratio > score:
                    best, score = oid, ratio
            if score >= 0.82:
                hit, mode = best, "fuzzy"
        if hit:
            mapping[kode] = hit
            modes[kode] = mode
    return mapping, modes


def resolve_geometry(geometry_by_id, attr_ids):
    resolved = {}
    orphans = []
    for oid, entry in geometry_by_id.items():
        if oid in attr_ids:
            resolved[oid] = list(entry["geo_json"]["coordinates"])
        else:
            orphans.append(oid)
    attached = []
    for oid in orphans:
        parent = None
        for cand in attr_ids:
            if oid.startswith(cand) and (parent is None or len(cand) > len(parent)):
                parent = cand
        if parent:
            resolved.setdefault(parent, []).extend(geometry_by_id[oid]["geo_json"]["coordinates"])
            attached.append((oid, parent))
    return resolved, attached


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", required=True)
    ap.add_argument("--legacy", default=None, help="legacy ruas_jalan parquet used for code/name carry-over")
    ap.add_argument("--out", default=".ruas-out")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-copies", action="store_true")
    args = ap.parse_args()

    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
    api = json.loads(fetch(API_URL, os.path.join(cache, "ruas_propinsi_api.json"), args.force))["data"]["ruas_jalan_propinsi"]
    bundle = fetch(BUNDLE_URL, os.path.join(cache, "status_jalan_bundle.js"), args.force).decode("utf-8", "replace")
    geometry_rows = extract_embedded_geometry(bundle)

    attr_by_id = {str(r["id_ruas_jalan"]): r for r in api}
    geometry_by_id = {str(g["id_ruas_jalan"]): g for g in geometry_rows}
    name_index = {norm(r["nama_ruas_jalan"]): str(r["id_ruas_jalan"]) for r in api}

    legacy_path = args.legacy or os.path.join(args.portal, r"maps\pengawasan-angkutanbarang\data\ruas_jalan.parquet")
    legacy = pq.read_table(legacy_path).to_pylist()
    legacy_by_kode = {str(r["kode_number"]): r for r in legacy}
    legacy_map, legacy_modes = build_legacy_map(legacy, name_index, set(attr_by_id))
    reverse = {}
    for kode, oid in legacy_map.items():
        reverse.setdefault(oid, kode)

    resolved, attached = resolve_geometry(geometry_by_id, set(attr_by_id))
    leftover = [oid for oid in geometry_by_id if oid not in attr_by_id and oid not in dict(attached)]

    official_centroids = [(centroid(coords), oid) for oid, coords in resolved.items() if oid in attr_by_id]

    rows = []
    sources = Counter()
    for oid in sorted(set(attr_by_id) | set(leftover)):
        attr = attr_by_id.get(oid)
        kode = reverse.get(oid)
        old = legacy_by_kode.get(kode) if kode else None

        if oid in resolved:
            wkb = multilinestring_wkb(resolved[oid])
            sources["official"] += 1
        elif oid in geometry_by_id:
            wkb = multilinestring_wkb(geometry_by_id[oid]["geo_json"]["coordinates"])
            sources["official-geometry-without-attribute"] += 1
        elif old is not None and old.get("geometry"):
            wkb = multilinestring_wkb(wkb_to_rings(old["geometry"]))
            sources["legacy-fallback"] += 1
        else:
            sources["dropped"] += 1
            continue

        if attr:
            kab_raw = attr["kab_kota"]
            slug = slug_for_kabkota(kab_raw)
            uptd_pu = f"UPTD {attr['uptd_id']}" if attr.get("uptd_id") else ""
            nama = attr["nama_ruas_jalan"]
            panjang = round(float(attr["panjang"]) / 1000.0, 3) if attr.get("panjang") else None
            wil = attr["wil_uptd"]
            sppjj = attr["nm_sppjj"] or ""
            sta_awal = attr["sta_awal"] or ""
            sta_akhir = attr["sta_akhir"] or ""
            lokasi = BPS_BY_SLUG.get(slug, "")
        else:
            cx, cy = centroid(geometry_by_id[oid]["geo_json"]["coordinates"])
            nearest = min(official_centroids, key=lambda item: (item[0][0] - cx) ** 2 + (item[0][1] - cy) ** 2)[1]
            near_attr = attr_by_id[nearest]
            kab_raw = near_attr["kab_kota"]
            slug = slug_for_kabkota(kab_raw)
            uptd_pu = f"UPTD {near_attr['uptd_id']}" if near_attr.get("uptd_id") else ""
            nama = ""
            panjang = None
            wil = near_attr["wil_uptd"]
            sppjj = ""
            sta_awal = ""
            sta_akhir = ""
            lokasi = BPS_BY_SLUG.get(slug, "")
        if not lokasi and old is not None and old.get("lokasi_kode") is not None:
            lokasi = str(int(float(old["lokasi_kode"])))

        uptd = DISHUB_UPTD_BY_SLUG.get(slug, "")

        nama_pu = nama
        nama_sk = str(old["nama"]) if old is not None and old.get("nama") else ""
        nama = merge_word_boundaries(tidy_name(nama_pu), nama_sk)

        row_id = str(old["id"]) if old is not None else str(uuid.uuid5(uuid.NAMESPACE_URL, "lintaspeta/ruas/" + oid))
        rows.append({
            "id": row_id,
            "kode_number": kode or "",
            "id_ruas_jalan": oid,
            "nama": nama,
            "nama_pu": nama_pu,
            "nama_sk": nama_sk,
            "nama_lama": str(old["nama"]) if old is not None else "",
            "kode": slug,
            "lokasi_kode": lokasi,
            "unit_kerja_kode": uptd,
            "uptd_pu": uptd_pu,
            "wil_uptd": wil,
            "kab_kota": kab_raw,
            "KABUPATEN": re.sub(r"^KABUPATEN\b", "KAB.", norm(kab_raw)) if kab_raw else "",
            "nm_sppjj": sppjj,
            "sta_awal": sta_awal,
            "sta_akhir": sta_akhir,
            "panjang_km": panjang,
            "panjang_km_lama": float(old["panjang_km"]) if old is not None and old.get("panjang_km") is not None else None,
            "status": "provinsi",
            "kelas_jalan": str(old["kelas_jalan"]) if old is not None and old.get("kelas_jalan") else "",
            "legacy_match": legacy_modes.get(kode, "") if kode else "",
            "_wkb": wkb,
        })

    os.makedirs(args.out, exist_ok=True)
    report = {
        "official_attributes": len(api),
        "official_geometries": len(geometry_rows),
        "orphan_geometries_merged_into_parent": [list(pair) for pair in attached],
        "orphan_geometries_kept_standalone": leftover,
        "legacy_rows": len(legacy),
        "legacy_mapped": len(legacy_map),
        "legacy_unmapped": sorted(set(legacy_by_kode) - set(legacy_map)),
        "legacy_match_modes": dict(Counter(legacy_modes.values())),
        "rows_built": len(rows),
        "geometry_sources": dict(sources),
        "uptd": dict(Counter(r["unit_kerja_kode"] for r in rows)),
        "kelas_jalan": dict(Counter(r["kelas_jalan"] for r in rows)),
    }
    print(json.dumps(report, indent=1, ensure_ascii=False))

    with open(os.path.join(args.out, "rows.json"), "w", encoding="utf-8") as fh:
        json.dump([{**r, "_wkb": base64.b64encode(r["_wkb"]).decode("ascii")} for r in rows], fh, indent=1, ensure_ascii=False)
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1, ensure_ascii=False)

    if args.no_copies:
        return

    for rel, layout in COPY_LAYOUT.items():
        columns = APJ_COLUMNS if layout == ("apj",) else CANONICAL_COLUMNS
        arrays = [pa.array([r[c] if c != "panjang_km" else (float(r[c]) if r[c] is not None else None) for r in rows],
                           type=pa.float64() if c == "panjang_km" else pa.string()) for c in columns]
        names = list(columns)
        if "kelas_jalan" in layout:
            arrays.append(pa.array([r["kelas_jalan"] for r in rows], type=pa.string()))
            names.append("kelas_jalan")
        arrays.append(pa.array([r["_wkb"] for r in rows], type=pa.binary()))
        names.append("geometry")
        table = pa.table(arrays, names=names)
        path = os.path.join(args.portal, rel)
        pq.write_table(table, path)
        print(f"wrote {rel} ({table.num_rows} rows, {len(names)} cols)")


if __name__ == "__main__":
    main()
