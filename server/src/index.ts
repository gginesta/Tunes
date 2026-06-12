import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import type { ClientToServerEvents, ServerToClientEvents } from '@tunes/shared';
import { registerRoomHandlers, restoreRoomsFromDatabase, getRoomCount, getTotalPlayerCount } from './rooms';
import { loadSongs } from './songs';
import { initDatabase } from './database';
import { createRateLimiter } from './rateLimit';
import { logger } from './logger';

// CORS: explicit allowlist via ALLOWED_ORIGINS (comma-separated). Without it,
// dev allows any origin (Vite runs on another port) while production allows
// none — the server serves the built app itself, so same-origin needs no CORS.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const corsOrigin: string[] | boolean =
  allowedOrigins.length > 0 ? allowedOrigins : process.env.NODE_ENV !== 'production';

const app = express();
app.use(cors({ origin: corsOrigin }));
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
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000,
});

initDatabase();
loadSongs();
restoreRoomsFromDatabase(io);

// Per-socket throttle: no legitimate client emits anywhere near this rate.
const eventLimiter = createRateLimiter(20, 1000);

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  socket.use((_packet, next) => {
    if (!eventLimiter.allow(socket.id)) return; // drop silently
    next();
  });

  registerRoomHandlers(io, socket);

  socket.on('disconnect', () => {
    eventLimiter.clear(socket.id);
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
