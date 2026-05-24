// HAEMAMUL — Music Web App
// Vanilla JS audio player with shuffle/repeat, color-extracted background,
// album-art-to-lyrics flip, tracklist drawer, keyboard shortcuts, MediaSession.

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
const btnCloseTracklist = $('btn-close-tracklist');
const tracklistEl = $('tracklist');
const tracklistItems = $('tracklist-items');
const scrim = $('scrim');

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
async function extractColors(imgSrc) {
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
      resolve([rgb(c1), rgb(c2)]);
    };
    img.onerror = () => resolve(['#1a1a2a', '#0a0a0a']);
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

  updatePlayingItem();
  updateMediaSession();
  syncURL();
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
    if (shuffle) order = shuffleArray(tracks.map((_, i) => i));
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

function toggleShuffle() {
  shuffle = !shuffle;
  btnShuffle.dataset.state = shuffle ? 'on' : 'off';
  const currentIdx = order[cursor];
  if (shuffle) {
    const rest = tracks.map((_, i) => i).filter(i => i !== currentIdx);
    order = [currentIdx, ...shuffleArray(rest)];
  } else {
    order = tracks.map((_, i) => i);
  }
  cursor = order.indexOf(currentIdx);
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
//  Tracklist drawer
// ────────────────────────────────────────────────────────────────
function openTracklist() {
  tracklistEl.classList.add('open');
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add('visible'));
  tracklistEl.setAttribute('aria-hidden', 'false');
  // Scroll the playing item into view
  const playing = tracklistItems.querySelector('.playing');
  if (playing) playing.scrollIntoView({ block: 'center' });
}
function closeTracklist() {
  tracklistEl.classList.remove('open');
  scrim.classList.remove('visible');
  setTimeout(() => { scrim.hidden = true; }, 300);
  tracklistEl.setAttribute('aria-hidden', 'true');
}

btnTracklist.addEventListener('click', openTracklist);
btnCloseTracklist.addEventListener('click', closeTracklist);
scrim.addEventListener('click', closeTracklist);

function renderTracklist() {
  tracklistItems.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'tracklist-item';
    li.dataset.idx = String(i);
    li.innerHTML = `
      <div class="ti-num">${t.num}</div>
      <div class="ti-title">${escapeHtml(t.title)}${t.lyrics ? '<span class="ti-lyr" title="가사 있음"></span>' : ''}</div>
      <div class="ti-dur">${fmtTime(t.duration)}</div>
    `;
    li.addEventListener('click', () => {
      cursor = order.indexOf(i);
      loadTrack(true);
      closeTracklist();
    });
    tracklistItems.appendChild(li);
  });
}

function updatePlayingItem() {
  const currentIdx = order[cursor];
  tracklistItems.querySelectorAll('.tracklist-item').forEach((el) => {
    el.classList.toggle('playing', Number(el.dataset.idx) === currentIdx);
  });
}

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
      tracklistEl.classList.contains('open') ? closeTracklist() : openTracklist();
      break;
    case 'Escape':
      if (tracklistEl.classList.contains('open')) closeTracklist();
      else if (artCard.classList.contains('flipped')) artCard.classList.remove('flipped');
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

function initialCursorFromHash() {
  const m = location.hash.match(/t=([\d.]+)/);
  if (!m) return 0;
  const num = m[1];
  const idx = tracks.findIndex(t => t.num === num);
  return idx >= 0 ? idx : 0;
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
  order = tracks.map((_, i) => i);
  cursor = initialCursorFromHash();

  renderTracklist();
  await loadTrack(false);
})();
