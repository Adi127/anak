'use strict';
/* Sinkron online (opsional).
   - Data teks (anak, karya) disalin ke satu akun keluarga di Supabase.
   - Media (foto, rekaman suara, video) disimpan di Google Drive milik masing-masing anak.
   Data utama tetap di HP. Kalau config.js kosong, aplikasi jalan seperti biasa tanpa fitur ini.
   Aturan konflik: perubahan terbaru (menurut waktu "diubah") menang. */
(function () {
  const KONF = window.KONFIG || {};
  const SIAP = !!(KONF.url && KONF.kunci);
  const DASAR = String(KONF.url || '').replace(/\/+$/, '');
  const GID = KONF.googleClientId || '';
  const DRIVE_SIAP = SIAP && !!GID;
  const GDASAR = String(KONF.driveDasar || 'https://www.googleapis.com').replace(/\/+$/, '');
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const KUNCI_SESI = 'kka.sesi';
  const KUNCI_DRV = 'kka.drv.';
  let sedang = false, ulang = false, timer = null, status = '', abaikan = 0, kotak = null;
  let menunggu = new Set();

  const bacaSesi = () => { try { return JSON.parse(localStorage.getItem(KUNCI_SESI)); } catch (e) { return null; } };
  const tulisSesi = s => { try { if (s) localStorage.setItem(KUNCI_SESI, JSON.stringify(s)); else localStorage.removeItem(KUNCI_SESI); } catch (e) { /* abaikan */ } };
  const bacaDrv = id => { try { return JSON.parse(localStorage.getItem(KUNCI_DRV + id)); } catch (e) { return null; } };
  const tulisDrv = (id, v) => { try { if (v) localStorage.setItem(KUNCI_DRV + id, JSON.stringify(v)); else localStorage.removeItem(KUNCI_DRV + id); } catch (e) { /* abaikan */ } };
  const tersambung = id => { const d = bacaDrv(id); return !!(d && d.token && d.exp - 60000 > Date.now()); };
  const ms = r => Date.parse((r && (r.diubah || r.dibuat)) || '') || 0;
  const waktu = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getDate()} ${BULAN[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const bersih = t => String(t || '').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 40);

  /* ---------- Akun keluarga (Supabase) ---------- */
  async function aut(path, body) {
    const r = await fetch(DASAR + '/auth/v1/' + path, { method: 'POST', headers: { apikey: KONF.kunci, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.msg || j.message || ('HTTP ' + r.status)); e.http = true; throw e; }
    return j;
  }
  function simpanSesi(j) {
    if (!j || !j.access_token) return null;
    const lama = bacaSesi() || {};
    const s = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
      user_id: (j.user && j.user.id) || lama.user_id,
      email: (j.user && j.user.email) || lama.email
    };
    tulisSesi(s);
    return s;
  }
  async function tokenSah(paksa) {
    let s = bacaSesi();
    if (!s) throw new Error('Belum masuk');
    if (paksa || s.expires_at - 60 < Date.now() / 1000) {
      try {
        s = simpanSesi(await aut('token?grant_type=refresh_token', { refresh_token: s.refresh_token })) || s;
      } catch (e) {
        if (e.http) { tulisSesi(null); gambar(); throw new Error('Sesi habis, masuk lagi'); }
        throw e;
      }
    }
    return s;
  }
  async function api(path, opsi) {
    opsi = opsi || {};
    const s = await tokenSah(false);
    const kirim = tok => fetch(DASAR + path, Object.assign({}, opsi, { headers: Object.assign({ apikey: KONF.kunci, Authorization: 'Bearer ' + tok }, opsi.headers || {}) }));
    let r = await kirim(s.access_token);
    if (r.status === 401) r = await kirim((await tokenSah(true)).access_token);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const e = new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 120) : ''));
      e.status = r.status;
      throw e;
    }
    return r;
  }
  async function upsert(tabel, baris) {
    for (let i = 0; i < baris.length; i += 50) {
      await api(`/rest/v1/${tabel}?on_conflict=id`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(baris.slice(i, i + 50)) });
    }
  }
  const hapusLokal = (tabel, id) => tx(tabel, 'readwrite', o => o.delete(id));

  /* ---------- Google Drive (satu sambungan per anak) ---------- */
  function muatGIS() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('Layanan Google tidak bisa dimuat, cek internet'));
      document.head.appendChild(s);
    });
  }
  async function mintaToken(hint) {
    await muatGIS();
    return new Promise((res, rej) => {
      const c = google.accounts.oauth2.initTokenClient({
        client_id: GID,
        scope: SCOPE,
        hint: hint || undefined,
        prompt: hint ? '' : 'select_account',
        callback: r => (r && r.access_token) ? res(r) : rej(new Error((r && (r.error_description || r.error)) || 'Izin ditolak')),
        error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'Jendela Google ditutup' : 'Gagal menghubungi Google'))
      });
      c.requestAccessToken();
    });
  }
  async function drv(anakId, path, opsi) {
    const d = bacaDrv(anakId);
    if (!d || !d.token || d.exp - 60000 < Date.now()) { const e = new Error('Drive belum terhubung'); e.butuhDrive = true; throw e; }
    opsi = opsi || {};
    const r = await fetch(GDASAR + path, Object.assign({}, opsi, { headers: Object.assign({ Authorization: 'Bearer ' + d.token }, opsi.headers || {}) }));
    if (r.status === 401) { tulisDrv(anakId, Object.assign({}, d, { exp: 0 })); const e = new Error('Izin Google habis'); e.butuhDrive = true; throw e; }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const e = new Error('Drive HTTP ' + r.status + (t ? ': ' + t.slice(0, 100) : ''));
      e.status = r.status;
      throw e;
    }
    return r;
  }
  async function folderAnak(anakId) {
    const d = bacaDrv(anakId);
    if (d.folderId) return d.folderId;
    const a = await ambil('anak', anakId);
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and appProperties has { key='anakId' and value='${anakId}' } and trashed=false`);
    const j = await (await drv(anakId, `/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`)).json();
    let id = j.files && j.files[0] && j.files[0].id;
    if (!id) {
      const meta = { name: 'Katalog Anak - ' + bersih(a ? a.nama : 'anak'), mimeType: 'application/vnd.google-apps.folder', appProperties: { anakId } };
      id = (await (await drv(anakId, '/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })).json()).id;
    }
    tulisDrv(anakId, Object.assign({}, bacaDrv(anakId), { folderId: id }));
    return id;
  }
  async function kirimFile(anakId, blob, nama, props, idLama) {
    const meta = idLama ? { name: nama } : { name: nama, parents: [await folderAnak(anakId)], appProperties: props };
    const mulai = await drv(anakId, `/upload/drive/v3/files${idLama ? '/' + idLama : ''}?uploadType=resumable&fields=id`, {
      method: idLama ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(meta)
    });
    const url = mulai.headers.get('Location');
    if (!url) throw new Error('Drive tidak memberi alamat unggah');
    const UKURAN = 8 * 1024 * 1024;
    for (let pos = 0; pos < blob.size;) {
      const akhir = Math.min(pos + UKURAN, blob.size);
      const r = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${pos}-${akhir - 1}/${blob.size}` }, body: blob.slice(pos, akhir) });
      if (r.status === 308) { pos = akhir; continue; }
      if (!r.ok) throw new Error('Unggah ke Drive gagal (HTTP ' + r.status + ')');
      return (await r.json()).id;
    }
    throw new Error('Unggah ke Drive tidak selesai');
  }
  const unduhDrive = async (anakId, id) => (await drv(anakId, `/drive/v3/files/${id}?alt=media`)).blob();
  const ekstSuara = t => /mp4|aac|m4a/.test(t || '') ? '.m4a' : /ogg/.test(t || '') ? '.ogg' : '.webm';
  const ekstVideo = t => /quicktime/.test(t || '') ? '.mov' : /webm/.test(t || '') ? '.webm' : '.mp4';

  // Media lokal yang belum ada (atau sudah berbeda) di Drive.
  function rencana(k) {
    const dr = k._drive || {};
    const out = [];
    if (k.foto && k.foto.size && !(dr.foto && dr.foto.size === k.foto.size)) out.push('foto');
    (k.suara || []).forEach((s, i) => { if (s && s.size && !((dr.suara || [])[i] && dr.suara[i].size === s.size)) out.push('suara-' + i); });
    if (k.video && k.video.size && !(dr.video && dr.video.size === k.video.size)) out.push('video');
    return out;
  }
  async function unggahMedia(k) {
    const email = (bacaDrv(k.anakId) || {}).email || '';
    let dr = k._drive || null;
    if (dr && ((dr.anakId && dr.anakId !== k.anakId) || (dr.email && email && dr.email !== email))) dr = null;
    dr = Object.assign({ suara: [] }, dr, { anakId: k.anakId, email });
    dr.suara = (dr.suara || []).slice();
    const dasar = `${k.tanggal || ''} ${bersih(k.judul || k.lokasi)}`.trim();
    const props = jenis => ({ karyaId: k.id, anakId: k.anakId, jenis });
    const kirim = async (blob, cur, jenis, ext) => ({ id: await kirimFile(k.anakId, blob, `${dasar} (${jenis})${ext}`, props(jenis), cur && cur.id), size: blob.size });
    if (k.foto && k.foto.size && !(dr.foto && dr.foto.size === k.foto.size)) dr.foto = await kirim(k.foto, dr.foto, 'foto', '.jpg');
    const sn = k.suara || [];
    for (let i = 0; i < sn.length; i++) {
      const s = sn[i];
      if (!s || !s.size || (dr.suara[i] && dr.suara[i].size === s.size)) continue;
      dr.suara[i] = await kirim(s, dr.suara[i], 'suara ' + (i + 1), ekstSuara(s.type));
    }
    if (k.video && k.video.size && !(dr.video && dr.video.size === k.video.size)) dr.video = await kirim(k.video, dr.video, 'video', ekstVideo(k.video.type));
    // Baca ulang supaya suntingan yang terjadi selama unggah tidak tertimpa.
    const baru = await ambil('karya', k.id);
    if (!baru) return null;
    baru._drive = dr;
    baru.diubah = new Date().toISOString();
    await tx('karya', 'readwrite', o => o.put(baru));
    return baru;
  }
  async function prosesYatim() {
    const daftar = (await getMeta('drvHapus')) || [];
    if (!daftar.length) return;
    const sisa = [];
    for (const x of daftar) {
      if (!tersambung(x.anakId)) { sisa.push(x); continue; }
      try { await drv(x.anakId, '/drive/v3/files/' + x.id, { method: 'DELETE' }); } catch (e) { if (e.status !== 404) sisa.push(x); }
    }
    await setMeta('drvHapus', sisa);
  }
  window.tandaiHapusDrive = async function (anakId, ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return;
    const daftar = (await getMeta('drvHapus')) || [];
    await setMeta('drvHapus', daftar.concat(ids.map(id => ({ anakId, id }))));
  };
  // Unduh foto dan rekaman yang ada di Drive tapi belum ada di HP ini. Video diunduh saat dibuka.
  async function lengkapiMedia() {
    let berubah = false;
    for (const k of await semua('karya')) {
      const dr = k._drive;
      if (!dr) continue;
      const kurangFoto = dr.foto && !k.foto;
      const kurangSuara = (dr.suara || []).some((e, i) => e && !(k.suara || [])[i]);
      if (!kurangFoto && !kurangSuara) continue;
      if (!tersambung(k.anakId)) { menunggu.add(k.id); continue; }
      try {
        let foto = k.foto, thumb = k.thumb;
        const suara = (dr.suara || []).map((e, i) => (k.suara || [])[i] || null);
        if (kurangFoto) {
          foto = await unduhDrive(k.anakId, dr.foto.id);
          try { thumb = await kompres(foto, 400, 0.8); } catch (e) { thumb = foto; }
        }
        for (let i = 0; i < suara.length; i++) if (!suara[i] && dr.suara[i]) suara[i] = await unduhDrive(k.anakId, dr.suara[i].id);
        const baru = await ambil('karya', k.id);
        if (baru && baru.diubah === k.diubah) {
          baru.foto = foto; baru.thumb = thumb; baru.suara = suara;
          await tx('karya', 'readwrite', o => o.put(baru));
          berubah = true;
        }
      } catch (e) {
        if (e.butuhDrive) menunggu.add(k.id); else throw e;
      }
    }
    return berubah;
  }

  /* ---------- Tarik (server ke HP) ---------- */
  async function terapkan(tabel, b) {
    const lokal = await ambil(tabel, b.id);
    if (b.dihapus) {
      if (lokal && ms(lokal) <= b.diubah) { await hapusLokal(tabel, b.id); return true; }
      return false;
    }
    if (lokal && ms(lokal) >= b.diubah) return false;
    const d = b.data || {};
    if (tabel === 'anak') { await simpan('anak', d); return true; }
    const L = lokal || {}, dr = d._drive || null;
    const rec = Object.assign({}, d);
    // Media lokal dipertahankan kalau cocok dengan yang tercatat di Drive; kalau beda, diunduh ulang nanti.
    rec.foto = L.foto && (!dr || !dr.foto || dr.foto.size === L.foto.size) ? L.foto : null;
    rec.thumb = rec.foto ? (L.thumb || null) : null;
    rec.suara = dr && dr.suara ? dr.suara.map((e, i) => { const s = (L.suara || [])[i]; return s && (!e || e.size === s.size) ? s : null; }) : (L.suara || []);
    rec.video = L.video && (!dr || !dr.video || dr.video.size === L.video.size) ? L.video : null;
    await simpan('karya', rec);
    return true;
  }
  async function tarik() {
    let berubah = false;
    for (const tabel of ['anak', 'karya']) {
      let batas = (await getMeta('kursorTarik_' + tabel)) || 0;
      for (;;) {
        const r = await api(`/rest/v1/${tabel}?select=id,data,diubah,dihapus&diubah=gte.${batas}&order=diubah.asc&limit=100`);
        const baris = await r.json();
        let maju = batas;
        abaikan++;
        try {
          for (const b of baris) { if (await terapkan(tabel, b)) berubah = true; if (b.diubah > maju) maju = b.diubah; }
        } finally { abaikan--; }
        const adaKemajuan = maju > batas;
        batas = maju;
        await setMeta('kursorTarik_' + tabel, batas);
        if (baris.length < 100 || !adaKemajuan) break;
      }
    }
    return berubah;
  }

  /* ---------- Dorong (HP ke server) ---------- */
  async function dorong(mulai) {
    const batas = (await getMeta('kursorDorong')) || 0;
    const anak = (await semua('anak')).filter(a => ms(a) > batas);
    const tomb = await semua('tomb');
    const kirim = [];
    for (const k of (await semua('karya')).filter(k => ms(k) > batas || (DRIVE_SIAP && rencana(k).length))) {
      let rec = k;
      if (DRIVE_SIAP && rencana(k).length) {
        if (!tersambung(k.anakId)) menunggu.add(k.id);
        else {
          try { rec = (await unggahMedia(k)) || k; } catch (e) { menunggu.add(k.id); if (!e.butuhDrive) throw e; }
        }
      }
      if (ms(rec) > batas) kirim.push(rec);
    }
    await upsert('anak', anak.map(a => ({ id: a.id, data: a, diubah: ms(a), dihapus: false })));
    await upsert('karya', kirim.map(k => {
      const d = Object.assign({}, k);
      delete d.foto; delete d.thumb; delete d.suara; delete d.video;
      return { id: k.id, data: d, diubah: ms(k), dihapus: false };
    }));
    for (const t of ['anak', 'karya']) {
      await upsert(t, tomb.filter(x => x.s === t).map(x => ({ id: x.id, data: {}, diubah: ms(x), dihapus: true })));
    }
    for (const x of tomb) await tx('tomb', 'readwrite', o => o.delete(x.k));
    await setMeta('kursorDorong', mulai);
  }

  /* ---------- Alur utama ---------- */
  function setStatus(t) {
    status = t;
    const el = document.getElementById('skStatus');
    if (el) el.textContent = t;
  }
  function segarkan() {
    if (/^#\/(tambah|ubah|anak\/baru)/.test(location.hash)) return;
    if (typeof rute === 'function') rute();
  }
  async function sinkron(manual) {
    if (!SIAP || !bacaSesi()) return;
    if (sedang) { ulang = true; return; }
    if (!navigator.onLine) { setStatus('Offline, akan disinkronkan nanti'); if (manual) toast('Tidak ada koneksi internet'); return; }
    sedang = true;
    setStatus('Menyinkronkan...');
    const mulai = Date.now();
    menunggu = new Set();
    try {
      const s = await tokenSah(false);
      if ((await getMeta('sinkronUser')) !== s.user_id) {
        for (const k of ['kursorTarik_anak', 'kursorTarik_karya', 'kursorDorong']) await setMeta(k, 0);
        await setMeta('sinkronUser', s.user_id);
      }
      let berubah = await tarik();
      if (DRIVE_SIAP) { if (await lengkapiMedia()) berubah = true; }
      await dorong(mulai);
      if (DRIVE_SIAP) await prosesYatim();
      const t = new Date().toISOString();
      await setMeta('sinkronTerakhir', t);
      setStatus('Terakhir sinkron: ' + waktu(t) + (menunggu.size ? ` · ${menunggu.size} karya menunggu Drive` : ''));
      if (manual) toast('Sinkron selesai');
      if (berubah) segarkan();
    } catch (e) {
      const pesan = e && e.message ? e.message : String(e);
      setStatus('Gagal: ' + pesan);
      if (manual) toast('Sinkron gagal: ' + pesan);
    } finally {
      sedang = false;
      gambarDrive();
      if (ulang) { ulang = false; setTimeout(() => sinkron(false), 800); }
    }
  }

  window.jadwalSinkron = function () {
    if (abaikan || !SIAP || !bacaSesi()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sinkron(false), 3000);
  };
  window.mulaiSinkron = function () {
    if (!SIAP) return;
    window.addEventListener('online', () => sinkron(false));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sinkron(false); });
    if (bacaSesi()) sinkron(false);
  };
  window.sinkronSekarang = () => sinkron(true);

  /* ---------- Sambungan Drive: tombol dan tampilan ---------- */
  window.driveAktif = () => DRIVE_SIAP;
  window.driveStatus = anakId => !DRIVE_SIAP ? 'mati' : !bacaDrv(anakId) ? 'belum' : tersambung(anakId) ? 'ok' : 'ulang';
  async function hubungkan(anakId) {
    const a = await ambil('anak', anakId);
    if (!a) return;
    const lama = bacaDrv(anakId) || {};
    const hint = (a.drive && a.drive.email) || lama.email || '';
    let r;
    try { r = await mintaToken(hint); } catch (e) { toast(e.message); return false; }
    let email = '';
    try {
      const j = await (await fetch(GDASAR + '/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + r.access_token } })).json();
      email = (j.user && j.user.emailAddress) || '';
    } catch (e) { /* email hanya penanda, boleh kosong */ }
    if (a.drive && a.drive.email && email && a.drive.email !== email && !confirm(`Akun Google ini (${email}) berbeda dari akun ${a.nama} sebelumnya (${a.drive.email}). Ganti ke akun ini? File lama tetap di akun sebelumnya.`)) return false;
    tulisDrv(anakId, { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, email: email || hint, folderId: email && lama.email === email ? lama.folderId : undefined });
    if (email && (!a.drive || a.drive.email !== email)) { a.drive = { email }; a.diubah = new Date().toISOString(); await simpan('anak', a); }
    toast('Drive terhubung');
    gambarDrive();
    sinkron(true);
    return true;
  }
  window.hubungkanDrive = hubungkan;
  function putuskan(anakId) { tulisDrv(anakId, null); toast('Terputus dari HP ini. File di Drive tetap ada.'); gambarDrive(); }

  const teksDrive = (a, st) => {
    const email = (bacaDrv(a.id) || {}).email || (a.drive && a.drive.email) || '';
    if (st === 'ok') return `Terhubung${email ? ': ' + esc(email) : ''}`;
    if (st === 'ulang') return `Izin Google habis${email ? ' untuk ' + esc(email) : ''}. Ketuk untuk menghubungkan ulang.`;
    return `Belum terhubung${email ? ' di HP ini (akun ' + esc(email) + ')' : ''}. Foto, rekaman, dan video baru tersimpan di HP ini.`;
  };
  function tombolDrive(a, st) {
    return `<div class="baris" style="margin-top:8px"><button type="button" class="${st === 'ok' ? 'sekunder' : ''}" data-hub="${a.id}">${st === 'ok' ? 'Ganti akun' : st === 'ulang' ? 'Hubungkan ulang' : 'Hubungkan Google Drive'}</button>${st !== 'belum' ? `<button type="button" class="sekunder" data-put="${a.id}">Putuskan</button>` : ''}</div>`;
  }
  function pasangTombolDrive(el) {
    el.querySelectorAll('[data-hub]').forEach(b => b.onclick = () => hubungkan(b.dataset.hub));
    el.querySelectorAll('[data-put]').forEach(b => b.onclick = () => putuskan(b.dataset.put));
  }
  let kotakAnak = null;   // halaman satu anak
  window.renderDriveAnak = function (el, a) {
    kotakAnak = a ? { el, id: a.id } : null;
    if (!DRIVE_SIAP || !el) return;
    const st = window.driveStatus(a.id);
    el.innerHTML = `<h2>Google Drive ${esc(a.nama)}</h2><div class="kartu"><div class="redup">${teksDrive(a, st)}</div>${tombolDrive(a, st)}</div>`;
    pasangTombolDrive(el);
  };
  async function gambarDrive() {
    if (!DRIVE_SIAP) return;
    if (kotakAnak && document.body.contains(kotakAnak.el)) { const a = await ambil('anak', kotakAnak.id); if (a) window.renderDriveAnak(kotakAnak.el, a); }
    const el = document.getElementById('skDrive');
    if (!el || !document.body.contains(el)) return;
    const daftar = (await semua('anak')).sort((x, y) => x.nama.localeCompare(y.nama));
    el.innerHTML = '<h2>Google Drive tiap anak</h2>' + (daftar.length ? daftar.map(a => { const st = window.driveStatus(a.id); return `<div class="kartu"><strong>${esc(a.nama)}</strong><div class="redup">${teksDrive(a, st)}</div>${tombolDrive(a, st)}</div>`; }).join('') : '<div class="kartu redup">Tambahkan anak dulu.</div>');
    pasangTombolDrive(el);
  }
  // Mengunduh video dari Drive anak lalu menyimpannya di HP ini.
  window.unduhVideoDrive = async function (k) {
    const dr = k._drive;
    if (!dr || !dr.video) throw new Error('Video tidak ditemukan di Drive');
    const blob = await unduhDrive(k.anakId, dr.video.id);
    const baru = await ambil('karya', k.id);
    if (baru) { baru.video = blob; await tx('karya', 'readwrite', o => o.put(baru)); }
    return blob;
  };

  /* ---------- Tampilan akun keluarga di menu Cadangan ---------- */
  async function masukAtauDaftar(daftar) {
    const email = $('#skEmail').value.trim(), sandi = $('#skSandi').value;
    if (!email || sandi.length < 6) return toast('Isi email dan kata sandi (minimal 6 karakter)');
    try {
      const j = await aut(daftar ? 'signup' : 'token?grant_type=password', { email, password: sandi });
      if (!j.access_token) return toast('Akun dibuat. Cek email untuk konfirmasi, lalu masuk.');
      simpanSesi(j);
      toast('Berhasil masuk');
      gambar();
      sinkron(true);
    } catch (e) {
      toast(e.http ? 'Gagal: ' + e.message : 'Tidak ada koneksi internet');
    }
  }
  function gambar() {
    if (!kotak || !document.body.contains(kotak)) return;
    let h = '<h2>Sinkron online</h2>';
    if (!SIAP) {
      kotak.innerHTML = h + '<div class="kartu redup">Belum diatur. Untuk berbagi karya antar HP, ikuti PANDUAN-ONLINE.md di repositori GitHub, lalu isi config.js.</div>';
      return;
    }
    const s = bacaSesi();
    if (!s) {
      h += `<div class="kartu"><div class="redup">Masuk dengan akun keluarga yang sama di setiap HP.</div>
        <label>Email</label><input id="skEmail" type="email" autocomplete="username">
        <label>Kata sandi</label><input id="skSandi" type="password" autocomplete="current-password">
        <div class="baris" style="margin-top:12px"><button type="button" id="skMasuk">Masuk</button><button type="button" class="sekunder" id="skDaftar">Buat akun</button></div></div>`;
      kotak.innerHTML = h;
      $('#skMasuk').onclick = () => masukAtauDaftar(false);
      $('#skDaftar').onclick = () => masukAtauDaftar(true);
      return;
    }
    h += `<div class="kartu"><div>Masuk sebagai <strong>${esc(s.email || '')}</strong></div><div class="redup" id="skStatus">${esc(status)}</div>
      <div class="baris" style="margin-top:12px"><button type="button" id="skSinkron">Sinkronkan sekarang</button><button type="button" class="sekunder" id="skKeluar">Keluar</button></div></div>
      <div id="skDrive"></div>`;
    kotak.innerHTML = h;
    if (!status) getMeta('sinkronTerakhir').then(t => { if (!status) setStatus(t ? 'Terakhir sinkron: ' + waktu(t) : 'Belum pernah sinkron'); });
    $('#skSinkron').onclick = () => sinkron(true);
    $('#skKeluar').onclick = () => { tulisSesi(null); status = ''; toast('Keluar. Data di HP tetap ada.'); gambar(); };
    gambarDrive();
  }
  window.renderSinkron = function (el) { kotak = el; gambar(); };
})();
