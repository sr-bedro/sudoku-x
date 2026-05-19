// ============================================================
// BATTLE.JS — Lógica completa de modo batalla
// ============================================================

const socket = io();

// ── Estado ──
let board         = null;
let solution      = null;
let playerIndex   = -1;
let myCorrectCells = 0;
let oppCorrectCells = 0;
let totalCells    = 0;
let myErrors      = 0;
let selectedRow   = -1;
let selectedCol   = -1;
let noteMode      = false;
let timerInterval = null;
let startTime     = null;
let gameActive    = false;
let battleCode    = null;
let opponentName  = 'Oponente';
let playerName    = localStorage.getItem('playerName') || 'Anónimo';
let currentDiff   = localStorage.getItem('battleDiff') || 'hard';
const undoStack   = [];

const MY_COLOR  = '#e02454';  // jugador 0
const OPP_COLOR = '#f59e0b';  // jugador 1
const MY_COLORS = [MY_COLOR, OPP_COLOR]; // indexed by playerIndex

// ── DOM: pantallas ──
const screens = {
  search:      document.getElementById('screen-search'),
  waiting:     document.getElementById('screen-waiting'),
  privateOpts: document.getElementById('screen-private-options'),
  privateWait: document.getElementById('screen-private-wait'),
  battle:      document.getElementById('screen-battle'),
  result:      document.getElementById('battle-result'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s && s.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
}

// ── DOM: tablero y controles ──
const boardEl         = document.getElementById('battle-board');
const timerEl         = document.getElementById('battle-timer');
const yourFill        = document.getElementById('your-progress-fill');
const oppFill         = document.getElementById('opp-progress-fill');
const yourCount       = document.getElementById('your-cells-count');
const oppCountEl      = document.getElementById('opp-cells-display');
const yourNameEl      = document.getElementById('your-progress-name');
const oppNameEl       = document.getElementById('opp-progress-name');
const totalEl         = document.getElementById('total-cells-display');
const myErrorsEl      = document.getElementById('my-errors-count');
const numBtns         = document.querySelectorAll('#battle-numpad .num-btn');
const btnUndo         = document.getElementById('battle-btn-undo');
const btnErase        = document.getElementById('battle-btn-erase');
const btnNote         = document.getElementById('battle-btn-note');
const toast           = document.getElementById('battle-toast');
const mmYourAvatar    = document.getElementById('mm-your-avatar');
const mmYourName      = document.getElementById('mm-your-name');
const privateCodeDisp = document.getElementById('private-code-display');

// ── Helpers ──
function getBattleCellEl(r, c) {
  return boardEl?.querySelector(`[data-row="${r}"][data-col="${c}"]`);
}

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

function showToast(msg, duration = 2500) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

function playSound(fn) {
  try { fn && fn(); } catch(e) {}
}

// ── Dificultad ──
document.querySelectorAll('.battle-diff-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.battle-diff-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDiff = btn.dataset.diff;
    localStorage.setItem('battleDiff', currentDiff);
  });
  if (btn.dataset.diff === currentDiff) {
    document.querySelectorAll('.battle-diff-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
});

// ── Matchmaking: Buscar partida ──
const btnFind = document.getElementById('btn-find-match');
btnFind && btnFind.addEventListener('click', () => {
  socket.emit('battle-find-match', { playerName, difficulty: currentDiff });
  if (mmYourAvatar) mmYourAvatar.textContent = playerName[0]?.toUpperCase() || '?';
  if (mmYourName)   mmYourName.textContent   = playerName;
  showScreen('waiting');
});

// ── Cancelar búsqueda ──
document.getElementById('btn-cancel-search') &&
  document.getElementById('btn-cancel-search').addEventListener('click', () => {
    socket.emit('battle-cancel-search');
    showScreen('search');
  });

// ── Sala privada: botón principal ──
const btnPrivate = document.getElementById('btn-private-battle');
btnPrivate && btnPrivate.addEventListener('click', () => showScreen('privateOpts'));

