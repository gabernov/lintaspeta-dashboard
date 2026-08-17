import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DATASETS } from "../lib/datasets";

function initials(name: string | null | undefined) {
  if (!name) return "·";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function AppShell() {
  const { profile, region, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "super_admin";

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M12 2 4 6v12l8 4 8-4V6l-8-4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            </svg>
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">LintasPeta</div>
            <div className="sidebar-brand-tag">Dinas Perhubungan Jabar</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-section">Navigasi</div>
          <NavLink to="/" end className="nav-item">
            <svg className="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1" />
              <rect x="14" y="3" width="7" height="5" rx="1" />
              <rect x="14" y="12" width="7" height="9" rx="1" />
              <rect x="3" y="16" width="7" height="5" rx="1" />
            </svg>
            <span>Ringkasan</span>
          </NavLink>
          {DATASETS.map((d) => (
            <NavLink
              key={d.id}
              to={`/dataset/${d.id}`}
              className="nav-item"
            >
              <span className="nav-dot" style={{ backgroundColor: d.defaultColor }} aria-hidden="true" />
              <span>{d.label}</span>
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <div className="sidebar-nav-section">Admin</div>
              <NavLink to="/admin" className="nav-item">
                <svg className="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Pengguna &amp; Peran</span>
              </NavLink>
              <NavLink to="/audit" className="nav-item">
                <svg className="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v4l3 2" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                <span>Riwayat Audit</span>
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials(profile?.full_name ?? profile?.id)}</div>
            <div className="sidebar-user-text">
              <div className="user-name">{profile?.full_name ?? "Pengguna"}</div>
              <div className="user-role">
                <span className={`role-pill role-${profile?.role ?? "viewer"}`}>{profile?.role ?? "—"}</span>
                {region ? <span className="muted">{region}</span> : null}
              </div>
            </div>
          </div>
          <button className="sidebar-signout" onClick={handleSignOut}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Keluar</span>
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
