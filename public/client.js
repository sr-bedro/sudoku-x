// ============================================================
// SESIÓN
// ============================================================
const SAVE_KEY     = 'sudokuX_savedGame';
const STATS_KEY    = 'sudokuX_stats';
const roomCode     = sessionStorage.getItem('roomCode');
const playerIndex  = parseInt(sessionStorage.getItem('playerIndex'));
const playerName   = sessionStorage.getItem('playerName') || (playerIndex === 0 ? 'J1' : 'J2');
const solution     = JSON.parse(sessionStorage.getItem('solution') || 'null');
let   board        = JSON.parse(sessionStorage.getItem('board'));
const savedElapsed = parseInt(sessionStorage.getItem('savedElapsed') || '0');
const savedTheme   = sessionStorage.getItem('theme') || localStorage.getItem('theme') || 'light';

if (!roomCode) window.location.href = '/';
const isHost = playerIndex === 0;

document.body.dataset.theme = savedTheme;

// ============================================================
// ESTADO
// ============================================================
let selectedRow    = -1;
let selectedCol    = -1;
let noteMode       = false;
let gameStarted    = false;
let soundEnabled   = localStorage.getItem('soundEnabled') !== 'false';
const undoStack    = [];
let opponentCursor = { row: -1, col: -1 };
let timerInterval  = null;
let startTime      = null;
let elapsedOffset  = savedElapsed;
let errorCount     = 0;
let difficulty     = sessionStorage.getItem('difficulty') || 'hard';
let soloMode       = true;

// ============================================================
// SOCKET
// ============================================================
const socket = io();
socket.on('connect', () => {
  socket.emit('rejoin-room', { code: roomCode, playerIndex, playerName });
});

// ============================================================
// DOM
// ============================================================
const boardEl       = document.getElementById('board');
const displayCode   = document.getElementById('display-code');
const statusMessage = document.getElementById('status-message');
const winScreen     = document.getElementById('win-screen');
const winTime       = document.getElementById('win-time');
const winErrors     = document.getElementById('win-errors');
const numBtns       = document.querySelectorAll('.num-btn');
const btnNote       = document.getElementById('btn-note');
const btnErase      = document.getElementById('btn-erase');
const btnUndo       = document.getElementById('btn-undo');
const btnSave       = document.getElementById('btn-save');
const btnHome       = document.getElementById('btn-home');
const btnSound      = document.getElementById('btn-sound');
const btnShare      = document.getElementById('btn-share');
const timerEl       = document.getElementById('timer');
const errorBadge    = document.getElementById('error-badge');
const errorCountEl  = document.getElementById('error-count');
const p1Name        = document.getElementById('p1-name');
const p2Name        = document.getElementById('p2-name');
const shareModal    = document.getElementById('share-modal');
const shareCodeBig  = document.getElementById('share-code-big');

if (displayCode) displayCode.textContent = roomCode;
if (shareCodeBig) shareCodeBig.textContent = roomCode;
updateSoundBtn();
document.addEventListener('click', () => { try { getCtx(); } catch(e){} }, { once: true });

// ============================================================
// COMPARTIR
// ============================================================
btnShare && btnShare.addEventListener('click', () => shareModal?.classList.remove('hidden'));

document.getElementById('share-close') && document.getElementById('share-close').addEventListener('click', () => {
  shareModal?.classList.add('hidden');
});

