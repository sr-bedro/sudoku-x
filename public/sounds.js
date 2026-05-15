// ============================================================
// sounds.js — Efectos de sonido generados con Web Audio API
// Sin archivos externos — todo se sintetiza en el navegador
// ============================================================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null;

// Inicializamos el contexto de audio en el primer gesto del usuario.
// Los navegadores bloquean el audio hasta que haya interacción.
function getCtx() {
  if (!ctx) ctx = new AudioCtx();
  // Si el contexto está suspendido (Chrome lo hace automáticamente),
  // lo reanudamos.
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---- Vibración ----
// navigator.vibrate() funciona en Android. En iOS no está soportado.
// El patrón es un array de [vibrar, pausa, vibrar, ...] en ms.

function vibrateSuccess() {
  // Vibración corta y suave — acierto
  if (navigator.vibrate) navigator.vibrate(40);
}

function vibrateError() {
  // Doble pulso — error
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
}

function vibrateSection() {
  // Pulso más largo — sección completada
  if (navigator.vibrate) navigator.vibrate(120);
}

function vibrateWin() {
  // Patrón de celebración
  if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 200]);
}

// ---- Helpers de síntesis ----

// Crea un oscilador simple con envelope (volumen que sube y baja)
function playTone({ frequency, type = 'sine', duration = 0.15, volume = 0.3, delay = 0 }) {
  try {
    const ac  = getCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.type      = type;
    osc.frequency.setValueAtTime(frequency, ac.currentTime + delay);

    // Envelope: ataque rápido → sustain → decay suave
    gain.gain.setValueAtTime(0, ac.currentTime + delay);
    gain.gain.linearRampToValueAtTime(volume, ac.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);

    osc.start(ac.currentTime + delay);
    osc.stop(ac.currentTime + delay + duration + 0.05);
  } catch (e) {}
}

// Crea un sonido de ruido (para errores y clicks)
function playNoise({ duration = 0.05, volume = 0.15, delay = 0 }) {
  try {
    const ac     = getCtx();
    const buffer = ac.createBuffer(1, ac.sampleRate * duration, ac.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1);
    }
    const source = ac.createBufferSource();
    const gain   = ac.createGain();
    const filter = ac.createBiquadFilter();

    source.buffer = buffer;
    filter.type   = 'bandpass';
    filter.frequency.value = 800;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);

    gain.gain.setValueAtTime(volume, ac.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);

    source.start(ac.currentTime + delay);
  } catch (e) {}
}

// ============================================================
// SONIDOS DEL JUEGO
// ============================================================

// Click al seleccionar una celda — sutil, casi imperceptible
function soundCellSelect() {
  playTone({ frequency: 800, type: 'sine', duration: 0.06, volume: 0.08 });
}

// Número correcto — pop satisfactorio, tono positivo
function soundCorrect() {
  playTone({ frequency: 520, type: 'sine', duration: 0.1,  volume: 0.25 });
  playTone({ frequency: 780, type: 'sine', duration: 0.12, volume: 0.2, delay: 0.06 });
  vibrateSuccess();
}

// Número incorrecto — tono bajo disonante
function soundError() {
  playTone({ frequency: 180, type: 'sawtooth', duration: 0.18, volume: 0.2 });
  playNoise({ duration: 0.08, volume: 0.12, delay: 0.02 });
  vibrateError();
}

// Fila/columna/caja completada — acorde ascendente
function soundSectionComplete() {
  const notes = [440, 554, 659]; // La - Do# - Mi (acorde Mayor)
  notes.forEach((freq, i) => {
    playTone({ frequency: freq, type: 'sine', duration: 0.25, volume: 0.2, delay: i * 0.07 });
  });
  vibrateSection();
}

// Número borrado — click seco
function soundErase() {
  playNoise({ duration: 0.04, volume: 0.1 });
  playTone({ frequency: 300, type: 'sine', duration: 0.08, volume: 0.1 });
}

// Nota de lápiz — sonido suave de lápiz
function soundNote() {
  playTone({ frequency: 1200, type: 'sine', duration: 0.05, volume: 0.1 });
}

// Deshacer — tono descendente
function soundUndo() {
  playTone({ frequency: 500, type: 'sine', duration: 0.1, volume: 0.15 });
  playTone({ frequency: 350, type: 'sine', duration: 0.12, volume: 0.15, delay: 0.07 });
}

// Celda bloqueada (intento de pisar el cursor del oponente)
function soundBlocked() {
  playTone({ frequency: 250, type: 'square', duration: 0.1, volume: 0.15 });
}

// Victoria — fanfarria corta
function soundWin() {
  const melody = [
    { frequency: 523, delay: 0.0  },  // Do
    { frequency: 659, delay: 0.12 },  // Mi
    { frequency: 784, delay: 0.24 },  // Sol
    { frequency: 1047,delay: 0.36 },  // Do agudo
  ];
  melody.forEach(({ frequency, delay }) => {
    playTone({ frequency, type: 'sine', duration: 0.3, volume: 0.3, delay });
  });
  // Acorde final
  [523, 659, 784].forEach(freq => {
    playTone({ frequency: freq, type: 'sine', duration: 0.6, volume: 0.2, delay: 0.55 });
  });
  vibrateWin();
}

// Jugador 2 se une — campana de bienvenida
function soundPlayerJoined() {
  playTone({ frequency: 880, type: 'sine', duration: 0.15, volume: 0.2 });
  playTone({ frequency: 1100,type: 'sine', duration: 0.2,  volume: 0.18, delay: 0.1 });
}

// Guardar partida — click suave de confirmación
function soundSave() {
  playTone({ frequency: 660, type: 'sine', duration: 0.1, volume: 0.2 });
  playTone({ frequency: 880, type: 'sine', duration: 0.12, volume: 0.18, delay: 0.08 });
}
