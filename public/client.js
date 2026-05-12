// ============================================================
// SESIÓN
// ============================================================

const roomCode    = sessionStorage.getItem('roomCode');
const playerIndex = parseInt(sessionStorage.getItem('playerIndex'));
let   board       = JSON.parse(sessionStorage.getItem('board'));

if (!roomCode) window.location.href = '/';

// ============================================================
// ESTADO
// ============================================================

let selectedRow = -1;
let selectedCol = -1;
let noteMode    = false;
let gameStarted = false;
const undoStack = [];

// ============================================================
// SOCKET
// ============================================================

const socket = io();
socket.on('connect', () => {
  socket.emit('rejoin-room', { code: roomCode, playerIndex });
});

// ============================================================
// DOM
// ============================================================

const boardEl       = document.getElementById('board');
const displayCode   = document.getElementById('display-code');
const statusMessage = document.getElementById('status-message');
const winScreen     = document.getElementById('win-screen');
const winMessage    = document.getElementById('win-message');
const numBtns       = document.querySelectorAll('.num-btn');
const btnNote       = document.getElementById('btn-note');
const btnErase      = document.getElementById('btn-erase');
const btnUndo       = document.getElementById('btn-undo');

displayCode.textContent = roomCode;

// ============================================================
// LÁPIZ — toggle
// ============================================================

btnNote.addEventListener('click', () => {
  noteMode = !noteMode;
  btnNote.classList.toggle('active', noteMode);
  numBtns.forEach(btn => btn.classList.toggle('note-mode', noteMode));
});

// ============================================================
// BORRAR
// ============================================================

btnErase.addEventListener('click', () => {
  if (selectedRow === -1) return;
  if (board[selectedRow][selectedCol].fixed) return;
  socket.emit('make-move', { row: selectedRow, col: selectedCol, value: 0 });
});

// ============================================================
// DESHACER
// ============================================================

btnUndo.addEventListener('click', () => {
  if (undoStack.length === 0) return;
  const last = undoStack[undoStack.length - 1];
  socket.emit('undo-move', {
    row: last.row, col: last.col,
    prevValue: last.prevValue, prevNotes: last.prevNotes, prevPlayer: last.prevPlayer,
  });
});

// ============================================================
// NUMPAD
// ============================================================

numBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (selectedRow === -1) return;
    const value = parseInt(btn.dataset.num);
    if (noteMode) {
      socket.emit('make-note', { row: selectedRow, col: selectedCol, num: value });
    } else {
      socket.emit('make-move', { row: selectedRow, col: selectedCol, value });
    }
  });
});

// ============================================================
// RENDERIZAR TABLERO
// ============================================================

function renderBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      const el   = document.createElement('div');
      el.className   = 'cell';
      el.dataset.row = r;
      el.dataset.col = c;
      if (r === c || r + c === 8) el.classList.add('diagonal');
      if (cell.fixed)              el.classList.add('fixed');
      setCellContent(el, cell);
      el.addEventListener('click', () => onCellClick(r, c));
      boardEl.appendChild(el);
    }
  }
  applyHighlights();
  updateNumpadCounts();
}

// ============================================================
// CONTENIDO DE CELDA
// ============================================================

function setCellContent(el, cell) {
  el.innerHTML   = '';
  el.style.color = '';
  if (cell.value !== 0) {
    el.textContent = cell.value;
    if (!cell.fixed && cell.player) el.style.color = cell.player;
  } else if (cell.notes && cell.notes.length > 0) {
    renderNotes(el, cell.notes);
  }
}

// ============================================================
// PENCIL MARKS
// ============================================================

function renderNotes(cellEl, notes) {
  const grid = document.createElement('div');
  grid.className = 'notes-grid';
  for (let n = 1; n <= 9; n++) {
    const span = document.createElement('span');
    span.className = 'note-num';
    if (notes.includes(n)) span.textContent = n;
    grid.appendChild(span);
  }
  cellEl.appendChild(grid);
}

// ============================================================
// SELECCIÓN Y RESALTADO
// ============================================================

function onCellClick(row, col) {
  selectedRow = row;
  selectedCol = col;
  applyHighlights();
}

