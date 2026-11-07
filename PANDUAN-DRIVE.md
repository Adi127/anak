# Panduan Google Drive tiap anak

Foto, rekaman suara, dan video disimpan di Google Drive milik masing-masing anak. Data teks tetap lewat Supabase (lihat PANDUAN-ONLINE.md, kerjakan itu dulu). Anak A memakai akun Google A, anak B akun B, dan seterusnya, jadi kelak tiap anak memegang file miliknya sendiri.

Di Drive tiap anak muncul folder biasa bernama **Katalog Anak - (nama)**, berisi file seperti `2026-11-01 Rumahku (foto).jpg` dan `2026-11-01 Rumahku (video).mp4`. Aplikasi hanya bisa membaca file yang dibuatnya sendiri (izin `drive.file`), bukan seluruh isi Drive.

## Pemasangan Google Cloud (sekali saja)

1. Buka https://console.cloud.google.com, buat project baru, misalnya "Katalog Anak".
2. **APIs & Services > Library**, cari **Google Drive API**, klik **Enable**.
3. **APIs & Services > OAuth consent screen** (atau Google Auth Platform): pilih **External**, isi nama aplikasi dan emailmu. Tambahkan scope `.../auth/drive.file`. Ubah status ke **In production** supaya akun anak mana pun bisa dipakai tanpa didaftarkan satu per satu dan izinnya tidak kedaluwarsa 7 hari. Scope ini non-sensitif, jadi seharusnya tidak perlu verifikasi Google, tetapi layar izin bisa memperlihatkan peringatan "aplikasi belum diverifikasi". Ketuk Lanjutkan.
4. **Credentials > Create credentials > OAuth client ID**, jenis **Web application**. Di **Authorized JavaScript origins** isi `https://adi127.github.io` (tanpa garis miring di belakang).
5. Salin **Client ID** (berakhiran `.apps.googleusercontent.com`) ke `config.js` pada baris `googleClientId`, commit, lalu naikkan angka `VERSI` di `sw.js`.

## Memakai di HP

1. Buka halaman anak, bagian **Google Drive**, ketuk **Hubungkan Google Drive**, lalu pilih akun Google anak itu.
2. Lakukan hal yang sama di HP lain untuk tiap anak. Foto dan rekaman diunduh otomatis; video diunduh saat dibuka (tombol di halaman karya).
3. Izin Google berlaku sekitar satu jam. Setelah itu muncul tombol **Hubungkan ulang** (di halaman anak dan menu Cadangan). Selama belum dihubungkan, teks tetap tersinkron dan media menunggu. Statusnya tampil sebagai "N karya menunggu Drive".

## Anak baru, atau pindah akun

- Anak baru: tambahkan anak, lalu hubungkan ke akun Googlenya. Sebelum dihubungkan, karyanya tetap tersimpan di HP dan akan terunggah saat sudah terhubung.
- Ganti akun: ketuk **Ganti akun** dan pilih akun baru. Media baru masuk ke akun baru; file lama tetap di akun lama dan perlu disalin sendiri lewat Drive.
- Satu akun boleh dipakai beberapa anak. Foldernya tetap dipisah per anak.

## Batas dan hal yang perlu diketahui

- Video: maksimal 3 menit dan 300 MB per karya, satu video per karya. Video dari kamera HP sekitar 9 MB per menit, jadi 15 GB Drive muat ratusan video.
- Video tidak ikut file cadangan (Ekspor cadangan) karena terlalu besar; videonya aman di Drive.
- Menghapus karya juga menghapus file-nya di Drive anak. Kalau Drive belum terhubung saat itu, penghapusan menunggu sampai terhubung.
- Mengubah foto atau rekaman hanya bisa dilakukan di HP yang sudah mengunduh medianya. Teks karya selalu bisa diubah.
- Kuota Drive 15 GB dibagi dengan Gmail dan Google Photos akun itu.
