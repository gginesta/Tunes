import express from 'express';
import { createServer } from 'http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import type { ClientToServerEvents, ServerToClientEvents } from '@tunes/shared';
import {
  dinnerStartsEnabled, enabledLicensedPacks, getRoomCount, getTotalPlayerCount, registerRoomHandlers,
  restoreRoomsFromDatabase, stopRoomRuntime,
} from './rooms';
import { registerLicensedAudioRoutes, spotifyClassicAvailable } from './partyCatalogue';
import { closeDatabase, initDatabase } from './database';
import { createRateLimiter } from './rateLimit';
import { logger } from './logger';

const revision = process.env.BUILD_REVISION || 'development';
const protocolVersion = 2;

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
if (process.env.TUNES_PREVIEW === 'true') {
  app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
}
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
restoreRoomsFromDatabase(io);

const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
const runtimeMetrics = setInterval(() => {
  logger.debug('Runtime diagnostics', {
    rooms: getRoomCount(),
    players: getTotalPlayerCount(),
    eventLoopP50Ms: eventLoop.percentile(50) / 1e6,
    eventLoopP95Ms: eventLoop.percentile(95) / 1e6,
  });
  eventLoop.reset();
}, 60_000).unref();

// Per-socket throttle: no legitimate client emits anywhere near this rate.
const eventLimiter = createRateLimiter(20, 1000);

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  const licensedPacks = enabledLicensedPacks();
  socket.emit('server-config', {
    previewSongsAvailable: false,
    licensedPacksAvailable: licensedPacks.length > 0,
    licensedPacks,
    dinnerAvailable: dinnerStartsEnabled(),
    spotifyClassicAvailable: spotifyClassicAvailable(),
    revision,
    protocolVersion,
  });

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
    revision,
  });
});

registerLicensedAudioRoutes(app);

// In production, serve the built React app as static files
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../../app/dist');
  app.use('/listening', express.static(path.join(clientDistPath, 'listening'), {immutable:true, maxAge:'7d'}));
  app.use('/listening', (_req, res) => { res.sendStatus(404); });
  app.use(express.static(clientDistPath));

  // Catch-all route for client-side routing
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const port = Number(process.env.PORT || 3000);
const host = process.env.TUNES_BIND_HOST;
httpServer.listen({port, host}, () => {
  logger.info('Tunes server started', {port, revision, node: process.version});
});

function shutdown(): void {
  clearInterval(runtimeMetrics);
  eventLoop.disable();
  void io.close(() => {
    stopRoomRuntime();
    closeDatabase();
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
