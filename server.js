require('dotenv').config();

const express        = require('express');
const http           = require('http');
const { Server }     = require('socket.io');
const path           = require('path');
const session        = require('express-session');
const PgSession      = require('connect-pg-simple')(session);
const passport       = require('./auth');
const pool           = require('./db/pool');
const db             = require('./db/queries');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sesiones guardadas en PostgreSQL (persisten entre reinicios del servidor)
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session', // connect-pg-simple crea esta tabla automáticamente
  }),
  secret:            process.env.SESSION_SECRET || 'sudokux-secret-local',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 días
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ============================================================
// RUTAS DE AUTENTICACIÓN
// ============================================================

// 1. El usuario hace click en "Entrar con Google"
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// 2. Google redirige acá después del login
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth' }),
  (req, res) => {
    // Login exitoso → volvemos al inicio
    res.redirect('/');
  }
);

// 3. Cerrar sesión
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// ============================================================
// API — datos del usuario actual
// ============================================================

// Middleware: verificar si el usuario está logueado
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'No autenticado' });
}

// Datos del usuario actual (para el frontend)
app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.json({ user: null });
  }
  res.json({
    user: {
      id:    req.user.id,
      name:  req.user.name,
      email: req.user.email,
      photo: req.user.photo,
    }
  });
});

// Estadísticas del usuario
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const stats   = await db.getUserStats(req.user.id);
    const history = await db.getGameHistory(req.user.id);
    res.json({ stats, history });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// Guardar partida en la nube (llamado por el cliente)
app.post('/api/save-game', requireAuth, async (req, res) => {
  try {
    const { board, solution, elapsed, difficulty } = req.body;
    await db.upsertSavedGame(req.user.id, { board, solution, elapsed, difficulty });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error guardando partida' });
  }
});

// Obtener partida guardada de la nube
app.get('/api/saved-game', requireAuth, async (req, res) => {
  try {
    const saved = await db.getSavedGame(req.user.id);
    res.json({ saved });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo partida' });
  }
});

