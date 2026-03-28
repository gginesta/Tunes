import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import type { ClientToServerEvents, ServerToClientEvents } from '@tunes/shared';
import { registerRoomHandlers, restoreRoomsFromDatabase, getRoomCount, getTotalPlayerCount } from './rooms';
import { registerAuthHandlers } from './accounts-handler';
import { migrateAccountsFromJson } from './accounts';
import { loadSongs } from './songs';
import { initDatabase } from './database';
import { logger } from './logger';

const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  // Skip health checks and socket.io polling to reduce noise
  if (req.path === '/health' || req.path.startsWith('/socket.io')) {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  next();
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000,
});

initDatabase();
migrateAccountsFromJson();
loadSongs();
restoreRoomsFromDatabase(io);

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });
  registerRoomHandlers(io, socket);
  registerAuthHandlers(socket);

  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    rooms: getRoomCount(),
    players: getTotalPlayerCount(),
    version: '1.0.0',
  });
});

// In production, serve the built React app as static files
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../../app/dist');
  app.use(express.static(clientDistPath));

  // Catch-all route for client-side routing
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info('Tunes server started', { port: PORT });
});
