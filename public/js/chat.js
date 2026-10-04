// ============================================
//  CHAT EN LA NUBE - Cliente
// ============================================
const token = sessionStorage.getItem('token');
const yo = sessionStorage.getItem('usuario');
if (!token || !yo) location.replace('/');

const $ = (id) => document.getElementById(id);
const mensajesEl = $('mensajes');
const inputMensaje = $('inputMensaje');
const progresoEl = $('progreso');
const LIMITE_MB = 25;

// ---------- Utilidades ----------
function colorDe(nombre) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

function crearAvatar(nombre) {
  const d = document.createElement('div');
  d.className = 'avatar';
  d.textContent = nombre[0].toUpperCase();
  d.style.background = colorDe(nombre);
  return d;
}

function hora(ms) {
  return new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function tamanoLegible(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function iconoPara(mime, nombre) {
  if (mime === 'application/pdf') return '📕';
  if (/zip|rar|7z|tar/.test(mime) || /\.(zip|rar|7z)$/i.test(nombre)) return '🗜️';
  if (/word|document/.test(mime)) return '📘';
  if (/sheet|excel/.test(mime)) return '📗';
  if (/presentation|powerpoint/.test(mime)) return '📙';
  return '📄';
}

function estaAbajo() {
  return mensajesEl.scrollHeight - mensajesEl.scrollTop - mensajesEl.clientHeight < 120;
}
function bajarAlFinal() {
  mensajesEl.scrollTop = mensajesEl.scrollHeight;
}

// Mi perfil
$('miNombre').textContent = yo;
$('miAvatar').textContent = yo[0].toUpperCase();
$('miAvatar').style.background = colorDe(yo);

// ---------- Sonido (generado con código, no necesita mp3) ----------
let sonidoActivo = true;
try { sonidoActivo = localStorage.getItem('sonido') !== 'off'; } catch {}
let audioCtx = null;

function prepararAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
// Los navegadores solo permiten sonido después de que tocas la página
document.addEventListener('click', prepararAudio);
document.addEventListener('keydown', prepararAudio);

function sonar() {
  if (!sonidoActivo || !audioCtx) return;
  const t = audioCtx.currentTime;
  [880, 1320].forEach((frecuencia, i) => {
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    const inicio = t + i * 0.12;
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    vol.gain.setValueAtTime(0.0001, inicio);
    vol.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.18);
    osc.connect(vol).connect(audioCtx.destination);
    osc.start(inicio);
    osc.stop(inicio + 0.2);
  });
}

function pintarBotonSonido() {
  $('btnSonido').textContent = sonidoActivo ? '🔔' : '🔕';
}
pintarBotonSonido();

$('btnSonido').addEventListener('click', () => {
  sonidoActivo = !sonidoActivo;
  try { localStorage.setItem('sonido', sonidoActivo ? 'on' : 'off'); } catch {}
  pintarBotonSonido();
  if (sonidoActivo) { prepararAudio(); sonar(); }
});

// ---------- No leídos en el título de la pestaña ----------
let sinLeer = 0;
function actualizarTitulo() {
  document.title = sinLeer ? `(${sinLeer}) Chat Nube` : 'Chat Nube';
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { sinLeer = 0; actualizarTitulo(); }
});

// ---------- Visor de imágenes ----------
function abrirVisor(src) {
  const visor = document.createElement('div');
  visor.className = 'visor';
  const img = document.createElement('img');
  img.src = src;
  visor.appendChild(img);
  visor.addEventListener('click', () => visor.remove());
  document.body.appendChild(visor);
}

// ---------- Pintar mensajes ----------
function contenidoArchivo(a, pegado) {
  const frag = document.createDocumentFragment();

  if (a.mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = a.url;
    img.alt = a.nombre;
    img.addEventListener('click', () => abrirVisor(a.url));
    img.addEventListener('load', () => { if (pegado) bajarAlFinal(); });
    frag.appendChild(img);
  } else if (a.mime.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = a.url;
    video.controls = true;
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => { if (pegado) bajarAlFinal(); });
    frag.appendChild(video);
  } else if (a.mime.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = a.url;
    audio.controls = true;
    frag.appendChild(audio);
  }

  // Tarjeta de descarga (para todos los tipos)
  const link = document.createElement('a');
  link.className = 'archivo';
  link.href = a.url;
  link.download = a.nombre;

  const icono = document.createElement('span');
  icono.className = 'icono';
  icono.textContent = a.mime.startsWith('image/') ? '🖼️'
    : a.mime.startsWith('video/') ? '🎬'
    : a.mime.startsWith('audio/') ? '🎵'
    : iconoPara(a.mime, a.nombre);

  const info = document.createElement('span');
  info.className = 'info';
  const b = document.createElement('b');
  b.textContent = a.nombre;
  const small = document.createElement('small');
  small.textContent = `${tamanoLegible(a.tamano)} · Descargar`;
  info.append(b, small);

  link.append(icono, info);
  frag.appendChild(link);
  return frag;
}

function agregarMensaje(m, esNuevo) {
  const propio = m.usuario === yo;
  const pegado = estaAbajo();

  const div = document.createElement('div');
  div.className = 'msg ' + (propio ? 'propio' : 'ajeno');

  if (!propio) {
    const autor = document.createElement('div');
    autor.className = 'autor';
    autor.textContent = m.usuario;
    autor.style.color = `hsl(${colorDe(m.usuario).match(/\d+/)[0]} 70% 65%)`;
    div.appendChild(autor);
  }

  if (m.tipo === 'texto') {
    const texto = document.createElement('div');
    texto.className = 'texto';
    texto.textContent = m.texto;   // textContent evita que alguien inyecte HTML
    div.appendChild(texto);
  } else if (m.tipo === 'archivo') {
    div.appendChild(contenidoArchivo(m.archivo, pegado || propio));
  }

  const h = document.createElement('span');
  h.className = 'hora';
  h.textContent = hora(m.fecha);
  div.appendChild(h);

  mensajesEl.appendChild(div);
  if (propio || pegado) bajarAlFinal();

  if (esNuevo && !propio) {
    sonar();
    if (document.hidden) { sinLeer++; actualizarTitulo(); }
  }
}

