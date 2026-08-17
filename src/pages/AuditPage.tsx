import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { AuditEntry } from "../lib/types";

const TABLE_LABELS: Record<string, string> = {
  ruas_jalan_draft: "Ruas Jalan",
  sekolah_draft: "Sekolah",
  rambu_draft: "Rambu",
  apj_draft: "APJ",
};

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!error) setRows((data as AuditEntry[]) ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="page-loading">Memuat riwayat…</div>;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Riwayat Audit</h1>
        <p className="muted">Siapa mengubah apa, kapan — 200 entri terakhir</p>
      </header>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Dataset</th>
              <th>Aksi</th>
              <th>Record</th>
              <th>Pengguna</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                <td>{TABLE_LABELS[r.table_name] ?? r.table_name}</td>
                <td>
                  <span className={`badge badge-${r.action.toLowerCase()}`}>{r.action}</span>
                </td>
                <td className="mono">{r.record_id}</td>
                <td className="mono muted">{r.user_id?.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
