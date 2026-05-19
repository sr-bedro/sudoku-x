const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// SUDOKU X — Generador y solver
// ============================================================

function createEmptyBoard() {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

function isValid(board, row, col, num) {
  for (let c = 0; c < 9; c++) if (board[row][c] === num) return false;
  for (let r = 0; r < 9; r++) if (board[r][col] === num) return false;
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++)
    for (let c = bc; c < bc + 3; c++)
      if (board[r][c] === num) return false;
  if (row === col)
    for (let i = 0; i < 9; i++) if (board[i][i] === num) return false;
  if (row + col === 8)
    for (let i = 0; i < 9; i++) if (board[i][8 - i] === num) return false;
  return true;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function solve(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        for (const n of shuffle([1,2,3,4,5,6,7,8,9])) {
          if (isValid(board, r, c, n)) {
            board[r][c] = n;
            if (solve(board)) return true;
            board[r][c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

// Niveles de dificultad: cantidad de celdas a eliminar
const DIFFICULTY_HOLES = {
  easy:    26,   // 55 pistas
  normal:  36,   // 45 pistas
  hard:    46,   // 35 pistas
  expert:  53,   // 28 pistas
  extreme: 58,   // 23 pistas
};

function generateSudokuX(difficulty = 'hard') {
  const holes = DIFFICULTY_HOLES[difficulty] ?? DIFFICULTY_HOLES.hard;
  const sol   = createEmptyBoard();
  solve(sol);
  const puz = sol.map(r => [...r]);
  const pos = shuffle(Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9]));
  let removed = 0;
  for (const [r, c] of pos) {
    if (removed >= holes) break;
    puz[r][c] = 0;
    removed++;
  }
  return { puzzle: puz, solution: sol };
}

function isBoardComplete(board, solution) {
  if (!solution) return false;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c].value !== solution[r][c]) return false;
  return true;
}

function buildRoom(puzzle, solution, playerName = 'Jugador 1', difficulty = 'hard') {
  return {
    solution, difficulty,
    originalPuzzle: puzzle.map(r => [...r]),
    board: puzzle.map(row => row.map(cell => ({
      value: cell, player: null, fixed: cell !== 0, notes: [],
    }))),
    players: [
      { id: null, color: '#2563eb', name: playerName, connected: false, cursor: null, errors: 0 }
    ],
    startTime: null, savedElapsed: 0,
    completedSections: { rows: new Set(), cols: new Set(), boxes: new Set() },
    soloMode: true,
  };
}

function resetBoard(room) {
  room.board = room.originalPuzzle.map(row => row.map(cell => ({
    value: cell, player: null, fixed: cell !== 0, notes: [],
  })));
  room.startTime   = Date.now();
  room.savedElapsed = 0;
  room.completedSections = { rows: new Set(), cols: new Set(), boxes: new Set() };
  room.players.forEach(p => { p.errors = 0; });
  room.soloMode = false;
}

function checkSections(room, row, col) {
  const { board, solution, completedSections } = room;
  const completed = [];
  if (!completedSections.rows.has(row)) {
    const ok = board[row].every((cell, c) => cell.value !== 0 && cell.value === solution[row][c]);
    if (ok) { completedSections.rows.add(row); completed.push({ type: 'row', index: row }); }
  }
  if (!completedSections.cols.has(col)) {
    const ok = board.every((r, ri) => r[col].value !== 0 && r[col].value === solution[ri][col]);
    if (ok) { completedSections.cols.add(col); completed.push({ type: 'col', index: col }); }
  }
  const boxRow = Math.floor(row / 3), boxCol = Math.floor(col / 3), boxKey = boxRow * 3 + boxCol;
  if (!completedSections.boxes.has(boxKey)) {
    let ok = true;
    for (let r = boxRow * 3; r < boxRow * 3 + 3; r++)
      for (let c = boxCol * 3; c < boxCol * 3 + 3; c++)
        if (board[r][c].value === 0 || board[r][c].value !== solution[r][c]) ok = false;
    if (ok) { completedSections.boxes.add(boxKey); completed.push({ type: 'box', boxRow, boxCol }); }
  }
  return completed;
}

// ============================================================
// SALAS COOPERATIVAS
// ============================================================

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  socket.on('create-room', ({ difficulty = 'hard', playerName = 'Jugador 1' } = {}) => {
    const code = generateRoomCode();
    const { puzzle, solution } = generateSudokuX(difficulty);
    rooms[code] = buildRoom(puzzle, solution, playerName, difficulty);
    socket.emit('room-created', { code, board: rooms[code].board, solution, playerIndex: 0 });
  });

  socket.on('create-room-from-save', ({ board: savedBoard, solution: savedSolution, playerName, elapsed, difficulty }) => {
    const code = generateRoomCode();
    rooms[code] = {
      solution: savedSolution, difficulty: difficulty || 'hard',
      originalPuzzle: savedBoard.map(row => row.map(c => c.fixed ? c.value : 0)),
      board: savedBoard,
      players: [{ id: null, color: '#2563eb', name: playerName || 'Jugador 1', connected: false, cursor: null, errors: 0 }],
      startTime: null, savedElapsed: elapsed || 0,
      completedSections: { rows: new Set(), cols: new Set(), boxes: new Set() },
      soloMode: true,
    };
    socket.emit('room-created', {
      code, board: rooms[code].board, solution: savedSolution,
      playerIndex: 0, savedElapsed: elapsed || 0,
    });
  });

  socket.on('create-custom-room', (puzzle) => {
    const code = generateRoomCode();
    const puzzleForSolver = puzzle.map(row => [...row]);
    if (!solve(puzzleForSolver)) { socket.emit('error', 'El tablero no tiene solución válida.'); return; }
    rooms[code] = buildRoom(puzzle, puzzleForSolver, 'Jugador 1', 'custom');
    socket.emit('room-created', { code, board: rooms[code].board, solution: puzzleForSolver, playerIndex: 0 });
  });

  socket.on('join-room', ({ code, playerName = 'Jugador 2' }) => {
    code = code.toUpperCase();
    if (!rooms[code])                    { socket.emit('error', 'Sala no encontrada'); return; }
    if (rooms[code].players.length >= 2) { socket.emit('error', 'Sala llena');         return; }
    rooms[code].players.push({ id: null, color: '#7c3aed', name: playerName, connected: false, cursor: null, errors: 0 });
    socket.emit('room-joined', { code, board: rooms[code].board, playerIndex: 1 });
  });

  socket.on('rejoin-room', ({ code, playerIndex, playerName }) => {
    if (!rooms[code]) { socket.emit('error', 'Sala expirada'); return; }
    socket.join(code);
    socket.roomCode    = code;
    socket.playerIndex = playerIndex;

    const room = rooms[code];
    if (room.players[playerIndex]) {
      room.players[playerIndex].id        = socket.id;
      room.players[playerIndex].connected = true;
      if (playerName) room.players[playerIndex].name = playerName;
    }

    const connected = room.players.filter(p => p.connected);

    if (connected.length === 1 && playerIndex === 0) {
      // Modo solo — arranca inmediatamente
      if (!room.startTime) room.startTime = Date.now();
      room.soloMode = true;
      socket.emit('game-start', {
        board:        room.board,
        startTime:    room.startTime,
        savedElapsed: room.savedElapsed || 0,
        players:      room.players.map(p => ({ name: p.name, color: p.color })),
        difficulty:   room.difficulty,
        solo:         true,
      });
    } else if (connected.length === 2) {
      // Modo cooperativo — resetear tablero y timer
      resetBoard(room);
      io.to(code).emit('partner-joined', {
        board:      room.board,
        startTime:  room.startTime,
        players:    room.players.map(p => ({ name: p.name, color: p.color })),
        difficulty: room.difficulty,
      });
    } else {
      socket.emit('board-update-full', { board: room.board });
    }
  });

  socket.on('cursor-move', ({ row, col }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    socket.to(code).emit('opponent-cursor', { row, col });
  });

  socket.on('make-move', ({ row, col, value }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room   = rooms[code];
    const cell   = room.board[row][col];
    if (cell.fixed) return;
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;
    const player = room.players[pi];

    const prevState = { prevValue: cell.value, prevPlayer: cell.player, prevNotes: [...(cell.notes || [])] };
    room.board[row][col] = { value, player: value === 0 ? null : player.color, fixed: false, notes: [] };

    const correct = value === 0 || !room.solution || value === room.solution[row][col];
    if (!correct && value !== 0) player.errors++;

    io.to(code).emit('board-update', { row, col, value, playerColor: player.color, correct, notes: [], prevState });

    if (correct && value !== 0 && room.solution) {
      const sections = checkSections(room, row, col);
      if (sections.length > 0) io.to(code).emit('sections-complete', { sections });
    }

    if (room.board.every(r => r.every(c => c.value !== 0)) && isBoardComplete(room.board, room.solution)) {
      const elapsed = room.startTime
        ? Math.floor((Date.now() - room.startTime) / 1000) + (room.savedElapsed || 0)
        : 0;
      io.to(code).emit('game-won', {
        elapsed, errors: room.players.reduce((s, p) => s + (p.errors || 0), 0), difficulty: room.difficulty,
      });
    }
  });

  socket.on('make-note', ({ row, col, num }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const cell = rooms[code].board[row][col];
    if (cell.fixed || cell.value !== 0) return;
    const pi = rooms[code].players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;
    const prevNotes = [...(cell.notes || [])];
    const idx = cell.notes.indexOf(num);
    if (idx === -1) { cell.notes.push(num); cell.notes.sort((a, b) => a - b); }
    else            { cell.notes.splice(idx, 1); }
    io.to(code).emit('note-update', { row, col, notes: cell.notes, prevNotes });
  });

  socket.on('undo-move', ({ row, col, prevValue, prevNotes, prevPlayer }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const cell = rooms[code].board[row][col];
    if (cell.fixed) return;
    rooms[code].board[row][col] = { value: prevValue, player: prevPlayer, fixed: false, notes: prevNotes || [] };
    io.to(code).emit('undo-confirmed', { row, col, value: prevValue, player: prevPlayer, notes: prevNotes || [] });
  });

  socket.on('host-leave', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    if (socket.playerIndex !== 0) return;
    socket.to(code).emit('host-left');
    delete rooms[code];
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      const pi = rooms[code].players.findIndex(p => p.id === socket.id);
      if (pi !== -1) {
        rooms[code].players[pi].connected = false;
        rooms[code].players[pi].id        = null;
        if (pi === 0) { socket.to(code).emit('host-left'); delete rooms[code]; }
        else {
          io.to(code).emit('player-disconnected');
          socket.to(code).emit('opponent-cursor', { row: -1, col: -1 });
        }
      }
    }
    const qIdx = battleQueue.findIndex(p => p.id === socket.id);
    if (qIdx !== -1) battleQueue.splice(qIdx, 1);
    const bCode = socket.battleCode;
    if (bCode && battleRooms[bCode]) {
      const opp = battleRooms[bCode].players.find(p => p.id !== socket.id);
      if (opp) io.to(opp.id).emit('battle-opponent-disconnected');
      delete battleRooms[bCode];
    }
    console.log('Desconectado:', socket.id);
  });
});

