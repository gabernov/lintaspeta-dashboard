import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { DATASETS } from "../lib/datasets";
import { useAuth } from "../auth/AuthContext";
import type { EditWindow } from "../lib/types";

export default function DashboardHome() {
  const { profile, role } = useAuth();
  const [windows, setWindows] = useState<Record<string, EditWindow>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase
      .from("edit_windows")
      .select("*")
      .then(({ data }) => {
        const map: Record<string, EditWindow> = {};
        for (const w of (data as EditWindow[]) ?? []) map[w.dataset] = w;
        setWindows(map);
      });
  }, []);

  useEffect(() => {
    for (const d of DATASETS) {
      supabase
        .from(d.draftTable)
        .select("id", { count: "exact", head: true })
        .then(({ count }) => setCounts((c) => ({ ...c, [d.id]: count ?? 0 })));
    }
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ringkasan</h1>
        <p className="muted">
          Masuk sebagai <strong>{profile?.full_name ?? "Anda"}</strong> ({role})
          {profile?.region ? ` — wilayah ${profile.region}` : " — semua wilayah"}
        </p>
      </header>

      <div className="card-grid">
        {DATASETS.map((d) => {
          const w = windows[d.id];
          return (
            <Link to={`/dataset/${d.id}`} key={d.id} className="card">
              <div className="card-title" style={{ color: d.defaultColor }}>
                {d.label}
              </div>
              <div className="card-count">{counts[d.id]?.toLocaleString("id-ID") ?? "…"}</div>
              <div className="card-sub muted">
                {w ? (w.open ? "Jendela edit TERBUKA" : "Jendela edit tertutup") : "Status jendela …"}
              </div>
              <div className="card-cta">Buka editor →</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
