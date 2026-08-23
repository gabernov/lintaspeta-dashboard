import { Link } from "react-router-dom";
import LandingFooter from "../components/LandingFooter";
import LandingThemeToggle from "../components/LandingThemeToggle";

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

function BackArrowIcon() {
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
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export default function AksesibilitasPage() {
  return (
    <div className="landing landing-legal">
      <header className="landing-legal-topbar">
        <div className="landing-legal-topbar-inner">
          <Link className="landing-brand" to="/" aria-label="Lintas — beranda">
            <span className="landing-brand-mark">
              <BrandMark size={22} />
            </span>
            <span className="landing-brand-text">
              <span className="landing-brand-name">Lintas</span>
              <span className="landing-brand-sub">Lalu Lintas &amp; Integrasi Statistik</span>
            </span>
          </Link>
          <div className="landing-legal-actions">
            <LandingThemeToggle />
            <Link className="landing-legal-back" to="/">
              <BackArrowIcon />
              Beranda
            </Link>
          </div>
        </div>
      </header>

      <main className="landing-legal-main">
        <article className="landing-legal-article">
          <h1>Aksesibilitas</h1>
          <p>
            Dinas Perhubungan Provinsi Jawa Barat berkomitmen menyediakan platform Lintas yang
            dapat diakses oleh seluruh pengguna, termasuk penyandang disabilitas. Halaman ini
            menjelaskan standar, fitur, dan cara melaporkan kendala aksesibilitas yang Anda
            temui.
          </p>

          <h2>Komitmen</h2>
          <p>
            Kami terus berupaya meningkatkan aksesibilitas platform Lintas agar informasi data
            lalu lintas dan statistik dapat diakses secara setara oleh semua orang, pada berbagai
            perangkat dan kondisi penggunaan.
          </p>

          <h2>Standar</h2>
          <p>
            Pengembangan platform Lintas mengacu pada <strong>Web Content Accessibility
            Guidelines (WCAG) 2.1 level AA</strong>. Kami mengevaluasi halaman secara berkala
            untuk memastikan kesesuaian dengan standar tersebut.
          </p>

          <h2>Fitur Aksesibilitas</h2>
          <ul>
            <li>
              <strong>Navigasi keyboard</strong> — seluruh elemen interaktif dapat diakses dan
              dioperasikan menggunakan keyboard, dengan indikator fokus yang terlihat jelas.
            </li>
            <li>
              <strong>Kontras teks</strong> — teks dan elemen antarmuka dirancang dengan kontras
              warna yang memadai terhadap latar belakang.
            </li>
            <li>
              <strong>Dukungan pembaca layar</strong> — struktur halaman, label, dan teks
              alternatif disediakan agar konten dapat dibaca oleh teknologi bantu.
            </li>
            <li>
              <strong>Reduced motion</strong> — animasi dan pergerakan halaman dikurangi atau
              dinonaktifkan sesuai preferensi sistem pengguna.
            </li>
            <li>
              <strong>Responsif</strong> — tata letak menyesuaikan berbagai ukuran layar tanpa
              kehilangan konten atau fungsi.
            </li>
          </ul>

          <h2>Cara Melapor</h2>
          <p>
            Apabila Anda mengalami kendala aksesibilitas atau memiliki saran perbaikan, silakan
            hubungi kami melalui email{" "}
            <a href="mailto:dishub@jabarprov.go.id">dishub@jabarprov.go.id</a>. Kami akan menindak
            lanjuti laporan Anda dan berupaya memperbaiki kendala tersebut.
          </p>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}