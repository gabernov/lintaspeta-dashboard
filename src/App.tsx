import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import AppShell from "./components/AppShell";
import DashboardHome from "./pages/DashboardHome";
import LandingPage from "./pages/LandingPage";
import PrivasiPage from "./pages/PrivasiPage";
import KetentuanPage from "./pages/KetentuanPage";
import AksesibilitasPage from "./pages/AksesibilitasPage";
import DatasetEditor from "./pages/DatasetEditor";
import AuditPage from "./pages/AuditPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import type { Role } from "./lib/types";

function DatasetEditorRoute() {
  const { datasetId } = useParams<{ datasetId: string }>();
  return <DatasetEditor key={datasetId} />;
}

function Protected({ children, roles }: { children: React.ReactNode; roles?: Role[] }) {
  const { session, loading, profile } = useAuth();
  if (loading) return <div className="page-loading">Memuat…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/privasi" element={<PrivasiPage />} />
      <Route path="/ketentuan" element={<KetentuanPage />} />
      <Route path="/aksesibilitas" element={<AksesibilitasPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="dataset/:datasetId" element={<DatasetEditorRoute />} />
        <Route
          path="audit"
          element={
            <Protected roles={["super_admin"]}>
              <AuditPage />
            </Protected>
          }
        />
        <Route
          path="admin"
          element={
            <Protected roles={["super_admin"]}>
              <AdminUsersPage />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
