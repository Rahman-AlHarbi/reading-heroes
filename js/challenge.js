/* challenge.js – 1v1 Live Challenge Mode */
import { rtdb, ref, set, get, update, onValue, onDisconnect, remove, rtdbTimestamp,
         getCurrentUser } from './firebase.js';
import * as storage from './storage.js';
import * as engine from './engine.js';
import * as ui from './ui.js';
import { ICONS } from './icons.js';

/* ============================== */
/*         MODULE STATE           */
/* ============================== */
let TEXTS = [];
let currentRoom = null;   // { code, unsubs: [], role: 'creator'|'joiner' }
let challengeGame = null; // active game state
let _disconnectTimer = null;
let _countdownInterval = null;
let _resultRendered = false;

// Callbacks set by app.js
let _onStartGame = null;  // (room, code) => void
let _onSyncCloud = null;  // () => void

export function setTexts(texts) { TEXTS = texts; }
export function setCallbacks(onStartGame, onSyncCloud) {
  _onStartGame = onStartGame;
  _onSyncCloud = onSyncCloud;
}
export function getChallengeGame() { return challengeGame; }
export function getCurrentRoom() { return currentRoom; }

/* ============================== */
/*       ROOM CODE GENERATION     */
/* ============================== */
async function generateRoomCode() {
  let code;
  for (let attempt = 0; attempt < 20; attempt++) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    const snap = await get(ref(rtdb, 'roomCodes/' + code));
    if (!snap.exists()) return code;
  }
  return code; // unlikely collision after 20 attempts
}

/* ============================== */
/*       CREATE ROOM              */
/* ============================== */
export async function createRoom(textId) {
  const user = getCurrentUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };

  const profile = storage.getProfile();
  const text = TEXTS.find(t => t.id === textId);
  if (!text) return { success: false, error: 'النص غير موجود' };

  const code = await generateRoomCode();
  const qCount = text.questions.length;

  // Generate consistent shuffle for both players
  const questionOrder = engine.shuffleArray([...Array(qCount).keys()]);
  const choiceMaps = questionOrder.map(() => engine.shuffleArray([0, 1, 2, 3]));

  const roomData = {
    createdBy: user.uid,
    createdAt: rtdbTimestamp(),
    textId,
    textTitle: text.title,
    totalQuestions: qCount,
    questionOrder,
    choiceMaps,
    status: 'waiting',
    players: {
      [user.uid]: {
        name: profile?.name || user.displayName || 'لاعب',
        connected: true,
        currentQ: 0,
        correctCount: 0,
        answers: [],
        finishedAt: null
      }
    },
    winner: null,
    finishedAt: null
  };

  await set(ref(rtdb, 'rooms/' + code), roomData);
  await set(ref(rtdb, 'roomCodes/' + code), true);

  // Presence: mark disconnected if browser closes
  const connRef = ref(rtdb, 'rooms/' + code + '/players/' + user.uid + '/connected');
  onDisconnect(connRef).set(false);

  currentRoom = { code, unsubs: [], role: 'creator' };
  return { success: true, code };
}

/* ============================== */
/*       JOIN ROOM                */
/* ============================== */
export async function joinRoom(code) {
  const user = getCurrentUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };

  const snap = await get(ref(rtdb, 'rooms/' + code));
  if (!snap.exists()) return { success: false, error: 'كود الغرفة غير صحيح' };

  const room = snap.val();
  if (room.status !== 'waiting') return { success: false, error: 'اللعبة بدأت بالفعل' };

  const playerUIDs = Object.keys(room.players || {});
  if (playerUIDs.length >= 2) return { success: false, error: 'الغرفة ممتلئة' };
  if (playerUIDs.includes(user.uid)) return { success: false, error: 'لا يمكنك التحدي مع نفسك' };

  const profile = storage.getProfile();
  await update(ref(rtdb, 'rooms/' + code + '/players/' + user.uid), {
    name: profile?.name || user.displayName || 'لاعب',
    connected: true,
    currentQ: 0,
    correctCount: 0,
    answers: [],
    finishedAt: null
  });

  // Presence
  const connRef = ref(rtdb, 'rooms/' + code + '/players/' + user.uid + '/connected');
  onDisconnect(connRef).set(false);

  currentRoom = { code, unsubs: [], role: 'joiner' };
  return { success: true, room };
}

