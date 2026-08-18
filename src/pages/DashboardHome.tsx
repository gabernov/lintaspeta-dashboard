import { Fragment, useEffect, useState } from "react";
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

interface PivotValue {
  value: string;
  count: number;
}

interface UptdKabRow {
  uptd: string;
  kab: string;
  count: number;
}

interface DistributionData {
  dataset: string;
  total: number;
  uptd: PivotValue[];
  kab: PivotValue[];
  uptd_kab: UptdKabRow[];
}

const PIVOT_KEYS: Record<DatasetMeta["id"], Array<{ key: string; label: string }>> = {
  apj: [
    { key: "UPTD", label: "UPTD" },
    { key: "Kondisi", label: "Kondisi" },
    { key: "Kabupaten/Kota", label: "Kab/Kota" },
  ],
  sekolah: [
    { key: "Jenjang", label: "Jenjang" },
    { key: "Status", label: "Status" },
  ],
  rambu: [
    { key: "kelas_jalan", label: "Kelas Jalan" },
    { key: "status", label: "Status" },
  ],
  ruas_jalan: [
    { key: "unit_kerja_kode", label: "UPTD" },
    { key: "status", label: "Status" },
  ],
};

export default function DashboardHome() {
  const { profile, role } = useAuth();
  const [windows, setWindows] = useState<Record<string, EditWindow>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [published, setPublished] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [pivots, setPivots] = useState<Record<string, Record<string, PivotValue[]>>>({});
  const [dists, setDists] = useState<Record<string, DistributionData>>({});
  const [distTab, setDistTab] = useState<"uptd" | "lokasi">("uptd");

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

  useEffect(() => {
    for (const d of DATASETS) {
      const keys = (PIVOT_KEYS[d.id] ?? []).map((p) => p.key);
      if (keys.length === 0) continue;
      supabase
        .rpc("dataset_pivot", { p_dataset: d.id, p_keys: keys })
        .then(({ data, error }) => {
          if (error || !data) return;
          const groups = data as Record<string, PivotValue[]>;
          const entries: Record<string, PivotValue[]> = {};
          for (const [k, arr] of Object.entries(groups)) {
            entries[k] = (arr ?? []).slice(0, 6);
          }
          setPivots((p) => ({ ...p, [d.id]: entries }));
        });
    }
  }, []);

  useEffect(() => {
    for (const d of DATASETS) {
      supabase
        .rpc("dataset_distribution", { p_dataset: d.id })
        .then(({ data, error }) => {
          if (error || !data) return;
          setDists((p) => ({ ...p, [d.id]: data as DistributionData }));
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

      <section className="home-section">
        <div className="home-section-head">
          <h2>Ringkasan per Peta</h2>
          <span className="muted">Distribusi data draft per dimensi</span>
        </div>
        <div className="pivot-grid">
          {DATASETS.map((d) => {
            const groups = pivots[d.id];
            const dims = PIVOT_KEYS[d.id] ?? [];
            return (
              <div className="pivot-card" key={d.id} style={{ "--accent": d.defaultColor } as React.CSSProperties}>
                <div className="pivot-card-head">
                  <span className="card-icon" aria-hidden="true">{ICONS[d.id]}</span>
                  <span className="pivot-card-title">{d.label}</span>
                  <span className="pivot-card-total">
                    {(counts[d.id] ?? 0).toLocaleString("id-ID")}
                  </span>
                </div>
                {dims.map((dim) => {
                  const rows = groups?.[dim.key];
                  if (!rows || rows.length === 0) return null;
                  const max = Math.max(...rows.map((r) => r.count));
                  return (
                    <div className="pivot-dim" key={dim.key}>
                      <div className="pivot-dim-label">{dim.label}</div>
                      {rows.map((r) => (
                        <div className="pivot-row" key={r.value}>
                          <span className="pivot-row-label" title={r.value}>
                            {r.value}
                          </span>
                          <div className="pivot-bar-track">
                            <div
                              className="pivot-bar-fill"
                              style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                            />
                          </div>
                          <span className="pivot-row-count">
                            {r.count.toLocaleString("id-ID")}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2>Distribusi Data per UPTD &amp; Lokasi</h2>
          <div className="dist-tabs">
            <button
              className={`dist-tab${distTab === "uptd" ? " dist-tab-active" : ""}`}
              onClick={() => setDistTab("uptd")}
            >
              Per UPTD &amp; Lokasi
            </button>
            <button
              className={`dist-tab${distTab === "lokasi" ? " dist-tab-active" : ""}`}
              onClick={() => setDistTab("lokasi")}
            >
              Per Lokasi
            </button>
          </div>
        </div>
        <DistributionTable dists={dists} tab={distTab} />
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

const DIST_COLUMNS: Array<{ id: DatasetMeta["id"]; label: string }> = [
  { id: "apj", label: "PJU" },
  { id: "rambu", label: "RAMBU" },
  { id: "sekolah", label: "SEKOLAH" },
  { id: "ruas_jalan", label: "RUAS JALAN" },
];

const UPTD_MAP: Record<string, string> = {
  "UPTD 1": "UPTD-I",
  "UPTD 2": "UPTD-II",
  "UPTD 3": "UPTD-III",
  "UPTD 4": "UPTD-IV",
  "UPTD-I": "UPTD-I",
  "UPTD-II": "UPTD-II",
  "UPTD-III": "UPTD-III",
  "UPTD-IV": "UPTD-IV",
};

function DistributionTable({
  dists,
  tab,
}: {
  dists: Record<string, DistributionData>;
  tab: "uptd" | "lokasi";
}) {
  const cell = (val?: number) =>
    val != null && val > 0 ? val.toLocaleString("id-ID") : "—";

  if (tab === "lokasi") {
    const apjKab = dists.apj?.kab ?? [];
    const sklKab = dists.sekolah?.kab ?? [];
    const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
    const kabSet = new Map<string, string>();
    for (const k of apjKab) kabSet.set(norm(k.value), k.value);
    for (const k of sklKab) {
      if (!kabSet.has(norm(k.value))) kabSet.set(norm(k.value), k.value);
    }
    const kabRows = Array.from(kabSet.values()).sort((a, b) => a.localeCompare(b, "id"));
    const apjMap = new Map(apjKab.map((k) => [norm(k.value), k.count]));
    const sklMap = new Map(sklKab.map((k) => [norm(k.value), k.count]));
    return (
      <div className="dist-table-wrap">
        <table className="dist-table">
          <thead>
            <tr>
              <th>Lokasi</th>
              {DIST_COLUMNS.map((c) => (
                <th key={c.id}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="dist-total-row">
              <td>Dishub Jabar</td>
              {DIST_COLUMNS.map((c) => (
                <td key={c.id}>{cell(dists[c.id]?.total)}</td>
              ))}
            </tr>
            {kabRows.map((kab) => (
              <tr key={kab}>
                <td className="dist-lokasi">{kab}</td>
                {DIST_COLUMNS.map((c) => {
                  if (c.id === "apj") return <td key={c.id}>{cell(apjMap.get(norm(kab)))}</td>;
                  if (c.id === "sekolah") return <td key={c.id}>{cell(sklMap.get(norm(kab)))}</td>;
                  return <td key={c.id}>—</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const apjUptd = dists.apj?.uptd ?? [];
  const apjUptdMap = new Map(apjUptd.map((u) => [UPTD_MAP[u.value] ?? u.value, u.count]));
  const ruasUptd = dists.ruas_jalan?.uptd ?? [];
  const ruasUptdMap = new Map(ruasUptd.map((u) => [UPTD_MAP[u.value] ?? u.value, u.count]));
  const uptdKab = dists.apj?.uptd_kab ?? [];
  const uptdOrder = ["UPTD-I", "UPTD-II", "UPTD-III", "UPTD-IV"];
  return (
    <div className="dist-table-wrap">
      <table className="dist-table">
        <thead>
          <tr>
            <th>UPTD / Lokasi</th>
            {DIST_COLUMNS.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="dist-total-row">
            <td>Dishub Jabar</td>
            {DIST_COLUMNS.map((c) => (
              <td key={c.id}>{cell(dists[c.id]?.total)}</td>
            ))}
          </tr>
          {uptdOrder.map((uptd) => {
            const kabSub = uptdKab
              .filter((r) => (UPTD_MAP[r.uptd] ?? r.uptd) === uptd)
              .sort((a, b) => a.kab.localeCompare(b.kab, "id"));
            return (
              <Fragment key={uptd}>
                <tr className="dist-uptd-row">
                  <td>{uptd}</td>
                  <td>{cell(apjUptdMap.get(uptd))}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{cell(ruasUptdMap.get(uptd))}</td>
                </tr>
                {kabSub.map((r) => (
                  <tr key={`${uptd}-${r.kab}`}>
                    <td className="dist-lokasi">⊔ {r.kab}</td>
                    <td>{cell(r.count)}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
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
