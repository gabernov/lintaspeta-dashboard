import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DATASETS } from "../lib/datasets";

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
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M12 2 4 6v12l8 4 8-4V6l-8-4zm0 2.2 5.5 2.7v10.2L12 19.8 6.5 17.1V6.9L12 4.2z" fill="currentColor" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          </svg>
          <span>LintasPeta</span>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
            Ringkasan
          </NavLink>
          {DATASETS.map((d) => (
            <NavLink
              key={d.id}
              to={`/dataset/${d.id}`}
              className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            >
              {d.label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <div className="nav-section">Admin</div>
              <NavLink to="/admin" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
                Pengguna &amp; Peran
              </NavLink>
              <NavLink to="/audit" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
                Riwayat Audit
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-name">{profile?.full_name ?? profile?.id.slice(0, 8)}</div>
            <div className="user-role">
              {profile?.role ?? "?"}
              {region ? ` · ${region}` : ""}
            </div>
          </div>
          <button className="btn-link" onClick={handleSignOut}>
            Keluar
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
