import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import LandingFooter from "../components/LandingFooter";
import LandingThemeToggle from "../components/LandingThemeToggle";

/* ---------- data ---------- */

const NAV_LINKS = [
  { label: "Beranda", href: "#beranda" },
  { label: "Dataset", href: "#dataset" },
  { label: "Integrasi Statistik", href: "#integrasi" },
];

const STATS = [
  { value: "4+", label: "Dataset Terintegrasi" },
  { value: "27", label: "Kabupaten / Kota" },
  { value: "4", label: "Wilayah UPTD" },
  { value: "2", label: "Mode Publikasi (draft & terbit)" },
];

type Dataset = { name: string; desc: string; accent: string; icon: ReactNode };

const DATASETS: Dataset[] = [
  {
    name: "Ruas Jalan",
    desc: "Jaringan ruas jalan provinsi lengkap dengan panjang, status, dan unit kerja (UPTD I–IV).",
    accent: "#2563eb",
    icon: (
      <>
        <circle cx="6" cy="19" r="3" />
        <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
        <circle cx="18" cy="5" r="3" />
      </>
    ),
  },
  {
    name: "Sekolah",
    desc: "Sebaran sekolah negeri & swasta berdasarkan jenjang, akreditasi, dan lokasi.",
    accent: "#16a34a",
    icon: (
      <>
        <path d="m4 10 8-6 8 6" />
        <path d="M6 10v9h12v-9" />
        <path d="M10 19v-5h4v5" />
      </>
    ),
  },
  {
    name: "Rambu",
    desc: "Inventarisasi rambu lalu lintas beserta kelas jalan dan status pemasangan.",
    accent: "#dc2626",
    icon: (
      <>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </>
    ),
  },
  {
    name: "APJ",
    desc: "Titik penerangan jalan umum (PJU) dengan kondisi, jenis lampu, dan tahun anggaran.",
    accent: "#d97706",
    icon: (
      <>
        <path d="M8 22V5" />
        <path d="M4 22h9" />
        <path d="M8 5c4 0 6 1.5 6 4" />
        <path d="M14 9.5l2 1.5" />
        <circle cx="16.5" cy="10.5" r="1.8" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

const STEPS = [
  {
    num: "01",
    title: "Input & Validasi",
    desc: "Data masuk sebagai draft melalui jendela edit yang terkontrol dan terlacak.",
  },
  {
    num: "02",
    title: "Integrasi Spasial",
    desc: "Setiap entitas terikat koordinat peta, dikelompokkan per UPTD dan kabupaten/kota.",
  },
  {
    num: "03",
    title: "Publikasi Terkontrol",
    desc: "Draft ditinjau lalu diterbitkan secara bertahap ke peta publik.",
  },
  {
    num: "04",
    title: "Statistik & Pelaporan",
    desc: "Distribusi, pivot, dan tabel agregasi siap untuk analisis dan pelaporan.",
  },
];

const HERO_CHIPS = [
  { num: "27", lbl: "Kabupaten / Kota", accent: "#2563eb", pos: "landing-hero-chip-1" },
  { num: "4+", lbl: "Dataset Terintegrasi", accent: "#16a34a", pos: "landing-hero-chip-2" },
  { num: "UPTD I–IV", lbl: "Wilayah Kerja", accent: "#d97706", pos: "landing-hero-chip-3" },
];

const COMING_SOON = [
  "CCTV",
  "Kinerja Ruas Jalan",
  "Tarikan & Bangkitan",
  "Pengajuan Andalalin",
  "Perusahaan Karoseri",
];

/* ---------- icons ---------- */

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

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

/* ---------- scroll reveal ---------- */

function useReveal() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>(".landing-reveal"));
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.classList.add("landing-reveal-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("landing-reveal-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return rootRef;
}

/* ---------- page ---------- */

export default function LandingPage() {
  const rootRef = useReveal();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="landing" ref={rootRef}>
      {/* ---------- Navbar ---------- */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a className="landing-brand" href="#beranda" aria-label="Lintas — beranda">
            <span className="landing-brand-mark">
              <BrandMark size={22} />
            </span>
            <span className="landing-brand-text">
              <span className="landing-brand-name">Lintas</span>
              <span className="landing-brand-sub">Lalu Lintas &amp; Integrasi Statistik</span>
            </span>
          </a>

          <nav className="landing-nav-links" aria-label="Navigasi utama">
            {NAV_LINKS.map((link) => (
              <a key={link.href} className="landing-nav-link" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <LandingThemeToggle />
            <Link className="landing-btn landing-btn-primary landing-btn-sm" to="/login">
              Masuk
            </Link>
            <button
              type="button"
              className="landing-nav-toggle"
              aria-expanded={navOpen}
              aria-label={navOpen ? "Tutup menu" : "Buka menu"}
              onClick={() => setNavOpen((v) => !v)}
            >
              {navOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {navOpen && (
          <div className="landing-nav-drawer">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                className="landing-nav-link"
                href={link.href}
                onClick={() => setNavOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <Link className="landing-btn landing-btn-primary" to="/login" onClick={() => setNavOpen(false)}>
              Masuk
            </Link>
          </div>
        )}
      </header>

      {/* ---------- Hero ---------- */}
      <section className="landing-hero" id="beranda">
        <div className="landing-hero-bg" aria-hidden="true">
          <div className="landing-hero-glow" />
          <svg
            className="landing-hero-roads"
            viewBox="0 0 1440 800"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <pattern id="landing-grid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path className="landing-hero-grid-line" d="M48 0H0v48" fill="none" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="1440" height="800" fill="url(#landing-grid)" />
            <g className="landing-route landing-route-1">
              <path d="M-60 640 C 180 560, 340 700, 540 640 S 840 470, 1040 540 S 1300 430, 1500 480" />
              <path
                className="landing-route-dash"
                d="M-60 640 C 180 560, 340 700, 540 640 S 840 470, 1040 540 S 1300 430, 1500 480"
              />
            </g>
            <g className="landing-route landing-route-2">
              <path d="M-60 400 C 200 440, 280 300, 480 340 S 780 210, 1000 300 S 1260 180, 1500 240" />
              <path
                className="landing-route-dash"
                d="M-60 400 C 200 440, 280 300, 480 340 S 780 210, 1000 300 S 1260 180, 1500 240"
              />
            </g>
            <g className="landing-route landing-route-3">
              <path d="M 220 -60 C 260 160, 120 320, 210 480 S 400 660, 340 860" />
              <path
                className="landing-route-dash"
                d="M 220 -60 C 260 160, 120 320, 210 480 S 400 660, 340 860"
              />
            </g>
            <g className="landing-route landing-route-4">
              <path d="M 940 -60 C 900 140, 1020 260, 950 430 S 780 640, 840 860" />
              <path
                className="landing-route-dash"
                d="M 940 -60 C 900 140, 1020 260, 950 430 S 780 640, 840 860"
              />
            </g>
            <g className="landing-nodes">
              <circle cx="540" cy="640" r="3.5" />
              <circle cx="1040" cy="540" r="3" />
              <circle cx="480" cy="340" r="3.5" />
              <circle cx="1000" cy="300" r="3" />
              <circle cx="210" cy="480" r="3" />
              <circle cx="950" cy="430" r="3.5" />
              <circle cx="340" cy="700" r="2.5" />
              <circle cx="780" cy="210" r="2.5" />
            </g>
          </svg>

          {HERO_CHIPS.map((chip) => (
            <div key={chip.pos} className={`landing-hero-chip ${chip.pos}`}>
              <span
                className="landing-hero-chip-dot"
                style={{ background: chip.accent, boxShadow: `0 0 10px ${chip.accent}` }}
              />
              <span className="landing-hero-chip-num">{chip.num}</span>
              <span className="landing-hero-chip-lbl">{chip.lbl}</span>
            </div>
          ))}
        </div>

        <div className="landing-hero-content">
          <span
            className="landing-eyebrow landing-reveal"
            style={{ "--reveal-delay": "0ms" } as CSSProperties}
          >
            Dinas Perhubungan Provinsi Jawa Barat
          </span>
          <h1
            className="landing-hero-title landing-reveal"
            style={{ "--reveal-delay": "100ms" } as CSSProperties}
          >
            Satu Platform untuk Data <span className="landing-hero-title-accent">Lalu Lintas</span>{" "}
            Jawa Barat
          </h1>
          <p
            className="landing-hero-sub landing-reveal"
            style={{ "--reveal-delay": "200ms" } as CSSProperties}
          >
            Lintas mengintegrasikan data ruas jalan, rambu, penerangan jalan umum, dan sekolah ke
            dalam satu peta interaktif — lengkap dengan statistik yang siap dianalisis.
          </p>
          <div
            className="landing-hero-actions landing-reveal"
            style={{ "--reveal-delay": "300ms" } as CSSProperties}
          >
            <a
              className="landing-btn landing-btn-primary"
              href="https://peta.dishubjabar.com"
              target="_blank"
              rel="noreferrer"
            >
              Lihat Peta Publik
              <ArrowUpRightIcon />
            </a>
            <Link className="landing-btn landing-btn-ghost" to="/login">
              Masuk untuk Editor
            </Link>
          </div>
          <p
            className="landing-hero-hint landing-reveal"
            style={{ "--reveal-delay": "360ms" } as CSSProperties}
          >
            Peta publik terbuka untuk umum · editor resmi Dishub Jabar masuk untuk mengelola data
          </p>
        </div>
      </section>

      {/* ---------- Stats band ---------- */}
      <section className="landing-stats" aria-label="Statistik platform">
        <div className="landing-stats-inner">
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="landing-stat landing-reveal"
              style={{ "--reveal-delay": `${i * 90}ms` } as CSSProperties}
            >
              <span className="landing-stat-value">{stat.value}</span>
              <span className="landing-stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Dataset ---------- */}
      <section className="landing-section" id="dataset">
        <div className="landing-section-head landing-reveal">
          <span className="landing-section-eyebrow">Dataset</span>
          <h2 className="landing-section-title">Apa yang Kami Kelola</h2>
          <p className="landing-section-sub">Lapisan data transportasi dalam satu peta — dan terus bertambah.</p>
        </div>
        <div className="landing-datasets">
          {DATASETS.map((ds, i) => (
            <article
              key={ds.name}
              className="landing-card landing-reveal"
              style={
                {
                  "--landing-accent": ds.accent,
                  "--reveal-delay": `${i * 90}ms`,
                } as CSSProperties
              }
            >
              <span className="landing-card-icon">
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ds.icon}
                </svg>
              </span>
              <h3 className="landing-card-title">{ds.name}</h3>
              <p className="landing-card-desc">{ds.desc}</p>
            </article>
          ))}
        </div>
        <div className="landing-coming landing-reveal">
          <h3 className="landing-coming-title">Segera hadir</h3>
          <div className="landing-coming-pills">
            {COMING_SOON.map((item) => (
              <span key={item} className="landing-coming-pill">
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Integrasi Statistik ---------- */}
      <section className="landing-section" id="integrasi">
        <div className="landing-section-head landing-reveal">
          <span className="landing-section-eyebrow">Alur Kerja</span>
          <h2 className="landing-section-title">Integrasi Statistik</h2>
          <p className="landing-section-sub">Dari data mentah hingga analisis, dalam satu alur.</p>
        </div>
        <div className="landing-steps">
          {STEPS.map((step, i) => (
            <div
              key={step.num}
              className="landing-step landing-reveal"
              style={{ "--reveal-delay": `${i * 90}ms` } as CSSProperties}
            >
              <span className="landing-step-num">{step.num}</span>
              <h3 className="landing-step-title">{step.title}</h3>
              <p className="landing-step-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="landing-cta">
        <div className="landing-cta-card landing-reveal">
          <h2 className="landing-cta-title">
            Kelola data lalu lintas Jawa Barat dalam satu platform.
          </h2>
          <p className="landing-cta-sub">
            Masuk dengan akun Dinas Perhubungan untuk mulai mengelola dataset.
          </p>
          <Link className="landing-btn landing-btn-primary landing-btn-lg" to="/login">
            Masuk
          </Link>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <LandingFooter />
    </div>
  );
}