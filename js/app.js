/* app.js – Main Application */
import { initRouter } from './router.js';
import * as storage from './storage.js';
import * as engine from './engine.js';
import * as cert from './cert.js';
import * as ui from './ui.js';
import { ICONS } from './icons.js';
import { fetchLeaderboard, registerUser, loginUser,
         resetPassword, logoutUser, onAuthChange, pullUserData, pushUserData } from './firebase.js';
import * as challenge from './challenge.js';

let CONFIG = {};
let SKILLS = [];
let TEXTS = [];
let currentGame = null;
let dataLoaded = false;
let currentUID = null;

/* ============================== */
/*       GAME CLEANUP             */
/* ============================== */
function cleanupGame() {
  if (!currentGame) return;
  if (currentGame.timer) { clearInterval(currentGame.timer); currentGame.timer = null; }
  if (currentGame.questionTimer) { clearInterval(currentGame.questionTimer); currentGame.questionTimer = null; }
  if (currentGame._pendingTimeout) { clearTimeout(currentGame._pendingTimeout); currentGame._pendingTimeout = null; }
  currentGame = null;

  // Reset memory overlay UI
  const overlay = document.getElementById('memory-reading-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('memory-urgent');
  }
  const playTimer = document.getElementById('play-timer');
  if (playTimer) {
    playTimer.classList.remove('timer-danger');
    playTimer.style.display = 'none';
  }
}

/* ============================== */
/*       AUTH & CLOUD SYNC        */
/* ============================== */
async function syncLocalToCloud() {
  if (!currentUID) return;
  const profile = storage.getProfile();
  if (!profile) return;
  const data = {
    name: profile.name,
    className: profile.className,
    ...storage.getProgress(),
    skills: storage.getSkillData(),
    completedTexts: storage.getCompletedTexts(),
    badges: storage.getBadges(),
    daily: storage.getDailyData(),
    settings: storage.getSettings(),
    certData: storage.getCertData()
  };
  await pushUserData(currentUID, data);
}

async function pullCloudToLocal(uid) {
  const data = await pullUserData(uid);
  if (!data) return false;

  storage.setProfile({ name: data.name, className: data.className });
  storage.setProgress({
    xp: data.xp || 0,
    level: data.level || 1,
    textsCompleted: data.textsCompleted || 0,
    totalCorrect: data.totalCorrect || 0,
    totalAnswered: data.totalAnswered || 0
  });
  if (data.skills) storage.setSkillData(data.skills);
  if (data.completedTexts) storage.setCompletedTexts(data.completedTexts);
  if (data.badges) storage.setBadges(data.badges);
  if (data.daily) storage.setDailyData(data.daily);
  if (data.settings) storage.setSettings(data.settings);
  if (data.certData) storage.setCertData(data.certData);
  return true;
}

function setupAuthViews() {
  const showView = (viewId) => {
    ['auth-login', 'auth-register', 'auth-reset'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = (id === viewId) ? '' : 'none';
    });
    ['login-error', 'reg-error', 'reset-error', 'reset-success'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  };

  // View switching
  document.getElementById('link-to-register')?.addEventListener('click', (e) => { e.preventDefault(); showView('auth-register'); });
  document.getElementById('link-to-login')?.addEventListener('click', (e) => { e.preventDefault(); showView('auth-login'); });
  document.getElementById('link-to-reset')?.addEventListener('click', (e) => { e.preventDefault(); showView('auth-reset'); });
  document.getElementById('link-back-to-login')?.addEventListener('click', (e) => { e.preventDefault(); showView('auth-login'); });

  // LOGIN
  document.getElementById('btn-login')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!email || !pass) { errEl.textContent = 'أدخل البريد وكلمة المرور'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'جارٍ الدخول...';
    const result = await loginUser(email, pass);
    if (!result.success) {
      errEl.textContent = result.error; errEl.style.display = 'block';
    }
    // دائماً نرجع الزر لوضعه (سواء نجح أو فشل)
    btn.disabled = false; btn.textContent = 'تسجيل الدخول';
  });

  // REGISTER
  document.getElementById('btn-register')?.addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    const cls = document.getElementById('reg-class').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    if (!name) { errEl.textContent = 'أدخل اسمك'; errEl.style.display = 'block'; return; }
    if (!email) { errEl.textContent = 'أدخل البريد الإلكتروني'; errEl.style.display = 'block'; return; }
    if (!pass || pass.length < 6) { errEl.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('btn-register');
    btn.disabled = true; btn.textContent = 'جارٍ إنشاء الحساب...';
    // حفظ البيانات قبل التسجيل حتى يكون الاسم جاهز لما onAuthChange يشتغل
    storage.setProfile({ name, className: cls || 'غير محدد' });
    storage.setProgress({ xp: 0, level: 1, textsCompleted: 0, totalCorrect: 0, totalAnswered: 0 });
    const result = await registerUser(email, pass, name, cls || 'غير محدد');
    if (!result.success) {
      storage.clearStudentData();
      errEl.textContent = result.error; errEl.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = 'إنشاء الحساب';
  });

  // RESET PASSWORD
  document.getElementById('btn-reset-password')?.addEventListener('click', async () => {
    const email = document.getElementById('reset-email').value.trim();
    const errEl = document.getElementById('reset-error');
    const successEl = document.getElementById('reset-success');
    if (!email) { errEl.textContent = 'أدخل البريد الإلكتروني'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('btn-reset-password');
    btn.disabled = true; btn.textContent = 'جارٍ الإرسال...';
    const result = await resetPassword(email);
    btn.disabled = false; btn.textContent = 'إرسال رابط الاستعادة';
    if (result.success) {
      errEl.style.display = 'none';
      successEl.textContent = 'تم إرسال رابط الاستعادة إلى بريدك الإلكتروني';
      successEl.style.display = 'block';
    } else {
      successEl.style.display = 'none';
      errEl.textContent = result.error; errEl.style.display = 'block';
    }
  });
}

