# CoolSense — Aplikasi Android dan iPhone

Aplikasi untuk memantau dan mengontrol pendingin ruangan CoolSense (ESP32 + DHT22 + relay + Peltier)
lewat Firebase Realtime Database. Satu kode untuk Android (APK) dan iPhone (aplikasi web di layar utama).

## Isi aplikasi

- **Kontrol**: temperatur dan kelembapan pada cincin zona SNI 03-6572-2001, tombol power ⏻
  besar, pilihan mode Otomatis/Manual, dan rantai koneksi Aplikasi → Firebase → ESP32 → Ruangan.
- **Riwayat**: grafik 60 data terakhir, temperatur terendah/rata-rata/tertinggi, persentase pendingin menyala.
- **Atur**: batas nyala dan mati (tombol − / + per 0,5 °C), kembali ke 27 °C dan 25 °C,
  info ESP32 (sinyal Wi-Fi, IP, lama menyala, status DHT22), dan keluar akun.
- **Mode demo**: tombol "Coba tanpa alat" di layar masuk, untuk mencoba tanpa ESP32.

Tombol power di mode Otomatis langsung memindahkan ke mode Manual (seperti remote AC).
Saat tombol diketuk, cincinnya berputar sampai ESP32 mengonfirmasi relay benar-benar berubah.
Kalau ESP32 tidak merespons dalam 12 detik, aplikasi memberi tahu.

## Langkah 0 — Perbarui rules Firebase (wajib)

Rules mode uji di Realtime Database berakhir **17 November 2026**. Setelah tanggal itu, ESP32,
dashboard, dan aplikasi ini ditolak membaca dan menulis.

1. Firebase Console → **Realtime Database** → tab **Rules**.
2. Hapus isinya, tempel isi file `database.rules.json`:
   ```json
   {
     "rules": {
       "coolsense": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
   }
   ```
3. Klik **Publish**. ESP32 tetap bisa menulis karena masuk sebagai akun Anonymous.

## Langkah 1 — Unggah ke GitHub

1. Buka github.com → **New repository** → nama `coolsense-app` → pilih **Public** → **Create repository**.
2. Di halaman repo kosong, klik **uploading an existing file**.
3. Ekstrak `coolsense-app.zip`, buka foldernya, pilih **semua isi** folder (termasuk folder `.github`),
   lalu seret ke halaman GitHub. Klik **Commit changes**.

## Langkah 2 — Ambil APK Android

1. Di repo, buka tab **Actions**. Proses **Build CoolSense** berjalan otomatis (sekitar 5–8 menit).
2. Setelah centang hijau, buka halaman utama repo → **Releases** (kolom kanan) → **CoolSense APK terbaru**.
3. Buka halaman itu **dari HP Android**, unduh `CoolSense.apk`, lalu ketuk untuk memasang.
   Izinkan "Instal aplikasi tidak dikenal" untuk browser bila diminta. Kalau muncul peringatan
   Play Protect, pilih **Tetap instal** (APK ini ditandatangani kunci debug, bukan dari Play Store).

Setiap kali file diubah dan diunggah lagi, APK baru dibuat otomatis.

## Langkah 3 — Pasang di iPhone

Aplikasi iOS asli (.ipa) hanya bisa dibuat dengan Mac + Xcode. Sebagai gantinya, aplikasi ini
bisa dipasang di layar utama iPhone dan tampil layar penuh seperti aplikasi biasa:

1. Repo → **Settings** → **Pages** → bagian *Build and deployment*, **Source: GitHub Actions**.
2. Tab **Actions** → **Build CoolSense** → **Run workflow** (atau unggah ulang satu file).
3. Alamatnya menjadi `https://NAMA-GITHUB-ANDA.github.io/coolsense-app/`.
4. Buka alamat itu di **Safari** iPhone → tombol **Bagikan** → **Tambahkan ke Layar Utama**.

## Mencoba di laptop

Buka folder `www` di VS Code → klik kanan `index.html` → **Open with Live Server**.
Tambahkan `?demo` di akhir alamat untuk mode demo, misalnya `http://127.0.0.1:5500/index.html?demo`.

## Mengubah kode

Kode sumber ada di `src/` (`main.js`, `style.css`, `firebase-config.js`).
Hasil build ada di `www/assets/` dan dibuat ulang otomatis oleh GitHub.
Kalau mengubah di laptop: `npm install` lalu `npm run build` (butuh Node.js 22 atau lebih baru).

## Akun

Masuk memakai akun email/password yang sama dengan dashboard web, atau buat akun baru lewat tab **Daftar**.
