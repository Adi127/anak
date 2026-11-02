'use strict';
/* Sinkron online (opsional) lewat Supabase.
   Data utama tetap di HP. Fitur ini menyalin data ke satu akun keluarga supaya beberapa HP
   bisa berbagi karya. Kalau config.js kosong, aplikasi jalan seperti biasa tanpa fitur ini.
   Aturan konflik: perubahan terbaru (menurut waktu "diubah") menang. */
(function () {
  const KONF = window.KONFIG || {};
  const SIAP = !!(KONF.url && KONF.kunci);
  const DASAR = String(KONF.url || '').replace(/\/+$/, '');
  const KUNCI_SESI = 'kka.sesi';
  let sedang = false, ulang = false, timer = null, status = '', abaikan = 0, kotak = null;

  const bacaSesi = () => { try { return JSON.parse(localStorage.getItem(KUNCI_SESI)); } catch (e) { return null; } };
  const tulisSesi = s => { try { if (s) localStorage.setItem(KUNCI_SESI, JSON.stringify(s)); else localStorage.removeItem(KUNCI_SESI); } catch (e) { /* abaikan */ } };
  const ms = r => Date.parse((r && (r.diubah || r.dibuat)) || '') || 0;
  const sigLokal = k => [k.foto && k.foto.size, k.thumb && k.thumb.size].concat((k.suara || []).map(s => s.size)).join(':');
  const waktu = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getDate()} ${BULAN[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  /* ---------- Akun ---------- */
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

  /* ---------- Media ---------- */
  const unggah = (uid, id, nama, blob) => api(`/storage/v1/object/media/${uid}/${id}/${nama}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true' }, body: blob });
  async function unduhMedia(uid, id, nama) {
    const r = await api(`/storage/v1/object/authenticated/media/${uid}/${id}/${nama}`);
    return r.blob();
  }
  async function upsert(tabel, baris) {
    for (let i = 0; i < baris.length; i += 50) {
      await api(`/rest/v1/${tabel}?on_conflict=id`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(baris.slice(i, i + 50)) });
    }
  }
  const hapusLokal = (tabel, id) => tx(tabel, 'readwrite', o => o.delete(id));

  /* ---------- Tarik (server ke HP) ---------- */
  async function terapkan(tabel, b, uid) {
    const lokal = await ambil(tabel, b.id);
    if (b.dihapus) {
      if (lokal && ms(lokal) <= b.diubah) { await hapusLokal(tabel, b.id); return true; }
      return false;
    }
    if (lokal && ms(lokal) >= b.diubah) return false;
    const d = b.data || {};
    if (tabel === 'anak') { await simpan('anak', d); return true; }
    const rec = Object.assign({}, d);
    const tipe = d._suaraTipe || [];
    delete rec._sig; delete rec._suaraTipe;
    if (lokal && sigLokal(lokal) === d._sig) {
      rec.foto = lokal.foto; rec.thumb = lokal.thumb; rec.suara = lokal.suara || [];
    } else {
      rec.foto = await unduhMedia(uid, d.id, 'foto');
      try { rec.thumb = await unduhMedia(uid, d.id, 'thumb'); } catch (e) { rec.thumb = null; }
      rec.suara = [];
      for (let i = 0; i < tipe.length; i++) rec.suara.push(await unduhMedia(uid, d.id, 'suara-' + i));
    }
    await simpan('karya', rec);
    await setMeta('sig:' + uid + ':' + d.id, d._sig);
    return true;
  }
  async function tarik(uid) {
    let berubah = false;
    for (const tabel of ['anak', 'karya']) {
      let batas = (await getMeta('kursorTarik_' + tabel)) || 0;
      for (;;) {
        const r = await api(`/rest/v1/${tabel}?select=id,data,diubah,dihapus&diubah=gte.${batas}&order=diubah.asc&limit=100`);
        const baris = await r.json();
        let maju = batas;
        abaikan++;
        try {
          for (const b of baris) { if (await terapkan(tabel, b, uid)) berubah = true; if (b.diubah > maju) maju = b.diubah; }
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
  async function dorong(uid, mulai) {
    const batas = (await getMeta('kursorDorong')) || 0;
    const anak = (await semua('anak')).filter(a => ms(a) > batas);
    const karya = (await semua('karya')).filter(k => ms(k) > batas);
    const tomb = await semua('tomb');
    for (const k of karya) {
      const sig = sigLokal(k), kunci = 'sig:' + uid + ':' + k.id;
      if ((await getMeta(kunci)) === sig) continue;
      await unggah(uid, k.id, 'foto', k.foto);
      if (k.thumb) await unggah(uid, k.id, 'thumb', k.thumb);
      const sn = k.suara || [];
      for (let i = 0; i < sn.length; i++) await unggah(uid, k.id, 'suara-' + i, sn[i]);
      await setMeta(kunci, sig);
    }
    await upsert('anak', anak.map(a => ({ id: a.id, data: a, diubah: ms(a), dihapus: false })));
    await upsert('karya', karya.map(k => {
      const d = Object.assign({}, k);
      delete d.foto; delete d.thumb; delete d.suara;
      d._sig = sigLokal(k);
      d._suaraTipe = (k.suara || []).map(s => s.type || 'audio/webm');
      return { id: k.id, data: d, diubah: ms(k), dihapus: false };
    }));
    for (const t of ['anak', 'karya']) {
      await upsert(t, tomb.filter(x => x.s === t).map(x => ({ id: x.id, data: {}, diubah: ms(x), dihapus: true })));
    }
    for (const x of tomb.filter(x => x.s === 'karya')) {
      const paths = [`${uid}/${x.id}/foto`, `${uid}/${x.id}/thumb`];
      for (let i = 0; i < (x.suaraN || 0); i++) paths.push(`${uid}/${x.id}/suara-${i}`);
      try { await api('/storage/v1/object/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }); } catch (e) { /* media yatim tidak fatal */ }
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
    try {
      const s = await tokenSah(false);
      if ((await getMeta('sinkronUser')) !== s.user_id) {
        for (const k of ['kursorTarik_anak', 'kursorTarik_karya', 'kursorDorong']) await setMeta(k, 0);
        await setMeta('sinkronUser', s.user_id);
      }
      const berubah = await tarik(s.user_id);
      await dorong(s.user_id, mulai);
      const t = new Date().toISOString();
      await setMeta('sinkronTerakhir', t);
      setStatus('Terakhir sinkron: ' + waktu(t));
      if (manual) toast('Sinkron selesai');
      if (berubah) segarkan();
    } catch (e) {
      const pesan = e && e.message ? e.message : String(e);
      setStatus('Gagal: ' + pesan);
      if (manual) toast('Sinkron gagal: ' + pesan);
    } finally {
      sedang = false;
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

  /* ---------- Tampilan di menu Cadangan ---------- */
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
      <div class="baris" style="margin-top:12px"><button type="button" id="skSinkron">Sinkronkan sekarang</button><button type="button" class="sekunder" id="skKeluar">Keluar</button></div></div>`;
    kotak.innerHTML = h;
    if (!status) getMeta('sinkronTerakhir').then(t => { if (!status) setStatus(t ? 'Terakhir sinkron: ' + waktu(t) : 'Belum pernah sinkron'); });
    $('#skSinkron').onclick = () => sinkron(true);
    $('#skKeluar').onclick = () => { tulisSesi(null); status = ''; toast('Keluar. Data di HP tetap ada.'); gambar(); };
  }
  window.renderSinkron = function (el) { kotak = el; gambar(); };
})();