/* ============================== */
/*       LISTEN TO ROOM           */
/* ============================== */
function listenToRoom(code, callbacks) {
  const roomRef = ref(rtdb, 'rooms/' + code);
  const unsub = onValue(roomRef, (snap) => {
    if (!snap.exists()) { callbacks.onRoomDeleted?.(); return; }
    const room = snap.val();
    const user = getCurrentUser();
    if (!user) return;

    const players = Object.entries(room.players || {});
    const opponent = players.find(([uid]) => uid !== user.uid);

    // Both players joined
    if (players.length === 2 && room.status === 'waiting') {
      callbacks.onPlayerJoined(room);
    }

    if (room.status === 'countdown') {
      callbacks.onCountdown(room);
    }

    if (room.status === 'playing' && opponent) {
      const [, oppData] = opponent;
      callbacks.onOpponentProgress(oppData);
      if (!oppData.connected) callbacks.onOpponentDisconnect(oppData);
      if (oppData.finishedAt) callbacks.onOpponentFinish(oppData);
    }

    if (room.status === 'finished') {
      callbacks.onGameFinished(room);
    }
  });

  if (currentRoom) currentRoom.unsubs.push(unsub);
  return unsub;
}

/* ============================== */
/*       GAME ACTIONS             */
/* ============================== */
async function startCountdown(code) {
  await update(ref(rtdb, 'rooms/' + code), { status: 'countdown' });
}

async function startPlaying(code) {
  await update(ref(rtdb, 'rooms/' + code), { status: 'playing' });
}

export async function reportAnswer(code, qIndex, isCorrect) {
  const user = getCurrentUser();
  if (!user || !code) return;
  const playerRef = ref(rtdb, 'rooms/' + code + '/players/' + user.uid);
  const snap = await get(playerRef);
  if (!snap.exists()) return;
  const data = snap.val();
  const answers = data.answers || [];
  answers.push(isCorrect);
  await update(playerRef, {
    currentQ: qIndex + 1,
    correctCount: (data.correctCount || 0) + (isCorrect ? 1 : 0),
    answers
  });
}

export async function reportFinish(code) {
  const user = getCurrentUser();
  if (!user || !code) return;
  await update(ref(rtdb, 'rooms/' + code + '/players/' + user.uid), {
    finishedAt: Date.now()
  });
}

async function determineWinner(code) {
  const snap = await get(ref(rtdb, 'rooms/' + code));
  if (!snap.exists()) return null;
  const room = snap.val();
  const players = Object.entries(room.players || {});
  if (players.length < 2) return null;

  const [uid1, p1] = players[0];
  const [uid2, p2] = players[1];

  // Disconnection
  if (!p1.connected && p2.connected) return uid2;
  if (!p2.connected && p1.connected) return uid1;

  // Both finished
  if (p1.finishedAt && p2.finishedAt) {
    if (p1.correctCount > p2.correctCount) return uid1;
    if (p2.correctCount > p1.correctCount) return uid2;
    if (p1.finishedAt < p2.finishedAt) return uid1;
    if (p2.finishedAt < p1.finishedAt) return uid2;
    return 'draw';
  }
  return null;
}

async function setWinner(code, winnerId) {
  await update(ref(rtdb, 'rooms/' + code), {
    winner: winnerId,
    status: 'finished',
    finishedAt: Date.now()
  });
}

/* ============================== */
/*       LEAVE / CLEANUP          */
/* ============================== */
export function leaveRoom() {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
  if (_disconnectTimer) { clearTimeout(_disconnectTimer); _disconnectTimer = null; }
  _resultRendered = false;
  if (!currentRoom) return;

  currentRoom.unsubs.forEach(fn => fn());
  currentRoom.unsubs = [];

  const user = getCurrentUser();
  if (user && currentRoom.code) {
    const pRef = ref(rtdb, 'rooms/' + currentRoom.code + '/players/' + user.uid + '/connected');
    set(pRef, false);
  }

  currentRoom = null;
  challengeGame = null;
}

