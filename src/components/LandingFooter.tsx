import { Link } from "react-router-dom";

/* ---------- brand mark ---------- */

function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
    </svg>
  );
}

/* ---------- social icons (monochrome, currentColor) ---------- */

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3V11H8.5v3h2.8v7h2.2z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M17.7 3h2.9l-6.4 7.3L21.7 21h-5.9l-4.5-6.1L6.3 21H3.4l6.8-7.8L2.7 3H8.6l4 5.5L17.7 3zm-1 16.2h1.6L7.6 4.6H6L16.7 19.2z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M16.6 3c.4 2.1 1.8 3.6 3.9 3.9v2.9c-1.5 0-2.9-.5-3.9-1.3v6.6c0 3.2-2.6 5.8-5.8 5.8S5 18.3 5 15.1s2.6-5.8 5.8-5.8c.3 0 .6 0 .9.1v3c-.3-.1-.6-.2-.9-.2-1.6 0-2.9 1.3-2.9 2.9s1.3 2.9 2.9 2.9 2.9-1.3 2.9-2.9V3h2.9z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15.2V8.8L15.5 12 10 15.2z" />
    </svg>
  );
}

/* ---------- data ---------- */

const SOCIALS = [
  {
    name: "Facebook",
    href: "https://www.facebook.com/dishubjawabarat/?locale=id_ID",
    icon: <FacebookIcon />,
  },
  {
    name: "Instagram",
    href: "https://www.instagram.com/dishubjabar",
    icon: <InstagramIcon />,
  },
  {
    name: "X",
    href: "https://x.com/dishub_jabar",
    icon: <XIcon />,
  },
  {
    name: "TikTok",
    href: "https://www.tiktok.com/@dishub_jabar",
    icon: <TikTokIcon />,
  },
  {
    name: "YouTube",
    href: "https://www.youtube.com/@dishubjabar2644",
    icon: <YouTubeIcon />,
  },
];

const NAV_LINKS = [
  { label: "Beranda", href: "#beranda" },
  { label: "Dataset", href: "#dataset" },
  { label: "Integrasi Statistik", href: "#integrasi" },
];

/* ---------- footer ---------- */

export default function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <div className="landing-footer-grid">
          {/* Col 1 — Brand */}
          <div className="landing-footer-col">
            <div className="landing-footer-brand">
              <span className="landing-brand-mark">
                <BrandMark size={20} />
              </span>
              <span className="landing-footer-brand-text">
                <span className="landing-footer-name">Lintas</span>
                <span className="landing-footer-tagline">Lalu Lintas dan Integrasi Statistik</span>
              </span>
            </div>
            <p className="landing-footer-desc">
              Portal data lalu lintas dan integrasi statistik Dinas Perhubungan Provinsi Jawa Barat.
            </p>
            <div className="landing-footer-socials">
              {SOCIALS.map((social) => (
                <a
                  key={social.name}
                  className="landing-footer-social"
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={social.name}
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Col 2 — Navigasi */}
          <div className="landing-footer-col">
            <h3 className="landing-footer-col-title">Navigasi</h3>
            <ul className="landing-footer-links">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a className="landing-footer-link" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <Link className="landing-footer-link" to="/login">
                  Masuk
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3 — Kontak */}
          <div className="landing-footer-col">
            <h3 className="landing-footer-col-title">Kontak</h3>
            <ul className="landing-footer-links">
              <li className="landing-footer-contact">
                Jl. Sukabumi No. 1, Kacapiring, Kec. Batununggal, Kota Bandung, Jawa Barat 40271
              </li>
              <li>
                <a className="landing-footer-link" href="mailto:dishub@jabarprov.go.id">
                  dishub@jabarprov.go.id
                </a>
              </li>
              <li>
                <a className="landing-footer-link" href="tel:0227207257">
                  022-7207257
                </a>
              </li>
            </ul>
          </div>

          {/* Col 4 — Legal */}
          <div className="landing-footer-col">
            <h3 className="landing-footer-col-title">Legal</h3>
            <ul className="landing-footer-links">
              <li>
                <Link className="landing-footer-link" to="/privasi">
                  Kebijakan Privasi
                </Link>
              </li>
              <li>
                <Link className="landing-footer-link" to="/ketentuan">
                  Syarat &amp; Ketentuan
                </Link>
              </li>
              <li>
                <Link className="landing-footer-link" to="/aksesibilitas">
                  Aksesibilitas
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="landing-footer-bottom">
          <p>© 2026 Dinas Perhubungan Provinsi Jawa Barat.</p>
          <p>Dinas Perhubungan Provinsi Jawa Barat</p>
        </div>
      </div>
    </footer>
  );
}