/* ============================== */
/*         DATA LOADING           */
/* ============================== */
async function loadData() {
  try {
    const [cfgRes, skillsRes, textsRes] = await Promise.all([
      fetch('data/config.json'),
      fetch('data/skills.json'),
      fetch('data/texts.json')
    ]);
    if (!cfgRes.ok || !textsRes.ok) throw new Error('فشل تحميل البيانات');
    CONFIG = await cfgRes.json();
    const skillsData = await skillsRes.json();
    SKILLS = skillsData.skills || [];
    ui.setSkillNames(SKILLS);
    const textsData = await textsRes.json();
    TEXTS = Array.isArray(textsData) ? textsData : (textsData.texts || []);
    // تحويل أسماء الحقول من الصيغة الجديدة للقديمة
    TEXTS = TEXTS.map(t => ({
      ...t,
      body: t.body || t.text,
      genre: t.genre || t.type,
      questions: (t.questions || []).map(q => ({
        ...q,
        skill_id: q.skill_id ?? q.skill,
        stem: q.stem || q.q || q.question,
        choices: q.choices || q.options,
        correct_index: q.correct_index ?? q.answer_index
      }))
    }));
    if (TEXTS.length === 0) throw new Error('لا توجد نصوص');
    dataLoaded = true;
  } catch (e) {
    dataLoaded = false;
    document.getElementById('main-content').innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;color:#EF4444">${ICONS.warning}</div>
        <h2 style="color:#EF4444;margin-bottom:12px">خطأ في تحميل البيانات</h2>
        <p style="color:#6B7280;max-width:400px;margin:0 auto">${e.message || 'تأكد من وجود ملفات البيانات في المجلد الصحيح (data/).'}</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:10px 24px;background:#6366F1;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:1rem">إعادة المحاولة</button>
      </div>`;
  }
}

/* ============================== */
/*         BRANDING               */
/* ============================== */
function applyBranding() {
  const el = (id) => document.getElementById(id);
  const slogan = CONFIG.slogans?.primary || 'من نصٍّ إلى إنجاز';
  if (el('hero-slogan')) el('hero-slogan').textContent = slogan;
  if (el('footer-rights')) el('footer-rights').textContent = CONFIG.rights_text || '';

  // Show school name in header and hero
  const schoolName = CONFIG.school_name || '';
  if (el('header-school-name')) el('header-school-name').textContent = schoolName;
  if (el('hero-school-label')) el('hero-school-label').textContent = schoolName;

  if (CONFIG.theme_colors) {
    const r = document.documentElement;
    Object.entries(CONFIG.theme_colors).forEach(([k, v]) => r.style.setProperty('--' + k.replace(/_/g, '-'), v));
  }
}

function updateHeaderXP() {
  const p = storage.getProgress();
  const xpEl = document.getElementById('header-xp-val');
  const lvlEl = document.getElementById('header-level');
  if (xpEl) xpEl.textContent = p.xp;
  if (lvlEl) lvlEl.textContent = 'مستوى ' + p.level;
}

/* ============================== */
/*         PAGES                  */
/* ============================== */
function showPage(pageId) {
  const next = document.getElementById('page-' + pageId);
  if (!next) return;

  // أخفِ جميع الصفحات النشطة ثم أظهر الجديدة
  document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
  next.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.getAttribute('data-page') === pageId);
  });

  // إخفاء/إظهار الهيدر والنافيجيشن والفوتر
  const nav = document.getElementById('bottom-nav');
  const header = document.getElementById('main-header');
  const footer = document.getElementById('main-footer');
  const pagesWithoutChrome = ['home', 'onboarding', 'play', 'challenge-room', 'challenge-result'];

  if (header) header.style.display = pagesWithoutChrome.includes(pageId) ? 'none' : '';
  if (nav)    nav.style.display    = pagesWithoutChrome.includes(pageId) ? 'none' : '';
  if (footer) footer.style.display = pagesWithoutChrome.includes(pageId) ? 'none' : '';

  window.scrollTo(0, 0);
}

/* ============================== */
/*         HOME PAGE              */
/* ============================== */
function renderHome() {
  const profile = storage.getProfile();
  const progress = storage.getProgress();
  const skills = storage.getSkillData();
  const totalQ = TEXTS.reduce((sum, t) => sum + (t.questions?.length || 0), 0);
  const avgPct = progress.totalAnswered > 0 ? Math.round((progress.totalCorrect / progress.totalAnswered) * 100) : 0;

  // Count mastered skills (>= 80%)
  let masteredCount = 0;
  for (let i = 1; i <= 15; i++) {
    if ((skills[i]?.mastery || 0) >= 80) masteredCount++;
  }

  // Overall progress percentage
  const overallPct = Math.round((progress.textsCompleted / TEXTS.length) * 100);

  // Level info
  const xpPerLevel = CONFIG.xp_per_level || 200;
  const totalXP = progress.xp || 0;
  const level = Math.floor(totalXP / xpPerLevel) + 1;
  const levelNames = ['مبتدئ', 'فضي', 'ذهبي', 'ماسي', 'أسطوري'];
  const levelName = levelNames[Math.min(level - 1, levelNames.length - 1)];

  // Top 3 skills
  const sortedSkills = [];
  for (let i = 1; i <= 15; i++) {
    const sk = SKILLS.find(s => s.id === i);
    if (sk) sortedSkills.push({ name: sk.name, m: skills[i]?.mastery || 0 });
  }
  sortedSkills.sort((a, b) => b.m - a.m);
  const topSkills = sortedSkills.slice(0, 4);

  // Update mockup card with real data
  const mockup = document.querySelector('.mockup-card');
  if (mockup) {
    const initial = profile.name ? profile.name.charAt(0) : '?';
    mockup.innerHTML = `
      <div class="mockup-header">
        <div class="mockup-avatar" style="font-size:1.2rem;font-weight:900;color:#0a0e27">${initial}</div>
        <div class="mockup-info">
          <h4>${profile.name || 'طالب'}</h4>
          <span>● المستوى ${levelName}</span>
        </div>
      </div>
      <div class="mockup-stats">
        <div class="mock-stat"><div class="mock-stat-value">${masteredCount}</div><div class="mock-stat-label">مهارة مكتملة</div></div>
        <div class="mock-stat"><div class="mock-stat-value">${avgPct}%</div><div class="mock-stat-label">معدل الإجابات</div></div>
      </div>
      <div class="mockup-progress">
        <div class="mockup-progress-header"><span>التقدم العام</span><span>${overallPct}%</span></div>
        <div class="mockup-progress-bar"><div class="mockup-progress-fill" style="animation:none;width:${overallPct}%"></div></div>
      </div>
      <div class="mockup-skills">
        ${topSkills.map(s => `<span class="mockup-chip${s.m >= 80 ? ' active' : ''}">${s.name}</span>`).join('')}
      </div>`;
  }

  // Update float badges with real data
  const daily = storage.getDailyData();
  const floatBadge1 = document.querySelector('.hero-float-badge.float-1');
  if (floatBadge1) {
    const streak = daily.streak || 0;
    floatBadge1.querySelector('span:last-child').textContent = streak > 0 ? `سلسلة ${streak} أيام!` : 'ابدأ سلسلتك!';
  }
  const floatBadge2 = document.querySelector('.hero-float-badge.float-2');
  if (floatBadge2) {
    floatBadge2.querySelector('span:last-child').textContent = `${totalXP} XP`;
  }

  // Stats section
  const stats = document.getElementById('hero-stats');
  if (stats) {
    stats.innerHTML = `
      <div class="hero-stats-row">
        <div class="hero-stat"><span class="stat-val">${progress.textsCompleted}/${TEXTS.length}</span><span class="stat-label">نص مكتمل</span></div>
        <div class="hero-stat"><span class="stat-val">${totalQ}</span><span class="stat-label">سؤال</span></div>
        <div class="hero-stat"><span class="stat-val">${masteredCount}/15</span><span class="stat-label">مهارة متقنة</span></div>
      </div>`;
  }

  // Update hero title to welcome
  const heroTitle = document.querySelector('#page-home .hero-title');
  if (heroTitle) heroTitle.textContent = `أهلاً ${profile.name || ''}`;

  // Rotating tips every 5 seconds
  const tipEl = document.getElementById('daily-tip-text');
  if (tipEl && CONFIG.tips && CONFIG.tips.length > 0) {
    let tipIdx = 0;
    tipEl.style.transition = 'opacity 0.4s ease';
    tipEl.textContent = CONFIG.tips[0];
    if (window._heroTipInterval) clearInterval(window._heroTipInterval);
    window._heroTipInterval = setInterval(() => {
      tipEl.style.opacity = '0';
      setTimeout(() => {
        tipIdx = (tipIdx + 1) % CONFIG.tips.length;
        tipEl.textContent = CONFIG.tips[tipIdx];
        tipEl.style.opacity = '1';
      }, 400);
    }, 5000);
  }
}

/* ============================== */
/*         DASHBOARD              */
/* ============================== */
function renderDashboard() {
  const profile = storage.getProfile();
  if (!profile) { window.location.hash = '#home'; return; }
  const progress = storage.getProgress();
  const skills = storage.getSkillData();
  const daily = storage.getDailyData();
  const avgPct = progress.totalAnswered > 0 ? Math.round((progress.totalCorrect / progress.totalAnswered) * 100) : 0;

  // Welcome bar + streak + motivation
  const streakCount = daily.streak || 0;
  const textsLeft = TEXTS.length - progress.textsCompleted;
  let motivationMsg = '';
  if (progress.textsCompleted === 0) motivationMsg = 'ابدأ رحلتك مع أول نص!';
  else if (avgPct >= 90) motivationMsg = 'أداء رائع! أنت بطل قراءة حقيقي';
  else if (avgPct >= 70) motivationMsg = 'واصل التقدم!';
  else if (textsLeft <= 3 && textsLeft > 0) motivationMsg = `باقي ${textsLeft} نصوص فقط — كمّل!`;
  else motivationMsg = 'كل نص تقرأه يقربك من القمة!';

  const dw = document.getElementById('dash-welcome');
  if (dw) dw.innerHTML = `
    <div class="dash-welcome-inner">
      <div class="dw-hello">
        <h2>مرحبًا ${profile.name}</h2>
      </div>
      <div class="dw-motivation">
        <div class="dw-streak ${streakCount > 0 ? 'active' : ''}">
          ${ICONS.fire}
          <span>${streakCount > 0 ? streakCount + ' يوم متتالي' : 'ابدأ سلسلتك!'}</span>
        </div>
        <div class="dw-msg">${motivationMsg}</div>
      </div>
    </div>`;

  // Daily tip — rotating
  const tipDash = document.getElementById('dash-tip');
  if (tipDash && CONFIG.tips && CONFIG.tips.length > 0) {
    tipDash.innerHTML = `<div class="tip-card"><span class="tip-icon">${ICONS.bulb}</span><div><strong>نصيحة اليوم</strong><p id="dash-tip-text">${CONFIG.tips[0]}</p></div></div>`;
    const dtEl = document.getElementById('dash-tip-text');
    if (dtEl) {
      let dtIdx = 0;
      dtEl.style.transition = 'opacity 0.4s ease';
      if (window._dashTipInterval) clearInterval(window._dashTipInterval);
      window._dashTipInterval = setInterval(() => {
        dtEl.style.opacity = '0';
        setTimeout(() => {
          dtIdx = (dtIdx + 1) % CONFIG.tips.length;
          dtEl.textContent = CONFIG.tips[dtIdx];
          dtEl.style.opacity = '1';
        }, 400);
      }, 5000);
    }
  }

  // Streak
  const streakEl = document.getElementById('streak-display');
  if (streakEl) streakEl.innerHTML = daily.streak > 0 ? `${ICONS.fire} ${daily.streak} يوم` : 'ابدأ سلسلتك!';

  // Leaderboard link banner
  const lbLink = document.getElementById('dash-lb-link');
  if (lbLink) lbLink.innerHTML = `
    <div class="lb-dash-card" onclick="window.location.hash='#leaderboard'">
      <div class="lb-dash-icon">${ICONS.trophy}</div>
      <div class="lb-dash-text"><h4>لوحة المتصدرين</h4><p>شوف ترتيبك بين أبطال القراءة!</p></div>
      <span class="lb-dash-arrow">&larr;</span>
    </div>`;

  // Progress stats
  const dpEl = document.getElementById('dash-progress');
  if (dpEl) {
    dpEl.innerHTML = `
      <div class="ds-card"><div class="ds-icon ds-icon-primary">${ICONS.book}</div><div class="ds-card-text"><span class="ds-val">${progress.textsCompleted}</span><span class="ds-lbl">نص مُكتمل</span></div></div>
      <div class="ds-card"><div class="ds-icon ds-icon-score">${ICONS.chart}</div><div class="ds-card-text"><span class="ds-val">${avgPct}%</span><span class="ds-lbl">المعدل العام</span></div></div>
      <div class="ds-card"><div class="ds-icon ds-icon-success">${ICONS.checkCircle}</div><div class="ds-card-text"><span class="ds-val">${progress.totalCorrect}</span><span class="ds-lbl">إجابة صحيحة</span></div></div>
      <div class="ds-card"><div class="ds-icon ds-icon-gold">${ICONS.fire}</div><div class="ds-card-text"><span class="ds-val">${daily.streak}</span><span class="ds-lbl">سلسلة أيام</span></div></div>
    `;
  }

  // Weakest 3 skills — لا تظهر إذا لم يُجب على أي سؤال بعد
  const weakEl = document.getElementById('dash-weak-skills');
  if (weakEl) {
    if (progress.totalAnswered === 0) {
      weakEl.innerHTML = '';
    } else {
    const sorted = [];
    for (let i = 1; i <= 15; i++) {
      sorted.push({ id: i, m: skills[i]?.mastery || 0 });
    }
    sorted.sort((a, b) => a.m - b.m);
    const weakest = sorted.slice(0, 3).filter(s => s.m < 80);

    if (weakest.length > 0) {
      let html = `<div class="weak-card"><h4>${ICONS.bolt} المهارات التي تحتاج تعزيز</h4>`;
      weakest.forEach(s => {
        const sk = SKILLS.find(sk => sk.id === s.id);
        html += `
          <div class="weak-skill-item">
            <span class="ws-num">${s.id}</span>
            <div class="ws-info">
              <div class="ws-name">${sk?.name || ui.getSkillName(s.id)}</div>
              <div class="ws-bar"><div class="ws-fill" style="width:${s.m}%;background:${ui.getMasteryColor(s.m)}"></div></div>
            </div>
            <button class="btn btn-sm btn-primary ws-btn" onclick="window.location.hash='#skills'">تدرّب</button>
          </div>`;
      });
      html += '</div>';
      weakEl.innerHTML = html;
    } else {
      weakEl.innerHTML = `<div class="weak-card"><h4>${ICONS.sparkle} أداء ممتاز! جميع مهاراتك فوق 80%</h4></div>`;
    }
    } // end else (totalAnswered > 0)
  }

  // Badges
  const badgesEl = document.getElementById('dash-badges');
  if (badgesEl) {
    const earned = storage.getBadges();
    const all = engine.getBadgeDefinitions();
    let html = `<div class="dash-badges-card"><h4>${ICONS.trophy} الشارات</h4><div class="badges-grid">`;
    all.forEach(b => {
      const got = earned.includes(b.id);
      html += `<div class="badge-item ${got ? 'earned' : 'locked'}" title="${b.name}"><span class="badge-icon">${ICONS[b.icon] || b.icon}</span><span class="badge-label">${b.name}</span></div>`;
    });
    html += '</div></div>';
    badgesEl.innerHTML = html;
  }
}

let _textsMode = 'practice';
function renderTextsGrid(mode) {
  if (typeof mode === 'string') _textsMode = mode || 'practice';
  const grid = document.getElementById('texts-grid');
  if (!grid) return;
  const completed = storage.getCompletedTexts();
  const diffF = document.getElementById('filter-difficulty')?.value || '';
  const genreF = document.getElementById('filter-genre')?.value || '';

  let filtered = TEXTS;
  if (diffF) filtered = filtered.filter(t => t.difficulty === diffF);
  if (genreF) filtered = filtered.filter(t => t.genre === genreF);

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">لا توجد نصوص مطابقة.</p>';
    return;
  }

  const genreIcons = { 'خيالي': ICONS.rocket, 'واقعي': ICONS.globe, 'معلوماتي': ICONS.book, 'حواري': ICONS.chat, 'شعري': ICONS.palette, 'مقالي': ICONS.pen, 'وصفي': ICONS.pen, 'إرشادي': ICONS.bulb, 'قصصي': ICONS.pen, 'سيرة': ICONS.globe };

  grid.innerHTML = filtered.map(t => {
    const c = completed.find(x => x.id === t.id);
    const qCount = t.questions?.length || 0;
    return `
      <div class="text-card ${c ? 'completed' : ''} ${ui.getDiffClass(t.difficulty)}" data-id="${t.id}">
        <div class="tc-genre-icon">${genreIcons[t.genre] || ICONS.book}</div>
        <div class="tc-info">
          <h4>${t.title}</h4>
          <div class="tc-meta">
            <span class="diff-badge ${ui.getDiffClass(t.difficulty)}">${t.difficulty}</span>
            <span class="genre-tag">${t.genre}</span>
            <span class="tc-qcount">${qCount} سؤال</span>
          </div>
        </div>
        <div class="tc-score">
          ${c ? '<span class="score-val">' + c.score + '%</span><span class="score-lbl">أفضل نتيجة</span>' : '<span class="score-lbl new-badge">جديد</span>'}
        </div>
      </div>`;
  }).join('');

  const playMode = _textsMode;
  grid.querySelectorAll('.text-card').forEach(card => {
    card.addEventListener('click', () => {
      window.location.hash = '#play/' + playMode + '/' + card.dataset.id;
    });
  });
}

/* ============================== */
/*       SKILL TRAINING PAGE      */
/* ============================== */
function renderSkillSelect() {
  const container = document.getElementById('skill-select-container');
  if (!container) return;
  const skills = storage.getSkillData();

  let html = '<h2 class="section-title">اختر المهارة للتدريب عليها</h2><div class="skills-grid">';
  for (let i = 1; i <= 15; i++) {
    const sk = SKILLS.find(s => s.id === i) || {};
    const m = skills[i]?.mastery || 0;
    // Count available questions
    let qCount = 0;
    TEXTS.forEach(t => (t.questions || []).forEach(q => { if (q.skill_id === i) qCount++; }));

    html += `
      <div class="skill-card" data-skill="${i}">
        <div class="sk-header">
          <span class="sk-icon">${ICONS[sk.icon] || ICONS.note}</span>
          <span class="sk-id">S${i}</span>
        </div>
        <h4 class="sk-name">${sk.name || ui.getSkillName(i)}</h4>
        <p class="sk-desc">${sk.description || ''}</p>
        <div class="sk-footer">
          <div class="sk-mastery">
            <div class="sk-bar"><div class="sk-fill" style="width:${m}%;background:${ui.getMasteryColor(m)}"></div></div>
            <span style="color:${ui.getMasteryColor(m)}">${m}%</span>
          </div>
          <span class="sk-qcount">${qCount} سؤال</span>
        </div>
      </div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.skill-card').forEach(card => {
    card.addEventListener('click', () => {
      const skillId = parseInt(card.dataset.skill);
      startSkillTraining(skillId);
    });
  });
}