function applyHighlights() {
  boardEl.querySelectorAll('.cell').forEach(el => {
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    el.classList.remove('selected', 'highlight', 'same-num');
    if (selectedRow === -1) return;

    const isSelected = r === selectedRow && c === selectedCol;
    const sameRow    = r === selectedRow;
    const sameCol    = c === selectedCol;
    const sameBox    = Math.floor(r/3) === Math.floor(selectedRow/3) &&
                       Math.floor(c/3) === Math.floor(selectedCol/3);

    if (isSelected) {
      el.classList.add('selected');
    } else if (sameRow || sameCol || sameBox) {
      el.classList.add('highlight');
    }

    const selVal = board[selectedRow][selectedCol].value;
    if (selVal !== 0 && board[r][c].value === selVal) {
      el.classList.add('same-num');
    }
  });
}

// ============================================================
// CONTADORES NUMPAD
// ============================================================

function updateNumpadCounts() {
  const counts = { 1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 };
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const v = board[r][c].value;
      if (v !== 0) counts[v]++;
    }
  numBtns.forEach(btn => {
    const num       = parseInt(btn.dataset.num);
    const countEl   = btn.querySelector('.num-count');
    const remaining = 9 - counts[num];
    if (countEl) countEl.textContent = remaining > 0 ? remaining : '';
    btn.classList.toggle('depleted', remaining === 0);
  });
}

function getCellEl(row, col) {
  return boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

// ============================================================
// EVENTOS DEL SERVIDOR
// ============================================================

socket.on('board-update', ({ row, col, value, playerColor, correct, notes, prevState }) => {
  if (prevState) undoStack.push({ row, col, ...prevState });

  board[row][col].value  = value;
  board[row][col].player = value === 0 ? null : playerColor;
  board[row][col].notes  = notes || [];

  const el = getCellEl(row, col);
  el.classList.remove('error', 'correct');
  el.innerHTML   = '';
  el.style.color = '';

  if (value !== 0) {
    el.textContent = value;
    // FIX: usamos playerColor del servidor directamente.
    // No comparamos con "myColor" — eso causaba que J2 siempre viera rojo.
    if (correct) {
      el.style.color = playerColor;
      el.classList.add('correct');
    } else {
      el.style.color = '#ef4444';
      el.classList.add('error');
    }
  }

  applyHighlights();
  updateNumpadCounts();
});

socket.on('note-update', ({ row, col, notes, prevNotes }) => {
  undoStack.push({
    row, col,
    prevValue:  board[row][col].value,
    prevPlayer: board[row][col].player,
    prevNotes,
  });
  board[row][col].notes = notes;
  const el = getCellEl(row, col);
  el.innerHTML = '';
  if (board[row][col].value === 0 && notes.length > 0) renderNotes(el, notes);
});

socket.on('undo-confirmed', ({ row, col, value, player, notes }) => {
  undoStack.pop();
  board[row][col].value  = value;
  board[row][col].player = player;
  board[row][col].notes  = notes || [];
  const el = getCellEl(row, col);
  el.classList.remove('error', 'correct');
  setCellContent(el, board[row][col]);
  applyHighlights();
  updateNumpadCounts();
});

socket.on('game-start', ({ board: newBoard }) => {
  board = newBoard; gameStarted = true;
  statusMessage.textContent = '¡Juego en curso! Trabajen juntos 🧩';
  renderBoard();
});

socket.on('game-won', () => {
  if (!gameStarted) return;
  winMessage.textContent = '¡Felicitaciones! Completaron el Sudoku X juntos. 🎉';
  winScreen.classList.remove('hidden');
});

socket.on('board-update-full', ({ board: newBoard }) => {
  board = newBoard;
  renderBoard();
});

socket.on('player-disconnected', () => {
  statusMessage.textContent = '⚠️ Tu compañero se desconectó';
  statusMessage.style.color = '#ef4444';
});

// ============================================================
// INIT
// ============================================================

if (board) renderBoard();
statusMessage.textContent = playerIndex === 0
  ? 'Sala creada. Compartí el código con tu compañero.'
  : '¡Conectado! El juego ya comenzó.';
