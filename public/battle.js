// ============================================================
// BATALLA — Cliente
// ============================================================

const socket     = io();
const playerName = localStorage.getItem('playerName') || 'Anónimo';
const theme      = localStorage.getItem('theme') || 'light';

document.body.dataset.theme = theme;

// ============================================================
// ESTADO
// ============================================================
let battleCode     = null;
let playerIndex    = -1;
let board          = null;
let solution       = null;
let selectedRow    = -1;
let selectedCol    = -1;
let noteMode       = false;
let myErrors       = 0;
let myPenalty      = 0;
let myCorrectCells = 0;
let totalCells     = 0;
let oppCorrect     = 0;
let timerInterval  = null;
let startTime      = null;
let undoStack      = [];
let selectedDiff   = 'hard';
let soundEnabled   = localStorage.getItem('soundEnabled') !== 'false';

// ============================================================
// PANTALLAS
// ============================================================
const screens = {
  search:      document.getElementById('screen-search'),
  waiting:     document.getElementById('screen-waiting'),
  privateWait: document.getElementById('screen-private-wait'),
  battle:      document.getElementById('screen-battle'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
}

showScreen('search');

// ============================================================
// DIFICULTAD
// ============================================================
document.querySelectorAll('.battle-diff-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.battle-diff-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDiff = btn.dataset.diff;
  });
});

// ============================================================
// DOM — BÚSQUEDA
// ============================================================
document.getElementById('btn-back-search').addEventListener('click', () => {
  window.location.href = '/';
});

document.getElementById('btn-find-match').addEventListener('click', () => {
  showScreen('waiting');
  const av = document.getElementById('mm-your-avatar');
  const nm = document.getElementById('mm-your-name');
  if (av) av.textContent = playerName[0]?.toUpperCase() || '?';
  if (nm) nm.textContent = playerName;
  socket.emit('battle-find-match', { playerName, difficulty: selectedDiff });
});

document.getElementById('btn-cancel-search').addEventListener('click', () => {
  socket.emit('battle-cancel-search');
  showScreen('search');
});

document.getElementById('btn-private-battle').addEventListener('click', () => {
  socket.emit('battle-create-private', { playerName, difficulty: selectedDiff });
});

document.getElementById('btn-join-battle').addEventListener('click', () => {
  const code = document.getElementById('battle-code-input').value.trim().toUpperCase();
  if (!code) { showToast('Ingresá un código'); return; }
  socket.emit('battle-join-private', { code, playerName });
});

document.getElementById('battle-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join-battle').click();
});