// ── Sala privada: volver ──
document.getElementById('btn-back-private-options') &&
  document.getElementById('btn-back-private-options').addEventListener('click', () => showScreen('search'));

// ── Sala privada: crear ──
document.getElementById('btn-create-private') &&
  document.getElementById('btn-create-private').addEventListener('click', () => {
    socket.emit('battle-create-private', { playerName, difficulty: currentDiff });
  });

// ── Sala privada: unirse ──
const battleCodeInput = document.getElementById('battle-code-input');
const btnJoinBattle   = document.getElementById('btn-join-battle');

battleCodeInput && battleCodeInput.addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

btnJoinBattle && btnJoinBattle.addEventListener('click', () => {
  const code = battleCodeInput?.value.trim().toUpperCase();
  if (!code) return;
  socket.emit('battle-join-private', { code, playerName });
});

battleCodeInput && battleCodeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnJoinBattle?.click();
});

// ── Sala privada: cancelar espera ──
document.getElementById('btn-cancel-private') &&
  document.getElementById('btn-cancel-private').addEventListener('click', () => {
    socket.emit('battle-cancel-search');
    showScreen('search');
  });

// ── Sala privada: compartir código ──
document.getElementById('private-share-wa') &&
  document.getElementById('private-share-wa').addEventListener('click', () => {
    const code = privateCodeDisp?.textContent;
    const msg  = `¡Te desafío a una batalla de Sudoku X! ⚔️\nCódigo: *${code}*\nEntrá a: ${window.location.origin}/battle.html`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  });

document.getElementById('private-copy-code') &&
  document.getElementById('private-copy-code').addEventListener('click', () => {
    const code = privateCodeDisp?.textContent;
    navigator.clipboard.writeText(code).then(() => showToast('✓ Código copiado'));
  });

// ── Prevenir cierres accidentales durante el juego ──
window.addEventListener('beforeunload', (e) => {
  if (gameActive) { e.preventDefault(); e.returnValue = ''; }
});

history.pushState(null, '', location.href);
window.addEventListener('popstate', () => {
  if (gameActive) {
    history.pushState(null, '', location.href);
    if (confirm('¿Salir de la batalla? Perderás la partida actual.')) {
      gameActive = false;
      stopTimer();
      window.location.href = '/';
    }
  }
});

// ── Botón home durante batalla ──
document.getElementById('btn-home-battle') &&
  document.getElementById('btn-home-battle').addEventListener('click', () => {
    if (gameActive && !confirm('¿Salir de la batalla? Perderás la partida.')) return;
    gameActive = false;
    stopTimer();
    window.location.href = '/';
  });

// ── Timer ──
function startTimer(srvTime) {
  startTime = srvTime;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!timerEl) return;
    timerEl.textContent = formatTime(Math.floor((Date.now() - startTime) / 1000));
  }, 1000);
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

function getCurrentElapsed() {
  return startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
}

// ── Progreso ──
function updateMyProgress(correct) {
  myCorrectCells = correct;
  const pct = totalCells > 0 ? (correct / totalCells) * 100 : 0;
  if (yourFill)  yourFill.style.width  = pct + '%';
  if (yourCount) yourCount.textContent = `${correct}/${totalCells}`;
}

function updateOppProgress(correct) {
  oppCorrectCells = correct;
  const pct = totalCells > 0 ? (correct / totalCells) * 100 : 0;
  if (oppFill)    oppFill.style.width    = pct + '%';
  if (oppCountEl) oppCountEl.textContent = `${correct}/${totalCells}`;
}

function updateMyErrors(count) {
  myErrors = count;
  if (myErrorsEl) myErrorsEl.textContent = count;
}

