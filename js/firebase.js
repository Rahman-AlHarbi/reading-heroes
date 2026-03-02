/* firebase.js – Firebase Auth + Firestore Cloud Sync + Realtime Database */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, getDocs, where }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         sendPasswordResetEmail, signOut, onAuthStateChanged, updateProfile }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { getDatabase, ref, set, get, update, onValue, onDisconnect, remove,
         serverTimestamp as rtdbTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyCl5r0AqjHqnaT6jnpl9m9hhfonkOWa0K8",
  authDomain: "reading-heroes.firebaseapp.com",
  databaseURL: "https://reading-heroes-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "reading-heroes",
  storageBucket: "reading-heroes.firebasestorage.app",
  messagingSenderId: "1028826510609",
  appId: "1:1028826510609:web:0692713025ea9c360288b0",
  measurementId: "G-X8WJF3MV6G"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
auth.languageCode = 'ar';
const rtdb = getDatabase(app);

/* ===== Realtime Database Exports ===== */
export { rtdb, ref, set, get, update, onValue, onDisconnect, remove, rtdbTimestamp };

/* ===== Auth Functions ===== */

export async function registerUser(email, password, displayName, className) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    const uid = cred.user.uid;
    // Initial user document
    await setDoc(doc(db, 'users', uid), {
      name: displayName,
      className: className || 'غير محدد',
      email: email,
      xp: 0, level: 1, textsCompleted: 0,
      totalCorrect: 0, totalAnswered: 0,
      skills: _defaultSkills(),
      completedTexts: [],
      badges: [],
      daily: { lastDate: null, streak: 0, todayDone: false, todayTextId: null },
      settings: { soundEnabled: true, soundVolume: 0.6 },
      certData: null,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    });
    // Leaderboard entry
    await _syncLeaderboard(uid, displayName, className || 'غير محدد', 0, 1, 0, 0, 0);
    return { success: true, user: cred.user };
  } catch (e) {
    return { success: false, error: _mapAuthError(e.code) };
  }
}

export async function loginUser(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: cred.user };
  } catch (e) {
    return { success: false, error: _mapAuthError(e.code) };
  }
}

export async function resetPassword(email) {
  try {
    // تحقق من وجود الإيميل في قاعدة البيانات أولاً
    const q = query(collection(db, 'users'), where('email', '==', email), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      return { success: false, error: 'لا يوجد حساب بهذا البريد الإلكتروني' };
    }
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (e) {
    return { success: false, error: _mapAuthError(e.code) };
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

/* ===== Cloud Sync ===== */

export async function pullUserData(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return snap.data();
    return null;
  } catch (e) {
    console.warn('[Firebase] pull failed:', e.message);
    return null;
  }
}

export async function pushUserData(uid, data) {
  try {
    await setDoc(doc(db, 'users', uid), {
      ...data,
      lastActive: new Date().toISOString()
    }, { merge: true });
    await _syncLeaderboard(uid, data.name, data.className,
      data.xp || 0, data.level || 1, data.textsCompleted || 0,
      data.totalCorrect || 0, data.totalAnswered || 0);
    return true;
  } catch (e) {
    console.warn('[Firebase] push failed:', e.message);
    return false;
  }
}

/** Legacy-compatible: gathers profile+progress and pushes */
export async function syncToFirestore(profile, progress) {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    return await pushUserData(user.uid, {
      name: profile.name,
      className: profile.className,
      xp: progress.xp || 0,
      level: progress.level || 1,
      textsCompleted: progress.textsCompleted || 0,
      totalCorrect: progress.totalCorrect || 0,
      totalAnswered: progress.totalAnswered || 0
    });
  } catch (e) {
    console.warn('[Firebase] sync failed:', e.message);
    return false;
  }
}

/** Fetch top N students from leaderboard */
export async function fetchLeaderboard(count = 10) {
  try {
    const q = query(collection(db, 'leaderboard'), orderBy('xp', 'desc'), limit(count));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.warn('[Firebase] leaderboard fetch failed:', e.message);
    return null;
  }
}

/* ===== Internal Helpers ===== */

async function _syncLeaderboard(uid, name, className, xp, level, textsCompleted, totalCorrect, totalAnswered) {
  try {
    await setDoc(doc(db, 'leaderboard', uid), {
      name, className, xp, level, textsCompleted,
      totalCorrect, totalAnswered,
      lastActive: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    console.warn('[Firebase] leaderboard sync failed:', e.message);
  }
}

function _defaultSkills() {
  const s = {};
  for (let i = 1; i <= 15; i++) s[i] = { attempts: [], mastery: 0, totalCorrect: 0, totalAnswered: 0 };
  return s;
}

function _mapAuthError(code) {
  const map = {
    'auth/email-already-in-use': 'البريد الإلكتروني مسجّل مسبقًا',
    'auth/invalid-email': 'البريد الإلكتروني غير صالح',
    'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل)',
    'auth/user-not-found': 'لا يوجد حساب بهذا البريد',
    'auth/wrong-password': 'كلمة المرور غير صحيحة',
    'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة',
    'auth/too-many-requests': 'محاولات كثيرة، حاول لاحقًا',
    'auth/network-request-failed': 'لا يوجد اتصال بالإنترنت',
    'auth/user-disabled': 'هذا الحساب معطّل'
  };
  return map[code] || 'حدث خطأ: ' + code;
}