document.getElementById('battle-code-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

// ============================================================
// DOM — SALA PRIVADA CREADA
// ============================================================
document.getElementById('btn-cancel-private').addEventListener('click', () => {
  showScreen('search');
});

document.getElementById('private-share-wa').addEventListener('click', () => {
  const code = document.getElementById('private-code-display').textContent;
  const msg  = `¡Te desafío a un Sudoku X Batalla! ⚔️\nCódigo: *${code}*\n\n1. Entrá a: ${window.location.origin}\n2. Tab "Batalla"\n3. Ingresá el código: *${code}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
});

document.getElementById('private-copy-code').addEventListener('click', () => {
  const code = document.getElementById('private-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Código copiado'));
});

// ============================================================
// DOM — JUEGO BATALLA
// ============================================================
document.getElementById('btn-home-battle').addEventListener('click', () => {
  if (!confirm('¿Salir de la batalla? Perderás la partida.')) return;
  stopTimer();
  window.location.href = '/';
});

document.getElementById('battle-btn-note').addEventListener('click', () => {
  noteMode = !noteMode;
  document.getElementById('battle-btn-note').classList.toggle('active', noteMode);
  document.querySelectorAll('#battle-numpad .num-btn').forEach(b => b.classList.toggle('note-mode', noteMode));
});

document.getElementById('battle-btn-erase').addEventListener('click', () => {
  if (selectedRow === -1 || !board) return;
  if (board[selectedRow][selectedCol].fixed) return;
  socket.emit('battle-move', { row: selectedRow, col: selectedCol, value: 0 });
});

document.getElementById('battle-btn-undo').addEventListener('click', () => {
  if (!undoStack.length) return;
  const last = undoStack.pop();
  board[last.row][last.col].value = last.prevValue;
  const el = getBattleCellEl(last.row, last.col);
  if (el) {
    el.textContent = last.prevValue || '';
    el.classList.remove('battle-correct', 'battle-error');
    if (last.prevValue && last.prevValue === solution[last.row][last.col]) {
      el.classList.add('battle-correct');
    }
  }
  updateBattleNumpadCounts();
});

document.querySelectorAll('#battle-numpad .num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (selectedRow === -1 || !board) return;
    const value = parseInt(btn.dataset.num);
    if (noteMode) {
      // Notas en batalla: solo local, sin sincronizar
      handleBattleNote(selectedRow, selectedCol, value);
    } else {
      socket.emit('battle-move', { row: selectedRow, col: selectedCol, value });
    }
  });
});

// Teclado
document.addEventListener('keydown', e => {
  if (!board) return;
  const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr,dc] = moves[e.key];
    const nr = Math.max(0, Math.min(8, (selectedRow<0?0:selectedRow)+dr));
    const nc = Math.max(0, Math.min(8, (selectedCol<0?0:selectedCol)+dc));
    onBattleCellClick(nr, nc); return;
  }
  if (e.key >= '1' && e.key <= '9' && selectedRow !== -1) {
    socket.emit('battle-move', { row: selectedRow, col: selectedCol, value: parseInt(e.key) });
    return;
  }
  if ((e.key === 'Delete'||e.key === 'Backspace') && selectedRow !== -1) {
    if (!board[selectedRow][selectedCol].fixed)
      socket.emit('battle-move', { row: selectedRow, col: selectedCol, value: 0 });
  }
});

// ============================================================
// RENDERIZAR TABLERO DE BATALLA
// ============================================================
function renderBattleBoard() {
  const boardEl = document.getElementById('battle-board');
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
  updateBattleNumpadCounts();
}

function onBattleCellClick(row, col) {
  if (board[row][col].fixed) return;
  selectedRow = row; selectedCol = col;

  document.querySelectorAll('#battle-board .cell').forEach(el => {
    const r = parseInt(el.dataset.row);
    const c = parseInt(el.dataset.col);
    el.classList.remove('selected', 'highlight', 'same-num');

    if (r === row && c === col) { el.classList.add('selected'); return; }
    if (r === row || c === col ||
      (Math.floor(r/3)===Math.floor(row/3) && Math.floor(c/3)===Math.floor(col/3))) {
      el.classList.add('highlight');
    }
    const selVal = board[row][col].value;
    if (selVal && board[r][c].value === selVal) el.classList.add('same-num');
  });
}

function getBattleCellEl(row, col) {
  return document.querySelector(`#battle-board [data-row="${row}"][data-col="${col}"]`);
}

function handleBattleNote(row, col, num) {
  // Notas solo locales en batalla
  if (!board[row][col].notes) board[row][col].notes = [];
  const idx = board[row][col].notes.indexOf(num);
  if (idx === -1) board[row][col].notes.push(num);
  else            board[row][col].notes.splice(idx, 1);

  const el = getBattleCellEl(row, col);
  if (!el) return;
  el.innerHTML = '';
  if (board[row][col].notes.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'notes-grid';
    for (let n = 1; n <= 9; n++) {
      const span = document.createElement('span');
      span.className = 'note-num';
      if (board[row][col].notes.includes(n)) span.textContent = n;
      grid.appendChild(span);
    }
    el.appendChild(grid);
  }
}

function updateBattleNumpadCounts() {
  if (!board) return;
  const counts = {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0};
  for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
    const v = board[r][c].value;
    if (v) counts[v]++;
  }
  document.querySelectorAll('#battle-numpad .num-btn').forEach(btn => {
    const num = parseInt(btn.dataset.num);
    const rem = 9 - counts[num];
    const ce  = btn.querySelector('.num-count');
    if (ce) ce.textContent = rem > 0 ? rem : '';
    btn.classList.toggle('depleted', rem === 0);
  });
}

// ============================================================
// TIMER
// ============================================================
function startBattleTimer(from) {
  startTime = from;
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('battle-timer').textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() { clearInterval(timerInterval); }

function formatTime(s) {
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

// ============================================================
// PROGRESO
// ============================================================
function updateMyProgress(correct) {
  myCorrectCells = correct;
  const pct = totalCells > 0 ? (myCorrectCells / totalCells) * 100 : 0;
  const fill = document.getElementById('your-progress-fill');
  if (fill) fill.style.width = `${pct}%`;
  const counter = document.getElementById('your-cells-count');
  if (counter) counter.textContent = myCorrectCells;
}

function updateOppProgress(correct) {
  oppCorrect = correct;
  const pct = totalCells > 0 ? (oppCorrect / totalCells) * 100 : 0;
  const fill = document.getElementById('opp-progress-fill');
  if (fill) fill.style.width = `${pct}%`;
  const counter = document.getElementById('opp-cells-display');
  if (counter) counter.textContent = oppCorrect;
}

function updateErrorDots(errors) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`battle-error-dot-${i}`);
    if (dot) dot.classList.toggle('error-dot-used', i <= errors);
  }
}