function startSkillTraining(skillId) {
  cleanupGame();
  const result = engine.getQuestionsForSkill(TEXTS, skillId, 15);

  if (!result.valid) {
    ui.showToast(result.error, 'danger');
    return;
  }

  if (result.questions.length < 3) {
    ui.showToast('عدد الأسئلة المتاحة لهذه المهارة غير كافٍ (' + result.count + ' أسئلة). جرّب التدريب الحر.', 'danger');
    return;
  }

  // Runtime assertion: every question must match skill
  for (const q of result.questions) {
    if (q.skill_id !== skillId) {
      console.error('[ASSERT FAIL] Question', q.id, 'has skill_id', q.skill_id, 'expected', skillId);
      ui.showToast('خطأ في التحقق من الأسئلة. يُرجى المحاولة لاحقًا.', 'danger');
      return;
    }
  }

  const sk = SKILLS.find(s => s.id === skillId) || {};
  currentGame = {
    mode: 'skill',
    skillId,
    skillName: sk.name || ui.getSkillName(skillId),
    text: { id: 'SKILL_' + skillId, title: sk.name || ui.getSkillName(skillId), body: '' },
    questions: result.questions,
    currentQ: 0,
    answers: [],
    score: 0,
    startTime: Date.now(),
    timer: null,
    timerSeconds: 0
  };

  showPage('play');
  renderPlayScreen();
  document.getElementById('play-timer').style.display = 'none';
}

/* ============================== */
/*         GAME PLAY              */
/* ============================== */
function startGame(mode, textId) {
  cleanupGame();
  let text;
  if (mode === 'daily') {
    text = engine.getDailyText(TEXTS);
  } else if (textId) {
    text = TEXTS.find(t => t.id === textId);
  }
  if (!text) text = engine.getNextText(TEXTS);
  if (!text) return;

  currentGame = {
    mode,
    text,
    questions: text.questions.map(q => engine.shuffleQuestion(q)),
    currentQ: 0,
    answers: [],
    score: 0,
    startTime: Date.now(),
    timer: null,
    timerSeconds: 0,
    questionTimer: null,
    questionSeconds: 0,
    memoryPhase: null // 'reading' | 'questions'
  };

  showPage('play');

  if (mode === 'memory') {
    startMemoryReading();
  } else {
    renderPlayScreen();
    document.getElementById('memory-reading-overlay').style.display = 'none';
    if (mode === 'nafs') {
      const totalSec = (CONFIG.nafs_total_minutes || 30) * 60;
      currentGame.timerSeconds = totalSec;
      document.getElementById('play-timer').style.display = 'flex';
      updateTimerDisplay();
      currentGame.timer = setInterval(() => {
        currentGame.timerSeconds--;
        updateTimerDisplay();
        if (currentGame.timerSeconds <= 0) {
          clearInterval(currentGame.timer);
          finishGame();
        }
      }, 1000);
    } else {
      document.getElementById('play-timer').style.display = 'none';
    }
  }
}

