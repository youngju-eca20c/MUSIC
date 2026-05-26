// HAEMAMUL — Music Web App
// Vanilla JS audio player with shuffle/repeat, color-extracted background,
// album-art-to-lyrics flip, Coverflow-style track carousel, likes + heart
// playlist mode, keyboard shortcuts, MediaSession.

// ────────────────────────────────────────────────────────────────
//  DOM refs
// ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Two audio elements so we can crossfade between tracks. activeAudioIdx
// is the live one; the other gets pre-loaded with the new track and
// faded up while the old one fades down.
const audios = [$('audio'), $('audio-b')];
let activeAudioIdx = 0;
const activeAudio = () => audios[activeAudioIdx];
const otherAudio = () => audios[1 - activeAudioIdx];
const CROSSFADE_MS = 300;
let fadeFrame = null;

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

// Track picker (tessellated diamond grid)
const carouselEl = $('carousel');
const carouselStage = $('carousel-stage');
const carouselGrid = $('carousel-grid');
const carouselEmpty = $('carousel-empty');
const carouselModeEl = $('carousel-mode');
const btnCarouselClose = $('btn-carousel-close');
const btnCarouselJump = $('btn-carousel-jump');

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

  // Audio: crossfade when something is already playing, otherwise just
  // load on the current active element.
  const old = activeAudio();
  const wasPlaying = autoplay && !!old.src && !old.paused && old.currentTime > 0;
  const newUrl = encodeURI(t.file);

  if (wasPlaying) {
    // Cancel any fade still in flight, then swap to the other element
    // and start the new track at zero volume so we can ramp it up.
    if (fadeFrame) { cancelAnimationFrame(fadeFrame); fadeFrame = null; }
    activeAudioIdx = 1 - activeAudioIdx;
    const fresh = activeAudio();
    fresh.src = newUrl;
    fresh.volume = 0;
    fresh.load();
    try {
      await fresh.play();
      startCrossfade(old, fresh);
    } catch {
      // Play was blocked — revert active and fall back to direct swap.
      activeAudioIdx = 1 - activeAudioIdx;
      old.src = newUrl;
      old.volume = 1;
      old.load();
    }
  } else {
    old.src = newUrl;
    old.volume = 1;
    old.load();
    if (autoplay) {
      try { await old.play(); } catch { /* user gesture not yet given */ }
    }
  }

  updateLikeButton();
  updateMediaSession();
  syncURL();
}

/**
 * Equal-power crossfade between two <audio> elements. cos/sin curves
 * keep the perceived loudness flat (instead of the dip you get with a
 * linear fade where both volumes sit at 0.5 at the midpoint).
 */
function startCrossfade(oldA, newA) {
  if (fadeFrame) cancelAnimationFrame(fadeFrame);
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / CROSSFADE_MS);
    oldA.volume = Math.cos(t * Math.PI / 2);
    newA.volume = Math.sin(t * Math.PI / 2);
    if (t < 1) {
      fadeFrame = requestAnimationFrame(step);
    } else {
      oldA.pause();
      oldA.currentTime = 0;
      oldA.volume = 1;  // reset for reuse
      fadeFrame = null;
    }
  }
  fadeFrame = requestAnimationFrame(step);
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