function showPenalty(secs) {
  const penaltyEl = document.getElementById('battle-penalty');
  const secsEl    = document.getElementById('penalty-secs');
  if (!penaltyEl || !secsEl) return;
  secsEl.textContent = secs;
  penaltyEl.classList.remove('hidden');
  penaltyEl.classList.add('penalty-flash');
  setTimeout(() => {
    penaltyEl.classList.remove('penalty-flash');
    setTimeout(() => penaltyEl.classList.add('hidden'), 2000);
  }, 1000);
}

// ============================================================
// RESULTADO FINAL
// ============================================================
function showResult({ won, reason, elapsed, errors, penalty, opponentName, opponentTime }) {
  stopTimer();

  const resultScreen = document.getElementById('battle-result');
  const emoji   = document.getElementById('result-emoji');
  const title   = document.getElementById('result-title');
  const subtitle = document.getElementById('result-subtitle');
  const timeEl  = document.getElementById('result-time');
  const errorsEl = document.getElementById('result-errors');
  const penaltyEl = document.getElementById('result-penalty');

  if (won) {
    emoji.textContent    = '🏆';
    title.textContent    = '¡Ganaste!';
    subtitle.textContent = reason === 'opponent_errors'
      ? `${opponentName} cometió demasiados errores`
      : `Terminaste primero · ${opponentName}: ${formatTime(opponentTime||0)}`;
    launchBattleConfetti();
  } else {
    emoji.textContent    = '😤';
    title.textContent    = 'Perdiste';
    subtitle.textContent = reason === 'errors'
      ? 'Cometiste demasiados errores'
      : `${opponentName} terminó primero · Su tiempo: ${formatTime(opponentTime||0)}`;
  }

  timeEl.textContent    = formatTime(elapsed || 0);
  errorsEl.textContent  = errors || 0;
  penaltyEl.textContent = `+${penalty || 0}s`;

  resultScreen.classList.remove('hidden');
}

function launchBattleConfetti() {
  const canvas = document.getElementById('battle-confetti');
  const ctx = canvas.getContext('2d');
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  const pts = Array.from({length:120},()=>({
    x:Math.random()*canvas.width,y:-20,
    w:Math.random()*10+5,h:Math.random()*6+3,
    color:['#e02454','#f59e0b','#2563eb','#10b981'][Math.floor(Math.random()*4)],
    speed:Math.random()*4+2,angle:Math.random()*360,spin:Math.random()*6-3,drift:Math.random()*2-1,
  }));
  let n=0;
  (function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height); n++;
    pts.forEach(p=>{
      p.y+=p.speed;p.x+=p.drift;p.angle+=p.spin;
      ctx.save();ctx.translate(p.x+p.w/2,p.y+p.h/2);ctx.rotate(p.angle*Math.PI/180);
      ctx.fillStyle=p.color;ctx.globalAlpha=Math.max(0,1-n/180);
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();
    });
    if(n<200) requestAnimationFrame(draw);
  })();
}