/* --- Memory Mode: Reading Phase --- */
function startMemoryReading() {
  const g = currentGame;
  g.memoryPhase = 'reading';

  // Reading time based on difficulty
  const readingTimes = { 'سهل': 60, 'متوسط': 75, 'متقدم': 90 };
  let totalSec = readingTimes[g.text.difficulty] || 60;

  // Show text, hide questions
  const textPanel = document.getElementById('play-text-panel');
  const qPanel = document.getElementById('play-question-panel');
  const overlay = document.getElementById('memory-reading-overlay');
  const toggleBtn = document.getElementById('toggle-text-btn');

  textPanel.style.display = '';
  qPanel.style.display = 'none';
  overlay.style.display = 'flex';
  overlay.classList.remove('memory-urgent');
  overlay.querySelector('.memory-label').textContent = 'اقرأ النص بتركيز...';
  if (toggleBtn) toggleBtn.style.display = 'none';
  document.getElementById('play-timer').style.display = 'none';
  document.getElementById('play-progress-fill').style.width = '0%';
  document.getElementById('play-progress-text').textContent = 'اقرأ النص';

  // Render text
  const isPoetry = (g.text?.genre === 'شعري');
  document.getElementById('play-text-title').textContent = g.text.title;
  const bodyEl = document.getElementById('play-text-body');
  if (isPoetry && g.text.body.includes('\n')) {
    const lines = g.text.body.split('\n').filter(l => l.trim());
    let html = '<div class="poetry-verses">';
    for (let i = 0; i < lines.length; i += 2) {
      html += `<div class="poetry-verse"><span>${lines[i].trim()}</span><span>${(lines[i + 1] || '').trim()}</span></div>`;
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  } else {
    const paragraphs = g.text.body.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length > 1) {
      bodyEl.innerHTML = paragraphs.map((p, i) => {
        const safe = p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="text-paragraph"><span class="para-num">فقرة ${i + 1}</span>${safe}</div>`;
      }).join('');
    } else {
      bodyEl.textContent = g.text.body;
    }
  }

  // Timer circle
  const circumference = 2 * Math.PI * 45;
  const fill = document.getElementById('memory-timer-fill');
  const timerText = document.getElementById('memory-timer-text');
  fill.style.strokeDasharray = circumference;
  fill.style.strokeDashoffset = 0;

  let remaining = totalSec;
  timerText.textContent = remaining;
  ui.resumeAudio();

  // Skip button
  const skipBtn = document.getElementById('btn-skip-reading');
  if (skipBtn) {
    skipBtn.style.display = '';
    skipBtn.onclick = () => {
      if (currentGame !== g || g.memoryPhase !== 'reading') return;
      clearInterval(g.timer);
      g.timer = null;
      if (g._pendingTimeout) { clearTimeout(g._pendingTimeout); g._pendingTimeout = null; }
      startMemoryQuestions();
    };
  }

  g.timer = setInterval(() => {
    if (currentGame !== g) { clearInterval(g.timer); return; }
    remaining--;
    timerText.textContent = remaining;
    const progress = 1 - (remaining / totalSec);
    fill.style.strokeDashoffset = circumference * progress;

    // Tick sounds
    if (remaining <= 10 && remaining > 0) {
      ui.playUrgentTick();
      overlay.classList.add('memory-urgent');
    } else if (remaining > 0) {
      ui.playTickSound();
    }

    if (remaining <= 0) {
      clearInterval(g.timer);
      g.timer = null;
      ui.playTimeUpSound();
      overlay.querySelector('.memory-label').textContent = 'انتهى الوقت!';
      g._pendingTimeout = setTimeout(() => {
        if (currentGame === g) startMemoryQuestions();
      }, 1000);
    }
  }, 1000);
}

function startMemoryQuestions() {
  const g = currentGame;
  g.memoryPhase = 'questions';

  // Hide text completely
  document.getElementById('play-text-panel').style.display = 'none';
  document.getElementById('memory-reading-overlay').style.display = 'none';
  document.getElementById('play-question-panel').style.display = '';
  document.getElementById('play-timer').style.display = 'flex';

  renderPlayScreen();
  startQuestionTimer();
}

/* --- Memory Mode: Question Timer (20s per question) --- */
function startQuestionTimer() {
  const g = currentGame;
  if (g.mode !== 'memory' || g.memoryPhase !== 'questions') return;

  g.questionSeconds = 20;
  updateQuestionTimerDisplay();

  if (g.questionTimer) clearInterval(g.questionTimer);
  g.questionTimer = setInterval(() => {
    if (currentGame !== g) { clearInterval(g.questionTimer); return; }
    g.questionSeconds--;
    updateQuestionTimerDisplay();

    if (g.questionSeconds <= 5 && g.questionSeconds > 0) {
      ui.resumeAudio();
      ui.playUrgentTick();
    }

    if (g.questionSeconds <= 0) {
      clearInterval(g.questionTimer);
      g.questionTimer = null;
      handleMemoryTimeout();
    }
  }, 1000);
}

function updateQuestionTimerDisplay() {
  const el = document.getElementById('play-timer');
  if (!el || !currentGame) return;
  const s = currentGame.questionSeconds;
  el.textContent = '00:' + String(s).padStart(2, '0');
  el.classList.toggle('timer-danger', s <= 5);
}

function handleMemoryTimeout() {
  const g = currentGame;
  const q = g.questions[g.currentQ];

  ui.resumeAudio();
  ui.playTimeUpSound();

  // Record as wrong answer
  g.answers.push({ skillId: q.skill_id, selected: -1, correct: q.correct_index, isCorrect: false });
  engine.processAnswer(q.skill_id, false, CONFIG);

  // Show correct answer
  const buttons = document.querySelectorAll('.option-btn');
  buttons.forEach(btn => {
    const bi = parseInt(btn.dataset.index);
    btn.classList.add('disabled');
    btn.disabled = true;
    if (bi === q.correct_index) btn.classList.add('correct');
  });

  ui.showToast('انتهى الوقت!', 'error');

  // Auto next after 1.5s
  g._pendingTimeout = setTimeout(() => {
    if (currentGame !== g) return;
    g.currentQ++;
    if (g.currentQ >= g.questions.length) finishGame();
    else { renderPlayScreen(); startQuestionTimer(); }
  }, 1500);
}

function updateTimerDisplay() {
  const el = document.getElementById('play-timer');
  if (!el) return;
  const m = Math.floor(currentGame.timerSeconds / 60);
  const s = currentGame.timerSeconds % 60;
  el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  el.classList.toggle('timer-danger', currentGame.timerSeconds < 60);
}

function renderPlayScreen() {
  const g = currentGame;
  const q = g.questions[g.currentQ];
  const total = g.questions.length;

  // Opponent bar: show only in challenge mode
  const opBar = document.getElementById('opponent-bar');
  if (opBar) opBar.style.display = g.mode === 'challenge' ? 'flex' : 'none';

  // Text panel – hide for skill mode if no text body
  const textPanel = document.getElementById('play-text-panel');
  const toggleBtn = document.getElementById('toggle-text-btn');
  const isPoetry = (g.text?.genre === 'شعري');

  function renderBody(title, body) {
    document.getElementById('play-text-title').textContent = title;
    const bodyEl = document.getElementById('play-text-body');
    if (isPoetry && body.includes('\n')) {
      const lines = body.split('\n').filter(l => l.trim());
      let html = '<div class="poetry-verses">';
      for (let i = 0; i < lines.length; i += 2) {
        html += `<div class="poetry-verse"><span>${lines[i].trim()}</span><span>${(lines[i + 1] || '').trim()}</span></div>`;
      }
      html += '</div>';
      bodyEl.innerHTML = html;
    } else {
      const paragraphs = body.split(/\n\s*\n/).filter(p => p.trim());
      if (paragraphs.length > 1) {
        bodyEl.innerHTML = paragraphs.map((p, i) => {
          const safe = p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<div class="text-paragraph"><span class="para-num">فقرة ${i + 1}</span>${safe}</div>`;
        }).join('');
      } else {
        bodyEl.textContent = body;
      }
    }
  }

  if (g.mode === 'memory' && g.memoryPhase === 'questions') {
    textPanel.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'none';
  } else if (g.mode === 'skill') {
    const body = q.textBody || '';
    if (body) {
      textPanel.style.display = '';
      renderBody(q.textTitle || '', body);
    } else {
      textPanel.style.display = 'none';
    }
  } else {
    textPanel.style.display = '';
    renderBody(g.text.title, g.text.body);
  }

  // Progress
  document.getElementById('play-progress-fill').style.width = ((g.currentQ) / total * 100) + '%';
  document.getElementById('play-progress-text').textContent = (g.currentQ + 1) + '/' + total;

  // Skill tag
  const skillTag = document.getElementById('play-skill-tag');
  if (g.mode === 'practice' || g.mode === 'skill') {
    skillTag.textContent = ui.getSkillName(q.skill_id);
    skillTag.style.display = 'inline-block';
  } else {
    skillTag.style.display = 'none';
  }

  // Question
  document.getElementById('play-stem').textContent = q.stem;
  document.getElementById('play-explanation').style.display = 'none';
  document.getElementById('btn-next-q').style.display = 'none';

  // Options
  const optC = document.getElementById('play-options');
  optC.innerHTML = q.choices.map((opt, i) => `
    <button class="option-btn" data-index="${i}">
      <span class="opt-letter">${ui.letterFromIndex(i)}</span>
      <span class="opt-text">${opt}</span>
    </button>`).join('');

  optC.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAnswer(parseInt(btn.dataset.index)));
  });

  // Text toggle reset
  if (textPanel.style.display !== 'none') {
    textPanel.classList.remove('text-collapsed');
    if (toggleBtn) toggleBtn.textContent = 'إخفاء النص';
  }
}

function handleAnswer(idx) {
  const g = currentGame;
  const q = g.questions[g.currentQ];
  const isCorrect = idx === q.correct_index;

  // Stop question timer and pending timeout for memory mode
  if (g.questionTimer) { clearInterval(g.questionTimer); g.questionTimer = null; }
  if (g._pendingTimeout) { clearTimeout(g._pendingTimeout); g._pendingTimeout = null; }

  g.answers.push({ skillId: q.skill_id, selected: idx, correct: q.correct_index, isCorrect });
  if (isCorrect) g.score++;

  engine.processAnswer(q.skill_id, isCorrect, CONFIG);
  updateHeaderXP();

  // Sound
  ui.resumeAudio();
  if (isCorrect) ui.playCorrectSound();
  else ui.playWrongSound();

  // Visual feedback
  const buttons = document.querySelectorAll('.option-btn');
  buttons.forEach(btn => {
    const bi = parseInt(btn.dataset.index);
    btn.classList.add('disabled');
    btn.disabled = true;
    if (bi === q.correct_index) btn.classList.add('correct');
    if (bi === idx && !isCorrect) btn.classList.add('wrong');
  });

  // Explanation (practice & skill modes only — not memory or daily)
  if (g.mode === 'practice' || g.mode === 'skill') {
    const expEl = document.getElementById('play-explanation');
    expEl.innerHTML = `<strong>${isCorrect ? ICONS.checkCircle + ' إجابة صحيحة!' : ICONS.xCircle + ' إجابة خاطئة'}</strong><br>${q.explanation || ''}`;
    expEl.className = 'explanation-box ' + (isCorrect ? 'exp-correct' : 'exp-wrong');
    expEl.style.display = 'block';
  }

  if (isCorrect && (g.mode === 'practice' || g.mode === 'skill')) {
    ui.showToast('+' + (CONFIG.xp_per_correct || 10) + ' XP', 'success');
  }

  // Memory mode: auto-advance after short delay
  if (g.mode === 'memory') {
    g._pendingTimeout = setTimeout(() => {
      if (currentGame !== g) return;
      g.currentQ++;
      if (g.currentQ >= g.questions.length) finishGame();
      else { renderPlayScreen(); startQuestionTimer(); }
    }, 1200);
    return;
  }

  // Challenge mode: report to RTDB + auto-advance
  if (g.mode === 'challenge') {
    challenge.handleChallengeAnswer(idx);
    g._pendingTimeout = setTimeout(() => {
      if (currentGame !== g) return;
      const finished = challenge.advanceChallengeQuestion();
      g.currentQ++;
      if (finished || g.currentQ >= g.questions.length) {
        finishGame();
      } else {
        renderPlayScreen();
      }
    }, 1000);
    return;
  }

  const nextBtn = document.getElementById('btn-next-q');
  nextBtn.style.display = 'block';
  nextBtn.textContent = g.currentQ < g.questions.length - 1 ? 'السؤال التالي ←' : 'عرض النتيجة';
}

