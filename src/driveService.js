import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

let cachedDriveClient = null;
let folderLock = Promise.resolve();

function getParentFolderId() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID belum dikonfigurasi di environment variables.');
  }
  return folderId;
}

function getOAuthTokenFilePath() {
  const tokenFile = process.env.GOOGLE_OAUTH_TOKEN_FILE?.trim() || './oauth-tokens.json';
  return path.resolve(process.cwd(), tokenFile);
}

function createOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || 'http://localhost:3000/auth/google/callback';

  if (!clientId || !clientSecret) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getOAuthAuthUrl() {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET belum diisi di file .env.'
    );
  }

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function handleOAuthCallback(code) {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) {
    throw new Error('Konfigurasi OAuth2 di .env belum lengkap.');
  }

  const { tokens } = await oauth2Client.getToken(code);
  const tokenPath = getOAuthTokenFilePath();
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
  cachedDriveClient = null;
  return tokens;
}

export function getDriveClient() {
  if (cachedDriveClient) return cachedDriveClient;

  // 1. Coba OAuth2 terlebih dahulu (ideal untuk Gmail pribadi)
  const oauth2Client = createOAuth2Client();
  if (oauth2Client) {
    const tokenPath = getOAuthTokenFilePath();
    if (!fs.existsSync(tokenPath)) {
      throw new Error(
        'Akun Google Drive belum terhubung. Buka http://localhost:3000/auth/google untuk login sekali.'
      );
    }

    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauth2Client.setCredentials(tokens);

    oauth2Client.on('tokens', (newTokens) => {
      const updated = { ...tokens, ...newTokens };
      fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
    });

    cachedDriveClient = google.drive({ version: 'v3', auth: oauth2Client });
    return cachedDriveClient;
  }

  // 2. Fallback ke Service Account
  let credentials = null;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON bukan format JSON yang valid.');
    }
  } else {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim() || './credentials.json';
    const resolvedPath = path.resolve(process.cwd(), keyFile);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        'Kredensial Google Drive belum diatur. Isi GOOGLE_OAUTH_CLIENT_ID & SECRET di .env (lalu buka /auth/google) atau letakkan credentials.json.'
      );
    }
    credentials = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  cachedDriveClient = google.drive({ version: 'v3', auth });
  return cachedDriveClient;
}

async function getNextSessionFolderName(drive, parentFolderId) {
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = res.data.files || [];
  let maxNumber = 0;

  for (const file of files) {
    const match = /^Sesi_(\d+)/i.exec(file.name || '');
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  const nextNum = String(maxNumber + 1).padStart(3, '0');
  return `Sesi_${nextNum}`;
}

async function createPublicFolder(drive, folderName, parentFolderId) {
  const folderRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });

  const folder = folderRes.data;

  // Berikan akses publik (read-only) pada folder sesi ini saja
  await drive.permissions.create({
    fileId: folder.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true,
  });

  return folder;
}

async function uploadJpegBuffer(drive, fileName, buffer, folderId) {
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'image/jpeg',
      body: Readable.from(buffer),
    },
    fields: 'id, name, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  return res.data;
}

/**
 * Mengunggah sesi via Google Apps Script Web App (tanpa perlu Google Cloud Console).
 */
async function uploadViaAppsScript({ sessionId, photos, stripBuffer, scriptUrl }) {
  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      photos: photos.map((buf) => buf.toString('base64')),
      strip: stripBuffer.toString('base64'),
    }),
    redirect: 'follow',
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      'Respon Google Apps Script tidak valid. Pastikan Web App di-deploy dengan akses "Anyone".'
    );
  }

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Gagal mengunggah melalui Google Apps Script.');
  }

  return {
    sessionId,
    folderName: data.folderName,
    folderId: data.folderId,
    folderUrl: data.folderUrl,
    stripFileId: data.stripFileId,
    stripViewUrl: data.stripViewUrl,
    stripDownloadUrl: data.stripDownloadUrl,
    photoCount: photos.length,
  };
}

/**
 * Membuat folder sesi unik di Google Drive dan mengunggah semua foto + photo strip.
 */
export async function uploadSessionToDrive({ sessionId, photos, stripBuffer }) {
  const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
  if (appsScriptUrl) {
    return uploadViaAppsScript({ sessionId, photos, stripBuffer, scriptUrl: appsScriptUrl });
  }

  const drive = getDriveClient();
  const parentFolderId = getParentFolderId();

  // Pastikan penomoran Sesi_XXX aman dari race condition
  let folder;
  let folderName;
  const acquireFolder = folderLock.then(async () => {
    folderName = await getNextSessionFolderName(drive, parentFolderId);
    folder = await createPublicFolder(drive, folderName, parentFolderId);
  });
  folderLock = acquireFolder.catch(() => {});
  await acquireFolder;

  // Unggah semua foto individual (foto_1.jpg, foto_2.jpg, ...) dan photo_strip.jpg
  const uploadedPhotos = [];
  for (let i = 0; i < photos.length; i++) {
    const fileName = `foto_${i + 1}.jpg`;
    const uploaded = await uploadJpegBuffer(drive, fileName, photos[i], folder.id);
    uploadedPhotos.push(uploaded);
  }

  const stripFile = await uploadJpegBuffer(drive, 'photo_strip.jpg', stripBuffer, folder.id);

  return {
    sessionId,
    folderName: folder.name,
    folderId: folder.id,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
    stripFileId: stripFile.id,
    stripViewUrl: stripFile.webViewLink || `https://drive.google.com/file/d/${stripFile.id}/view`,
    stripDownloadUrl: stripFile.webContentLink || `https://drive.google.com/uc?export=download&id=${stripFile.id}`,
    photoCount: uploadedPhotos.length,
  };
}

/**
 * Mengambil metadata photo_strip.jpg di dalam folder sesi tertentu.
 * Memastikan folder berada di dalam folder utama yang dikonfigurasi.
 */
export async function getSessionStripMetadata(folderId) {
  const drive = getDriveClient();
  const parentFolderId = getParentFolderId();

  const folderRes = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, parents, trashed',
    supportsAllDrives: true,
  });

  const folder = folderRes.data;
  if (folder.trashed || !folder.parents?.includes(parentFolderId)) {
    const err = new Error('Folder sesi tidak ditemukan.');
    err.statusCode = 404;
    throw err;
  }

  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and name = 'photo_strip.jpg' and trashed = false`,
    fields: 'files(id, name, webViewLink, webContentLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const stripFile = filesRes.data.files?.[0];
  if (!stripFile) {
    const err = new Error('File photo_strip.jpg tidak ditemukan pada sesi ini.');
    err.statusCode = 404;
    throw err;
  }

  return {
    folderId: folder.id,
    folderName: folder.name,
    stripFileId: stripFile.id,
    stripViewUrl: stripFile.webViewLink,
    folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
  };
}

export async function getDriveFileStream(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return res.data;
}
