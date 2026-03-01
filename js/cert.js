/* cert.js – Certificate Generator (Background Image + Dynamic Text) */
import * as storage from './storage.js';
import { generateVerificationId } from './engine.js';
import { getGrade, formatDate } from './ui.js';

export function generateCertificate(config) {
  const profile = storage.getProfile();
  const progress = storage.getProgress();
  const avgPercent = progress.totalAnswered > 0 ? Math.round((progress.totalCorrect / progress.totalAnswered) * 100) : 0;
  const grade = getGrade(avgPercent);
  const vid = generateVerificationId();
  const date = new Date().toISOString();

  const certData = {
    name: profile.name,
    className: profile.className,
    date, avgPercent, grade,
    verificationId: vid,
    xp: progress.xp,
    textsCompleted: progress.textsCompleted
  };

  storage.setCertData(certData);
  return certData;
}

/* ─── Helper: load image ─── */
function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 5000);
  });
}

/* ══════════════════════════════════════════════════
   ██  MAIN: Draw certificate on Canvas
   ══════════════════════════════════════════════════ */
export function drawCertificateCanvas(certData, config) {
  return new Promise(async (resolve) => {
    // 1. Load background image
    const bgImage = await loadImg('assets/certificate-bg.png');
    if (!bgImage) {
      console.error('Failed to load certificate background image');
      resolve(null);
      return;
    }

    // 2. Create canvas matching image dimensions
    const canvas = document.createElement('canvas');
    canvas.width = bgImage.width;
    canvas.height = bgImage.height;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // 3. Draw background image
    ctx.drawImage(bgImage, 0, 0);

    // 4. Student name
    const nameFontSize = Math.round(W * 0.05);
    ctx.font = `bold ${nameFontSize}px "Cairo", "Tajawal", sans-serif`;
    ctx.fillStyle = '#1a2e5a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText(certData.name, W / 2, H * 0.42);

    // 5. Date (under التاريخ label in design)
    const dateFontSize = Math.round(W * 0.0266);
    ctx.font = `bold ${dateFontSize}px "Tajawal", "Cairo", sans-serif`;
    ctx.fillStyle = '#1a2e5a';
    ctx.textAlign = 'center';
    ctx.fillText(formatDate(certData.date), W * 0.74, H * 0.713);

    resolve(canvas);
  });
}

export async function downloadCertAsPNG(certData, config) {
  const canvas = await drawCertificateCanvas(certData, config);
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'شهادة_أبطال_القراءة_' + certData.name + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}
