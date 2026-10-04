// ============================================
//  CHAT EN LA NUBE - Servidor
//  Node.js + Express + Socket.io
// ============================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

// ---------- Configuración ----------
const PUERTO = process.env.PORT || 3000;
const LIMITE_MB = 25;          // tamaño máximo de archivo
const MAX_HISTORIAL = 100;     // mensajes que se guardan

const DIR_DATA = path.join(__dirname, 'data');
const DIR_UPLOADS = path.join(__dirname, 'uploads');
const ARCH_USUARIOS = path.join(DIR_DATA, 'usuarios.json');
const ARCH_HISTORIAL = path.join(DIR_DATA, 'historial.json');

fs.mkdirSync(DIR_DATA, { recursive: true });
fs.mkdirSync(DIR_UPLOADS, { recursive: true });

// ---------- Utilidades para guardar datos ----------
function leerJSON(archivo, porDefecto) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); }
  catch { return porDefecto; }
}
function guardarJSON(archivo, datos) {
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
}

const usuarios = leerJSON(ARCH_USUARIOS, {});      // { nombre: contraseñaCifrada }
let historial = leerJSON(ARCH_HISTORIAL, []);      // últimos mensajes
const sesiones = new Map();                        // token -> nombre
const conectados = new Map();                      // nombre -> pestañas abiertas

// ---------- Servidor web ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Los archivos subidos se sirven "en modo seguro" (no pueden ejecutar código)
app.use('/uploads', express.static(DIR_UPLOADS, {
  setHeaders: (res) => {
    res.set('Content-Security-Policy', 'sandbox');
    res.set('X-Content-Type-Options', 'nosniff');
  }
}));

function nombreValido(n) {
  return typeof n === 'string' && /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,20}$/.test(n);
}

function crearSesion(nombre) {
  const token = crypto.randomBytes(24).toString('hex');
  sesiones.set(token, nombre);
  return token;
}

function requiereSesion(req, res, next) {
  const nombre = sesiones.get(req.get('Authorization'));
  if (!nombre) return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
  req.usuario = nombre;
  next();
}

// Guarda un mensaje en el historial y lo manda a todos
function publicar(datos) {
  const msg = { id: crypto.randomUUID(), fecha: Date.now(), ...datos };
  historial.push(msg);
  if (historial.length > MAX_HISTORIAL) historial = historial.slice(-MAX_HISTORIAL);
  guardarJSON(ARCH_HISTORIAL, historial);
  io.emit('mensaje', msg);
}

// ---------- Rutas de cuentas ----------
app.post('/api/registro', async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!nombreValido(usuario)) {
    return res.status(400).json({ error: 'El usuario debe tener de 3 a 20 letras o números, sin espacios.' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
  }
  const existe = Object.keys(usuarios).some(u => u.toLowerCase() === usuario.toLowerCase());
  if (existe) return res.status(409).json({ error: 'Ese usuario ya existe.' });

  usuarios[usuario] = await bcrypt.hash(password, 10);
  guardarJSON(ARCH_USUARIOS, usuarios);
  res.json({ token: crearSesion(usuario), usuario });
});

app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  const hash = typeof usuario === 'string' ? usuarios[usuario] : undefined;
  const ok = hash && typeof password === 'string' && await bcrypt.compare(password, hash);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  res.json({ token: crearSesion(usuario), usuario });
});

app.post('/api/logout', (req, res) => {
  const token = req.get('Authorization');
  sesiones.delete(token);
  for (const s of io.sockets.sockets.values()) {
    if (s.data.token === token) s.disconnect(true);
  }
  res.json({ ok: true });
});

// ---------- Subida de archivos ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: DIR_UPLOADS,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
    }
  }),
  limits: { fileSize: LIMITE_MB * 1024 * 1024 }
});

app.post('/api/upload', requiereSesion, upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo.' });
  // Corrige acentos en el nombre del archivo
  const nombreOriginal = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  publicar({
    usuario: req.usuario,
    tipo: 'archivo',
    archivo: {
      url: '/uploads/' + req.file.filename,
      nombre: nombreOriginal,
      mime: req.file.mimetype,
      tamano: req.file.size
    }
  });
  res.json({ ok: true });
});

// Errores (por ejemplo, archivo demasiado grande)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `El archivo pasa de ${LIMITE_MB} MB.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Error en el servidor.' });
});

// ---------- Tiempo real (Socket.io) ----------
// Nadie entra al chat sin un token válido
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const nombre = sesiones.get(token);
  if (!nombre) return next(new Error('no-autorizado'));
  socket.data.usuario = nombre;
  socket.data.token = token;
  next();
});

function enviarConectados() {
  io.emit('usuarios', [...conectados.keys()].sort());
}

io.on('connection', (socket) => {
  const nombre = socket.data.usuario;
  const antes = conectados.get(nombre) || 0;
  conectados.set(nombre, antes + 1);

  socket.emit('historial', historial);
  if (antes === 0) socket.broadcast.emit('aviso', `${nombre} se conectó`);
  enviarConectados();

  socket.on('mensaje', (texto) => {
    if (typeof texto !== 'string') return;
    texto = texto.trim().slice(0, 2000);
    if (!texto) return;
    publicar({ usuario: nombre, tipo: 'texto', texto });
  });

  socket.on('escribiendo', (estado) => {
    socket.broadcast.emit('escribiendo', { usuario: nombre, estado: !!estado });
  });

  socket.on('disconnect', () => {
    const quedan = (conectados.get(nombre) || 1) - 1;
    if (quedan <= 0) {
      conectados.delete(nombre);
      io.emit('aviso', `${nombre} salió del chat`);
      io.emit('escribiendo', { usuario: nombre, estado: false });
    } else {
      conectados.set(nombre, quedan);
    }
    enviarConectados();
  });
});

server.listen(PUERTO, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PUERTO}`);
});