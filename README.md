# Photobooth – Expo TA SIPERKOM

Website photobooth berbasis web untuk acara **Expo TA SIPERKOM** dengan tema biru `#0E1E54`, deteksi gesture 5 jari (MediaPipe Hands), pembuatan photo strip otomatis, penyimpanan ke Google Drive per folder sesi, dan QR Code untuk mengunduh hasil foto.

## Fitur Utama (MVP)

1. **Halaman Welcome** dengan sapaan, judul *Expo TA SIPERKOM*, deskripsi, dan tombol *Mulai Sesi Foto*.
2. **Halaman Photobooth** (2 kolom):
   - **Kiri (Camera Preview)**: Live webcam via WebRTC, tombol *Ambil Foto*, deteksi **gesture 5 jari** dengan cooldown 5 detik, countdown 3 detik, dan penanganan error izin kamera.
   - **Kanan (Pengaturan Photo Strip)**: Pilihan **2 Foto** atau **3 Foto**, tombol *Mulai Foto*, progres (`Foto X dari Y`), dan thumbnail preview.
3. **Photo Strip Otomatis**: Background biru solid `#0E1E54`, susunan vertikal dengan jarak konsisten, dan teks `Expo TA SIPERKOM` di bagian bawah.
4. **Google Drive & QR Code**:
   - Setiap sesi membuat folder baru (`Sesi_001`, `Sesi_002`, dst.) di dalam folder utama Google Drive.
   - Menyimpan `foto_1.jpg`, `foto_2.jpg`, (`foto_3.jpg`), dan `photo_strip.jpg`.
   - QR Code hanya ditampilkan setelah upload ke Google Drive berhasil.
   - Tombol **Sesi Baru** membersihkan state dan foto sesi sebelumnya.

## Setup Google Drive API (Wajib)

1. Buka [Google Cloud Console](https://console.cloud.google.com/), buat project baru (atau pilih yang sudah ada), lalu aktifkan **Google Drive API**.
2. Buka **IAM & Admin → Service Accounts**, buat Service Account baru, lalu buat **Key (JSON)** dan simpan sebagai `credentials.json` di root folder project (`d:\code\PhotoboothExpoTA\credentials.json`).
3. Buka folder Google Drive utama Anda dan salin ID foldernya (bagian akhir URL `.../folders/<FOLDER_ID>`).
4. Klik **Share** pada folder tersebut dan bagikan ke alamat email Service Account (`client_email` di `credentials.json`) dengan role **Editor**.
5. Pastikan file `.env` sudah terisi (salin dari `.env.example`):
   ```env
   PORT=3000
   GOOGLE_DRIVE_FOLDER_ID=MASUKKAN_FOLDER_ID_GOOGLE_DRIVE
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./credentials.json
   ```

## Menjalankan Aplikasi

```bash
npm start
```

Buka browser di `http://localhost:3000`.

> **Catatan HTTPS & Kamera**: Browser mengizinkan akses kamera di `http://localhost:3000`. Jika website diakses melalui IP/domain lain (misalnya dari perangkat berbeda), jalankan melalui HTTPS (atur `SSL_KEY_PATH` dan `SSL_CERT_PATH` di `.env`, atau gunakan reverse proxy / Cloudflare Tunnel) dan isi `PUBLIC_BASE_URL` di `.env` agar QR Code mengarah ke halaman unduhan khusus `/hasil/:folderId`.
