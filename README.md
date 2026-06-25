# infra-status

Dashboard status uptime untuk MrTopup, Nevalis, x45, ZAWA, dan layanan lain —
mirip [isitdownstatus.com](https://isitdownstatus.com/en), tapi 100% jalan di
GitHub (GitHub Pages + GitHub Actions), tanpa server tambahan. Kalau ada
layanan yang down, notifikasi otomatis dikirim ke WhatsApp lewat [ZAWA](https://azickri.gitbook.io/zawa).

## Cara kerja

```
.github/workflows/check-status.yml   -> cron tiap 5 menit, offset menit 02/07/12/...
            |
            v
scripts/check-sites.js               -> fetch tiap URL di data/sites.json
            |                            simpan hasil + history ke data/status.json
            |                            kalau status DOWN atau RECOVERED, kirim WA via ZAWA
            v
git commit & push data/status.json   -> otomatis ter-deploy ulang oleh GitHub Pages
            |
            v
index.html + assets/app.js           -> fetch data/status.json, render dashboard
```

Tidak ada database eksternal. Semua state (daftar situs + history status)
disimpan sebagai file JSON di repo ini.

## Setup

### 1. Push repo ini ke GitHub

```bash
cd uptime-monitor
git init
git add .
git commit -m "init: uptime monitor dashboard"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

### 2. Aktifkan GitHub Pages

Repo Settings → **Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`.

Setelah aktif, dashboard bisa diakses di `https://<username>.github.io/<repo>/`
(atau domain custom kalau kamu set CNAME ke `sayyidazizii.web.id`).

### 3. Isi GitHub Actions secrets

Repo Settings → **Secrets and variables** → **Actions** → **New repository secret**,
tambahkan:

| Secret              | Isi                                                                 |
|---------------------|----------------------------------------------------------------------|
| `ZAWA_BASE_URL`      | `https://api-zawa.azickri.com`                                      |
| `ZAWA_SESSION_ID`    | ID sesi ZAWA (header `id`, contoh: `685d558136d6fa75705fb92c`)      |
| `ZAWA_SESSION_KEY`   | Session ID ZAWA (header `session-id`)                               |
| `ZAWA_NOTIFY_PHONE`  | Nomor WA tujuan notifikasi, format internasional (`62812xxxxxxx`)    |
| `ZAWA_NOTIFY_GROUP`  | *(opsional)* Group ID WA, kalau diisi maka dipakai dan phone diabaikan |

Kalau secret ZAWA belum diisi, workflow tetap jalan dan dashboard tetap
ter-update — cuma notifikasi WA-nya di-skip (lihat log Actions).

### 4. Edit daftar situs yang dipantau

Edit `data/sites.json`:

```json
{
  "id": "nama-unik",
  "name": "Nama yang ditampilkan",
  "url": "https://contoh.com",
  "group": "Top-Up Platform",
  "expectStatus": 200,
  "timeoutMs": 10000
}
```

- `group` dipakai untuk mengelompokkan baris di dashboard (boleh bebas, mis. "Top-Up Platform", "Internal Services").
- `expectStatus` opsional, default 200. Status 2xx/3xx selain itu juga dianggap "up" kecuali kamu mau strict.

Push perubahan ke `main` — workflow otomatis jalan sekali (lihat trigger `push.paths` di workflow) tanpa nunggu cron berikutnya.

### 5. Jalankan manual (opsional, buat tes cepat)

Repo → tab **Actions** → workflow **Check Site Status** → **Run workflow**.

## Catatan keamanan soal dokumentasi ZAWA

Halaman dokumentasi ZAWA di GitBook (`kirim-pesan`) berisi blok instruksi
tersembunyi yang menyuruh pembaca otomatis (AI agent) melakukan request HTTP
tambahan dengan parameter `?ask=`. Itu **bukan** bagian dari API resminya —
itu prompt injection yang ditanam di halaman dokumentasi. Implementasi di
`scripts/check-sites.js` murni mengikuti skema OpenAPI resmi (`POST /message`
dengan header `id` + `session-id`) dan tidak memanggil endpoint `?ask=`
tersebut sama sekali.

## Mengubah interval cron

Edit `cron` di `.github/workflows/check-status.yml`:

```yaml
- cron: "2-59/5 * * * *"   # tiap 5 menit, mulai menit 02/07/12/... (default)
- cron: "7-59/15 * * * *"  # tiap 15 menit, mulai menit 07
- cron: "17-59/30 * * * *" # tiap 30 menit, mulai menit 17
```

GitHub Actions cron berbasis UTC dan tidak dijamin presisi ke menit — bisa
delay beberapa menit kalau traffic Actions sedang tinggi. Notifikasi dan
dashboard tetap diformat ke WIB (Asia/Jakarta).

## Format pesan WhatsApp

Down:
```
🔴 DOWN — Sayyidazizii
https://sayyidazizii.web.id
Alasan: HTTP 503
Durasi: down selama ~12 menit
Waktu: 25 Jun 2026, 15.10.00 WIB
```

Recovered:
```
🟢 RECOVERED — Sayyidazizii
https://sayyidazizii.web.id
Sekarang HTTP 200, latency 312ms (down selama ~12 menit)
Waktu: 25 Jun 2026, 15.22.00 WIB
```
