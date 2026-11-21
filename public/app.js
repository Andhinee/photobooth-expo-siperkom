const STRIP_BG_COLOR = '#0E1E54';
const GESTURE_HOLD_FRAMES = 5;
const GESTURE_COOLDOWN_MS = 5000;
const GESTURE_POLL_INTERVAL_MS = 100;
const AUTO_RESET_SECONDS = 120;

const views = {
  welcome: document.getElementById('view-welcome'),
  photobooth: document.getElementById('view-photobooth'),
  result: document.getElementById('view-result'),
};

const els = {
  btnStartSession: document.getElementById('btn-start-session'),
  btnToggleSound: document.getElementById('btn-toggle-sound'),
  btnBackWelcome: document.getElementById('btn-back-welcome'),
  btnRetryCamera: document.getElementById('btn-retry-camera'),
  btnAmbilFoto: document.getElementById('btn-ambil-foto'),
  btnRetakeLast: document.getElementById('btn-retake-last'),
  btnMulaiFoto: document.getElementById('btn-mulai-foto'),
  btnNewSession: document.getElementById('btn-new-session'),
  btnNewSessionBottom: document.getElementById('btn-new-session-bottom'),
  btnRetryUpload: document.getElementById('btn-retry-upload'),

  video: document.getElementById('camera-video'),
  cameraFlash: document.getElementById('camera-flash'),
  cameraErrorOverlay: document.getElementById('camera-error-overlay'),
  cameraErrorMessage: document.getElementById('camera-error-message'),
  countdownOverlay: document.getElementById('countdown-overlay'),
  countdownNumber: document.getElementById('countdown-number'),
  gestureBadge: document.getElementById('gesture-badge'),
  gestureStatusPill: document.getElementById('gesture-status-pill'),
  gestureStatusText: document.getElementById('gesture-status-text'),

  countOptions: Array.from(document.querySelectorAll('.count-option')),
  photoProgressText: document.getElementById('photo-progress-text'),
  panelCountdownStatus: document.getElementById('panel-countdown-status'),
  capturedThumbnails: document.getElementById('captured-thumbnails'),

  captureCanvas: document.getElementById('capture-canvas'),
  stripCanvas: document.getElementById('strip-canvas'),
  resultStripImg: document.getElementById('result-strip-img'),
  resultTabs: document.getElementById('result-tabs'),
  resultTabButtons: Array.from(document.querySelectorAll('.result-tab')),
  stripFramePanel: document.getElementById('strip-frame-panel'),
  gifFramePanel: document.getElementById('gif-frame-panel'),
  resultGifImg: document.getElementById('result-gif-img'),

  uploadLoadingState: document.getElementById('upload-loading-state'),
  uploadErrorState: document.getElementById('upload-error-state'),
  uploadErrorMessage: document.getElementById('upload-error-message'),
  uploadSuccessState: document.getElementById('upload-success-state'),
  sessionFolderLabel: document.getElementById('session-folder-label'),
  qrCodeImg: document.getElementById('qr-code-img'),
  qrDirectLink: document.getElementById('qr-direct-link'),
  autoResetNotice: document.getElementById('auto-reset-notice'),
  autoResetSeconds: document.getElementById('auto-reset-seconds'),
  btnExtendReset: document.getElementById('btn-extend-reset'),
};

const state = {
  sessionId: createSessionId(),
  photoCount: 2,
  capturedPhotos: [], // { blob, dataUrl }
  stripResult: null,  // { blob, dataUrl }
  gifResult: null,    // { blob, dataUrl }
  stream: null,
  cameraReady: false,
  isCapturing: false,
  activeView: 'welcome',

  hands: null,
  handsReady: false,
  gestureLoopTimer: null,
  isDetectingFrame: false,
  fiveFingerStreak: 0,
  gestureCooldownUntil: 0,
  soundEnabled: true,
  audioCtx: null,
  autoResetTimer: null,
  autoResetRemaining: AUTO_RESET_SECONDS,
};

function createSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `sesi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function showView(viewName) {
  state.activeView = viewName;
  Object.entries(views).forEach(([key, section]) => {
    section.classList.toggle('view-active', key === viewName);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setGestureStatus(type, text) {
  els.gestureStatusPill.className = `status-pill status-${type}`;
  els.gestureStatusText.textContent = text;
}

function updateControlsUI() {
  const taken = state.capturedPhotos.length;
  const total = state.photoCount;
  const locked = state.isCapturing || taken > 0;

  els.countOptions.forEach((btn) => {
    const count = Number(btn.dataset.count);
    btn.classList.toggle('active', count === total);
    btn.disabled = locked;
  });

  const canCapture = state.cameraReady && !state.isCapturing && taken < total;
  els.btnAmbilFoto.disabled = !canCapture;
  els.btnMulaiFoto.disabled = !canCapture;

  els.btnRetakeLast.classList.toggle(
    'hidden',
    !(taken > 0 && taken < total && !state.isCapturing)
  );

  els.photoProgressText.textContent = `Foto ${taken} dari ${total}`;
  renderThumbnailSlots();
}

function renderThumbnailSlots() {
  const total = state.photoCount;
  els.capturedThumbnails.dataset.count = String(total);
  els.capturedThumbnails.innerHTML = '';

  for (let i = 0; i < total; i++) {
    const slot = document.createElement('div');
    const photo = state.capturedPhotos[i];
    if (photo) {
      slot.className = 'thumb-slot filled';
      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.alt = `Foto ${i + 1}`;
      slot.appendChild(img);
    } else {
      slot.className = 'thumb-slot';
      slot.textContent = `Foto ${i + 1}`;
    }
    els.capturedThumbnails.appendChild(slot);
  }
}

async function startCamera() {
  stopCamera();
  state.cameraReady = false;
  els.cameraErrorOverlay.classList.add('hidden');
  updateControlsUI();

  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError(
      'Browser ini tidak mendukung akses kamera atau website tidak dibuka melalui HTTPS / localhost.'
    );
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    });

    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();

    state.cameraReady = true;
    els.cameraErrorOverlay.classList.add('hidden');
    updateControlsUI();
    initHandTracking();
  } catch (err) {
    let message = 'Akses kamera diperlukan untuk menggunakan photobooth.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      message = 'Izin kamera ditolak. Mohon izinkan akses kamera pada pengaturan browser lalu coba lagi.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      message = 'Kamera tidak ditemukan pada perangkat ini. Pastikan webcam terhubung.';
    }
    showCameraError(message);
  }
}

function showCameraError(message) {
  state.cameraReady = false;
  els.cameraErrorMessage.textContent = message;
  els.cameraErrorOverlay.classList.remove('hidden');
  updateControlsUI();
}

function stopCamera() {
  if (state.gestureLoopTimer) {
    clearInterval(state.gestureLoopTimer);
    state.gestureLoopTimer = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  els.video.srcObject = null;
  state.cameraReady = false;
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function isFiveFingersOpen(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;

  const indexOpen = landmarks[8].y < landmarks[6].y;
  const middleOpen = landmarks[12].y < landmarks[10].y;
  const ringOpen = landmarks[16].y < landmarks[14].y;
  const pinkyOpen = landmarks[20].y < landmarks[18].y;

  // Ibu jari terbuka jika jarak ujung ibu jari (4) ke pangkal kelingking (17) lebih jauh dari sendi (3) ke (17)
  const thumbTipDist = distance2D(landmarks[4], landmarks[17]);
  const thumbIpDist = distance2D(landmarks[3], landmarks[17]);
  const thumbOpen = thumbTipDist > thumbIpDist * 1.15;

  return indexOpen && middleOpen && ringOpen && pinkyOpen && thumbOpen;
}

function initHandTracking() {
  if (state.handsReady) {
    startGestureLoop();
    return;
  }

  if (typeof window.Hands !== 'function') {
    setGestureStatus('error', 'Deteksi tangan tidak tersedia (gunakan tombol)');
    return;
  }

  try {
    const hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    hands.onResults(onHandResults);
    state.hands = hands;
    state.handsReady = true;
    setGestureStatus('ready', 'Gesture 5 Jari: Siap');
    startGestureLoop();
  } catch (err) {
    console.warn('Gagal menginisialisasi MediaPipe Hands:', err);
    setGestureStatus('error', 'Deteksi tangan gagal dimuat');
  }
}

function startGestureLoop() {
  if (state.gestureLoopTimer) {
    clearInterval(state.gestureLoopTimer);
  }

  state.gestureLoopTimer = setInterval(async () => {
    if (
      state.activeView !== 'photobooth' ||
      !state.cameraReady ||
      !state.handsReady ||
      state.isCapturing ||
      state.isDetectingFrame ||
      els.video.readyState < 2
    ) {
      return;
    }

    const now = Date.now();
    if (now < state.gestureCooldownUntil) {
      const remainingSec = Math.ceil((state.gestureCooldownUntil - now) / 1000);
      setGestureStatus('cooldown', `Cooldown gesture (${remainingSec}d)`);
      return;
    }

    setGestureStatus('ready', 'Gesture 5 Jari: Siap');
    state.isDetectingFrame = true;
    try {
      await state.hands.send({ image: els.video });
    } catch {
      // Abaikan frame error sesaat
    } finally {
      state.isDetectingFrame = false;
    }
  }, GESTURE_POLL_INTERVAL_MS);
}

function onHandResults(results) {
  if (state.activeView !== 'photobooth' || state.isCapturing) {
    state.fiveFingerStreak = 0;
    els.gestureBadge.classList.add('hidden');
    return;
  }

  if (Date.now() < state.gestureCooldownUntil) {
    state.fiveFingerStreak = 0;
    els.gestureBadge.classList.add('hidden');
    return;
  }

  const landmarks = results?.multiHandLandmarks?.[0];
  if (landmarks && isFiveFingersOpen(landmarks)) {
    state.fiveFingerStreak += 1;
    els.gestureBadge.classList.remove('hidden');

    if (state.fiveFingerStreak >= GESTURE_HOLD_FRAMES) {
      state.fiveFingerStreak = 0;
      state.gestureCooldownUntil = Date.now() + GESTURE_COOLDOWN_MS;
      els.gestureBadge.classList.add('hidden');
      startCaptureSequence();
    }
  } else {
    state.fiveFingerStreak = 0;
    els.gestureBadge.classList.add('hidden');
  }
}

function ensureAudioContext() {
  if (!state.soundEnabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.audioCtx) {
    state.audioCtx = new AudioCtx();
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

function playCountdownBeep(sec) {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(sec === 1 ? 880 : 660, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

function playShutterSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Klik mekanik singkat
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = 'triangle';
  clickOsc.frequency.setValueAtTime(1400, now);
  clickOsc.frequency.exponentialRampToValueAtTime(320, now + 0.045);
  clickGain.gain.setValueAtTime(0.28, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  clickOsc.connect(clickGain);
  clickGain.connect(ctx.destination);
  clickOsc.start(now);
  clickOsc.stop(now + 0.055);

  // Burst noise halus untuk efek shutter kamera
  const bufferSize = Math.floor(ctx.sampleRate * 0.07);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2200, now);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.32, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);
}

function triggerFlash() {
  playShutterSound();
  els.cameraFlash.classList.remove('flash-active');
  void els.cameraFlash.offsetWidth;
  els.cameraFlash.classList.add('flash-active');
}

async function runCountdown() {
  els.countdownOverlay.classList.remove('hidden');
  for (let sec = 3; sec >= 1; sec--) {
    els.countdownNumber.textContent = String(sec);
    els.countdownNumber.style.animation = 'none';
    void els.countdownNumber.offsetWidth;
    els.countdownNumber.style.animation = '';
    els.panelCountdownStatus.textContent = `${sec}...`;
    playCountdownBeep(sec);
    await sleep(1000);
  }
  els.countdownOverlay.classList.add('hidden');
  els.panelCountdownStatus.textContent = '3 detik otomatis';
}

function captureFrameFromVideo() {
  const video = els.video;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Kamera belum siap mengambil gambar.');
  }

  // Crop ke rasio 4:3 agar konsisten dengan preview dan photo strip
  const targetRatio = 4 / 3;
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const srcRatio = srcW / srcH;

  let cropW = srcW;
  let cropH = srcH;
  let cropX = 0;
  let cropY = 0;

  if (srcRatio > targetRatio) {
    cropW = srcH * targetRatio;
    cropX = (srcW - cropW) / 2;
  } else if (srcRatio < targetRatio) {
    cropH = srcW / targetRatio;
    cropY = (srcH - cropH) / 2;
  }

  const outW = 960;
  const outH = 720;
  const canvas = els.captureCanvas;
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext('2d');
  ctx.save();
  // Mirror horizontal agar sama dengan tampilan live preview
  ctx.translate(outW, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Gagal memproses gambar dari kamera.'));
          return;
        }
        const dataUrl = URL.createObjectURL(blob);
        resolve({ blob, dataUrl });
      },
      'image/jpeg',
      0.92
    );
  });
}

async function startCaptureSequence() {
  if (!state.cameraReady || state.isCapturing) return;
  if (state.capturedPhotos.length >= state.photoCount) return;

  state.isCapturing = true;
  els.gestureBadge.classList.add('hidden');
  updateControlsUI();

  try {
    while (state.capturedPhotos.length < state.photoCount) {
      await runCountdown();
      triggerFlash();

      const captured = await captureFrameFromVideo();
      state.capturedPhotos.push(captured);
      updateControlsUI();

      if (state.capturedPhotos.length < state.photoCount) {
        await sleep(900);
      }
    }

    // Set cooldown setelah sesi foto selesai
    state.gestureCooldownUntil = Date.now() + GESTURE_COOLDOWN_MS;

    // Buat photo strip & bonus boomerang GIF otomatis
    await generatePhotoStrip();
    await generateBoomerangGif();
    showView('result');
    stopCamera();
    await uploadSession();
  } catch (err) {
    alert(err.message || 'Gagal mengambil foto. Silakan coba ambil ulang.');
  } finally {
    state.isCapturing = false;
    state.gestureCooldownUntil = Date.now() + GESTURE_COOLDOWN_MS;
    els.countdownOverlay.classList.add('hidden');
    els.panelCountdownStatus.textContent = '3 detik otomatis';
    updateControlsUI();
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar untuk photo strip.'));
    img.src = src;
  });
}

async function generatePhotoStrip() {
  const count = state.capturedPhotos.length;
  const stripWidth = 720;
  const paddingX = 44;
  const paddingTop = 44;
  const gapY = 30;
  const footerHeight = 120;

  const photoW = stripWidth - paddingX * 2; // 632
  const photoH = Math.round((photoW * 3) / 4); // 474 (4:3)
  const stripHeight = paddingTop + count * photoH + (count - 1) * gapY + footerHeight;

  const canvas = els.stripCanvas;
  canvas.width = stripWidth;
  canvas.height = stripHeight;

  const ctx = canvas.getContext('2d');

  // Background biru solid #0E1E54
  ctx.fillStyle = STRIP_BG_COLOR;
  ctx.fillRect(0, 0, stripWidth, stripHeight);

  const images = await Promise.all(state.capturedPhotos.map((p) => loadImage(p.dataUrl)));

  images.forEach((img, index) => {
    const x = paddingX;
    const y = paddingTop + index * (photoH + gapY);

    // Frame putih tipis di sekitar foto agar terlihat seperti photo strip asli
    ctx.save();
    drawRoundedRect(ctx, x - 4, y - 4, photoW + 8, photoH + 8, 14);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, x, y, photoW, photoH, 10);
    ctx.clip();
    ctx.drawImage(img, x, y, photoW, photoH);
    ctx.restore();
  });

  // Tulisan "Expo TA SIPERKOM" dan tanggal "20/11/2026" di bagian bawah strip
  const centerY = stripHeight - footerHeight / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Expo TA SIPERKOM', stripWidth / 2, centerY - 12);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('20/11/2026', stripWidth / 2, centerY + 20);

  const stripBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Gagal membuat file photo strip.'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      0.94
    );
  });

  if (state.stripResult?.dataUrl) {
    URL.revokeObjectURL(state.stripResult.dataUrl);
  }

  const stripDataUrl = URL.createObjectURL(stripBlob);
  state.stripResult = { blob: stripBlob, dataUrl: stripDataUrl };
  els.resultStripImg.src = stripDataUrl;
}

function setResultTab(tabName) {
  const showGif = tabName === 'gif' && Boolean(state.gifResult);
  els.stripFramePanel.classList.toggle('hidden', showGif);
  els.gifFramePanel.classList.toggle('hidden', !showGif);

  els.resultTabButtons.forEach((btn) => {
    const isActive = (showGif ? 'gif' : 'strip') === btn.dataset.tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

async function generateBoomerangGif() {
  try {
    const { GIFEncoder, quantize, applyPalette } = await import(
      'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js'
    );

    const width = 480;
    const height = 360;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const images = await Promise.all(state.capturedPhotos.map((p) => loadImage(p.dataUrl)));
    // Urutan boomerang: 2 foto -> [0, 1], 3 foto -> [0, 1, 2, 1]
    const sequence = images.length === 3 ? [images[0], images[1], images[2], images[1]] : images;

    const gif = GIFEncoder();
    const delay = images.length === 3 ? 420 : 500;

    for (const img of sequence) {
      ctx.drawImage(img, 0, 0, width, height);

      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, width, height, { palette, delay });
    }

    gif.finish();
    const gifBlob = new Blob([gif.bytes()], { type: 'image/gif' });

    if (state.gifResult?.dataUrl) {
      URL.revokeObjectURL(state.gifResult.dataUrl);
    }

    const gifDataUrl = URL.createObjectURL(gifBlob);
    state.gifResult = { blob: gifBlob, dataUrl: gifDataUrl };
    els.resultGifImg.src = gifDataUrl;
    els.resultTabs.classList.remove('hidden');
    setResultTab('strip');
  } catch (err) {
    console.warn('Gagal membuat Boomerang GIF:', err);
    state.gifResult = null;
    els.resultTabs.classList.add('hidden');
    setResultTab('strip');
  }
}

async function uploadSession() {
  els.uploadLoadingState.classList.remove('hidden');
  els.uploadErrorState.classList.add('hidden');
  els.uploadSuccessState.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('sessionId', state.sessionId);

    state.capturedPhotos.forEach((photo, idx) => {
      formData.append('photos', photo.blob, `foto_${idx + 1}.jpg`);
    });
    formData.append('strip', state.stripResult.blob, 'photo_strip.jpg');
    if (state.gifResult?.blob) {
      formData.append('gif', state.gifResult.blob, 'boomerang.gif');
    }

    const response = await fetch('/api/upload-session', {
      method: 'POST',
      body: formData,
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Server mengembalikan respon tidak valid (HTTP ${response.status}).`);
    }
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Upload ke Google Drive gagal.');
    }

    els.sessionFolderLabel.textContent = `Sesi ${data.folderName} Selesai!`;
    els.qrCodeImg.src = data.qrCodeDataUrl;
    els.qrDirectLink.href = data.qrTargetUrl;

    els.uploadLoadingState.classList.add('hidden');
    els.uploadSuccessState.classList.remove('hidden');
    startAutoResetTimer();
  } catch (err) {
    els.uploadLoadingState.classList.add('hidden');
    els.uploadSuccessState.classList.add('hidden');
    els.uploadErrorMessage.textContent =
      err.message || 'Gagal mengunggah ke Google Drive. QR Code tidak dapat ditampilkan.';
    els.uploadErrorState.classList.remove('hidden');
  }
}