// ============================================================
// BOTONES DE RESULTADO
// ============================================================
document.getElementById('btn-rematch').addEventListener('click', () => {
  document.getElementById('battle-result').classList.add('hidden');
  showScreen('search');
  board = null; selectedRow = -1; selectedCol = -1;
  myErrors = 0; myPenalty = 0; myCorrectCells = 0; oppCorrect = 0;
  undoStack = [];
});

document.getElementById('btn-back-home').addEventListener('click', () => {
  window.location.href = '/';
});

// ============================================================
// TOAST
// ============================================================
function showToast(msg) {
  const el = document.getElementById('battle-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function playSound(fn) {
  if (!soundEnabled) return;
  try { fn(); } catch(e) {}
}

// ============================================================
// EVENTOS DEL SERVIDOR
// ============================================================

socket.on('battle-waiting', ({ message }) => {
  showScreen('waiting');
});

socket.on('battle-search-cancelled', () => {
  showScreen('search');
});

socket.on('battle-private-created', ({ code, playerIndex: pi, puzzle: puz, solution: sol }) => {
  battleCode   = code;
  playerIndex  = pi;
  solution     = sol;
  board        = puz;

  document.getElementById('private-code-display').textContent = code;
  showScreen('privateWait');
});

socket.on('battle-start', ({ code, playerIndex: pi, puzzle: puz, solution: sol, opponentName, totalCells: tc, startTime: st }) => {
  battleCode  = code;
  playerIndex = pi;
  solution    = sol;
  board       = puz;
  totalCells  = tc;

  // Nombres en la barra de progreso
  const yourName = document.getElementById('your-progress-name');
  const oppName  = document.getElementById('opp-progress-name');
  const total    = document.getElementById('total-cells-display');
  if (yourName) yourName.textContent = playerName;
  if (oppName)  oppName.textContent  = opponentName;
  if (total)    total.textContent    = `/ ${tc}`;

  showScreen('battle');
  renderBattleBoard();
  startBattleTimer(st);
});

socket.on('battle-cell-result', ({ row, col, value, correct, errors, penalty }) => {
  myErrors  = errors;
  myPenalty = penalty;

  const prevVal = board[row][col].value;
  board[row][col].value = value;

  const el = getBattleCellEl(row, col);
  if (!el) return;

  el.classList.remove('battle-correct', 'battle-error', 'correct', 'error');
  el.innerHTML = '';

  if (value !== 0) {
    el.textContent = value;
    if (correct) {
      el.classList.add('correct', 'correct-flash');
      setTimeout(() => el.classList.remove('correct-flash'), 600);
      playSound(soundCorrect);
      if (navigator.vibrate) navigator.vibrate(40);
      myCorrectCells++;
      updateMyProgress(myCorrectCells);
      undoStack.push({ row, col, prevValue: prevVal });
    } else {
      el.classList.add('error');
      el.style.color = '#ef4444';
      playSound(soundError);
      if (navigator.vibrate) navigator.vibrate([60,40,60]);
      updateErrorDots(errors);
      showPenalty(penalty);
    }
  } else {
    // Borrado
    if (prevVal && prevVal === solution[row][col]) {
      myCorrectCells = Math.max(0, myCorrectCells - 1);
      updateMyProgress(myCorrectCells);
    }
  }

  updateBattleNumpadCounts();
});

socket.on('battle-opponent-progress', ({ correctCells, totalCells: tc }) => {
  updateOppProgress(correctCells);
});

socket.on('battle-opponent-error', ({ errors }) => {
  showToast(`⚠️ Tu oponente cometió un error (${errors}/3)`);
});

socket.on('battle-won', ({ reason, elapsed, errors, penalty, opponentName, opponentTime }) => {
  showResult({ won: true, reason, elapsed, errors, penalty, opponentName, opponentTime });
});

socket.on('battle-lost', ({ reason, opponentName, opponentTime }) => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  showResult({ won: false, reason, elapsed, errors: myErrors, penalty: myPenalty, opponentName, opponentTime });
});

socket.on('battle-opponent-disconnected', () => {
  stopTimer();
  showToast('Tu oponente se desconectó. ¡Ganaste por abandono!');
  setTimeout(() => showResult({
    won: true, reason: 'disconnect',
    elapsed: Math.floor((Date.now() - startTime) / 1000),
    errors: myErrors, penalty: myPenalty,
  }), 2000);
});
