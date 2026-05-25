// HAEMAMUL — Music Web App
// Vanilla JS audio player with shuffle/repeat, color-extracted background,
// album-art-to-lyrics flip, Coverflow-style track carousel, likes + heart
// playlist mode, keyboard shortcuts, MediaSession.

// ────────────────────────────────────────────────────────────────
//  DOM refs
// ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const audio = $('audio');
const artCard = $('art-card');
const artImg = $('art-img');
const lyricsBadge = $('btn-lyrics');
const lyricsText = $('lyrics-text');
const lyricsScroll = $('lyrics-scroll');

const trackNumEl = $('track-num');
const trackTitleEl = $('track-title');
const trackArtistEl = $('track-artist');

const seek = $('seek');
const seekFill = $('seek-fill');
const seekKnob = $('seek-knob');
const timeCurEl = $('time-cur');
const timeDurEl = $('time-dur');

const btnPlay = $('btn-play');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnShuffle = $('btn-shuffle');
const btnRepeat = $('btn-repeat');

const btnTracklist = $('btn-tracklist');
const btnLike = $('btn-like');
const btnHeartList = $('btn-heart-list');
const brandHeart = $('brand-heart');

// Carousel overlay
const carouselEl = $('carousel');
const carouselStage = $('carousel-stage');
const carouselEmpty = $('carousel-empty');
const carouselModeEl = $('carousel-mode');
const carouselNumEl = $('carousel-num');
const carouselTitleEl = $('carousel-title');
const carouselDurEl = $('carousel-dur');
const carouselLikeEl = $('carousel-like');
const carouselPagerEl = $('carousel-pager');
const btnCarouselClose = $('btn-carousel-close');
const btnCarouselJump = $('btn-carousel-jump');
const btnCarouselPlay = $('btn-carousel-play');

const bgA = $('bg-a');
const bgB = $('bg-b');

// ────────────────────────────────────────────────────────────────
//  State
// ────────────────────────────────────────────────────────────────
let tracks = [];
let order = [];           // current playback order (indices into tracks)
let cursor = 0;           // position in order[]
let shuffle = false;
let repeat = 'off';       // 'off' | 'all' | 'one'
let lyricsCache = new Map();
let bgFlip = false;       // toggle between bg-a and bg-b

// Likes / heart mode
const LIKED_STORAGE_KEY = 'haemamul.liked';
let liked = new Set();    // Set<trackNum>
let heartMode = false;    // true when current queue is filtered to liked tracks

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────
const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
};

const currentTrack = () => tracks[order[cursor]];

const shuffleArray = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ────────────────────────────────────────────────────────────────
//  Color extraction (simple downsampled average + accent)
// ────────────────────────────────────────────────────────────────
const colorCache = new Map(); // imgSrc → [c1, c2]

async function extractColors(imgSrc) {
  if (colorCache.has(imgSrc)) return colorCache.get(imgSrc);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 32;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      let data;
      try { data = ctx.getImageData(0, 0, size, size).data; }
      catch { resolve(['#1a1a2a', '#0a0a0a']); return; }

      // Bucket pixels by hue, pick two dominant darkish-saturated colors
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const [h, s, l] = rgbToHsl(r, g, b);
        // Skip near-grays and extreme highlights/shadows
        if (s < 0.18) continue;
        if (l < 0.08 || l > 0.92) continue;
        const key = Math.round(h / 20) * 20; // 18 hue buckets
        const e = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        e.count++; e.r += r; e.g += g; e.b += b;
        buckets.set(key, e);
      }
      const sorted = [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .map(e => [Math.round(e.r/e.count), Math.round(e.g/e.count), Math.round(e.b/e.count)]);

      const pick = sorted.length ? sorted : [[40, 40, 60]];
      const c1 = darken(pick[0], 0.35);
      const c2 = darken(pick[1] || pick[0], 0.6);
      const result = [rgb(c1), rgb(c2)];
      colorCache.set(imgSrc, result);
      resolve(result);
    };
    img.onerror = () => {
      const fallback = ['#1a1a2a', '#0a0a0a'];
      colorCache.set(imgSrc, fallback);
      resolve(fallback);
    };
    img.src = imgSrc;
  });
}

function rgb([r, g, b]) { return `rgb(${r},${g},${b})`; }

function darken([r, g, b], amount) {
  return [r, g, b].map(v => Math.max(0, Math.round(v * (1 - amount))));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = ((b - r) / d + 2); break;
    default: h = ((r - g) / d + 4);
  }
  return [h * 60, s, l];
}

