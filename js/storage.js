/* storage.js – localStorage wrapper */
const PFX = 'rh_';
const K = {
  PROFILE: PFX + 'profile',
  PROGRESS: PFX + 'progress',
  SKILLS: PFX + 'skills',
  COMPLETED: PFX + 'completed',
  DAILY: PFX + 'daily',
  BADGES: PFX + 'badges',
  CERT: PFX + 'cert',
  SETTINGS: PFX + 'settings',
  ADMIN_HASH: PFX + 'admin_hash',
  ADMIN_SALT: PFX + 'admin_salt',
  STUDENTS: PFX + 'students',
  PLAYERS_COUNT: PFX + 'players_count'
};

function _get(key, fallback) {
  try {
    const d = localStorage.getItem(key);
    return d ? JSON.parse(d) : fallback;
  } catch { return fallback; }
}
function _set(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

/* Profile */
export function getProfile() { return _get(K.PROFILE, null); }
export function setProfile(p) { _set(K.PROFILE, p); }

/* Progress */
const DEF_PROGRESS = { xp: 0, level: 1, textsCompleted: 0, totalCorrect: 0, totalAnswered: 0 };
export function getProgress() { return _get(K.PROGRESS, { ...DEF_PROGRESS }); }
export function setProgress(p) { _set(K.PROGRESS, p); }

/* Skills (1-15) */
export function getSkillData() {
  const d = _get(K.SKILLS, null);
  if (d) return d;
  const init = {};
  for (let i = 1; i <= 15; i++) init[i] = { attempts: [], mastery: 0, totalCorrect: 0, totalAnswered: 0 };
  return init;
}
export function setSkillData(s) { _set(K.SKILLS, s); }

/* Completed texts */
export function getCompletedTexts() { return _get(K.COMPLETED, []); }
export function addCompletedText(textId, score) {
  const arr = getCompletedTexts();
  const ex = arr.find(c => c.id === textId);
  if (ex) {
    ex.score = Math.max(ex.score, score);
    ex.attempts = (ex.attempts || 1) + 1;
    ex.lastDate = new Date().toISOString();
  } else {
    arr.push({ id: textId, score, attempts: 1, lastDate: new Date().toISOString() });
  }
  _set(K.COMPLETED, arr);
}

export function setCompletedTexts(arr) { _set(K.COMPLETED, arr); }

/* Daily */
export function getDailyData() {
  return _get(K.DAILY, { lastDate: null, streak: 0, todayDone: false, todayTextId: null });
}
export function setDailyData(d) { _set(K.DAILY, d); }

/* Badges */
export function getBadges() { return _get(K.BADGES, []); }
export function setBadges(b) { _set(K.BADGES, b); }

/* Certificate */
export function getCertData() { return _get(K.CERT, null); }
export function setCertData(c) { _set(K.CERT, c); }

/* Settings */
export function getSettings() {
  return _get(K.SETTINGS, { soundEnabled: true, soundVolume: 0.6, darkMode: false });
}
export function setSettings(s) { _set(K.SETTINGS, s); }

/* Admin (hashed password) */
export function getAdminHash() { return localStorage.getItem(K.ADMIN_HASH) || null; }
export function getAdminSalt() { return localStorage.getItem(K.ADMIN_SALT) || null; }
export function setAdminCredentials(hash, salt) {
  localStorage.setItem(K.ADMIN_HASH, hash);
  localStorage.setItem(K.ADMIN_SALT, salt);
}

/* Students list for teacher dashboard */
export function getStudents() { return _get(K.STUDENTS, []); }
export function saveStudentSnapshot() {
  const profile = getProfile();
  if (!profile) return;
  const progress = getProgress();
  const skills = getSkillData();
  const students = getStudents();
  const existing = students.findIndex(s => s.name === profile.name && s.className === profile.className);
  const snapshot = {
    name: profile.name,
    className: profile.className,
    xp: progress.xp,
    level: progress.level,
    textsCompleted: progress.textsCompleted,
    totalCorrect: progress.totalCorrect,
    totalAnswered: progress.totalAnswered,
    skills: {},
    lastActive: new Date().toISOString()
  };
  for (let i = 1; i <= 15; i++) {
    snapshot.skills[i] = skills[i] ? skills[i].mastery : 0;
  }
  if (existing >= 0) students[existing] = snapshot;
  else students.push(snapshot);
  _set(K.STUDENTS, students);
}

/* Players count (set manually by teacher) */
export function getPlayersCount() { return _get(K.PLAYERS_COUNT, 0); }
export function setPlayersCount(n) { _set(K.PLAYERS_COUNT, parseInt(n) || 0); }

/* Clear student data (not admin or students list) */
export function clearStudentData() {
  [K.PROFILE, K.PROGRESS, K.SKILLS, K.COMPLETED, K.DAILY, K.BADGES, K.CERT].forEach(k => localStorage.removeItem(k));
}

/* Clear all */
export function clearAllData() {
  Object.values(K).forEach(k => localStorage.removeItem(k));
}
