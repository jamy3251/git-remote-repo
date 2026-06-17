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
const searchResults = $('#search-results');
const miniChat = $('#mini-chat');
const chatMsgs = $('#chat-msgs');
const chatInput = $('#chat-input');
const chatToggle = $('#chat-toggle');
const takeControlBtn = $('#take-control');
const startGate = $('#start-gate');
const vinyl = $('#vinyl');
const eqEl = $('#eq');
const qualityBadge = $('#quality-badge');
const npThumb = $('#np-thumb');
const npTitle = $('#np-title');
const npSub = $('#np-sub');
const npProgressFill = $('#np-progress-fill');
const npEq = $('#np-eq');
const vinylLabel = $('#vinyl-label');
const deckBg = $('#deck-bg');
const micBtn = $('#mic-btn');

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
let lastIsPlaying = null;
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
      onError: onPlayerError,
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
// Map YouTube's playback quality string to a human label (real, from the player).
function qualityLabel(q) {
  return ({
    highres: '4K', hd2160: '4K', hd1440: '1440p', hd1080: '1080p',
    hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p',
  })[q] || '';
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
    // Request the highest available quality (4K where the source has it). YouTube
    // ultimately decides based on player size / bandwidth, so this is best-effort.
    if (started) player.loadVideoById({ videoId: id, startSeconds, suggestedQuality: 'highres' });
    else player.cueVideoById({ videoId: id, startSeconds, suggestedQuality: 'highres' });
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
  const trackChanged = !!(cur && cur.id !== loadedVideoId);
  if (trackChanged) loadOrCue(cur.id, expectedPosition(s));
  else if (!cur) loadedVideoId = null;

  const isControl = s.seq !== lastSeq;
  const playChanged = lastIsPlaying !== s.isPlaying;
  lastIsPlaying = s.isPlaying;

  if (!started) {
    lastSeq = s.seq;
    updateGate();
    return; // gate not tapped yet; track is cued, waiting for the user
  }

  if (isControl) {
    lastSeq = s.seq;
    // Only touch the player on REAL playback changes (track switch / play-pause).
    // Pure queue edits (add / search / reorder / remove-other) must NOT seek,
    // otherwise every action causes a tiny re-seek → buffering.
    if (trackChanged || playChanged) applyPlayPauseAndSeek(s, true);
  } else if (!isAnchor) {
    applyPlayPauseAndSeek(s, false); // heartbeat → guests drift-correct
  }
  updateGate();
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

// Embed/playback errors are a common "재생 안됨" cause: many official music videos
// disable embedding (101/150). Tell the user and auto-skip to the next track.
function onPlayerError(e) {
  const code = e && e.data;
  if (code === 101 || code === 150) {
    showNotice('이 영상은 외부 사이트 재생이 막혀 있어요 (소유자가 임베드 차단). 다음 곡으로 넘어가요.', 10000);
    autoSkipBroken();
  } else if (code === 100) {
    showNotice('영상을 찾을 수 없어요 (삭제/비공개). 다음 곡으로.', 10000);
    autoSkipBroken();
  } else if (code === 2 || code === 5) {
    showNotice('이 영상은 재생할 수 없어요. 다른 영상을 추가해 주세요.', 9000);
  }
}
function autoSkipBroken() {
  if (isAnchor && lastState && lastState.queue && lastState.index < lastState.queue.length - 1) {
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
      updateGate();
      try { qualityBadge.textContent = qualityLabel(player.getPlaybackQuality()); } catch { /* */ }
      try {
        const dur = player.getDuration();
        if (dur > 0 && npProgressFill) npProgressFill.style.width = Math.min(100, (player.getCurrentTime() / dur) * 100) + '%';
      } catch { /* */ }
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

function thumb(id) { return `https://img.youtube.com/vi/${id}/hqdefault.jpg`; }

function renderNowPlaying(s) {
  const cur = currentTrack(s);
  if (!cur) {
    nowPlaying.classList.add('empty');
    npTitle.textContent = '대기열이 비어 있어요';
    npSub.textContent = '아래에 유튜브 링크를 추가하세요';
    npThumb.removeAttribute('src');
    vinylLabel.classList.remove('art');
    vinylLabel.style.backgroundImage = '';
    vinylLabel.textContent = 'LT';
    deckBg.classList.remove('on');
    deckBg.style.backgroundImage = '';
    if (npProgressFill) npProgressFill.style.width = '0%';
    return;
  }
  nowPlaying.classList.remove('empty');
  npTitle.textContent = cur.title;
  npSub.textContent = `재생목록 ${s.index + 1} / ${s.queue.length}곡`;
  const url = thumb(cur.id);
  npThumb.src = url;
  vinylLabel.classList.add('art');
  vinylLabel.style.backgroundImage = `url("${url}")`;
  deckBg.classList.add('on');
  deckBg.style.backgroundImage = `url("${url}")`;
}

let dragFrom = null;
function renderQueue(s) {
  queueEl.innerHTML = '';
  const q = s.queue || [];
  queueCount.textContent = q.length ? `(${s.index + 1}/${q.length})` : '';
  q.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'queue-item' + (i === s.index ? ' current' : '');
    li.draggable = true;
    li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('dragging'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault(); li.classList.remove('drag-over');
      if (dragFrom != null && dragFrom !== i) socket.emit('queue_move', { from: dragFrom, to: i });
      dragFrom = null;
    });
    const handle = document.createElement('span');
    handle.className = 'queue-handle'; handle.textContent = '≡'; handle.title = '드래그해서 순서 변경';
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
    li.append(handle, title, rm);
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
  socket.on('chat', onChat);
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
// Robust play: try normal playback; if blocked, fall back to muted autoplay
// (always allowed) then unmute. This is the main fix for "탭했는데도 안 나옴".
function forcePlay() {
  if (!player || !playerReady || !lastState) return;
  const cur = currentTrack(lastState);
  if (!cur) return;
  if (cur.id !== loadedVideoId) loadOrCue(cur.id, expectedPosition(lastState));
  try {
    player.seekTo(expectedPosition(lastState), true);
    player.playVideo();
  } catch { /* ignore */ }
  setTimeout(() => {
    try {
      if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
        player.mute();
        player.playVideo();
        setTimeout(() => { try { player.unMute(); player.setVolume(100); } catch { /* */ } }, 700);
      }
    } catch { /* */ }
  }, 800);
}

startGate.addEventListener('click', () => {
  started = true;
  ensureAudio(); // unlock Web Audio (scratch SFX) within the user gesture
  startGate.classList.add('hidden');
  if (lastState) { forcePlay(); lastSeq = lastState.seq; }
});

// ---- Room actions ----
$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('#copy-link').textContent = '복사됨!';
    setTimeout(() => ($('#copy-link').textContent = '링크 복사'), 1500);
  } catch { showNotice('링크 복사가 막혔어요. 주소창 URL을 직접 복사하세요.'); }
});

