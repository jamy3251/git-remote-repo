// Listen Together — synced YouTube listening server (v2: explicit queue + recommendations).
//
// The server NEVER streams audio. Each client plays YouTube directly via the IFrame
// API; the server only relays room state (queue, current index, play/pause, host's
// position) so every client keeps its own local player in sync. No choppiness.
//
// v2 adds an explicit queue model (add / skip / jump / remove) and a recommendation
// endpoint backed by the free YouTube Data API (search-based, since the API's
// related-videos parameter was removed in 2023). Single-video titles use oEmbed,
// which needs no key, so adding a video works even before YT_API_KEY is set.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY || '';
const REAL_PLAYLIST = /^(PL|OL|UU|FL|LL)/;

const app = express();
app.use(express.static(join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, recommendations: !!YT_API_KEY }));

// ---- YouTube helpers ----

// Parse a pasted URL/id into { videoId, playlistId }.
function parseYouTube(raw) {
  raw = String(raw || '').trim();
  if (!raw) return {};
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Bare id.
    if (REAL_PLAYLIST.test(raw) || /^RD/.test(raw)) return { playlistId: raw };
    return { videoId: raw };
  }
  const playlistId = url.searchParams.get('list') || undefined;
  let videoId = url.searchParams.get('v') || undefined;
  if (!videoId && url.hostname.includes('youtu.be')) videoId = url.pathname.slice(1) || undefined;
  if (!videoId && url.pathname.startsWith('/shorts/')) videoId = url.pathname.split('/')[2];
  return { videoId, playlistId };
}

// Single video title via oEmbed (no API key required).
async function oembedTitle(videoId) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j.title || null;
  } catch {
    return null;
  }
}

// Expand a real playlist into tracks via the Data API (needs key). Caps at 100.
async function playlistTracks(playlistId) {
  if (!YT_API_KEY) return { error: 'NO_KEY' };
  const tracks = [];
  let pageToken = '';
  try {
    for (let i = 0; i < 2; i++) {
      const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      u.searchParams.set('part', 'snippet');
      u.searchParams.set('maxResults', '50');
      u.searchParams.set('playlistId', playlistId);
      u.searchParams.set('key', YT_API_KEY);
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const r = await fetch(u);
      if (!r.ok) return { error: `YT_${r.status}` };
      const j = await r.json();
      for (const it of j.items || []) {
        const vid = it.snippet?.resourceId?.videoId;
        const title = it.snippet?.title;
        if (vid && title && title !== 'Private video' && title !== 'Deleted video') {
          tracks.push({ id: vid, title });
        }
      }
      pageToken = j.nextPageToken || '';
      if (!pageToken) break;
    }
    return { tracks };
  } catch {
    return { error: 'FETCH_FAILED' };
  }
}

