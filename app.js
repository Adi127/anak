'use strict';
const VERSI = '2.1.0';

/* ---------- Database (IndexedDB) ---------- */
let db;
function bukaDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('katalog-karya-anak', 2);
    r.onupgradeneeded = e => {
      const d = r.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('anak', { keyPath: 'id' });
        d.createObjectStore('karya', { keyPath: 'id' }).createIndex('anakId', 'anakId');
        d.createObjectStore('meta', { keyPath: 'k' });
      }
      if (e.oldVersion < 2) d.createObjectStore('tomb', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const semua = s => tx(s, 'readonly', o => o.getAll());
const ambil = (s, id) => tx(s, 'readonly', o => o.get(id));
const simpan = async (s, v) => {
  const r = await tx(s, 'readwrite', o => o.put(v));
  if ((s === 'anak' || s === 'karya') && window.jadwalSinkron) window.jadwalSinkron();
  return r;
};
const hapus = async (s, id) => {
  const lama = s === 'karya' ? await ambil('karya', id) : null;
  await tx(s, 'readwrite', o => o.delete(id));
  if (lama && lama._drive && window.tandaiHapusDrive) await window.tandaiHapusDrive(lama.anakId, idDrive(lama._drive));
  await tx('tomb', 'readwrite', o => o.put({ k: s + ':' + id, s, id, diubah: new Date().toISOString() }));
  if (window.jadwalSinkron) window.jadwalSinkron();
};
const getMeta = async k => { const r = await ambil('meta', k); return r ? r.v : undefined; };
const setMeta = (k, v) => simpan('meta', { k, v });
const idDrive = dr => dr ? [dr.foto && dr.foto.id, dr.video && dr.video.id].concat((dr.suara || []).map(e => e && e.id)).filter(Boolean) : [];

/* ---------- Alat bantu ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const hariIni = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function tglIndo(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}
function hitungUsia(lahir, tgl) {
  if (!lahir || !tgl) return '';
  const a = new Date(lahir + 'T00:00:00'), b = new Date(tgl + 'T00:00:00');
  let bln = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) bln--;
  if (bln < 0) return '';
  const th = Math.floor(bln / 12), sisa = bln % 12;
  if (th === 0) return `${sisa} bln`;
  return sisa ? `${th} th ${sisa} bln` : `${th} th`;
}
let toastT;
function toast(pesan) {
  const t = $('#toast');
  t.textContent = pesan;
  t.classList.add('tampil');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('tampil'), 2600);
}
let urls = [];
function urlBlob(b) { const u = URL.createObjectURL(b); urls.push(u); return u; }
function bersihkanUrl() { urls.forEach(URL.revokeObjectURL); urls = []; }

async function kompres(file, maks, mutu) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const r = Math.min(1, maks / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r);
  c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise(res => c.toBlob(res, 'image/jpeg', mutu));
}
const GAMBAR_KOSONG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f3e3d3"/><path d="M30 62 L45 44 L56 56 L64 48 L72 62 Z" fill="#e0c3a6"/><circle cx="64" cy="36" r="6" fill="#e0c3a6"/></svg>');
const srcGbr = k => (k.thumb || k.foto) ? urlBlob(k.thumb || k.foto) : GAMBAR_KOSONG;
const adaVideo = k => !!(k.video || (k._drive && k._drive.video));
const MAKS_VIDEO_DETIK = 180, MAKS_VIDEO_BYTE = 300 * 1048576;
const durasiVideo = f => new Promise(res => {
  const v = document.createElement('video'), u = URL.createObjectURL(f);
  v.preload = 'metadata';
  v.onloadedmetadata = () => { URL.revokeObjectURL(u); res(isFinite(v.duration) ? v.duration : null); };
  v.onerror = () => { URL.revokeObjectURL(u); res(null); };
  v.src = u;
});
// Satu gambar dari video, dipakai sebagai sampul kalau karya hanya berisi video.
const posterVideo = blob => new Promise(res => {
  const v = document.createElement('video'), u = URL.createObjectURL(blob);
  let selesai = false;
  const akhir = x => { if (selesai) return; selesai = true; URL.revokeObjectURL(u); res(x); };
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.onerror = () => akhir(null);
  v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
  v.onseeked = async () => {
    try {
      const r = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * r); c.height = Math.round(v.videoHeight * r);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const foto = await new Promise(rs => c.toBlob(rs, 'image/jpeg', 0.85));
      akhir({ foto, thumb: await kompres(foto, 400, 0.8) });
    } catch (e) { akhir(null); }
  };
  v.src = u;
  setTimeout(() => akhir(null), 8000);
});
const blobKeDataUrl = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
const dataUrlKeBlob = async u => (await fetch(u)).blob();

function unduh(blob, nama) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nama;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/* ---------- Router ---------- */
const main = () => $('#main');
let renderId = 0;
async function rute() {
  const id = ++renderId;
  bersihkanUrl();
  const [r, a] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('on', x.dataset.r === (r || 'beranda')));
  setJudul('Katalog Karya Anak');
  try {
    if (!r) await layarBeranda(id);
    else if (r === 'anak' && a === 'baru') await layarFormAnak(id);
    else if (r === 'anak') await layarAnak(id, a);
    else if (r === 'tambah') await layarFormKarya(id, null, a);
    else if (r === 'ubah') await layarFormKarya(id, a);
    else if (r === 'karya') await layarDetail(id, a);
    else if (r === 'cari') await layarCari(id);
    else if (r === 'pengaturan') await layarPengaturan(id);
    else location.hash = '#/';
  } catch (e) {
    console.error(e);
    main().innerHTML = `<div class="kosong">Terjadi kesalahan: ${esc(e.message || e)}</div>`;
  }
  window.scrollTo(0, 0);
}
function setJudul(t, kembali) {
  $('#bar').innerHTML = (kembali ? `<a href="${kembali}" aria-label="Kembali">&larr;</a>` : '') + `<h1 id="judul">${esc(t)}</h1>`;
}
window.addEventListener('hashchange', rute);

