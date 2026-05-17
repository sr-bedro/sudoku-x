const socket   = io();
const SAVE_KEY = 'sudokuX_savedGame';
const STATS_KEY = 'sudokuX_stats';

// ============================================================
// NAVEGACIÓN — bottom tabs
// ============================================================

const navBtns = document.querySelectorAll('.nav-btn');
const views   = document.querySelectorAll('.view');

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    navBtns.forEach(b => b.classList.remove('active'));
    views.forEach(v => v.classList.remove('active-view'));
    btn.classList.add('active');
    document.getElementById(`view-${tab}`).classList.add('active-view');
    if (tab === 'perfil') renderProfile();
  });
});

// ============================================================
// TEMA
// ============================================================

const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);

document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyTheme(btn.dataset.theme);
    localStorage.setItem('theme', btn.dataset.theme);
  });
});

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.querySelectorAll('.theme-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

// ============================================================
// NOMBRE DEL JUGADOR
// ============================================================

const nameInput = document.getElementById('player-name');
const savedName = localStorage.getItem('playerName') || '';
if (nameInput && savedName) nameInput.value = savedName;

nameInput && nameInput.addEventListener('input', () => {
  const name = nameInput.value.trim();
  localStorage.setItem('playerName', name);
  updateProfileAvatar(name);
});

function getPlayerName() {
  const n = nameInput ? nameInput.value.trim() : '';
  return n || localStorage.getItem('playerName') || 'Anónimo';
}

function updateProfileAvatar(name) {
  const av = document.getElementById('profile-avatar');
  if (av) av.textContent = name ? name[0].toUpperCase() : '?';
}

updateProfileAvatar(savedName);

// ============================================================
// ESTADÍSTICAS
// ============================================================

function getStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || {
      wins: 0, totalErrors: 0, bestTime: null, streak: 0, history: []
    };
  } catch { return { wins: 0, totalErrors: 0, bestTime: null, streak: 0, history: [] }; }
}

function renderProfile() {
  const stats = getStats();
  document.getElementById('stat-wins').textContent   = stats.wins || 0;
  document.getElementById('stat-streak').textContent = stats.streak || 0;
  document.getElementById('stat-errors').textContent = stats.totalErrors || 0;

  const best = stats.bestTime;
  document.getElementById('stat-best').textContent = best ? formatTime(best) : '--:--';

  // Historial
  const list = document.getElementById('history-list');
  if (!stats.history || stats.history.length === 0) {
    list.innerHTML = '<div class="history-empty">Aún no jugaste ninguna partida</div>';
  } else {
    list.innerHTML = stats.history.slice(0, 10).map(h => `
      <div class="history-item">
        <div class="history-left">
          <span class="history-diff ${h.difficulty}">${h.difficulty || 'difícil'}</span>
          <span class="history-date">${h.date || ''}</span>
        </div>
        <div class="history-right">
          <span class="history-time">⏱ ${formatTime(h.elapsed)}</span>
          <span class="history-errors">✕ ${h.errors || 0}</span>
        </div>
      </div>
    `).join('');
  }

  // Badge de racha
  const streak = stats.streak || 0;
  const badge = document.getElementById('streak-badge');
  const count = document.getElementById('streak-count');
  if (badge && streak > 0) {
    badge.classList.remove('hidden');
    if (count) count.textContent = streak;
  }
}

function formatTime(s) {
  if (!s && s !== 0) return '--:--';
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

// ============================================================
// CONTINUAR PARTIDA
// ============================================================

const saved = (() => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
})();

if (saved && saved.board && saved.solution) {
  const card = document.getElementById('continue-card');
  const meta = document.getElementById('continue-meta');
  if (card) card.classList.remove('hidden');
  if (meta) meta.textContent = `${saved.savedAt || ''} · ${saved.elapsedFormatted || '00:00'}`;
}