function nextQuestion() {
  const g = currentGame;
  g.currentQ++;
  if (g.currentQ >= g.questions.length) finishGame();
  else renderPlayScreen();
}

function finishGame() {
  if (currentGame.timer) { clearInterval(currentGame.timer); currentGame.timer = null; }
  if (currentGame.questionTimer) { clearInterval(currentGame.questionTimer); currentGame.questionTimer = null; }
  if (currentGame._pendingTimeout) { clearTimeout(currentGame._pendingTimeout); currentGame._pendingTimeout = null; }

  const g = currentGame;
  const pct = Math.round((g.score / g.questions.length) * 100);

  // Challenge mode: report finish and wait for result
  if (g.mode === 'challenge') {
    challenge.finishChallenge();
    // النتائج تُعرض عبر listener في challenge.js
    return;
  }

  // Sound
  ui.resumeAudio();
  if (pct >= 60) ui.playSuccessSound();

  // Only mark text complete if not skill mode
  if (g.mode !== 'skill') {
    engine.completeText(g.text.id, pct, CONFIG);
  } else {
    storage.saveStudentSnapshot();
  }

  syncLocalToCloud();

  if (g.mode === 'daily') {
    const daily = storage.getDailyData();
    daily.todayDone = true;
    storage.setDailyData(daily);
  }

  const newBadges = engine.checkBadges();
  if (newBadges.length > 0) {
    ui.showConfetti();
    const allBadges = engine.getBadgeDefinitions();
    newBadges.forEach(bId => {
      const bd = allBadges.find(b => b.id === bId);
      if (bd) ui.showToast('شارة جديدة: ' + bd.name, 'gold');
    });
  }

  if (pct >= 80) ui.showConfetti();
  updateHeaderXP();
  showReport(g, pct);
}

/* ============================== */
/*         REPORT                 */
/* ============================== */
function showReport(game, pct) {
  showPage('report');
  const c = document.getElementById('report-container');
  const scoreColor = ui.getScoreColor(pct);

  // Build skill analysis
  const skillMap = {};
  game.answers.forEach(a => {
    if (!skillMap[a.skillId]) skillMap[a.skillId] = { correct: 0, total: 0 };
    skillMap[a.skillId].total++;
    if (a.isCorrect) skillMap[a.skillId].correct++;
  });

  let skillRows = '';
  Object.entries(skillMap).forEach(([sid, data]) => {
    const pctS = Math.round((data.correct / data.total) * 100);
    skillRows += `
      <div class="report-skill-row">
        <span class="rsk-num" style="background:${ui.getMasteryColor(pctS)}">${sid}</span>
        <span class="rsk-name">${ui.getSkillName(parseInt(sid))}</span>
        <span class="rsk-val" style="color:${ui.getMasteryColor(pctS)}">${data.correct}/${data.total}</span>
      </div>`;
  });

  // Weakest skills suggestion
  const weakSkills = Object.entries(skillMap)
    .filter(([, d]) => d.correct / d.total < 0.5)
    .map(([sid]) => parseInt(sid));

  let weakHTML = '';
  if (weakSkills.length > 0) {
    weakHTML = `<div class="weak-suggest"><h4>${ICONS.dumbbell} تدرّب أكثر على:</h4><div class="weak-btns">`;
    weakSkills.forEach(sid => {
      weakHTML += `<button class="btn btn-sm btn-outline" onclick="window.location.hash='#skills'">${ui.getSkillName(sid)}</button>`;
    });
    weakHTML += '</div></div>';
  }

  // Explanations for nafs mode
  let expHTML = '';
  if (game.mode === 'nafs') {
    expHTML = '<div class="report-explanations"><h3>الشرح التفصيلي</h3>';
    game.questions.forEach((q, i) => {
      const a = game.answers[i];
      expHTML += `
        <div class="exp-item">
          <p class="exp-q">س${i + 1}: ${q.stem}</p>
          <p class="exp-result ${a?.isCorrect ? 'correct' : 'wrong'}">${a?.isCorrect ? ICONS.check + ' صحيح' : ICONS.xmark + ' خطأ — الصحيح: ' + q.choices[q.correct_index]}</p>
          ${q.explanation ? '<p class="exp-text">' + q.explanation + '</p>' : ''}
        </div>`;
    });
    expHTML += '</div>';
  }

  const title = game.mode === 'skill' ? game.skillName : game.text.title;

  c.innerHTML = `
    <div class="report-card">
      <div class="report-header">
        <h2>تقرير النتيجة</h2>
        <p class="report-subtitle">${title}</p>
        <div class="report-score" style="background:${scoreColor}">${pct}%</div>
        <p class="report-detail">${game.score} من ${game.questions.length} — ${ui.getGrade(pct)}</p>
      </div>
      <div class="report-skills">${skillRows}</div>
      ${weakHTML}
      ${expHTML}
      <div class="report-actions">
        <button class="btn btn-primary btn-lg" onclick="window.location.hash='#dashboard'">العودة للرئيسية</button>
        ${game.mode === 'skill' ? '<button class="btn btn-outline btn-lg" onclick="window.location.hash=\'#skills\'">تدريب مهارة أخرى</button>' : ''}
      </div>
    </div>`;
}

/* ============================== */
/*         PROFILE                */
/* ============================== */
function renderProfile() {
  const profile = storage.getProfile();
  if (!profile) { window.location.hash = '#home'; return; }
  const progress = storage.getProgress();
  const skills = storage.getSkillData();
  const settings = storage.getSettings();

  const avgPct = progress.totalAnswered > 0 ? Math.round((progress.totalCorrect / progress.totalAnswered) * 100) : 0;

  // Skill rows
  let skillRows = '';
  for (let i = 1; i <= 15; i++) {
    const m = skills[i]?.mastery || 0;
    skillRows += `
      <div class="skill-row">
        <span class="sr-num">${i}</span>
        <div class="sr-main">
          <span class="sr-name">${ui.getSkillName(i)}</span>
          <div class="sr-bar"><div class="sr-fill" style="width:${m}%;background:${ui.getMasteryColor(m)}"></div></div>
        </div>
        <span class="sr-val" style="color:${ui.getMasteryColor(m)}">${m}%</span>
      </div>`;
  }

  // Badges
  const earned = storage.getBadges();
  const all = engine.getBadgeDefinitions();
  let badgesHTML = '';
  all.forEach(b => {
    const got = earned.includes(b.id);
    badgesHTML += `<div class="badge-item ${got ? 'earned' : 'locked'}"><span class="badge-icon">${ICONS[b.icon] || b.icon}</span><span class="badge-label">${b.name}</span></div>`;
  });

  const c = document.getElementById('profile-container');
  c.innerHTML = `
    <div class="profile-header-card">
      <div class="ph-avatar">${profile.name.charAt(0)}</div>
      <h2>${profile.name}</h2>
      <p>${profile.className}</p>
      <div class="ph-stats">
        <div class="ph-stat"><span class="ph-val" style="color:var(--gold)">${ICONS.star} ${progress.xp}</span><span class="ph-lbl">XP</span></div>
        <div class="ph-stat"><span class="ph-val" style="color:var(--primary)">${ICONS.book} ${progress.textsCompleted}</span><span class="ph-lbl">نص</span></div>
        <div class="ph-stat"><span class="ph-val" style="color:${ui.getScoreColor(avgPct)}">${ICONS.chart} ${avgPct}%</span><span class="ph-lbl">المعدل</span></div>
        <div class="ph-stat"><span class="ph-val" style="color:var(--navy)">${ICONS.medal} ${progress.level}</span><span class="ph-lbl">المستوى</span></div>
      </div>
    </div>

    <div class="profile-section">
      <h3>إعدادات الصوت</h3>
      <div class="settings-row">
        <label class="toggle-label">
          <input type="checkbox" id="chk-sound" ${settings.soundEnabled ? 'checked' : ''}>
          <span>تفعيل الأصوات</span>
        </label>
        <div class="volume-row">
          <span>مستوى الصوت</span>
          <input type="range" id="rng-volume" min="0" max="1" step="0.1" value="${settings.soundVolume}">
        </div>
      </div>
    </div>

    <div class="profile-section">
      <h3>إتقان المهارات</h3>
      <div class="skill-rows">${skillRows}</div>
    </div>

    <div class="profile-section">
      <h3>الشارات</h3>
      <div class="badges-grid">${badgesHTML}</div>
    </div>

    <div class="profile-section profile-links-section">
      <div class="profile-link-item" onclick="window.location.hash='#certificate'">
        <div class="profile-link-icon" style="background:linear-gradient(135deg,#F59E0B,#D97706)">${ICONS.cap}</div>
        <div class="profile-link-text">
          <span class="profile-link-title">شهادة الإنجاز</span>
          <span class="profile-link-desc">عرض وتحميل شهادتك</span>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
      <div class="profile-link-item" onclick="window.location.hash='#verify'">
        <div class="profile-link-icon" style="background:linear-gradient(135deg,#6366F1,#4F46E5)">${ICONS.search}</div>
        <div class="profile-link-text">
          <span class="profile-link-title">التحقق من شهادة</span>
          <span class="profile-link-desc">تحقق من صحة شهادة برقمها</span>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
      <div class="profile-link-item" onclick="window.location.hash='#about'">
        <div class="profile-link-icon" style="background:linear-gradient(135deg,#14B8A6,#0D9488)">${ICONS.info}</div>
        <div class="profile-link-text">
          <span class="profile-link-title">عن المبادرة</span>
          <span class="profile-link-desc">تعرّف على مشروع أبطال القراءة</span>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
    </div>

    <div class="profile-section profile-links-section">
      <div class="profile-link-item" id="btn-logout">
        <div class="profile-link-icon" style="background:linear-gradient(135deg,#F59E0B,#D97706)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </div>
        <div class="profile-link-text">
          <span class="profile-link-title">تسجيل الخروج</span>
          <span class="profile-link-desc">الخروج من حسابك الحالي</span>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
      <div class="profile-link-item profile-link-danger" id="btn-clear-data">
        <div class="profile-link-icon" style="background:linear-gradient(135deg,#EF4444,#DC2626)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </div>
        <div class="profile-link-text">
          <span class="profile-link-title" style="color:var(--danger)">مسح جميع بياناتي</span>
          <span class="profile-link-desc">حذف جميع البيانات نهائياً</span>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
    </div>
  `;

  // Settings handlers
  document.getElementById('chk-sound')?.addEventListener('change', (e) => {
    const s = storage.getSettings();
    s.soundEnabled = e.target.checked;
    storage.setSettings(s);
    if (e.target.checked) { ui.resumeAudio(); ui.playCorrectSound(); }
  });
  document.getElementById('rng-volume')?.addEventListener('input', (e) => {
    const s = storage.getSettings();
    s.soundVolume = parseFloat(e.target.value);
    storage.setSettings(s);
  });
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (confirm('هل تريد تسجيل الخروج؟')) {
      await syncLocalToCloud();
      await logoutUser();
    }
  });
  document.getElementById('btn-clear-data')?.addEventListener('click', async () => {
    if (confirm('هل أنت متأكد من مسح جميع بياناتك؟ لا يمكن التراجع!')) {
      storage.clearStudentData();
      await logoutUser();
    }
  });
}