// A pasted link/id resolves+adds directly; plain text runs a YouTube search.
function looksLikeUrl(s) {
  return /^https?:\/\//i.test(s) || /youtu\.?be|youtube\.com/i.test(s) ||
    /^(PL|OL|UU|FL|LL|RD)[A-Za-z0-9_-]{8,}$/.test(s);
}

async function resolveAndAdd(url) {
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
    hideSearch();
    if (d.mixFallback) showNotice('자동 믹스는 펼칠 수 없어 이 영상 한 곡만 추가했어요.', 10000);
    else showNotice(`${d.tracks.length}곡 추가됨`, 4000);
  } catch { showNotice('추가에 실패했어요. 잠시 후 다시 시도하세요.'); }
}

function hideSearch() { searchResults.classList.add('hidden'); searchResults.innerHTML = ''; }

function renderSearchResults(q, tracks) {
  searchResults.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'sr-head';
  head.innerHTML = `<span>"${q}" 검색 결과 · 클릭해서 큐에 추가</span>`;
  const close = document.createElement('button');
  close.className = 'btn tiny'; close.textContent = '닫기';
  close.addEventListener('click', hideSearch);
  head.appendChild(close);
  searchResults.appendChild(head);

  tracks.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'sr-item';
    const img = document.createElement('img');
    img.className = 'sr-thumb'; img.loading = 'lazy'; img.src = thumb(t.id); img.alt = '';
    const text = document.createElement('div');
    text.className = 'sr-text';
    const tt = document.createElement('div'); tt.className = 'sr-title'; tt.textContent = t.title;
    const ch = document.createElement('div'); ch.className = 'sr-ch'; ch.textContent = t.channel || '';
    text.append(tt, ch);
    const add = document.createElement('button');
    add.className = 'btn tiny'; add.textContent = '+ 큐';
    add.addEventListener('click', () => {
      socket.emit('queue_add', { tracks: [{ id: t.id, title: t.title }] });
      add.textContent = '추가됨'; add.disabled = true;
    });
    item.append(img, text, add);
    searchResults.appendChild(item);
  });
  searchResults.classList.remove('hidden');
}

