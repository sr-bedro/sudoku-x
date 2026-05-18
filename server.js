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
  // Diagonales Sudoku X
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

function generateSudokuX(difficulty = 'hard') {
  const sol = createEmptyBoard();
  solve(sol);
  const puz = sol.map(r => [...r]);
  const remove = difficulty === 'hard' ? 55 : difficulty === 'medium' ? 45 : 35;
  const pos = shuffle(Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9]));
  let removed = 0;
  for (const [r, c] of pos) {
    if (removed >= remove) break;
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
    board: puzzle.map(row => row.map(cell => ({
      value: cell, player: null, fixed: cell !== 0, notes: [],
    }))),
    players: [
      { id: null, color: '#2563eb', name: playerName, connected: false, cursor: null, errors: 0 }
    ],
    startTime: null, savedElapsed: 0,
    completedSections: { rows: new Set(), cols: new Set(), boxes: new Set() },
  };
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
      board: savedBoard,
      players: [{ id: null, color: '#2563eb', name: playerName || 'Jugador 1', connected: false, cursor: null, errors: 0 }],
      startTime: null, savedElapsed: elapsed || 0,
      completedSections: { rows: new Set(), cols: new Set(), boxes: new Set() },
    };
    socket.emit('room-created', { code, board: rooms[code].board, solution: savedSolution, playerIndex: 0, savedElapsed: elapsed || 0 });
  });

  // Recibe el puzzle como array directo (fix vs versión anterior)
  socket.on('create-custom-room', (puzzle) => {
    const code = generateRoomCode();
    const puzzleForSolver = puzzle.map(row => [...row]);
    if (!solve(puzzleForSolver)) {
      socket.emit('error', 'El tablero no tiene solución válida.');
      return;
    }
    rooms[code] = buildRoom(puzzle, puzzleForSolver, 'Jugador 1', 'custom');
    socket.emit('room-created', {
      code,
      board:       rooms[code].board,
      solution:    puzzleForSolver,
      playerIndex: 0,
    });
  });

  socket.on('join-room', ({ code, playerName = 'Jugador 2' }) => {
    code = code.toUpperCase();
    if (!rooms[code])                    { socket.emit('error', 'Sala no encontrada'); return; }
    if (rooms[code].players.length >= 2) { socket.emit('error', 'Sala llena');         return; }
    rooms[code].players.push({ id: null, color: '#7c3aed', name: playerName, connected: false, cursor: null, errors: 0 });
    socket.emit('room-joined', { code, board: rooms[code].board, playerIndex: 1 });
    socket.to(code).emit('player-joined', { name: playerName });
  });

  socket.on('rejoin-room', ({ code, playerIndex, playerName }) => {
    if (!rooms[code]) { socket.emit('error', 'Sala expirada'); return; }
    socket.join(code);
    socket.roomCode    = code;
    socket.playerIndex = playerIndex;
    if (rooms[code].players[playerIndex]) {
      rooms[code].players[playerIndex].id        = socket.id;
      rooms[code].players[playerIndex].connected = true;
      if (playerName) rooms[code].players[playerIndex].name = playerName;
    }
    socket.emit('board-update-full', { board: rooms[code].board });
    const listos = rooms[code].players.length === 2 && rooms[code].players.every(p => p.connected);
    if (listos) {
      if (!rooms[code].startTime) rooms[code].startTime = Date.now();
      io.to(code).emit('game-start', {
        board:        rooms[code].board,
        startTime:    rooms[code].startTime,
        savedElapsed: rooms[code].savedElapsed || 0,
        players:      rooms[code].players.map(p => ({ name: p.name, color: p.color })),
      });
    }
  });

  socket.on('cursor-move', ({ row, col }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const pi = rooms[code].players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;
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

    const allFilled = room.board.every(r => r.every(c => c.value !== 0));
    if (allFilled && isBoardComplete(room.board, room.solution)) {
      const elapsed = room.startTime
        ? Math.floor((Date.now() - room.startTime) / 1000) + (room.savedElapsed || 0)
        : 0;
      const totalErrors = room.players.reduce((sum, p) => sum + (p.errors || 0), 0);
      io.to(code).emit('game-won', { elapsed, errors: totalErrors, difficulty: room.difficulty });
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
        if (pi === 0) {
          socket.to(code).emit('host-left');
          delete rooms[code];
        } else {
          io.to(code).emit('player-disconnected');
          socket.to(code).emit('opponent-cursor', { row: -1, col: -1 });
        }
      }
    }
    // Matchmaking cleanup
    const qIdx = battleQueue.findIndex(p => p.id === socket.id);
    if (qIdx !== -1) battleQueue.splice(qIdx, 1);
    // Battle room cleanup
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
// BATALLA — Matchmaking y salas competitivas
// ============================================================

const battleQueue = [];
const battleRooms = {};

const BATTLE_MAX_ERRORS    = 3;
const BATTLE_ERROR_PENALTY = 30;

function generateBattleCode() {
  return 'B' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function buildBattleRoom(puzzle, solution, players) {
  return {
    puzzle, solution,
    players: players.map((p, i) => ({
      id:           p.id,
      name:         p.name,
      color:        i === 0 ? '#e02454' : '#f59e0b',
      board:        puzzle.map(row => row.map(cell => ({
        value: cell, fixed: cell !== 0, notes: [],
      }))),
      correctCells: 0,
      totalEmpty:   puzzle.flat().filter(c => c === 0).length,
      errors:       0,
      penalty:      0,
      finished:     false,
      finishTime:   null,
    })),
    startTime:  null,
    totalCells: puzzle.flat().filter(c => c === 0).length,
    status:     'waiting',
  };
}

io.on('connection', (socket) => {

  socket.on('battle-find-match', ({ playerName, difficulty = 'hard' }) => {
    // Buscar oponente en cola
    const oppIdx = battleQueue.findIndex(p => p.difficulty === difficulty || battleQueue.length > 0);
    if (oppIdx === -1 || battleQueue.length === 0) {
      battleQueue.push({ id: socket.id, name: playerName, difficulty, socket });
      socket.emit('battle-waiting', { message: 'Buscando oponente...' });
      return;
    }
    const opp  = battleQueue.splice(oppIdx, 1)[0];
    const code = generateBattleCode();
    const { puzzle, solution } = generateSudokuX(difficulty);

    battleRooms[code] = buildBattleRoom(puzzle, solution, [
      { id: opp.id, name: opp.name },
      { id: socket.id, name: playerName },
    ]);

    opp.socket.join(code);
    socket.join(code);
    opp.socket.battleCode = code;
    socket.battleCode     = code;
    battleRooms[code].startTime = Date.now();
    battleRooms[code].status    = 'playing';

    const room = battleRooms[code];

    opp.socket.emit('battle-start', {
      code, playerIndex: 0,
      puzzle:       room.players[0].board,
      solution,
      opponentName: playerName,
      totalCells:   room.totalCells,
      startTime:    room.startTime,
    });
    socket.emit('battle-start', {
      code, playerIndex: 1,
      puzzle:       room.players[1].board,
      solution,
      opponentName: opp.name,
      totalCells:   room.totalCells,
      startTime:    room.startTime,
    });
  });

  socket.on('battle-create-private', ({ playerName, difficulty = 'hard' }) => {
    const code = generateBattleCode();
    const { puzzle, solution } = generateSudokuX(difficulty);
    battleRooms[code] = buildBattleRoom(puzzle, solution, [{ id: socket.id, name: playerName }]);
    socket.join(code);
    socket.battleCode = code;
    socket.emit('battle-private-created', {
      code, playerIndex: 0,
      puzzle:   battleRooms[code].players[0].board,
      solution,
    });
  });

  socket.on('battle-join-private', ({ code, playerName }) => {
    code = code.toUpperCase();
    const room = battleRooms[code];
    if (!room)                    { socket.emit('error', 'Sala de batalla no encontrada'); return; }
    if (room.players.length >= 2) { socket.emit('error', 'Sala de batalla llena');         return; }

    room.players.push({
      id:           socket.id,
      name:         playerName,
      color:        '#f59e0b',
      board:        room.puzzle.map(row => row.map(cell => ({ value: cell, fixed: cell !== 0, notes: [] }))),
      correctCells: 0,
      totalEmpty:   room.totalCells,
      errors:       0,
      penalty:      0,
      finished:     false,
      finishTime:   null,
    });

    socket.join(code);
    socket.battleCode = code;
    room.startTime = Date.now();
    room.status    = 'playing';

    io.to(room.players[0].id).emit('battle-start', {
      code, playerIndex: 0,
      puzzle:       room.players[0].board,
      solution:     room.solution,
      opponentName: playerName,
      totalCells:   room.totalCells,
      startTime:    room.startTime,
    });
    socket.emit('battle-start', {
      code, playerIndex: 1,
      puzzle:       room.players[1].board,
      solution:     room.solution,
      opponentName: room.players[0]?.name || 'Oponente',
      totalCells:   room.totalCells,
      startTime:    room.startTime,
    });
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

    cell.value   = value;
    const correct = value === 0 || value === room.solution[row][col];

    if (!correct && value !== 0) {
      player.errors++;
      player.penalty += BATTLE_ERROR_PENALTY;
      socket.emit('battle-cell-result', { row, col, value, correct: false, errors: player.errors, penalty: player.penalty });

      if (player.errors >= BATTLE_MAX_ERRORS) {
        player.finished = true;
        socket.emit('battle-lost', { reason: 'errors', errors: player.errors });
        const winner = room.players[pi === 0 ? 1 : 0];
        if (winner) io.to(winner.id).emit('battle-won', {
          reason: 'opponent_errors',
          elapsed: Math.floor((Date.now() - room.startTime) / 1000) + winner.penalty,
          opponentName: player.name,
        });
        room.status = 'finished';
        return;
      }
      const oppId = room.players[pi === 0 ? 1 : 0]?.id;
      if (oppId) io.to(oppId).emit('battle-opponent-error', { errors: player.errors });

    } else if (correct && value !== 0) {
      player.correctCells++;
      socket.emit('battle-cell-result', { row, col, value, correct: true, errors: player.errors, penalty: player.penalty });
      const oppId = room.players[pi === 0 ? 1 : 0]?.id;
      if (oppId) io.to(oppId).emit('battle-opponent-progress', {
        correctCells: player.correctCells,
        totalCells:   room.totalCells,
      });

      if (player.correctCells >= player.totalEmpty) {
        player.finished   = true;
        player.finishTime = Math.floor((Date.now() - room.startTime) / 1000) + player.penalty;
        socket.emit('battle-won', {
          reason: 'completed', elapsed: player.finishTime,
          errors: player.errors, penalty: player.penalty,
        });
        const opp = room.players[pi === 0 ? 1 : 0];
        if (opp) io.to(opp.id).emit('battle-lost', {
          reason: 'opponent_finished',
          opponentName: player.name,
          opponentTime: player.finishTime,
        });
        room.status = 'finished';
      }
    } else {
      // Borrar celda
      if (cell.value !== 0) player.correctCells = Math.max(0, player.correctCells - 1);
      cell.value = 0;
      socket.emit('battle-cell-result', { row, col, value: 0, correct: true, errors: player.errors, penalty: player.penalty });
    }
  });

  socket.on('battle-cancel-search', () => {
    const idx = battleQueue.findIndex(p => p.id === socket.id);
    if (idx !== -1) battleQueue.splice(idx, 1);
    socket.emit('battle-search-cancelled');
  });
});

// ============================================================
// SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
