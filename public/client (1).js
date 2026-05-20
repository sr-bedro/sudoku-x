// ============================================================
// SESIÓN
// ============================================================
const SAVE_KEY  = 'sudokuX_savedGame';
const STATS_KEY = 'sudokuX_stats';
const roomCode    = sessionStorage.getItem('roomCode');
const playerIndex = parseInt(sessionStorage.getItem('playerIndex'));
const playerName  = sessionStorage.getItem('playerName') || (playerIndex === 0 ? 'J1' : 'J2');
let   board       = JSON.parse(sessionStorage.getItem('board'));
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
let coopMode       = false;

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
const boardEl      = document.getElementById('board');
const shareCodeBig = document.getElementById('share-code-big');
const winScreen    = document.getElementById('win-screen');
const winTitle     = document.getElementById('win-title');
const winTime      = document.getElementById('win-time');
const winErrors    = document.getElementById('win-errors');
const numBtns      = document.querySelectorAll('.num-btn');
const btnNote      = document.getElementById('btn-note');
const btnErase     = document.getElementById('btn-erase');
const btnUndo      = document.getElementById('btn-undo');
const btnHome      = document.getElementById('btn-home');
const btnShare     = document.getElementById('btn-share');
const btnSettings  = document.getElementById('btn-settings');
const timerEl      = document.getElementById('timer');
const errorBadge   = document.getElementById('error-badge');
const errorCountEl = document.getElementById('error-count');
const headerDiff   = document.getElementById('header-diff');
const p1Name       = document.getElementById('p1-name');
const p2Name       = document.getElementById('p2-name');
const statusMsg    = document.getElementById('status-message');
const playersBar   = document.getElementById('players-bar');

// Sheets
const shareSheet    = document.getElementById('share-sheet');
const shareOverlay  = document.getElementById('share-overlay');
const settingsSheet = document.getElementById('settings-sheet');
const settingsOvl   = document.getElementById('settings-overlay');

if (shareCodeBig) shareCodeBig.textContent = roomCode;

// Difficulty label
const diffLabels = { easy:'Fácil', normal:'Normal', hard:'Difícil', expert:'Experto', extreme:'Extremo', custom:'Tablero propio' };
if (headerDiff) headerDiff.textContent = diffLabels[difficulty] || difficulty;

updateSoundBtn();
document.addEventListener('click', () => { try { getCtx(); } catch(e){} }, { once: true });

// ============================================================
// SHEETS — COMPARTIR
// ============================================================
function openSheet(sheet, overlay) {
  sheet.classList.remove('hidden');
  overlay.classList.remove('hidden');
  setTimeout(() => { sheet.classList.add('sheet-open'); overlay.classList.add('overlay-open'); }, 10);
}
function closeSheet(sheet, overlay) {
  sheet.classList.remove('sheet-open'); overlay.classList.remove('overlay-open');
  setTimeout(() => { sheet.classList.add('hidden'); overlay.classList.add('hidden'); }, 300);
}

btnShare && btnShare.addEventListener('click', () => openSheet(shareSheet, shareOverlay));
shareOverlay && shareOverlay.addEventListener('click', () => closeSheet(shareSheet, shareOverlay));
document.getElementById('share-close') && document.getElementById('share-close').addEventListener('click', () => closeSheet(shareSheet, shareOverlay));