/* ============================== */
/*         CERTIFICATE            */
/* ============================== */
function renderCertificate() {
  const c = document.getElementById('cert-container');
  const eligibility = engine.checkCertificateEligibility(CONFIG);

  if (eligibility.eligible) {
    let certData = storage.getCertData();
    if (!certData) {
      certData = cert.generateCertificate(CONFIG);
      ui.showConfetti();
    }

    c.innerHTML = `
      <div class="cert-card">
        <div id="cert-canvas-wrap"></div>
        <div class="cert-actions">
          <button class="btn btn-gold btn-lg" id="btn-download-cert">${ICONS.download || ICONS.star} تحميل الشهادة</button>
          <button class="btn btn-outline btn-lg" onclick="window.print()">${ICONS.pen || ''} طباعة</button>
        </div>
      </div>`;

    // Draw canvas certificate
    cert.drawCertificateCanvas(certData, CONFIG).then(canvas => {
      if (!canvas) return;
      canvas.style.width = '100%';
      canvas.style.maxWidth = '550px';
      canvas.style.borderRadius = '8px';
      canvas.style.boxShadow = '0 8px 40px rgba(10,30,61,0.15)';
      document.getElementById('cert-canvas-wrap')?.appendChild(canvas);
    }).catch(() => {});

    document.getElementById('btn-download-cert')?.addEventListener('click', () => {
      cert.downloadCertAsPNG(certData, CONFIG);
    });
  } else {
    const doneCount = [eligibility.allMastered, eligibility.enoughTexts, eligibility.goodAvg].filter(Boolean).length;
    const progressPct = Math.round((doneCount / 3) * 100);
    const checks = [
      { label: 'إتقان جميع المهارات', detail: '80% لكل مهارة', done: eligibility.allMastered },
      { label: `إكمال ${eligibility.minTexts} نصوص`, detail: `أنجزت ${eligibility.textsCompleted} من ${eligibility.minTexts}`, done: eligibility.enoughTexts },
      { label: `معدل عام ≥ ${eligibility.minAvg}%`, detail: `معدلك الحالي ${eligibility.avgPercent}%`, done: eligibility.goodAvg }
    ];

    c.innerHTML = `
      <div class="cert-card cert-pending-v2">
        <div class="cert-pending-header">
          <div class="cert-pending-icon">${ICONS.cap}</div>
          <h3>شهادة الإنجاز</h3>
          <p>أكمل المتطلبات التالية للحصول على شهادتك</p>
        </div>

        <div class="cert-progress-bar-wrap">
          <div class="cert-progress-info">
            <span>التقدم نحو الشهادة</span>
            <span class="cert-progress-pct">${doneCount}/3</span>
          </div>
          <div class="cert-progress-track">
            <div class="cert-progress-fill" style="width:${progressPct}%"></div>
          </div>
        </div>

        <div class="cert-checks-list">
          ${checks.map(ch => `
            <div class="cert-check-row ${ch.done ? 'cert-check-done' : ''}">
              <div class="cert-check-status">
                ${ch.done
                  ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#22C55E"/><path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                  : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#D1D5DB" stroke-width="1.5"/></svg>'}
              </div>
              <div class="cert-check-info">
                <span class="cert-check-label">${ch.label}</span>
                <span class="cert-check-detail">${ch.detail}</span>
              </div>
            </div>`).join('')}
        </div>

        <button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px" onclick="window.location.hash='#dashboard'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-left:6px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          واصل التدريب
        </button>
      </div>`;
  }
}

/* ============================== */
/*         VERIFY                 */
/* ============================== */
function renderVerify() {
  const btn = document.getElementById('btn-verify');
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => {
    const vid = document.getElementById('verify-id').value.trim();
    const certData = storage.getCertData();
    const r = document.getElementById('verify-result');
    if (certData && certData.verificationId === vid) {
      r.className = 'verify-result verify-ok';
      r.innerHTML = `<strong>${ICONS.checkCircle} شهادة صحيحة</strong><br>الاسم: ${certData.name}<br>التاريخ: ${ui.formatDate(certData.date)}<br>المعدل: ${certData.avgPercent}%`;
    } else {
      r.className = 'verify-result verify-fail';
      r.innerHTML = `<strong>${ICONS.xCircle} رقم التحقق غير صحيح</strong>`;
    }
  });
}

/* ============================== */
/*         TEACHER PANEL          */
/* ============================== */
async function renderTeacher() {
  const c = document.getElementById('teacher-container');
  const hasAdmin = storage.getAdminHash();
  const isLogged = sessionStorage.getItem('teacher_logged') === 'true';

  if (!hasAdmin) {
    // First-time setup
    c.innerHTML = `
      <div class="card card-centered">
        <h2>${ICONS.lock} إعداد لوحة المعلم</h2>
        <p style="color:var(--muted)">ضع كلمة مرور جديدة للوحة المعلم</p>
        <p style="color:#F59E0B;font-size:0.85rem">${ICONS.warning} هذه حماية محلية وليست أمانًا كاملًا</p>
        <div class="form-group">
          <label>كلمة المرور الجديدة</label>
          <input type="password" id="admin-new-pass" class="input-field" placeholder="أدخل كلمة المرور">
        </div>
        <div class="form-group">
          <label>تأكيد كلمة المرور</label>
          <input type="password" id="admin-confirm-pass" class="input-field" placeholder="أعد إدخال كلمة المرور">
        </div>
        <button class="btn btn-primary btn-block" id="btn-admin-setup">حفظ</button>
      </div>`;

    document.getElementById('btn-admin-setup')?.addEventListener('click', async () => {
      const p1 = document.getElementById('admin-new-pass').value;
      const p2 = document.getElementById('admin-confirm-pass').value;
      if (p1.length < 4) { ui.showToast('كلمة المرور يجب أن تكون 4 أحرف على الأقل', ''); return; }
      if (p1 !== p2) { ui.showToast('كلمتا المرور غير متطابقتين', ''); return; }
      const salt = engine.generateSalt();
      const hash = await engine.hashPassword(p1, salt);
      storage.setAdminCredentials(hash, salt);
      sessionStorage.setItem('teacher_logged', 'true');
      ui.showToast('تم إعداد كلمة المرور بنجاح', 'success');
      renderTeacher();
    });
    return;
  }

  if (!isLogged) {
    c.innerHTML = `
      <div class="card card-centered">
        <h2>${ICONS.lock} لوحة المعلم</h2>
        <p style="color:var(--muted)">أدخل كلمة المرور</p>
        <div class="form-group">
          <input type="password" id="teacher-pass" class="input-field" placeholder="كلمة المرور">
        </div>
        <button class="btn btn-primary btn-block" id="btn-teacher-login">دخول</button>
      </div>`;

    document.getElementById('btn-teacher-login')?.addEventListener('click', async () => {
      const pass = document.getElementById('teacher-pass').value;
      const salt = storage.getAdminSalt();
      const hash = await engine.hashPassword(pass, salt);
      if (hash === storage.getAdminHash()) {
        sessionStorage.setItem('teacher_logged', 'true');
        renderTeacher();
      } else {
        ui.showToast('كلمة مرور خاطئة!', '');
      }
    });
    return;
  }

  // Logged in - show dashboard
  const students = storage.getStudents();
  const profile = storage.getProfile();
  const progress = storage.getProgress();
  const skills = storage.getSkillData();
  const avgPct = progress.totalAnswered > 0 ? Math.round((progress.totalCorrect / progress.totalAnswered) * 100) : 0;

  let studentsTable = '';
  if (students.length > 0) {
    studentsTable = `<div class="teacher-table-wrap"><table class="teacher-table">
      <thead><tr><th>الاسم</th><th>الصف</th><th>النصوص</th><th>المعدل</th><th>XP</th><th>آخر نشاط</th></tr></thead>
      <tbody>`;
    students.forEach(s => {
      const avg = s.totalAnswered > 0 ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0;
      studentsTable += `<tr><td>${s.name}</td><td>${s.className}</td><td>${s.textsCompleted}</td><td>${avg}%</td><td>${s.xp}</td><td>${ui.formatDate(s.lastActive)}</td></tr>`;
    });
    studentsTable += '</tbody></table></div>';
  }

  // Current student skills
  let skillsTable = '';
  for (let i = 1; i <= 15; i++) {
    const m = skills[i]?.mastery || 0;
    skillsTable += `<tr><td>${i}. ${ui.getSkillName(i)}</td><td style="color:${ui.getMasteryColor(m)};font-weight:700">${m}%</td></tr>`;
  }

  const currentPlayersCount = storage.getPlayersCount();

  c.innerHTML = `
    <div class="teacher-panel">
      <h2>${ICONS.cap} لوحة المعلم</h2>

      <div class="teacher-section">
        <h3>${ICONS.users} عداد الطلاب في الصفحة الرئيسية</h3>
        <p style="color:var(--muted);font-size:0.88rem;margin-bottom:12px">هذا الرقم يظهر للطلاب في الصفحة الرئيسية كدافع. حدّثه يدوياً كلما زاد عدد من جرّب اللعبة.</p>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="number" id="inp-players-count" class="input-field" value="${currentPlayersCount}" min="0" style="max-width:130px;text-align:center;font-size:1.1rem;font-weight:700">
          <button class="btn btn-primary" id="btn-save-players">حفظ</button>
          ${currentPlayersCount > 0 ? `<span style="color:var(--muted);font-size:0.85rem">يظهر حالياً: <strong>${currentPlayersCount} طالب جرّب</strong></span>` : '<span style="color:var(--muted);font-size:0.85rem">لا يظهر حتى تضع رقماً أكبر من 0</span>'}
        </div>
      </div>

      <div class="teacher-section">
        <h3>الطالب الحالي</h3>
        <p><strong>الاسم:</strong> ${profile?.name || 'لا يوجد'} | <strong>الصف:</strong> ${profile?.className || '-'}</p>
        <p><strong>XP:</strong> ${progress.xp} | <strong>المستوى:</strong> ${progress.level} | <strong>النصوص:</strong> ${progress.textsCompleted} | <strong>المعدل:</strong> ${avgPct}%</p>
      </div>

      <div class="teacher-section">
        <h3>المهارات</h3>
        <div class="teacher-table-wrap"><table class="teacher-table"><thead><tr><th>المهارة</th><th>الإتقان</th></tr></thead><tbody>${skillsTable}</tbody></table></div>
      </div>

      ${students.length > 0 ? '<div class="teacher-section"><h3>سجل الطلاب</h3>' + studentsTable + '</div>' : ''}

      <div class="teacher-actions">
        <button class="btn btn-primary" id="btn-export-csv">تصدير CSV</button>
        <button class="btn btn-danger" id="btn-reset-student">إعادة تعيين الطالب</button>
        <button class="btn btn-outline" onclick="window.location.hash='#dashboard'">العودة</button>
      </div>
    </div>`;

  document.getElementById('btn-save-players')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('inp-players-count').value) || 0;
    storage.setPlayersCount(val);
    ui.showToast(val > 0 ? `تم الحفظ — سيظهر "${val} طالب جرّب" في الصفحة الرئيسية` : 'تم الإخفاء — لن يظهر العداد', 'success');
    renderTeacher();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
  document.getElementById('btn-reset-student')?.addEventListener('click', () => {
    if (confirm('هل أنت متأكد من مسح بيانات الطالب الحالي؟')) {
      storage.clearStudentData();
      ui.showToast('تم مسح البيانات', 'success');
      renderTeacher();
    }
  });
}

