import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { DATASETS } from "../lib/datasets";
import { useAuth } from "../auth/AuthContext";
import type { EditWindow, DatasetMeta } from "../lib/types";

const ICONS: Record<DatasetMeta["id"], React.ReactNode> = {
  ruas_jalan: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 18 8 6h2l-1 4 3 1 1-3h2l-1 4 3 1 1-3h2l4 12" />
      <path d="M4 18h16" />
    </svg>
  ),
  sekolah: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v9h14v-9" />
      <path d="M9 19v-5h6v5" />
    </svg>
  ),
  rambu: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  apj: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  ),
};

export default function DashboardHome() {
  const { profile, role } = useAuth();
  const [windows, setWindows] = useState<Record<string, EditWindow>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [published, setPublished] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("edit_windows").select("*").then(({ data }) => {
      const map: Record<string, EditWindow> = {};
      for (const w of (data as EditWindow[]) ?? []) map[w.dataset] = w;
      setWindows(map);
    });
  }, []);

  useEffect(() => {
    let done = 0;
    for (const d of DATASETS) {
      supabase
        .from(d.draftTable)
        .select("id", { count: "exact", head: true })
        .then(({ count }) => {
          setCounts((c) => ({ ...c, [d.id]: count ?? 0 }));
          done++;
          if (done === DATASETS.length) setLoading(false);
        });
      supabase
        .from(d.publishedTable)
        .select("id", { count: "exact", head: true })
        .then(({ count }) => {
          setPublished((c) => ({ ...c, [d.id]: count ?? 0 }));
        });
    }
  }, []);

  const totalDraft = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalPublished = Object.values(published).reduce((a, b) => a + b, 0);
  const openWindows = Object.values(windows).filter((w) => w?.open).length;

  return (
    <div className="home">
      <header className="home-hero">
        <div className="home-hero-text">
          <div className="home-hero-eyebrow">Dashboard pengelolaan peta</div>
          <h1>Selamat datang, {profile?.full_name ?? "Operator"}</h1>
          <p className="muted">
            Masuk sebagai <strong>{role ?? "—"}</strong>
            {profile?.region ? ` · wilayah ${profile.region}` : " · akses semua wilayah"}
          </p>
        </div>
        <div className="home-hero-stats">
          <div className="home-hero-stat">
            <div className="home-hero-stat-num">{totalDraft.toLocaleString("id-ID")}</div>
            <div className="home-hero-stat-lbl">Total fitur draft</div>
          </div>
          <div className="home-hero-stat">
            <div className="home-hero-stat-num">{totalPublished.toLocaleString("id-ID")}</div>
            <div className="home-hero-stat-lbl">Sudah dipublikasi</div>
          </div>
          <div className="home-hero-stat">
            <div className="home-hero-stat-num">{openWindows}/{DATASETS.length}</div>
            <div className="home-hero-stat-lbl">Jendela edit terbuka</div>
          </div>
        </div>
      </header>

      <section className="home-section">
        <div className="home-section-head">
          <h2>Dataset</h2>
          <span className="muted">Pilih dataset untuk membuka editor peta</span>
        </div>
        <div className="card-grid">
          {DATASETS.map((d) => {
            const w = windows[d.id];
            const draft = counts[d.id] ?? 0;
            const pub = published[d.id] ?? 0;
            return (
              <Link to={`/dataset/${d.id}`} key={d.id} className="card card-dataset" style={{ "--accent": d.defaultColor } as React.CSSProperties}>
                <div className="card-icon" aria-hidden="true">{ICONS[d.id]}</div>
                <div className="card-body">
                  <div className="card-title">{d.label}</div>
                  <div className="card-count">
                    {loading ? "—" : draft.toLocaleString("id-ID")}
                  </div>
                  <div className="card-sub">
                    <span>{pub.toLocaleString("id-ID")} dipublikasi</span>
                    <span className="card-sub-sep" />
                    <span
                      className={`card-badge ${w?.open ? "card-badge-on" : "card-badge-off"}`}
                    >
                      <span className="card-badge-dot" />
                      {w?.open ? "Edit terbuka" : "Edit tertutup"}
                    </span>
                  </div>
                </div>
                <div className="card-arrow" aria-hidden="true">→</div>
              </Link>
            );
          })}
        </div>
      </section>

      {role === "super_admin" && (
        <section className="home-section">
          <div className="home-section-head">
            <h2>Aktivitas terbaru</h2>
            <Link to="/audit" className="home-section-link">Lihat semua →</Link>
          </div>
          <RecentActivity />
        </section>
      )}
    </div>
  );
}

function RecentActivity() {
  const [rows, setRows] = useState<Array<{ id: string; ts: string; tbl: string; action: string; user: string; record: string }>>([]);

  useEffect(() => {
    supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => {
        const list = (data ?? []).map((r) => {
          const rd = (r.new_data ?? r.old_data ?? {}) as Record<string, unknown>;
          const sid = (rd._source_id ?? r.record_id) as string;
          return {
            id: r.id,
            ts: r.created_at,
            tbl: r.table_name,
            action: r.action,
            user: (r.user_id ?? "").slice(0, 8),
            record: String(sid ?? "—"),
          };
        });
        setRows(list);
      });
  }, []);

  if (rows.length === 0) {
    return (
      <div className="recent-empty">
        <span className="muted">Belum ada aktivitas tercatat.</span>
      </div>
    );
  }

  return (
    <ul className="recent-list">
      {rows.map((r) => (
        <li key={r.id} className="recent-item">
          <span className={`recent-badge recent-${r.action.toLowerCase()}`}>{r.action}</span>
          <span className="recent-tbl">{prettyTable(r.tbl)}</span>
          <span className="recent-record">{r.record}</span>
          <span className="recent-meta">
            <span className="muted">{r.user}</span>
            <span className="muted">·</span>
            <span className="muted">{formatRel(r.ts)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function prettyTable(t: string) {
  return t.replace(/_draft$/, "").replace(/_/g, " ");
}

function formatRel(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)} detik lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}
