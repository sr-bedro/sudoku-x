const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// ============================================================
// GENERADOR DE CÓDIGO DE SALA
// ============================================================

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ============================================================
// GENERADOR DE SUDOKU X
// ============================================================

function createEmptyBoard() {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

function isValid(board, row, col, num) {
  // Verificar fila
  for (let c = 0; c < 9; c++) {
    if (board[row][c] === num) return false;
  }

  // Verificar columna
  for (let r = 0; r < 9; r++) {
    if (board[r][col] === num) return false;
  }

  // Verificar caja 3x3
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = boxRow; r < boxRow + 3; r++) {
    for (let c = boxCol; c < boxCol + 3; c++) {
      if (board[r][c] === num) return false;
    }
  }

  // Verificar diagonal principal (Sudoku X)
  if (row === col) {
    for (let i = 0; i < 9; i++) {
      if (board[i][i] === num) return false;
    }
  }

  // Verificar diagonal secundaria (Sudoku X)
  if (row + col === 8) {
    for (let i = 0; i < 9; i++) {
      if (board[i][8 - i] === num) return false;
    }
  }

  return true;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function solve(board) {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col] === 0) {
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        for (const num of nums) {
          if (isValid(board, row, col, num)) {
            board[row][col] = num;
            if (solve(board)) return true;
            board[row][col] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

function generateSolution() {
  const board = createEmptyBoard();
  solve(board);
  return board;
}

function removeCells(solution, difficulty) {
  const cellsToRemove = difficulty === 'hard' ? 55 : 40;
  const puzzle = solution.map(row => [...row]);
  const positions = shuffle(
    Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9])
  );
  let removed = 0;
  for (const [row, col] of positions) {
    if (removed >= cellsToRemove) break;
    puzzle[row][col] = 0;
    removed++;
  }
  return puzzle;
}

function generateSudokuX(difficulty = 'hard') {
  const solution = generateSolution();
  const puzzle = removeCells(solution, difficulty);
  return { puzzle, solution };
}

function isBoardComplete(board, solution) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c].value !== solution[r][c]) return false;
    }
  }
  return true;
}

// ============================================================
// SOCKET.IO
// ============================================================

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // ---- CREAR SALA ----
  // NO hacemos socket.join() ni socket.roomCode acá.
  // Este socket es del lobby y se desconecta al navegar a game.html.
  // El socket definitivo se registra en rejoin-room.
  socket.on('create-room', () => {
    const code = generateRoomCode();
    const { puzzle, solution } = generateSudokuX();

    rooms[code] = {
      puzzle,
      solution,
      board: puzzle.map(row =>
        row.map(cell => ({
          value: cell,
          player: null,
          fixed: cell !== 0,
        }))
      ),
      players: [
        { id: null, color: '#4A90D9', name: 'Jugador 1', connected: false }
      ],
    };

    socket.emit('room-created', {
      code,
      board: rooms[code].board,
      playerIndex: 0
    });
  });

  // ---- UNIRSE A SALA ----
  // Igual que create-room: NO hacemos socket.join() aquí.
  // Este socket es del lobby y se va a desconectar.
  socket.on('join-room', (code) => {
    code = code.toUpperCase();

    if (!rooms[code]) {
      socket.emit('error', 'Sala no encontrada');
      return;
    }

    if (rooms[code].players.length >= 2) {
      socket.emit('error', 'La sala ya está llena');
      return;
    }

    rooms[code].players.push(
      { id: null, color: '#E85D75', name: 'Jugador 2', connected: false }
    );

    socket.emit('room-joined', {
      code,
      board: rooms[code].board,
      playerIndex: 1
    });
  });

  // ---- REJOIN (socket definitivo de game.html) ----
  // Este es el socket real del jugador durante la partida.
  // Acá sí hacemos socket.join() y guardamos socket.roomCode.
  socket.on('rejoin-room', ({ code, playerIndex }) => {
    if (!rooms[code]) {
      socket.emit('error', 'Sala no encontrada o expirada');
      return;
    }

    socket.join(code);
    socket.roomCode = code;

    // Actualizamos el id real y marcamos al jugador como conectado.
    if (rooms[code].players[playerIndex]) {
      rooms[code].players[playerIndex].id = socket.id;
      rooms[code].players[playerIndex].connected = true;
    }

    socket.emit('board-update-full', { board: rooms[code].board });

    // Si ambos jugadores están conectados → arranca el juego.
    const ambosConectados = rooms[code].players.length === 2 &&
      rooms[code].players.every(p => p.connected);

    if (ambosConectados) {
      io.to(code).emit('game-start', { board: rooms[code].board });
    }
  });

  // ---- HACER UN MOVIMIENTO ----
  socket.on('make-move', ({ row, col, value }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    const cell = room.board[row][col];
    if (cell.fixed) return;

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];

    room.board[row][col] = {
      value: value,
      player: value === 0 ? null : player.color,
      fixed: false,
    };

    const correct = value === 0 || value === room.solution[row][col];

    io.to(code).emit('board-update', {
      row, col, value,
      playerColor: player.color,
      correct,
    });

    const allFilled = room.board.every(row => row.every(cell => cell.value !== 0));
    if (allFilled && isBoardComplete(room.board, room.solution)) {
      io.to(code).emit('game-won', { winner: player.name });
    }
  });

  // ---- DESCONEXIÓN ----
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      const playerIndex = rooms[code].players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        // Marcamos como desconectado pero NO lo eliminamos.
        // Así puede reconectarse si recarga la página.
        rooms[code].players[playerIndex].connected = false;
        rooms[code].players[playerIndex].id = null;

        // Si todos están desconectados, borramos la sala.
        const todosDesconectados = rooms[code].players.every(p => !p.connected);
        if (todosDesconectados) {
          delete rooms[code];
        } else {
          io.to(code).emit('player-disconnected');
        }
      }
    }
    console.log('Usuario desconectado:', socket.id);
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