async function setBackground(imgSrc) {
  const [c1, c2] = await extractColors(imgSrc);
  const next = bgFlip ? bgA : bgB;
  const prev = bgFlip ? bgB : bgA;
  next.style.setProperty('--c1', c1);
  next.style.setProperty('--c2', c2);
  next.classList.add('active');
  prev.classList.remove('active');
  bgFlip = !bgFlip;
}

// ────────────────────────────────────────────────────────────────
//  Track loading / playback
// ────────────────────────────────────────────────────────────────
async function loadTrack(autoplay = false) {
  const t = currentTrack();
  if (!t) return;

  trackNumEl.textContent = `TRACK ${t.num}`;
  trackTitleEl.textContent = t.title;
  trackArtistEl.textContent = t.artist || 'HAEMAMUL';
  timeDurEl.textContent = fmtTime(t.duration);
  timeCurEl.textContent = '0:00';
  seekFill.style.width = '0%';
  seekKnob.style.left = '0%';

  // Reset flip when changing tracks
  artCard.classList.remove('flipped');

  // Album art
  artImg.classList.remove('loaded');
  if (t.art) {
    artImg.src = encodeURI(t.art);
    artImg.onload = () => artImg.classList.add('loaded');
    setBackground(encodeURI(t.art));
  }

  // Lyrics badge visibility
  if (t.lyrics) {
    lyricsBadge.hidden = false;
    artCard.classList.remove('no-lyrics');
    // Preload and cache lyrics text
    if (!lyricsCache.has(t.num)) {
      try {
        const res = await fetch(encodeURI(t.lyrics));
        const text = await res.text();
        lyricsCache.set(t.num, text);
      } catch {
        lyricsCache.set(t.num, '가사를 불러올 수 없습니다.');
      }
    }
    lyricsText.textContent = lyricsCache.get(t.num);
  } else {
    lyricsBadge.hidden = true;
    artCard.classList.add('no-lyrics');
    lyricsText.textContent = '';
  }

  // Audio source
  audio.src = encodeURI(t.file);
  audio.load();
  if (autoplay) {
    try { await audio.play(); } catch { /* user gesture not yet given */ }
  }

  updateLikeButton();
  updateMediaSession();
  syncURL();
}

// ────────────────────────────────────────────────────────────────
//  Likes (persisted) + heart mode
// ────────────────────────────────────────────────────────────────
function loadLiked() {
  try {
    const arr = JSON.parse(localStorage.getItem(LIKED_STORAGE_KEY) || '[]');
    liked = new Set(arr);
  } catch { liked = new Set(); }
}
function saveLiked() {
  try { localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify([...liked])); }
  catch { /* quota or disabled — ignore */ }
}

function toggleLike() {
  const t = currentTrack();
  if (!t) return;
  if (liked.has(t.num)) liked.delete(t.num);
  else liked.add(t.num);
  saveLiked();
  updateLikeButton();
  // If carousel is open, refresh the focused card's heart marker
  if (carouselEl.classList.contains('open')) updateCarouselMeta();
}

function updateLikeButton() {
  const t = currentTrack();
  const isLiked = !!(t && liked.has(t.num));
  btnLike.classList.toggle('liked', isLiked);
  btnLike.setAttribute('aria-label', isLiked ? '좋아요 해제' : '좋아요');
  btnLike.setAttribute('title', isLiked ? '좋아요 해제' : '좋아요');
}

function updateHeartIndicator() {
  brandHeart.hidden = !heartMode;
}

function enterHeartMode(startIdx) {
  const likedIdxs = tracks.map((t, i) => liked.has(t.num) ? i : -1).filter(i => i >= 0);
  if (likedIdxs.length === 0) return false;
  heartMode = true;
  if (shuffle) {
    const rest = likedIdxs.filter(i => i !== startIdx);
    order = [startIdx, ...shuffleArray(rest)];
  } else {
    order = likedIdxs;
  }
  cursor = Math.max(0, order.indexOf(startIdx));
  updateHeartIndicator();
  return true;
}

function exitHeartMode() {
  if (!heartMode) return;
  heartMode = false;
  const currentIdx = order[cursor];
  if (shuffle) {
    const rest = tracks.map((_, i) => i).filter(i => i !== currentIdx);
    order = [currentIdx, ...shuffleArray(rest)];
  } else {
    order = tracks.map((_, i) => i);
  }
  cursor = Math.max(0, order.indexOf(currentIdx));
  updateHeartIndicator();
}

