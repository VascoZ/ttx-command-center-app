# TTX Command Center

Platform web untuk merancang, menjalankan, dan mengevaluasi **tabletop exercise (TTX)** secara real-time dengan banyak pengguna. Berjalan sepenuhnya di Docker dan bisa dipasang di jaringan internal tanpa internet.

## Menjalankan

Kebutuhan: Docker Engine 24+ dengan Docker Compose v2, dan Node.js (hanya untuk skrip pembuat `.env`).

```bash
node scripts/init-env.js            # produksi: secret & password acak, tanpa data demo
# atau: node scripts/init-env.js --demo   (dengan akun & latihan demo untuk gladi/pelatihan)
docker compose up -d --build
```

Skrip mencetak password admin; simpan dan ganti setelah login pertama. API menolak start bila `JWT_SECRET` lemah, dan compose menolak start bila `DB_PASSWORD`/`ADMIN_PASSWORD` kosong.

Buka **http://localhost:8080** (atau `http://IP-SERVER:8080`). Untuk pemakaian lintas instansi gunakan HTTPS (lihat [HTTPS](#https)).

| Akun | Email | Password |
| --- | --- | --- |
| Admin | admin@ttx.local | `ADMIN_PASSWORD` di `.env` |
| Fasilitator demo | fasilitator@ttx.local | demo12345 |
| Evaluator demo | evaluator@ttx.local | demo12345 |
| Pimpinan Daerah (Sekda) | sekda@ttx.local | demo12345 |
| Kadis Kominfo | kominfo@ttx.local | demo12345 |
| Tim Teknis / CSIRT | csirt@ttx.local | demo12345 |
| Humas & PPID | humas@ttx.local | demo12345 |
| Bagian Hukum | hukum@ttx.local | demo12345 |
| OPD (Dukcapil) | dukcapil@ttx.local | demo12345 |

Akun demo dan latihan **"DEMO — Simulasi Ransomware Pemkab Sukamaju"** dibuat otomatis bila `SEED_DEMO=true`. Untuk produksi, set `SEED_DEMO=false` sebelum start pertama (atau nonaktifkan akun demo di menu **Pengguna**).

### Sebelum dipakai sungguhan

Buka **Pengaturan → Pemeriksaan keamanan** (admin). Semua butir harus hijau: password admin bukan bawaan, akun demo tidak aktif, akses lewat HTTPS, password database bukan bawaan, backup berjalan.

### Coba alur lengkap dalam 5 menit

1. Login sebagai fasilitator di satu browser, lalu sebagai `humas@`, `sekda@`, dan `csirt@` di jendela incognito/browser lain.
2. Fasilitator membuka latihan DEMO → **Mulai latihan** → **Majukan** jam ke menit 70 agar beberapa inject langsung terkirim.
3. Humas menerima inject di inbox (ada bunyi dan notifikasi), mengirim respons, lalu **Ajukan keputusan**. Keputusan masuk status *menunggu persetujuan*.
4. Sekda menerima notifikasi, membuka tab **Keputusan**, lalu **Setujui**.
5. CSIRT mengirim **Eskalasi** ke Pimpinan Daerah; Humas menerbitkan **Pernyataan publik**.
6. Evaluator memberi skor dan catatan observasi.
7. Fasilitator **Akhiri** → **Laporan AAR** → **Susun otomatis** → **Cetak / PDF**.

### Coba alur peserta: token → lamaran → siap

1. Login sebagai admin → menu **Tim instansi**. Salin token tim *Pemkot Mekarsari*.
2. Di jendela lain, klik **Peserta baru? Daftar akun** di halaman masuk dan buat akun.
3. Buka **Tim saya**, masukkan token, pilih peran (mis. Pimpinan Daerah), lalu **Gabung ke tim**.
4. Di daftar **Pelatihan tersedia**, klik **Lamar** pada latihan DEMO.
5. Fasilitator membuka tab **Persiapan** → kartu **Lamaran peserta** → **Terima**. Tim Pemkot muncul di **Keterisian peran per tim**.
6. Peserta membuka latihan dan klik **Saya siap**. Tombol **Mulai latihan** aktif setelah semua peserta siap.
7. Keputusan, eskalasi, dan chat tim Pemkot terpisah dari Pemkab: Sekda Pemkab tidak bisa menyetujui keputusan Pemkot.