function agregarAviso(texto) {
  const pegado = estaAbajo();
  const div = document.createElement('div');
  div.className = 'aviso';
  div.textContent = texto;
  mensajesEl.appendChild(div);
  if (pegado) bajarAlFinal();
}

// ---------- Conexión con el servidor ----------
const socket = io({ auth: { token } });

socket.on('connect', () => {
  $('estado').textContent = 'En línea';
});

socket.on('connect_error', (err) => {
  if (err.message === 'no-autorizado') {
    // El servidor se reinició o la sesión ya no existe
    sessionStorage.clear();
    location.replace('/');
  } else {
    $('estado').textContent = 'Sin conexión, reintentando...';
  }
});

socket.on('disconnect', () => {
  $('estado').textContent = 'Reconectando...';
});

socket.on('historial', (lista) => {
  mensajesEl.innerHTML = '';
  lista.forEach(m => agregarMensaje(m, false));
  bajarAlFinal();
});

socket.on('mensaje', (m) => agregarMensaje(m, true));
socket.on('aviso', agregarAviso);

socket.on('usuarios', (lista) => {
  $('contador').textContent = lista.length;
  $('estado').textContent = `${lista.length} en línea`;
  const ul = $('listaUsuarios');
  ul.innerHTML = '';
  lista.forEach(nombre => {
    const li = document.createElement('li');
    const nom = document.createElement('span');
    nom.textContent = nombre;
    li.append(crearAvatar(nombre), nom);
    if (nombre === yo) {
      const tu = document.createElement('span');
      tu.className = 'tu';
      tu.textContent = '(tú)';
      li.appendChild(tu);
    }
    const punto = document.createElement('span');
    punto.className = 'punto';
    li.appendChild(punto);
    ul.appendChild(li);
  });
});

// ---------- "Está escribiendo..." ----------
const escribiendoAhora = new Set();
socket.on('escribiendo', ({ usuario, estado }) => {
  estado ? escribiendoAhora.add(usuario) : escribiendoAhora.delete(usuario);
  const nombres = [...escribiendoAhora];
  $('escribiendo').textContent =
    nombres.length === 0 ? '' :
    nombres.length === 1 ? `${nombres[0]} está escribiendo...` :
    `${nombres.join(' y ')} están escribiendo...`;
});

let yoEscribiendo = false;
let timerEscribiendo;
inputMensaje.addEventListener('input', () => {
  if (!yoEscribiendo) {
    yoEscribiendo = true;
    socket.emit('escribiendo', true);
  }
  clearTimeout(timerEscribiendo);
  timerEscribiendo = setTimeout(() => {
    yoEscribiendo = false;
    socket.emit('escribiendo', false);
  }, 1500);
});

// ---------- Enviar texto ----------
$('formMensaje').addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = inputMensaje.value.trim();
  if (!texto) return;
  socket.emit('mensaje', texto);
  inputMensaje.value = '';
  clearTimeout(timerEscribiendo);
  yoEscribiendo = false;
  socket.emit('escribiendo', false);
  inputMensaje.focus();
});

// ---------- Enviar archivos (con barra de progreso) ----------
function subirArchivo(file) {
  if (file.size > LIMITE_MB * 1024 * 1024) {
    alert(`El archivo pasa de ${LIMITE_MB} MB.`);
    return;
  }
  const datos = new FormData();
  datos.append('archivo', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('Authorization', token);

  const barra = progresoEl.querySelector('.barra div');
  const texto = progresoEl.querySelector('span');
  progresoEl.hidden = false;
  barra.style.width = '0%';
  texto.textContent = `Enviando ${file.name}... 0%`;

  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    barra.style.width = pct + '%';
    texto.textContent = `Enviando ${file.name}... ${pct}%`;
  };

  xhr.onload = () => {
    progresoEl.hidden = true;
    if (xhr.status === 401) { sessionStorage.clear(); location.replace('/'); return; }
    if (xhr.status !== 200) {
      let msg = 'No se pudo enviar el archivo.';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      alert(msg);
    }
  };

  xhr.onerror = () => {
    progresoEl.hidden = true;
    alert('Se perdió la conexión al enviar el archivo.');
  };

  xhr.send(datos);
}

$('inputArchivo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) subirArchivo(file);
  e.target.value = '';
});

// Arrastrar y soltar archivos sobre el chat
mensajesEl.addEventListener('dragover', (e) => e.preventDefault());
mensajesEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) subirArchivo(file);
});

// ---------- Cerrar sesión ----------
$('btnSalir').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', headers: { Authorization: token } });
  } catch {}
  socket.disconnect();
  sessionStorage.clear();
  location.replace('/');
});

// ---------- Menú en celular ----------
function cerrarMenu() {
  $('sidebar').classList.remove('abierto');
  $('fondo').classList.remove('visible');
}
$('btnMenu').addEventListener('click', () => {
  $('sidebar').classList.add('abierto');
  $('fondo').classList.add('visible');
});
$('fondo').addEventListener('click', cerrarMenu);