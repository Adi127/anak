// Pengaturan sinkron online (opsional). Biarkan kosong kalau tidak dipakai.
// url dan kunci: "Project URL" dan "anon public key" dari Supabase (Project Settings > API).
// googleClientId: Client ID OAuth dari Google Cloud Console, untuk menyimpan foto, rekaman,
//   dan video di Google Drive tiap anak (lihat PANDUAN-DRIVE.md). Kosong = media hanya di HP.
// Semua nilai ini memang boleh publik; data dilindungi aturan Supabase dan izin akun Google.
// Setiap kali file ini diubah, naikkan VERSI di sw.js supaya HP memuat versi baru.
window.KONFIG = {
  url: '',
  kunci: '',
  googleClientId: ''
};