Peserta demo Pemkab sudah diterima dan berstatus siap, jadi latihan DEMO bisa langsung dimulai selama belum ada pelamar baru yang diterima. Di latihan demo, peran *Pimpinan Daerah* wajib, jadi tim Pemkot perlu anggota dengan peran itu. Sekda adalah koordinator tim Pemkab.

## Fitur

**Peran & akses**
- 6 peran global: Admin, Designer, Fasilitator, Player, Evaluator, Viewer.
- **Multi-instansi**: satu latihan bisa diikuti beberapa instansi sekaligus. **Tim instansi** dibuat admin (menu *Tim instansi*), berlaku lintas latihan, dan punya set peran (preset).
  - Setiap tim punya **token bergabung** yang hanya terlihat oleh admin. Admin bisa menyalin, membuat token baru, menonaktifkan token, serta mengubah peran atau mengeluarkan anggota.
  - Peserta **mendaftar sendiri** (role Player), lalu memasukkan token di menu **Tim saya** dan memilih peran. Pendaftaran mandiri bisa dimatikan di **Pengaturan** atau lewat `ALLOW_REGISTRATION=false`.
  - Fasilitator **mempublikasikan** latihan; peserta yang sudah punya tim **melamar**. Fasilitator menerima/menolak (atau *Terima semua*). Saat diterima, tim latihan dibuat otomatis dan peran tim dipetakan ke peran latihan (bisa diubah).
  - **Undangan per instansi**: latihan bisa dibuka untuk semua instansi atau hanya instansi yang diundang (*Atur undangan* di kartu publikasi). Instansi yang tidak diundang tidak melihat latihannya.
  - **Koordinator tim** (ditandai admin) dapat *Lamarkan seluruh tim* sekaligus dan melihat status lamaran serta kesiapan setiap anggotanya.
  - Kartu **Keterisian peran per tim** menunjukkan peran yang kosong dan siapa yang sudah siap. Peran bisa ditandai **Wajib**: latihan tidak bisa dimulai bila ada tim yang belum mengisi peran wajib.
  - **Kesiapan**: peserta membaca **briefing**, mencentang checklist (termasuk tes suara), lalu menekan **Saya siap**. Latihan hanya bisa dimulai setelah semua peserta siap, atau lewat **Mulai tanpa yang belum siap** (peserta yang belum siap dikeluarkan). Reset latihan mengembalikan status siap ke awal.
  - **Pengingat & notifikasi**: peserta mendapat pengingat 15 menit sebelum jadwal (`REMIND_BEFORE_MIN`), serta notifikasi saat lamaran ditinjau dan saat latihan dimulai, di aplikasi maupun notifikasi browser.
  - Persetujuan keputusan, eskalasi, dan chat tim hanya berlaku di dalam instansi yang sama. Inject berbasis peran dikirim ke peran tersebut di semua instansi.
  - Percobaan token dibatasi per IP (`JOIN_RATE_LIMIT`) untuk mencegah tebak-tebakan.
- **Peran player kustom** per sektor, dengan 4 preset bawaan:
  - *Pemerintah Daerah*: Pimpinan Daerah, Kepala Dinas Kominfo, Tim Teknis/CSIRT Daerah, Humas & PPID, Bagian Hukum, Inspektorat, OPD Pemilik Layanan, BPBD
  - *Perbankan*, *Rumah Sakit*, *Korporasi Umum*