function play() { audio.play().catch(() => {}); }
function pause() { audio.pause(); }
function togglePlay() { audio.paused ? play() : pause(); }

function next() {
  if (cursor < order.length - 1) {
    cursor++;
    loadTrack(true);
  } else if (repeat === 'all') {
    cursor = 0;
    if (shuffle) order = shuffleArray(baseOrderIdxs());
    loadTrack(true);
  } else {
    cursor = 0;
    loadTrack(false);
  }
}

function prev() {
  // If past 3 seconds, restart current; else go to previous.
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (cursor > 0) {
    cursor--;
  } else {
    cursor = order.length - 1;
  }
  loadTrack(true);
}

/** Indices of tracks eligible for the current mode (full set, or liked-only). */
function baseOrderIdxs() {
  if (heartMode) {
    return tracks.map((t, i) => liked.has(t.num) ? i : -1).filter(i => i >= 0);
  }
  return tracks.map((_, i) => i);
}

function toggleShuffle() {
  shuffle = !shuffle;
  btnShuffle.dataset.state = shuffle ? 'on' : 'off';
  const currentIdx = order[cursor];
  const baseIdxs = baseOrderIdxs();
  if (shuffle) {
    const rest = baseIdxs.filter(i => i !== currentIdx);
    order = [currentIdx, ...shuffleArray(rest)];
  } else {
    order = baseIdxs;
  }
  cursor = Math.max(0, order.indexOf(currentIdx));
}

const REPEAT_LABELS = {
  off: { aria: '반복: 끔', title: '반복: 끔 (전체 한 번만 재생)' },
  all: { aria: '반복: 전체', title: '반복: 전체 (모든 곡 반복 재생)' },
  one: { aria: '반복: 한 곡', title: '반복: 한 곡 (현재 곡만 반복)' },
};

function cycleRepeat() {
  repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
  btnRepeat.dataset.state = repeat;
  btnRepeat.setAttribute('aria-label', REPEAT_LABELS[repeat].aria);
  btnRepeat.setAttribute('title', REPEAT_LABELS[repeat].title);
}

// ────────────────────────────────────────────────────────────────
//  Audio events
// ────────────────────────────────────────────────────────────────
audio.addEventListener('play', () => {
  btnPlay.classList.add('is-playing');
  btnPlay.setAttribute('aria-label', '일시정지');
});
audio.addEventListener('pause', () => {
  btnPlay.classList.remove('is-playing');
  btnPlay.setAttribute('aria-label', '재생');
});
audio.addEventListener('timeupdate', () => {
  if (seekDragging) return;
  const cur = audio.currentTime;
  const dur = audio.duration || currentTrack()?.duration || 0;
  timeCurEl.textContent = fmtTime(cur);
  const pct = dur ? (cur / dur) * 100 : 0;
  seekFill.style.width = pct + '%';
  seekKnob.style.left = pct + '%';
});
audio.addEventListener('loadedmetadata', () => {
  timeDurEl.textContent = fmtTime(audio.duration);
});
audio.addEventListener('ended', () => {
  if (repeat === 'one') {
    audio.currentTime = 0;
    play();
  } else {
    next();
  }
});

// ────────────────────────────────────────────────────────────────
//  Seek bar interaction
// ────────────────────────────────────────────────────────────────
let seekDragging = false;

function seekToEvent(ev) {
  const rect = seek.getBoundingClientRect();
  const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  seekFill.style.width = (pct * 100) + '%';
  seekKnob.style.left = (pct * 100) + '%';
  return pct;
}

seek.addEventListener('pointerdown', (ev) => {
  seekDragging = true;
  seek.classList.add('dragging');
  seek.setPointerCapture(ev.pointerId);
  const pct = seekToEvent(ev);
  timeCurEl.textContent = fmtTime(pct * (audio.duration || 0));
});
seek.addEventListener('pointermove', (ev) => {
  if (!seekDragging) return;
  const pct = seekToEvent(ev);
  timeCurEl.textContent = fmtTime(pct * (audio.duration || 0));
});
seek.addEventListener('pointerup', (ev) => {
  if (!seekDragging) return;
  const pct = seekToEvent(ev);
  audio.currentTime = pct * (audio.duration || 0);
  seekDragging = false;
  seek.classList.remove('dragging');
});