// ── Tablero ──
function renderBattleBoard() {
  if (!boardEl || !board) return;
  boardEl.innerHTML = '';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      const el   = document.createElement('div');
      el.className   = 'cell';
      el.dataset.row = r;
      el.dataset.col = c;
      if (r === c || r + c === 8) el.classList.add('diagonal');
      if (cell.fixed) {
        el.classList.add('fixed');
        el.textContent = cell.value;
      }
      el.addEventListener('click', () => onBattleCellClick(r, c));
      boardEl.appendChild(el);
    }
  }
}

function setCellDisplay(el, value, isCorrect, isFixed) {
  el.innerHTML    = '';
  el.style.color  = '';
  el.classList.remove('battle-error', 'battle-correct', 'error', 'correct');

  if (value !== 0) {
    el.textContent = value;
    if (!isFixed) {
      if (isCorrect) {
        el.style.color = MY_COLORS[playerIndex] || MY_COLOR;
        el.classList.add('correct');
      } else {
        el.style.color = '#ef4444';
        el.classList.add('battle-error');
      }
    }
  }
}

// ── Selección y highlights ──
function onBattleCellClick(row, col) {
  selectedRow = row; selectedCol = col;
  applyBattleHighlights();
  playSound(typeof soundCellSelect !== 'undefined' ? soundCellSelect : null);
}

function applyBattleHighlights() {
  if (!boardEl) return;
  boardEl.querySelectorAll('.cell').forEach(el => {
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    el.classList.remove('selected','highlight','same-num');

    if (selectedRow === -1) return;
    if (r === selectedRow && c === selectedCol) {
      el.classList.add('selected');
    } else {
      const sameRow  = r === selectedRow;
      const sameCol  = c === selectedCol;
      const sameBox  = Math.floor(r/3) === Math.floor(selectedRow/3) && Math.floor(c/3) === Math.floor(selectedCol/3);
      const selOnMD  = selectedRow === selectedCol;
      const selOnAD  = selectedRow + selectedCol === 8;
      const sameMD   = selOnMD && r === c;
      const sameAD   = selOnAD && r + c === 8;
      if (sameRow || sameCol || sameBox || sameMD || sameAD) el.classList.add('highlight');
    }

    // Mismo número
    if (selectedRow !== -1 && board[selectedRow][selectedCol].value !== 0 &&
        board[r][c].value === board[selectedRow][selectedCol].value) {
      el.classList.add('same-num');
    }
  });
}

// ── Numpad y controles ──
numBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (selectedRow === -1 || !gameActive) return;
    const value = parseInt(btn.dataset.num);
    if (noteMode) {
      // No permitir nota si ya existe en fila/col/box/diagonal
      if (numConflictsForNote(selectedRow, selectedCol, value)) {
        playSound(typeof soundBlocked !== 'undefined' ? soundBlocked : null);
        showToast('Ya existe ese número en la fila, columna o diagonal');
        return;
      }
      toggleNote(selectedRow, selectedCol, value);
    } else {
      if (board[selectedRow][selectedCol].fixed) return;
      const prev = { row: selectedRow, col: selectedCol, prevValue: board[selectedRow][selectedCol].value };
      undoStack.push(prev);
      socket.emit('battle-move', { row: selectedRow, col: selectedCol, value });
    }
  });
});

btnNote && btnNote.addEventListener('click', () => {
  noteMode = !noteMode;
  btnNote.classList.toggle('active', noteMode);
  boardEl && boardEl.classList.toggle('note-mode', noteMode);
  numBtns.forEach(b => b.classList.toggle('note-mode', noteMode));
});

btnErase && btnErase.addEventListener('click', () => {
  if (selectedRow === -1 || !gameActive) return;
  const cell = board[selectedRow][selectedCol];
  if (cell.fixed) return;

  if (cell.value !== 0) {
    // Borrar número
    const prev = { row: selectedRow, col: selectedCol, prevValue: cell.value };
    undoStack.push(prev);
    socket.emit('battle-move', { row: selectedRow, col: selectedCol, value: 0 });
  } else if (cell.notes && cell.notes.length > 0) {
    // Borrar notas localmente
    cell.notes = [];
    const el = getBattleCellEl(selectedRow, selectedCol);
    if (el) { el.innerHTML = ''; }
  }
  playSound(typeof soundErase !== 'undefined' ? soundErase : null);
});

