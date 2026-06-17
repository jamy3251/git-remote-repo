/* Listen Together client.
 *
 * Sync model (design premise #2): one member is the host (controller). The host's
 * local YouTube player is the source of truth. The server relays the host's state
 * (track index, play/pause, position) to guests, who nudge their OWN local player
 * to match. Audio is never streamed through the server, so there is no choppiness.
 */

const $ = (sel) => document.querySelector(sel);

// ---- Elements ----
const lobbyEl = $('#lobby');
const roomEl = $('#room');
const nameInput = $('#name-input');
const roomInput = $('#room-input');
const lobbyError = $('#lobby-error');
const roomCodeLabel = $('#room-code-label');
const roleBadge = $('#role-badge');
const hostControls = $('#host-controls');
const playlistInput = $('#playlist-input');
const membersEl = $('#members');
const syncStatus = $('#sync-status');
const nowTime = $('#now-time');
const takeControlBtn = $('#take-control');
const startGate = $('#start-gate');

// ---- State ----
let socket = null;
let player = null;
let ytReady = false;
let pendingState = null;     // latest server state before player exists
let lastState = null;        // most recent server snapshot
let lastStateRecvAt = 0;     // client clock when lastState arrived
let isHost = false;
let started = false;         // user tapped the start gate (autoplay unlock)
let currentRoom = null;
let loadedPlaylistKey = null;
let suppressEmitUntil = 0;   // ignore host onStateChange right after a programmatic change
let noticeUntil = 0;         // keep a transient notice in #sync-status until this time

// Show a message in #sync-status that survives the status loop for `ms` ms.
function showNotice(msg, ms = 8000) {
  syncStatus.textContent = msg;
  noticeUntil = Date.now() + ms;
}

// ---- YouTube API ----
window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
};

function createPlayer() {
  if (!ytReady || player) return;
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: { controls: 1, modestbranding: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: () => {
        if (pendingState) applyState(pendingState);
        startLoops();
      },
      onStateChange: onPlayerStateChange,
    },
  });
}

// ---- Helpers ----
function genRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// Real user/uploaded playlists (PL/OL/UU/FL/LL) load via the IFrame API.
// Auto-generated mixes (RD, RDMM, RDCLAK, RDEM...) do NOT — YouTube blocks
// loadPlaylist for them. For a mix URL we fall back to the single video.
function isRealPlaylist(id) {
  return /^(PL|OL|UU|FL|LL)/.test(id || '');
}

// Parse a pasted YouTube URL into an IFrame cue spec.
function parsePlaylist(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Bare id.
    if (isRealPlaylist(raw)) return { listType: 'playlist', list: raw, index: 0 };
    if (/^RD/.test(raw)) return { listType: 'mix', list: raw }; // unsupported mix id alone
    return { listType: 'video', list: raw };
  }
  const list = url.searchParams.get('list');
  let v = url.searchParams.get('v');
  if (!v && url.hostname.includes('youtu.be')) v = url.pathname.slice(1);
  // YouTube's ?index= is 1-based; our player index is 0-based.
  const idxRaw = parseInt(url.searchParams.get('index') || '', 10);
  const index = Number.isFinite(idxRaw) && idxRaw > 0 ? idxRaw - 1 : 0;

  if (list && isRealPlaylist(list)) return { listType: 'playlist', list, index };
  // Mix (RD...) or unrecognized list: play the single video if the URL has one.
  if (v) return { listType: 'video', list: v, mixFallback: !!list };
  if (list) return { listType: 'mix', list }; // mix with no video → unsupported
  return null;
}

function playlistKey(p) {
  return p ? `${p.listType}:${p.list}` : null;
}