// ────────────────────────────────────────────────────────────────
//  Album art flip → lyrics
// ────────────────────────────────────────────────────────────────
function toggleLyrics() {
  const t = currentTrack();
  if (!t || !t.lyrics) {
    artCard.classList.add('shake');
    setTimeout(() => artCard.classList.remove('shake'), 400);
    return;
  }
  artCard.classList.toggle('flipped');
  if (artCard.classList.contains('flipped')) {
    lyricsScroll.scrollTop = 0;
  }
}

artCard.addEventListener('click', (ev) => {
  // Don't trigger flip if the click landed on the badge itself.
  if (ev.target.closest('.lyrics-badge')) return;
  toggleLyrics();
});
lyricsBadge.addEventListener('click', (ev) => {
  ev.stopPropagation();
  toggleLyrics();
});

// ────────────────────────────────────────────────────────────────
//  Control buttons
// ────────────────────────────────────────────────────────────────
btnPlay.addEventListener('click', togglePlay);
btnPrev.addEventListener('click', prev);
btnNext.addEventListener('click', next);
btnShuffle.addEventListener('click', toggleShuffle);
btnRepeat.addEventListener('click', cycleRepeat);

// ────────────────────────────────────────────────────────────────
//  Carousel overlay (Coverflow-style track picker)
// ────────────────────────────────────────────────────────────────
const HEART_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

let carouselMode = 'all';   // 'all' | 'liked'
let carouselIdxs = [];      // track indices visible in the carousel
let carouselCursor = 0;     // index into carouselIdxs
let dragStartX = null;      // pointer x at drag start
let dragOffset = 0;         // current drag delta (px)
let wheelLock = false;      // throttle wheel events
let lastBgArt = null;       // avoid re-extracting colors for the same art

/** px between centers of adjacent cards. Read from CSS card-size. */
function cardSpacing() {
  const card = carouselStage.querySelector('.carousel-card');
  const size = card ? card.offsetWidth : 280;
  return Math.round(size * 0.78);
}

function openCarousel(mode = 'all') {
  carouselMode = mode;
  carouselIdxs = mode === 'liked'
    ? tracks.map((t, i) => liked.has(t.num) ? i : -1).filter(i => i >= 0)
    : tracks.map((_, i) => i);

  carouselModeEl.textContent = mode === 'liked' ? '좋아하는 곡' : '전체 곡';

  // Initial cursor: currently playing track if visible, otherwise 0
  const currentIdx = order[cursor];
  const found = carouselIdxs.indexOf(currentIdx);
  carouselCursor = found >= 0 ? found : 0;

  buildCarouselCards();

  carouselEl.hidden = false;
  carouselEl.setAttribute('aria-hidden', 'false');
  // Force reflow so the open transition runs from the hidden state
  void carouselEl.offsetWidth;
  carouselEl.classList.add('open');
}

function closeCarousel() {
  carouselEl.classList.remove('open');
  carouselEl.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    carouselEl.hidden = true;
    carouselStage.innerHTML = '';
  }, 300);
}

function buildCarouselCards() {
  carouselStage.innerHTML = '';

  if (carouselIdxs.length === 0) {
    carouselEmpty.hidden = false;
    carouselNumEl.textContent = '—';
    carouselTitleEl.textContent = '곡이 없어요';
    carouselDurEl.textContent = '';
    carouselLikeEl.hidden = true;
    carouselPagerEl.textContent = '0 / 0';
    btnCarouselPlay.disabled = true;
    btnCarouselPlay.style.opacity = '0.4';
    btnCarouselPlay.style.pointerEvents = 'none';
    return;
  }

  carouselEmpty.hidden = true;
  btnCarouselPlay.disabled = false;
  btnCarouselPlay.style.opacity = '';
  btnCarouselPlay.style.pointerEvents = '';

  const currentTrackIdx = order[cursor];
  carouselIdxs.forEach((trackIdx, pos) => {
    const t = tracks[trackIdx];
    const card = document.createElement('div');
    card.className = 'carousel-card';
    card.setAttribute('role', 'option');
    card.dataset.pos = String(pos);
    if (trackIdx === currentTrackIdx) card.classList.add('is-current');

    const imgHtml = t.art
      ? `<img src="${encodeURI(t.art)}" alt="" draggable="false">`
      : '';
    const heartHtml = liked.has(t.num) ? `<div class="card-heart">${HEART_SVG}</div>` : '';
    const playingHtml = `<div class="card-playing">NOW PLAYING</div>`;
    card.innerHTML = imgHtml + heartHtml + playingHtml;

    card.addEventListener('click', (ev) => {
      // Ignore clicks fired immediately after a drag (jitter).
      if (Math.abs(dragOffset) > 6) return;
      const targetPos = Number(card.dataset.pos);
      if (targetPos === carouselCursor) {
        playSelected();
      } else {
        carouselCursor = targetPos;
        positionCards(true);
        updateCarouselMeta();
      }
    });
    carouselStage.appendChild(card);
  });
  positionCards(false);
  updateCarouselMeta();
}