function exportCSV() {
  const students = storage.getStudents();
  const san = engine.sanitizeCSVCell;

  let csv = 'الاسم,الصف,التاريخ,';
  for (let i = 1; i <= 15; i++) csv += 'مهارة ' + i + ',';
  csv += 'المعدل,XP,النصوص\n';

  const addRow = (s) => {
    const avg = s.totalAnswered > 0 ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0;
    csv += san(s.name) + ',' + san(s.className) + ',' + san(ui.formatDate(s.lastActive || new Date().toISOString())) + ',';
    for (let i = 1; i <= 15; i++) csv += san((s.skills?.[i] || 0) + '%') + ',';
    csv += san(avg + '%') + ',' + san(s.xp) + ',' + san(s.textsCompleted) + '\n';
  };

  if (students.length > 0) {
    students.forEach(addRow);
  } else {
    // Export current student
    const profile = storage.getProfile();
    const progress = storage.getProgress();
    const skills = storage.getSkillData();
    if (profile) {
      addRow({
        name: profile.name, className: profile.className,
        totalCorrect: progress.totalCorrect, totalAnswered: progress.totalAnswered,
        xp: progress.xp, textsCompleted: progress.textsCompleted,
        skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, v.mastery])),
        lastActive: new Date().toISOString()
      });
    }
  }

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'تقرير_أبطال_القراءة.csv';
  link.click();
}

/* ============================== */
/*         ABOUT                  */
/* ============================== */
function renderAbout() {
  const c = document.getElementById('about-container');
  const slogan2 = CONFIG.slogans?.secondary || 'نقرأ لنفهم… نفهم لنتميز';
  const totalQ = TEXTS.reduce((s, t) => s + (t.questions?.length || 0), 0);

  let skillsGrid = '';
  SKILLS.forEach(s => {
    skillsGrid += `
      <div class="about-skill-card">
        <div class="asc-icon">${ICONS[s.icon] || ICONS.note}</div>
        <div class="asc-num">S${s.id}</div>
        <div class="asc-name">${s.name}</div>
      </div>`;
  });

  c.innerHTML = `
    <div class="about-hero">
      <div class="about-hero-bg" aria-hidden="true">
        <div class="hero-orb orb-1"></div>
        <div class="hero-orb orb-2"></div>
      </div>
      <div class="about-hero-content">
        <h1>أبطال القراءة</h1>
        <p class="about-hero-slogan">${slogan2}</p>
        <div class="about-hero-stats">
          <div class="ahs"><span class="ahs-val">${TEXTS.length}</span><span class="ahs-lbl">نصًا قرائيًا</span></div>
          <div class="ahs-div"></div>
          <div class="ahs"><span class="ahs-val">${totalQ}</span><span class="ahs-lbl">سؤالًا</span></div>
          <div class="ahs-div"></div>
          <div class="ahs"><span class="ahs-val">15</span><span class="ahs-lbl">مهارة</span></div>
        </div>
      </div>
    </div>

    <div class="page-inner">

      <div class="about-section">
        <div class="about-section-icon">${ICONS.info}</div>
        <div class="about-section-body">
          <h3>عن المبادرة</h3>
          <p>مبادرة تعليمية تفاعلية تُعنى بتنمية مهارات القراءة والفهم القرائي لدى طلاب الصف السادس الابتدائي؛ استعدادًا للاختبارات الوطنية (نافس)، نفّذها معلمو اللغة العربية في ابتدائية الإمام عاصم لتحفيظ القرآن الكريم بمحافظة شقراء، تحت إشراف ومتابعة مدير المدرسة ومشرفي دعم التميز.</p>
        </div>
      </div>

      <div class="about-skills-section">
        <h3 class="about-skills-title">${ICONS.target} المهارات الـ 15</h3>
        <div class="about-skills-grid">${skillsGrid}</div>
      </div>

      <div class="about-footer-card">
        <div class="about-hero-bg" aria-hidden="true"><div class="hero-orb orb-1"></div><div class="hero-orb orb-2"></div></div>
        <img src="assets/logo-school.png" alt="شعار المدرسة" class="afc-logo">
      </div>

    </div>
  `;
}

/* ============================== */
/*       LEADERBOARD              */
/* ============================== */
async function renderLeaderboard() {
  const c = document.getElementById('leaderboard-container');
  if (!c) return;
  const profile = storage.getProfile();

  // Show loading
  c.innerHTML = `
    <div class="lb-hero">
      <div class="about-hero-bg" aria-hidden="true"><div class="hero-orb orb-1"></div><div class="hero-orb orb-2"></div><div class="hero-orb orb-3"></div></div>
      <div class="lb-hero-content">
        <h2>لوحة المتصدرين</h2>
        <p>جارٍ تحميل البيانات...</p>
      </div>
    </div>
    <div class="page-inner"><div class="lb-loading"><div class="lb-spinner"></div></div></div>`;

  // Fetch from Firestore (fallback to localStorage)
  let sorted = await fetchLeaderboard(10);

  if (!sorted) {
    // Firestore failed — fallback to local data
    let local = storage.getStudents();
    const progress = storage.getProgress();
    if (profile) {
      const idx = local.findIndex(s => s.name === profile.name && s.className === profile.className);
      const fresh = { name: profile.name, className: profile.className, xp: progress.xp, level: progress.level, textsCompleted: progress.textsCompleted, totalCorrect: progress.totalCorrect, totalAnswered: progress.totalAnswered };
      if (idx >= 0) local[idx] = { ...local[idx], ...fresh };
      else local = [...local, fresh];
    }
    sorted = [...local].sort((a, b) => (b.xp || 0) - (a.xp || 0)).slice(0, 10);
  }

  if (sorted.length === 0) {
    c.innerHTML = `
      <div class="lb-hero">
        <div class="about-hero-bg" aria-hidden="true"><div class="hero-orb orb-1"></div><div class="hero-orb orb-2"></div></div>
        <div class="lb-hero-content"><h2>لوحة المتصدرين</h2><p>أفضل 10 أبطال قراءة</p></div>
      </div>
      <div class="page-inner"><div class="lb-empty">${ICONS.star}<p>لا توجد بيانات بعد.<br>العب وحل الأسئلة لتظهر هنا!</p></div></div>`;
    return;
  }

  // Build podium for top 3 (order: 2nd, 1st, 3rd)
  const podiumOrder = [1, 0, 2];
  const rankLabels = ['الأول', 'الثاني', 'الثالث'];
  let podiumHTML = '';
  podiumOrder.forEach(pi => {
    if (pi >= sorted.length) return;
    const s = sorted[pi];
    const isMe = profile && s.name === profile.name && s.className === profile.className;
    podiumHTML += `
      <div class="podium-card podium-${pi + 1} ${isMe ? 'podium-me' : ''}">
        <div class="podium-avatar-wrap">
          <div class="podium-avatar">${s.name.charAt(0)}</div>
          <span class="podium-rank-badge">${pi + 1}</span>
        </div>
        <div class="podium-name">${s.name}${isMe ? ' <span class="lb-you-tag">أنت</span>' : ''}</div>
        <div class="podium-class">${s.className}</div>
        <div class="podium-xp">${ICONS.star} ${s.xp || 0} XP</div>
        <div class="podium-rank-label">${rankLabels[pi]}</div>
      </div>`;
  });

  // Rows for 4th+
  let rows = '';
  sorted.slice(3).forEach((s, idx) => {
    const rank = idx + 4;
    const avg = s.totalAnswered > 0 ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0;
    const isMe = profile && s.name === profile.name && s.className === profile.className;
    rows += `
      <div class="lb-row ${isMe ? 'lb-me' : ''}">
        <div class="lb-rank-col"><span class="lb-num">${rank}</span></div>
        <div class="lb-avatar-col"><div class="lb-avatar">${s.name.charAt(0)}</div></div>
        <div class="lb-info-col">
          <div class="lb-name">${s.name} ${isMe ? '<span class="lb-you-tag">أنت</span>' : ''}</div>
          <div class="lb-class">${s.className} · ${s.textsCompleted || 0} نص · ${avg}%</div>
        </div>
        <div class="lb-xp-col">
          <span class="lb-xp-val">${s.xp || 0}</span>
          <span class="lb-xp-lbl">XP</span>
        </div>
      </div>`;
  });

  c.innerHTML = `
    <div class="lb-hero">
      <div class="about-hero-bg" aria-hidden="true">
        <div class="hero-orb orb-1"></div>
        <div class="hero-orb orb-2"></div>
        <div class="hero-orb orb-3"></div>
      </div>
      <div class="lb-hero-content">
        <h2>لوحة المتصدرين</h2>
        <p>أفضل ${sorted.length} من أبطال القراءة</p>
      </div>
      <div class="podium-section">${podiumHTML}</div>
    </div>
    <div class="page-inner">
      ${rows ? `<div class="lb-list">${rows}</div>` : ''}
      <div style="text-align:center;margin-top:20px">
        <button class="btn btn-primary" onclick="window.location.hash='#dashboard'">${ICONS.bolt} العودة للرئيسية</button>
      </div>
    </div>`;
}

