/* Listen Together client (v2).
 *
 * Model: the server holds the canonical room state — an explicit queue, the
 * current index, play/pause, and the position. ANY member can change songs
 * (next/prev/jump), play/pause, and add/remove queue items. One member (the
 * "anchor", shown with 🎧) drives a 1s position heartbeat so guests don't drift.
 *
 * seq: bumped on every explicit control/queue change (never on heartbeat).
 * Everyone (including the anchor) obeys a state whose seq advanced — that's how
 * a guest's skip moves the anchor too. Between control events, only non-anchors
 * follow the position; the anchor IS the clock.
 *
 * Audio is never streamed through the server — each client plays YouTube locally.
 */

const $ = (s) => document.querySelector(s);

// Elements
const lobbyEl = $('#lobby');
const roomEl = $('#room');
const nameInput = $('#name-input');
const roomInput = $('#room-input');
const lobbyError = $('#lobby-error');
const roomCodeLabel = $('#room-code-label');
const roleBadge = $('#role-badge');
const membersEl = $('#members');
const queueEl = $('#queue');
const queueCount = $('#queue-count');
const recoEl = $('#reco');
const recoNote = $('#reco-note');
const nowPlaying = $('#now-playing');
const syncStatus = $('#sync-status');
const nowTime = $('#now-time');
const addInput = $('#add-input');
const takeControlBtn = $('#take-control');
const startGate = $('#start-gate');
const vinyl = $('#vinyl');
const eqEl = $('#eq');

// State
let socket = null;
let player = null;
let ytReady = false;
let playerReady = false;      // YT.Player onReady fired (safe to call its methods)
let pendingCreate = false;
let pendingState = null;
let lastState = null;
let lastStateRecvAt = 0;
let lastSeq = -1;
let isAnchor = false;
let started = false;          // user tapped the gate (audio unlocked)
let loadedVideoId = null;
let suppressNativeUntil = 0;  // ignore anchor onStateChange right after a programmatic change
let noticeUntil = 0;
let recoForVideo = null;

function showNotice(msg, ms = 8000) {
  syncStatus.textContent = msg;
  noticeUntil = Date.now() + ms;
}

// ---- YouTube API ----
window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
  if (pendingCreate) createPlayer();
};

function ensurePlayer() {
  if (player) return;
  if (ytReady) createPlayer();
  else pendingCreate = true;
}

function createPlayer() {
  if (player) return;
  pendingCreate = false;
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: { controls: 1, modestbranding: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: () => {
        playerReady = true;
        if (pendingState) applyState(pendingState);
        startLoops();
      },
      onStateChange: onPlayerStateChange,
    },
  });
}

// ---- Helpers ----
function genRoomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function currentTrack(s) {
  return s && s.queue && s.queue.length ? s.queue[s.index] : null;
}
// Extrapolate the anchor's position using server-side deltas (clock-skew immune)
// plus local elapsed since we received the state.
function expectedPosition(s) {
  if (!s) return 0;
  const serverAge = s.isPlaying ? Math.max(0, (s.serverNow - s.updatedAt) / 1000) : 0;
  const sinceRecv = s.isPlaying ? (Date.now() - lastStateRecvAt) / 1000 : 0;
  return s.position + serverAge + sinceRecv;
}

function loadOrCue(id, pos) {
  if (!player || !playerReady) return;
  loadedVideoId = id;
  suppressNativeUntil = Date.now() + 1500;
  const startSeconds = Math.max(0, pos || 0);
  try {
    if (started) player.loadVideoById({ videoId: id, startSeconds });
    else player.cueVideoById({ videoId: id, startSeconds }); // shows a frame, no autoplay → no black screen
  } catch { loadedVideoId = null; }
}

// ---- Apply server state ----
function applyState(s) {
  lastState = s;
  lastStateRecvAt = Date.now();
  renderMembers(s);
  renderRole(s);
  renderQueue(s);
  renderNowPlaying(s);
  maybeFetchReco(s);

  if (!player || !playerReady) {
    pendingState = s;
    return;
  }
  pendingState = null;

  const cur = currentTrack(s);
  // Load/cue the current track if it changed (cue when not started → no black screen).
  if (cur && cur.id !== loadedVideoId) {
    loadOrCue(cur.id, expectedPosition(s));
  } else if (!cur) {
    loadedVideoId = null;
  }

  const isControl = s.seq !== lastSeq;

  if (!started) {
    lastSeq = s.seq;
    return; // gate not tapped yet; track is cued, waiting for the user
  }

  if (isControl) {
    lastSeq = s.seq;
    applyPlayPauseAndSeek(s, true); // explicit change → everyone (incl anchor) obeys
  } else if (!isAnchor) {
    applyPlayPauseAndSeek(s, false); // heartbeat → guests drift-correct
  }
}