/* ---------- Galeri ---------- */
function htmlGrid(daftar, anakMap) {
  if (!daftar.length) return '';
  return `<div class="grid">${daftar.map(k => {
    const ket = k.judul || k.lokasi;
    return `<a href="#/karya/${k.id}"><img src="${srcGbr(k)}" alt="${esc(ket)}" loading="lazy">${adaVideo(k) ? '<i class="vid">&#9654;</i>' : ''}<span class="tag">${esc(ket)}</span></a>`;
  }).join('')}</div>`;
}
const urutTerbaru = (a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || (b.dibuat || '').localeCompare(a.dibuat || '');

/* ---------- Beranda ---------- */
const MASKOT = `<svg viewBox="0 0 80 120" width="60" height="90" aria-hidden="true"><g transform="rotate(8 40 60)"><rect x="22" y="30" width="36" height="76" rx="6" fill="#e8734a"/><rect x="22" y="52" width="36" height="20" fill="#fff8f1"/><path d="M22 30 L40 4 L58 30 Z" fill="#c9552e"/><circle cx="33" cy="86" r="3.2" fill="#2d2622"/><circle cx="47" cy="86" r="3.2" fill="#2d2622"/><path d="M33 95 Q40 101 47 95" stroke="#2d2622" stroke-width="2.4" fill="none" stroke-linecap="round"/></g></svg>`;
function htmlJemuran(daftar, linkKosong) {
  const warna = ['#f6b93b', '#6bbf8a', '#5aa9e6', '#e8734a'], miring = [-3, 2, -2, 3];
  let isi = daftar.map((k, i) => {
    const ket = k.judul || k.lokasi;
    return `<a class="gantung" style="--r:${miring[i % 4]}deg" href="#/karya/${k.id}"><i class="jepit" style="background:${warna[i % 4]}"></i><img src="${srcGbr(k)}" alt="${esc(ket)}"><span>${esc(ket)}</span></a>`;
  }).join('');
  for (let i = daftar.length; i < 4; i++) {
    isi += `<a class="gantung kosong" style="--r:${miring[i % 4]}deg" href="${linkKosong}"><i class="jepit" style="background:${warna[i % 4]}"></i><div class="slot">+</div><span>Karya</span></a>`;
  }
  return `<div class="jemuran"><div class="tali"></div><div class="gantungan">${isi}</div></div>`;
}
async function layarBeranda(id) {
  const [anak, karya, eks, sejak] = await Promise.all([semua('anak'), semua('karya'), getMeta('eksporTerakhir'), getMeta('karyaSejakEkspor')]);
  if (id !== renderId) return;
  karya.sort(urutTerbaru);
  let h = '';
  const hariLalu = eks ? (Date.now() - new Date(eks).getTime()) / 864e5 : null;
  if (karya.length && ((sejak || 0) >= 10 || (hariLalu === null) || (hariLalu >= 30 && (sejak || 0) > 0))) {
    h += `<div class="info">Data hanya ada di HP ini. ${eks ? 'Cadangan terakhir ' + tglIndo(eks.slice(0, 10)) + '.' : 'Belum pernah dicadangkan.'} <a href="#/pengaturan">Buat cadangan sekarang</a></div>`;
  }
  let sapa, petunjuk;
  if (!anak.length) { sapa = 'Selamat datang!'; petunjuk = 'Mulai dengan menambahkan anak, lalu simpan karya pertamanya.'; }
  else if (!karya.length) { sapa = 'Siap menyimpan!'; petunjuk = 'Ketuk tombol + di bawah untuk menyimpan karya pertama.'; }
  else {
    const tempat = new Set(karya.map(k => k.lokasi)).size;
    sapa = `${karya.length} karya tersimpan`;
    petunjuk = `Dari ${tempat} tempat. Ketuk + untuk menambah, atau Cari untuk menemukan karya lewat nama tempat.`;
  }
  h += `<div class="hero">${MASKOT}<div><div class="hero-judul">${esc(sapa)}</div><div class="redup">${esc(petunjuk)}</div></div></div>`;
  h += `<h2>Karya terbaru</h2>` + htmlJemuran(karya.slice(0, 4), anak.length ? '#/tambah' : '#/anak/baru');
  h += `<h2>Anak</h2>`;
  if (!anak.length) {
    h += `<a class="tombol penuh-lebar" href="#/anak/baru">+ Tambah anak</a>`;
  } else {
    anak.sort((a, b) => a.nama.localeCompare(b.nama));
    h += anak.map(a => {
      const milik = karya.filter(k => k.anakId === a.id);
      const terakhir = milik[0];
      const avatar = terakhir ? `<img class="avatar foto" src="${srcGbr(terakhir)}" alt="">` : `<div class="avatar">${esc(a.nama.charAt(0).toUpperCase())}</div>`;
      return `<div class="kartu"><a class="anak-item" href="#/anak/${a.id}">${avatar}<div><strong>${esc(a.nama)}</strong><div class="redup">${milik.length} karya${a.lahir ? ' · ' + hitungUsia(a.lahir, hariIni()) : ''}</div></div></a></div>`;
    }).join('');
    h += `<a class="tombol sekunder" href="#/anak/baru">+ Tambah anak</a>`;
  }
  main().innerHTML = h;
}

/* ---------- Form anak ---------- */
async function layarFormAnak(id) {
  setJudul('Tambah anak', '#/');
  main().innerHTML = `<form id="f">
    <label>Nama</label><input id="nama" maxlength="40" required autocomplete="off">
    <label>Tanggal lahir <small>(opsional, untuk menghitung usia)</small></label><input id="lahir" type="date">
    <button class="penuh" type="submit">Simpan</button></form>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const nama = $('#nama').value.trim();
    if (!nama) return;
    const ada = (await semua('anak')).some(a => a.nama.toLowerCase() === nama.toLowerCase());
    if (ada) return toast('Nama itu sudah ada');
    const sekarang = new Date().toISOString();
    await simpan('anak', { id: uid(), nama, lahir: $('#lahir').value || null, dibuat: sekarang, diubah: sekarang });
    toast('Anak disimpan');
    location.hash = '#/';
  };
}

/* ---------- Halaman anak ---------- */
async function layarAnak(id, anakId) {
  const a = await ambil('anak', anakId);
  if (!a) { location.hash = '#/'; return; }
  const karya = (await tx('karya', 'readonly', o => o.index('anakId').getAll(anakId))).sort(urutTerbaru);
  if (id !== renderId) return;
  setJudul(a.nama, '#/');
  let h = `<div class="baris" style="margin-bottom:10px"><a class="tombol" href="#/tambah/${a.id}">+ Tambah karya</a></div>`;
  h += karya.length ? htmlGrid(karya) : `<div class="kosong">Belum ada karya untuk ${esc(a.nama)}.</div>`;
  h += `<h2>Data anak</h2><div class="kartu"><div class="redup">Lahir: ${a.lahir ? tglIndo(a.lahir) : '-'}</div>
    <div class="baris" style="margin-top:10px"><button class="sekunder" id="ubahA">Ubah nama</button><button class="bahaya" id="hapusA">Hapus anak</button></div></div>`;
  h += '<div id="boxDrive"></div>';
  main().innerHTML = h;
  if (window.renderDriveAnak) window.renderDriveAnak($('#boxDrive'), a);
  $('#ubahA').onclick = async () => {
    const n = prompt('Nama baru:', a.nama);
    if (n && n.trim()) { a.nama = n.trim().slice(0, 40); a.diubah = new Date().toISOString(); await simpan('anak', a); rute(); }
  };
  $('#hapusA').onclick = async () => {
    if (karya.length) return toast('Anak yang masih punya karya tidak bisa dihapus');
    if (confirm(`Hapus ${a.nama}?`)) { await hapus('anak', a.id); location.hash = '#/'; }
  };
}

/* ---------- Form karya (tambah dan ubah) ---------- */
async function layarFormKarya(id, editId, anakAwal) {
  const anak = await semua('anak');
  if (id !== renderId) return;
  if (!anak.length) {
    setJudul('Tambah karya');
    main().innerHTML = `<div class="kosong">Tambahkan anak dulu sebelum menyimpan karya.<br><br><a class="tombol" href="#/anak/baru">+ Tambah anak</a></div>`;
    return;
  }
  const lama = editId ? await ambil('karya', editId) : null;
  if (editId && !lama) { location.hash = '#/'; return; }
  const semuaKarya = await semua('karya');
  const lokasiSaran = [...new Set(semuaKarya.map(k => k.lokasi).filter(Boolean))];
  const acaraSaran = [...new Set(semuaKarya.map(k => k.acara).filter(Boolean))];
  const anakTerakhir = lama ? lama.anakId : (anakAwal || (await getMeta('anakTerakhir')) || anak[0].id);
  setJudul(lama ? 'Ubah karya' : 'Tambah karya', lama ? '#/karya/' + lama.id : '#/');

  // Media yang masih di Drive dan belum diunduh ke HP ini tidak boleh diubah dari sini.
  const dr0 = lama && lama._drive ? lama._drive : null;
  const nSuara = Math.max(lama ? (lama.suara || []).length : 0, dr0 ? (dr0.suara || []).length : 0);
  const kurang = !!(lama && dr0 && ((dr0.foto && !lama.foto) || (dr0.suara || []).some((e, i) => e && !(lama.suara || [])[i])));
  const videoDiDrive = !!(dr0 && dr0.video && !(lama && lama.video));
  const kunciAnak = !!(dr0 && (kurang || videoDiDrive));
  const d = {
    foto: lama ? lama.foto : null, thumb: lama ? lama.thumb : null, tanggal: lama ? lama.tanggal : hariIni(),
    suara: Array.from({ length: nSuara }, (_, i) => (lama && (lama.suara || [])[i]) || null),
    suaraDr: Array.from({ length: nSuara }, (_, i) => (dr0 && (dr0.suara || [])[i]) || null),
    video: lama ? (lama.video || null) : null, videoDihapus: false, yatim: []
  };

  main().innerHTML = `<form id="f">
    ${kurang ? '<div class="info">Foto atau rekaman karya ini masih di Google Drive dan belum diunduh ke HP ini. Hubungkan Drive anak dari halaman anak untuk mengubah foto atau rekaman. Teksnya tetap bisa diubah.</div>' : ''}
    <div class="pilih-foto" ${kurang ? 'hidden' : ''}>
      <button type="button" class="sekunder" id="bKamera">Foto dengan kamera</button>
      <button type="button" class="sekunder" id="bGaleri">Pilih dari galeri</button>
    </div>
    <input type="file" id="fKamera" accept="image/*" capture="environment" hidden>
    <input type="file" id="fGaleri" accept="image/*" hidden>
    <img id="prev" alt="" ${d.foto ? `src="${urlBlob(d.foto)}"` : 'hidden'}>
    <label>Anak</label>
    <select id="anak" ${kunciAnak ? 'disabled' : ''}>${anak.map(a => `<option value="${a.id}" ${a.id === anakTerakhir ? 'selected' : ''}>${esc(a.nama)}</option>`).join('')}</select>
    <label>Lokasi <small>(nama tempat sehari-hari, misalnya Rumah nenek)</small></label>
    <input id="lokasi" list="lokList" maxlength="80" autocomplete="off" required value="${esc(lama ? lama.lokasi : '')}">
    <datalist id="lokList">${lokasiSaran.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
    <label>Judul <small>(opsional)</small></label>
    <input id="judulK" maxlength="80" value="${esc(lama ? lama.judul : '')}">
    <label>Cerita di balik karya <small>(opsional)</small></label>
    <textarea id="cerita">${esc(lama ? lama.cerita : '')}</textarea>
    <div ${kurang ? 'hidden' : ''}>
      <label>Rekaman suara cerita <small>(opsional)</small></label>
      <div class="baris"><button type="button" class="sekunder" id="bRek">Mulai rekam</button><span id="rekStatus" class="redup"></span></div>
    </div>
    <div id="daftarSuara"></div>
    <label>Video <small>(opsional, maksimal 3 menit)</small></label>
    <div id="boxVideo"></div>
    <input type="file" id="fVidKamera" accept="video/*" capture="environment" hidden>
    <input type="file" id="fVidGaleri" accept="video/*" hidden>
    <label>Acara <small>(opsional, misalnya Lomba 17 Agustus)</small></label>
    <input id="acara" list="acrList" maxlength="80" autocomplete="off" value="${esc(lama ? lama.acara : '')}">
    <datalist id="acrList">${acaraSaran.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
    <label>Isi gambar <small>(opsional, pisahkan dengan koma: rumah, kucing, pelangi)</small></label>
    <input id="isi" maxlength="120" value="${esc(lama ? (lama.isi || []).join(', ') : '')}">
    <label>Tanggal</label>
    <input id="tanggal" type="date" value="${esc(d.tanggal)}" required>
    <button class="penuh" type="submit" id="bSimpan">Simpan</button>
  </form>`;

  const pasangFoto = async file => {
    if (!file) return;
    try {
      d.foto = await kompres(file, 1600, 0.85);
      d.thumb = await kompres(file, 400, 0.8);
      if (file.lastModified && file.name) d.tanggal = new Date(file.lastModified).toISOString().slice(0, 10);
      if (!lama || !$('#tanggal').value) $('#tanggal').value = d.tanggal;
      const p = $('#prev');
      p.src = urlBlob(d.foto);
      p.hidden = false;
    } catch (e) { toast('Foto tidak bisa dibaca'); }
  };
  $('#bKamera').onclick = () => $('#fKamera').click();
  $('#bGaleri').onclick = () => $('#fGaleri').click();
  $('#fKamera').onchange = e => pasangFoto(e.target.files[0]);
  $('#fGaleri').onchange = e => pasangFoto(e.target.files[0]);

  const gambarSuara = () => {
    $('#daftarSuara').innerHTML = d.suara.map((s, i) => s
      ? `<div class="kartu"><audio controls src="${urlBlob(s)}"></audio>${kurang ? '' : `<button type="button" class="bahaya" data-i="${i}" style="margin-top:8px">Hapus rekaman</button>`}</div>`
      : '<div class="kartu redup">Rekaman ada di Google Drive, belum diunduh ke HP ini.</div>').join('');
    $('#daftarSuara').querySelectorAll('button').forEach(b => b.onclick = () => {
      const i = +b.dataset.i;
      if (d.suaraDr[i]) d.yatim.push(d.suaraDr[i].id);
      d.suara.splice(i, 1); d.suaraDr.splice(i, 1);
      gambarSuara();
    });
  };
  gambarSuara();

  const gambarVideo = () => {
    const el = $('#boxVideo');
    if (d.video) {
      el.innerHTML = `<div class="kartu"><video controls playsinline preload="metadata" src="${urlBlob(d.video)}"></video><div class="redup">${(d.video.size / 1048576).toFixed(1)} MB</div><button type="button" class="bahaya" id="bHapusVid" style="margin-top:8px">Hapus video</button></div>`;
      $('#bHapusVid').onclick = () => { d.video = null; d.videoDihapus = true; gambarVideo(); };
    } else if (videoDiDrive && !d.videoDihapus) {
      el.innerHTML = '<div class="kartu redup">Video karya ini ada di Google Drive. Buka halaman karya untuk mengunduh dan memutarnya.</div>';
    } else {
      el.innerHTML = '<div class="pilih-foto"><button type="button" class="sekunder" id="bVidKamera">Rekam video</button><button type="button" class="sekunder" id="bVidGaleri">Pilih video</button></div>';
      $('#bVidKamera').onclick = () => $('#fVidKamera').click();
      $('#bVidGaleri').onclick = () => $('#fVidGaleri').click();
    }
  };
  gambarVideo();
  const pasangVideo = async file => {
    if (!file) return;
    if (file.size > MAKS_VIDEO_BYTE) return toast('Video terlalu besar (maksimal 300 MB)');
    const dur = await durasiVideo(file);
    if (dur && dur > MAKS_VIDEO_DETIK + 5) return toast('Video terlalu panjang (maksimal 3 menit)');
    if (!d.foto) {
      const p = await posterVideo(file);
      if (!p) return toast('Sampul video tidak bisa dibuat. Pilih foto dulu, lalu pilih videonya lagi.');
      d.foto = p.foto; d.thumb = p.thumb;
      const pv = $('#prev'); pv.src = urlBlob(d.foto); pv.hidden = false;
    }
    d.video = new Blob([file], { type: file.type || 'video/mp4' });
    d.videoDihapus = false;
    gambarVideo();
  };
  $('#fVidKamera').onchange = e => pasangVideo(e.target.files[0]);
  $('#fVidGaleri').onchange = e => pasangVideo(e.target.files[0]);

  let rec = null, stream = null, chunks = [], timer = null, detik = 0;
  $('#bRek').onclick = async () => {
    if (rec) { rec.stop(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { return toast('Izin mikrofon ditolak'); }
    const tipe = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    rec = tipe ? new MediaRecorder(stream, { mimeType: tipe }) : new MediaRecorder(stream);
    chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      d.suara.push(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      d.suaraDr.push(null);
      rec = null;
      $('#bRek').textContent = 'Mulai rekam';
      $('#rekStatus').textContent = '';
      gambarSuara();
    };
    rec.start();
    detik = 0;
    $('#bRek').textContent = 'Berhenti';
    $('#rekStatus').innerHTML = '<span class="rek">● Merekam 0:00</span>';
    timer = setInterval(() => {
      detik++;
      $('#rekStatus').innerHTML = `<span class="rek">● Merekam ${Math.floor(detik / 60)}:${String(detik % 60).padStart(2, '0')}</span>`;
      if (detik >= 300) rec.stop();
    }, 1000);
  };

  $('#f').onsubmit = async e => {
    e.preventDefault();
    if (rec) return toast('Hentikan rekaman dulu');
    if (!d.foto && !kurang) return toast('Pilih foto atau video dulu');
    const lokasi = $('#lokasi').value.trim();
    if (!lokasi) return toast('Lokasi wajib diisi');
    $('#bSimpan').disabled = true;
    const anakBaru = $('#anak').value;
    let yatim = d.yatim.slice(), drBaru = null;
    if (dr0) {
      if (lama.anakId !== anakBaru) yatim = idDrive(dr0);   // pindah anak: media diunggah ulang ke Drive anak baru
      else {
        if (d.videoDihapus && dr0.video) yatim.push(dr0.video.id);
        drBaru = Object.assign({}, dr0, { suara: d.suaraDr.slice(), video: d.videoDihapus ? null : dr0.video });
      }
    }
    const rec2 = {
      id: lama ? lama.id : uid(),
      anakId: anakBaru,
      foto: d.foto, thumb: d.thumb, video: d.video,
      lokasi,
      judul: $('#judulK').value.trim(),
      cerita: $('#cerita').value.trim(),
      acara: $('#acara').value.trim(),
      isi: $('#isi').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      tanggal: $('#tanggal').value || hariIni(),
      suara: d.suara,
      dibuat: lama ? lama.dibuat : new Date().toISOString(),
      diubah: new Date().toISOString()
    };
    if (drBaru) rec2._drive = drBaru;
    try {
      if (yatim.length && window.tandaiHapusDrive) await window.tandaiHapusDrive(lama.anakId, yatim);
      await simpan('karya', rec2);
      await setMeta('anakTerakhir', rec2.anakId);
      if (!lama) await setMeta('karyaSejakEkspor', ((await getMeta('karyaSejakEkspor')) || 0) + 1);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      toast('Karya disimpan');
      location.hash = '#/karya/' + rec2.id;
    } catch (err) {
      $('#bSimpan').disabled = false;
      toast('Gagal menyimpan: ' + (err && err.name === 'QuotaExceededError' ? 'penyimpanan penuh' : 'coba lagi'));
    }
  };
}

/* ---------- Detail karya ---------- */
async function layarDetail(id, karyaId) {
  const k = await ambil('karya', karyaId);
  if (!k) { location.hash = '#/'; return; }
  const a = await ambil('anak', k.anakId);
  if (id !== renderId) return;
  setJudul(k.judul || k.lokasi, a ? '#/anak/' + a.id : '#/');
  const usia = a && a.lahir ? hitungUsia(a.lahir, k.tanggal) : '';
  const dr = k._drive || {};
  const drFoto = !k.foto && dr.foto, drVideo = !k.video && dr.video;
  const MB = e => e && e.size ? ` (${(e.size / 1048576).toFixed(1)} MB)` : '';
  main().innerHTML = `${k.foto ? `<img class="foto-besar" src="${urlBlob(k.foto)}" alt="${esc(k.judul || k.lokasi)}">` : `<div class="kartu" id="boxFoto"><img class="foto-besar" src="${GAMBAR_KOSONG}" alt=""><div class="redup" id="boxFotoTeks" style="margin-top:8px"></div></div>`}
    ${k.video ? `<div class="kartu" style="margin-top:12px"><div class="redup">Video</div><video controls playsinline preload="metadata" ${k.thumb ? `poster="${urlBlob(k.thumb)}"` : ''} src="${urlBlob(k.video)}"></video></div>` : ''}
    ${drVideo ? '<div class="kartu" style="margin-top:12px" id="boxVid"><div class="redup">Video</div><div id="boxVidTeks" style="margin:6px 0"></div></div>' : ''}
    <div class="kartu" style="margin-top:12px"><dl style="margin:0">
      <dt>Anak</dt><dd>${esc(a ? a.nama : '-')}${usia ? ' · ' + usia : ''}</dd>
      <dt>Lokasi</dt><dd>${esc(k.lokasi)}</dd>
      <dt>Tanggal</dt><dd>${tglIndo(k.tanggal)}</dd>
      ${k.acara ? `<dt>Acara</dt><dd>${esc(k.acara)}</dd>` : ''}
      ${k.isi && k.isi.length ? `<dt>Isi gambar</dt><dd>${esc(k.isi.join(', '))}</dd>` : ''}
      ${k.cerita ? `<dt>Cerita</dt><dd style="white-space:pre-wrap">${esc(k.cerita)}</dd>` : '<dt>Cerita</dt><dd class="redup">Belum ada cerita</dd>'}
    </dl></div>
    ${(k.suara || []).filter(Boolean).map(s => `<div class="kartu"><div class="redup">Rekaman cerita</div><audio controls src="${urlBlob(s)}"></audio></div>`).join('')}
    <div class="baris" style="flex-wrap:wrap">
      <a class="tombol" href="#/ubah/${k.id}">Ubah</a>
      ${k.foto ? '<button class="sekunder" id="bUnduh">Simpan foto</button>' : ''}
      <button class="bahaya" id="bHapus">Hapus</button>
    </div>`;
  if (k.foto) $('#bUnduh').onclick = () => unduh(k.foto, `karya-${(a ? a.nama : 'anak').replace(/\W+/g, '-')}-${k.tanggal}.jpg`);
  // Media yang masih di Google Drive anak: ajak menghubungkan, atau unduh video saat diminta.
  const st = window.driveStatus ? window.driveStatus(k.anakId) : 'mati';
  const tombolHub = (el, teks) => {
    el.innerHTML = `${teks}<div class="baris" style="margin-top:8px"><button type="button" id="bHub${el.id}">${st === 'ulang' ? 'Hubungkan ulang Drive' : 'Hubungkan Google Drive'}</button></div>`;
    $('#bHub' + el.id).onclick = async () => { if (await window.hubungkanDrive(k.anakId)) setTimeout(rute, 1500); };
  };
  if (drFoto) {
    const el = $('#boxFotoTeks');
    if (st === 'ok') el.textContent = 'Foto sedang diunduh dari Drive. Tarik layar ke bawah atau buka lagi sebentar lagi.';
    else if (st === 'mati') el.textContent = 'Foto ini ada di Google Drive anak, tetapi Drive belum diaktifkan di aplikasi ini.';
    else tombolHub(el, `Foto ini ada di Google Drive ${esc(a ? a.nama : 'anak')}.`);
  }
  if (drVideo) {
    const el = $('#boxVidTeks');
    if (st === 'ok') {
      el.innerHTML = `<button type="button" id="bVidUnduh">Unduh dan putar video${MB(dr.video)}</button>`;
      $('#bVidUnduh').onclick = async () => {
        $('#bVidUnduh').disabled = true; $('#bVidUnduh').textContent = 'Mengunduh video...';
        try { await window.unduhVideoDrive(k); rute(); } catch (e) { toast('Gagal mengunduh video: ' + (e.message || e)); $('#bVidUnduh').disabled = false; $('#bVidUnduh').textContent = 'Coba unduh lagi'; }
      };
    } else if (st === 'mati') el.textContent = 'Video ini ada di Google Drive anak, tetapi Drive belum diaktifkan di aplikasi ini.';
    else tombolHub(el, `Video${MB(dr.video)} ada di Google Drive ${esc(a ? a.nama : 'anak')}.`);
  }
  $('#bHapus').onclick = async () => {
    if (confirm('Hapus karya ini beserta ceritanya?')) { await hapus('karya', k.id); toast('Karya dihapus'); location.hash = a ? '#/anak/' + a.id : '#/'; }
  };
}

/* ---------- Pencarian ---------- */
async function layarCari(id) {
  const [anak, karya] = await Promise.all([semua('anak'), semua('karya')]);
  if (id !== renderId) return;
  setJudul('Cari karya');
  const lokasi = [...new Set(karya.map(k => k.lokasi).filter(Boolean))].sort();
  const acara = [...new Set(karya.map(k => k.acara).filter(Boolean))].sort();
  main().innerHTML = `<input id="q" type="search" placeholder="Cari lokasi, acara, isi gambar, cerita" autocomplete="off">
    <label>Anak</label>
    <select id="fa"><option value="">Semua anak</option>${anak.map(a => `<option value="${a.id}">${esc(a.nama)}</option>`).join('')}</select>
    ${lokasi.length ? `<h2>Lokasi</h2><div class="chips" id="cLok">${lokasi.map(l => `<button type="button" class="chip" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}
    ${acara.length ? `<h2>Acara</h2><div class="chips" id="cAcr">${acara.map(l => `<button type="button" class="chip" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}
    <h2 id="hasilJudul">Semua karya</h2><div id="hasil"></div>`;
  let fLok = '', fAcr = '';
  const tampil = () => {
    bersihkanUrl();
    const q = $('#q').value.trim().toLowerCase(), fa = $('#fa').value;
    const hasil = karya.filter(k => {
      if (fa && k.anakId !== fa) return false;
      if (fLok && k.lokasi !== fLok) return false;
      if (fAcr && k.acara !== fAcr) return false;
      if (!q) return true;
      const gudang = [k.lokasi, k.acara, k.judul, k.cerita, (k.isi || []).join(' ')].join(' ').toLowerCase();
      return q.split(/\s+/).every(w => gudang.includes(w));
    }).sort(urutTerbaru);
    $('#hasilJudul').textContent = `${hasil.length} karya ditemukan`;
    $('#hasil').innerHTML = hasil.length ? htmlGrid(hasil) : '<div class="kosong">Tidak ada karya yang cocok.</div>';
  };
  const pasangChip = (el, set) => el && el.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const aktif = c.classList.contains('on');
    el.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
    if (!aktif) c.classList.add('on');
    set(aktif ? '' : c.dataset.v);
    tampil();
  });
  pasangChip($('#cLok'), v => { fLok = v; });
  pasangChip($('#cAcr'), v => { fAcr = v; });
  $('#q').oninput = tampil;
  $('#fa').onchange = tampil;
  tampil();
}

/* ---------- Cadangan ---------- */
async function layarPengaturan(id) {
  const [anak, karya, eks] = await Promise.all([semua('anak'), semua('karya'), getMeta('eksporTerakhir')]);
  if (id !== renderId) return;
  setJudul('Cadangan');
  let ruang = '';
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    ruang = `${(e.usage / 1048576).toFixed(1)} MB terpakai`;
  }
  const permanen = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  main().innerHTML = `<div class="kartu"><strong>${anak.length}</strong> anak, <strong>${karya.length}</strong> karya<div class="redup">${ruang}</div>
    <div class="redup">Cadangan terakhir: ${eks ? tglIndo(eks.slice(0, 10)) : 'belum pernah'}</div>
    <div class="redup">Penyimpanan permanen: ${permanen ? 'aktif' : 'belum diizinkan browser'}</div></div>
    <div class="info">Semua data hanya tersimpan di browser HP ini. Kalau data browser dihapus atau HP hilang, data ikut hilang. Buat cadangan secara berkala dan simpan file-nya di tempat lain (Google Drive, laptop). Video tidak ikut file cadangan karena ukurannya besar; simpan videonya lewat Google Drive anak.</div>
    <button class="penuh" id="bEks">Ekspor cadangan</button>
    <h2>Pulihkan dari cadangan</h2>
    <p class="redup">Data di file akan digabung dengan data yang ada. Tidak ada data yang dihapus.</p>
    <button class="sekunder penuh" id="bImp">Pilih file cadangan</button>
    <input type="file" id="fImp" accept=".json,application/json" hidden>
    <div id="boxSinkron"></div>
    <p class="redup" style="margin-top:24px">Katalog Karya Anak v${VERSI}</p>`;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if (window.renderSinkron) window.renderSinkron($('#boxSinkron'));
  $('#bEks').onclick = async () => {
    $('#bEks').disabled = true;
    try {
      const out = { aplikasi: 'katalog-karya-anak', format: 1, dibuat: new Date().toISOString(), anak: await semua('anak'), karya: [] };
      for (const k of await semua('karya')) {
        const { video, ...tanpaVideo } = k;   // video terlalu besar untuk file cadangan, aman di Drive
        out.karya.push({ ...tanpaVideo, foto: k.foto ? await blobKeDataUrl(k.foto) : null, thumb: k.thumb ? await blobKeDataUrl(k.thumb) : null, suara: await Promise.all((k.suara || []).map(x => x ? blobKeDataUrl(x) : null)) });
      }
      unduh(new Blob([JSON.stringify(out)], { type: 'application/json' }), `cadangan-karya-anak-${hariIni()}.json`);
      await setMeta('eksporTerakhir', new Date().toISOString());
      await setMeta('karyaSejakEkspor', 0);
      toast('Cadangan dibuat');
      rute();
    } catch (e) { toast('Gagal membuat cadangan'); $('#bEks').disabled = false; }
  };
  $('#bImp').onclick = () => $('#fImp').click();
  $('#fImp').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.aplikasi !== 'katalog-karya-anak') throw new Error('bukan file cadangan aplikasi ini');
      let nA = 0, nK = 0;
      for (const a of data.anak) { if (!(await ambil('anak', a.id))) nA++; await simpan('anak', a); }
      for (const k of data.karya) {
        const ada = await ambil('karya', k.id);
        if (ada && (ada.diubah || '') >= (k.diubah || '')) continue;
        if (!ada) nK++;
        await simpan('karya', { ...k, foto: k.foto ? await dataUrlKeBlob(k.foto) : null, thumb: k.thumb ? await dataUrlKeBlob(k.thumb) : null, suara: await Promise.all((k.suara || []).map(x => x ? dataUrlKeBlob(x) : null)), video: ada && ada.video ? ada.video : null });
      }
      toast(`Dipulihkan: ${nA} anak, ${nK} karya baru`);
      rute();
    } catch (err) { toast('File tidak bisa dibaca: ' + err.message); }
  };
}

/* ---------- Mulai ---------- */
(async function mulai() {
  try { db = await bukaDB(); } catch (e) { main().innerHTML = '<div class="kosong">Penyimpanan browser tidak tersedia. Jangan pakai mode samaran.</div>'; return; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  rute();
  if (window.mulaiSinkron) window.mulaiSinkron();
})();
