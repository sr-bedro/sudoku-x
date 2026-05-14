const socket    = io();
const SAVE_KEY  = 'sudokuX_savedGame';

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
const diffBtns       = document.querySelectorAll('.diff-btn');

// ---- Nombre guardado ----
const savedName = localStorage.getItem('playerName') || '';
if (savedName) nameInput.value = savedName;

nameInput.addEventListener('input', () => {
  localStorage.setItem('playerName', nameInput.value.trim());
});

function getPlayerName() {
  const name = nameInput.value.trim();
  return name || 'Anónimo';
}

// ---- Dificultad ----
let selectedDiff = 'hard';
diffBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    diffBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDiff = btn.dataset.diff;
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
  continueMeta.textContent = `${saved.savedAt} · ${saved.elapsedFormatted}`;
}

btnContinue && btnContinue.addEventListener('click', () => {
  if (!saved) return;
  const name = getPlayerName();
  socket.emit('create-room-from-save', {
    board:      saved.board,
    solution:   saved.solution,
    playerName: name,
    elapsed:    saved.elapsed,
  });
});

// ---- Nueva sala ----
btnCreate.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
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
  socket.emit('join-room', { code, playerName: getPlayerName() });
});

// También unirse al presionar Enter en el input
codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnJoin.click();
});

// ---- Respuestas ----
socket.on('room-created', ({ code, board, solution, playerIndex, savedElapsed }) => {
  sessionStorage.setItem('roomCode',    code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board',       JSON.stringify(board));
  sessionStorage.setItem('solution',    JSON.stringify(solution));
  sessionStorage.setItem('playerName',  getPlayerName());
  if (savedElapsed) sessionStorage.setItem('savedElapsed', savedElapsed);
  window.location.href = '/game.html';
});

socket.on('room-joined', ({ code, board, playerIndex }) => {
  sessionStorage.setItem('roomCode',    code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board',       JSON.stringify(board));
  sessionStorage.setItem('playerName',  getPlayerName());
  window.location.href = '/game.html';
});

socket.on('error', (msg) => showError(msg));

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.classList.remove('hidden');
  setTimeout(() => errorDiv.classList.add('hidden'), 3000);
}
