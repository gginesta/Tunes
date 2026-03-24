import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
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

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Hitster server running on port ${PORT}`);
});
