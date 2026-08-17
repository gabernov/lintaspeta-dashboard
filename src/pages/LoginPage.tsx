import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

  if (session) {
    navigate("/", { replace: true });
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/", { replace: true });
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email });
        if (error) throw error;
        setInfo("Tautan masuk telah dikirim ke email Anda. Periksa kotak masuk.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
            <path d="M12 2 4 6v12l8 4 8-4V6l-8-4zm0 2.2 5.5 2.7v10.2L12 19.8 6.5 17.1V6.9L12 4.2z" fill="currentColor" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          </svg>
          <h1>LintasPeta Dashboard</h1>
          <p>Portal pengelolaan data peta Jabar</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@dishubjabar.com"
              autoComplete="email"
            />
          </label>

          {mode === "password" && (
            <label>
              Kata Sandi
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          )}

          {error && <p className="form-error">{error}</p>}
          {info && <p className="form-info">{info}</p>}

          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Memproses…" : mode === "password" ? "Masuk" : "Kirim Tautan"}
          </button>

          <button
            type="button"
            className="btn-link"
            onClick={() => setMode(mode === "password" ? "magic" : "password")}
          >
            {mode === "password" ? "Gunakan tautan email (magic link)" : "Gunakan kata sandi"}
          </button>
        </form>
      </div>
    </div>
  );
}
