const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const Redis = require('ioredis');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Ficheros 
let users = [];

fs.readFile("users_db.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading 'users' database from file:", err);
    return;
  }
  try {
    users = JSON.parse(data).users;
    console.log('JSON data:', users);
  } catch (jsonErr) {
    console.error('Error parsing JSON:', jsonErr);
  }
});

// Crear cliente de Redis para la sesión
const redisClient = new Redis();
const redisPublisher = new Redis();

// Configurar la sesión de Express para usar el almacenamiento de Redis
const sessionMiddleware = session({
  store: new RedisStore({ client: redisClient }),
  secret: 'mySecret',
  saveUninitialized: false,
  resave: false,
  cookie: {
    httpOnly: true,
    secure: false, // En producción, debería ser true si estás usando HTTPS
    maxAge: 86400000 // 24 horas
  }
});

app.use(sessionMiddleware);

// Middleware para servir la página principal
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Compartir la sesión entre Express y Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Configurar suscriptor de Redis
const redisSubscriber = new Redis();
redisSubscriber.subscribe('chat-channel');

// Escuchar mensajes globales de Redis y transmitir a los clientes de Socket.io
redisSubscriber.on('message', (channel, message) => {
  io.emit('chat message', message);
});

io.on('connection', (socket) => {
  // Recuperar la sesión del handshake
  const session = socket.request.session;

  // Emitir el estado de la sesión al cliente
  socket.emit('session status', { loggedIn: !!session.username, canSend: session.canSend });
  
  console.log(`Un usuario se ha conectado con la sesión ID: ${session.id}`);
  
  // Escuchar el evento 'add user'
  socket.on('add user', (username) => {
    // Get message permissions
    const [canReceive, canSend] = getMessagePermissions(username);

    socket.emit('permission status', { canReceive: canReceive, canSend: canSend });

    if (!canReceive) {
      console.log(`El intento de conexión del usuario con la sesión ID: ${session.id} fue rechazada: No tiene permiso para recibir mensajes.`);
      return;
    }

    session.username = username; // Almacenar el nombre de usuario en la sesión
    session.canSend = canSend; // Almacenar el nombre de envío de mensajes
    session.save();
    socket.emit('login', { username: username });
  });

  // Escuchar mensajes del cliente y publicarlos en Redis
  socket.on('chat message', (msg) => {
    const username = session.username || 'Anónimo';
    const message = `${username}: ${msg}`;
    redisPublisher.publish('chat-channel', message);
  });

  socket.on('disconnect', () => {
    console.log(`Un usuario con la sesión ID: ${session.id} se ha desconectado`);
    // No es necesario desuscribirse aquí porque hay un único suscriptor global
  });
});

server.listen(3000, () => {
  console.log('Servidor escuchando en *:3000');
});

// Functions

function getMessagePermissions(username) {
  // [canReceiveMessage, canSendMessage]
  let permission = [false, false];

  // Search for the input username in the users database
  for (let i=0; i<length(users); i++) {
    user = users[i]

    if (user.name !== username) {
      continue;
    }
    if (user.status === "teacher") {
      permission = [true, true];
    } else if (user.status === "student") {
      permission[0] = true;
    }
  }

  return permission;
}