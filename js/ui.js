/* ui.js – UI Helpers + Sound Effects (Web Audio API) */
import * as storage from './storage.js';

/* ===== Sound Engine (Web Audio API) ===== */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, duration, type, vol) {
  const settings = storage.getSettings();
  if (!settings.soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = (vol || 0.3) * settings.soundVolume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* silent fail */ }
}

export function playCorrectSound() {
  playTone(523, 0.12, 'sine', 0.3);
  setTimeout(() => playTone(659, 0.12, 'sine', 0.3), 80);
  setTimeout(() => playTone(784, 0.2, 'sine', 0.35), 160);
}

export function playWrongSound() {
  playTone(250, 0.15, 'square', 0.2);
  setTimeout(() => playTone(200, 0.25, 'square', 0.15), 120);
}

export function playSuccessSound() {
  const notes = [523, 587, 659, 698, 784, 880, 988, 1047];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 0.15, 'sine', 0.25), i * 80);
  });
}

export function playTickSound() {
  playTone(1000, 0.04, 'sine', 0.15);
}

export function playUrgentTick() {
  playTone(1400, 0.06, 'square', 0.2);
}

export function playTimeUpSound() {
  playTone(400, 0.15, 'sawtooth', 0.2);
  setTimeout(() => playTone(300, 0.25, 'sawtooth', 0.15), 150);
}

/* ===== Confetti ===== */
export function showConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  const colors = ['#6366F1', '#F59E0B', '#14B8A6', '#22C55E', '#EF4444', '#818CF8', '#EC4899'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + '%';
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = Math.random() * 0.8 + 's';
    p.style.animationDuration = (2 + Math.random() * 1.5) + 's';
    p.style.width = (6 + Math.random() * 8) + 'px';
    p.style.height = (6 + Math.random() * 8) + 'px';
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    container.appendChild(p);
  }
  setTimeout(() => { container.innerHTML = ''; }, 3500);
}

/* ===== Toast ===== */
export function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 2800);
}

/* ===== Color Helpers ===== */
export function getMasteryColor(val) {
  if (val >= 80) return '#22C55E';
  if (val >= 50) return '#F59E0B';
  return '#EF4444';
}

export function getScoreColor(pct) {
  if (pct >= 80) return '#22C55E';
  if (pct >= 60) return '#F59E0B';
  return '#EF4444';
}

/* ===== Grade ===== */
export function getGrade(pct) {
  if (pct >= 90) return 'ممتاز';
  if (pct >= 80) return 'جيد جدًا';
  if (pct >= 70) return 'جيد';
  if (pct >= 60) return 'مقبول';
  return 'يحتاج تحسين';
}

/* ===== Difficulty ===== */
export function getDiffClass(diff) {
  if (diff === 'سهل') return 'diff-easy';
  if (diff === 'متوسط') return 'diff-medium';
  return 'diff-hard';
}

/* ===== Skill Names ===== */
let SKILL_NAMES = {
  1: 'مرادفات المفردات', 2: 'جذر الكلمة والاشتقاق', 3: 'المترادفات والأضداد',
  4: 'المفرد والجمع', 5: 'نوع النص وغرضه', 6: 'المعلومات الصريحة',
  7: 'الفكرة الرئيسة', 8: 'التفاصيل الداعمة', 9: 'الاستنتاج والاستدلال',
  10: 'الحقيقة والرأي', 11: 'تحديد موقع المعلومة', 12: 'القيم والصفات',
  13: 'العنوان البديل', 14: 'هدف الكاتب والأدلة', 15: 'التطبيق الحياتي'
};

export function setSkillNames(skills) {
  if (!Array.isArray(skills)) return;
  skills.forEach(s => { if (s.id && s.name) SKILL_NAMES[s.id] = s.name; });
}

export function getSkillName(id) {
  return SKILL_NAMES[id] || 'مهارة ' + id;
}

/* ===== Date Formatting ===== */
export function formatDate(d) {
  try {
    const date = new Date(d);
    return date.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return d; }
}

/* ===== Letter Index ===== */
export function letterFromIndex(i) {
  return ['أ', 'ب', 'ج', 'د'][i] || '';
}