function loadIntoPlayer(p, index) {
  if (!player || !p) return;
  loadedPlaylistKey = playlistKey(p);
  suppressEmitUntil = Date.now() + 1500;
  if (p.listType === 'playlist') {
    player.loadPlaylist({ list: p.list, listType: 'playlist', index: index || 0 });
  } else {
    player.loadVideoById(p.list);
  }
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Extrapolate the host's current position using only server-side deltas
// (immune to client/server clock skew) plus local elapsed time since receipt.
function expectedPosition() {
  if (!lastState) return 0;
  const serverAge = lastState.isPlaying
    ? Math.max(0, (lastState.serverNow - lastState.updatedAt) / 1000)
    : 0;
  const sinceRecv = lastState.isPlaying ? (Date.now() - lastStateRecvAt) / 1000 : 0;
  return lastState.position + serverAge + sinceRecv;
}

// ---- Apply server state to the local player ----
function applyState(s) {
  lastState = s;
  lastStateRecvAt = Date.now();
  renderMembers(s);
  renderRole(s);

  if (!player || !started) {
    pendingState = s;
    return;
  }
  pendingState = null;

  // Load the playlist/video if it changed.
  if (s.playlist && playlistKey(s.playlist) !== loadedPlaylistKey) {
    loadIntoPlayer(s.playlist, s.index);
  }

  if (isHost) return; // host is the source of truth; don't fight itself.

  // Guest reconciliation.
  try {
    if (typeof player.getPlaylistIndex === 'function') {
      const idx = player.getPlaylistIndex();
      if (s.playlist && s.playlist.listType === 'playlist' && idx >= 0 && idx !== s.index) {
        suppressEmitUntil = Date.now() + 1500;
        player.playVideoAt(s.index);
      }
    }
    const target = expectedPosition();
    const cur = player.getCurrentTime();
    if (Math.abs(cur - target) > 1.0) player.seekTo(target, true);

    const ps = player.getPlayerState();
    if (s.isPlaying && ps !== YT.PlayerState.PLAYING) player.playVideo();
    if (!s.isPlaying && ps === YT.PlayerState.PLAYING) player.pauseVideo();
  } catch {
    /* player not fully ready yet */
  }
}

// ---- Host: react to native player controls ----
function onPlayerStateChange(e) {
  if (!isHost) return;
  if (Date.now() < suppressEmitUntil) return;
  if (e.data === YT.PlayerState.PLAYING) {
    socket.emit('control', { action: 'play', position: player.getCurrentTime() });
  } else if (e.data === YT.PlayerState.PAUSED) {
    socket.emit('control', { action: 'pause', position: player.getCurrentTime() });
  }
}

// ---- Loops: heartbeat (host) + status display ----
let heartbeatTimer = null;
let statusTimer = null;
function startLoops() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!player || !isHost || !started) return;
    try {
      socket.emit('heartbeat', {
        position: player.getCurrentTime(),
        index: typeof player.getPlaylistIndex === 'function' ? player.getPlaylistIndex() : 0,
        isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
      });
    } catch { /* ignore */ }
  }, 1000);

  statusTimer = setInterval(() => {
    if (!player || !started) return;
    try {
      nowTime.textContent = fmtTime(player.getCurrentTime());
      if (Date.now() < noticeUntil) return; // keep a transient notice visible
      if (!isHost && lastState) {
        const drift = (player.getCurrentTime() - expectedPosition()).toFixed(1);
        syncStatus.textContent = `싱크 보정 중 · 오차 ${drift}s`;
      } else if (isHost) {
        syncStatus.textContent = '내가 조종 중';
      }
    } catch { /* ignore */ }
  }, 500);
}

// ---- UI renders ----
function renderMembers(s) {
  membersEl.innerHTML = '';
  (s.members || []).forEach((m) => {
    const li = document.createElement('li');
    li.textContent = m.name + (m.isHost ? ' 👑' : '');
    if (m.id === socket.id) li.classList.add('me');
    membersEl.appendChild(li);
  });
}