/* ============================== */
/*       UI: CHALLENGE LOBBY      */
/* ============================== */
export function renderChallengeLobby() {
  const container = document.querySelector('#page-challenge .challenge-lobby');
  if (!container) return;

  container.innerHTML = `
    <div class="challenge-hero">
      <div class="challenge-hero-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/>
          <path d="M9.5 6.5L21 18v3h-3L6.5 9.5"/><path d="M11 5L5 11"/><path d="M8 8L4 4"/>
        </svg>
      </div>
      <h2>تحدي 1 ضد 1</h2>
      <p>تنافس مع زميلك على نفس النص والأسئلة في الوقت الحقيقي!</p>
    </div>
    <div class="challenge-options">
      <button class="challenge-option-card challenge-create" id="btn-create-room">
        <div class="co-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <h3>إنشاء غرفة</h3>
        <p>اختر نصًا وشارك الكود مع صديقك</p>
      </button>
      <button class="challenge-option-card challenge-join" id="btn-join-room">
        <div class="co-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
        </div>
        <h3>دخول غرفة</h3>
        <p>أدخل كود الغرفة للانضمام</p>
      </button>
    </div>
    <button class="btn btn-ghost" style="margin-top:20px;width:100%" onclick="window.location.hash='#dashboard'">← العودة</button>
  `;

  document.getElementById('btn-create-room').addEventListener('click', () => {
    window.location.hash = '#challenge/create';
  });
  document.getElementById('btn-join-room').addEventListener('click', () => {
    window.location.hash = '#challenge/join';
  });
}

