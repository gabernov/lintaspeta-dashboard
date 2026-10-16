# Catatan data ruas jalan

Catatan setiap kali data `ruas_jalan` diubah di luar alur importer normal, supaya keputusan
bisa ditelusuri dan dibatalkan (reverse) dengan mudah.

Sumber acuan kode ruas: `PetaAPJ-provinsi/ruas_jalan_rows (4).csv` (data SK/referensi lama —
kolom `nama_sk` di tabel kita berasal dari sini). Data atribut API DBMPR ada di
`lintaspeta-dashboard/scripts/.cache/ruas_propinsi_api.json`; **API itu tidak punya
`kode_number` sama sekali**, jadi semua kode berasal dari pencocokan ke data SK.

---

## 1. Tiga ruas tanpa nama di-merge ke tetangganya — 2026-10-15

**Alasan.** Tiga baris dari sumber DBMPR punya geometri tapi **nol atribut** (`nama`,
`kode_number`, `nama_pu`, `nama_sk`, `kelas_jalan` kosong; `panjang_km` null), sehingga
muncul sebagai entri tanpa nama di panel Lapisan editor. Dikonfirmasi ke DISHUB Jabar
(bahwa sumbernya memang kosong), jadi tiap baris di-merge ke ruas bernama yang
kelanjutannya, lalu baris kosongnya dihapus.

**Migrasi:** `supabase/migrations/20261016100000_merge_orphan_ruas.sql` (aman dijalankan ulang).

| Baris kosong (`id_ruas_jalan`) | Panjang | Draft id | Source id | Ujung | Di-merge ke | Dasar |
|---|---|---|---|---|---|---|
| `193130` | 2,441 km | `2899ad35-8cdb-47ab-8cda-6e98b4967f0a` | `c12982dc-e2d9-5809-91e3-e8149db20872` | (106.916211,-6.947692) → (106.901274,-6.931562) | **22.00.193.11.K** | titik awalnya persis titik akhir 193.11.K |
| `193140` | 2,966 km | `956ff96c-2911-4ad7-8e84-5883f441ac25` | `99e087ad-b1e3-5790-b933-306f534791d5` | (106.955640,-6.934319) → (106.934209,-6.950032) | **22.00.193.11.K** | titik akhirnya persis titik awal 193.11.K |
| `193150` | 0,237 km | `10133bf0-c50d-42fa-af43-3ae8c29639ac` | `faeb8a9a-6a42-566c-bf6f-362f217f42b0` | (106.873483,-6.907691) → (106.873858,-6.905610) | **22.00.193.12** | ruas bernama terdekat (rata-rata 68 m) |

**Hasil:** 304 → **301 baris**, 0 tanpa nama.
`22.00.193.11.K` = 7,529 km (3 bagian), `22.00.193.12` = 4,571 km (3 bagian).

**Efek samping yang perlu diketahui:** `panjang_km` kedua ruas penerima sekarang
**dihitung dari geometri** (karena baris yang di-merge tidak punya panjang sama sekali).
Nilai panjang versi sumber (STA) sebelum merge: `22.00.193.11.K` = 8,5 dan
`22.00.193.12` = 4,56 — tersimpan di backup di bawah.

### Cara reverse

**Langkah 1 — data asli sudah diamankan:** `supabase/data-fixes/merged-ruas-20261015.json`
(berisi baris lengkap: geometri GeoJSON + semua properties + id + source_id, untuk ketiga
baris yang dihapus **dan** geometri sebelum-merge dari dua ruas penerima).
Diambil dari `public.audit_log`, yang menyimpan `old_data` setiap update/delete pada
`ruas_jalan_draft`.

**Langkah 2 — kembalikan dengan SQL** (contoh untuk `193130`; ulangi untuk `193140`,
`193150` dengan nilai dari file JSON):

```sql
-- pulihkan baris yang dihapus
insert into public.ruas_jalan_draft (id, source_id, geometry, properties, region, status, source_type)
select
  '2899ad35-8cdb-47ab-8cda-6e98b4967f0a'::uuid,
  'c12982dc-e2d9-5809-91e3-e8149db20872',
  st_geomfromgeojson('<geometryGeoJson dari JSON>'),
  '<row.properties dari JSON>'::jsonb,
  'UPTD-I', 'approved', 'master';

-- kembalikan geometri ruas penerima ke kondisi sebelum merge
update public.ruas_jalan_draft
set geometry = st_geomfromgeojson('<preMergeRow.geometry dari JSON>'),
    properties = jsonb_set(properties, '{panjang_km}', to_jsonb(8.5))
where id = 'ac3d447c-3b71-4d45-93e5-67a71d99dca5';   -- 22.00.193.11.K
```