function applyPlayPauseAndSeek(s, isControl) {
  if (!player || !started) return;
  try {
    const target = expectedPosition(s);
    const cur = player.getCurrentTime();
    const tol = isControl ? 0.7 : 1.0;
    if (Math.abs(cur - target) > tol) player.seekTo(target, true);
    const ps = player.getPlayerState();
    if (s.isPlaying && ps !== YT.PlayerState.PLAYING) player.playVideo();
    if (!s.isPlaying && ps === YT.PlayerState.PLAYING) player.pauseVideo();
  } catch { /* not ready */ }
}

// Anchor's native player controls propagate; track end auto-advances.
function onPlayerStateChange(e) {
  if (!isAnchor || !started) return;
  if (Date.now() < suppressNativeUntil) return;
  if (e.data === YT.PlayerState.PLAYING) {
    socket.emit('control', { action: 'play', position: player.getCurrentTime() });
  } else if (e.data === YT.PlayerState.PAUSED) {
    socket.emit('control', { action: 'pause', position: player.getCurrentTime() });
  } else if (e.data === YT.PlayerState.ENDED) {
    socket.emit('control', { action: 'next' });
  }
}

// ---- Loops ----
let heartbeatTimer = null;
let statusTimer = null;
function startLoops() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!player || !isAnchor || !started) return;
    try {
      socket.emit('heartbeat', {
        position: player.getCurrentTime(),
        isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
      });
    } catch { /* ignore */ }
  }, 1000);

  statusTimer = setInterval(() => {
    if (!player || !started) return;
    try {
      nowTime.textContent = fmtTime(player.getCurrentTime());
      updateDeck();
      if (Date.now() < noticeUntil) return;
      if (!lastState || !currentTrack(lastState)) { syncStatus.textContent = ''; return; }
      if (!isAnchor) {
        const drift = (player.getCurrentTime() - expectedPosition(lastState)).toFixed(1);
        syncStatus.textContent = `싱크 보정 중 · 오차 ${drift}s`;
      } else {
        syncStatus.textContent = '내가 동기화 기준';
      }
    } catch { /* ignore */ }
  }, 500);
}

// ---- Renders ----
function renderMembers(s) {
  membersEl.innerHTML = '';
  (s.members || []).forEach((m) => {
    const li = document.createElement('li');
    li.textContent = m.name + (m.isHost ? ' 🎧' : '');
    if (socket && m.id === socket.id) li.classList.add('me');
    membersEl.appendChild(li);
  });
}

function renderRole(s) {
  isAnchor = !!(socket && s.hostId === socket.id);
  roleBadge.textContent = isAnchor ? '🎧 동기화 기준 · 다같이 조종' : '🎧 다같이 조종 가능';
  takeControlBtn.classList.toggle('hidden', isAnchor);
}

function renderNowPlaying(s) {
  const cur = currentTrack(s);
  if (!cur) {
    nowPlaying.textContent = '대기열이 비어 있어요. 아래에 유튜브 링크를 추가하세요.';
    nowPlaying.classList.add('muted');
  } else {
    nowPlaying.textContent = `▶ ${cur.title}`;
    nowPlaying.classList.remove('muted');
  }
}

function renderQueue(s) {
  queueEl.innerHTML = '';
  const q = s.queue || [];
  queueCount.textContent = q.length ? `(${s.index + 1}/${q.length})` : '';
  q.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'queue-item' + (i === s.index ? ' current' : '');
    const title = document.createElement('button');
    title.className = 'queue-title';
    title.textContent = (i === s.index ? '▶ ' : `${i + 1}. `) + t.title;
    title.title = '이 곡으로 이동';
    title.addEventListener('click', () => socket.emit('control', { action: 'jump', index: i }));
    const rm = document.createElement('button');
    rm.className = 'queue-rm';
    rm.textContent = '✕';
    rm.title = '대기열에서 제거';
    rm.addEventListener('click', () => socket.emit('queue_remove', { index: i }));
    li.append(title, rm);
    queueEl.appendChild(li);
  });
}