/* ============================== */
/*       UI: CREATE ROOM          */
/* ============================== */
export function renderCreateRoom() {
  const container = document.querySelector('#page-challenge-room .challenge-room-container');
  if (!container) return;

  const completed = storage.getCompletedTexts();
  const genreIcons = { 'خيالي': ICONS.rocket, 'واقعي': ICONS.globe, 'معلوماتي': ICONS.book, 'حواري': ICONS.chat, 'شعري': ICONS.palette, 'مقالي': ICONS.pen, 'وصفي': ICONS.pen, 'إرشادي': ICONS.bulb };

  container.innerHTML = `
    <div class="cr-header">
      <button class="btn btn-ghost" id="btn-back-challenge">✕</button>
      <h3>اختر النص للتحدي</h3>
      <div></div>
    </div>
    <div class="texts-grid" id="cr-texts-grid">
      ${TEXTS.map(t => {
        const c = completed.find(x => x.id === t.id);
        const qCount = t.questions?.length || 0;
        return `
          <div class="text-card ${c ? 'completed' : ''}" data-id="${t.id}">
            <div class="tc-genre-icon">${genreIcons[t.genre] || ICONS.book}</div>
            <div class="tc-info">
              <h4>${t.title}</h4>
              <div class="tc-meta">
                <span class="diff-badge ${ui.getDiffClass(t.difficulty)}">${t.difficulty}</span>
                <span class="genre-tag">${t.genre}</span>
                <span class="tc-qcount">${qCount} سؤال</span>
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>
  `;

  document.getElementById('btn-back-challenge').addEventListener('click', () => {
    window.location.hash = '#challenge';
  });

  container.querySelectorAll('.text-card').forEach(card => {
    card.addEventListener('click', async () => {
      const textId = card.dataset.id;
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
      const result = await createRoom(textId);
      if (result.success) {
        window.location.hash = '#challenge/room/' + result.code;
      } else {
        ui.showToast(result.error, 'error');
        card.style.opacity = '';
        card.style.pointerEvents = '';
      }
    });
  });
}

/* ============================== */
/*       UI: JOIN ROOM            */
/* ============================== */
export function renderJoinRoom() {
  const container = document.querySelector('#page-challenge-room .challenge-room-container');
  if (!container) return;

  container.innerHTML = `
    <div class="cr-header">
      <button class="btn btn-ghost" id="btn-back-challenge">✕</button>
      <h3>دخول غرفة</h3>
      <div></div>
    </div>
    <div class="cr-join-form">
      <div class="form-group">
        <label>كود الغرفة</label>
        <input type="text" id="inp-room-code" class="input-field" placeholder="أدخل الكود"
               maxlength="4" inputmode="numeric" dir="ltr"
               style="text-align:center;font-size:2rem;letter-spacing:14px;font-weight:900">
      </div>
      <div id="join-error" class="auth-error" style="display:none"></div>
      <button class="btn btn-primary btn-lg btn-block" id="btn-submit-join">انضمام</button>
    </div>
  `;

  document.getElementById('btn-back-challenge').addEventListener('click', () => {
    window.location.hash = '#challenge';
  });

  document.getElementById('btn-submit-join').addEventListener('click', async () => {
    const code = document.getElementById('inp-room-code').value.trim();
    const errEl = document.getElementById('join-error');
    if (!code || code.length !== 4) {
      errEl.textContent = 'أدخل كود مكون من 4 أرقام';
      errEl.style.display = 'block';
      return;
    }
    const btn = document.getElementById('btn-submit-join');
    btn.disabled = true; btn.textContent = 'جارٍ الانضمام...';
    const result = await joinRoom(code);
    btn.disabled = false; btn.textContent = 'انضمام';
    if (result.success) {
      window.location.hash = '#challenge/room/' + code;
    } else {
      errEl.textContent = result.error;
      errEl.style.display = 'block';
    }
  });

  // Allow Enter key
  document.getElementById('inp-room-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-submit-join').click();
  });
}

/* ============================== */
/*       UI: WAITING ROOM         */
/* ============================== */
export function renderWaitingRoom(code) {
  if (!code) { window.location.hash = '#challenge'; return; }
  // Ensure we have a room or are about to listen
  if (!currentRoom) {
    // Could be a refresh — try to reconnect
    currentRoom = { code, unsubs: [], role: 'unknown' };
    const user = getCurrentUser();
    if (user) {
      const connRef = ref(rtdb, 'rooms/' + code + '/players/' + user.uid + '/connected');
      set(connRef, true);
      onDisconnect(connRef).set(false);
    }
  }

  const container = document.querySelector('#page-challenge-room .challenge-room-container');
  if (!container) return;

  container.innerHTML = `
    <div class="cr-header">
      <button class="btn btn-ghost" id="btn-leave-room">✕</button>
      <h3 id="cr-title">غرفة التحدي</h3>
      <div></div>
    </div>
    <div class="cr-code-display" id="cr-code-section">
      <p>شارك هذا الكود مع منافسك:</p>
      <div class="cr-code" id="cr-code-value">${code}</div>
      <button class="btn btn-sm btn-outline" id="btn-copy-code">نسخ الكود</button>
    </div>
    <div class="cr-players" id="cr-players-section">
      <div class="cr-player cr-player-1">
        <div class="cr-avatar" id="cr-p1-avatar">?</div>
        <span class="cr-name" id="cr-p1-name">في الانتظار...</span>
      </div>
      <div class="cr-vs">VS</div>
      <div class="cr-player cr-player-2">
        <div class="cr-avatar" id="cr-p2-avatar">?</div>
        <span class="cr-name" id="cr-p2-name">في الانتظار...</span>
      </div>
    </div>
    <div class="cr-status" id="cr-status">
      <div class="cr-spinner"></div>
      <p id="cr-status-text">في انتظار المنافس...</p>
    </div>
    <div class="cr-countdown" id="cr-countdown" style="display:none">
      <span class="cr-countdown-num" id="cr-countdown-num">3</span>
    </div>
  `;

  document.getElementById('btn-leave-room').addEventListener('click', () => {
    _handleLeaveRoom(code);
  });

  document.getElementById('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard?.writeText(code);
    ui.showToast('تم نسخ الكود!', 'success');
  });

  // Start listening
  let countdownStarted = false;
  let gameStarted = false;

  listenToRoom(code, {
    onPlayerJoined(room) {
      _updatePlayersUI(room);
      const user = getCurrentUser();
      // Creator starts countdown automatically
      if (room.createdBy === user?.uid && !countdownStarted) {
        countdownStarted = true;
        document.getElementById('cr-status-text').textContent = 'المنافس انضم! جارٍ البدء...';
        document.querySelector('.cr-spinner')?.remove();
        setTimeout(() => startCountdown(code), 1200);
      }
    },

    onCountdown() {
      if (gameStarted) return;
      _runCountdown(code, () => {
        // لا نسوي gameStarted = true هنا
        // الـ statusRef listener بيبدأ اللعبة للكل (Creator + Joiner)
        startPlaying(code);
      });
    },

    onOpponentProgress() {},
    onOpponentDisconnect() {},
    onOpponentFinish() {},

    onGameFinished(room) {
      if (!gameStarted) {
        gameStarted = true;
        _startChallengeGame(room, code);
      }
    },

    onRoomDeleted() {
      ui.showToast('الغرفة حُذفت', 'error');
      window.location.hash = '#challenge';
    }
  });

  // Also listen for status changes to start game
  const statusRef = ref(rtdb, 'rooms/' + code + '/status');
  const statusUnsub = onValue(statusRef, (snap) => {
    if (snap.val() === 'playing' && !gameStarted) {
      gameStarted = true;
      // Read full room data
      get(ref(rtdb, 'rooms/' + code)).then(roomSnap => {
        if (roomSnap.exists()) _startChallengeGame(roomSnap.val(), code);
      });
    }
  });
  if (currentRoom) currentRoom.unsubs.push(statusUnsub);
}

function _updatePlayersUI(room) {
  const user = getCurrentUser();
  const players = Object.entries(room.players || {});

  players.forEach(([uid, data], i) => {
    const num = i + 1;
    const avatarEl = document.getElementById('cr-p' + num + '-avatar');
    const nameEl = document.getElementById('cr-p' + num + '-name');
    if (avatarEl) {
      avatarEl.textContent = data.name.charAt(0);
      avatarEl.classList.add('active');
    }
    if (nameEl) nameEl.textContent = data.name + (uid === user?.uid ? ' (أنت)' : '');
  });
}

function _runCountdown(code, onComplete) {
  const overlay = document.getElementById('cr-countdown');
  const numEl = document.getElementById('cr-countdown-num');
  if (!overlay || !numEl) return;

  overlay.style.display = 'flex';
  let count = 3;
  numEl.textContent = count;
  numEl.style.animation = 'none';
  void numEl.offsetWidth;
  numEl.style.animation = '';

  _countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      numEl.textContent = count;
      numEl.style.animation = 'none';
      void numEl.offsetWidth;
      numEl.style.animation = '';
    } else if (count === 0) {
      numEl.textContent = 'انطلق!';
      numEl.style.fontSize = '4rem';
    } else {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
      overlay.style.display = 'none';
      numEl.style.fontSize = '';
      if (currentRoom?.role === 'creator') onComplete();
    }
  }, 1000);
}

async function _handleLeaveRoom(code) {
  const user = getCurrentUser();
  if (!user) { window.location.hash = '#challenge'; return; }

  const snap = await get(ref(rtdb, 'rooms/' + code));
  if (snap.exists()) {
    const room = snap.val();
    if (room.createdBy === user.uid && room.status === 'waiting') {
      // Creator leaves waiting room → delete room
      await remove(ref(rtdb, 'rooms/' + code));
      await remove(ref(rtdb, 'roomCodes/' + code));
    } else {
      await set(ref(rtdb, 'rooms/' + code + '/players/' + user.uid + '/connected'), false);
    }
  }
  leaveRoom();
  window.location.hash = '#challenge';
}

/* ============================== */
/*       START CHALLENGE GAME     */
/* ============================== */
function _startChallengeGame(room, code) {
  const text = TEXTS.find(t => t.id === room.textId);
  if (!text) { ui.showToast('النص غير موجود', 'error'); return; }

  // Build questions with predetermined shuffle
  const questionOrder = room.questionOrder || [...Array(text.questions.length).keys()];
  const choiceMaps = room.choiceMaps || [];
  const questions = questionOrder.map((qi, i) => {
    const q = text.questions[qi];
    if (choiceMaps[i]) {
      return engine.applyShuffleToQuestion(q, choiceMaps[i]);
    }
    return engine.shuffleQuestion(q);
  });

  challengeGame = {
    code,
    room,
    text,
    questions,
    currentQ: 0,
    score: 0,
    answers: [],
    startTime: Date.now()
  };

  // Use app.js callback to start the game on the play page
  if (_onStartGame) _onStartGame(challengeGame);

  // Listen for opponent progress during gameplay
  _listenOpponentDuringGame(code, questions.length);
}

function _listenOpponentDuringGame(code, totalQ) {
  const user = getCurrentUser();
  const roomRef = ref(rtdb, 'rooms/' + code);

  const unsub = onValue(roomRef, (snap) => {
    if (!snap.exists() || !challengeGame) return;
    const room = snap.val();
    const players = Object.entries(room.players || {});
    const opponent = players.find(([uid]) => uid !== user?.uid);

    if (opponent) {
      const [, oppData] = opponent;
      // Update opponent progress bar
      _updateOpponentBar(oppData, totalQ);

      // Check disconnect
      if (!oppData.connected) {
        _handleOpponentDisconnect(code, oppData);
      } else if (_disconnectTimer) {
        clearTimeout(_disconnectTimer);
        _disconnectTimer = null;
        const statusEl = document.getElementById('ob-disconnect-msg');
        if (statusEl) statusEl.remove();
      }
    }

    // Check if game is finished
    if (room.status === 'finished' && room.winner) {
      renderChallengeResult(room, code);
    }
  });

  if (currentRoom) currentRoom.unsubs.push(unsub);
}

function _updateOpponentBar(oppData, totalQ) {
  const bar = document.getElementById('opponent-bar');
  if (!bar) return;
  bar.style.display = 'flex';

  const nameEl = document.getElementById('ob-name');
  const avatarEl = document.getElementById('ob-avatar');
  const fillEl = document.getElementById('ob-fill');
  const textEl = document.getElementById('ob-text');

  if (nameEl) nameEl.textContent = oppData.name;
  if (avatarEl) avatarEl.textContent = oppData.name.charAt(0);
  if (fillEl) fillEl.style.width = ((oppData.currentQ || 0) / totalQ * 100) + '%';
  if (textEl) textEl.textContent = (oppData.currentQ || 0) + '/' + totalQ;
}

function _handleOpponentDisconnect(code, oppData) {
  if (_disconnectTimer) return; // already handling

  // Show message
  const bar = document.getElementById('opponent-bar');
  if (bar && !document.getElementById('ob-disconnect-msg')) {
    const msg = document.createElement('span');
    msg.id = 'ob-disconnect-msg';
    msg.className = 'ob-disconnect';
    msg.textContent = 'المنافس انقطع...';
    bar.appendChild(msg);
  }

  // 15 second grace period
  _disconnectTimer = setTimeout(async () => {
    _disconnectTimer = null;
    const user = getCurrentUser();
    if (user && challengeGame) {
      await setWinner(code, user.uid);
    }
  }, 15000);
}

/* ============================== */
/*     HANDLE ANSWER (from app)   */
/* ============================== */
export function handleChallengeAnswer(idx) {
  if (!challengeGame) return;
  const g = challengeGame;
  const q = g.questions[g.currentQ];
  const isCorrect = idx === q.correct_index;

  g.answers.push({ skillId: q.skill_id, selected: idx, correct: q.correct_index, isCorrect });
  if (isCorrect) g.score++;

  // Note: engine.processAnswer is already called in app.js handleAnswer()

  // Report to RTDB
  reportAnswer(g.code, g.currentQ, isCorrect);

  return { isCorrect, correctIndex: q.correct_index };
}

export function advanceChallengeQuestion() {
  if (!challengeGame) return false;
  challengeGame.currentQ++;
  if (challengeGame.currentQ >= challengeGame.questions.length) {
    return true; // finished
  }
  return false; // more questions
}

export async function finishChallenge() {
  if (!challengeGame) return;
  const code = challengeGame.code;

  await reportFinish(code);

  // Check if opponent also finished
  const snap = await get(ref(rtdb, 'rooms/' + code));
  if (!snap.exists()) return;
  const room = snap.val();
  const players = Object.entries(room.players || {});
  const allFinished = players.every(([, p]) => p.finishedAt);

  if (allFinished) {
    const winner = await determineWinner(code);
    if (winner) await setWinner(code, winner);
  }
  // If not all finished, the listener will catch it when opponent finishes
}

/* ============================== */
/*       CHALLENGE RESULT         */
/* ============================== */
export function renderChallengeResult(room, code) {
  if (_resultRendered) return;
  _resultRendered = true;

  // Stop listening
  if (currentRoom) {
    currentRoom.unsubs.forEach(fn => fn());
    currentRoom.unsubs = [];
  }
  if (_disconnectTimer) { clearTimeout(_disconnectTimer); _disconnectTimer = null; }

  // Hide opponent bar
  const opBar = document.getElementById('opponent-bar');
  if (opBar) opBar.style.display = 'none';

  const user = getCurrentUser();
  const players = Object.entries(room.players || {});
  const me = players.find(([uid]) => uid === user?.uid);
  const opp = players.find(([uid]) => uid !== user?.uid);
  const winner = room.winner;

  const isWinner = winner === user?.uid;
  const isDraw = winner === 'draw';
  const isLoser = !isWinner && !isDraw;

  // XP bonus
  let bonusXP = 0;
  if (isWinner) bonusXP = 100;
  else if (isDraw) bonusXP = 50;
  else bonusXP = 25;

  // Award bonus XP
  const progress = storage.getProgress();
  progress.xp = (progress.xp || 0) + bonusXP;
  storage.setProgress(progress);
  if (_onSyncCloud) _onSyncCloud();

  // Confetti for winner
  if (isWinner) {
    ui.showConfetti();
    ui.playSuccessSound();
  }

  const myData = me ? me[1] : {};
  const oppData = opp ? opp[1] : {};
  const totalQ = room.totalQuestions || 1;

  const myPct = Math.round(((myData.correctCount || 0) / totalQ) * 100);
  const oppPct = Math.round(((oppData.correctCount || 0) / totalQ) * 100);

  // Calculate time
  const myTime = myData.finishedAt ? ((myData.finishedAt - (room.createdAt || myData.finishedAt)) / 1000).toFixed(0) : '--';
  const oppTime = oppData.finishedAt ? ((oppData.finishedAt - (room.createdAt || oppData.finishedAt)) / 1000).toFixed(0) : '--';

  const resultIcon = isWinner ? ICONS.trophy : isDraw ? ICONS.users : ICONS.fire;
  const resultTitle = isWinner ? 'فزت! أحسنت!' : isDraw ? 'تعادل!' : 'خسرت هذه المرة';
  const resultSubtitle = isWinner ? 'أنت بطل التحدي — واصل تفوقك!' : isDraw ? 'تنافس قوي! جرّب مرة ثانية' : 'المحاولة القادمة من نصيبك!';
  const resultClass = isWinner ? 'winner' : isDraw ? 'draw' : 'loser';

  // Determine winner/loser marker per player
  const myIsWinner = isWinner;
  const oppIsWinner = !isWinner && !isDraw;

  // Format time
  function _fmtTime(sec) {
    if (sec === '--' || !sec || sec < 0) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}د ${s}ث` : `${s}ث`;
  }

  // Reason for result
  let reasonText = '';
  if (isDraw) {
    reasonText = 'نفس عدد الإجابات الصحيحة ونفس الوقت';
  } else if (myPct !== oppPct) {
    reasonText = isWinner ? 'إجابات صحيحة أكثر' : 'المنافس أجاب صح أكثر';
  } else {
    reasonText = isWinner ? 'أنهيت أسرع من المنافس' : 'المنافس أنهى أسرع منك';
  }

  const container = document.getElementById('challenge-result-container');
  if (!container) {
    window.location.hash = '#challenge-result';
    setTimeout(() => renderChallengeResult(room, code), 100);
    return;
  }

  // Show result page
  const resultPage = document.getElementById('page-challenge-result');
  document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
  if (resultPage) resultPage.classList.add('active');

  // Hide header/nav
  const header = document.getElementById('main-header');
  const nav = document.getElementById('bottom-nav');
  const footer = document.getElementById('main-footer');
  if (header) header.style.display = 'none';
  if (nav) nav.style.display = 'none';
  if (footer) footer.style.display = 'none';

  container.innerHTML = `
    <div class="challenge-result-card ${resultClass}">
      <!-- Hero Header -->
      <div class="cr-result-hero ${resultClass}">
        <div class="cr-result-hero-bg" aria-hidden="true">
          <div class="hero-orb orb-1"></div>
          <div class="hero-orb orb-2"></div>
        </div>
        <div class="cr-result-icon">${resultIcon}</div>
        <h2 class="cr-result-title">${resultTitle}</h2>
        <p class="cr-result-subtitle">${resultSubtitle}</p>
        <div class="cr-result-xp">
          ${ICONS.star}
          <span>+${bonusXP} XP</span>
        </div>
      </div>

      <!-- Players Comparison -->
      <div class="cr-comparison">
        <div class="cr-comp-player ${myIsWinner ? 'is-winner' : ''}">
          ${myIsWinner ? '<div class="cr-crown">' + ICONS.trophy + '</div>' : ''}
          <div class="cr-comp-avatar p1">${(myData.name || '').charAt(0)}</div>
          <div class="cr-comp-name">${myData.name || 'أنت'} <span class="cr-you-tag">أنت</span></div>
          <div class="cr-comp-score-ring ${myPct >= oppPct ? 'higher' : ''}">
            <svg viewBox="0 0 80 80">
              <circle class="ring-bg" cx="40" cy="40" r="34"/>
              <circle class="ring-fill" cx="40" cy="40" r="34" style="stroke-dasharray: ${(myPct / 100) * 213.6} 213.6"/>
            </svg>
            <span class="ring-val">${myPct}%</span>
          </div>
          <div class="cr-comp-details">
            <span>${ICONS.checkCircle} ${myData.correctCount || 0}/${totalQ}</span>
            <span>${ICONS.bolt} ${_fmtTime(myTime)}</span>
          </div>
        </div>

        <div class="cr-comp-divider">
          <span class="cr-comp-vs-badge">VS</span>
        </div>

        <div class="cr-comp-player ${oppIsWinner ? 'is-winner' : ''}">
          ${oppIsWinner ? '<div class="cr-crown">' + ICONS.trophy + '</div>' : ''}
          <div class="cr-comp-avatar p2">${(oppData.name || '').charAt(0)}</div>
          <div class="cr-comp-name">${oppData.name || 'المنافس'}</div>
          <div class="cr-comp-score-ring ${oppPct >= myPct ? 'higher' : ''}">
            <svg viewBox="0 0 80 80">
              <circle class="ring-bg" cx="40" cy="40" r="34"/>
              <circle class="ring-fill" cx="40" cy="40" r="34" style="stroke-dasharray: ${(oppPct / 100) * 213.6} 213.6"/>
            </svg>
            <span class="ring-val">${oppPct}%</span>
          </div>
          <div class="cr-comp-details">
            <span>${ICONS.checkCircle} ${oppData.correctCount || 0}/${totalQ}</span>
            <span>${ICONS.bolt} ${_fmtTime(oppTime)}</span>
          </div>
        </div>
      </div>

      <!-- Reason -->
      <div class="cr-result-reason">
        ${ICONS.info}
        <span>${reasonText}</span>
      </div>

      <!-- Details -->
      <div class="cr-result-details">
        <div class="cr-detail">
          <span>${ICONS.book} النص</span>
          <strong>${room.textTitle || ''}</strong>
        </div>
        <div class="cr-detail">
          <span>${ICONS.target} الأسئلة</span>
          <strong>${totalQ} سؤال</strong>
        </div>
      </div>

      <!-- Actions -->
      <div class="cr-result-actions">
        <button class="btn btn-primary btn-lg btn-block" id="btn-challenge-again">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M9.5 6.5L21 18v3h-3L6.5 9.5"/></svg>
          تحدي جديد
        </button>
        <button class="btn btn-lg btn-block cr-btn-back" id="btn-back-dashboard">
          العودة للرئيسية
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-challenge-again')?.addEventListener('click', () => {
    leaveRoom();
    window.location.hash = '#challenge';
  });
  document.getElementById('btn-back-dashboard')?.addEventListener('click', () => {
    leaveRoom();
    window.location.hash = '#dashboard';
  });

  // Cleanup
  challengeGame = null;
}
