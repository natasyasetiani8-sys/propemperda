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

## Deploy API di Cloudflare Workers

Worker tersedia di `worker.js`; dashboard tetap dapat di-host di Netlify. Worker memakai D1 untuk data dan R2 untuk
unggahan, sehingga tidak bergantung pada filesystem lokal. Perintah berikut memakai Wrangler melalui `npx`:

```bash
npx wrangler login
npx wrangler d1 create sipropemperda
npx wrangler r2 bucket create sipropemperda-uploads
```

Salin `database_id` dari hasil perintah D1 ke `wrangler.toml` menggantikan `REPLACE_WITH_D1_DATABASE_ID`. Lalu buat
secret. Masukkan nilainya langsung pada prompt Wrangler, jangan simpan di Git:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put PASSWORD_PEPPER
```

`ADMIN_PASSWORD` menjadi kata sandi admin awal (minimal 16 karakter; gunakan kata sandi acak yang panjang).
`SESSION_SECRET` dan `PASSWORD_PEPPER` masing-masing harus berupa nilai acak terpisah; buat dua nilai dengan
`openssl rand -hex 32`, lalu masukkan satu per satu pada prompt Wrangler. Jangan mengganti `PASSWORD_PEPPER` setelah
admin dibuat karena hash kata sandi bergantung padanya. Worker memakai PBKDF2 20.000 iterasi agar login muat dalam
batas CPU 10 ms pada plan gratis; karena itu gunakan password panjang dan acak, dan jangan mengekspos pepper.
Hash akun dari `data/admin.json` tidak dapat dipakai Worker; login awal menggunakan `ADMIN_PASSWORD` dan akun
disimpan di D1. Setelah itu buat tabel dan impor data awal:

```bash
npx wrangler d1 migrations apply sipropemperda --remote
node scripts/export-legacy-data.mjs > /tmp/sipropemperda-seed.sql
npx wrangler d1 execute sipropemperda --remote --file=/tmp/sipropemperda-seed.sql
npx wrangler deploy
```

Untuk memulihkan akun admin yang terlupa, atur ulang secret `ADMIN_PASSWORD`, lalu hapus hanya baris admin D1 agar
Worker membuat akun awal kembali pada login berikutnya:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler d1 execute sipropemperda --remote --command="DELETE FROM admin WHERE id = 1"
```

Atur `CORS_ORIGIN` di `wrangler.toml` agar sama persis dengan origin frontend. Untuk Netlify, teruskan API dan
unggahan melalui domain situs yang sama dengan menambahkan redirect berikut ke file `_redirects` situs Netlify.
Ganti hostname dengan URL yang dicetak oleh `wrangler deploy`:

```text
/api/* https://<worker-host>/api/:splat 200
/uploads/* https://<worker-host>/uploads/:splat 200
```

Dengan proxy, biarkan `SIPROPEMPERDA_API_BASE` kosong. Jika frontend memanggil Worker secara langsung, atur
`window.SIPROPEMPERDA_API_BASE` ke URL `https://...workers.dev` sebelum memuat script dashboard. Proxy Netlify
lebih disarankan karena browser dapat memblokir cookie admin lintas situs. Isi `CORS_ORIGIN` dengan origin Netlify
persis, tanpa garis miring di akhir.

Skrip impor membaca `data/db.json` terlebih dahulu, lalu `db.json` di root. Skrip juga mengimpor `data/survey.json`
atau `survey.json` di root jika tersedia. Simpan SQL hasil ekspor di `/tmp`; hapus setelah impor bila memuat jawaban
survei pribadi.

## Keamanan yang sudah diterapkan

Kata sandi di-hash (scrypt); sesi memakai cookie HttpOnly + SameSite=Strict; batas percobaan login (8 kali / 15 menit);
perlindungan CSRF (cek Origin + header khusus); unggahan dibatasi jenis dan ukuran, nama berkas diacak dan tidak pernah
dieksekusi; semua teks dari data di-escape di halaman publik; tautan hanya boleh `http(s)://` atau berkas unggahan.

## API ringkas

Publik: `GET /api/public`, `POST /api/visit`, `POST /api/survey`.
Admin (perlu login): `/api/admin/ranperda`, `/api/admin/propemperda`, `/api/admin/upload`, `/api/admin/surveys`, `/api/admin/backup`.