- Setiap peran punya deskripsi tanggung jawab dan kewenangan: **menyetujui keputusan**, **menerbitkan pernyataan publik**, **eskalasi**.
- Preset dan peran dapat dibuat, disalin, dan diubah. Peran juga bisa diubah per latihan.

**Skenario**
- 10 template bawaan: ransomware, kebocoran data (UU PDP), BEC/CEO fraud, DDoS, insider threat, defacement & judi online, disinformasi/deepfake, gempa bumi, banjir, gangguan cloud/pemasok.
- **Generator skenario**: pilih ancaman, sektor, nama organisasi, kesulitan, dan durasi. Ada 3 mesin:
  - *Bawaan* (offline, berbasis aturan + komplikasi acak sesuai kesulitan)
  - *Claude API*
  - *Ollama lokal*

  Jika mesin AI gagal, generator otomatis memakai mesin bawaan.
- Editor skenario: objective, inject (7 jenis: informasi, email, berita, medsos, log teknis, telepon, memo), target peran/tim, opsi keputusan, dan lampiran (gambar, PDF, audio, video).
- Duplikasi skenario serta impor/ekspor JSON.

**Pelaksanaan live**
- Jam simulasi dengan kecepatan 0,5×–20×, jeda/lanjut, majukan jam, dan reset untuk gladi ulang.
- Inject terjadwal dikirim otomatis oleh scheduler setiap detik. Fasilitator juga bisa kirim lebih awal, lewati, edit, atau membuat **inject ad-hoc**.
- Isi inject hanya dikirim ke peserta yang menjadi target (filter per peran dan tim di sisi server).
- Workspace peserta: inbox dengan penanda belum dibaca, tampilan sesuai jenis inject, respons per tim, log keputusan dengan alur persetujuan, kanal publik, eskalasi, chat tim dan umum, serta broadcast fasilitator.
- Konsol fasilitator menampilkan KPI live, status per peran/tim, peserta online, dan umpan aktivitas.

**Layar penonton (proyektor / TV)**
- Tombol **Layar** di header latihan membuka tampilan besar: jam simulasi, hitung mundur inject berikutnya, progres tiap instansi (kesiapan, inject dijawab, keputusan, eskalasi, pernyataan), timeline inject, kanal publik, pengumuman fasilitator, dan aktivitas terbaru. Diperbarui otomatis tiap 4 detik.
- Fasilitator dapat membuat **tautan tanpa login** untuk TV/proyektor atau penonton, dan mencabutnya kapan saja.
- Aman ditayangkan: isi inject, isi respons & keputusan, perihal eskalasi, catatan evaluator, serta nama/email peserta tidak pernah dikirim ke layar.

**Evaluasi & laporan**
- Observasi evaluator bertimestamp (kekuatan / perbaikan / catatan) yang bisa dikaitkan ke tim, peran, inject, dan objective.
- Matriks skor objective × tim (1–5) dengan komentar, plus survei kepuasan dan realisme dari peserta.
- **After-Action Report otomatis** berisi:
  - KPI dan rekap per peran: waktu respons, waktu persetujuan, waktu terima eskalasi
  - Rekap per tim, skor objective, dan daftar inject
  - Temuan dan rekomendasi otomatis
  - Ringkasan eksekutif (disusun otomatis, oleh AI, atau diedit manual)
- Rencana perbaikan (PIC, tenggat, status), replay timeline, cetak/PDF, serta ekspor CSV dan JSON.
- Dashboard tren tingkat respons dan skor antarlatihan, plus audit log admin.

## Arsitektur

| Kontainer | Isi |
| --- | --- |
| `web` | Nginx + React (Vite). Menyajikan aplikasi dan meneruskan `/api` serta `/socket.io` ke `api`. |
| `api` | Node.js 20, Express, Socket.IO, JWT, scheduler inject, generator. |
| `db` | PostgreSQL 16 (volume `pgdata`). Skema dibuat otomatis saat start. |
| `backup` | Backup otomatis database + lampiran ke folder `./backups`. |
| `caddy` | Opsional (`--profile https`), HTTPS otomatis di depan `web`. |
| `ollama` | Opsional (`--profile ai`), model AI lokal. |