function renderRole(s) {
  isHost = socket && s.hostId === socket.id;
  roleBadge.textContent = isHost ? '👑 방장 (조종)' : '🎧 따라 듣는 중';
  hostControls.classList.toggle('hidden', !isHost);
  takeControlBtn.classList.toggle('hidden', isHost);
}

// ---- Lobby actions ----
function enterRoom(code, name) {
  currentRoom = code;
  socket = io();

  socket.on('connect', () => socket.emit('join', { room: code, name }));
  socket.on('joined', ({ room, youAreHost }) => {
    isHost = youAreHost;
    roomCodeLabel.textContent = room;
    lobbyEl.classList.add('hidden');
    roomEl.classList.remove('hidden');
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState({}, '', url);
    startGate.classList.remove('hidden'); // require a tap to unlock audio
  });
  socket.on('state', applyState);
  socket.on('error_msg', (msg) => {
    lobbyError.textContent = msg;
  });
  socket.on('disconnect', () => {
    syncStatus.textContent = '연결 끊김 · 재접속 시도 중…';
  });

  createPlayer();
}

$('#create-btn').addEventListener('click', () => {
  roomInput.value = genRoomCode();
});

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  lobbyError.textContent = '';
  const name = nameInput.value.trim();
  let code = roomInput.value.trim().toUpperCase();
  if (!code) code = genRoomCode();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    lobbyError.textContent = '방 코드는 영문/숫자 4~8자예요.';
    return;
  }
  if (!name) {
    lobbyError.textContent = '이름을 입력해줘.';
    return;
  }
  enterRoom(code, name);
});

// ---- Start gate (autoplay unlock) ----
startGate.addEventListener('click', () => {
  started = true;
  startGate.classList.add('hidden');
  if (!player) createPlayer();
  if (lastState) applyState(lastState);
});

// ---- Room actions ----
$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('#copy-link').textContent = '복사됨!';
    setTimeout(() => ($('#copy-link').textContent = '링크 복사'), 1500);
  } catch { /* clipboard blocked */ }
});

$('#playlist-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!isHost) return;
  const p = parsePlaylist(playlistInput.value);
  if (!p) {
    showNotice('유튜브 재생목록/영상 URL을 인식하지 못했어요.');
    return;
  }
  if (p.listType === 'mix') {
    showNotice('유튜브 자동 믹스(RD…)는 임베드 재생이 안 돼요. 일반 재생목록(PL…)이나 개별 영상 링크를 써주세요.', 12000);
    return;
  }
  if (p.mixFallback) {
    showNotice('자동 믹스는 임베드가 안 돼서 이 영상 한 곡만 재생해요. 여러 곡은 PL 재생목록을 쓰세요.', 12000);
  }
  socket.emit('control', { action: 'load', playlist: p, index: p.index || 0 });
});

$('#playpause-btn').addEventListener('click', () => {
  if (!isHost || !player) return;
  const ps = player.getPlayerState();
  if (ps === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
});
$('#next-btn').addEventListener('click', () => {
  if (!isHost || !player) return;
  suppressEmitUntil = Date.now() + 1500;
  player.nextVideo();
  setTimeout(() => socket.emit('control', {
    action: 'track',
    index: typeof player.getPlaylistIndex === 'function' ? player.getPlaylistIndex() : 0,
  }), 600);
});
$('#prev-btn').addEventListener('click', () => {
  if (!isHost || !player) return;
  suppressEmitUntil = Date.now() + 1500;
  player.previousVideo();
  setTimeout(() => socket.emit('control', {
    action: 'track',
    index: typeof player.getPlaylistIndex === 'function' ? player.getPlaylistIndex() : 0,
  }), 600);
});

takeControlBtn.addEventListener('click', () => socket.emit('take_control'));

$('#leave-btn').addEventListener('click', () => {
  if (socket) socket.disconnect();
  location.href = location.pathname;
});

// ---- Prefill from ?room= ----
(() => {
  const code = new URL(location.href).searchParams.get('room');
  if (code) roomInput.value = code.toUpperCase();
})();
