import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import {
  getDriveFileStream,
  getOAuthAuthUrl,
  getSessionStripMetadata,
  handleOAuthCallback,
  uploadSessionToDrive,
} from './src/driveService.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB per file
    files: 5,
  },
});

app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    driveConfigured: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID),
  });
});

app.get('/auth/google', (_req, res) => {
  try {
    const authUrl = getOAuthAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    res.status(400).send(`<h2>Konfigurasi Belum Lengkap</h2><p>${error.message}</p>`);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    if (!code) {
      return res.status(400).send('Kode otorisasi Google tidak ditemukan.');
    }
    await handleOAuthCallback(code);
    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head><meta charset="UTF-8"><title>Google Drive Terhubung</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px;background:#F4F7FC;color:#0E1E54;">
        <h1>✅ Google Drive Berhasil Terhubung!</h1>
        <p>Token tersimpan aman secara lokal di laptop kamu. Sekarang photobooth siap mengunggah foto ke folder Drive.</p>
        <a href="/" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#0E1E54;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;">
          Kembali ke Photobooth
        </a>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`<h2>Gagal Menghubungkan Google Drive</h2><p>${error.message}</p>`);
  }
});

app.post(
  '/api/upload-session',
  upload.fields([
    { name: 'photos', maxCount: 3 },
    { name: 'strip', maxCount: 1 },
    { name: 'gif', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      const photoFiles = req.files?.photos || [];
      const stripFile = req.files?.strip?.[0];
      const gifFile = req.files?.gif?.[0] || null;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'Session ID tidak valid.',
        });
      }

      if (photoFiles.length < 2 || photoFiles.length > 3 || !stripFile) {
        return res.status(400).json({
          success: false,
          error: 'Data foto tidak lengkap. Diperlukan 2 atau 3 foto dan 1 photo strip.',
        });
      }

      const driveResult = await uploadSessionToDrive({
        sessionId,
        photos: photoFiles.map((f) => f.buffer),
        stripBuffer: stripFile.buffer,
        gifBuffer: gifFile ? gifFile.buffer : null,
      });

      const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
      const useCustomResultPage =
        Boolean(publicBaseUrl) &&
        !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicBaseUrl);

      const qrTargetUrl = useCustomResultPage
        ? `${publicBaseUrl}/hasil/${encodeURIComponent(driveResult.folderId)}`
        : driveResult.folderUrl;

      const qrCodeDataUrl = await QRCode.toDataURL(qrTargetUrl, {
        width: 360,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#0E1E54',
          light: '#FFFFFF',
        },
      });

      return res.json({
        success: true,
        ...driveResult,
        qrTargetUrl,
        qrCodeDataUrl,
      });
    } catch (error) {
      console.error('Upload session error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Gagal mengunggah foto ke Google Drive.',
      });
    }
  }
);

app.get('/hasil/:folderId', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'hasil.html'));
});

app.get('/api/session/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const meta = await getSessionStripMetadata(folderId);
    res.json({
      success: true,
      folderId: meta.folderId,
      folderName: meta.folderName,
      stripImageUrl: `/api/session/${encodeURIComponent(folderId)}/strip`,
      downloadUrl: `/api/session/${encodeURIComponent(folderId)}/strip?download=1`,
      driveViewUrl: meta.stripViewUrl,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Gagal memuat hasil foto.',
    });
  }
});

app.get('/api/session/:folderId/strip', async (req, res) => {
  try {
    const { folderId } = req.params;
    const meta = await getSessionStripMetadata(folderId);
    const stream = await getDriveFileStream(meta.stripFileId);

    res.setHeader('Content-Type', 'image/jpeg');
    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="PhotoStrip_${meta.folderName}_Expo_TA_SIPERKOM.jpg"`
      );
    }

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).end('Gagal membaca file gambar.');
      }
    });

    stream.pipe(res);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Gagal mengunduh photo strip.',
    });
  }
});

function startServer() {
  const sslKeyPath = process.env.SSL_KEY_PATH?.trim();
  const sslCertPath = process.env.SSL_CERT_PATH?.trim();

  if (sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    const credentials = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };
    https.createServer(credentials, app).listen(PORT, () => {
      console.log(`Photobooth Expo TA SIPERKOM berjalan di https://localhost:${PORT}`);
    });
    return;
  }

  http.createServer(app).listen(PORT, () => {
    console.log(`Photobooth Expo TA SIPERKOM berjalan di http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