// Normalize a title for de-duplication / same-song detection.
function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/official|video|audio|lyrics?|m\/?v|remaster(ed)?|hd|4k|live|color\s*coded|han\/?rom\/?eng/gi, ' ')
    .replace(/feat\.?|ft\.?/gi, ' ')
    .replace(/[^a-z0-9가-힣 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Recommendations: music-category search seeded by the current track's ARTIST
// (so we get OTHER songs, not 8 versions of the same one). The official API's
// related-videos was removed in 2023, so this is search-based + de-duped.
async function recommend(seedTitle, excludeId) {
  if (!YT_API_KEY) return { error: 'NO_KEY' };
  const raw = String(seedTitle || '');
  // Split "Artist - Song" → search by artist, exclude the seed song's variants.
  const dash = raw.split(/[-–—]/);
  const artist = dash.length >= 2 ? dash[0] : '';
  const songPart = dash.length >= 2 ? dash.slice(1).join(' ') : raw;
  const q = (normTitle(artist) || normTitle(raw)).slice(0, 60);
  const songKey = normTitle(songPart);
  if (!q) return { tracks: [] };
  try {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('type', 'video');
    u.searchParams.set('videoCategoryId', '10'); // Music
    u.searchParams.set('maxResults', '24');
    u.searchParams.set('q', q);
    u.searchParams.set('key', YT_API_KEY);
    const r = await fetch(u);
    if (!r.ok) return { error: `YT_${r.status}` };
    const j = await r.json();
    const seen = new Set();
    const tracks = [];
    for (const it of j.items || []) {
      const id = it.id?.videoId;
      const title = it.snippet?.title;
      const channel = it.snippet?.channelTitle;
      if (!id || !title || id === excludeId) continue;
      const key = normTitle(title);
      if (!key) continue;
      if (songKey && songKey.length > 3 && key.includes(songKey)) continue; // skip same-song variants
      if (seen.has(key)) continue; // skip dup titles
      seen.add(key);
      tracks.push({ id, title, channel });
      if (tracks.length >= 8) break;
    }
    return { tracks };
  } catch {
    return { error: 'FETCH_FAILED' };
  }
}

// ---- REST endpoints ----

// Resolve a pasted URL into queue tracks (single video, or expanded playlist).
app.get('/api/resolve', async (req, res) => {
  const { videoId, playlistId } = parseYouTube(req.query.url);
  // Real playlist → expand (needs key).
  if (playlistId && REAL_PLAYLIST.test(playlistId)) {
    const out = await playlistTracks(playlistId);
    if (out.tracks && out.tracks.length) return res.json({ kind: 'playlist', tracks: out.tracks });
    // Fall through to single video if expansion failed and we have one.
    if (!videoId) return res.json({ kind: 'error', reason: out.error || 'EMPTY' });
  }
  if (videoId) {
    const title = (await oembedTitle(videoId)) || '제목 없음';
    return res.json({
      kind: 'video',
      tracks: [{ id: videoId, title }],
      mixFallback: !!(playlistId && /^RD/.test(playlistId)),
    });
  }
  if (playlistId && /^RD/.test(playlistId)) return res.json({ kind: 'mix' });
  return res.json({ kind: 'error', reason: 'UNRECOGNIZED' });
});

// Recommendations for the current track.
app.get('/api/recommend', async (req, res) => {
  const out = await recommend(req.query.title, req.query.videoId);
  res.json(out);
});

// YouTube search (general) — type a query, pick a result to queue.
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ tracks: [] });
  if (!YT_API_KEY) return res.json({ error: 'NO_KEY' });
  try {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('type', 'video');
    u.searchParams.set('maxResults', '12');
    u.searchParams.set('q', q);
    u.searchParams.set('key', YT_API_KEY);
    const r = await fetch(u);
    if (!r.ok) return res.json({ error: `YT_${r.status}` });
    const j = await r.json();
    const tracks = (j.items || [])
      .map((it) => ({ id: it.id?.videoId, title: it.snippet?.title, channel: it.snippet?.channelTitle }))
      .filter((t) => t.id && t.title);
    res.json({ tracks });
  } catch {
    res.json({ error: 'FETCH_FAILED' });
  }
});

const httpServer = createServer(app);
// Longer ping timeout so a backgrounded tab (alt-tabbed to the game) doesn't
// drop the socket on every throttle. Paired with the empty-room grace period.
const io = new Server(httpServer, { cors: { origin: false }, pingTimeout: 60000, pingInterval: 25000 });

const EMPTY_ROOM_GRACE_MS = 120000; // keep an empty room's queue alive this long

/**
 * rooms: Map<roomCode, RoomState>
 * RoomState = {
 *   hostId, members: Map<id,{name}>,
 *   queue: [{id, title}],   // explicit ordered queue
 *   index, isPlaying, position, updatedAt
 * }
 */
const rooms = new Map();

function makeRoom() {
  return {
    hostId: null, // sync anchor (drives the position heartbeat); NOT the sole controller
    members: new Map(),
    queue: [],
    index: 0,
    isPlaying: false,
    position: 0,
    updatedAt: Date.now(),
    seq: 0, // bumped on every explicit control/queue change (NOT on heartbeat)
    deleteTimer: null, // pending empty-room deletion (grace period)
  };
}

function snapshot(room) {
  return {
    hostId: room.hostId,
    queue: room.queue,
    index: room.index,
    isPlaying: room.isPlaying,
    position: room.position,
    updatedAt: room.updatedAt,
    seq: room.seq,
    serverNow: Date.now(),
    members: [...room.members.entries()].map(([id, m]) => ({
      id, name: m.name, isHost: id === room.hostId,
    })),
  };
}

