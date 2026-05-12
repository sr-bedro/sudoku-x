const socket = io();
sessionStorage.clear();

const btnCreate  = document.getElementById('btn-create');
const btnCustom  = document.getElementById('btn-custom');
const btnJoin    = document.getElementById('btn-join');
const codeInput  = document.getElementById('room-code-input');
const errorDiv   = document.getElementById('error-message');

// Tablero aleatorio
btnCreate.addEventListener('click', () => socket.emit('create-room'));

// Tablero propio → vamos a la página de diseño
btnCustom.addEventListener('click', () => {
  window.location.href = '/create-board.html';
});

// Unirse
btnJoin.addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (code.length !== 4) { showError('El código debe tener 4 caracteres'); return; }
  socket.emit('join-room', code);
});

socket.on('room-created', ({ code, board, playerIndex }) => {
  sessionStorage.setItem('roomCode', code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board', JSON.stringify(board));
  window.location.href = '/game.html';
});

socket.on('room-joined', ({ code, board, playerIndex }) => {
  sessionStorage.setItem('roomCode', code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board', JSON.stringify(board));
  window.location.href = '/game.html';
});

socket.on('error', (msg) => showError(msg));

function showError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
  setTimeout(() => errorDiv.classList.add('hidden'), 3000);
}