document.getElementById('btn-continue') && document.getElementById('btn-continue').addEventListener('click', () => {
  if (!saved) return;
  setLoading(document.getElementById('btn-continue'), true);
  socket.emit('create-room-from-save', {
    board:      saved.board,
    solution:   saved.solution,
    playerName: getPlayerName(),
    elapsed:    saved.elapsed,
    difficulty: saved.difficulty,
  });
});

// ============================================================
// BOTTOM SHEET — Nuevo Juego
// ============================================================

const sheet        = document.getElementById('nuevo-juego-sheet');
const sheetOverlay = document.getElementById('nuevo-juego-overlay');
const sheetSub     = document.getElementById('sheet-sub');

document.getElementById('btn-nuevo-juego').addEventListener('click', () => {
  openSheet();
});

sheetOverlay.addEventListener('click', closeSheet);

function openSheet() {
  sheet.classList.remove('hidden');
  sheetOverlay.classList.remove('hidden');
  setTimeout(() => {
    sheet.classList.add('sheet-open');
    sheetOverlay.classList.add('overlay-open');
  }, 10);
}

function closeSheet() {
  sheet.classList.remove('sheet-open');
  sheetOverlay.classList.remove('overlay-open');
  setTimeout(() => {
    sheet.classList.add('hidden');
    sheetOverlay.classList.add('hidden');
  }, 300);
}

// Seleccionar dificultad en el sheet
document.querySelectorAll('.diff-list-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const diff = btn.dataset.diff;
    closeSheet();
    setTimeout(() => {
      localStorage.removeItem(SAVE_KEY);
      localStorage.setItem('difficulty', diff);
      setLoading(document.getElementById('btn-nuevo-juego'), true);
      socket.emit('create-room', { difficulty: diff, playerName: getPlayerName() });
    }, 320);
  });
});

// ============================================================
// UNIRSE A SALA
// ============================================================

const codeInput = document.getElementById('room-code-input');
const btnJoin   = document.getElementById('btn-join');

btnJoin.addEventListener('click', () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) { showError('El código debe tener 4 caracteres'); return; }
  setLoading(btnJoin, true);
  socket.emit('join-room', { code, playerName: getPlayerName() });
});

codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

// ============================================================
// TABLERO PROPIO
// ============================================================

document.getElementById('btn-custom').addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  window.location.href = '/create-board.html';
});

// ============================================================
// RESPUESTAS DEL SERVIDOR
// ============================================================

socket.on('room-created', ({ code, board, solution, playerIndex, savedElapsed }) => {
  sessionStorage.setItem('roomCode',    code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board',       JSON.stringify(board));
  sessionStorage.setItem('solution',    JSON.stringify(solution));
  sessionStorage.setItem('playerName',  getPlayerName());
  sessionStorage.setItem('theme',       document.body.dataset.theme);
  sessionStorage.setItem('difficulty',  localStorage.getItem('difficulty') || 'hard');
  if (savedElapsed) sessionStorage.setItem('savedElapsed', savedElapsed);
  window.location.href = '/game.html';
});

socket.on('room-joined', ({ code, board, playerIndex }) => {
  sessionStorage.setItem('roomCode',    code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board',       JSON.stringify(board));
  sessionStorage.setItem('playerName',  getPlayerName());
  sessionStorage.setItem('theme',       document.body.dataset.theme);
  window.location.href = '/game.html';
});

socket.on('error', (msg) => {
  showError(msg);
  setLoading(btnJoin, false);
  setLoading(document.getElementById('btn-nuevo-juego'), false);
});

// ============================================================
// HELPERS
// ============================================================

function showError(msg) {
  const el = document.getElementById('error-message');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled  = true;
  } else {
    btn.innerHTML = btn.dataset.orig || btn.innerHTML;
    btn.disabled  = false;
  }
}

// ---- Tab batalla → redirige a battle.html ----
const batallaBtnInNav = document.querySelector('[data-tab="batalla"]');
if (batallaBtnInNav) {
  batallaBtnInNav.addEventListener('click', (e) => {
    e.stopImmediatePropagation(); // Cancelar el handler de tab normal
    window.location.href = '/battle.html';
  }, true); // capture = true para que corra antes que el handler genérico
}