async function doSearch(q) {
  showNotice('유튜브 검색 중…', 4000);
  try {
    const d = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
    if (d.error === 'NO_KEY') { showNotice('검색을 켜려면 서버에 YT_API_KEY를 연결하세요.', 12000); return; }
    if (d.error || !d.tracks || !d.tracks.length) { showNotice('검색 결과가 없어요.', 6000); return; }
    renderSearchResults(q, d.tracks);
    syncStatus.textContent = '';
  } catch { showNotice('검색에 실패했어요. 잠시 후 다시 시도하세요.'); }
}

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = addInput.value.trim();
  if (!val) return;
  if (looksLikeUrl(val)) resolveAndAdd(val);
  else doSearch(val);
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

// ---- Mini chat ----
function onChat({ name, text, you }) {
  const li = document.createElement('div');
  li.className = 'chat-msg' + (you === (socket && socket.id) ? ' me' : '');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = name + ':';
  li.appendChild(who);
  li.appendChild(document.createTextNode(' ' + text)); // textContent → no XSS
  chatMsgs.appendChild(li);
  while (chatMsgs.children.length > 60) chatMsgs.removeChild(chatMsgs.firstChild);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  if (miniChat.classList.contains('collapsed') && you !== (socket && socket.id)) {
    chatToggle.classList.add('unread');
  }
}
chatToggle.addEventListener('click', () => {
  miniChat.classList.remove('collapsed');
  chatToggle.classList.remove('unread');
  chatInput.focus();
});
$('#chat-close').addEventListener('click', () => miniChat.classList.add('collapsed'));
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = chatInput.value.trim();
  if (!t || !socket) return;
  socket.emit('chat', { text: t });
  chatInput.value = '';
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
let energy = 1;   // crossfader-controlled visual intensity multiplier
let eqLow = 1, eqMid = 1, eqHigh = 1; // band emphasis for the visualization (knobs)
let eqLast = 0;
// Weight a bar by its frequency band (low/mid/high) using the EQ knobs.
function bandWeight(frac) { return frac < 0.34 ? eqLow : frac < 0.67 ? eqMid : eqHigh; }

// Real audio reactivity via the microphone (the only way to react to YouTube
// playback, since the iframe audio is cross-origin). null until the user enables it.
let analyser = null;
let freqData = null;
let timeData = null;
let micStream = null;
function spectrum(n) {
  if (!analyser) return null;
  analyser.getByteFrequencyData(freqData);
  const usable = Math.max(8, Math.floor(freqData.length * 0.7)); // music energy sits low-mid
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = freqData[Math.floor((i / n) * usable)] / 255;
  return out;
}
function waveform(n) {
  if (!analyser || !timeData) return null;
  analyser.getByteTimeDomainData(timeData);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (timeData[Math.floor((i / n) * timeData.length)] - 128) / 128;
  return out;
}

function eqFrame(ts) {
  eqRaf = requestAnimationFrame(eqFrame);
  if (ts - eqLast < 33) return; // ~30fps throttle (saves CPU)
  eqLast = ts;
  const spec = spectrum(eqBars.length);
  const now = Date.now() / 1000;
  for (let i = 0; i < eqBars.length; i++) {
    const wt = bandWeight(i / eqBars.length) * energy;
    let h;
    if (spec) h = Math.min(1, spec[i] * 1.7 * eqGain * wt);
    else { const base = Math.sin(now * 6 + i * 0.5) * 0.5 + 0.5; h = Math.min(1, (base * 0.65 + Math.random() * 0.4) * eqGain * wt); }
    eqBars[i].style.height = (8 + h * 92) + '%';
  }
}
function startEq() { if (!eqRaf) eqRaf = requestAnimationFrame(eqFrame); }
function stopEq() {
  if (eqRaf) { cancelAnimationFrame(eqRaf); eqRaf = null; }
  eqBars.forEach((b) => (b.style.height = '8%'));
}

