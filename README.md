# HAEMAMUL

Personal music showcase web app by HAEMAMUL.

Live: https://youngju-eca20c.github.io/MUSIC/

## How it works

- `build.py` reads MP3 ID3 tags and writes `data.json` + extracts album art (`assets/art/`) and embedded lyrics (`assets/lyrics/`).
- `index.html` + `styles.css` + `app.js` is a static web app that plays everything in the browser.
- Color-extracted gradient background, album-art-to-lyrics flip, shuffle, 3-mode repeat, keyboard shortcuts, Media Session API.

## Adding a song

1. Drop `NN. Title.mp3` into the root.
2. `python build.py` to regenerate `data.json` + assets.
3. Commit & push.

## Adding/editing lyrics for a song without embedded USLT

Create `assets/lyrics/NN.txt` (matching the track number). Sidecar files take priority over ID3.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space / K | Play / Pause |
| ← / → | Seek 5s |
| Shift + ← / → | Prev / Next track |
| N / P | Next / Prev track |
| S | Toggle shuffle |
| R | Cycle repeat (off → all → one) |
| L | Toggle lyrics (if available) |
| T | Toggle tracklist |
| Esc | Close lyrics / tracklist |

## Local dev

```bash
python -m http.server 8000
# open http://localhost:8000
```