Lalu jalankan `select public.publish_dataset('ruas_jalan');` dan deploy ulang parquet
(`gh workflow run publish-data.yml -f datasets=ruas_jalan`).

**Langkah 3 — kalau file JSON hilang**, baris aslinya masih bisa diambil dari audit log:

```sql
select created_at, old_data
from public.audit_log
where table_name = 'ruas_jalan_draft' and action = 'DELETE'
  and old_data->'properties'->>'id_ruas_jalan' in ('193130','193140','193150');
```

**Cadangan terakhir:** parquet portal sebelum merge ada di riwayat git repo `lintaspeta-web`
— commit `chore(data): publish datasets [skip ci]` sebelum `4cc3bff` masih memuat 304 baris.

---

## 2. Pengisian kode dari data SK — 2026-10-16

**Migrasi:** `supabase/migrations/20261016200000_fill_sk_codes.sql`.

Importer tidak menemukan padanan SK untuk tiga ruas (kode kosong), jadi dicocokkan
**berdasarkan panjang** (jumlah panjang sub-ruas SK = panjang ruas kita, persis):

| Ruas kita | Panjang | Sub-ruas SK | Jumlah | Kode diisi |
|---|---|---|---|---|
| `343000` Tasikmalaya - Karangnunggal | 41,78 km | `22.00.343.1.K` (8,28) + `22.00.343.2` (33,5) | 41,78 ✓ | **`22.00.343`** |
| `347000` Singaparna - Bts. Kota/Kab. Tasikmalaya (Cikunir) Tasikmalaya | 8,69 km | `22.00.347.2` (3,28) + `22.00.347.1.K` (5,41) | 8,69 ✓ | **`22.00.347`** |
| `392010` Sp.3 Loji (Tegalnyampai - Cibutun) | 26,485 km | `22.00.392.1` (26,49) | 26,49 ✓ | **`22.00.392.1`** |

Dua yang pertama adalah **ruas induk** dari sub-ruas SK-nya (namanya pun gabungan kedua
sub-ruas), jadi kodenya kode dasar — sama polanya dengan `097000` → `22.00.097`,
`161000` → `22.00.161`.

**Koreksi salah tempel:** `22.00.392.1` sebelumnya tertempel di `392020` ("Cibutun -
Balewer", 16,4 km) karena pencocokan nama otomatis (keduanya memuat kata "Balewer").
Dari bukti panjang, kode itu milik `392010` (26,485 km), jadi **dipindahkan** ke `392010`
dan dikosongkan dari `392020`.

**Provenance:** setiap kode yang diisi manual diberi `legacy_match = "manual:sk-length-match"`
(dan `392020` = `"manual:code-moved-to-392010"`), jadi bisa dibedakan dari kode hasil
importer. Untuk membatalkan:

```sql
update public.ruas_jalan_draft
set properties = jsonb_set(properties, '{kode_number}', to_jsonb(''::text))
where properties->>'legacy_match' like 'manual:%';
```

### Masih tanpa kode (menunggu keputusan)

`392020` "Cibutun - Balewer" (16,4 km) dan `392030` "Balewer - Puncak Darma" (3 km):
**SK tidak punya baris terpisah** untuk keduanya — SK memperlakukan koridor
Tegalnyampai–Balewer–Puncak Darma sebagai satu ruas (`22.00.392.1`). Jadi keduanya adalah
pemecahan di sisi data API. `kode_number` dipakai sebagai kunci join (mis. rambu ↔ ruas)
dan sekarang unik, jadi memberi `22.00.392.1` ke tiga baris sekaligus akan merusak join —
lebih baik minta kode resmi dari DISHUB.

---

## 3. Riwayat audit

- `public.audit_log` mencatat semua insert/update/delete pada tabel `*_draft`
  (`record_id` = `source_id`, `old_data`/`new_data` = baris lengkap sebagai JSON, termasuk geometri).
- Trigger: `audit_ruas_jalan`, `audit_sekolah`, `audit_rambu`, `audit_apj`
  (lihat `supabase/migrations/20260817100000_schema.sql`).
