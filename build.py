"""
Build data.json + extract album art and lyrics from MP3 files.

Run this whenever you add/remove songs or change metadata.
    python build.py

Output:
    data.json              - track metadata (titles, durations, lyrics flags, etc.)
    assets/art/NN.jpg      - extracted album art per track
    assets/lyrics/NN.txt   - extracted lyrics per track (only if embedded)
                             You can also drop your own NN.txt here; it overrides ID3.
"""

from __future__ import annotations

import json
import re
import sys
import io
from pathlib import Path

from mutagen.mp3 import MP3
from mutagen.id3 import APIC, USLT

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).parent
ART_DIR = ROOT / "assets" / "art"
LYR_DIR = ROOT / "assets" / "lyrics"
TRACK_RE = re.compile(r"^(\d+(?:\.\d+)?)\.?\s+(.+?)\.mp3$", re.IGNORECASE)
# Strip leading track-number prefixes from ID3 titles (e.g. "05.1 엠퍼러..." -> "엠퍼러...")
TITLE_PREFIX_RE = re.compile(r"^\d+(?:\.\d+)?\.?\s+")


def slug(track_num: str) -> str:
    """'04.1' -> '04.1', '4' -> '04'."""
    if "." in track_num:
        whole, frac = track_num.split(".")
        return f"{int(whole):02d}.{frac}"
    return f"{int(track_num):02d}"


def extract_art(audio: MP3, dest: Path) -> str | None:
    if not audio.tags:
        return None
    for key in audio.tags.keys():
        if key.startswith("APIC"):
            apic: APIC = audio.tags[key]
            ext = "jpg"
            if apic.mime and "png" in apic.mime.lower():
                ext = "png"
            out = dest.with_suffix(f".{ext}")
            out.write_bytes(apic.data)
            return out.name
    return None


def extract_lyrics(audio: MP3) -> str | None:
    if not audio.tags:
        return None
    for key in audio.tags.keys():
        if key.startswith("USLT"):
            uslt: USLT = audio.tags[key]
            text = uslt.text or ""
            return text.strip() if text.strip() else None
    return None


def main() -> None:
    ART_DIR.mkdir(parents=True, exist_ok=True)
    LYR_DIR.mkdir(parents=True, exist_ok=True)

    tracks: list[dict] = []
    mp3_files = sorted(ROOT.glob("*.mp3"))
    if not mp3_files:
        print("No MP3 files found in", ROOT)
        return

    for mp3 in mp3_files:
        m = TRACK_RE.match(mp3.name)
        if not m:
            print(f"  skip (no track number): {mp3.name}")
            continue
        track_num = slug(m.group(1))
        title_from_file = m.group(2).strip()

        audio = MP3(mp3)
        tags = audio.tags
        title = str(tags.get("TIT2", title_from_file)).strip() if tags else title_from_file
        title = TITLE_PREFIX_RE.sub("", title)
        artist = str(tags.get("TPE1", "")).strip() if tags else ""
        duration = float(audio.info.length)

        art_stem = ART_DIR / track_num
        art_name = extract_art(audio, art_stem)

        # Sidecar lyrics file overrides ID3 lyrics.
        sidecar = LYR_DIR / f"{track_num}.txt"
        if sidecar.exists():
            lyrics = sidecar.read_text(encoding="utf-8").strip()
            lyrics_source = "sidecar"
        else:
            lyrics = extract_lyrics(audio)
            if lyrics:
                sidecar.write_text(lyrics, encoding="utf-8")
                lyrics_source = "id3"
            else:
                lyrics_source = None

        tracks.append({
            "num": track_num,
            "title": title,
            "artist": artist,
            "file": mp3.name,
            "duration": round(duration, 2),
            "art": f"assets/art/{art_name}" if art_name else None,
            "lyrics": f"assets/lyrics/{track_num}.txt" if lyrics else None,
            "lyricsSource": lyrics_source,
        })

        marks = []
        if art_name:
            marks.append("art")
        if lyrics:
            marks.append(f"lyr({lyrics_source})")
        print(f"  {track_num:6} {title[:40]:40} [{', '.join(marks) or '-'}]")

    # Fallback: tracks without their own art borrow art from the previous track
    # (handles cases like 04.1 having no embedded art -> use 04's art)
    last_art = None
    for t in tracks:
        if t["art"]:
            last_art = t["art"]
        elif last_art:
            t["art"] = last_art

    data = {
        "artist": "HAEMAMUL",
        "tracks": tracks,
    }
    (ROOT / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote data.json with {len(tracks)} tracks.")


if __name__ == "__main__":
    main()