// ---- Visualizer (opposite side). Stylized radial spectrum tied to play state.
// (YouTube audio can't be analyzed cross-origin, so this is generative, not FFT.)
const visCanvas = $('#vis-canvas');
const visCtx = visCanvas ? visCanvas.getContext('2d') : null;
let visRaf = null;
let visLast = 0;
function sizeVis() {
  if (!visCanvas || !visCtx) return;
  const r = visCanvas.getBoundingClientRect();
  if (!r.width) return;
  const dpr = window.devicePixelRatio || 1;
  visCanvas.width = Math.round(r.width * dpr);
  visCanvas.height = Math.round(r.height * dpr);
  visCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
let visPeaks = null;
function visFrame(ts) {
  visRaf = requestAnimationFrame(visFrame);
  if (ts - visLast < 33) return; // ~30fps
  visLast = ts;
  if (!visCtx) return;
  const w = visCanvas.clientWidth, h = visCanvas.clientHeight;
  // Fade trail (motion blur) instead of a hard clear.
  visCtx.globalCompositeOperation = 'source-over';
  visCtx.fillStyle = 'rgba(7,8,12,0.3)';
  visCtx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const t = Date.now() / 1000;
  const N = 72;
  const radius = Math.min(w, h) * 0.2;
  const spec = spectrum(N);
  const wave = waveform(N);
  if (!visPeaks || visPeaks.length !== N) visPeaks = new Array(N).fill(0);

  // Bass average drives the centre pulse.
  let bass = 0;
  if (spec) { for (let i = 0; i < 6; i++) bass += spec[i]; bass /= 6; }
  else bass = 0.4 + Math.sin(t * 4) * 0.15;

  visCtx.globalCompositeOperation = 'lighter';

  // Centre glow.
  const pr = radius * (0.7 + bass * 0.6);
  const g = visCtx.createRadialGradient(cx, cy, 0, cx, cy, pr);
  g.addColorStop(0, 'rgba(47,109,246,0.5)');
  g.addColorStop(0.6, 'rgba(92,179,255,0.16)');
  g.addColorStop(1, 'rgba(92,179,255,0)');
  visCtx.fillStyle = g;
  visCtx.beginPath(); visCtx.arc(cx, cy, pr, 0, Math.PI * 2); visCtx.fill();

  // Mirrored radial frequency bars + peak caps.
  visCtx.lineWidth = Math.max(2, (Math.PI * radius) / N * 0.7);
  visCtx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const amp = spec ? Math.min(1.25, spec[i] * 1.5)
      : (Math.sin(t * 4 + i * 0.4) * 0.5 + 0.5) * 0.55 + Math.random() * 0.3;
    const wt = bandWeight(i / N) * energy;
    const len = radius * 1.05 * amp * eqGain * wt;
    if (amp > visPeaks[i]) visPeaks[i] = amp; else visPeaks[i] = Math.max(0, visPeaks[i] - 0.018);
    const peakLen = radius * 1.05 * visPeaks[i] * eqGain * wt;
    const hue = 205 + (i / N) * 120;
    for (let d = 0; d < 2; d++) {
      const dir = d === 0 ? 1 : -1;
      const ang = -Math.PI / 2 + dir * (i / N) * Math.PI;
      const c = Math.cos(ang), s = Math.sin(ang);
      visCtx.strokeStyle = `hsl(${hue}, 90%, ${56 + amp * 16}%)`;
      visCtx.beginPath();
      visCtx.moveTo(cx + c * radius, cy + s * radius);
      visCtx.lineTo(cx + c * (radius + len), cy + s * (radius + len));
      visCtx.stroke();
      visCtx.fillStyle = 'rgba(255,255,255,0.75)';
      visCtx.beginPath(); visCtx.arc(cx + c * (radius + peakLen), cy + s * (radius + peakLen), 1.5, 0, Math.PI * 2); visCtx.fill();
    }
  }

  // Oscilloscope waveform ring (real only with mic).
  if (wave) {
    visCtx.strokeStyle = 'rgba(231,236,243,0.7)';
    visCtx.lineWidth = 1.6;
    const wr = radius * 0.74;
    visCtx.beginPath();
    for (let i = 0; i <= N; i++) {
      const idx = i % N;
      const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
      const rr = wr + wave[idx] * radius * 0.4;
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      if (i === 0) visCtx.moveTo(x, y); else visCtx.lineTo(x, y);
    }
    visCtx.closePath(); visCtx.stroke();
  }

  visCtx.globalCompositeOperation = 'source-over';
}
function startVis() { if (!visRaf && visCtx) { sizeVis(); visRaf = requestAnimationFrame(visFrame); } }
function stopVis() {
  if (visRaf) { cancelAnimationFrame(visRaf); visRaf = null; }
  if (!visCtx) return;
  sizeVis();
  const w = visCanvas.clientWidth, h = visCanvas.clientHeight;
  if (!w) return;
  visCtx.clearRect(0, 0, w, h);
  // Idle state: faint static rings so the panel doesn't look broken when paused.
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.24;
  visCtx.strokeStyle = 'rgba(138,148,166,0.22)';
  visCtx.lineWidth = 1.5;
  visCtx.beginPath(); visCtx.arc(cx, cy, r, 0, Math.PI * 2); visCtx.stroke();
  visCtx.beginPath(); visCtx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); visCtx.stroke();
}
window.addEventListener('resize', () => { if (visRaf) sizeVis(); });
function isPlayingNow() {
  try { if (player && started && playerReady) return player.getPlayerState() === YT.PlayerState.PLAYING; } catch { /* */ }
  return !!(lastState && lastState.isPlaying);
}
function updateDeck() {
  const playing = isPlayingNow() && !document.hidden;
  vinyl.classList.toggle('spinning', playing);
  npEq.classList.toggle('playing', playing);
  if (playing) { startEq(); startVis(); } else { stopEq(); stopVis(); }
}

