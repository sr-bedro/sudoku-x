const socket   = io();
const SAVE_KEY = 'sudokuX_savedGame';

// ---- DOM ----
const nameInput      = document.getElementById('player-name');
const btnCreate      = document.getElementById('btn-create');
const btnCustom      = document.getElementById('btn-custom');
const btnJoin        = document.getElementById('btn-join');
const btnContinue    = document.getElementById('btn-continue');
const codeInput      = document.getElementById('room-code-input');
const errorDiv       = document.getElementById('error-message');
const continueCard   = document.getElementById('continue-card');
const continueMeta   = document.getElementById('continue-meta');
const diffOpts       = document.querySelectorAll('.diff-opt');
const themeToggle    = document.getElementById('theme-toggle');
const themeIcon      = document.getElementById('theme-icon');

// ---- Tema ----
const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.body.dataset.theme;
  const next    = current === 'light' ? 'dark' : current === 'dark' ? 'ocean' : 'light';
  applyTheme(next);
  localStorage.setItem('theme', next);
});

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const icons = { light: '🌙', dark: '🌊', ocean: '☀️' };
  if (themeIcon) themeIcon.textContent = icons[theme] || '🌙';
}

// ---- Nombre ----
const savedName = localStorage.getItem('playerName') || '';
if (savedName) nameInput.value = savedName;
nameInput.addEventListener('input', () => {
  localStorage.setItem('playerName', nameInput.value.trim());
});

function getPlayerName() {
  return nameInput.value.trim() || 'Anónimo';
}

// ---- Dificultad ----
let selectedDiff = localStorage.getItem('difficulty') || 'hard';
diffOpts.forEach(btn => {
  if (btn.dataset.diff === selectedDiff) btn.classList.add('active');
  else btn.classList.remove('active');

  btn.addEventListener('click', () => {
    diffOpts.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDiff = btn.dataset.diff;
    localStorage.setItem('difficulty', selectedDiff);
  });
});

// ---- Continuar partida ----
const saved = (() => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
})();

if (saved && saved.playerIndex === 0 && saved.board && saved.solution) {
  continueCard.classList.remove('hidden');
  const fecha  = saved.savedAt || '';
  const tiempo = saved.elapsedFormatted || '00:00';
  continueMeta.textContent = `${fecha} · ${tiempo}`;
}

btnContinue && btnContinue.addEventListener('click', () => {
  if (!saved) return;
  setLoading(btnContinue, true);
  socket.emit('create-room-from-save', {
    board:      saved.board,
    solution:   saved.solution,
    playerName: getPlayerName(),
    elapsed:    saved.elapsed,
    difficulty: saved.difficulty,
  });
});

// ---- Nueva sala ----
btnCreate.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  setLoading(btnCreate, true);
  socket.emit('create-room', { difficulty: selectedDiff, playerName: getPlayerName() });
});

// ---- Tablero propio ----
btnCustom.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  window.location.href = '/create-board.html';
});

// ---- Unirse ----
btnJoin.addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (code.length !== 4) { showError('El código debe tener 4 caracteres'); return; }
  setLoading(btnJoin, true);
  socket.emit('join-room', { code, playerName: getPlayerName() });
});

codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnJoin.click();
});

// Auto-mayúsculas en el código
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase();
});

// ---- Respuestas del servidor ----
socket.on('room-created', ({ code, board, solution, playerIndex, savedElapsed }) => {
  sessionStorage.setItem('roomCode',     code);
  sessionStorage.setItem('playerIndex',  playerIndex);
  sessionStorage.setItem('board',        JSON.stringify(board));
  sessionStorage.setItem('solution',     JSON.stringify(solution));
  sessionStorage.setItem('playerName',   getPlayerName());
  sessionStorage.setItem('theme',        document.body.dataset.theme);
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
  setLoading(btnCreate, false);
  setLoading(btnJoin, false);
  btnContinue && setLoading(btnContinue, false);
});

// ---- Helpers ----
function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.classList.remove('hidden');
  setTimeout(() => errorDiv.classList.add('hidden'), 3000);
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled  = true;
  } else {
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    btn.disabled  = false;
  }
}
