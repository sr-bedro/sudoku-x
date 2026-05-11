// ============================================================
// RECUPERAR DATOS DE LA SESIÓN
// ============================================================

const roomCode = sessionStorage.getItem('roomCode');
const playerIndex = parseInt(sessionStorage.getItem('playerIndex'));
// parseInt convierte el string "0" o "1" al número 0 o 1.
let board = JSON.parse(sessionStorage.getItem('board'));
// JSON.parse convierte el texto JSON de vuelta a objeto JavaScript.
// "let" porque el tablero va a cambiar durante el juego.

if (!roomCode) {
  window.location.href = '/';
  // Si no hay código de sala (alguien entró directamente a /game.html),
  // lo mandamos al inicio.
}

// ============================================================
// CONFIGURACIÓN DEL JUGADOR
// ============================================================

const myColor = playerIndex === 0 ? '#4A90D9' : '#E85D75';
// Operador ternario: condición ? valor_si_true : valor_si_false
// Jugador 0 → azul, Jugador 1 → rosado

let selectedCell = null;
// La celda actualmente seleccionada (donde se va a escribir el número)

// ============================================================
// CONECTAR SOCKET Y RECONECTAR A LA SALA
// ============================================================

const socket = io();

// Flag para saber si el juego ya arrancó. Evita mostrar win screen prematuramente.
let gameStarted = false;

socket.on('connect', () => {
  // Enviamos código Y playerIndex para que el servidor sepa quién somos.
  socket.emit('rejoin-room', { code: roomCode, playerIndex });
});

// ============================================================
// REFERENCIAS AL DOM
// ============================================================

const boardEl = document.getElementById('board');
const displayCode = document.getElementById('display-code');
const statusMessage = document.getElementById('status-message');
const winScreen = document.getElementById('win-screen');
const winMessage = document.getElementById('win-message');
const numBtns = document.querySelectorAll('.num-btn');
// querySelectorAll devuelve TODOS los elementos con esa clase.
// Devuelve un NodeList (similar a un array).

displayCode.textContent = roomCode;
// Mostramos el código de sala en el header.

// ============================================================
// GENERAR EL TABLERO EN EL DOM
// ============================================================

function renderBoard() {
  boardEl.innerHTML = '';
  // Limpiamos el tablero antes de volver a dibujarlo.
  // innerHTML = '' elimina todo el contenido HTML del elemento.

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      // Obtenemos la info de esta celda del array board.

      const el = document.createElement('div');
      // Creamos un nuevo elemento div en JavaScript.

      el.className = 'cell';
      // Le asignamos la clase 'cell' para los estilos base.

      el.dataset.row = r;
      el.dataset.col = c;
      // dataset permite guardar datos personalizados en el elemento.
      // Quedan como atributos data-row y data-col en el HTML.
      // Los usamos en el CSS (.cell[data-row="3"]) y en eventos.

      // ---- Clase: celda diagonal ----
      const isMainDiag = r === c;
      const isAntiDiag = r + c === 8;
      if (isMainDiag || isAntiDiag) {
        el.classList.add('diagonal');
        // classList.add() agrega una clase sin quitar las existentes.
      }

      // ---- Clase: celda fija ----
      if (cell.fixed) {
        el.classList.add('fixed');
      }

      // ---- Contenido: el número ----
      if (cell.value !== 0) {
        el.textContent = cell.value;

        if (!cell.fixed && cell.player) {
          // Si tiene color de jugador, lo aplicamos.
          el.style.color = cell.player;
          // .style.color permite cambiar estilos inline desde JavaScript.
        }
      }

      // ---- Evento: click en la celda ----
      el.addEventListener('click', () => onCellClick(r, c, el));

      boardEl.appendChild(el);
      // appendChild agrega el elemento div al tablero.
    }
  }
}

// ============================================================
// MANEJAR CLICK EN CELDA
// ============================================================

function onCellClick(row, col, el) {
  if (board[row][col].fixed) return;
  // No seleccionamos celdas fijas.

  if (selectedCell) {
    selectedCell.classList.remove('selected');
    // Quitamos el resaltado de la celda anteriormente seleccionada.
  }

  selectedCell = el;
  el.classList.add('selected');
  // Resaltamos la nueva celda seleccionada.
}

// ============================================================
// MANEJAR CLICK EN LOS NÚMEROS DEL NUMPAD
// ============================================================

numBtns.forEach(btn => {
  // forEach itera sobre cada elemento del NodeList.

  btn.addEventListener('click', () => {
    if (!selectedCell) return;
    // Si no hay celda seleccionada, no hacemos nada.

    const row = parseInt(selectedCell.dataset.row);
    const col = parseInt(selectedCell.dataset.col);
    const value = parseInt(btn.dataset.num);
    // Obtenemos fila, columna y número desde los data attributes.

    socket.emit('make-move', { row, col, value });
    // Enviamos el movimiento al servidor.
    // El servidor lo valida, actualiza el estado y se lo manda a todos.
  });
});

// ============================================================
// RECIBIR ACTUALIZACIONES DEL TABLERO
// ============================================================

socket.on('board-update', ({ row, col, value, playerColor, correct }) => {
  // Alguien hizo un movimiento (puede ser yo o Cris).
  // El servidor nos manda la actualización.

  board[row][col].value = value;
  board[row][col].player = value === 0 ? null : playerColor;
  // Actualizamos nuestro array board local.

  const el = getCellElement(row, col);
  // Buscamos el elemento DOM de esta celda.

  el.textContent = value !== 0 ? value : '';
  // Mostramos el número o lo borramos.

  el.classList.remove('error', 'correct');
  // Quitamos clases de error/correcto anteriores.

  if (value !== 0) {
    el.style.color = correct ? playerColor : '#ff6b6b';
    // Si es correcto: color del jugador. Si es error: rojo.

    el.classList.add(correct ? 'correct' : 'error');
    // Agregamos la clase correspondiente (para animaciones y estilos).
  } else {
    el.style.color = '';
    // Resetear el color si se borró el número.
  }
});

function getCellElement(row, col) {
  return boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  // querySelector busca el primer elemento que coincida con el selector CSS.
  // Buscamos la celda por sus data attributes de fila y columna.
  // Las backticks permiten insertar variables en el string.
}

// ============================================================
// EVENTOS DEL JUEGO
// ============================================================

socket.on('game-start', ({ board: newBoard }) => {
  board = newBoard;
  gameStarted = true;  // El juego arrancó oficialmente.
  statusMessage.textContent = '¡Juego en curso! Trabajen juntos 🧩';
  renderBoard();
});

socket.on('game-won', ({ winner }) => {
  if (!gameStarted) return;  // Guard: ignoramos si el juego no había empezado.
  winMessage.textContent = `¡Felicitaciones! Completaron el Sudoku X juntos. 🎉`;
  winScreen.classList.remove('hidden');
});

socket.on('board-update-full', ({ board: newBoard }) => {
  board = newBoard;
  renderBoard();
});

socket.on('player-disconnected', () => {
  statusMessage.textContent = '⚠️ Tu compañero se desconectó';
  statusMessage.style.color = '#ff6b6b';
});

// ============================================================
// INICIALIZAR
// ============================================================

if (board) {
  renderBoard();
  // Si tenemos tablero (Jugador 1 que creó la sala), lo dibujamos.
}

if (playerIndex === 0) {
  statusMessage.textContent = 'Sala creada. Compartí el código con tu compañero.';
} else {
  statusMessage.textContent = '¡Conectado! El juego ya comenzó.';
  renderBoard();
}