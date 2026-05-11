// ============================================================
// CONECTAR CON SOCKET.IO
// ============================================================

const socket = io();

// Limpiamos cualquier dato viejo de partidas anteriores.
// Esto evita que datos de un juego ganado interfieran con el nuevo.
sessionStorage.clear();

// ============================================================
// REFERENCIAS A ELEMENTOS DEL DOM
// ============================================================

const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const codeInput = document.getElementById('room-code-input');
const errorDiv = document.getElementById('error-message');
// document.getElementById() busca un elemento HTML por su id.
// Lo guardamos en variables para no buscarlo repetidamente.

// ============================================================
// EVENTOS DE BOTONES
// ============================================================

btnCreate.addEventListener('click', () => {
  // addEventListener: "cuando ocurra este evento, ejecutá esta función"
  // 'click': el evento de hacer click
  // () => {...}: la función que se ejecuta (arrow function)

  socket.emit('create-room');
  // Emitimos el evento 'create-room' al servidor.
  // El servidor escucha esto con socket.on('create-room', ...).
});

btnJoin.addEventListener('click', () => {
  const code = codeInput.value.trim();
  // .value: obtiene el texto que escribió el usuario
  // .trim(): elimina espacios al inicio y al final

  if (code.length !== 4) {
    showError('El código debe tener 4 caracteres');
    return;
    // Validación simple: el código tiene exactamente 4 chars.
  }

  socket.emit('join-room', code);
  // Enviamos el código al servidor.
});

// ============================================================
// RESPUESTAS DEL SERVIDOR
// ============================================================

socket.on('room-created', ({ code, board, playerIndex }) => {
  // El servidor nos responde con los datos de la sala creada.
  // Desestructuramos el objeto recibido.

  // Guardamos en sessionStorage para usarlo en la pantalla de juego.
  // sessionStorage persiste durante la sesión del navegador (tab abierto).
  sessionStorage.setItem('roomCode', code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board', JSON.stringify(board));
  // JSON.stringify convierte el objeto JavaScript a texto (JSON).
  // sessionStorage solo guarda strings, no objetos.

  window.location.href = '/game.html';
  // Redireccionamos a la pantalla de juego.
});

socket.on('room-joined', ({ code, board, playerIndex }) => {
  // El servidor confirma que el Jugador 2 se unió exitosamente.

  sessionStorage.setItem('roomCode', code);
  sessionStorage.setItem('playerIndex', playerIndex);
  sessionStorage.setItem('board', JSON.stringify(board));

  window.location.href = '/game.html';
});

socket.on('error', (message) => {
  showError(message);
  // Mostramos el mensaje de error que nos mandó el servidor.
});

// ============================================================
// FUNCIÓN AUXILIAR
// ============================================================

function showError(message) {
  errorDiv.textContent = message;
  // .textContent establece el texto visible del elemento.

  errorDiv.classList.remove('hidden');
  // .classList.remove('hidden') elimina la clase 'hidden',
  // haciendo visible el div de error.

  setTimeout(() => {
    errorDiv.classList.add('hidden');
  }, 3000);
  // setTimeout ejecuta una función después de X milisegundos.
  // 3000ms = 3 segundos → ocultamos el error después de 3 segundos.
}