// Optimization: kill animation loops when the tab is hidden; restart on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopEq(); stopVis(); }
  else updateDeck();
});

// Re-show a "tap to play" gate whenever the room wants to play but our local
// player isn't (autoplay blocked, fresh join, refresh). Tapping = a user gesture
// that reliably starts playback. This is the fix for "재생 안됨".
function updateGate() {
  if (!started) return; // the initial gate is already visible from join
  let ps = -99;
  try { if (player && playerReady) ps = player.getPlayerState(); } catch { /* */ }
  const want = !!(lastState && lastState.isPlaying && currentTrack(lastState));
  const notPlaying = ps === YT.PlayerState.CUED || ps === YT.PlayerState.PAUSED || ps === YT.PlayerState.UNSTARTED;
  if (want && notPlaying) {
    startGate.textContent = '▶ 탭하여 재생';
    startGate.classList.remove('hidden');
  } else {
    startGate.classList.add('hidden');
  }
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

// EQ knobs now really shape the visualization: Low/Mid/High emphasize their
// frequency band, Gain is overall level. (Visualization only — YouTube audio
// itself can't be filtered cross-origin.)
document.querySelectorAll('.knob input').forEach((inp) => {
  inp.addEventListener('input', () => {
    const v = inp.value / 100;
    if (inp.dataset.eq === 'gain') eqGain = 0.3 + v * 0.95;
    else if (inp.dataset.eq === 'low') eqLow = 0.15 + v * 1.7;
    else if (inp.dataset.eq === 'mid') eqMid = 0.15 + v * 1.7;
    else if (inp.dataset.eq === 'high') eqHigh = 0.15 + v * 1.7;
  });
});

// Crossfader → overall visual energy.
const xfader = $('#xfader');
if (xfader) xfader.addEventListener('input', () => { energy = 0.5 + (xfader.value / 100) * 1.3; });

// Hot cue pads → synth hit + flash (real Web Audio).
const CUE_NOTES = [261.63, 311.13, 349.23, 392.0, 466.16, 523.25];
const CUE_COLORS = ['#ff5c7c', '#ffb05c', '#ffe45c', '#5cff9d', '#5cc8ff', '#b15cff'];
const hotcuesEl = $('#hotcues');
if (hotcuesEl) {
  CUE_NOTES.forEach((freq, i) => {
    const pad = document.createElement('button');
    pad.className = 'cue-pad';
    pad.style.setProperty('--c', CUE_COLORS[i]);
    pad.addEventListener('click', () => {
      synthHit(freq);
      pad.classList.add('hit');
      setTimeout(() => pad.classList.remove('hit'), 180);
    });
    hotcuesEl.appendChild(pad);
  });
}
function synthHit(freq) {
  ensureAudio();
  if (!audioCtx) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, now);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  o.connect(g).connect(ctx.destination);
  o.start(now);
  o.stop(now + 0.47);
}