## HTTPS

Profil `https` menjalankan Caddy di depan aplikasi (port 80 → dialihkan ke 443).

```bash
node scripts/init-env.js --https --domain ttx.pemkab.go.id              # jaringan internal (CA lokal)
node scripts/init-env.js --https --domain ttx.contoh.go.id --tls admin@contoh.go.id   # domain publik (Let's Encrypt)
docker compose --profile https up -d --build
```

Untuk `.env` yang sudah ada, atur manual: `DOMAIN`, `TLS` (`internal` atau email), `TRUST_PROXY=2` (agar IP peserta terbaca benar untuk pembatasan percobaan), dan `WEB_BIND=127.0.0.1` (agar port HTTP 8080 tidak bisa diakses dari jaringan).

Dengan `TLS=internal`, perangkat peserta perlu memercayai root CA Caddy, atau mereka melihat peringatan sertifikat. Ambil root CA dengan `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt` lalu pasang di perangkat atau lewat kebijakan domain. Bila instansi punya sertifikat sendiri, ganti baris `tls` di `deploy/Caddyfile` dengan `tls /path/cert.pem /path/key.pem`.

## Operasional

```bash
docker compose logs -f api                 # log backend
docker compose logs backup                 # status backup
docker compose --profile ai up -d && docker compose exec ollama ollama pull llama3.1   # AI lokal
```

**Backup otomatis.** Layanan `backup` membuat `backups/ttx-<waktu>.dump` (database) dan `backups/uploads-<waktu>.tar.gz` (lampiran) setiap `BACKUP_INTERVAL_HOURS` jam (default 24), dan menghapus yang lebih tua dari `BACKUP_KEEP_DAYS` hari (default 14). Salin folder `backups/` ke penyimpanan lain secara berkala.

**Restore** (contoh dari file `ttx-20261012-080000.dump`):

```bash
docker compose stop api
docker compose exec -T db pg_restore -U ttx -d ttx --clean --if-exists < backups/ttx-20261012-080000.dump
docker compose start api
docker compose exec -T api tar xzf - -C /app/uploads < backups/uploads-20261012-080000.tar.gz   # lampiran (opsional)
```

Di Git Bash (Windows), awali perintah yang memuat path kontainer dengan `MSYS_NO_PATHCONV=1` agar `/app/uploads` tidak diubah menjadi path Windows.

**Beban server & log**
- Log tiap container memakai driver `local` (terkompresi) dengan batas `LOG_MAX_SIZE` × `LOG_MAX_FILE` (default 10 MB × 3), sehingga disk tidak pernah penuh karena log. Tetap bisa dibaca dengan `docker compose logs`.
- Nginx tidak mencatat aset statis, ikon, dan health check; request halaman, API, dan error tetap tercatat.
- Batas memori per container (API 512 MB, database 1 GB, web 128 MB, backup 256 MB) dapat diubah di `.env`. PostgreSQL mencatat query yang lebih lambat dari 500 ms (`PG_SLOW_QUERY_MS`) untuk deteksi dini.
- Scheduler mengecek inject tiap 1 detik hanya saat ada latihan berjalan; saat diam tiap 5 detik.
- Audit log lebih tua dari `AUDIT_RETENTION_DAYS` hari (default 180) dihapus otomatis setiap hari. Timeline, chat, dan keputusan latihan **tidak** dihapus karena dipakai untuk laporan AAR; arsipkan latihan lama lewat ekspor JSON bila perlu.
- Chat dimuat per 100 pesan (tombol *Muat pesan sebelumnya*) dan dibatasi `CHAT_RATE_LIMIT` pesan per orang per 10 detik (default 20). Saat koneksi real-time pulih, chat, inbox, keputusan, dan timeline dimuat ulang otomatis.