function positionCards(animate = true) {
  const spacing = cardSpacing();
  const cards = carouselStage.children;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const offset = i - carouselCursor;
    const abs = Math.abs(offset);
    const x = offset * spacing + dragOffset;
    // Scale falls off with distance; opacity hides far cards entirely.
    let scale, opacity;
    if (abs === 0) { scale = 1; opacity = 1; }
    else if (abs === 1) { scale = 0.74; opacity = 0.7; }
    else if (abs === 2) { scale = 0.56; opacity = 0.35; }
    else { scale = 0.5; opacity = 0; }

    card.style.transition = animate ? '' : 'none';
    card.style.transform = `translateX(${x}px) scale(${scale})`;
    card.style.opacity = String(opacity);
    card.style.zIndex = String(100 - abs);
    card.style.pointerEvents = abs <= 1 ? 'auto' : 'none';
    card.classList.toggle('focused', abs === 0);
  }
}

function updateCarouselMeta() {
  if (carouselIdxs.length === 0) return;
  const t = tracks[carouselIdxs[carouselCursor]];
  carouselNumEl.textContent = `TRACK ${t.num}`;
  carouselTitleEl.textContent = t.title;
  carouselDurEl.textContent = fmtTime(t.duration);
  carouselLikeEl.hidden = !liked.has(t.num);
  carouselPagerEl.textContent = `${carouselCursor + 1} / ${carouselIdxs.length}`;
  // Live background preview — show the focused art's color while browsing.
  if (t.art && t.art !== lastBgArt) {
    lastBgArt = t.art;
    setBackground(encodeURI(t.art));
  }
}

function carouselGo(delta) {
  const next = Math.max(0, Math.min(carouselIdxs.length - 1, carouselCursor + delta));
  if (next === carouselCursor) return;
  carouselCursor = next;
  positionCards(true);
  updateCarouselMeta();
}

function playSelected() {
  if (carouselIdxs.length === 0) return;
  const trackIdx = carouselIdxs[carouselCursor];
  if (carouselMode === 'liked') {
    enterHeartMode(trackIdx);
  } else {
    if (heartMode) exitHeartMode();
    const pos = order.indexOf(trackIdx);
    cursor = pos >= 0 ? pos : 0;
  }
  loadTrack(true);
  closeCarousel();
}

function jumpToCurrent() {
  const currentIdx = order[cursor];
  const found = carouselIdxs.indexOf(currentIdx);
  if (found < 0) return;
  carouselCursor = found;
  positionCards(true);
  updateCarouselMeta();
}

// ----- Touch / mouse drag -----
function onCarouselPointerDown(ev) {
  if (carouselIdxs.length === 0) return;
  dragStartX = ev.clientX;
  dragOffset = 0;
  carouselStage.classList.add('dragging');
  try { carouselStage.setPointerCapture(ev.pointerId); } catch {}
}
function onCarouselPointerMove(ev) {
  if (dragStartX == null) return;
  dragOffset = ev.clientX - dragStartX;
  positionCards(false);
}
function onCarouselPointerUp() {
  if (dragStartX == null) return;
  const threshold = cardSpacing() * 0.25;
  carouselStage.classList.remove('dragging');
  if (dragOffset > threshold) {
    dragOffset = 0;
    carouselGo(-1);
  } else if (dragOffset < -threshold) {
    dragOffset = 0;
    carouselGo(1);
  } else {
    dragOffset = 0;
    positionCards(true);
  }
  dragStartX = null;
}

// ----- Wheel (desktop) -----
function onCarouselWheel(ev) {
  if (wheelLock) { ev.preventDefault(); return; }
  // Dominant axis decides direction so vertical scrolls also work.
  const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
  if (Math.abs(delta) < 4) return;
  ev.preventDefault();
  wheelLock = true;
  setTimeout(() => { wheelLock = false; }, 220);
  carouselGo(delta > 0 ? 1 : -1);
}

