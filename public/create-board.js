// ============================================================
// ESTADO DEL TABLERO
// ============================================================

// puzzle: array 9x9 de números. 0 = vacío.
const puzzle = Array.from({ length: 9 }, () => Array(9).fill(0));

let selectedRow = -1;
let selectedCol = -1;

// ============================================================
// DOM
// ============================================================

const boardInputEl = document.getElementById('board-input');
const numBtns      = document.querySelectorAll('.create-num-btn');
const btnBack      = document.getElementById('btn-back');
const btnStart     = document.getElementById('btn-start');
const errorDiv     = document.getElementById('create-error');

// ============================================================
// SOCKET (solo para enviar el tablero cuando arranca)
// ============================================================

const socket = io();

// ============================================================
// CONSTRUIR LA GRILLA VISUAL
// ============================================================

function buildGrid() {
  boardInputEl.innerHTML = '';

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const el = document.createElement('div');
      el.className      = 'cell-input';
      el.dataset.row    = r;
      el.dataset.col    = c;

      // Diagonales del Sudoku X
      if (r === c || r + c === 8) el.classList.add('diagonal');

      // Mostrar número si ya hay uno cargado
      if (puzzle[r][c] !== 0) el.textContent = puzzle[r][c];

      el.addEventListener('click', () => onCellClick(r, c, el));
      boardInputEl.appendChild(el);
    }
  }
}

// ============================================================
// SELECCIÓN DE CELDA
// ============================================================

function onCellClick(row, col, el) {
  // Quitamos la clase activa de la celda anterior
  boardInputEl.querySelectorAll('.active-input').forEach(c => c.classList.remove('active-input'));

  selectedRow = row;
  selectedCol = col;
  el.classList.add('active-input');
}

// ============================================================
// NUMPAD — colocar o borrar número
// ============================================================

numBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (selectedRow === -1) return; // Ninguna celda seleccionada

    const num = parseInt(btn.dataset.num);
    puzzle[selectedRow][selectedCol] = num; // 0 = borrar

    // Actualizamos el texto de la celda en pantalla
    const cellEl = boardInputEl.querySelector(`[data-row="${selectedRow}"][data-col="${selectedCol}"]`);
    cellEl.textContent = num !== 0 ? num : '';

    hideError();
  });
});

// ============================================================
// VOLVER AL LOBBY
// ============================================================

btnBack.addEventListener('click', () => {
  window.location.href = '/';
});

// ============================================================
// EMPEZAR PARTIDA
// ============================================================

btnStart.addEventListener('click', () => {
  // Validación mínima: que haya al menos un número cargado
  const hasNumbers = puzzle.some(row => row.some(cell => cell !== 0));
  if (!hasNumbers) {
    showError('Cargá al menos un número en el tablero.');
    return;
  }

  // Enviamos el puzzle al servidor.
  // El servidor corre el solver para encontrar la solución
  // y crear la sala. Si no tiene solución, nos avisa.
  socket.emit('create-custom-room', puzzle);
});

// El servidor responde igual que con create-room
socket.on('room-created', ({ code, board, playerIndex }) => {
  sessionStorage.setItem('roomCode', code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board', JSON.stringify(board));
  window.location.href = '/game.html';
});

socket.on('error', (msg) => showError(msg));

// ============================================================
// ERROR
// ============================================================

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.classList.remove('hidden');
}

function hideError() {
  errorDiv.classList.add('hidden');
}

// ============================================================
// INIT
// ============================================================

buildGrid();
