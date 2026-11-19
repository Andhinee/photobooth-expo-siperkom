// Salin seluruh kode ini ke https://script.google.com
// Lalu klik Deploy -> New deployment -> Web app
// Execute as: Me | Who has access: Anyone

const PARENT_FOLDER_ID = 'MASUKKAN_FOLDER_ID_GOOGLE_DRIVE';

function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: 'Photobooth Expo TA SIPERKOM Apps Script aktif.' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = JSON.parse(e.postData.contents);
    const photos = payload.photos || [];
    const stripBase64 = payload.strip;

    if (photos.length < 2 || !stripBase64) {
      throw new Error('Data foto tidak lengkap.');
    }

    const parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
    const folderName = getNextSessionFolderName_(parentFolder);
    const sessionFolder = parentFolder.createFolder(folderName);

    // Atur agar hanya folder sesi ini yang bisa dilihat lewat link tanpa login
    sessionFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Simpan foto_1.jpg, foto_2.jpg, dst.
    for (let i = 0; i < photos.length; i++) {
      const bytes = Utilities.base64Decode(photos[i]);
      const blob = Utilities.newBlob(bytes, 'image/jpeg', 'foto_' + (i + 1) + '.jpg');
      sessionFolder.createFile(blob);
    }

    // Simpan photo_strip.jpg
    const stripBytes = Utilities.base64Decode(stripBase64);
    const stripBlob = Utilities.newBlob(stripBytes, 'image/jpeg', 'photo_strip.jpg');
    const stripFile = sessionFolder.createFile(stripBlob);

    const result = {
      success: true,
      folderId: sessionFolder.getId(),
      folderName: sessionFolder.getName(),
      folderUrl: sessionFolder.getUrl(),
      stripFileId: stripFile.getId(),
      stripViewUrl: stripFile.getUrl(),
      stripDownloadUrl: 'https://drive.google.com/uc?export=download&id=' + stripFile.getId(),
    };

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: err.message || String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getNextSessionFolderName_(parentFolder) {
  const folders = parentFolder.getFolders();
  let maxNumber = 0;

  while (folders.hasNext()) {
    const folder = folders.next();
    const match = /^Sesi_(\d+)/i.exec(folder.getName());
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  const nextNum = String(maxNumber + 1);
  const padded = nextNum.length >= 3 ? nextNum : ('000' + nextNum).slice(-3);
  return 'Sesi_' + padded;
}