function stopAutoResetTimer() {
  if (state.autoResetTimer) {
    clearInterval(state.autoResetTimer);
    state.autoResetTimer = null;
  }
  els.autoResetNotice.classList.add('hidden');
}

function startAutoResetTimer(seconds = AUTO_RESET_SECONDS) {
  stopAutoResetTimer();
  state.autoResetRemaining = seconds;
  els.autoResetSeconds.textContent = String(state.autoResetRemaining);
  els.autoResetNotice.classList.remove('hidden');

  state.autoResetTimer = setInterval(() => {
    if (state.activeView !== 'result') {
      stopAutoResetTimer();
      return;
    }

    state.autoResetRemaining -= 1;
    els.autoResetSeconds.textContent = String(Math.max(0, state.autoResetRemaining));

    if (state.autoResetRemaining <= 0) {
      stopAutoResetTimer();
      resetSession('welcome');
    }
  }, 1000);
}

function resetSession(targetView = 'welcome') {
  stopAutoResetTimer();
  state.capturedPhotos.forEach((p) => URL.revokeObjectURL(p.dataUrl));
  if (state.stripResult?.dataUrl) {
    URL.revokeObjectURL(state.stripResult.dataUrl);
  }
  if (state.gifResult?.dataUrl) {
    URL.revokeObjectURL(state.gifResult.dataUrl);
  }

  state.sessionId = createSessionId();
  state.capturedPhotos = [];
  state.stripResult = null;
  state.gifResult = null;
  state.isCapturing = false;
  state.fiveFingerStreak = 0;
  state.gestureCooldownUntil = 0;

  els.resultStripImg.removeAttribute('src');
  els.resultGifImg.removeAttribute('src');
  els.resultTabs.classList.add('hidden');
  setResultTab('strip');
  els.qrCodeImg.removeAttribute('src');
  els.qrDirectLink.href = '#';

  updateControlsUI();

  if (targetView === 'welcome') {
    stopCamera();
    showView('welcome');
  } else {
    showView('photobooth');
    startCamera();
  }
}