/* ============================== */
/*         ROUTER                 */
/* ============================== */
function _resetAuthForms() {
  const btnLogin = document.getElementById('btn-login');
  const btnReg = document.getElementById('btn-register');
  if (btnLogin) { btnLogin.disabled = false; btnLogin.textContent = 'تسجيل الدخول'; }
  if (btnReg) { btnReg.disabled = false; btnReg.textContent = 'إنشاء الحساب'; }
  ['login-error', 'reg-error', 'reset-error', 'reset-success'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // إظهار بطاقة تسجيل الدخول كافتراضي
  ['auth-login', 'auth-register', 'auth-reset'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === 'auth-login') ? '' : 'none';
  });
}

function handleRoute(route) {
  // تنظيف اللعبة عند مغادرة صفحة اللعب
  if (route.page !== 'play') cleanupGame();
  // تنظيف التحدي عند مغادرة صفحاته
  if (route.page !== 'play' && route.page !== 'challenge' && route.page !== 'challenge-room' && route.page !== 'challenge-result') {
    challenge.leaveRoom();
  }

  if (!dataLoaded && route.page !== 'home') {
    window.location.hash = '#home';
    return;
  }

  // الصفحات التي تحتاج تسجيل دخول
  const authRequired = ['dashboard', 'play', 'skills', 'texts', 'report', 'profile', 'certificate', 'challenge', 'challenge-room', 'challenge-result'];
  if (authRequired.includes(route.page) && !currentUID) {
    window.location.hash = '#onboarding';
    return;
  }

  switch (route.page) {
    case 'home':
      if (!currentUID || !storage.getProfile()) { window.location.hash = '#onboarding'; return; }
      showPage('home');
      renderHome();
      break;
    case 'onboarding':
      if (currentUID && storage.getProfile()) { window.location.hash = '#dashboard'; return; }
      showPage('onboarding');
      _resetAuthForms();
      break;
    case 'dashboard':
      showPage('dashboard');
      renderDashboard();
      break;
    case 'play':
      startGame(route.param || 'practice', route.sub);
      break;
    case 'skills':
      showPage('skills');
      renderSkillSelect();
      break;
    case 'texts':
      showPage('texts');
      renderTextsGrid(route.param);
      break;
    case 'report':
      showPage('report');
      break;
    case 'profile':
      showPage('profile');
      renderProfile();
      break;
    case 'certificate':
      showPage('certificate');
      renderCertificate();
      break;
    case 'verify':
      showPage('verify');
      renderVerify();
      break;
    case 'teacher':
      showPage('teacher');
      renderTeacher();
      break;
    case 'leaderboard':
      showPage('leaderboard');
      renderLeaderboard();
      break;
    case 'about':
      showPage('about');
      renderAbout();
      break;
    case 'challenge':
      if (route.param === 'join') {
        showPage('challenge-room');
        challenge.renderJoinRoom();
      } else if (route.param === 'create') {
        showPage('challenge-room');
        challenge.renderCreateRoom();
      } else if (route.param === 'room') {
        showPage('challenge-room');
        challenge.renderWaitingRoom(route.sub);
      } else {
        showPage('challenge');
        challenge.renderChallengeLobby();
      }
      break;
    case 'challenge-result':
      showPage('challenge-result');
      break;
    default:
      if (!currentUID || !storage.getProfile()) { window.location.hash = '#onboarding'; return; }
      showPage('home');
      renderHome();
  }
}

/* ============================== */
/*         INIT                   */
/* ============================== */
function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  // انتظر ثانية ونصف بعد ظهور الشعار ثم أخفِ الشاشة
  setTimeout(() => {
    splash.classList.add('splash-hide');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  }, 1500);
}

async function init() {
  await loadData();
  if (!dataLoaded) { hideSplash(); return; }

  applyBranding();
  hideSplash();

  // Challenge module setup
  challenge.setTexts(TEXTS);
  challenge.setCallbacks(
    // onStartGame: start challenge game on play page
    (cGame) => {
      cleanupGame();
      currentGame = {
        mode: 'challenge',
        text: cGame.text,
        questions: cGame.questions,
        currentQ: 0,
        answers: [],
        score: 0,
        startTime: Date.now(),
        timer: null,
        timerSeconds: 0,
        questionTimer: null,
        questionSeconds: 0
      };
      showPage('play');
      document.getElementById('memory-reading-overlay').style.display = 'none';
      document.getElementById('play-timer').style.display = 'none';
      document.getElementById('opponent-bar').style.display = 'flex';
      renderPlayScreen();
    },
    // onSyncCloud
    () => syncLocalToCloud()
  );

  // Auth views (login/register/reset)
  setupAuthViews();

  // Play controls
  document.getElementById('btn-next-q')?.addEventListener('click', nextQuestion);
  document.getElementById('toggle-text-btn')?.addEventListener('click', () => {
    const panel = document.getElementById('play-text-panel');
    const btn = document.getElementById('toggle-text-btn');
    panel.classList.toggle('text-collapsed');
    btn.textContent = panel.classList.contains('text-collapsed') ? 'إظهار النص' : 'إخفاء النص';
  });
  document.getElementById('btn-back-play')?.addEventListener('click', () => {
    if (currentGame?.mode === 'challenge') {
      challenge.leaveRoom();
    }
    window.location.hash = '#dashboard';
  });

  // Filters
  document.getElementById('filter-difficulty')?.addEventListener('change', renderTextsGrid);
  document.getElementById('filter-genre')?.addEventListener('change', renderTextsGrid);

  // Resume audio on first click
  document.addEventListener('click', () => ui.resumeAudio(), { once: true });

  // Firebase Auth state listener
  let routerInitialized = false;
  onAuthChange(async (user) => {
    if (user) {
      currentUID = user.uid;
      const pulled = await pullCloudToLocal(user.uid);
      // Fallback: لو ما لقينا بيانات في Firestore، نستخدم بيانات Auth
      if (!pulled && !storage.getProfile()) {
        const name = user.displayName || 'طالب';
        storage.setProfile({ name, className: 'غير محدد' });
        storage.setProgress({ xp: 0, level: 1, textsCompleted: 0, totalCorrect: 0, totalAnswered: 0 });
        // نحاول ننشئ الـ doc في Firestore
        pushUserData(user.uid, { name, className: 'غير محدد', xp: 0, level: 1, textsCompleted: 0, totalCorrect: 0, totalAnswered: 0 });
      }
      updateHeaderXP();
      // Show splash ad once per user
      if (!localStorage.getItem('rh_ad_seen')) {
        const adOverlay = document.getElementById('splash-ad');
        if (adOverlay) {
          adOverlay.style.display = 'flex';
          const dismiss = () => {
            adOverlay.style.display = 'none';
            localStorage.setItem('rh_ad_seen', '1');
          };
          document.getElementById('splash-ad-close').onclick = dismiss;
          document.getElementById('splash-ad-skip').onclick = dismiss;
        }
      }
      // إذا كان على التسجيل → حوّل للهوم (يشوف بياناته)
      const hash = window.location.hash.replace('#', '').split('/')[0];
      if (!hash || hash === 'onboarding') {
        window.location.hash = '#home';
      }
    } else {
      currentUID = null;
      storage.clearStudentData();
      const hash = window.location.hash.replace('#', '').split('/')[0];
      if (hash && hash !== 'home' && hash !== 'onboarding' && hash !== 'teacher' && hash !== 'verify' && hash !== 'about' && hash !== 'leaderboard') {
        window.location.hash = '#home';
      }
    }
    // تهيئة الراوتر مرة واحدة بعد أول فحص Auth
    if (!routerInitialized) {
      routerInitialized = true;
      initRouter(handleRoute);
    }
  });
}

init();
