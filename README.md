# SIPROPEMPERDA — dashboard + panel admin

Dashboard progres pembentukan Peraturan Daerah (Sekretariat DPRD Provinsi NTT) dengan backend,
sehingga data dan dokumen cukup diperbarui lewat panel admin — tanpa mengedit kode HTML.

- **Tanpa instalasi paket**: hanya butuh [Node.js](https://nodejs.org) versi 18 atau lebih baru. Tidak ada `npm install`.
- Data tersimpan di berkas JSON (`data/`), berkas unggahan di `uploads/`.

## Menjalankan

```bash
node server.js
```

- Situs publik : http://localhost:3000
- Panel admin  : http://localhost:3000/admin/

Saat pertama kali dijalankan, akun admin dibuat otomatis. Username `admin`; kata sandi acak dicetak **sekali** di terminal
(atau isi `ADMIN_PASSWORD` di `.env` sebelum menjalankan). Segera ganti di menu **Akun**.
Lupa kata sandi: `node server.js --reset-admin admin KataSandiBaru123`

**Logo**: salin `Logo DPRD.png`, `Logo pemprov.png`, dan `logo-badekat.png` ke folder `public/`.

## Memperbarui data (di panel admin)

| Keperluan | Menu |
|---|---|
| Tambah/ubah/hapus Ranperda, ganti tahap yang sedang berjalan, atur urutan | Ranperda |
| Tambah dokumen pada suatu tahap (tautan Google Drive **atau** unggah PDF/Word/Excel/PowerPoint/gambar) | Ranperda → Ubah → kotak tahap → Tambah dokumen |
| Tambah SK PROPEMPERDA baru atau perubahannya | PROPEMPERDA |
| Lihat rata-rata nilai, jawaban terbuka, unduh CSV untuk Excel | Survei |
| Ganti kata sandi, unduh cadangan | Akun |

Tahun baru (mis. 2027) otomatis muncul di situs publik begitu ada Ranperda atau SK PROPEMPERDA untuk tahun itu.
Grafik di beranda dihitung otomatis dari data Ranperda.

## Struktur folder

```
server.js            backend (API + penyajian berkas)
public/              situs publik (index.html, app.js, style.css) + public/admin/ (panel admin)
data/db.json         data Ranperda & PROPEMPERDA
data/survey.json     jawaban survei
data/stats.json      penghitung pengunjung
data/admin.json      akun admin (kata sandi di-hash)
data/backup/         salinan harian db.json (30 hari terakhir)
uploads/             berkas yang diunggah lewat panel admin
```

**Cadangkan folder `data/` dan `uploads/` secara berkala.** Berkas unggahan yang tidak lagi dipakai data mana pun
dihapus otomatis setelah 24 jam.

## Pengaturan (`.env`, opsional)

Salin `.env.example` menjadi `.env`. Yang paling sering dipakai: `PORT`, `MAX_UPLOAD_MB` (bawaan 25),
`COOKIE_SECURE=1` dan `TRUST_PROXY=1` bila diakses lewat HTTPS/Nginx, `CORS_ORIGIN` bila halaman publik
di-host di domain lain.

## Menjalankan terus-menerus di server

```bash
npm i -g pm2
pm2 start server.js --name sipropemperda
pm2 save && pm2 startup
```

Letakkan Nginx (atau reverse proxy lain) di depan untuk HTTPS, lalu set `COOKIE_SECURE=1` dan `TRUST_PROXY=1`.
Pada Nginx, tambahkan `client_max_body_size 30m;` agar unggahan berkas besar tidak ditolak.

## Keamanan yang sudah diterapkan

Kata sandi di-hash (scrypt); sesi memakai cookie HttpOnly + SameSite=Strict; batas percobaan login (8 kali / 15 menit);
perlindungan CSRF (cek Origin + header khusus); unggahan dibatasi jenis dan ukuran, nama berkas diacak dan tidak pernah
dieksekusi; semua teks dari data di-escape di halaman publik; tautan hanya boleh `http(s)://` atau berkas unggahan.

## API ringkas

Publik: `GET /api/public`, `POST /api/visit`, `POST /api/survey`.
Admin (perlu login): `/api/admin/ranperda`, `/api/admin/propemperda`, `/api/admin/upload`, `/api/admin/surveys`, `/api/admin/backup`.
