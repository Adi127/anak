# Panduan sinkron online (Supabase)

Dengan sinkron online, beberapa HP berbagi karya yang sama lewat satu akun keluarga. Data utama tetap di HP, jadi aplikasi tetap jalan offline. Sinkron hanya menyalin data ke Supabase.

Gratis, tanpa kartu. Batas paket gratis Supabase saat panduan ini ditulis: database 500 MB, file 1 GB, dan proyek berhenti otomatis kalau 7 hari tidak ada aktivitas (bisa dihidupkan lagi dari dasbor). Cek angka terbaru di supabase.com/pricing.

## Pemasangan (sekali saja)

1. Buat akun di https://supabase.com, lalu **New project**. Pilih nama bebas, buat kata sandi database (simpan), dan pilih region terdekat (Singapore).
2. Buka **SQL Editor > New query**, tempel seluruh isi `supabase.sql` dari repositori ini, lalu **Run**. Ini membuat tabel, aturan keamanan, dan tempat penyimpanan foto yang privat.
3. Buka **Authentication > Sign In / Providers > Email**, matikan **Confirm email**, lalu Save. Tanpa ini, akun baru harus dikonfirmasi lewat email dulu.
4. Buka **Project Settings > API**. Salin **Project URL** dan **anon public key**.
5. Di repositori GitHub, buka `config.js`, isi `url` dan `kunci` dengan dua nilai tadi, lalu commit. Di `sw.js`, naikkan angka `VERSI` (misalnya `kka-2.0.0` menjadi `kka-2.0.1`) supaya HP memuat versi baru.
6. Tunggu 1-2 menit, buka aplikasi di HP, muat ulang sekali atau dua kali.

## Memakai di tiap HP

1. Buka menu **Cadangan**, bagian **Sinkron online**.
2. HP pertama: isi email dan kata sandi, ketuk **Buat akun**.
3. HP lain: isi email dan kata sandi yang sama, ketuk **Masuk**.
4. Sinkron berjalan otomatis saat aplikasi dibuka dan beberapa detik setelah menyimpan. Tombol **Sinkronkan sekarang** untuk memaksa.

Setelah semua HP masuk, matikan pendaftaran baru supaya orang lain tidak bisa membuat akun: **Authentication > Sign In / Providers**, matikan **Allow new users to sign up**.

## Yang perlu diketahui

- Aturan konflik: perubahan terbaru menang. Kalau dua HP mengubah karya yang sama saat sama-sama offline, yang terakhir disinkronkan dengan waktu paling baru yang dipakai.
- Menghapus karya di satu HP ikut menghapusnya di HP lain dan di Supabase.
- Foto dan rekaman tersimpan di bucket privat. Hanya akun yang masuk yang bisa membukanya.
- Keluar dari akun tidak menghapus data di HP.
- Ekspor cadangan tetap berguna sebagai salinan ketiga.
- Kalau proyek Supabase berhenti karena tidak aktif, sinkron gagal sampai proyek dihidupkan lagi dari dasbor. Data di HP aman.