btnUndo && btnUndo.addEventListener('click', () => {
  if (!undoStack.length || !gameActive) return;
  const last = undoStack.pop();
  const cell = board[last.row][last.col];
  const wasCorrect = cell.value !== 0 && cell.value === solution[last.row][last.col];
  const willBeCorrect = last.prevValue !== 0 && last.prevValue === solution[last.row][last.col];

  // Actualizar myCorrectCells
  if (wasCorrect && !willBeCorrect)       myCorrectCells = Math.max(0, myCorrectCells - 1);
  else if (!wasCorrect && willBeCorrect)  myCorrectCells++;

  board[last.row][last.col].value = last.prevValue;
  const el = getBattleCellEl(last.row, last.col);
  if (el) {
    el.classList.remove('battle-error','battle-correct','correct','error','correct-flash','error-shake');
    el.style.color  = '';
    el.innerHTML    = '';
    if (last.prevValue !== 0) {
      el.textContent = last.prevValue;
      if (willBeCorrect) {
        el.style.color = MY_COLORS[playerIndex] || MY_COLOR;
        el.classList.add('correct');
      } else {
        el.style.color = '#ef4444';
        el.classList.add('battle-error');
      }
    }
  }
  updateMyProgress(myCorrectCells);
  updateBattleNumpadCounts();
  playSound(typeof soundUndo !== 'undefined' ? soundUndo : null);
});

// ── Teclado ──
document.addEventListener('keydown', (e) => {
  if (!gameActive) return;
  const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr, dc] = moves[e.key];
    const nr = Math.max(0, Math.min(8, (selectedRow < 0 ? 0 : selectedRow) + dr));
    const nc = Math.max(0, Math.min(8, (selectedCol < 0 ? 0 : selectedCol) + dc));
    onBattleCellClick(nr, nc);
    return;
  }
  if (e.key >= '1' && e.key <= '9' && selectedRow !== -1) {
    const btn = document.querySelector(`#battle-numpad [data-num="${e.key}"]`);
    btn && btn.click();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRow !== -1) btnErase?.click();
  if (e.key === 'n' || e.key === 'N') btnNote?.click();
});

// ── Notas locales ──
function toggleNote(row, col, num) {
  const cell = board[row][col];
  if (cell.fixed || cell.value !== 0) return;
  if (!cell.notes) cell.notes = [];
  const idx = cell.notes.indexOf(num);
  if (idx === -1) { cell.notes.push(num); cell.notes.sort((a,b) => a-b); }
  else            { cell.notes.splice(idx, 1); }
  renderNotes(row, col);
  playSound(typeof soundNote !== 'undefined' ? soundNote : null);
}

function renderNotes(row, col) {
  const el = getBattleCellEl(row, col);
  if (!el) return;
  el.innerHTML = '';
  const notes = board[row][col].notes || [];
  if (notes.length === 0) return;
  const grid = document.createElement('div');
  grid.className = 'notes-grid';
  for (let n = 1; n <= 9; n++) {
    const span = document.createElement('span');
    span.className = 'note-num';
    if (notes.includes(n)) span.textContent = n;
    grid.appendChild(span);
  }
  el.appendChild(grid);
}

// ── Conflictos de notas ──
function numConflictsForNote(row, col, num) {
  for (let c = 0; c < 9; c++) if (board[row][c].value === num) return true;
  for (let r = 0; r < 9; r++) if (board[r][col].value === num) return true;
  const br = Math.floor(row/3)*3, bc = Math.floor(col/3)*3;
  for (let r = br; r < br+3; r++) for (let c = bc; c < bc+3; c++) if (board[r][c].value === num) return true;
  if (row === col)     for (let i = 0; i < 9; i++) if (board[i][i].value === num) return true;
  if (row+col === 8)   for (let i = 0; i < 9; i++) if (board[i][8-i].value === num) return true;
  return false;
}