function play() { activeAudio().play().catch(() => {}); }
function pause() { activeAudio().pause(); }
function togglePlay() { activeAudio().paused ? play() : pause(); }

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
  if (activeAudio().currentTime > 3) {
    activeAudio().currentTime = 0;
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
// Wire each audio element to the shared UI. Only events from the
// currently-active element affect the UI; the other one is either
// idle or fading out during a crossfade and shouldn't interfere.
function setupAudioListeners(a) {
  a.addEventListener('play', () => {
    if (a !== activeAudio()) return;
    btnPlay.classList.add('is-playing');
    btnPlay.setAttribute('aria-label', '일시정지');
  });
  a.addEventListener('pause', () => {
    if (a !== activeAudio()) return;
    btnPlay.classList.remove('is-playing');
    btnPlay.setAttribute('aria-label', '재생');
  });
  a.addEventListener('timeupdate', () => {
    if (a !== activeAudio()) return;
    if (seekDragging) return;
    const cur = a.currentTime;
    const dur = a.duration || currentTrack()?.duration || 0;
    timeCurEl.textContent = fmtTime(cur);
    const pct = dur ? (cur / dur) * 100 : 0;
    seekFill.style.width = pct + '%';
    seekKnob.style.left = pct + '%';
  });
  a.addEventListener('loadedmetadata', () => {
    if (a !== activeAudio()) return;
    timeDurEl.textContent = fmtTime(a.duration);
  });
  a.addEventListener('ended', () => {
    if (a !== activeAudio()) return;
    if (repeat === 'one') {
      a.currentTime = 0;
      play();
    } else {
      next();
    }
  });
}
audios.forEach(setupAudioListeners);

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
  timeCurEl.textContent = fmtTime(pct * (activeAudio().duration || 0));
});
seek.addEventListener('pointermove', (ev) => {
  if (!seekDragging) return;
  const pct = seekToEvent(ev);
  timeCurEl.textContent = fmtTime(pct * (activeAudio().duration || 0));
});
seek.addEventListener('pointerup', (ev) => {
  if (!seekDragging) return;
  const pct = seekToEvent(ev);
  activeAudio().currentTime = pct * (activeAudio().duration || 0);
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
//  Track picker — rotated-diamond grid
// ────────────────────────────────────────────────────────────────
const HEART_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

let carouselMode = 'all';   // 'all' | 'liked'
let carouselIdxs = [];      // track indices currently shown in the grid
let hasStarted = false;     // true once the user has picked & played a track

function openCarousel(mode = 'all') {
  carouselMode = mode;
  carouselIdxs = mode === 'liked'
    ? tracks.map((t, i) => liked.has(t.num) ? i : -1).filter(i => i >= 0)
    : tracks.map((_, i) => i);

  carouselModeEl.textContent = mode === 'liked' ? '좋아하는 곡' : '전체 곡';

  // On the first visit (no track started yet) the close/jump buttons
  // would strand the user with an empty player — hide them until they pick.
  btnCarouselClose.style.visibility = hasStarted ? '' : 'hidden';
  btnCarouselJump.style.visibility = hasStarted ? '' : 'hidden';

  // Show overlay BEFORE building cards. The [hidden] attribute removes the
  // element from layout, so getComputedStyle / clientWidth return 0 until
  // we unhide and reflow. Without this, layout math used stale fallbacks
  // and cells overlapped on desktop.
  carouselEl.hidden = false;
  carouselEl.setAttribute('aria-hidden', 'false');
  void carouselEl.offsetWidth;
  carouselEl.classList.add('open');

  buildCarouselCards();

  requestAnimationFrame(() => scrollCurrentIntoView('auto'));
}

function closeCarousel({ instant = false } = {}) {
  carouselEl.classList.remove('open');
  carouselEl.setAttribute('aria-hidden', 'true');
  if (instant) {
    // No fade — used when a View Transition is handling the visual close
    // so the picker is gone from the snapshot the browser captures next.
    carouselEl.hidden = true;
    carouselGrid.innerHTML = '';
  } else {
    setTimeout(() => {
      carouselEl.hidden = true;
      carouselGrid.innerHTML = '';
    }, 300);
  }
}

function buildCarouselCards() {
  carouselGrid.innerHTML = '';

  if (carouselIdxs.length === 0) {
    carouselEmpty.hidden = false;
    return;
  }
  carouselEmpty.hidden = true;

  // Nothing is "currently playing" yet on a fresh load — suppress the marker.
  const currentTrackIdx = hasStarted ? order[cursor] : -1;
  carouselIdxs.forEach((trackIdx) => {
    const t = tracks[trackIdx];
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    cell.setAttribute('role', 'option');
    cell.dataset.trackIdx = String(trackIdx);
    cell.title = `${t.num}. ${t.title}`;  // browser tooltip on hover
    if (trackIdx === currentTrackIdx) cell.classList.add('is-current');

    const imgHtml = t.art
      ? `<img src="${encodeURI(t.art)}" alt="" draggable="false">`
      : '';
    const heartHtml = liked.has(t.num)
      ? `<div class="grid-heart" aria-label="좋아하는 곡">${HEART_SVG}</div>`
      : '';

    cell.innerHTML = `
      <div class="grid-art-wrap">
        ${imgHtml}
        ${heartHtml}
        <div class="grid-now-playing">NOW PLAYING</div>
      </div>
      <div class="grid-label">${escapeHtml(t.title)}</div>
    `;

    cell.addEventListener('click', () => playTrack(trackIdx));
    carouselGrid.appendChild(cell);
  });
}


function playTrack(trackIdx) {
  hasStarted = true;
  if (carouselMode === 'liked') {
    enterHeartMode(trackIdx);
  } else {
    if (heartMode) exitHeartMode();
    const pos = order.indexOf(trackIdx);
    cursor = pos >= 0 ? pos : 0;
  }

  // Hero-style morph: the tapped tile's album art grows into the main
  // player's album art. Uses the View Transitions API where available
  // and falls back to an instant swap on older browsers.
  const sourceImg = carouselGrid.querySelector(
    `.grid-cell[data-track-idx="${trackIdx}"] .grid-art-wrap img`
  );

  if (typeof document.startViewTransition === 'function' && sourceImg) {
    sourceImg.style.viewTransitionName = 'album-art-morph';
    const transition = document.startViewTransition(() => {
      // Within the DOM-update callback the picker tile is removed and the
      // main player's <img> picks up the morph name — so only one element
      // carries the name at any captured snapshot, which the spec requires.
      sourceImg.style.viewTransitionName = '';
      artImg.style.viewTransitionName = 'album-art-morph';
      closeCarousel({ instant: true });
      loadTrack(true);
    });
    transition.finished.finally(() => {
      artImg.style.viewTransitionName = '';
    });
  } else {
    closeCarousel();
    loadTrack(true);
  }
}

/** Used by toggleLike to refresh heart markers if the picker is open. */
function updateCarouselMeta() {
  if (!carouselEl.classList.contains('open')) return;
  // Cheapest: rebuild. Grid is small.
  buildCarouselCards();
}

function scrollCurrentIntoView(behavior = 'smooth') {
  if (!hasStarted) return;
  const currentIdx = order[cursor];
  const target = carouselGrid.querySelector(`.grid-cell[data-track-idx="${currentIdx}"]`);
  if (target) target.scrollIntoView({ block: 'center', behavior });
}

function jumpToCurrent() {
  scrollCurrentIntoView('smooth');
}

// Wire picker handlers
btnTracklist.addEventListener('click', () => openCarousel('all'));
btnHeartList.addEventListener('click', () => openCarousel('liked'));
btnLike.addEventListener('click', toggleLike);
btnCarouselClose.addEventListener('click', closeCarousel);
btnCarouselJump.addEventListener('click', jumpToCurrent);

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

  // Picker grid is open: Escape closes it — but only if the user has
  // already picked a song at least once. On the initial visit there's
  // no track loaded, so closing would strand them on a blank player.
  if (carouselEl.classList.contains('open') && ev.key === 'Escape') {
    if (!hasStarted) return;
    ev.preventDefault();
    closeCarousel();
    return;
  }

  switch (ev.key) {
    case ' ':
    case 'k':
      ev.preventDefault(); togglePlay(); break;
    case 'ArrowRight':
      if (ev.shiftKey) next();
      else {
        const a = activeAudio();
        a.currentTime = Math.min(a.duration, a.currentTime + 5);
      }
      break;
    case 'ArrowLeft':
      if (ev.shiftKey) prev();
      else {
        const a = activeAudio();
        a.currentTime = Math.max(0, a.currentTime - 5);
      }
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
  order = tracks.map((_, i) => i);

  const hashCursor = cursorFromHash();
  if (hashCursor !== null) {
    // Deep link (#t=NN): jump straight into playback, skip the picker.
    cursor = hashCursor;
    hasStarted = true;
    await loadTrack(true);
  } else {
    // Fresh visit: open the picker so the user chooses a starting song.
    // No track is loaded yet — NOW PLAYING marker and the close/jump
    // buttons stay hidden until they pick one.
    cursor = 0;
    openCarousel('all');
  }
})();