document.getElementById('share-whatsapp') && document.getElementById('share-whatsapp').addEventListener('click', () => {
  const msg = `¡Jugá Sudoku X conmigo! 🧩\nCódigo de sala: *${roomCode}*\nEntrá acá: ${window.location.origin}\n\n1. Abrí el link\n2. Tocá "Unirse" → ingresá el código: *${roomCode}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
});

document.getElementById('share-copy') && document.getElementById('share-copy').addEventListener('click', () => {
  const btn = document.getElementById('share-copy');
  navigator.clipboard.writeText(`${window.location.origin}?code=${roomCode}`).then(() => {
    const orig = btn.innerHTML; btn.innerHTML = '✓ Copiado';
    setTimeout(() => btn.innerHTML = orig, 2000);
  }).catch(() => prompt('Copiá este link:', `${window.location.origin}?code=${roomCode}`));
});

// ============================================================
// SHEETS — AJUSTES
// ============================================================
btnSettings && btnSettings.addEventListener('click', () => openSheet(settingsSheet, settingsOvl));
settingsOvl && settingsOvl.addEventListener('click', () => closeSheet(settingsSheet, settingsOvl));
document.getElementById('settings-close') && document.getElementById('settings-close').addEventListener('click', () => closeSheet(settingsSheet, settingsOvl));

// Sonido toggle
const soundToggle = document.getElementById('sound-toggle');
if (soundToggle) {
  soundToggle.classList.toggle('active', soundEnabled);
  soundToggle.textContent = soundEnabled ? 'ON' : 'OFF';
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('soundEnabled', soundEnabled);
    soundToggle.classList.toggle('active', soundEnabled);
    soundToggle.textContent = soundEnabled ? 'ON' : 'OFF';
    updateSoundBtn();
  });
}

// Tema
document.querySelectorAll('.settings-sheet .theme-pill, #settings-sheet .theme-pill').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.theme === document.body.dataset.theme);
  btn.style.borderColor = btn.dataset.theme === document.body.dataset.theme ? 'var(--p1)' : '';
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    document.body.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    document.querySelectorAll('#settings-sheet .theme-pill').forEach(b => {
      b.style.borderColor = b.dataset.theme === theme ? 'var(--p1)' : '';
    });
  });
});

// ============================================================
// SONIDO
// ============================================================
function playSound(fn) { if (!soundEnabled) return; try { fn(); } catch(e) {} }

function updateSoundBtn() {
  if (soundToggle) {
    soundToggle.classList.toggle('active', soundEnabled);
    soundToggle.textContent = soundEnabled ? 'ON' : 'OFF';
  }
}

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
// GUARDAR (silencioso — sin toast)
// ============================================================
function doSave() {
  if (!isHost || !gameStarted) return;
  const elapsed = getCurrentElapsed();
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    roomCode, playerIndex: 0, playerName, board, difficulty,
    elapsed, elapsedFormatted: formatTime(elapsed),
    savedAt: new Date().toLocaleString(),
  }));
  // Sin toast — guardado silencioso
}

setInterval(doSave, 30000);

// ============================================================
// TRANSFORMAR A MODO COOP
// ============================================================
function transformToCoopMode(players) {
  coopMode = true;
  soloMode = false;

  // Mostrar barra de jugadores con animación
  if (playersBar) {
    playersBar.classList.remove('hidden-coop');
    playersBar.classList.add('reveal-coop');
  }

  if (p1Name && players?.[0]) p1Name.textContent = players[0].name;
  if (p2Name && players?.[1]) p2Name.textContent = players[1].name;

  if (statusMsg) {
    statusMsg.textContent = '¡Juego en equipo! 🧩';
    statusMsg.style.color = '';
  }

  // Actualizar título de la pantalla de victoria
  if (winTitle) winTitle.textContent = '¡Lo lograron!';
}

// ============================================================
// HOME
// ============================================================
btnHome && btnHome.addEventListener('click', () => {
  if (!gameStarted) { window.location.href = '/'; return; }
  const msg = isHost
    ? '¿Salir? La partida se guardará.'
    : '¿Salir? Solo el anfitrión puede retomar la partida.';
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
  numBtns.forEach(b => b.classList.toggle('note-mode', noteMode));
  boardEl && boardEl.classList.toggle('note-mode', noteMode);
  playSound(soundNote);
});

btnErase && btnErase.addEventListener('click', () => {
  if (selectedRow === -1 || !gameStarted) return;
  const cell = board[selectedRow][selectedCol];
  if (cell.fixed) return;
  if (cell.value !== 0) {
    playSound(soundErase);
    socket.emit('make-move', { row: selectedRow, col: selectedCol, value: 0 });
  } else if (cell.notes && cell.notes.length > 0) {
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
  socket.emit('undo-move', { row: last.row, col: last.col, prevValue: last.prevValue, prevNotes: last.prevNotes, prevPlayer: last.prevPlayer });
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
      if (board[selectedRow][selectedCol].fixed || board[selectedRow][selectedCol].value !== 0) return;
      if (numConflictsForNote(selectedRow, selectedCol, value)) {
        playSound(soundBlocked); return;
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
    onCellClick(nr, nc); return;
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
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRow !== -1) { btnErase?.click(); return; }
  if (e.key === 'n' || e.key === 'N') btnNote?.click();
});

// ============================================================
// TABLERO
// ============================================================
function renderBoard() {
  if (!boardEl) return;
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
// SELECCIÓN Y HIGHLIGHTS — diagonales X incluidas
// ============================================================
function onCellClick(row, col) {
  if (coopMode && opponentCursor.row === row && opponentCursor.col === col) {
    const el = getCellEl(row, col);
    el && el.classList.add('blocked-flash');
    setTimeout(() => getCellEl(row, col)?.classList.remove('blocked-flash'), 400);
    playSound(soundBlocked);
    return;
  }
  playSound(soundCellSelect);
  selectedRow = row; selectedCol = col;
  if (coopMode) socket.emit('cursor-move', { row, col });
  applyHighlights();
}

function applyHighlights() {
  if (!boardEl) return;
  boardEl.querySelectorAll('.cell').forEach(el => {
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    el.classList.remove('selected','highlight','same-num','opponent-cell','conflict');

    if (coopMode && opponentCursor.row === r && opponentCursor.col === c) {
      el.classList.add('opponent-cell'); return;
    }

    if (selectedRow === -1) return;

    if (r === selectedRow && c === selectedCol) {
      el.classList.add('selected');
    } else {
      const sameRow = r === selectedRow;
      const sameCol = c === selectedCol;
      const sameBox = Math.floor(r/3) === Math.floor(selectedRow/3) && Math.floor(c/3) === Math.floor(selectedCol/3);
      const selOnMD = selectedRow === selectedCol;
      const selOnAD = selectedRow + selectedCol === 8;
      const sameMD  = selOnMD && r === c;
      const sameAD  = selOnAD && r + c === 8;
      if (sameRow || sameCol || sameBox || sameMD || sameAD) el.classList.add('highlight');
    }

    // Mismo número → resaltar + conflicto
    const selVal = board[selectedRow]?.[selectedCol]?.value;
    if (selVal && board[r][c].value === selVal) {
      el.classList.add('same-num');
      if (r !== selectedRow || c !== selectedCol) {
        const conflict =
          r === selectedRow || c === selectedCol ||
          (Math.floor(r/3) === Math.floor(selectedRow/3) && Math.floor(c/3) === Math.floor(selectedCol/3)) ||
          (r === c && selectedRow === selectedCol) ||
          (r+c === 8 && selectedRow+selectedCol === 8);
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
  else if (section.type === 'box')
    for (let r = section.boxRow*3; r < section.boxRow*3+3; r++)
      for (let c = section.boxCol*3; c < section.boxCol*3+3; c++)
        cells.push(getCellEl(r, c));
  else if (section.type === 'diagonal') {
    // Animación especial para diagonal X
    for (let i = 0; i < 9; i++) {
      const el = section.which === 'main' ? getCellEl(i, i) : getCellEl(i, 8-i);
      cells.push(el);
    }
  }

  const isdiag = section.type === 'diagonal';
  cells.forEach((el, i) => {
    if (!el) return;
    const delay = isdiag ? i * 55 : i * 45; // diagonal un poco más lento para más drama
    setTimeout(() => {
      const cls = isdiag ? 'diagonal-complete' : 'section-complete';
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), isdiag ? 900 : 700);
    }, delay);
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

  el.classList.remove('error','correct','correct-flash','error-flash');
  el.style.color = '';
  el.innerHTML   = '';

  if (value !== 0) {
    el.textContent = value;
    if (correct) {
      el.style.color = playerColor;
      el.classList.add('correct');
      void el.offsetWidth;
      el.classList.add('correct-flash');
      setTimeout(() => el.classList.remove('correct-flash'), 500);
      playSound(soundCorrect);
    } else {
      el.style.color = '#ef4444';
      el.classList.add('error');
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
  el.classList.remove('error','correct','correct-flash','error-flash');
  el.style.color = '';
  setCellContent(el, board[row][col]);
  applyHighlights();
  updateNumpadCounts();
});

socket.on('sections-complete', ({ sections }) => {
  sections.forEach((s, i) => {
    const isdiag = s.type === 'diagonal';
    setTimeout(() => {
      animateSection(s);
      if (i === 0) {
        if (isdiag) {
          // Sonido más especial para diagonal
          playSound(soundSectionComplete);
          setTimeout(() => playSound(soundSectionComplete), 250);
        } else {
          playSound(soundSectionComplete);
        }
      }
    }, i * 350);
  });
});

socket.on('opponent-cursor', ({ row, col }) => {
  opponentCursor = { row, col }; applyHighlights();
});

socket.on('player-joined', ({ name }) => {
  if (p2Name) p2Name.textContent = name;
  playSound(soundPlayerJoined);
});

socket.on('game-start', ({ board: newBoard, startTime: srvTime, savedElapsed: srvSaved, players, difficulty: diff, solo }) => {
  board       = newBoard;
  gameStarted = true;
  soloMode    = !!solo;
  coopMode    = false;
  difficulty  = diff || 'hard';

  if (headerDiff) headerDiff.textContent = diffLabels[difficulty] || difficulty;
  if (winTitle) winTitle.textContent = '¡Lo lograste!';

  // Restaurar guardado si existe (solo modo host)
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
  difficulty  = diff || 'hard';

  undoStack.length = 0;
  errorCount = 0;
  updateErrorCount();
  opponentCursor = { row: -1, col: -1 };

  transformToCoopMode(players);

  if (headerDiff) headerDiff.textContent = diffLabels[difficulty] || difficulty;
  if (isHost) localStorage.removeItem(SAVE_KEY);

  stopTimer();
  startTimer(srvTime, 0);
  renderBoard();
  playSound(soundPlayerJoined);
});

socket.on('game-won', ({ elapsed, errors, difficulty: diff, coop }) => {
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
      stats.history = [{ elapsed, errors: errors||0, difficulty: diff||'hard', date: new Date().toLocaleDateString() }, ...(stats.history||[])].slice(0,20);
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch(e) {}
  }

  playSound(soundWin);
  if (winTitle)  winTitle.textContent  = coop ? '¡Lo lograron!' : '¡Lo lograste!';
  if (winTime)   winTime.textContent   = formatTime(elapsed);
  if (winErrors) winErrors.textContent = errors || 0;
  winScreen && winScreen.classList.remove('hidden');
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
  if (statusMsg) {
    statusMsg.textContent = '⚠️ Tu compañero se desconectó';
    statusMsg.style.color = '#ef4444';
  }
  soloMode = true; coopMode = false;
  opponentCursor = { row: -1, col: -1 };
  applyHighlights();
});

// ============================================================
// INIT
// ============================================================
if (board) renderBoard();