// ── Numpad counts ──
function updateBattleNumpadCounts() {
  if (!board) return;
  const counts = {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0};
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { const v=board[r][c].value; if(v) counts[v]++; }
  numBtns.forEach(btn => {
    const num = parseInt(btn.dataset.num), rem = 9 - counts[num];
    const ce  = btn.querySelector('.num-count');
    if (ce) ce.textContent = rem > 0 ? rem : '';
    btn.classList.toggle('depleted', rem === 0);
  });
}

// ── Animaciones ──
function animateCorrect(el) {
  el.classList.remove('correct-flash');
  void el.offsetWidth; // reflow para reiniciar animación
  el.classList.add('correct-flash');
  setTimeout(() => el.classList.remove('correct-flash'), 500);
}

function animateError(el) {
  el.classList.remove('error-shake');
  void el.offsetWidth;
  el.classList.add('error-shake');
  setTimeout(() => el.classList.remove('error-shake'), 400);
}

// ── Resultado ──
function showResult({ won, reason, elapsed, errors }) {
  stopTimer();
  gameActive = false;

  const emoji    = document.getElementById('result-emoji');
  const title    = document.getElementById('result-title');
  const subtitle = document.getElementById('result-subtitle');
  const timeEl   = document.getElementById('result-time');
  const errorsEl = document.getElementById('result-errors');
  const penaltyEl= document.getElementById('result-penalty');

  if (emoji) emoji.textContent = won ? '🏆' : '😔';
  if (title) title.textContent = won ? '¡Ganaste!' : 'Perdiste';

  const reasons = {
    completed:         won ? `Completaste el tablero en ${formatTime(elapsed)}` : `${opponentName} terminó primero`,
    opponent_finished: `${opponentName} terminó en ${formatTime(elapsed || 0)}`,
    opponent_errors:   `${opponentName} acumuló demasiados errores`,
    errors:            'Cometiste demasiados errores',
    disconnect:        `${opponentName} se desconectó`,
  };
  if (subtitle) subtitle.textContent = reasons[reason] || '';
  if (timeEl)   timeEl.textContent   = formatTime(elapsed || getCurrentElapsed());
  if (errorsEl) errorsEl.textContent = errors || myErrors;
  if (penaltyEl) penaltyEl.closest('.result-stat')?.style && (penaltyEl.closest('.result-stat').style.display = 'none');

  showScreen('result');

  if (won) {
    playSound(typeof soundWin !== 'undefined' ? soundWin : null);
    launchBattleConfetti();
  }
}

function launchBattleConfetti() {
  const canvas = document.getElementById('battle-confetti');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const pts = Array.from({length:120}, () => ({
    x: Math.random()*canvas.width, y: -20,
    w: Math.random()*10+4, h: Math.random()*6+3,
    color: ['#e02454','#f59e0b','#2563eb','#10b981','#ec4899'][Math.floor(Math.random()*5)],
    speed: Math.random()*4+2, drift: Math.random()*2-1, angle: Math.random()*360, spin: Math.random()*6-3,
  }));
  let n = 0;
  (function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height); n++;
    pts.forEach(p => {
      p.y+=p.speed; p.x+=p.drift; p.angle+=p.spin;
      ctx.save(); ctx.translate(p.x+p.w/2, p.y+p.h/2); ctx.rotate(p.angle*Math.PI/180);
      ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,1-n/180);
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    });
    if (n < 200) requestAnimationFrame(draw);
  })();
}

// ── Revancha y volver ──
document.getElementById('btn-rematch') && document.getElementById('btn-rematch').addEventListener('click', () => {
  sessionStorage.setItem('battleAction', 'find');
  sessionStorage.setItem('battleDiff', currentDiff);
  sessionStorage.setItem('battleName', playerName);
  window.location.reload();
});