function renderReco(tracks) {
  recoEl.innerHTML = '';
  tracks.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'reco-item';
    const span = document.createElement('span');
    span.className = 'reco-title';
    span.textContent = t.title;
    if (t.channel) span.title = t.channel;
    const add = document.createElement('button');
    add.className = 'btn tiny';
    add.textContent = '+ 큐';
    add.addEventListener('click', () =>
      socket.emit('queue_add', { tracks: [{ id: t.id, title: t.title }] }));
    li.append(span, add);
    recoEl.appendChild(li);
  });
}

function maybeFetchReco(s) {
  const cur = currentTrack(s);
  if (!cur) { recoEl.innerHTML = ''; recoNote.textContent = '곡이 재생되면 추천이 떠요.'; recoForVideo = null; return; }
  if (recoForVideo === cur.id) return;
  recoForVideo = cur.id;
  recoNote.textContent = '추천 불러오는 중…';
  fetch(`/api/recommend?videoId=${encodeURIComponent(cur.id)}&title=${encodeURIComponent(cur.title)}`)
    .then((r) => r.json())
    .then((d) => {
      if (d.error === 'NO_KEY') { recoNote.textContent = '추천을 켜려면 서버에 YT_API_KEY를 연결하세요.'; renderReco([]); return; }
      if (d.error) { recoNote.textContent = '추천을 불러오지 못했어요.'; renderReco([]); return; }
      recoNote.textContent = '현재 곡 기반 추천';
      renderReco(d.tracks || []);
    })
    .catch(() => { recoNote.textContent = '추천을 불러오지 못했어요.'; });
}

// ---- Lobby / room entry ----
function enterRoom(code, name) {
  socket = io();
  socket.on('connect', () => socket.emit('join', { room: code, name }));
  socket.on('joined', ({ room, youAreHost }) => {
    isAnchor = youAreHost;
    roomCodeLabel.textContent = room;
    lobbyEl.classList.add('hidden');
    roomEl.classList.remove('hidden');
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState({}, '', url);
    startGate.classList.remove('hidden');
  });
  socket.on('state', applyState);
  socket.on('error_msg', (msg) => { lobbyError.textContent = msg; });
  socket.on('disconnect', () => { syncStatus.textContent = '연결 끊김 · 재접속 시도 중…'; });
  ensurePlayer();
}

$('#create-btn').addEventListener('click', () => { roomInput.value = genRoomCode(); });

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  lobbyError.textContent = '';
  const name = nameInput.value.trim();
  let code = roomInput.value.trim().toUpperCase();
  if (!code) code = genRoomCode();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { lobbyError.textContent = '방 코드는 영문/숫자 4~8자예요.'; return; }
  if (!name) { lobbyError.textContent = '이름을 입력해줘.'; return; }
  localStorage.setItem('lt_name', name); // session save
  enterRoom(code, name);
});

// ---- Start gate (audio unlock + resume) ----
startGate.addEventListener('click', () => {
  started = true;
  startGate.classList.add('hidden');
  ensureAudio(); // unlock Web Audio (scratch SFX) within the user gesture
  // Resume: if a track is loaded, play it (we're inside the user gesture).
  if (lastState && player && playerReady) {
    const cur = currentTrack(lastState);
    if (cur) {
      if (cur.id !== loadedVideoId) loadOrCue(cur.id, expectedPosition(lastState));
      try { player.seekTo(expectedPosition(lastState), true); player.playVideo(); } catch { /* ignore */ }
    }
    lastSeq = lastState.seq;
  }
});

// ---- Room actions ----
$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('#copy-link').textContent = '복사됨!';
    setTimeout(() => ($('#copy-link').textContent = '링크 복사'), 1500);
  } catch { showNotice('링크 복사가 막혔어요. 주소창 URL을 직접 복사하세요.'); }
});

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = addInput.value.trim();
  if (!url) return;
  showNotice('불러오는 중…', 4000);
  try {
    const d = await (await fetch(`/api/resolve?url=${encodeURIComponent(url)}`)).json();
    if (d.kind === 'mix') { showNotice('자동 믹스(RD…)는 펼칠 수 없어요. 개별 영상이나 PL 재생목록 링크를 쓰세요.', 12000); return; }
    if (d.kind === 'error' || !d.tracks || !d.tracks.length) {
      showNotice('URL을 인식하지 못했어요. (PL 재생목록 펼치기는 서버에 YT_API_KEY 필요)', 12000);
      return;
    }
    socket.emit('queue_add', { tracks: d.tracks });
    addInput.value = '';
    if (d.mixFallback) showNotice('자동 믹스는 펼칠 수 없어 이 영상 한 곡만 추가했어요.', 10000);
    else showNotice(`${d.tracks.length}곡 추가됨`, 4000);
  } catch { showNotice('추가에 실패했어요. 잠시 후 다시 시도하세요.'); }
});

