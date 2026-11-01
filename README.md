# Katalog Karya Anak

Katalog pribadi foto karya anak beserta cerita (ketik atau rekam suara). Web app (PWA) tanpa server, tanpa akun, tanpa library luar. Semua data tersimpan di browser HP (IndexedDB).

Alamat aplikasi: https://adi127.github.io/anak/

## Fitur

- Daftar anak, usia dihitung otomatis dari tanggal lahir
- Tambah karya: foto (kamera atau galeri) + anak + lokasi wajib; judul, cerita, rekaman suara, acara, isi gambar, tanggal opsional
- Galeri per anak, pencarian (lokasi, acara, isi gambar, cerita) dengan filter cepat
- Ekspor dan impor cadangan (.json), pengingat di beranda setelah 10 karya baru
- Jalan offline setelah dibuka pertama kali

## Mencoba di komputer

```
python3 -m http.server 8080
```

Buka http://localhost:8080 di Chrome. Kamera dan mikrofon di HP hanya jalan lewat HTTPS, jadi untuk uji di HP pakai alamat hasil deploy.

## Deploy gratis (GitHub Pages)

1. Di repositori ini: Settings > Pages > Source: Deploy from a branch > main, folder / (root) > Save.
2. Tunggu 1-2 menit, buka `https://adi127.github.io/anak/` di Chrome Android.
3. Menu titik tiga > Instal aplikasi (atau Tambahkan ke layar utama).

Alternatif: Cloudflare Pages, build command kosong, output directory `/`.

## Penting

- Data terikat pada alamat situs. Jangan ganti nama repositori atau domain setelah ada data asli. Kalau terpaksa, ekspor cadangan dulu lalu impor di alamat baru.
- Data hilang kalau data browser dihapus atau HP hilang. Ekspor cadangan berkala dari menu Cadangan dan simpan file-nya di Google Drive atau laptop.
- Setiap kali mengubah file aplikasi, naikkan `VERSI` di `sw.js` supaya HP mengunduh versi baru.
- Repositori publik aman: yang di-upload hanya kode, foto dan data anak tidak pernah masuk GitHub.