// Wire carousel handlers
btnTracklist.addEventListener('click', () => openCarousel('all'));
btnHeartList.addEventListener('click', () => openCarousel('liked'));
btnLike.addEventListener('click', toggleLike);
btnCarouselClose.addEventListener('click', closeCarousel);
btnCarouselJump.addEventListener('click', jumpToCurrent);
btnCarouselPlay.addEventListener('click', playSelected);

carouselStage.addEventListener('pointerdown', onCarouselPointerDown);
carouselStage.addEventListener('pointermove', onCarouselPointerMove);
carouselStage.addEventListener('pointerup', onCarouselPointerUp);
carouselStage.addEventListener('pointercancel', onCarouselPointerUp);
carouselStage.addEventListener('wheel', onCarouselWheel, { passive: false });

window.addEventListener('resize', () => {
  if (!carouselEl.classList.contains('open')) return;
  positionCards(false);
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ────────────────────────────────────────────────────────────────
//  Keyboard shortcuts
// ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;

  // Carousel takes over arrow keys / Enter when open
  if (carouselEl.classList.contains('open')) {
    switch (ev.key) {
      case 'ArrowLeft':  ev.preventDefault(); carouselGo(-1); return;
      case 'ArrowRight': ev.preventDefault(); carouselGo(1); return;
      case 'Enter':
      case ' ':
        ev.preventDefault(); playSelected(); return;
      case 'Escape':     ev.preventDefault(); closeCarousel(); return;
    }
  }

  switch (ev.key) {
    case ' ':
    case 'k':
      ev.preventDefault(); togglePlay(); break;
    case 'ArrowRight':
      if (ev.shiftKey) next();
      else audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      break;
    case 'ArrowLeft':
      if (ev.shiftKey) prev();
      else audio.currentTime = Math.max(0, audio.currentTime - 5);
      break;
    case 'n': case 'N': next(); break;
    case 'p': case 'P': prev(); break;
    case 's': case 'S': toggleShuffle(); break;
    case 'r': case 'R': cycleRepeat(); break;
    case 'l': case 'L': toggleLyrics(); break;
    case 't': case 'T':
      carouselEl.classList.contains('open') ? closeCarousel() : openCarousel('all');
      break;
    case 'f': case 'F': toggleLike(); break;
    case 'Escape':
      if (artCard.classList.contains('flipped')) artCard.classList.remove('flipped');
      break;
  }
});

// ────────────────────────────────────────────────────────────────
//  Media Session API (lock-screen / OS media keys)
// ────────────────────────────────────────────────────────────────
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = currentTrack();
  if (!t) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist || 'HAEMAMUL',
    album: 'HAEMAMUL',
    artwork: t.art ? [
      { src: encodeURI(t.art), sizes: '512x512', type: 'image/jpeg' }
    ] : []
  });
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('nexttrack', next);
}

// ────────────────────────────────────────────────────────────────
//  Deep-link via URL hash (#t=07)
// ────────────────────────────────────────────────────────────────
function syncURL() {
  const t = currentTrack();
  if (!t) return;
  const newHash = `#t=${t.num}`;
  if (location.hash !== newHash) {
    history.replaceState(null, '', newHash);
  }
}

function cursorFromHash() {
  const m = location.hash.match(/t=([\d.]+)/);
  if (!m) return null;
  const idx = tracks.findIndex(t => t.num === m[1]);
  return idx >= 0 ? idx : null;
}

function enableShuffleFromTrack(trackIdx) {
  shuffle = true;
  btnShuffle.dataset.state = 'on';
  const rest = tracks.map((_, i) => i).filter(i => i !== trackIdx);
  order = [trackIdx, ...shuffleArray(rest)];
  cursor = 0;
}

// ────────────────────────────────────────────────────────────────
//  Boot
// ────────────────────────────────────────────────────────────────
(async function init() {
  try {
    const res = await fetch('data.json');
    const data = await res.json();
    tracks = data.tracks;
  } catch (err) {
    trackTitleEl.textContent = 'data.json을 불러올 수 없습니다.';
    console.error(err);
    return;
  }

  loadLiked();

  const hashCursor = cursorFromHash();
  if (hashCursor !== null) {
    // Deep-link: respect the requested track, no auto-shuffle
    order = tracks.map((_, i) => i);
    cursor = hashCursor;
  } else {
    // First visit / no hash: pick a random track and turn shuffle on
    const randomIdx = Math.floor(Math.random() * tracks.length);
    enableShuffleFromTrack(randomIdx);
  }

  // Try to autoplay. Browsers usually block this until a user gesture —
  // if blocked, the track is loaded and the user just hits play.
  await loadTrack(true);
})();
