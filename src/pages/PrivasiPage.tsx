import { Link } from "react-router-dom";
import LandingFooter from "../components/LandingFooter";

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

export default function PrivasiPage() {
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
          <Link className="landing-legal-back" to="/">
            <BackArrowIcon />
            Beranda
          </Link>
        </div>
      </header>

      <main className="landing-legal-main">
        <article className="landing-legal-article">
          <h1>Kebijakan Privasi</h1>
          <p>
            Kebijakan ini menjelaskan bagaimana Dinas Perhubungan Provinsi Jawa Barat mengelola
            data pribadi pengguna platform Lintas. Kebijakan berlaku untuk seluruh layanan Lintas,
            termasuk pengelolaan dataset, peta interaktif, dan statistik yang ditampilkan.
          </p>

          <h2>Data yang Dikumpulkan</h2>
          <p>Kami mengumpulkan data yang diperlukan untuk menjalankan layanan, yaitu:</p>
          <ul>
            <li>
              <strong>Data akun</strong> — nama, alamat email, dan peran pengguna saat akun
              didaftarkan oleh Dinas Perhubungan.
            </li>
            <li>
              <strong>Data spasial yang diinput</strong> — informasi geografis dan atribut dataset
              yang dimasukkan pengguna melalui jendela pengelolaan data.
            </li>
            <li>
              <strong>Data penggunaan</strong> — catatan aktivitas dasar seperti waktu akses dan
              halaman yang dikunjungi untuk menjaga keamanan layanan.
            </li>
          </ul>

          <h2>Tujuan Penggunaan</h2>
          <p>Data yang dikumpulkan digunakan untuk:</p>
          <ul>
            <li>Menyelenggarakan dan memelihara layanan pengelolaan dataset.</li>
            <li>Memvalidasi, mengintegrasikan, dan mempublikasikan data lalu lintas.</li>
            <li>Menyusun statistik dan pelaporan untuk kepentingan Dinas Perhubungan.</li>
            <li>Menjaga keamanan sistem dan mencegah penyalahgunaan akun.</li>
          </ul>

          <h2>Penyimpanan &amp; Keamanan</h2>
          <p>
            Data disimpan pada infrastruktur yang dikelola dengan standar keamanan yang wajar,
            termasuk kontrol akses berbasis peran dan pencatatan aktivitas. Akses hanya diberikan
            kepada petugas yang berwenang sesuai kebutuhan tugas. Kami menerapkan langkah yang
            layak untuk melindungi data dari akses, perubahan, atau penghapusan yang tidak sah.
          </p>

          <h2>Berbagi Data</h2>
          <p>
            Data pribadi tidak diperjualbelikan dan tidak dibagikan kepada pihak ketiga untuk
            kepentingan komersial. Data yang dikumpulkan digunakan secara internal oleh Dinas
            Perhubungan Provinsi Jawa Barat. Dataset yang telah diterbitkan ke peta publik
            ditampilkan sebagai informasi statistik dan spasial, bukan sebagai data pribadi.
          </p>

          <h2>Hak Pengguna</h2>
          <p>Pengguna berhak untuk:</p>
          <ul>
            <li>Mengakses data pribadi yang tersimpan pada akunnya.</li>
            <li>Meminta perbaikan apabila terdapat data yang tidak akurat.</li>
            <li>Meminta penjelasan mengenai penggunaan data yang dikumpulkan.</li>
          </ul>

          <h2>Perubahan Kebijakan</h2>
          <p>
            Kebijakan ini dapat diperbarui sewaktu-waktu seiring perkembangan layanan atau
            ketentuan peraturan perundang-undangan. Perubahan akan diumumkan melalui halaman ini,
            dan penggunaan layanan setelah perubahan berlaku dianggap sebagai penerimaan terhadap
            kebijakan yang diperbarui.
          </p>

          <h2>Kontak</h2>
          <p>
            Apabila Anda memiliki pertanyaan mengenai kebijakan privasi ini, silakan hubungi kami
            melalui email{" "}
            <a href="mailto:dishub@jabarprov.go.id">dishub@jabarprov.go.id</a> atau telepon{" "}
            <a href="tel:0227207257">022-7207257</a>.
          </p>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}