**Akun & keamanan**
- Lupa password: admin membuka **Pengguna → Edit** lalu mengisi password baru. Tidak ada reset lewat email karena aplikasi dirancang bisa berjalan tanpa internet.
- Pembatasan percobaan hanya menghitung percobaan **gagal** (login per akun, token per akun, serta batas per IP), sehingga banyak peserta dari satu Wi-Fi tidak saling memblokir. Atur lewat variabel `*_RATE_LIMIT` di `.env`.
- Lampiran inject hanya bisa dibuka pengguna yang login (cookie HttpOnly khusus `/api/uploads`). Token login hanya diterima lewat header, tidak lewat URL.
- Pengaturan mesin AI dan pendaftaran mandiri bisa diubah dari menu **Pengaturan** (admin).
- Impor peserta massal lewat menu **Pengguna → Impor massal (CSV)**.

## Pengembangan lokal (tanpa Docker)

```bash
# PostgreSQL berjalan di localhost:5432 dengan db/user/password: ttx
cd backend && npm install && JWT_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD=admin12345 npm run dev
cd frontend && npm install && npm run dev   # http://localhost:5173
```

## Struktur

```
backend/src
  index.js          server, middleware, mount rute
  migrate.js        skema database (25 tabel)
  seed.js           admin, preset peran, template, data demo
  presets.js        preset peran player per sektor
  generator/        mesin generator bawaan + adaptor Claude/Ollama
  scheduler.js      pengiriman inject otomatis
  realtime.js       Socket.IO, room per latihan/tim/peran, presence
  routes/           auth, users, roles, scenarios, exercises, collab, evaluation, reports, system
frontend/src
  pages/            Dashboard, Latihan, Konsol, Workspace peserta, Laporan, Skenario, Generator, Peran, Admin
  components/       inject, chat, keputusan/pernyataan/eskalasi, header jam simulasi
```

## Uji otomatis

`tests/api-e2e.js` menguji 154 skenario API end-to-end (keamanan, layar penonton & pembatasan percobaan, login, pendaftaran, token tim, undangan, koordinator, lamaran, peran wajib, kesiapan, pengingat & isolasi antarinstansi, generator, siklus latihan, filter inject per peran, alur persetujuan, eskalasi, chat, evaluasi, laporan, admin) terhadap instance baru dengan data demo:

```bash
cd tests && npm init -y >/dev/null && npm i socket.io-client playwright && npx playwright install chromium
BASE=http://localhost:8080 ADMIN_PASSWORD=... node api-e2e.js         # API (butuh SEED_DEMO=true, database baru)
BASE=http://localhost:8080 ADMIN_PASSWORD=... USERS=100 node load-test.js   # uji beban, membersihkan datanya sendiri
BASE=http://localhost:8080 ADMIN_PASSWORD=... node ui-uat.js          # uji browser (Chromium): token → lamaran → siap → mulai → jawab inject
BASE=http://localhost:8080 ADMIN_PASSWORD=... node ui-chat.js         # uji browser chat: real-time, isolasi tim, kanal umum, fasilitator
node ui-chat-reconnect.js                                              # putus-sambung koneksi sungguhan (mematikan web sebentar)
BASE=http://localhost:8080 node ui-display.js                          # layar penonton: tautan tanpa login, pembaruan otomatis, ponsel
```

`api-e2e.js` dan `ui-uat.js` mengubah data demo (latihan DEMO dimulai/diakhiri), jadi jalankan di database uji, bukan produksi.

Hasil uji beban terakhir (laptop, 100 peserta serentak): 0 galat, 100/100 socket terhubung, alur peserta lengkap 11 detik. Operasi umum p95 di bawah 0,5 detik; login p95 5,6 detik bila 100 orang login di detik yang sama, karena hashing password sengaja dibuat berat.
