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

export default function KetentuanPage() {
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
          <h1>Syarat &amp; Ketentuan</h1>
          <p>
            Syarat dan ketentuan ini mengatur penggunaan platform Lintas yang diselenggarakan oleh
            Dinas Perhubungan Provinsi Jawa Barat. Dengan mengakses atau menggunakan layanan ini,
            Anda dianggap telah membaca, memahami, dan menyetujui seluruh ketentuan yang berlaku.
          </p>

          <h2>Penerimaan Ketentuan</h2>
          <p>
            Penggunaan platform Lintas berarti Anda menyetujui syarat dan ketentuan ini serta
            kebijakan privasi yang berlaku. Apabila Anda tidak menyetujui sebagian atau seluruh
            ketentuan, Anda tidak diperkenankan menggunakan layanan ini.
          </p>

          <h2>Akses &amp; Akun</h2>
          <p>
            Lintas diperuntukkan bagi petugas dan pejabat Dinas Perhubungan Provinsi Jawa Barat
            serta pihak yang diberi wewenang. Akun dibuat dan dikelola secara resmi oleh Dinas
            Perhubungan dengan peran tertentu, seperti pengelola data atau peninjau. Setiap
            pengguna bertanggung jawab menjaga kerahasiaan kredensial akunnya dan seluruh aktivitas
            yang dilakukan melalui akun tersebut.
          </p>

          <h2>Penggunaan Layanan</h2>
          <p>
            Layanan pengelolaan dataset mengikuti alur kerja yang telah ditetapkan: data masuk
            sebagai <strong>draft</strong>, divalidasi, diintegrasikan secara spasial, lalu
            diterbitkan menjadi <strong>terbit</strong> melalui proses peninjauan. Pengguna wajib
            memastikan data yang dimasukkan akurat, lengkap, dan sesuai dengan ketentuan teknis
            yang berlaku.
          </p>

          <h2>Tanggung Jawab Pengguna</h2>
          <ul>
            <li>Memasukkan data yang benar dan dapat dipertanggungjawabkan.</li>
            <li>Tidak menyalahgunakan akses atau mengubah data di luar kewenangan perannya.</li>
            <li>Tidak menggunakan layanan untuk kepentingan di luar tugas kedinasan.</li>
            <li>Melaporkan dugaan penyalahgunaan akun atau data kepada pengelola.</li>
          </ul>

          <h2>Kekayaan Intelektual</h2>
          <p>
            Seluruh antarmuka, kode, desain, dan materi platform Lintas merupakan kekayaan Dinas
            Perhubungan Provinsi Jawa Barat. Data yang dikelola melalui platform ini merupakan data
            milik Pemerintah Provinsi Jawa Barat dan digunakan untuk kepentingan pelayanan publik
            serta perencanaan transportasi.
          </p>

          <h2>Batasan Tanggung Jawab</h2>
          <p>
            Dinas Perhubungan Provinsi Jawa Barat berupaya menjaga ketersediaan dan keakuratan
            layanan, namun tidak menjamin layanan bebas dari gangguan atau data bebas dari
            kesalahan. Penggunaan data dan informasi pada platform ini sepenuhnya menjadi tanggung
            jawab pengguna.
          </p>

          <h2>Pengakhiran</h2>
          <p>
            Dinas Perhubungan dapat menangguhkan atau mengakhiri akses akun apabila ditemukan
            pelanggaran terhadap ketentuan ini, penyalahgunaan data, atau indikasi tindakan yang
            membahayakan keamanan sistem.
          </p>

          <h2>Perubahan</h2>
          <p>
            Syarat dan ketentuan ini dapat diperbarui sewaktu-waktu. Perubahan akan diumumkan
            melalui halaman ini dan berlaku sejak diumumkan. Penggunaan layanan setelah perubahan
            dianggap sebagai penerimaan terhadap ketentuan yang diperbarui.
          </p>

          <h2>Hukum yang Berlaku</h2>
          <p>
            Syarat dan ketentuan ini tunduk pada hukum yang berlaku di Republik Indonesia. Segala
            perselisihan yang timbul akan diselesaikan secara musyawarah, dan apabila tidak
            tercapai kesepakatan, diselesaikan melalui mekanisme hukum yang berlaku.
          </p>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}