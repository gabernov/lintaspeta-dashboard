import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

interface UserRow {
  id: string;
  email: string | null;
  created_at: string;
  role: string;
  region: string | null;
  full_name: string | null;
}

const ROLE_OPTIONS = ["super_admin", "editor", "viewer"];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [region, setRegion] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("profiles").select("id, role, region, full_name");
    const ids = (data ?? []).map((p) => p.id);
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const emailById = new Map(
      (authUsers?.users ?? []).map((u) => [u.id, u.email ?? null])
    );
    const rows: UserRow[] = (data ?? []).map((p) => ({
      ...p,
      email: emailById.get(p.id) ?? null,
      created_at: "",
    }));
    setUsers(rows);
    void ids;
  };

  useEffect(() => {
    void load();
  }, []);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { role, region: region || null },
        user_metadata: { full_name: email },
      });
      if (error) throw error;
      const uid = data?.user?.id;
      if (uid) {
        const { error: profileError } = await supabase
          .from("profiles")
          .upsert({ id: uid, role, region: region || null, full_name: email });
        if (profileError) throw profileError;
      }
      setMsg(`Pengguna ${email} dibuat dengan peran ${role}.`);
      setEmail("");
      setRegion("");
      void load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Gagal membuat pengguna.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Pengguna &amp; Peran</h1>
        <p className="muted">Undang pengguna baru dan atur peran serta wilayah</p>
      </header>

      <form onSubmit={invite} className="invite-form">
        <input
          type="email"
          required
          placeholder="email pengguna"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="wilayah (mis. UPTD 1 atau Kab. Bandung)"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Membuat…" : "Undang"}
        </button>
      </form>

      {msg && <p className="form-info">{msg}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Peran</th>
              <th>Wilayah</th>
              <th>Nama</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email ?? u.id.slice(0, 8)}</td>
                <td>
                  <span className={`badge badge-role-${u.role}`}>{u.role}</span>
                </td>
                <td>{u.region ?? "—"}</td>
                <td>{u.full_name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
