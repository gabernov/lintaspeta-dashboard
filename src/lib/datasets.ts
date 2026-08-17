// Dataset registry - mirrors research findings (schemas from parquet files + deployed tables)
import type { DatasetMeta } from "./types";

export const DATASETS: DatasetMeta[] = [
  {
    id: "ruas_jalan",
    label: "Ruas Jalan",
    draftTable: "ruas_jalan_draft",
    publishedTable: "ruas_jalan_published",
    geometryType: "LineString",
    regionField: "region", // populated from unit_kerja_kode (UPTD-I..IV)
    regionLabel: "UPTD",
    sourceIdLabel: "ID Ruas",
    formFields: [
      { key: "nama", label: "Nama Ruas", type: "text" },
      { key: "kode_number", label: "Kode Number", type: "text" },
      { key: "kode", label: "Kode Kab/Kota", type: "text" },
      { key: "panjang_km", label: "Panjang (km)", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "unit_kerja_kode", label: "Unit Kerja (UPTD)", type: "text" },
      { key: "lokasi_kode", label: "Lokasi Kode", type: "text" },
    ],
    regionPropertyKey: "unit_kerja_kode",
    defaultColor: "#2563eb",
  },
  {
    id: "sekolah",
    label: "Sekolah",
    draftTable: "sekolah_draft",
    publishedTable: "sekolah_published",
    geometryType: "Point",
    regionField: "region", // populated from KABUPATEN
    regionLabel: "Kabupaten",
    sourceIdLabel: "NPSN",
    formFields: [
      { key: "NAMA SEKOLAH", label: "Nama Sekolah", type: "text" },
      { key: "NPSN", label: "NPSN", type: "text" },
      { key: "Jenjang", label: "Jenjang", type: "select", options: ["SD", "SMP", "SMA", "SMK", "SLB"] },
      { key: "Status", label: "Status", type: "select", options: ["NEGERI", "SWASTA"] },
      { key: "KABUPATEN", label: "Kabupaten", type: "text" },
      { key: "KECAMATAN", label: "Kecamatan", type: "text" },
      { key: "DESA/KELURAHAN", label: "Desa/Kelurahan", type: "text" },
      { key: "AKREDITASI", label: "Akreditasi", type: "text" },
    ],
    regionPropertyKey: "KABUPATEN",
    defaultColor: "#16a34a",
  },
  {
    id: "rambu",
    label: "Rambu",
    draftTable: "rambu_draft",
    publishedTable: "rambu_published",
    geometryType: "Point",
    regionField: "region", // populated from kabupaten (derived at import)
    regionLabel: "Kabupaten",
    sourceIdLabel: "Kode Ruas",
    formFields: [
      { key: "kode_ruas", label: "Kode Ruas", type: "text" },
      { key: "nama_ruas", label: "Nama Ruas", type: "text" },
      { key: "kelas_jalan", label: "Kelas Jalan", type: "select", options: ["I", "II", "III"] },
      { key: "status", label: "Status", type: "text" },
      { key: "fungsi", label: "Fungsi", type: "text" },
      { key: "panjang_km", label: "Panjang (km)", type: "number" },
    ],
    regionPropertyKey: null,
    defaultColor: "#dc2626",
  },
  {
    id: "apj",
    label: "APJ",
    draftTable: "apj_draft",
    publishedTable: "apj_published",
    geometryType: "Point",
    regionField: "region", // populated from UPTD ("UPTD 1".."UPTD 4")
    regionLabel: "UPTD",
    sourceIdLabel: "ID Tiang",
    formFields: [
      { key: "Id_Tiang", label: "ID Tiang", type: "text" },
      { key: "UPTD", label: "UPTD", type: "select", options: ["UPTD 1", "UPTD 2", "UPTD 3", "UPTD 4"] },
      { key: "Kabupaten/Kota", label: "Kabupaten/Kota", type: "text" },
      { key: "Nama Ruas (Resmi)", label: "Nama Ruas", type: "text" },
      { key: "Kondisi", label: "Kondisi", type: "select", options: ["Baik", "Rusak Ringan", "Rusak Berat", "Mati"] },
      { key: "Jenis_PJU", label: "Jenis APJ", type: "select", options: ["APJ Konvensional", "APJ Smart Lamp", "APJ Solar Cell", "LCU", "Ready to Smart"] },
      { key: "Jenis_Lamp", label: "Jenis Lampu", type: "text" },
      { key: "Bahan_Tian", label: "Bahan Tiang", type: "text" },
      { key: "Tahun_Angg", label: "Tahun Anggaran", type: "text" },
      { key: "Posisi_Tia", label: "Posisi Tiang", type: "select", options: ["Kanan", "Kiri", "Tengah"] },
    ],
    regionPropertyKey: "UPTD",
    defaultColor: "#d97706",
  },
];

export function getDataset(id: string): DatasetMeta | undefined {
  return DATASETS.find((d) => d.id === id);
}
