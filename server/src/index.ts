import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import type { ClientToServerEvents, ServerToClientEvents } from '@hitster/shared';
import { registerRoomHandlers } from './rooms';
import { registerAuthHandlers } from './accounts-handler';
import { loadSongs } from './songs';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

loadSongs();

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  registerRoomHandlers(io, socket);
  registerAuthHandlers(socket);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
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
  console.log(`Hitster server running on port ${PORT}`);
});
