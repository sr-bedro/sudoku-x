const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// ---- Código de sala ----
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ---- Sudoku X: generador ----
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

function generateSudokuX() {
  const sol = createEmptyBoard();
  solve(sol);
  const puz = sol.map(r => [...r]);
  const pos = shuffle(Array.from({ length: 81 }, (_, i) => [Math.floor(i/9), i%9]));
  let removed = 0;
  for (const [r, c] of pos) {
    if (removed >= 55) break;
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

// ---- Crear objeto sala ----
function buildRoom(puzzle, solution) {
  return {
    solution,
    board: puzzle.map(row => row.map(cell => ({
      value:  cell,
      player: null,
      fixed:  cell !== 0,
      notes:  [],
    }))),
    players: [
      { id: null, color: '#2563eb', name: 'Jugador 1', connected: false }
    ],
  };
}

// ============================================================
// SOCKET.IO
// ============================================================

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  // ---- CREAR SALA (tablero aleatorio) ----
  socket.on('create-room', () => {
    const code = generateRoomCode();
    const { puzzle, solution } = generateSudokuX();
    rooms[code] = buildRoom(puzzle, solution);
    socket.emit('room-created', { code, board: rooms[code].board, playerIndex: 0 });
  });

  // ---- CREAR SALA (tablero personalizado) ----
  // El cliente envía el puzzle que diseñó el usuario (array 9x9 de números).
  socket.on('create-custom-room', (puzzleData) => {
    const code = generateRoomCode();

    // Copiamos el puzzle y buscamos la solución con el solver.
    const puzzleForSolver = puzzleData.map(row => [...row]);
    const hasSolution = solve(puzzleForSolver);

    // Si el puzzle no tiene solución, avisamos al cliente.
    if (!hasSolution) {
      socket.emit('error', 'El tablero no tiene solución válida. Revisá los números.');
      return;
    }

    rooms[code] = buildRoom(puzzleData, puzzleForSolver);
    socket.emit('room-created', { code, board: rooms[code].board, playerIndex: 0 });
  });

  // ---- UNIRSE A SALA ----
  socket.on('join-room', (code) => {
    code = code.toUpperCase();
    if (!rooms[code])                    { socket.emit('error', 'Sala no encontrada'); return; }
    if (rooms[code].players.length >= 2) { socket.emit('error', 'Sala llena');         return; }

    rooms[code].players.push(
      { id: null, color: '#2563eb', name: 'Jugador 2', connected: false }
    );

    socket.emit('room-joined', { code, board: rooms[code].board, playerIndex: 1 });
  });

  // ---- REJOIN desde game.html ----
  socket.on('rejoin-room', ({ code, playerIndex }) => {
    if (!rooms[code]) { socket.emit('error', 'Sala expirada'); return; }

    socket.join(code);
    socket.roomCode    = code;
    socket.playerIndex = playerIndex;

    if (rooms[code].players[playerIndex]) {
      rooms[code].players[playerIndex].id        = socket.id;
      rooms[code].players[playerIndex].connected = true;
    }

    socket.emit('board-update-full', { board: rooms[code].board });

    const listos = rooms[code].players.length === 2 &&
                   rooms[code].players.every(p => p.connected);
    if (listos) {
      io.to(code).emit('game-start', { board: rooms[code].board });
    }
  });

  // ---- MOVIMIENTO ----
  socket.on('make-move', ({ row, col, value }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const cell = room.board[row][col];
    if (cell.fixed) return;

    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;
    const player = room.players[pi];

    const prevState = {
      prevValue:  cell.value,
      prevPlayer: cell.player,
      prevNotes:  [...(cell.notes || [])],
    };

    room.board[row][col] = {
      value,
      player: value === 0 ? null : player.color,
      fixed:  false,
      notes:  [],
    };

    // correct: si hay solución la comparamos; si no hay (tablero custom sin solución),
    // cualquier número se considera correcto.
    const correct = value === 0 || !room.solution || value === room.solution[row][col];

    io.to(code).emit('board-update', {
      row, col, value,
      playerColor: player.color,  // color real del jugador que hizo el movimiento
      correct,
      notes: [],
      prevState,
    });

    const allFilled = room.board.every(r => r.every(c => c.value !== 0));
    if (allFilled && isBoardComplete(room.board, room.solution)) {
      io.to(code).emit('game-won', { winner: player.name });
    }
  });

  // ---- NOTA ----
  socket.on('make-note', ({ row, col, num }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const cell = rooms[code].board[row][col];
    if (cell.fixed || cell.value !== 0) return;

    const pi = rooms[code].players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;

    const prevNotes = [...(cell.notes || [])];
    const idx = cell.notes.indexOf(num);
    if (idx === -1) { cell.notes.push(num); cell.notes.sort((a,b) => a-b); }
    else            { cell.notes.splice(idx, 1); }

    io.to(code).emit('note-update', { row, col, notes: cell.notes, prevNotes });
  });

  // ---- DESHACER ----
  socket.on('undo-move', ({ row, col, prevValue, prevNotes, prevPlayer }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const cell = rooms[code].board[row][col];
    if (cell.fixed) return;

    rooms[code].board[row][col] = {
      value:  prevValue,
      player: prevPlayer,
      fixed:  false,
      notes:  prevNotes || [],
    };

    io.to(code).emit('undo-confirmed', {
      row, col,
      value:  prevValue,
      player: prevPlayer,
      notes:  prevNotes || [],
    });
  });

  // ---- DESCONEXIÓN ----
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      const pi = rooms[code].players.findIndex(p => p.id === socket.id);
      if (pi !== -1) {
        rooms[code].players[pi].connected = false;
        rooms[code].players[pi].id        = null;

        const todosOff = rooms[code].players.every(p => !p.connected);
        if (todosOff) delete rooms[code];
        else io.to(code).emit('player-disconnected');
      }
    }
    console.log('Desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