function broadcastState(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit('state', snapshot(room));
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
    if (!room) { room = makeRoom(); rooms.set(code, room); }
    // Cancel any pending empty-room deletion — someone came (back).
    if (room.deleteTimer) { clearTimeout(room.deleteTimer); room.deleteTimer = null; }
    joinedCode = code;
    socket.join(code);
    room.members.set(socket.id, { name: (name || '익명').slice(0, 24) });
    if (!room.hostId) room.hostId = socket.id;
    socket.emit('joined', { room: code, youAreHost: room.hostId === socket.id });
    broadcastState(code);
  });

  // Anyone in the room may add tracks to the shared queue.
  socket.on('queue_add', ({ tracks } = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id) || !Array.isArray(tracks)) return;
    const clean = tracks
      .filter((t) => t && typeof t.id === 'string')
      .slice(0, 100)
      .map((t) => ({ id: t.id, title: String(t.title || '제목 없음').slice(0, 200) }));
    if (!clean.length) return;
    const wasEmpty = room.queue.length === 0;
    room.queue.push(...clean);
    if (wasEmpty) {
      // First track starts playback. Appending to a non-empty queue must NOT
      // touch position/updatedAt, or clients re-seek and the video buffers.
      room.index = 0;
      room.position = 0;
      room.isPlaying = true;
      room.updatedAt = Date.now();
    }
    room.seq++;
    broadcastState(joinedCode);
  });

  // Playback control — ANY member can change songs / play / pause (collaborative).
  socket.on('control', (payload = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id)) return;
    const now = Date.now();
    switch (payload.action) {
      case 'play': room.isPlaying = true; break;
      case 'pause': room.isPlaying = false; break;
      case 'seek': break;
      case 'next': if (room.index < room.queue.length - 1) { room.index++; room.position = 0; } break;
      case 'prev': if (room.index > 0) { room.index--; room.position = 0; } break;
      case 'jump':
        if (typeof payload.index === 'number' && payload.index >= 0 && payload.index < room.queue.length) {
          room.index = payload.index; room.position = 0;
        }
        break;
      default: return;
    }
    if (typeof payload.position === 'number' && payload.action !== 'next' && payload.action !== 'prev' && payload.action !== 'jump') {
      room.position = payload.position;
    }
    room.seq++;
    room.updatedAt = now;
    broadcastState(joinedCode);
  });

  // Anyone may remove a queue item (collaborative; 2-friend rooms).
  socket.on('queue_remove', ({ index } = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id)) return;
    if (typeof index !== 'number' || index < 0 || index >= room.queue.length) return;
    room.queue.splice(index, 1);
    let currentRemoved = false;
    if (index < room.index) room.index--;
    else if (index === room.index) { room.position = 0; currentRemoved = true; } // next slides in
    if (room.index >= room.queue.length) room.index = Math.max(0, room.queue.length - 1);
    room.seq++;
    // Only a removed CURRENT track changes playback → reset updatedAt then.
    // Removing other items must not re-seek the current video.
    if (currentRemoved) room.updatedAt = Date.now();
    broadcastState(joinedCode);
  });

  // Anyone may reorder the queue (drag-and-drop).
  socket.on('queue_move', ({ from, to } = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id)) return;
    const n = room.queue.length;
    if (typeof from !== 'number' || typeof to !== 'number') return;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
    const [item] = room.queue.splice(from, 1);
    room.queue.splice(to, 0, item);
    // Keep the currently-playing track as the current index after the move.
    let c = room.index;
    if (from === room.index) c = to;
    else { if (from < c) c -= 1; if (to <= c) c += 1; }
    room.index = Math.max(0, Math.min(room.queue.length - 1, c));
    // Reorder doesn't change the current track or its position → don't reset
    // updatedAt (would cause a re-seek/buffer on the clients).
    room.seq++;
    broadcastState(joinedCode);
  });

  // Host heartbeat — frequent, cheap, for guest drift correction.
  socket.on('heartbeat', (payload = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || socket.id !== room.hostId) return;
    if (typeof payload.position === 'number') room.position = payload.position;
    if (typeof payload.isPlaying === 'boolean') room.isPlaying = payload.isPlaying;
    room.updatedAt = Date.now();
    socket.to(joinedCode).emit('state', snapshot(room));
  });

  // Mini chat — ephemeral, relayed to the room (not stored).
  socket.on('chat', ({ text } = {}) => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id)) return;
    const t = String(text || '').slice(0, 300).trim();
    if (!t) return;
    const name = room.members.get(socket.id).name;
    io.to(joinedCode).emit('chat', { name, text: t, you: socket.id });
  });

  socket.on('take_control', () => {
    const room = joinedCode && rooms.get(joinedCode);
    if (!room || !room.members.has(socket.id)) return;
    room.hostId = socket.id;
    broadcastState(joinedCode);
  });

  socket.on('disconnect', () => {
    const code = joinedCode;
    const room = code && rooms.get(code);
    if (!room) return;
    room.members.delete(socket.id);
    if (room.members.size === 0) {
      // Don't nuke the queue on a transient drop (alt-tab to the game). Keep the
      // room alive for a grace period; delete only if still empty afterwards.
      room.hostId = null; // next joiner becomes the sync anchor
      if (room.deleteTimer) clearTimeout(room.deleteTimer);
      room.deleteTimer = setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.members.size === 0) rooms.delete(code);
      }, EMPTY_ROOM_GRACE_MS);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.members.keys().next().value || null;
    broadcastState(code);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Listen Together on http://localhost:${PORT} (recommendations: ${YT_API_KEY ? 'on' : 'off'})`);
});

export { app, httpServer };