// Event Listeners
els.btnStartSession.addEventListener('click', () => {
  ensureAudioContext();
  resetSession('photobooth');
});

els.btnToggleSound.addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  els.btnToggleSound.textContent = state.soundEnabled ? '🔊 Suara' : '🔇 Mute';
  if (state.soundEnabled) {
    ensureAudioContext();
  }
});

els.btnBackWelcome.addEventListener('click', () => {
  if (state.isCapturing) return;
  resetSession('welcome');
});

els.btnRetryCamera.addEventListener('click', () => {
  startCamera();
});

els.countOptions.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (state.isCapturing || state.capturedPhotos.length > 0) return;
    state.photoCount = Number(btn.dataset.count);
    updateControlsUI();
  });
});

els.btnMulaiFoto.addEventListener('click', () => {
  ensureAudioContext();
  startCaptureSequence();
});

els.btnAmbilFoto.addEventListener('click', () => {
  ensureAudioContext();
  startCaptureSequence();
});

els.btnRetakeLast.addEventListener('click', () => {
  if (state.isCapturing || state.capturedPhotos.length === 0) return;
  const removed = state.capturedPhotos.pop();
  if (removed?.dataUrl) {
    URL.revokeObjectURL(removed.dataUrl);
  }
  updateControlsUI();
});

els.btnRetryUpload.addEventListener('click', () => {
  uploadSession();
});

els.btnNewSession.addEventListener('click', () => {
  resetSession('welcome');
});

els.btnNewSessionBottom.addEventListener('click', () => {
  resetSession('welcome');
});

els.btnExtendReset.addEventListener('click', () => {
  if (state.activeView !== 'result') return;
  state.autoResetRemaining += 30;
  els.autoResetSeconds.textContent = String(state.autoResetRemaining);
});

els.resultTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setResultTab(btn.dataset.tab);
  });
});

// Inisialisasi awal
updateControlsUI();