// DJ sound FX — real Web Audio synths layered over the music (the YouTube audio
// itself can't be EQ'd cross-origin, so these are added sounds, not filters).
function noiseBuffer(dur) {
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function fxBass() {
  const ctx = audioCtx, now = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(120, now); o.frequency.exponentialRampToValueAtTime(38, now + 0.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.6, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  o.connect(g).connect(ctx.destination); o.start(now); o.stop(now + 0.72);
}
function fxRumble() {
  const ctx = audioCtx, now = ctx.currentTime, dur = 1.4;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90; lp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.5, now + 0.4); g.gain.linearRampToValueAtTime(0.0001, now + dur);
  src.connect(lp).connect(g).connect(ctx.destination); src.start(now); src.stop(now + dur);
}
function fxRiser() {
  const ctx = audioCtx, now = ctx.currentTime, dur = 1.6;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur + 0.2);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4;
  bp.frequency.setValueAtTime(300, now); bp.frequency.exponentialRampToValueAtTime(7000, now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.05, now); g.gain.exponentialRampToValueAtTime(0.34, now + dur); g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.15);
  src.connect(bp).connect(g).connect(ctx.destination); src.start(now); src.stop(now + dur + 0.15);
}
function fxHorn() {
  const ctx = audioCtx;
  const stab = (t0, dur) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(380, t0);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const lfoG = ctx.createGain(); lfoG.gain.value = 12; lfo.connect(lfoG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.03);
    g.gain.setValueAtTime(0.28, t0 + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination); o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
  };
  const now = ctx.currentTime; stab(now, 0.5); stab(now + 0.62, 0.7);
}
const FX = { bass: fxBass, rumble: fxRumble, riser: fxRiser, horn: fxHorn };

// Drum synths (kick/snare/hihat) — real Web Audio.
function drumKick() {
  const ctx = audioCtx, now = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, now); o.frequency.exponentialRampToValueAtTime(50, now + 0.12);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.9, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
  o.connect(g).connect(ctx.destination); o.start(now); o.stop(now + 0.34);
}
function drumSnare() {
  const ctx = audioCtx, now = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.2);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.6, now); ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  src.connect(hp).connect(ng).connect(ctx.destination);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180;
  const og = ctx.createGain(); og.gain.setValueAtTime(0.5, now); og.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  o.connect(og).connect(ctx.destination);
  src.start(now); o.start(now); src.stop(now + 0.2); o.stop(now + 0.14);
}
function drumHat() {
  const ctx = audioCtx, now = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.06);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  src.connect(hp).connect(g).connect(ctx.destination); src.start(now); src.stop(now + 0.06);
}
const DRUMS = { kick: drumKick, snare: drumSnare, hihat: drumHat };

// User-provided sample pads (e.g., meme clips). Drop files in public/sfx/<name>.mp3.
const sfxCache = {};
function playSfx(name) {
  let a = sfxCache[name];
  if (!a) {
    a = new Audio(`/sfx/${name}.mp3`);
    a.addEventListener('error', () => showNotice(`샘플이 없어요. public/sfx/${name}.mp3 파일을 추가하면 이 버튼에서 재생돼요.`, 10000));
    sfxCache[name] = a;
  }
  try { a.currentTime = 0; } catch { /* */ }
  a.play().catch(() => showNotice(`샘플 재생 실패 — public/sfx/${name}.mp3 확인.`, 8000));
}

document.querySelectorAll('.fx-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.sfx) { playSfx(b.dataset.sfx); }
    else {
      ensureAudio();
      if (!audioCtx) return;
      const fn = FX[b.dataset.fx] || DRUMS[b.dataset.drum];
      if (fn) { try { fn(); } catch { /* */ } }
    }
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 180);
  });
});

// Mic toggle → real audio reactivity (only way to react to YouTube playback).
async function toggleMic() {
  if (analyser) {
    try { micStream && micStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    analyser = null; micStream = null;
    micBtn.classList.remove('on'); micBtn.textContent = '🎤 음악 반응';
    return;
  }
  ensureAudio();
  if (!audioCtx) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const src = audioCtx.createMediaStreamSource(micStream);
    const a = audioCtx.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.75;
    src.connect(a); // intentionally NOT connected to destination (no feedback)
    freqData = new Uint8Array(a.frequencyBinCount);
    timeData = new Uint8Array(a.fftSize);
    analyser = a;
    micBtn.classList.add('on'); micBtn.textContent = '🎤 반응 ON';
    showNotice('마이크로 실제 소리에 반응해요. 스피커 음악이 마이크에 들려야 잘 움직여요.', 9000);
  } catch {
    showNotice('마이크 권한이 필요해요 (브라우저에서 허용해 주세요).', 9000);
  }
}
if (micBtn) micBtn.addEventListener('click', toggleMic);

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