document.getElementById('btn-back-home') && document.getElementById('btn-back-home').addEventListener('click', () => {
  gameActive = false;
  window.location.href = '/';
});

// ── EVENTOS DEL SERVIDOR ──

socket.on('battle-waiting', () => {
  showScreen('waiting');
});

socket.on('battle-search-cancelled', () => {
  showScreen('search');
});

socket.on('battle-private-created', ({ code, playerIndex: pi, puzzle: puz, solution: sol }) => {
  playerIndex = pi;
  board       = puz;
  solution    = sol;
  if (privateCodeDisp) privateCodeDisp.textContent = code;
  showScreen('privateWait');
});

socket.on('battle-start', ({ code, playerIndex: pi, puzzle: puz, solution: sol, opponentName: oppName, totalCells: total, startTime: srvTime }) => {
  playerIndex  = pi;
  board        = puz;
  solution     = sol;
  opponentName = oppName;
  totalCells   = total;
  battleCode   = code;
  myCorrectCells  = 0;
  oppCorrectCells = 0;
  myErrors        = 0;
  undoStack.length = 0;
  gameActive      = true;

  // Nombres
  if (yourNameEl) yourNameEl.textContent = playerName;
  if (oppNameEl)  oppNameEl.textContent  = oppName;
  if (totalEl)    totalEl.textContent    = `/ ${total}`;

  updateMyProgress(0);
  updateOppProgress(0);
  updateMyErrors(0);

  renderBattleBoard();
  updateBattleNumpadCounts();
  startTimer(srvTime);
  showScreen('battle');

  playSound(typeof soundPlayerJoined !== 'undefined' ? soundPlayerJoined : null);
});

socket.on('battle-cell-result', ({ row, col, value, correct, errors }) => {
  board[row][col].value = value;
  const el = getBattleCellEl(row, col);
  if (!el) return;

  // Limpiar estado anterior completamente
  el.classList.remove('battle-error','battle-correct','correct','error','correct-flash','error-shake');
  el.style.color = '';
  el.innerHTML   = '';

  if (value === 0) {
    // Celda borrada
    if (el.classList.contains('fixed')) el.textContent = board[row][col].value || '';
  } else if (correct) {
    el.textContent = value;
    el.style.color = MY_COLORS[playerIndex] || MY_COLOR;
    el.classList.add('correct');
    animateCorrect(el);
    myCorrectCells++;
    updateMyProgress(myCorrectCells);
    playSound(typeof soundCorrect !== 'undefined' ? soundCorrect : null);
  } else {
    el.textContent = value;
    el.style.color = '#ef4444';
    el.classList.add('battle-error');
    animateError(el);
    updateMyErrors(errors);
    playSound(typeof soundError !== 'undefined' ? soundError : null);
  }

  updateBattleNumpadCounts();
  applyBattleHighlights();
});

socket.on('battle-opponent-progress', ({ correctCells }) => {
  updateOppProgress(correctCells);
});

socket.on('battle-opponent-error', ({ errors }) => {
  // Solo visual feedback, sin penalización
  showToast(`⚠️ Tu rival cometió un error (${errors} total)`);
});

socket.on('battle-won', ({ reason, elapsed, errors }) => {
  showResult({ won: true, reason, elapsed, errors });
});

socket.on('battle-lost', ({ reason, opponentTime, opponentName: oppN }) => {
  opponentName = oppN || opponentName;
  showResult({ won: false, reason, elapsed: opponentTime, errors: myErrors });
});

socket.on('battle-opponent-disconnected', () => {
  stopTimer();
  showResult({ won: true, reason: 'disconnect', elapsed: getCurrentElapsed(), errors: myErrors });
});

socket.on('error', (msg) => {
  showToast('Error: ' + msg);
  showScreen('search');
});
