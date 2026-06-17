// Listen Together — synced YouTube listening server.
//
// Architecture (design premise #2): the server NEVER streams audio. Each client
// plays YouTube directly via the IFrame API. The server only relays room state
// (which playlist, which track, playing/paused, host's current position) so every
// client can keep its own local player in sync. This is why there is no choppiness
// like a Discord music bot — there is no single machine fanning out an audio stream.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: false } });

/**
 * rooms: Map<roomCode, RoomState>
 * RoomState = {
 *   hostId: string|null,          // socket id of the controller
 *   playlist: { listType, list }|null, // youtube playlist or video cue spec
 *   index: number,                // current track index within the playlist
 *   isPlaying: boolean,
 *   position: number,             // host's playback position (seconds) at updatedAt
 *   updatedAt: number,            // server epoch ms when position was last set
 *   members: Map<socketId, {name}>
 * }
 */
const rooms = new Map();

function makeRoom() {
  return {
    hostId: null,
    playlist: null,
    index: 0,
    isPlaying: false,
    position: 0,
    updatedAt: Date.now(),
    members: new Map(),
  };
}

// Snapshot a room into the payload clients use to reconcile their local player.
// We send serverNow so clients can extrapolate the host's current position even
// though the last heartbeat was a moment ago.
function snapshot(room) {
  return {
    hostId: room.hostId,
    playlist: room.playlist,
    index: room.index,
    isPlaying: room.isPlaying,
    position: room.position,
    updatedAt: room.updatedAt,
    serverNow: Date.now(),
    members: [...room.members.entries()].map(([id, m]) => ({
      id,
      name: m.name,
      isHost: id === room.hostId,
    })),
  };
}

function broadcastState(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('state', snapshot(room));
}

io.on('connection', (socket) => {
  let joinedCode = null;

  socket.on('join', ({ room: code, name } = {}) => {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      socket.emit('error_msg', '잘못된 방 코드예요.');
      return;
    }
    let room = rooms.get(code);
    if (!room) {
      room = makeRoom();
      rooms.set(code, room);
    }
    joinedCode = code;
    socket.join(code);
    room.members.set(socket.id, { name: (name || '익명').slice(0, 24) });
    // First person in the room becomes the host (the controller).
    if (!room.hostId) room.hostId = socket.id;

    socket.emit('joined', { room: code, youAreHost: room.hostId === socket.id });
    broadcastState(code);
  });

  // Host-only: discrete control actions (load playlist, play, pause, seek, change track).
  socket.on('control', (payload = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room) return;
    if (socket.id !== room.hostId) return; // only the host drives playback

    const now = Date.now();
    switch (payload.action) {
      case 'load':
        // payload.playlist = { listType: 'playlist'|'video', list: string }
        room.playlist = payload.playlist || null;
        room.index = typeof payload.index === 'number' ? payload.index : 0;
        room.position = 0;
        room.isPlaying = true;
        room.updatedAt = now;
        break;
      case 'play':
        room.isPlaying = true;
        if (typeof payload.position === 'number') room.position = payload.position;
        room.updatedAt = now;
        break;
      case 'pause':
        room.isPlaying = false;
        if (typeof payload.position === 'number') room.position = payload.position;
        room.updatedAt = now;
        break;
      case 'seek':
        if (typeof payload.position === 'number') room.position = payload.position;
        room.updatedAt = now;
        break;
      case 'track':
        if (typeof payload.index === 'number') room.index = payload.index;
        room.position = 0;
        room.updatedAt = now;
        break;
      default:
        return;
    }
    broadcastState(joinedCode);
  });

  // Host-only: frequent low-cost heartbeat so guests can correct drift.
  socket.on('heartbeat', (payload = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (typeof payload.position === 'number') room.position = payload.position;
    if (typeof payload.index === 'number') room.index = payload.index;
    if (typeof payload.isPlaying === 'boolean') room.isPlaying = payload.isPlaying;
    room.updatedAt = Date.now();
    // Relay to everyone except the host (the host already knows its own state).
    socket.to(joinedCode).emit('state', snapshot(room));
  });

  // Anyone can take control; this transfers host to the requester.
  socket.on('take_control', () => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id)) return;
    room.hostId = socket.id;
    broadcastState(joinedCode);
  });

  socket.on('disconnect', () => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room) return;
    room.members.delete(socket.id);
    if (room.members.size === 0) {
      rooms.delete(joinedCode);
      return;
    }
    // If the host left, promote the next member so playback keeps a controller.
    if (room.hostId === socket.id) {
      room.hostId = room.members.keys().next().value || null;
    }
    broadcastState(joinedCode);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Listen Together on http://localhost:${PORT}`);
});

export { app, httpServer };