document.getElementById('share-whatsapp') && document.getElementById('share-whatsapp').addEventListener('click', () => {
  const msg = `¡Jugá Sudoku X conmigo! 🧩\nCódigo de sala: *${roomCode}*\nEntrá acá: ${window.location.origin}\n\n1. Abrí el link\n2. Poné tu nombre\n3. Tocá "Unirse" e ingresá el código: *${roomCode}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
});

document.getElementById('share-copy') && document.getElementById('share-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(`${window.location.origin}?code=${roomCode}`).then(() => {
    const btn = document.getElementById('share-copy');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copiado';
    setTimeout(() => btn.innerHTML = orig, 2000);
  }).catch(() => prompt('Copiá este link:', `${window.location.origin}?code=${roomCode}`));
});

shareModal && shareModal.addEventListener('click', e => { if (e.target === shareModal) shareModal.classList.add('hidden'); });

// ============================================================
// SONIDO
// ============================================================
function playSound(fn) { if (!soundEnabled) return; try { fn(); } catch(e) {} }

function updateSoundBtn() {
  if (!btnSound) return;
  btnSound.querySelector('.tool-icon').textContent  = soundEnabled ? '🔊' : '🔇';
  btnSound.querySelector('.tool-label').textContent = soundEnabled ? 'Sonido' : 'Mudo';
  btnSound.classList.toggle('muted', !soundEnabled);
}

btnSound && btnSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled);
  updateSoundBtn();
});

// ============================================================
// TIMER
// ============================================================
function startTimer(fromServerTime, offset = 0) {
  elapsedOffset = offset;
  startTime     = fromServerTime;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (timerEl) timerEl.textContent = formatTime(getCurrentElapsed());
  }, 1000);
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

function getCurrentElapsed() {
  if (!startTime) return elapsedOffset;
  return Math.floor((Date.now() - startTime) / 1000) + elapsedOffset;
}

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ============================================================
// ERRORES
// ============================================================
function updateErrorCount() {
  if (errorCountEl) errorCountEl.textContent = errorCount;
  if (errorBadge)   errorBadge.classList.toggle('has-errors', errorCount > 0);
}

// ============================================================
// GUARDAR
// ============================================================
function doSave() {
  if (!isHost || !gameStarted) return;
  const elapsed = getCurrentElapsed();
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    roomCode, playerIndex: 0, playerName, board, solution, difficulty,
    elapsed, elapsedFormatted: formatTime(elapsed),
    savedAt: new Date().toLocaleString(),
  }));
  playSound(soundSave);
  const toast = document.getElementById('save-toast');
  if (toast) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 2000); }
}

setInterval(doSave, 30000);
btnSave && btnSave.addEventListener('click', () => { if (isHost) doSave(); });

// ============================================================
// HOME
// ============================================================
btnHome && btnHome.addEventListener('click', () => {
  if (!gameStarted) { window.location.href = '/'; return; }
  const msg = isHost
    ? '¿Salir? La partida se guardará y el compañero será desconectado.'
    : '¿Salir? Solo el anfitrión puede continuar la partida guardada.';
  if (!confirm(msg)) return;
  if (isHost) { doSave(); socket.emit('host-leave'); }
  sessionStorage.clear();
  window.location.href = '/';
});

// ============================================================
// TOOLBAR
// ============================================================
btnNote && btnNote.addEventListener('click', () => {
  noteMode = !noteMode;
  btnNote.classList.toggle('active', noteMode);
  // Cambiar color de números del numpad en modo lápiz
  numBtns.forEach(b => b.classList.toggle('note-mode', noteMode));
  // Cambiar color de notas en el tablero
  boardEl && boardEl.classList.toggle('note-mode', noteMode);
  playSound(soundNote);
});

btnErase && btnErase.addEventListener('click', () => {
  if (selectedRow === -1 || !gameStarted) return;
  const cell = board[selectedRow][selectedCol];
  if (cell.fixed) return;

  if (cell.value !== 0) {
    // Borrar número — via servidor para sincronizar
    playSound(soundErase);
    socket.emit('make-move', { row: selectedRow, col: selectedCol, value: 0 });
  } else if (cell.notes && cell.notes.length > 0) {
    // Borrar notas — solo local (las notas son locales)
    cell.notes = [];
    const el = getCellEl(selectedRow, selectedCol);
    if (el) el.innerHTML = '';
    playSound(soundErase);
  }
});

btnUndo && btnUndo.addEventListener('click', () => {
  if (!undoStack.length || !gameStarted) return;
  const last = undoStack[undoStack.length - 1];
  playSound(soundUndo);
  socket.emit('undo-move', {
    row:       last.row,
    col:       last.col,
    prevValue: last.prevValue,
    prevNotes: last.prevNotes,
    prevPlayer: last.prevPlayer,
  });
});

// ============================================================
// CONFLICTOS PARA NOTAS
// ============================================================
function numConflictsForNote(row, col, num) {
  for (let c = 0; c < 9; c++) if (board[row][c].value === num) return true;
  for (let r = 0; r < 9; r++) if (board[r][col].value === num) return true;
  const br = Math.floor(row/3)*3, bc = Math.floor(col/3)*3;
  for (let r = br; r < br+3; r++) for (let c = bc; c < bc+3; c++) if (board[r][c].value === num) return true;
  if (row === col)   for (let i = 0; i < 9; i++) if (board[i][i].value === num) return true;
  if (row+col === 8) for (let i = 0; i < 9; i++) if (board[i][8-i].value === num) return true;
  return false;
}

// ============================================================
// NUMPAD + TECLADO
// ============================================================
numBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (selectedRow === -1 || !gameStarted) return;
    const value = parseInt(btn.dataset.num);
    if (noteMode) {
      if (board[selectedRow][selectedCol].fixed) return;
      if (board[selectedRow][selectedCol].value !== 0) return;
      // No agregar nota si el número ya existe en fila/col/caja/diagonal
      if (numConflictsForNote(selectedRow, selectedCol, value)) {
        playSound(soundBlocked);
        return;
      }
      socket.emit('make-note', { row: selectedRow, col: selectedCol, num: value });
    } else {
      socket.emit('make-move', { row: selectedRow, col: selectedCol, value });
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (!gameStarted) return;
  const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr, dc] = moves[e.key];
    const nr = Math.max(0, Math.min(8, (selectedRow < 0 ? 0 : selectedRow) + dr));
    const nc = Math.max(0, Math.min(8, (selectedCol < 0 ? 0 : selectedCol) + dc));
    onCellClick(nr, nc);
    return;
  }
  if (e.key >= '1' && e.key <= '9' && selectedRow !== -1) {
    const value = parseInt(e.key);
    if (noteMode) {
      if (!numConflictsForNote(selectedRow, selectedCol, value))
        socket.emit('make-note', { row: selectedRow, col: selectedCol, num: value });
    } else {
      socket.emit('make-move', { row: selectedRow, col: selectedCol, value });
    }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRow !== -1) {
    btnErase?.click(); return;
  }
  if (e.key === 'n' || e.key === 'N') btnNote?.click();
});

// ============================================================
// TABLERO
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
      if (cell.fixed) el.classList.add('fixed');
      setCellContent(el, cell);
      el.addEventListener('click', () => onCellClick(r, c));
      boardEl.appendChild(el);
    }
  }
  applyHighlights();
  updateNumpadCounts();
}

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
// SELECCIÓN Y HIGHLIGHTS — incluye diagonal X
// ============================================================
function onCellClick(row, col) {
  if (opponentCursor.row === row && opponentCursor.col === col) {
    const el = getCellEl(row, col);
    el && el.classList.add('blocked-flash');
    setTimeout(() => getCellEl(row, col)?.classList.remove('blocked-flash'), 400);
    playSound(soundBlocked);
    return;
  }
  playSound(soundCellSelect);
  selectedRow = row; selectedCol = col;
  if (!soloMode) socket.emit('cursor-move', { row, col });
  applyHighlights();
}

function applyHighlights() {
  boardEl.querySelectorAll('.cell').forEach(el => {
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    el.classList.remove('selected','highlight','same-num','opponent-cell','conflict');

    if (opponentCursor.row === r && opponentCursor.col === c) {
      el.classList.add('opponent-cell'); return;
    }

    if (selectedRow === -1) return;

    if (r === selectedRow && c === selectedCol) {
      el.classList.add('selected');
    } else {
      const sameRow = r === selectedRow;
      const sameCol = c === selectedCol;
      const sameBox = Math.floor(r/3) === Math.floor(selectedRow/3) && Math.floor(c/3) === Math.floor(selectedCol/3);
      // Resaltar la X: si la celda seleccionada está en una diagonal, resaltar toda esa diagonal
      const selOnMainDiag = selectedRow === selectedCol;
      const selOnAntiDiag = selectedRow + selectedCol === 8;
      const sameMD = selOnMainDiag && r === c;
      const sameAD = selOnAntiDiag && r + c === 8;

      if (sameRow || sameCol || sameBox || sameMD || sameAD) el.classList.add('highlight');
    }

    // Mismo número
    const selVal = board[selectedRow]?.[selectedCol]?.value;
    if (selVal && selVal !== 0 && board[r][c].value === selVal) {
      el.classList.add('same-num');
      // Conflicto
      if (r !== selectedRow || c !== selectedCol) {
        const conflict =
          r === selectedRow || c === selectedCol ||
          (Math.floor(r/3) === Math.floor(selectedRow/3) && Math.floor(c/3) === Math.floor(selectedCol/3)) ||
          (r === c && selectedRow === selectedCol) ||
          (r + c === 8 && selectedRow + selectedCol === 8);
        if (conflict) {
          el.classList.add('conflict');
          getCellEl(selectedRow, selectedCol)?.classList.add('conflict');
        }
      }
    }
  });
}

// ============================================================
// ANIMACIONES
// ============================================================
function animateSection(section) {
  const cells = [];
  if (section.type === 'row')
    for (let c = 0; c < 9; c++) cells.push(getCellEl(section.index, c));
  else if (section.type === 'col')
    for (let r = 0; r < 9; r++) cells.push(getCellEl(r, section.index));
  else
    for (let r = section.boxRow*3; r < section.boxRow*3+3; r++)
      for (let c = section.boxCol*3; c < section.boxCol*3+3; c++)
        cells.push(getCellEl(r, c));
  cells.forEach((el, i) => {
    if (!el) return;
    setTimeout(() => {
      el.classList.add('section-complete');
      setTimeout(() => el.classList.remove('section-complete'), 700);
    }, i * 45);
  });
}

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const pts = Array.from({length:150}, () => ({
    x: Math.random()*canvas.width, y: -10,
    w: Math.random()*10+5, h: Math.random()*6+3,
    color: ['#2563eb','#7c3aed','#f59e0b','#10b981','#ef4444','#ec4899'][Math.floor(Math.random()*6)],
    speed: Math.random()*3+2, angle: Math.random()*360, spin: Math.random()*6-3, drift: Math.random()*2-1,
  }));
  let n = 0;
  (function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height); n++;
    pts.forEach(p => {
      p.y+=p.speed; p.x+=p.drift; p.angle+=p.spin;
      ctx.save(); ctx.translate(p.x+p.w/2,p.y+p.h/2); ctx.rotate(p.angle*Math.PI/180);
      ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,1-n/200);
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    });
    if (n < 220) requestAnimationFrame(draw);
  })();
}

// ============================================================
// NUMPAD COUNTS
// ============================================================
function updateNumpadCounts() {
  const counts = {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0};
  for (let r=0; r<9; r++) for (let c=0; c<9; c++) { const v=board[r][c].value; if(v) counts[v]++; }
  numBtns.forEach(btn => {
    const num=parseInt(btn.dataset.num), rem=9-counts[num];
    const ce=btn.querySelector('.num-count');
    if(ce) ce.textContent = rem > 0 ? rem : '';
    btn.classList.toggle('depleted', rem===0);
  });
}

function getCellEl(row, col) {
  return boardEl?.querySelector(`[data-row="${row}"][data-col="${col}"]`);
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
  if (!el) return;

  // Limpiar completamente antes de actualizar
  el.classList.remove('error','correct','correct-flash','error-flash');
  el.style.color = '';
  el.innerHTML   = '';

  if (value !== 0) {
    el.textContent = value;
    if (correct) {
      el.style.color = playerColor;
      el.classList.add('correct');
      // Animación de correcto
      el.classList.remove('correct-flash');
      void el.offsetWidth;
      el.classList.add('correct-flash');
      setTimeout(() => el.classList.remove('correct-flash'), 500);
      playSound(soundCorrect);
    } else {
      el.style.color = '#ef4444';
      el.classList.add('error');
      // Animación de error
      el.classList.remove('error-flash');
      void el.offsetWidth;
      el.classList.add('error-flash');
      setTimeout(() => el.classList.remove('error-flash'), 400);
      errorCount++; updateErrorCount();
      playSound(soundError);
    }
  }

  applyHighlights();
  updateNumpadCounts();
});

socket.on('note-update', ({ row, col, notes, prevNotes }) => {
  undoStack.push({ row, col, prevValue: board[row][col].value, prevPlayer: board[row][col].player, prevNotes });
  board[row][col].notes = notes;
  const el = getCellEl(row, col);
  if (!el) return;
  el.innerHTML = '';
  if (board[row][col].value === 0 && notes.length > 0) renderNotes(el, notes);
});

socket.on('undo-confirmed', ({ row, col, value, player, notes }) => {
  undoStack.pop();
  board[row][col] = { ...board[row][col], value, player, notes: notes || [] };
  const el = getCellEl(row, col);
  if (!el) return;
  // Limpiar todo antes de restaurar
  el.classList.remove('error','correct','correct-flash','error-flash');
  el.style.color = '';
  setCellContent(el, board[row][col]);
  applyHighlights();
  updateNumpadCounts();
});

socket.on('sections-complete', ({ sections }) => {
  sections.forEach((s, i) => setTimeout(() => {
    animateSection(s);
    if (i === 0) playSound(soundSectionComplete);
  }, i * 300));
});

socket.on('opponent-cursor', ({ row, col }) => {
  opponentCursor = { row, col }; applyHighlights();
});

socket.on('player-joined', ({ name }) => {
  if (statusMessage) statusMessage.textContent = `✓ ${name} se unió`;
  if (p2Name) p2Name.textContent = name;
  playSound(soundPlayerJoined);
});

socket.on('game-start', ({ board: newBoard, startTime: srvTime, savedElapsed: srvSaved, players, difficulty: diff, solo }) => {
  board       = newBoard;
  gameStarted = true;
  soloMode    = !!solo;
  difficulty  = diff || 'hard';

  if (players) {
    if (p1Name && players[0]) p1Name.textContent = players[0].name;
    if (p2Name && players[1]) p2Name.textContent = players[1].name;
  }

  if (statusMessage) {
    statusMessage.textContent = solo
      ? 'Jugando solo · Compartí el código para invitar 🧩'
      : '¡Juego en curso! 🧩';
  }

  // Restaurar partida guardada si hay una vigente (solo modo host)
  if (isHost && solo) {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (saved && saved.roomCode === roomCode && saved.board) {
        board = saved.board;
        elapsedOffset = saved.elapsed || 0;
      }
    } catch(e) {}
  }

  startTimer(srvTime, elapsedOffset);
  renderBoard();
});

socket.on('partner-joined', ({ board: newBoard, startTime: srvTime, players, difficulty: diff }) => {
  board       = newBoard;
  gameStarted = true;
  soloMode    = false;
  difficulty  = diff || 'hard';

  undoStack.length = 0;
  errorCount = 0;
  updateErrorCount();
  opponentCursor = { row: -1, col: -1 };

  if (players) {
    if (p1Name && players[0]) p1Name.textContent = players[0].name;
    if (p2Name && players[1]) p2Name.textContent = players[1].name;
  }

  if (statusMessage) {
    statusMessage.textContent = '¡Tu compañero se unió! Juego reiniciado 🧩';
    setTimeout(() => { if (statusMessage) statusMessage.textContent = '¡Juego en curso! 🧩'; }, 3000);
  }

  if (isHost) localStorage.removeItem(SAVE_KEY);
  stopTimer();
  startTimer(srvTime, 0);
  renderBoard();
  playSound(soundPlayerJoined);
});

socket.on('game-won', ({ elapsed, errors, difficulty: diff }) => {
  if (!gameStarted) return;
  stopTimer();

  if (isHost) {
    localStorage.removeItem(SAVE_KEY);
    try {
      const stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{"wins":0,"totalErrors":0,"bestTime":null,"streak":0,"history":[]}');
      stats.wins++;
      stats.streak = (stats.streak || 0) + 1;
      stats.totalErrors = (stats.totalErrors || 0) + (errors || 0);
      if (!stats.bestTime || elapsed < stats.bestTime) stats.bestTime = elapsed;
      stats.history = [{ elapsed, errors: errors||0, difficulty: diff||'hard', date: new Date().toLocaleDateString() }, ...(stats.history||[])].slice(0, 20);
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch(e) {}
  }

  playSound(soundWin);
  if (winTime)   winTime.textContent   = formatTime(elapsed);
  if (winErrors) winErrors.textContent = errors || 0;
  if (winScreen) winScreen.classList.remove('hidden');
  launchConfetti();
});

socket.on('board-update-full', ({ board: nb }) => { board = nb; renderBoard(); });

socket.on('host-left', () => {
  stopTimer();
  alert('El anfitrión abandonó la partida.');
  sessionStorage.clear();
  window.location.href = '/';
});

socket.on('player-disconnected', () => {
  if (statusMessage) {
    statusMessage.textContent = '⚠️ Tu compañero se desconectó';
    statusMessage.style.color = '#ef4444';
  }
  soloMode = true;
  opponentCursor = { row: -1, col: -1 };
  applyHighlights();
});

// ============================================================
// INIT
// ============================================================
if (board) renderBoard();
if (p1Name) p1Name.textContent = playerName;
if (statusMessage) {
  statusMessage.textContent = playerIndex === 0 ? 'Iniciando juego...' : '¡Conectado! Cargando...';
}