// ============================================================
// BATALLA — sin límite de errores ni penalización de tiempo
// ============================================================

const battleQueue = [];
const battleRooms = {};

function generateBattleCode() {
  return 'B' + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function buildBattleRoom(puzzle, solution, players) {
  const emptyCount = puzzle.flat().filter(c => c === 0).length;
  return {
    puzzle, solution,
    players: players.map((p, i) => ({
      id: p.id, name: p.name,
      color:        i === 0 ? '#e02454' : '#f59e0b',
      board:        puzzle.map(row => row.map(cell => ({ value: cell, fixed: cell !== 0, notes: [] }))),
      correctCells: 0,
      errors:       0,
      finished:     false,
      finishTime:   null,
    })),
    startTime:  null,
    totalCells: emptyCount,
    status:     'waiting',
  };
}

io.on('connection', (socket) => {

  socket.on('battle-find-match', ({ playerName, difficulty = 'hard' }) => {
    if (battleQueue.length === 0) {
      battleQueue.push({ id: socket.id, name: playerName, difficulty, socket });
      socket.emit('battle-waiting', {});
      return;
    }
    const opp  = battleQueue.splice(0, 1)[0];
    const code = generateBattleCode();
    const { puzzle, solution } = generateSudokuX(difficulty);

    battleRooms[code] = buildBattleRoom(puzzle, solution, [
      { id: opp.id, name: opp.name },
      { id: socket.id, name: playerName },
    ]);
    opp.socket.join(code); socket.join(code);
    opp.socket.battleCode = code; socket.battleCode = code;
    battleRooms[code].startTime = Date.now();
    battleRooms[code].status    = 'playing';

    const room = battleRooms[code];
    const base = { code, solution, totalCells: room.totalCells, startTime: room.startTime };
    opp.socket.emit('battle-start', { ...base, playerIndex: 0, puzzle: room.players[0].board, opponentName: playerName });
    socket.emit('battle-start',     { ...base, playerIndex: 1, puzzle: room.players[1].board, opponentName: opp.name });
  });

  socket.on('battle-create-private', ({ playerName, difficulty = 'hard' }) => {
    const code = generateBattleCode();
    const { puzzle, solution } = generateSudokuX(difficulty);
    battleRooms[code] = buildBattleRoom(puzzle, solution, [{ id: socket.id, name: playerName }]);
    socket.join(code); socket.battleCode = code;
    socket.emit('battle-private-created', { code, playerIndex: 0, puzzle: battleRooms[code].players[0].board, solution });
  });

  socket.on('battle-join-private', ({ code, playerName }) => {
    code = code.toUpperCase();
    const room = battleRooms[code];
    if (!room)                    { socket.emit('error', 'Sala no encontrada'); return; }
    if (room.players.length >= 2) { socket.emit('error', 'Sala llena');         return; }

    room.players.push({
      id: socket.id, name: playerName, color: '#f59e0b',
      board:        room.puzzle.map(row => row.map(cell => ({ value: cell, fixed: cell !== 0, notes: [] }))),
      correctCells: 0, errors: 0, finished: false, finishTime: null,
    });
    socket.join(code); socket.battleCode = code;
    room.startTime = Date.now(); room.status = 'playing';

    const base = { code, solution: room.solution, totalCells: room.totalCells, startTime: room.startTime };
    io.to(room.players[0].id).emit('battle-start', { ...base, playerIndex: 0, puzzle: room.players[0].board, opponentName: playerName });
    socket.emit('battle-start',                    { ...base, playerIndex: 1, puzzle: room.players[1].board, opponentName: room.players[0]?.name || 'Oponente' });
  });

  socket.on('battle-move', ({ row, col, value }) => {
    const code = socket.battleCode;
    if (!code || !battleRooms[code]) return;
    const room = battleRooms[code];
    if (room.status !== 'playing') return;
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;
    const player = room.players[pi];
    const cell   = player.board[row][col];
    if (cell.fixed || player.finished) return;

    const prevValue = cell.value;
    cell.value      = value;
    const correct   = value === 0 || value === room.solution[row][col];

    if (value === 0) {
      // Borrar — si la celda tenía un valor correcto, restamos
      if (prevValue !== 0 && prevValue === room.solution[row][col]) {
        player.correctCells = Math.max(0, player.correctCells - 1);
      }
      socket.emit('battle-cell-result', { row, col, value: 0, correct: true, errors: player.errors });
    } else if (!correct) {
      // Error — solo contamos, sin penalización de tiempo
      player.errors++;
      socket.emit('battle-cell-result', { row, col, value, correct: false, errors: player.errors });
      const oppId = room.players[pi === 0 ? 1 : 0]?.id;
      if (oppId) io.to(oppId).emit('battle-opponent-error', { errors: player.errors });
    } else {
      // Correcto
      player.correctCells++;
      socket.emit('battle-cell-result', { row, col, value, correct: true, errors: player.errors });
      const oppId = room.players[pi === 0 ? 1 : 0]?.id;
      if (oppId) io.to(oppId).emit('battle-opponent-progress', { correctCells: player.correctCells, totalCells: room.totalCells });

      if (player.correctCells >= room.totalCells) {
        player.finished   = true;
        player.finishTime = Math.floor((Date.now() - room.startTime) / 1000);
        socket.emit('battle-won', { reason: 'completed', elapsed: player.finishTime, errors: player.errors });
        const opp = room.players[pi === 0 ? 1 : 0];
        if (opp) io.to(opp.id).emit('battle-lost', { reason: 'opponent_finished', opponentName: player.name, opponentTime: player.finishTime });
        room.status = 'finished';
      }
    }
  });

  socket.on('battle-cancel-search', () => {
    const idx = battleQueue.findIndex(p => p.id === socket.id);
    if (idx !== -1) battleQueue.splice(idx, 1);
    socket.emit('battle-search-cancelled');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