// Borrar partida guardada (al terminar o empezar nueva)
app.delete('/api/saved-game', requireAuth, async (req, res) => {
  try {
    await db.deleteSavedGame(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando partida' });
  }
});

// Registrar partida completada
app.post('/api/complete-game', requireAuth, async (req, res) => {
  try {
    const { difficulty, timeSecs, errors } = req.body;
    await db.saveCompletedGame(req.user.id, { difficulty, timeSecs, errors });
    await db.deleteSavedGame(req.user.id); // borramos el guardado al terminar
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error registrando partida' });
  }
});

// ============================================================
// JUEGO — Sudoku X
// ============================================================

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

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

function generateSudokuX(difficulty = 'hard') {
  const sol = createEmptyBoard();
  solve(sol);
  const puz = sol.map(r => [...r]);
  const remove = difficulty === 'hard' ? 55 : difficulty === 'medium' ? 45 : 35;
  const pos = shuffle(Array.from({ length: 81 }, (_, i) => [Math.floor(i/9), i%9]));
  let removed = 0;
  for (const [r, c] of pos) {
    if (removed >= remove) break;
    puz[r][c] = 0; removed++;
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
  const boxRow = Math.floor(row/3), boxCol = Math.floor(col/3), boxKey = boxRow*3+boxCol;
  if (!completedSections.boxes.has(boxKey)) {
    let ok = true;
    for (let r = boxRow*3; r < boxRow*3+3; r++)
      for (let c = boxCol*3; c < boxCol*3+3; c++)
        if (board[r][c].value === 0 || board[r][c].value !== solution[r][c]) ok = false;
    if (ok) { completedSections.boxes.add(boxKey); completed.push({ type: 'box', boxRow, boxCol }); }
  }
  return completed;
}

// ============================================================
// SOCKET.IO
// ============================================================

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

  socket.on('create-custom-room', ({ puzzleData, playerName = 'Jugador 1' }) => {
    const code = generateRoomCode();
    const puzzleForSolver = puzzleData.map(row => [...row]);
    if (!solve(puzzleForSolver)) { socket.emit('error', 'El tablero no tiene solución válida.'); return; }
    rooms[code] = buildRoom(puzzleData, puzzleForSolver, playerName, 'custom');
    socket.emit('room-created', { code, board: rooms[code].board, solution: puzzleForSolver, playerIndex: 0 });
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
    const room = rooms[code];
    const cell = room.board[row][col];
    if (cell.fixed) return;
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;
    const player = room.players[pi];

    const prevState = { prevValue: cell.value, prevPlayer: cell.player, prevNotes: [...(cell.notes||[])] };
    room.board[row][col] = { value, player: value===0?null:player.color, fixed:false, notes:[] };

    const correct = value === 0 || !room.solution || value === room.solution[row][col];
    if (!correct && value !== 0) player.errors++;

    io.to(code).emit('board-update', { row, col, value, playerColor: player.color, correct, notes:[], prevState });

    if (correct && value !== 0 && room.solution) {
      const sections = checkSections(room, row, col);
      if (sections.length > 0) io.to(code).emit('sections-complete', { sections });
    }

    const allFilled = room.board.every(r => r.every(c => c.value !== 0));
    if (allFilled && isBoardComplete(room.board, room.solution)) {
      const elapsed = room.startTime
        ? Math.floor((Date.now()-room.startTime)/1000) + (room.savedElapsed||0)
        : 0;
      const totalErrors = room.players.reduce((sum, p) => sum + (p.errors||0), 0);
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
    const prevNotes = [...(cell.notes||[])];
    const idx = cell.notes.indexOf(num);
    if (idx===-1) { cell.notes.push(num); cell.notes.sort((a,b)=>a-b); }
    else          { cell.notes.splice(idx,1); }
    io.to(code).emit('note-update', { row, col, notes: cell.notes, prevNotes });
  });

  socket.on('undo-move', ({ row, col, prevValue, prevNotes, prevPlayer }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const cell = rooms[code].board[row][col];
    if (cell.fixed) return;
    rooms[code].board[row][col] = { value:prevValue, player:prevPlayer, fixed:false, notes:prevNotes||[] };
    io.to(code).emit('undo-confirmed', { row, col, value:prevValue, player:prevPlayer, notes:prevNotes||[] });
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
          socket.to(code).emit('opponent-cursor', { row:-1, col:-1 });
        }
      }
    }
    console.log('Desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));

// ============================================================
// BATALLA — Matchmaking y salas competitivas
// ============================================================

const battleQueue = []; // Cola de espera global
const battleRooms = {}; // Salas de batalla activas

const BATTLE_MAX_ERRORS    = 3;    // Errores máximos antes de perder
const BATTLE_ERROR_PENALTY = 30;   // Segundos de penalización por error

function generateBattleCode() {
  return 'B' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function buildBattleRoom(puzzle, solution, players) {
  return {
    puzzle, solution,
    players: players.map((p, i) => ({
      id:          p.id,
      name:        p.name,
      color:       i === 0 ? '#e02454' : '#f59e0b', // Rojo vs Naranja en batalla
      board:       puzzle.map(row => row.map(cell => ({
        value: cell, fixed: cell !== 0, notes: []
      }))),
      correctCells: 0,    // Celdas correctas colocadas
      totalEmpty:   puzzle.flat().filter(c => c === 0).length,
      errors:       0,    // Errores cometidos
      penalty:      0,    // Segundos de penalización acumulados
      finished:     false,
      finishTime:   null,
    })),
    startTime:   null,
    totalCells:  puzzle.flat().filter(c => c === 0).length,
    status:      'waiting', // waiting → playing → finished
  };
}

// Emparejamiento: busca al primer jugador en la cola
function tryMatchmaking(socket, playerName, difficulty) {
  if (battleQueue.length === 0) {
    // No hay nadie esperando → entrar a la cola
    battleQueue.push({ id: socket.id, name: playerName, difficulty, socket });
    socket.emit('battle-waiting', { message: 'Buscando oponente...' });
    return null;
  }

  // Hay alguien esperando con la misma dificultad (o cualquiera si no hay)
  const opponent = battleQueue.findIndex(p =>
    p.difficulty === difficulty || true // Por ahora cualquier dificultad
  );

  if (opponent === -1) {
    battleQueue.push({ id: socket.id, name: playerName, difficulty, socket });
    socket.emit('battle-waiting', { message: 'Buscando oponente...' });
    return null;
  }

  const opp = battleQueue.splice(opponent, 1)[0];
  return opp; // Devolvemos al oponente emparejado
}

// ---- Eventos de batalla en Socket.io ----

io.on('connection', (socket) => {
  // (Los handlers anteriores ya están registrados arriba)

  // ---- BUSCAR PARTIDA (matchmaking global) ----
  socket.on('battle-find-match', ({ playerName, difficulty = 'hard' }) => {
    const opponent = tryMatchmaking(socket, playerName, difficulty);

    if (!opponent) return; // En cola, esperando

    // ¡Encontramos pareja! Creamos la sala de batalla
    const code = generateBattleCode();
    const { puzzle, solution } = generateSudokuX(difficulty);

    battleRooms[code] = buildBattleRoom(puzzle, solution, [
      { id: opponent.id, name: opponent.name },
      { id: socket.id,   name: playerName },
    ]);

    // Ambos se unen a la sala
    opponent.socket.join(code);
    socket.join(code);

    opponent.socket.battleCode = code;
    socket.battleCode          = code;

    battleRooms[code].startTime = Date.now();
    battleRooms[code].status    = 'playing';

    const room = battleRooms[code];

    // Enviamos a cada jugador su propio índice y tablero
    opponent.socket.emit('battle-start', {
      code, playerIndex: 0,
      puzzle: room.players[0].board,
      solution,
      opponentName: playerName,
      totalCells: room.totalCells,
      startTime: room.startTime,
    });

    socket.emit('battle-start', {
      code, playerIndex: 1,
      puzzle: room.players[1].board,
      solution,
      opponentName: opponent.name,
      totalCells: room.totalCells,
      startTime: room.startTime,
    });
  });

  // ---- CREAR SALA PRIVADA DE BATALLA ----
  socket.on('battle-create-private', ({ playerName, difficulty = 'hard' }) => {
    const code = generateBattleCode();
    const { puzzle, solution } = generateSudokuX(difficulty);

    battleRooms[code] = buildBattleRoom(puzzle, solution, [
      { id: socket.id, name: playerName },
    ]);

    socket.join(code);
    socket.battleCode = code;

    socket.emit('battle-private-created', {
      code,
      playerIndex: 0,
      puzzle: battleRooms[code].players[0].board,
      solution,
    });
  });

  // ---- UNIRSE A SALA PRIVADA DE BATALLA ----
  socket.on('battle-join-private', ({ code, playerName }) => {
    code = code.toUpperCase();
    const room = battleRooms[code];

    if (!room)                    { socket.emit('error', 'Sala de batalla no encontrada'); return; }
    if (room.players.length >= 2) { socket.emit('error', 'Sala de batalla llena'); return; }

    room.players.push({
      id:           socket.id,
      name:         playerName,
      color:        '#f59e0b',
      board:        room.puzzle.map(row => row.map(cell => ({
        value: cell, fixed: cell !== 0, notes: []
      }))),
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

    // Notificamos a los dos
    room.players[0] && io.to(room.players[0].id).emit('battle-start', {
      code, playerIndex: 0,
      puzzle: room.players[0].board,
      solution: room.solution,
      opponentName: playerName,
      totalCells: room.totalCells,
      startTime: room.startTime,
    });

    socket.emit('battle-start', {
      code, playerIndex: 1,
      puzzle: room.players[1].board,
      solution: room.solution,
      opponentName: room.players[0]?.name || 'Oponente',
      totalCells: room.totalCells,
      startTime: room.startTime,
    });
  });

  // ---- MOVIMIENTO EN BATALLA ----
  socket.on('battle-move', ({ row, col, value }) => {
    const code = socket.battleCode;
    if (!code || !battleRooms[code]) return;

    const room    = battleRooms[code];
    if (room.status !== 'playing') return;

    const pi      = room.players.findIndex(p => p.id === socket.id);
    if (pi === -1) return;

    const player  = room.players[pi];
    const cell    = player.board[row][col];

    if (cell.fixed || player.finished) return;

    cell.value = value;
    const correct = value === 0 || value === room.solution[row][col];

    if (!correct && value !== 0) {
      // Error cometido
      player.errors++;
      player.penalty += BATTLE_ERROR_PENALTY;

      socket.emit('battle-cell-result', { row, col, value, correct: false, errors: player.errors, penalty: player.penalty });

      if (player.errors >= BATTLE_MAX_ERRORS) {
        // Perdió por demasiados errores
        player.finished  = true;
        player.finishTime = Infinity; // Nunca termina

        socket.emit('battle-lost', { reason: 'errors', errors: player.errors });

        const winner = room.players[pi === 0 ? 1 : 0];
        if (winner) {
          io.to(winner.id).emit('battle-won', {
            reason:       'opponent_errors',
            elapsed:      Math.floor((Date.now() - room.startTime) / 1000) + winner.penalty,
            opponentName: player.name,
          });
        }
        room.status = 'finished';
        return;
      }

      // Avisamos al oponente del error (sin revelar qué celda)
      const oppId = room.players[pi === 0 ? 1 : 0]?.id;
      if (oppId) io.to(oppId).emit('battle-opponent-error', { errors: player.errors });

    } else if (correct && value !== 0) {
      // Número correcto
      player.correctCells++;

      socket.emit('battle-cell-result', { row, col, value, correct: true, errors: player.errors, penalty: player.penalty });

      // Progreso al oponente
      const oppId = room.players[pi === 0 ? 1 : 0]?.id;
      if (oppId) io.to(oppId).emit('battle-opponent-progress', {
        correctCells: player.correctCells,
        totalCells:   room.totalCells,
      });

      // ¿Terminó?
      if (player.correctCells >= player.totalEmpty) {
        player.finished  = true;
        player.finishTime = Math.floor((Date.now() - room.startTime) / 1000) + player.penalty;

        socket.emit('battle-won', {
          reason:  'completed',
          elapsed: player.finishTime,
          errors:  player.errors,
          penalty: player.penalty,
        });

        const opp = room.players[pi === 0 ? 1 : 0];
        if (opp) {
          io.to(opp.id).emit('battle-lost', {
            reason:       'opponent_finished',
            opponentName: player.name,
            opponentTime: player.finishTime,
          });
        }

        room.status = 'finished';
      }
    } else {
      // Borrar celda
      socket.emit('battle-cell-result', { row, col, value: 0, correct: true, errors: player.errors, penalty: player.penalty });
      if (correct && cell.value !== 0) player.correctCells = Math.max(0, player.correctCells - 1);
    }
  });

  // ---- Salir de la cola de matchmaking ----
  socket.on('battle-cancel-search', () => {
    const idx = battleQueue.findIndex(p => p.id === socket.id);
    if (idx !== -1) battleQueue.splice(idx, 1);
    socket.emit('battle-search-cancelled');
  });

  // ---- Desconexión durante batalla ----
  socket.on('disconnect', () => {
    // Limpiar cola de matchmaking
    const qIdx = battleQueue.findIndex(p => p.id === socket.id);
    if (qIdx !== -1) battleQueue.splice(qIdx, 1);

    // Notificar al oponente en sala de batalla
    const bCode = socket.battleCode;
    if (bCode && battleRooms[bCode]) {
      const room = battleRooms[bCode];
      const opp  = room.players.find(p => p.id !== socket.id);
      if (opp) io.to(opp.id).emit('battle-opponent-disconnected');
      delete battleRooms[bCode];
    }
  });
});