function togglePlay() {
  if (!lastState) return;
  const pos = (() => { try { return player.getCurrentTime(); } catch { return undefined; } })();
  socket.emit('control', { action: lastState.isPlaying ? 'pause' : 'play', position: pos });
}
$('#playpause-btn').addEventListener('click', togglePlay);
$('#next-btn').addEventListener('click', () => socket.emit('control', { action: 'next' }));
$('#prev-btn').addEventListener('click', () => socket.emit('control', { action: 'prev' }));
takeControlBtn.addEventListener('click', () => socket.emit('take_control'));

$('#leave-btn').addEventListener('click', () => {
  if (socket) socket.disconnect();
  location.href = location.pathname;
});

// ---- DJ deck: spinning vinyl + stylized EQ + scratch-to-skip ----
// NOTE: YouTube's iframe audio can't be analyzed cross-origin, so the EQ bars are
// a stylized animation tied to play/pause (not true frequency data), and the tone
// knobs are visual. The scratch sound is a real Web Audio synth on the page.
const EQ_BARS = 28;
const eqBars = [];
for (let i = 0; i < EQ_BARS; i++) {
  const b = document.createElement('span');
  b.className = 'eq-bar';
  eqEl.appendChild(b);
  eqBars.push(b);
}
let eqRaf = null;
let eqGain = 0.7;
function eqFrame() {
  const now = Date.now() / 1000;
  for (let i = 0; i < eqBars.length; i++) {
    const base = Math.sin(now * 6 + i * 0.5) * 0.5 + 0.5;
    const h = Math.min(1, (base * 0.65 + Math.random() * 0.4) * eqGain);
    eqBars[i].style.height = (8 + h * 92) + '%';
  }
  eqRaf = requestAnimationFrame(eqFrame);
}
function startEq() { if (!eqRaf) eqFrame(); }
function stopEq() {
  if (eqRaf) { cancelAnimationFrame(eqRaf); eqRaf = null; }
  eqBars.forEach((b) => (b.style.height = '8%'));
}
function isPlayingNow() {
  try { if (player && started && playerReady) return player.getPlayerState() === YT.PlayerState.PLAYING; } catch { /* */ }
  return !!(lastState && lastState.isPlaying);
}
function updateDeck() {
  const playing = isPlayingNow();
  vinyl.classList.toggle('spinning', playing);
  if (playing) startEq(); else stopEq();
}

let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* */ }
}
function scratch() {
  ensureAudio();
  if (!audioCtx) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const dur = 0.34;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 7;
  bp.frequency.setValueAtTime(1900, now);
  bp.frequency.exponentialRampToValueAtTime(280, now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.35, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(now);
  src.stop(now + dur);
}

vinyl.addEventListener('click', () => {
  scratch();
  if (socket && lastState && lastState.queue && lastState.queue.length) {
    socket.emit('control', { action: 'next' });
  }
});

document.querySelectorAll('.knob input').forEach((inp) => {
  inp.addEventListener('input', () => {
    if (inp.dataset.eq === 'gain') eqGain = 0.3 + (inp.value / 100) * 0.95;
  });
});

// ---- Session restore: prefill + auto-rejoin on refresh ----
(() => {
  const savedName = localStorage.getItem('lt_name');
  const urlRoom = new URL(location.href).searchParams.get('room');
  if (savedName) nameInput.value = savedName;
  if (urlRoom) roomInput.value = urlRoom.toUpperCase();
  // Refresh mid-session → rejoin automatically; current track gets cued (no black screen).
  if (savedName && urlRoom && /^[A-Z0-9]{4,8}$/.test(urlRoom.toUpperCase())) {
    enterRoom(urlRoom.toUpperCase(), savedName);
  }
})();
